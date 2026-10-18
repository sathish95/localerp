-- STEP256 — Go-Live report email (scheduled + manual)
--
-- One recipient list per engagement, kept in the Go-Live tracker
-- (Share Report tab → "Report email"). The email body is the complete
-- report: executive overview + the day's summary (STEP255 payloads), rendered
-- by send-email → _shared/goLiveEmails.ts (outbox template 'golive_daily').
--
-- Settings: golive_engagements.config.report_email
--   { "enabled": false, "send_time": "19:00", "report_day": "TODAY" | "YESTERDAY",
--     "to_pm": true, "to_roster": true, "user_ids": [], "emails": [],
--     "external_view": "CUSTOMER" | "FULL" }
-- People in the app get the full (internal) report. Addresses typed into
-- "emails" are external: they get the customer-safe version unless
-- external_view = 'FULL'.
--
--   golive_report_recipients(eng)          resolved list (id NULL = external address)
--   enqueue_golive_report_emails()         send-email worker, every minute: once per
--                                          engagement per day after send_time (IST)
--   send_golive_report_email(eng, date, mode, emails)   manual send:
--       mode 'ME'   → just me (full view)
--       mode 'ALL'  → the saved list
--       mode 'LIST' → the given addresses only (external view rules apply)
--   golive_report_email_log                every send, scheduled or manual
--
-- Needs STEP228 (email service) and STEP255. Safe to re-run.

/* ═══ 1. Outbox template ═══ */
ALTER TABLE email_outbox DROP CONSTRAINT IF EXISTS email_outbox_template_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_template_check CHECK (template IN (
  'notification','digest','team_report','welcome','invite','test',
  'checkin_reminder','checkin_manager','overdue_digest','overdue_manager','announcement','event',
  'golive_daily'));

/* ═══ 2. Send history ═══ */
CREATE TABLE IF NOT EXISTS golive_report_email_log (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL,
  engagement_id   UUID        NOT NULL,
  report_date     DATE        NOT NULL,
  kind            TEXT        NOT NULL CHECK (kind IN ('SCHEDULED','MANUAL')),
  recipients      INT         NOT NULL DEFAULT 0,
  emails          TEXT[]      NOT NULL DEFAULT '{}',
  sent_by         UUID,
  created_at      TIMESTAMPTZ DEFAULT now()
);
-- the schedule fires once per engagement per day
CREATE UNIQUE INDEX IF NOT EXISTS golive_report_email_log_sched ON golive_report_email_log (engagement_id, report_date) WHERE kind = 'SCHEDULED';
CREATE INDEX IF NOT EXISTS golive_report_email_log_eng ON golive_report_email_log (engagement_id, created_at DESC);
ALTER TABLE golive_report_email_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS golive_report_email_log_select ON golive_report_email_log;
CREATE POLICY golive_report_email_log_select ON golive_report_email_log FOR SELECT USING (organization_id = current_org_id());
GRANT SELECT ON public.golive_report_email_log TO authenticated;

/* ═══ 3. Recipients ═══ */
CREATE OR REPLACE FUNCTION golive_report_recipients(p_eng UUID)
RETURNS TABLE (id UUID, email TEXT, full_name TEXT) AS $$
  WITH g AS (SELECT e.*, COALESCE(e.config->'report_email', '{}'::jsonb) AS re FROM golive_engagements e WHERE e.id = p_eng),
  ids AS (
    SELECT g.pm_user_id AS uid FROM g WHERE COALESCE((g.re->>'to_pm')::boolean, true)
    UNION SELECT r.primary_user_id FROM golive_roster r, g
      WHERE r.engagement_id = g.id AND COALESCE((g.re->>'to_roster')::boolean, true)
        AND r.deleted_at IS NULL AND r.effective_to IS NULL AND r.effective_from <= golive_ist_today()
    UNION SELECT r.backup_user_id FROM golive_roster r, g
      WHERE r.engagement_id = g.id AND COALESCE((g.re->>'to_roster')::boolean, true)
        AND r.deleted_at IS NULL AND r.effective_to IS NULL AND r.effective_from <= golive_ist_today()
    UNION SELECT (u.v)::uuid FROM g, jsonb_array_elements_text(COALESCE(g.re->'user_ids', '[]')) u(v)
  ),
  people AS (
    SELECT p.id, lower(trim(p.email)) AS email, p.full_name FROM profiles p, g
    WHERE p.id IN (SELECT uid FROM ids WHERE uid IS NOT NULL) AND p.organization_id = g.organization_id
      AND COALESCE(p.is_active, true) AND NULLIF(trim(p.email), '') IS NOT NULL
  ),
  extra AS (
    SELECT NULL::uuid AS id, lower(trim(x.v)) AS email, NULL::text AS full_name
    FROM g, jsonb_array_elements_text(COALESCE(g.re->'emails', '[]')) x(v)
    WHERE trim(x.v) ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  )
  -- an address that belongs to a person in the app counts as that person (full view)
  SELECT DISTINCT ON (email) id, email, full_name FROM (SELECT * FROM people UNION ALL SELECT * FROM extra) a
  ORDER BY email, id NULLS LAST
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Queue one report to a list of recipients; internal people get the full
-- view, external addresses the customer view unless external_view = FULL.
CREATE OR REPLACE FUNCTION _golive_queue_report(g golive_engagements, p_date DATE, p_rcpt JSONB, p_kind TEXT, p_by UUID, p_extra JSONB DEFAULT '{}')
RETURNS INT AS $$
DECLARE
  v_full JSONB; v_cust JSONB; v_ext_full BOOLEAN := COALESCE(g.config->'report_email'->>'external_view', 'CUSTOMER') = 'FULL';
  r JSONB; v_n INT := 0; v_emails TEXT[] := '{}';
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(p_rcpt) LOOP
    IF (r->>'id') IS NOT NULL OR v_ext_full THEN
      v_full := COALESCE(v_full, golive_overview_payload(g.id, p_date, false) || p_extra);
    ELSE
      v_cust := COALESCE(v_cust, golive_overview_payload(g.id, p_date, true) || p_extra);
    END IF;
    INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload, dedupe_key)
    VALUES (g.organization_id, (r->>'id')::uuid, r->>'email', r->>'full_name', 'golive_daily',
      CASE WHEN (r->>'id') IS NOT NULL OR v_ext_full THEN v_full ELSE v_cust END,
      CASE WHEN p_kind = 'SCHEDULED' THEN 'glr:' || g.id || ':' || p_date || ':' || (r->>'email') END)
    ON CONFLICT (dedupe_key) DO NOTHING;
    IF FOUND THEN v_n := v_n + 1; v_emails := v_emails || (r->>'email'); END IF;
  END LOOP;
  INSERT INTO golive_report_email_log (organization_id, engagement_id, report_date, kind, recipients, emails, sent_by)
  VALUES (g.organization_id, g.id, p_date, p_kind, v_n, v_emails, p_by)
  ON CONFLICT DO NOTHING;
  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

/* ═══ 4. Schedule (send-email worker, every minute) ═══ */
CREATE OR REPLACE FUNCTION enqueue_golive_report_emails() RETURNS INT AS $$
DECLARE
  g golive_engagements; v_today DATE := golive_ist_today(); v_now TIME := (now() AT TIME ZONE 'Asia/Kolkata')::time;
  v_date DATE; v_total INT := 0;
BEGIN
  FOR g IN
    SELECT e.* FROM golive_engagements e
    WHERE e.status IN ('ACTIVE','EXIT_REVIEW') AND e.deleted_at IS NULL
      AND COALESCE((e.config->'report_email'->>'enabled')::boolean, false)
      AND (e.hypercare_start IS NULL OR e.hypercare_start <= v_today)
      AND v_now >= COALESCE(NULLIF(e.config->'report_email'->>'send_time', ''), '19:00')::time
      AND org_email_enabled(e.organization_id)
  LOOP
    v_date := CASE WHEN g.config->'report_email'->>'report_day' = 'YESTERDAY' THEN v_today - 1 ELSE v_today END;
    CONTINUE WHEN EXISTS (SELECT 1 FROM golive_report_email_log l WHERE l.engagement_id = g.id AND l.report_date = v_date AND l.kind = 'SCHEDULED');
    BEGIN
      v_total := v_total + _golive_queue_report(g, v_date,
        (SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]') FROM golive_report_recipients(g.id) r), 'SCHEDULED', NULL);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'golive report email % failed: %', g.code, SQLERRM;  -- one bad engagement mustn't block the rest
    END;
  END LOOP;
  RETURN v_total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

/* ═══ 5. Manual send ═══ */
CREATE OR REPLACE FUNCTION send_golive_report_email(p_eng UUID, p_date DATE DEFAULT NULL, p_mode TEXT DEFAULT 'ME', p_emails TEXT[] DEFAULT NULL)
RETURNS INT AS $$
DECLARE
  g golive_engagements; me profiles; v_date DATE := LEAST(COALESCE(p_date, golive_ist_today()), golive_ist_today());
  v_rcpt JSONB; v_n INT;
BEGIN
  SELECT * INTO g FROM golive_engagements WHERE id = p_eng AND deleted_at IS NULL;
  IF NOT FOUND OR g.organization_id <> current_org_id() THEN RAISE EXCEPTION 'Engagement not found'; END IF;
  IF NOT org_email_enabled(g.organization_id) THEN
    RAISE EXCEPTION 'Email is switched off for your organisation — turn it on in Settings → Email first';
  END IF;
  SELECT * INTO me FROM profiles WHERE id = auth.uid();

  IF p_mode = 'ME' THEN
    IF NOT golive_on_engagement(g.id) AND NOT golive_can_manage(g.id) THEN RAISE EXCEPTION 'You are not on this engagement'; END IF;
    IF NULLIF(trim(me.email), '') IS NULL THEN RAISE EXCEPTION 'Your profile has no email address'; END IF;
    v_rcpt := jsonb_build_array(jsonb_build_object('id', me.id, 'email', lower(trim(me.email)), 'full_name', me.full_name));
  ELSIF p_mode IN ('ALL', 'LIST') THEN
    IF NOT golive_can_manage(g.id) THEN RAISE EXCEPTION 'Only the engagement PM / managers can send the report to others'; END IF;
    IF p_mode = 'ALL' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]') INTO v_rcpt FROM golive_report_recipients(g.id) r;
    ELSE
      -- typed addresses: someone in the org is treated as internal, anyone else as external
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'email', x.e, 'full_name', p.full_name)), '[]') INTO v_rcpt
      FROM (SELECT DISTINCT lower(trim(v)) AS e FROM unnest(COALESCE(p_emails, '{}')) v WHERE trim(v) ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') x
      LEFT JOIN profiles p ON lower(trim(p.email)) = x.e AND p.organization_id = g.organization_id AND COALESCE(p.is_active, true);
    END IF;
    IF jsonb_array_length(v_rcpt) = 0 THEN RAISE EXCEPTION 'No valid recipients — add email addresses first'; END IF;
  ELSE
    RAISE EXCEPTION 'Unknown mode %', p_mode;
  END IF;

  v_n := _golive_queue_report(g, v_date, v_rcpt, 'MANUAL', auth.uid(), jsonb_build_object('manual', true, 'sent_by', me.full_name));
  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Recipient / queue / job functions take any engagement id: service role only.
REVOKE ALL ON FUNCTION golive_report_recipients(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _golive_queue_report(golive_engagements, DATE, JSONB, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION enqueue_golive_report_emails() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION golive_report_recipients(UUID), enqueue_golive_report_emails() TO service_role;
REVOKE ALL ON FUNCTION send_golive_report_email(UUID, DATE, TEXT, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION send_golive_report_email(UUID, DATE, TEXT, TEXT[]) TO authenticated;

-- Resolved recipients for the settings panel (people in the app only see
-- their own org's engagements).
CREATE OR REPLACE FUNCTION golive_report_recipient_preview(p_eng UUID)
RETURNS TABLE (id UUID, email TEXT, full_name TEXT) AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM golive_engagements WHERE id = p_eng AND organization_id = current_org_id()) THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM golive_report_recipients(p_eng);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION golive_report_recipient_preview(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION golive_report_recipient_preview(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
