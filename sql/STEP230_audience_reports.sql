-- ============================================================
-- STEP230: Audience reports on top of STEP228/229.
--   ceo_briefing    — one-page executive scorecard with trends
--   hr_people       — headcount, joiners, attendance, lateness, leave, approvals
--   manager_team    — one email PER MANAGER about only their direct reports
--   sales_pipeline  — leads, pipeline by stage, won/lost, closing soon, reps
--
-- Who may create / see / preview each type (checked by one function, used by
-- RLS and the preview RPC):
--   admin, ceo, finance       → financial, monthly_summary, ceo_briefing
--   admin, ceo, hr            → hr_people
--   any report manager        → team_performance, project_status, manager_team, sales_pipeline
--
-- manager_team fan-out: every active person with at least one active direct
-- report (reporting_manager_id or manager_id) gets their own copy; if the
-- schedule has recipients selected, only those managers are sent to.
-- Safe to re-run.
-- ============================================================

ALTER TABLE email_report_schedules DROP CONSTRAINT IF EXISTS email_report_schedules_report_type_check;
ALTER TABLE email_report_schedules ADD CONSTRAINT email_report_schedules_report_type_check
  CHECK (report_type IN ('team_performance','project_status','monthly_summary','financial',
                         'ceo_briefing','hr_people','manager_team','sales_pipeline'));

CREATE OR REPLACE FUNCTION can_manage_report_type(p_type TEXT) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = ANY (
      CASE
        WHEN p_type IN ('financial','monthly_summary','ceo_briefing') THEN ARRAY['admin','ceo','finance']
        WHEN p_type = 'hr_people' THEN ARRAY['admin','ceo','hr']
        ELSE ARRAY['admin','ceo','manager','department_head','hr','finance']
      END))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

DROP POLICY IF EXISTS email_report_schedules_select ON email_report_schedules;
DROP POLICY IF EXISTS email_report_schedules_write ON email_report_schedules;
CREATE POLICY email_report_schedules_select ON email_report_schedules FOR SELECT
  USING (organization_id = current_org_id() AND can_manage_report_type(report_type));
CREATE POLICY email_report_schedules_write ON email_report_schedules FOR ALL
  USING (organization_id = current_org_id() AND can_manage_report_type(report_type))
  WITH CHECK (organization_id = current_org_id() AND can_manage_report_type(report_type));

-- Managers = active people with at least one active direct report.
CREATE OR REPLACE FUNCTION _org_managers(p_org UUID)
RETURNS TABLE (id UUID, email TEXT, full_name TEXT) AS $$
  SELECT m.id, m.email, m.full_name FROM profiles m
  WHERE m.organization_id = p_org AND COALESCE(m.is_active, true) AND m.email IS NOT NULL
    AND EXISTS (SELECT 1 FROM profiles r WHERE COALESCE(r.is_active, true)
                AND r.id <> m.id AND COALESCE(r.reporting_manager_id, r.manager_id) = m.id)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION enqueue_due_report_emails() RETURNS INT AS $$
DECLARE r RECORD; sch email_report_schedules; v_local TIMESTAMP; v_day DATE; v_count INT := 0; v_to RECORD; v_payload JSONB;
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
    -- Due from send_hour:send_minute until 59 minutes later (see STEP229).
    CONTINUE WHEN v_local < v_day + make_time(sch.send_hour, sch.send_minute, 0)
               OR v_local >= v_day + make_time(sch.send_hour, sch.send_minute, 0) + interval '59 minutes';
    CONTINUE WHEN sch.last_sent_on = v_day;
    CONTINUE WHEN sch.period = 'daily'   AND sch.weekdays_only AND EXTRACT(DOW FROM v_local) IN (0, 6);
    CONTINUE WHEN sch.period = 'weekly'  AND EXTRACT(DOW FROM v_local) <> COALESCE(sch.send_weekday, 5);
    CONTINUE WHEN sch.period = 'monthly' AND EXTRACT(DAY FROM v_local) <> COALESCE(sch.send_monthday, 1);

    v_payload := _report_payload(sch, v_day, r.tz, false);
    IF sch.report_type = 'manager_team' THEN
      FOR v_to IN
        SELECT m.id, m.email, m.full_name FROM _org_managers(sch.organization_id) m
        WHERE cardinality(sch.recipient_ids) = 0 OR m.id = ANY(sch.recipient_ids)
      LOOP
        INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload, dedupe_key)
        VALUES (sch.organization_id, v_to.id, v_to.email, v_to.full_name, 'team_report',
                v_payload || jsonb_build_object('manager_id', v_to.id),
                'report:' || sch.id || ':' || v_day || ':' || v_to.email)
        ON CONFLICT (dedupe_key) DO NOTHING;
        v_count := v_count + 1;
      END LOOP;
    ELSE
      FOR v_to IN
        SELECT p.id, p.email, p.full_name FROM profiles p
        WHERE p.id = ANY(sch.recipient_ids) AND p.email IS NOT NULL AND COALESCE(p.is_active, true)
        UNION
        SELECT NULL::uuid, lower(trim(e)), NULL FROM unnest(sch.extra_emails) e WHERE trim(e) <> ''
      LOOP
        INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload, dedupe_key)
        VALUES (sch.organization_id, v_to.id, v_to.email, v_to.full_name, 'team_report', v_payload,
                'report:' || sch.id || ':' || v_day || ':' || v_to.email)
        ON CONFLICT (dedupe_key) DO NOTHING;
        v_count := v_count + 1;
      END LOOP;
    END IF;
    UPDATE email_report_schedules SET last_sent_on = v_day WHERE id = sch.id;
  END LOOP;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION enqueue_due_report_emails() TO service_role;

-- Preview goes to the caller. For manager_team it shows the caller's own team
-- if they manage anyone, otherwise the first manager's (so an admin can see it).
CREATE OR REPLACE FUNCTION request_report_preview(p_schedule_id UUID) RETURNS UUID AS $$
DECLARE v_id UUID; v_email TEXT; v_name TEXT; r email_report_schedules; v_tz TEXT; v_payload JSONB; v_mgr UUID;
BEGIN
  SELECT * INTO r FROM email_report_schedules WHERE id = p_schedule_id AND organization_id = current_org_id();
  IF r.id IS NULL THEN RAISE EXCEPTION 'Schedule not found'; END IF;
  IF NOT can_manage_report_type(r.report_type) THEN RAISE EXCEPTION 'You are not allowed to preview this report'; END IF;
  SELECT email, full_name INTO v_email, v_name FROM profiles WHERE id = auth.uid();
  IF v_email IS NULL THEN RAISE EXCEPTION 'Your profile has no email address'; END IF;
  SELECT COALESCE(timezone, 'Asia/Kolkata') INTO v_tz FROM org_email_settings WHERE organization_id = r.organization_id;
  v_tz := COALESCE(v_tz, 'Asia/Kolkata');
  v_payload := _report_payload(r, (now() AT TIME ZONE v_tz)::date, v_tz, true);
  IF r.report_type = 'manager_team' THEN
    SELECT m.id INTO v_mgr FROM _org_managers(r.organization_id) m ORDER BY (m.id = auth.uid()) DESC, m.full_name LIMIT 1;
    IF v_mgr IS NULL THEN RAISE EXCEPTION 'Nobody in your organization has direct reports yet (set a reporting manager on the Users page)'; END IF;
    v_payload := v_payload || jsonb_build_object('manager_id', v_mgr);
  END IF;
  INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload)
  VALUES (r.organization_id, auth.uid(), v_email, v_name, 'team_report', v_payload)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION request_report_preview(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
