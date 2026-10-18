-- ============================================================
-- STEP229: More scheduled report emails on top of STEP228.
--   project_status   — weekly project status (all active projects, or one)
--   monthly_summary  — monthly management report (delivery + people + money)
--   financial        — money in / money out / receivables / project P&L
-- Plus send_minute (send time to the minute) and `coverage` on every schedule: 'to_date' (period ending the send day,
-- the STEP228 behaviour) or 'previous' (the previous full day / Mon–Sun
-- week / calendar month — what a report sent on Monday or the 1st wants).
--
-- The worker (send-email) still renders every report under the existing
-- 'team_report' outbox template and dispatches on payload.report_type, so
-- no outbox changes are needed. Safe to re-run.
-- ============================================================

ALTER TABLE email_report_schedules DROP CONSTRAINT IF EXISTS email_report_schedules_report_type_check;
ALTER TABLE email_report_schedules ADD CONSTRAINT email_report_schedules_report_type_check
  CHECK (report_type IN ('team_performance','project_status','monthly_summary','financial'));
ALTER TABLE email_report_schedules ADD COLUMN IF NOT EXISTS coverage TEXT NOT NULL DEFAULT 'to_date';
ALTER TABLE email_report_schedules DROP CONSTRAINT IF EXISTS email_report_schedules_coverage_check;
ALTER TABLE email_report_schedules ADD CONSTRAINT email_report_schedules_coverage_check CHECK (coverage IN ('to_date','previous'));
ALTER TABLE email_report_schedules ADD COLUMN IF NOT EXISTS project_id UUID; -- soft ref -> projects(id); project_status only, null = all active
-- Send time to the minute (send_hour:send_minute, org timezone).
ALTER TABLE email_report_schedules ADD COLUMN IF NOT EXISTS send_minute SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE email_report_schedules DROP CONSTRAINT IF EXISTS email_report_schedules_send_minute_check;
ALTER TABLE email_report_schedules ADD CONSTRAINT email_report_schedules_send_minute_check CHECK (send_minute BETWEEN 0 AND 59);

-- Finance can now manage schedules too.
CREATE OR REPLACE FUNCTION is_org_report_manager() RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','hr','finance'))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Company-money reports: only admin / ceo / finance may create or change them.
CREATE OR REPLACE FUNCTION is_org_finance_reporter() RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

DROP POLICY IF EXISTS email_report_schedules_rw ON email_report_schedules;
DROP POLICY IF EXISTS email_report_schedules_select ON email_report_schedules;
DROP POLICY IF EXISTS email_report_schedules_write ON email_report_schedules;
CREATE POLICY email_report_schedules_select ON email_report_schedules FOR SELECT
  USING (organization_id = current_org_id() AND is_org_report_manager()
         AND (report_type NOT IN ('financial','monthly_summary') OR is_org_finance_reporter()));
CREATE POLICY email_report_schedules_write ON email_report_schedules FOR ALL
  USING (organization_id = current_org_id() AND is_org_report_manager()
         AND (report_type NOT IN ('financial','monthly_summary') OR is_org_finance_reporter()))
  WITH CHECK (organization_id = current_org_id() AND is_org_report_manager()
         AND (report_type NOT IN ('financial','monthly_summary') OR is_org_finance_reporter()));

-- One payload builder so the scheduler and "Send preview" can't drift.
CREATE OR REPLACE FUNCTION _report_payload(r email_report_schedules, p_day DATE, p_tz TEXT, p_preview BOOLEAN)
RETURNS JSONB AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'schedule_id', r.id, 'name', r.name, 'report_type', r.report_type, 'period', r.period,
    'coverage', r.coverage, 'department_id', r.department_id, 'project_id', r.project_id,
    'as_of', p_day, 'timezone', p_tz, 'preview', CASE WHEN p_preview THEN true END))
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION enqueue_due_report_emails() RETURNS INT AS $$
DECLARE r RECORD; sch email_report_schedules; v_local TIMESTAMP; v_day DATE; v_count INT := 0; v_to RECORD;
BEGIN
  PERFORM _email_worker_guard();
  FOR r IN
    SELECT sch0.id, COALESCE(s.timezone, 'Asia/Kolkata') AS tz
    FROM email_report_schedules sch0
    JOIN org_email_settings s ON s.organization_id = sch0.organization_id AND s.enabled
    WHERE sch0.enabled
  LOOP
    SELECT * INTO sch FROM email_report_schedules WHERE id = r.id;
    v_local := now() AT TIME ZONE r.tz;
    v_day := v_local::date;
    -- Due from send_hour:send_minute until 59 minutes later: a missed cron
    -- minute can't skip a day, and a schedule created after its time today
    -- waits until tomorrow instead of firing late.
    CONTINUE WHEN v_local < v_day + make_time(sch.send_hour, sch.send_minute, 0)
               OR v_local >= v_day + make_time(sch.send_hour, sch.send_minute, 0) + interval '59 minutes';
    CONTINUE WHEN sch.last_sent_on = v_day;
    CONTINUE WHEN sch.period = 'daily'   AND sch.weekdays_only AND EXTRACT(DOW FROM v_local) IN (0, 6);
    CONTINUE WHEN sch.period = 'weekly'  AND EXTRACT(DOW FROM v_local) <> COALESCE(sch.send_weekday, 5);
    CONTINUE WHEN sch.period = 'monthly' AND EXTRACT(DAY FROM v_local) <> COALESCE(sch.send_monthday, 1);

    FOR v_to IN
      SELECT p.id, p.email, p.full_name FROM profiles p
      WHERE p.id = ANY(sch.recipient_ids) AND p.email IS NOT NULL AND COALESCE(p.is_active, true)
      UNION
      SELECT NULL::uuid, lower(trim(e)), NULL FROM unnest(sch.extra_emails) e WHERE trim(e) <> ''
    LOOP
      INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload, dedupe_key)
      VALUES (sch.organization_id, v_to.id, v_to.email, v_to.full_name, 'team_report',
              _report_payload(sch, v_day, r.tz, false),
              'report:' || sch.id || ':' || v_day || ':' || v_to.email)
      ON CONFLICT (dedupe_key) DO NOTHING;
      v_count := v_count + 1;
    END LOOP;
    UPDATE email_report_schedules SET last_sent_on = v_day WHERE id = sch.id;
  END LOOP;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION enqueue_due_report_emails() TO service_role;

CREATE OR REPLACE FUNCTION request_report_preview(p_schedule_id UUID) RETURNS UUID AS $$
DECLARE v_id UUID; v_email TEXT; v_name TEXT; r email_report_schedules; v_tz TEXT;
BEGIN
  IF NOT is_org_report_manager() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT * INTO r FROM email_report_schedules WHERE id = p_schedule_id AND organization_id = current_org_id();
  IF r.id IS NULL THEN RAISE EXCEPTION 'Schedule not found'; END IF;
  IF r.report_type IN ('financial','monthly_summary') AND NOT is_org_finance_reporter() THEN
    RAISE EXCEPTION 'Only admin, CEO or finance can preview this report';
  END IF;
  SELECT email, full_name INTO v_email, v_name FROM profiles WHERE id = auth.uid();
  IF v_email IS NULL THEN RAISE EXCEPTION 'Your profile has no email address'; END IF;
  SELECT COALESCE(timezone, 'Asia/Kolkata') INTO v_tz FROM org_email_settings WHERE organization_id = r.organization_id;
  v_tz := COALESCE(v_tz, 'Asia/Kolkata');
  INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload)
  VALUES (r.organization_id, auth.uid(), v_email, v_name, 'team_report', _report_payload(r, (now() AT TIME ZONE v_tz)::date, v_tz, true))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION request_report_preview(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
