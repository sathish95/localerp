-- ============================================================
-- STEP231: Configurable alert rules (automatic emails) on top of STEP228–230.
--
-- An organisation can create any number of rules in Settings → Email →
-- Automatic alerts. Each rule is one of:
--   checkin_missing — people who haven't checked in by send_time today
--   overdue_work    — people's overdue tasks / IT tickets / support tickets
-- and has:
--   when      send_time (org timezone), days_of_week (0=Sun … 6=Sat),
--             skip_holidays
--   who       audience_mode all | departments | roles | people, plus an
--             exclude list
--   delivery  send_to_person (each person their own email),
--             send_to_manager (each manager one list of their people),
--             summary_to_ids (named people get one org-wide list, e.g. HR)
--   overdue   include_tasks / include_it / include_support,
--   filters   min_days_overdue, priorities (empty = all)
--   wording   custom subject and intro message (optional)
--
-- "Expected to check in": active, has an email, not a vendor/portal login,
-- not a super admin, not on approved full-day leave today, not on a shift
-- starting after the rule's time. "Checked in" = any time_logs.check_in
-- since local midnight (the web app writes work_date as a UTC date).
--
-- enqueue_alert_emails() runs from the send-email worker every minute; a
-- rule fires once per day inside a 59-minute window after its time.
-- Nothing in the web app can read or write another org's rules (RLS).
-- Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS email_alert_rules (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID        NOT NULL DEFAULT current_org_id(),
  name             TEXT        NOT NULL,
  alert_type       TEXT        NOT NULL CHECK (alert_type IN ('checkin_missing','overdue_work')),
  enabled          BOOLEAN     NOT NULL DEFAULT true,
  send_time        TIME        NOT NULL DEFAULT '10:30',
  days_of_week     SMALLINT[]  NOT NULL DEFAULT '{1,2,3,4,5}',
  skip_holidays    BOOLEAN     NOT NULL DEFAULT true,
  audience_mode    TEXT        NOT NULL DEFAULT 'all' CHECK (audience_mode IN ('all','departments','roles','people')),
  department_ids   UUID[]      NOT NULL DEFAULT '{}',
  roles            TEXT[]      NOT NULL DEFAULT '{}',
  people_ids       UUID[]      NOT NULL DEFAULT '{}',
  exclude_ids      UUID[]      NOT NULL DEFAULT '{}',
  send_to_person   BOOLEAN     NOT NULL DEFAULT true,
  send_to_manager  BOOLEAN     NOT NULL DEFAULT false,
  summary_to_ids   UUID[]      NOT NULL DEFAULT '{}',
  include_tasks    BOOLEAN     NOT NULL DEFAULT true,
  include_it       BOOLEAN     NOT NULL DEFAULT true,
  include_support  BOOLEAN     NOT NULL DEFAULT true,
  min_days_overdue SMALLINT    NOT NULL DEFAULT 1 CHECK (min_days_overdue BETWEEN 1 AND 365),
  priorities       TEXT[]      NOT NULL DEFAULT '{}',
  custom_subject   TEXT,
  custom_message   TEXT,
  last_run_on      DATE,
  created_by       UUID,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_alert_rules_org_idx ON email_alert_rules(organization_id);
ALTER TABLE email_alert_rules ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_org_alert_manager() RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','hr'))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

DROP POLICY IF EXISTS email_alert_rules_rw ON email_alert_rules;
CREATE POLICY email_alert_rules_rw ON email_alert_rules FOR ALL
  USING (organization_id = current_org_id() AND is_org_alert_manager())
  WITH CHECK (organization_id = current_org_id() AND is_org_alert_manager());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_alert_rules TO authenticated;

ALTER TABLE email_outbox DROP CONSTRAINT IF EXISTS email_outbox_template_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_template_check CHECK (template IN (
  'notification','digest','team_report','welcome','invite','test',
  'checkin_reminder','checkin_manager','overdue_digest','overdue_manager'));

-- Flow-aware "is this task closed" — same rule as makeIsTaskDone() in
-- src/lib/dailyStatus.js.
CREATE OR REPLACE FUNCTION _task_is_done(p_org UUID, p_dept UUID, p_status TEXT) RETURNS BOOLEAN AS $$
  SELECT lower(trim(coalesce(p_status, ''))) IN ('closed','done','complete','completed','resolved')
      OR EXISTS (SELECT 1 FROM department_status_flows f JOIN department_status_steps s ON s.flow_id = f.id
                 WHERE f.organization_id = p_org AND f.department_id IS NOT DISTINCT FROM p_dept
                   AND s.status_key = p_status AND s.is_closed)
      OR (NOT EXISTS (SELECT 1 FROM department_status_flows f WHERE f.organization_id = p_org AND f.department_id IS NOT DISTINCT FROM p_dept)
          AND p_status = 'closed')
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- The people a rule covers (audience + exclusions), active with an email.
CREATE OR REPLACE FUNCTION _alert_audience(r email_alert_rules)
RETURNS TABLE (id UUID, email TEXT, full_name TEXT, manager_id UUID) AS $$
  SELECT p.id, p.email, p.full_name, COALESCE(p.reporting_manager_id, p.manager_id)
  FROM profiles p
  WHERE p.organization_id = r.organization_id AND COALESCE(p.is_active, true) AND p.email IS NOT NULL
    AND p.vendor_id IS NULL AND NOT COALESCE(p.is_super_admin, false)
    AND NOT (p.id = ANY (r.exclude_ids))
    AND CASE r.audience_mode
          WHEN 'departments' THEN p.department_id = ANY (r.department_ids)
          WHEN 'roles'       THEN p.role = ANY (r.roles)
          WHEN 'people'      THEN p.id = ANY (r.people_ids)
          ELSE true END
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Of a rule's audience, who hasn't checked in on p_day by the rule's time.
CREATE OR REPLACE FUNCTION _missing_checkins(r email_alert_rules, p_day DATE, p_tz TEXT)
RETURNS TABLE (id UUID, email TEXT, full_name TEXT, manager_id UUID) AS $$
  SELECT a.* FROM _alert_audience(r) a
  WHERE NOT EXISTS (SELECT 1 FROM time_logs t WHERE t.employee_id = a.id
                    AND t.check_in >= (p_day::timestamp AT TIME ZONE p_tz)
                    AND t.check_in <  ((p_day + 1)::timestamp AT TIME ZONE p_tz))
    AND NOT EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_id = a.id AND l.status = 'approved'
                    AND l.leave_type <> 'permission' AND l.from_date <= p_day AND COALESCE(l.to_date, l.from_date) >= p_day)
    AND NOT EXISTS (SELECT 1 FROM person_shift_assignments sa JOIN shift_patterns sp ON sp.id = sa.shift_pattern_id
                    WHERE sa.person_id = a.id AND sa.effective_from <= p_day AND (sa.effective_to IS NULL OR sa.effective_to >= p_day)
                      AND sp.start_time > r.send_time)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- One person's overdue work under a rule's filters, as of p_now.
CREATE OR REPLACE FUNCTION _overdue_items(r email_alert_rules, p_user UUID, p_day DATE, p_now TIMESTAMPTZ)
RETURNS JSONB AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'days')::int DESC), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('kind', 'Task', 'code', t.task_id, 'title', t.task_name, 'status', t.status, 'priority', t.priority,
             'project', pr.name, 'due', t.planned_end_date::text, 'days', p_day - t.planned_end_date) AS x
    FROM project_tasks t LEFT JOIN projects pr ON pr.id = t.project_id
    WHERE r.include_tasks AND t.organization_id = r.organization_id AND t.assigned_to = p_user
      AND t.planned_end_date <= p_day - r.min_days_overdue
      AND (cardinality(r.priorities) = 0 OR lower(coalesce(t.priority, '')) = ANY (r.priorities))
      AND NOT _task_is_done(r.organization_id, t.department_id, t.status)
    UNION ALL
    SELECT jsonb_build_object('kind', 'IT ticket', 'code', i.ticket_number, 'title', i.subject, 'status', i.status, 'priority', i.priority,
             'due', i.resolution_due_at::date::text, 'days', GREATEST(0, p_day - i.resolution_due_at::date))
    FROM it_helpdesk_tickets i
    WHERE r.include_it AND i.organization_id = r.organization_id AND i.assigned_to = p_user
      AND i.resolution_due_at < p_now - make_interval(days => r.min_days_overdue - 1) AND i.status NOT IN ('resolved','closed')
      AND (cardinality(r.priorities) = 0 OR lower(coalesce(i.priority, '')) = ANY (r.priorities))
    UNION ALL
    SELECT jsonb_build_object('kind', 'Support ticket', 'code', s.ticket_number, 'title', s.subject, 'status', s.status, 'priority', s.priority,
             'due', s.resolution_due_at::date::text, 'days', GREATEST(0, p_day - s.resolution_due_at::date))
    FROM support_tickets s
    WHERE r.include_support AND s.organization_id = r.organization_id AND s.assigned_agent_id = p_user
      AND s.resolution_due_at < p_now - make_interval(days => r.min_days_overdue - 1) AND s.status NOT IN ('resolved','closed')
      AND (cardinality(r.priorities) = 0 OR lower(coalesce(s.priority, '')) = ANY (r.priorities))
  ) q
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Queue every email one rule produces for p_day. p_only: when set (preview),
-- everything goes to that single profile instead, marked as a preview.
CREATE OR REPLACE FUNCTION _run_alert_rule(r email_alert_rules, p_day DATE, p_tz TEXT, p_only UUID DEFAULT NULL)
RETURNS INT AS $$
DECLARE v_count INT := 0; u RECORD; m RECORD; me profiles; v_items JSONB; v_all JSONB := '[]'::jsonb;
        v_base JSONB; v_to_id UUID; v_to_email TEXT; v_to_name TEXT; v_key TEXT;
BEGIN
  IF p_only IS NOT NULL THEN SELECT * INTO me FROM profiles WHERE id = p_only; END IF;
  v_base := jsonb_strip_nulls(jsonb_build_object('rule_id', r.id, 'rule_name', r.name, 'date', p_day, 'cutoff', to_char(r.send_time, 'HH24:MI'),
              'subject', r.custom_subject, 'message', r.custom_message, 'preview', CASE WHEN p_only IS NOT NULL THEN true END,
              'min_days', r.min_days_overdue));

  IF r.alert_type = 'checkin_missing' THEN
    -- Each person
    IF r.send_to_person THEN
      FOR u IN SELECT * FROM _missing_checkins(r, p_day, p_tz) LOOP
        v_to_id := COALESCE(me.id, u.id); v_to_email := COALESCE(me.email, u.email); v_to_name := COALESCE(me.full_name, u.full_name);
        INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload, dedupe_key)
        VALUES (r.organization_id, v_to_id, v_to_email, v_to_name, 'checkin_reminder', v_base || jsonb_build_object('for_name', u.full_name),
                CASE WHEN p_only IS NULL THEN 'alert:' || r.id || ':p:' || u.id || ':' || p_day END)
        ON CONFLICT (dedupe_key) DO NOTHING;
        v_count := v_count + 1;
        EXIT WHEN p_only IS NOT NULL; -- a preview shows one sample
      END LOOP;
    END IF;
    -- Each manager: their people
    IF r.send_to_manager THEN
      FOR m IN SELECT mg.id, mg.email, mg.full_name, jsonb_agg(jsonb_build_object('name', x.full_name, 'email', x.email) ORDER BY x.full_name) AS people
               FROM _missing_checkins(r, p_day, p_tz) x JOIN profiles mg ON mg.id = x.manager_id AND COALESCE(mg.is_active, true) AND mg.email IS NOT NULL
               GROUP BY mg.id, mg.email, mg.full_name LOOP
        INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload, dedupe_key)
        VALUES (r.organization_id, COALESCE(me.id, m.id), COALESCE(me.email, m.email), COALESCE(me.full_name, m.full_name), 'checkin_manager',
                v_base || jsonb_build_object('people', m.people, 'scope', 'team', 'for_name', m.full_name),
                CASE WHEN p_only IS NULL THEN 'alert:' || r.id || ':m:' || m.id || ':' || p_day END)
        ON CONFLICT (dedupe_key) DO NOTHING;
        v_count := v_count + 1;
        EXIT WHEN p_only IS NOT NULL;
      END LOOP;
    END IF;
    -- Named summary recipients: everyone missing
    IF cardinality(r.summary_to_ids) > 0 OR p_only IS NOT NULL THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name', x.full_name, 'email', x.email,
               'manager', (SELECT full_name FROM profiles WHERE id = x.manager_id)) ORDER BY x.full_name), '[]'::jsonb)
        INTO v_all FROM _missing_checkins(r, p_day, p_tz) x;
      FOR u IN SELECT p.id, p.email, p.full_name FROM profiles p
               WHERE (p_only IS NULL AND p.id = ANY (r.summary_to_ids) AND COALESCE(p.is_active, true) AND p.email IS NOT NULL)
                  OR (p_only IS NOT NULL AND p.id = p_only AND cardinality(r.summary_to_ids) > 0) LOOP
        INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload, dedupe_key)
        VALUES (r.organization_id, u.id, u.email, u.full_name, 'checkin_manager', v_base || jsonb_build_object('people', v_all, 'scope', 'organisation'),
                CASE WHEN p_only IS NULL THEN 'alert:' || r.id || ':s:' || u.id || ':' || p_day END)
        ON CONFLICT (dedupe_key) DO NOTHING;
        v_count := v_count + 1;
      END LOOP;
    END IF;

  ELSE -- overdue_work
    CREATE TEMP TABLE IF NOT EXISTS _ov (id UUID, email TEXT, full_name TEXT, manager_id UUID, items JSONB) ON COMMIT DROP;
    DELETE FROM _ov;
    INSERT INTO _ov SELECT a.id, a.email, a.full_name, a.manager_id, _overdue_items(r, a.id, p_day, now()) FROM _alert_audience(r) a;
    DELETE FROM _ov WHERE jsonb_array_length(items) = 0;
    -- Each person: their own list
    IF r.send_to_person THEN
      FOR u IN SELECT * FROM _ov WHERE p_only IS NULL OR id = p_only OR NOT EXISTS (SELECT 1 FROM _ov WHERE id = p_only) ORDER BY (id = p_only) DESC NULLS LAST LOOP
        INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload, dedupe_key)
        VALUES (r.organization_id, COALESCE(me.id, u.id), COALESCE(me.email, u.email), COALESCE(me.full_name, u.full_name), 'overdue_digest',
                v_base || jsonb_build_object('for_name', u.full_name, 'count', jsonb_array_length(u.items),
                  'items', (SELECT jsonb_agg(e) FROM (SELECT e FROM jsonb_array_elements(u.items) e LIMIT 50) z)),
                CASE WHEN p_only IS NULL THEN 'alert:' || r.id || ':p:' || u.id || ':' || p_day END)
        ON CONFLICT (dedupe_key) DO NOTHING;
        v_count := v_count + 1;
        EXIT WHEN p_only IS NOT NULL;
      END LOOP;
    END IF;
    -- Each manager: their people's overdue work
    IF r.send_to_manager THEN
      FOR m IN SELECT mg.id, mg.email, mg.full_name,
                      jsonb_agg(jsonb_build_object('name', o.full_name, 'count', jsonb_array_length(o.items),
                        'oldest', (SELECT max((e->>'days')::int) FROM jsonb_array_elements(o.items) e),
                        'items', (SELECT jsonb_agg(e) FROM (SELECT e FROM jsonb_array_elements(o.items) e LIMIT 5) z)) ORDER BY o.full_name) AS people
               FROM _ov o JOIN profiles mg ON mg.id = o.manager_id AND COALESCE(mg.is_active, true) AND mg.email IS NOT NULL
               GROUP BY mg.id, mg.email, mg.full_name LOOP
        INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload, dedupe_key)
        VALUES (r.organization_id, COALESCE(me.id, m.id), COALESCE(me.email, m.email), COALESCE(me.full_name, m.full_name), 'overdue_manager',
                v_base || jsonb_build_object('people', m.people, 'scope', 'team', 'for_name', m.full_name),
                CASE WHEN p_only IS NULL THEN 'alert:' || r.id || ':m:' || m.id || ':' || p_day END)
        ON CONFLICT (dedupe_key) DO NOTHING;
        v_count := v_count + 1;
        EXIT WHEN p_only IS NOT NULL;
      END LOOP;
    END IF;
    -- Named summary recipients: everyone with overdue work
    IF cardinality(r.summary_to_ids) > 0 THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name', o.full_name, 'count', jsonb_array_length(o.items),
               'oldest', (SELECT max((e->>'days')::int) FROM jsonb_array_elements(o.items) e),
               'manager', (SELECT full_name FROM profiles WHERE id = o.manager_id),
               'items', (SELECT jsonb_agg(e) FROM (SELECT e FROM jsonb_array_elements(o.items) e LIMIT 5) z)) ORDER BY jsonb_array_length(o.items) DESC, o.full_name), '[]'::jsonb)
        INTO v_all FROM _ov o;
      FOR u IN SELECT p.id, p.email, p.full_name FROM profiles p
               WHERE (p_only IS NULL AND p.id = ANY (r.summary_to_ids) AND COALESCE(p.is_active, true) AND p.email IS NOT NULL)
                  OR (p_only IS NOT NULL AND p.id = p_only) LOOP
        INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload, dedupe_key)
        VALUES (r.organization_id, u.id, u.email, u.full_name, 'overdue_manager', v_base || jsonb_build_object('people', v_all, 'scope', 'organisation'),
                CASE WHEN p_only IS NULL THEN 'alert:' || r.id || ':s:' || u.id || ':' || p_day END)
        ON CONFLICT (dedupe_key) DO NOTHING;
        v_count := v_count + 1;
      END LOOP;
    END IF;
  END IF;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION enqueue_alert_emails() RETURNS INT AS $$
DECLARE r email_alert_rules; v_tz TEXT; v_local TIMESTAMP; v_day DATE; v_count INT := 0;
BEGIN
  PERFORM _email_worker_guard();
  FOR r IN SELECT a.* FROM email_alert_rules a JOIN org_email_settings s ON s.organization_id = a.organization_id AND s.enabled WHERE a.enabled LOOP
    SELECT COALESCE(timezone, 'Asia/Kolkata') INTO v_tz FROM org_email_settings WHERE organization_id = r.organization_id;
    v_local := now() AT TIME ZONE v_tz;
    v_day := v_local::date;
    CONTINUE WHEN r.last_run_on = v_day;
    CONTINUE WHEN v_local < v_day + r.send_time OR v_local >= v_day + r.send_time + interval '59 minutes';
    CONTINUE WHEN NOT (EXTRACT(DOW FROM v_local)::smallint = ANY (r.days_of_week));
    CONTINUE WHEN r.skip_holidays AND EXISTS (SELECT 1 FROM holidays h WHERE h.holiday_date = v_day
                                               AND (h.organization_id IS NULL OR h.organization_id = r.organization_id));
    v_count := v_count + _run_alert_rule(r, v_day, v_tz, NULL);
    UPDATE email_alert_rules SET last_run_on = v_day WHERE id = r.id;
  END LOOP;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION enqueue_alert_emails() TO service_role;

-- "Preview" in Settings: run a rule right now, but deliver everything it
-- would produce (one sample of each kind) to the caller only.
CREATE OR REPLACE FUNCTION request_alert_preview(p_rule_id UUID) RETURNS INT AS $$
DECLARE r email_alert_rules; v_tz TEXT;
BEGIN
  IF NOT is_org_alert_manager() THEN RAISE EXCEPTION 'Only admin, CEO or HR can preview alerts'; END IF;
  SELECT * INTO r FROM email_alert_rules WHERE id = p_rule_id AND organization_id = current_org_id();
  IF r.id IS NULL THEN RAISE EXCEPTION 'Alert rule not found'; END IF;
  IF (SELECT email FROM profiles WHERE id = auth.uid()) IS NULL THEN RAISE EXCEPTION 'Your profile has no email address'; END IF;
  SELECT COALESCE(timezone, 'Asia/Kolkata') INTO v_tz FROM org_email_settings WHERE organization_id = r.organization_id;
  v_tz := COALESCE(v_tz, 'Asia/Kolkata');
  RETURN _run_alert_rule(r, (now() AT TIME ZONE v_tz)::date, v_tz, auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION request_alert_preview(UUID) TO authenticated;

-- Tidy up the first (never-applied-live) draft of STEP231, if present.
DROP FUNCTION IF EXISTS request_alert_preview(TEXT);
DROP FUNCTION IF EXISTS _missing_checkins(UUID, DATE, TEXT, TIME);
DROP FUNCTION IF EXISTS _overdue_items(UUID, UUID, DATE, TIMESTAMPTZ);
ALTER TABLE org_email_settings DROP COLUMN IF EXISTS checkin_reminder_enabled, DROP COLUMN IF EXISTS checkin_reminder_time,
  DROP COLUMN IF EXISTS checkin_notify_manager, DROP COLUMN IF EXISTS alerts_weekdays_only, DROP COLUMN IF EXISTS overdue_digest_enabled,
  DROP COLUMN IF EXISTS overdue_digest_time, DROP COLUMN IF EXISTS last_checkin_reminder_on, DROP COLUMN IF EXISTS last_overdue_digest_on;

NOTIFY pgrst, 'reload schema';
