-- STEP257 — Go-Live report email designs + in-app preview
--
-- The report email now comes in three designs (rendered by
-- supabase/functions/_shared/goLiveEmails.ts): 'brief' (default, clean one-screen
-- brief), 'detailed' (the full report) and 'plain' (text-style memo). The pick
-- lives in golive_engagements.config.report_email.template and is chosen in
-- Share Report → Daily report email, which shows a live preview.
--
--   _golive_queue_report       adds payload.template (scheduled + manual sends)
--   send_golive_report_email   + p_template: send one copy in a specific design
--                              (the preview's "Send this design to me")
--   golive_report_email_preview(eng, date, customer)   the payload behind the
--                              preview — same data the email gets
--
-- Requires STEP255, STEP256. Safe to re-run.

CREATE OR REPLACE FUNCTION _golive_queue_report(g golive_engagements, p_date DATE, p_rcpt JSONB, p_kind TEXT, p_by UUID, p_extra JSONB DEFAULT '{}')
RETURNS INT AS $$
DECLARE
  v_full JSONB; v_cust JSONB; v_ext_full BOOLEAN := COALESCE(g.config->'report_email'->>'external_view', 'CUSTOMER') = 'FULL';
  r JSONB; v_n INT := 0; v_emails TEXT[] := '{}';
BEGIN
  -- STEP257: the email design (an explicit one in p_extra wins, e.g. a preview send)
  p_extra := jsonb_build_object('template', COALESCE(NULLIF(g.config->'report_email'->>'template', ''), 'brief')) || COALESCE(p_extra, '{}');
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

DROP FUNCTION IF EXISTS send_golive_report_email(UUID, DATE, TEXT, TEXT[]);
CREATE OR REPLACE FUNCTION send_golive_report_email(p_eng UUID, p_date DATE DEFAULT NULL, p_mode TEXT DEFAULT 'ME', p_emails TEXT[] DEFAULT NULL, p_template TEXT DEFAULT NULL)
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

  v_n := _golive_queue_report(g, v_date, v_rcpt, 'MANUAL', auth.uid(), jsonb_build_object('manual', true, 'sent_by', me.full_name)
    || CASE WHEN p_template IN ('brief', 'detailed', 'plain') THEN jsonb_build_object('template', p_template) ELSE '{}'::jsonb END);
  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION golive_report_email_preview(p_eng UUID, p_date DATE DEFAULT NULL, p_customer BOOLEAN DEFAULT false) RETURNS JSONB AS $$
DECLARE g golive_engagements;
BEGIN
  SELECT * INTO g FROM golive_engagements WHERE id = p_eng AND deleted_at IS NULL;
  IF NOT FOUND OR g.organization_id <> current_org_id() THEN RAISE EXCEPTION 'Engagement not found'; END IF;
  IF NOT golive_on_engagement(g.id) AND NOT golive_can_manage(g.id) THEN RAISE EXCEPTION 'You are not on this engagement'; END IF;
  RETURN golive_overview_payload(g.id, LEAST(COALESCE(p_date, golive_ist_today()), golive_ist_today()), p_customer);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION _golive_queue_report(golive_engagements, DATE, JSONB, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION send_golive_report_email(UUID, DATE, TEXT, TEXT[], TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION send_golive_report_email(UUID, DATE, TEXT, TEXT[], TEXT) TO authenticated;
REVOKE ALL ON FUNCTION golive_report_email_preview(UUID, DATE, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION golive_report_email_preview(UUID, DATE, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';
