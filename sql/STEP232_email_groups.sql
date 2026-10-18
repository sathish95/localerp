-- ============================================================
-- STEP232: Email groups — reusable recipient / audience lists for
-- automatic alerts (STEP231) and scheduled reports (STEP228–230).
--
-- A group's members are the union of:
--   member_ids      specific people
--   role_keys       everyone with these roles
--   department_ids  everyone in these departments
--   team_ids        members + lead of these Teams (Settings → Teams)
--   extra_emails    outside addresses with no login (reports / summaries only)
-- Resolved at send time, so a new hire in a chosen department or role is
-- included automatically; deactivated people never are.
--
-- Used by:
--   email_alert_rules.audience_mode = 'groups' + group_ids   (who a rule covers)
--   email_alert_rules.summary_group_ids                       (who gets the summary)
--   email_report_schedules.recipient_group_ids                (report recipients)
-- Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS email_groups (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  name            TEXT        NOT NULL,
  description     TEXT,
  member_ids      UUID[]      NOT NULL DEFAULT '{}',
  role_keys       TEXT[]      NOT NULL DEFAULT '{}',
  department_ids  UUID[]      NOT NULL DEFAULT '{}',
  team_ids        UUID[]      NOT NULL DEFAULT '{}',
  extra_emails    TEXT[]      NOT NULL DEFAULT '{}',
  created_by      UUID,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, name)
);
ALTER TABLE email_groups ENABLE ROW LEVEL SECURITY;
-- Anyone who manages alerts or reports can use and edit groups.
DROP POLICY IF EXISTS email_groups_rw ON email_groups;
CREATE POLICY email_groups_rw ON email_groups FOR ALL
  USING (organization_id = current_org_id() AND (is_org_report_manager() OR is_org_alert_manager()))
  WITH CHECK (organization_id = current_org_id() AND (is_org_report_manager() OR is_org_alert_manager()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_groups TO authenticated;

ALTER TABLE email_alert_rules ADD COLUMN IF NOT EXISTS group_ids         UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE email_alert_rules ADD COLUMN IF NOT EXISTS summary_group_ids UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE email_alert_rules DROP CONSTRAINT IF EXISTS email_alert_rules_audience_mode_check;
ALTER TABLE email_alert_rules ADD CONSTRAINT email_alert_rules_audience_mode_check
  CHECK (audience_mode IN ('all','departments','roles','people','groups'));
ALTER TABLE email_report_schedules ADD COLUMN IF NOT EXISTS recipient_group_ids UUID[] NOT NULL DEFAULT '{}';

-- Active people in any of p_groups (org-scoped).
CREATE OR REPLACE FUNCTION _group_profile_ids(p_org UUID, p_groups UUID[]) RETURNS SETOF UUID AS $$
  SELECT DISTINCT p.id
  FROM email_groups g
  JOIN profiles p ON p.organization_id = p_org AND COALESCE(p.is_active, true)
  WHERE g.organization_id = p_org AND g.id = ANY (p_groups)
    AND (p.id = ANY (g.member_ids)
         OR p.role = ANY (g.role_keys)
         OR p.department_id = ANY (g.department_ids)
         OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = ANY (g.team_ids) AND tm.person_id = p.id)
         OR EXISTS (SELECT 1 FROM teams t WHERE t.id = ANY (g.team_ids) AND t.lead_id = p.id))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Outside addresses of any of p_groups.
CREATE OR REPLACE FUNCTION _group_extra_emails(p_org UUID, p_groups UUID[]) RETURNS SETOF TEXT AS $$
  SELECT DISTINCT lower(trim(e)) FROM email_groups g, unnest(g.extra_emails) e
  WHERE g.organization_id = p_org AND g.id = ANY (p_groups) AND trim(e) <> ''
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Everyone who gets a rule's organisation-wide summary. In a preview
-- (p_only) it's just the caller, if the rule has any summary recipients.
CREATE OR REPLACE FUNCTION _summary_recipients(r email_alert_rules, p_only UUID)
RETURNS TABLE (id UUID, email TEXT, full_name TEXT) AS $$
  SELECT p.id, p.email, p.full_name FROM profiles p
  WHERE p_only IS NOT NULL AND p.id = p_only
    AND (cardinality(r.summary_to_ids) > 0 OR cardinality(r.summary_group_ids) > 0)
  UNION
  SELECT p.id, p.email, p.full_name FROM profiles p
  WHERE p_only IS NULL AND p.organization_id = r.organization_id AND COALESCE(p.is_active, true) AND p.email IS NOT NULL
    AND (p.id = ANY (r.summary_to_ids) OR p.id IN (SELECT _group_profile_ids(r.organization_id, r.summary_group_ids)))
  UNION
  SELECT NULL::uuid, e, NULL FROM _group_extra_emails(r.organization_id, r.summary_group_ids) e WHERE p_only IS NULL
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ── Updated from STEP231: audience_mode 'groups' ──
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
          WHEN 'groups'      THEN p.id IN (SELECT _group_profile_ids(r.organization_id, r.group_ids))
          ELSE true END
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ── Updated from STEP231: summaries go to people + groups (incl. outside addresses) ──
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
    IF cardinality(r.summary_to_ids) > 0 OR cardinality(r.summary_group_ids) > 0 THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name', x.full_name, 'email', x.email,
               'manager', (SELECT full_name FROM profiles WHERE id = x.manager_id)) ORDER BY x.full_name), '[]'::jsonb)
        INTO v_all FROM _missing_checkins(r, p_day, p_tz) x;
      FOR u IN SELECT * FROM _summary_recipients(r, p_only) LOOP
        INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload, dedupe_key)
        VALUES (r.organization_id, u.id, u.email, u.full_name, 'checkin_manager', v_base || jsonb_build_object('people', v_all, 'scope', 'organisation'),
                CASE WHEN p_only IS NULL THEN 'alert:' || r.id || ':s:' || COALESCE(u.id::text, u.email) || ':' || p_day END)
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
    IF cardinality(r.summary_to_ids) > 0 OR cardinality(r.summary_group_ids) > 0 THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name', o.full_name, 'count', jsonb_array_length(o.items),
               'oldest', (SELECT max((e->>'days')::int) FROM jsonb_array_elements(o.items) e),
               'manager', (SELECT full_name FROM profiles WHERE id = o.manager_id),
               'items', (SELECT jsonb_agg(e) FROM (SELECT e FROM jsonb_array_elements(o.items) e LIMIT 5) z)) ORDER BY jsonb_array_length(o.items) DESC, o.full_name), '[]'::jsonb)
        INTO v_all FROM _ov o;
      FOR u IN SELECT * FROM _summary_recipients(r, p_only) LOOP
        INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload, dedupe_key)
        VALUES (r.organization_id, u.id, u.email, u.full_name, 'overdue_manager', v_base || jsonb_build_object('people', v_all, 'scope', 'organisation'),
                CASE WHEN p_only IS NULL THEN 'alert:' || r.id || ':s:' || COALESCE(u.id::text, u.email) || ':' || p_day END)
        ON CONFLICT (dedupe_key) DO NOTHING;
        v_count := v_count + 1;
      END LOOP;
    END IF;
  END IF;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── Updated from STEP230: report recipients include groups ──
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
        WHERE (cardinality(sch.recipient_ids) = 0 AND cardinality(sch.recipient_group_ids) = 0)
           OR m.id = ANY(sch.recipient_ids)
           OR m.id IN (SELECT _group_profile_ids(sch.organization_id, sch.recipient_group_ids))
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
        WHERE p.email IS NOT NULL AND COALESCE(p.is_active, true) AND p.organization_id = sch.organization_id
          AND (p.id = ANY(sch.recipient_ids) OR p.id IN (SELECT _group_profile_ids(sch.organization_id, sch.recipient_group_ids)))
        UNION
        SELECT NULL::uuid, lower(trim(e)), NULL FROM unnest(sch.extra_emails) e WHERE trim(e) <> ''
        UNION
        SELECT NULL::uuid, g, NULL FROM _group_extra_emails(sch.organization_id, sch.recipient_group_ids) g
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

-- Group sizes for the Settings screen (resolved members, outside addresses).
CREATE OR REPLACE FUNCTION email_group_sizes() RETURNS TABLE (group_id UUID, people INT, outside INT) AS $$
  SELECT g.id,
         (SELECT count(*)::int FROM _group_profile_ids(g.organization_id, ARRAY[g.id])),
         cardinality(g.extra_emails)
  FROM email_groups g
  WHERE g.organization_id = current_org_id() AND (is_org_report_manager() OR is_org_alert_manager())
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION email_group_sizes() TO authenticated;

NOTIFY pgrst, 'reload schema';
