-- ============================================================
-- STEP228: Email service — outbox, per-org sender settings, per-user
-- preferences, scheduled report emails.
--
-- Same outbox pattern as STEP164 (push): nothing in a trigger talks to
-- the network. Triggers/RPCs only INSERT rows into email_outbox; the
-- `send-email` Edge Function (supabase/functions/send-email) runs every
-- minute, calls enqueue_email_digests() + enqueue_due_report_emails(),
-- then claims a batch, renders each template and sends it over SMTP with
-- Nodemailer.
--
-- Sender: one verified platform mailbox (SMTP_* secrets on the function);
-- each organization only sets its display name + reply-to here.
--
-- Safe to re-run.
-- ============================================================

/* ═══ Per-organization sender settings ═══ */
CREATE TABLE IF NOT EXISTS org_email_settings (
  organization_id UUID PRIMARY KEY DEFAULT current_org_id() REFERENCES organizations(id) ON DELETE CASCADE,
  enabled         BOOLEAN     NOT NULL DEFAULT false,
  from_name       TEXT,
  reply_to        TEXT,
  timezone        TEXT        NOT NULL DEFAULT 'Asia/Kolkata',
  footer_text     TEXT,
  updated_at      TIMESTAMPTZ DEFAULT now(),
  updated_by      UUID
);
ALTER TABLE org_email_settings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_org_email_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION is_org_report_manager() RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','hr'))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

DROP POLICY IF EXISTS org_email_settings_select ON org_email_settings;
DROP POLICY IF EXISTS org_email_settings_write  ON org_email_settings;
CREATE POLICY org_email_settings_select ON org_email_settings FOR SELECT
  USING (organization_id = current_org_id() OR is_platform_super_admin());
CREATE POLICY org_email_settings_write ON org_email_settings FOR ALL
  USING (organization_id = current_org_id() AND is_org_email_admin())
  WITH CHECK (organization_id = current_org_id() AND is_org_email_admin());
GRANT SELECT, INSERT, UPDATE ON public.org_email_settings TO authenticated;

/* ═══ Per-user preferences ═══ */
-- mode: instant = one email per notification, digest = one summary a day
-- at digest_hour (org timezone), off = no notification emails.
-- muted_categories: see email_notification_category() below.
CREATE TABLE IF NOT EXISTS email_preferences (
  user_id          UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  organization_id  UUID NOT NULL DEFAULT current_org_id(),
  mode             TEXT NOT NULL DEFAULT 'instant' CHECK (mode IN ('instant','digest','off')),
  muted_categories TEXT[] NOT NULL DEFAULT ARRAY['checkin','chat'],
  digest_hour      SMALLINT NOT NULL DEFAULT 18 CHECK (digest_hour BETWEEN 0 AND 23),
  last_digest_at   TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE email_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_preferences_own ON email_preferences;
CREATE POLICY email_preferences_own ON email_preferences FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
GRANT SELECT, INSERT, UPDATE ON public.email_preferences TO authenticated;

-- Notification type → preference category. The web UI
-- (src/lib/email.js EMAIL_CATEGORIES) uses the same keys.
CREATE OR REPLACE FUNCTION email_notification_category(p_type TEXT) RETURNS TEXT AS $$
  SELECT CASE
    WHEN p_type IN ('checkin','checkout') THEN 'checkin'
    WHEN p_type LIKE 'chat%' OR p_type LIKE 'wiki_%' OR p_type LIKE '%mention%' THEN 'chat'
    WHEN p_type LIKE 'task%' OR p_type LIKE '%_task' OR p_type LIKE 'sprint%' OR p_type LIKE 'story%' THEN 'tasks'
    WHEN p_type LIKE 'timesheet%' OR p_type LIKE '%approv%' OR p_type LIKE '%reject%' OR p_type LIKE '%_submitted'
      OR p_type LIKE 'expense%' OR p_type LIKE 'leave%' OR p_type LIKE 'procurement%' OR p_type LIKE 'travel%' THEN 'approvals'
    WHEN p_type LIKE 'sales%' OR p_type LIKE 'lead%' OR p_type LIKE 'opportunit%' OR p_type LIKE 'tender%' THEN 'sales'
    WHEN p_type IN ('broadcast','system','announcement') THEN 'announcements'
    ELSE 'other'
  END
$$ LANGUAGE sql IMMUTABLE;

/* ═══ Scheduled report emails ═══ */
CREATE TABLE IF NOT EXISTS email_report_schedules (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  name            TEXT        NOT NULL,
  report_type     TEXT        NOT NULL DEFAULT 'team_performance' CHECK (report_type IN ('team_performance')),
  period          TEXT        NOT NULL DEFAULT 'daily' CHECK (period IN ('daily','weekly','monthly')),
  send_hour       SMALLINT    NOT NULL DEFAULT 19 CHECK (send_hour BETWEEN 0 AND 23),
  send_weekday    SMALLINT    CHECK (send_weekday BETWEEN 0 AND 6),   -- weekly: 0=Sun … 6=Sat
  send_monthday   SMALLINT    CHECK (send_monthday BETWEEN 1 AND 28), -- monthly
  weekdays_only   BOOLEAN     NOT NULL DEFAULT true,                  -- daily: skip Sat/Sun
  department_id   UUID,                                               -- soft ref; null = whole org
  recipient_ids   UUID[]      NOT NULL DEFAULT '{}',
  extra_emails    TEXT[]      NOT NULL DEFAULT '{}',
  enabled         BOOLEAN     NOT NULL DEFAULT true,
  last_sent_on    DATE,
  created_by      UUID,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_report_schedules_org_idx ON email_report_schedules(organization_id);
ALTER TABLE email_report_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_report_schedules_rw ON email_report_schedules;
CREATE POLICY email_report_schedules_rw ON email_report_schedules FOR ALL
  USING (organization_id = current_org_id() AND is_org_report_manager())
  WITH CHECK (organization_id = current_org_id() AND is_org_report_manager());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_report_schedules TO authenticated;

/* ═══ Outbox ═══ */
CREATE TABLE IF NOT EXISTS email_outbox (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL,
  recipient_id    UUID,                 -- soft ref, null for external addresses
  to_email        TEXT        NOT NULL,
  to_name         TEXT,
  template        TEXT        NOT NULL CHECK (template IN ('notification','digest','team_report','welcome','invite','test')),
  payload         JSONB       NOT NULL DEFAULT '{}',
  subject         TEXT,                 -- filled in by the worker once rendered (for the log)
  status          TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed')),
  attempts        INT         NOT NULL DEFAULT 0,
  last_error      TEXT,
  dedupe_key      TEXT        UNIQUE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  claimed_at      TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS email_outbox_pending_idx ON email_outbox(created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS email_outbox_org_idx ON email_outbox(organization_id, created_at DESC);
ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
-- Read-only delivery log for org admins; payload is never exposed (the
-- welcome template can carry a temporary password until it's sent).
DROP POLICY IF EXISTS email_outbox_select ON email_outbox;
CREATE POLICY email_outbox_select ON email_outbox FOR SELECT
  USING ((organization_id = current_org_id() AND is_org_email_admin()) OR is_platform_super_admin());
REVOKE ALL ON public.email_outbox FROM authenticated;
GRANT SELECT (id, organization_id, recipient_id, to_email, to_name, template, subject, status, attempts, last_error, created_at, sent_at)
  ON public.email_outbox TO authenticated;

-- Internal: org email switched on?
CREATE OR REPLACE FUNCTION org_email_enabled(p_org UUID) RETURNS BOOLEAN AS $$
  SELECT COALESCE((SELECT enabled FROM org_email_settings WHERE organization_id = p_org), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

/* ═══ Trigger: notification → instant email ═══ */
CREATE OR REPLACE FUNCTION enqueue_email_for_notification() RETURNS TRIGGER AS $$
DECLARE
  v_email TEXT; v_name TEXT; v_active BOOLEAN;
  v_mode TEXT; v_muted TEXT[]; v_sender TEXT;
BEGIN
  BEGIN
    IF NOT org_email_enabled(NEW.organization_id) THEN RETURN NEW; END IF;
    SELECT email, full_name, COALESCE(is_active, true) INTO v_email, v_name, v_active FROM profiles WHERE id = NEW.recipient_id;
    IF v_email IS NULL OR NOT v_active THEN RETURN NEW; END IF;
    SELECT mode, muted_categories INTO v_mode, v_muted FROM email_preferences WHERE user_id = NEW.recipient_id;
    v_mode  := COALESCE(v_mode, 'instant');
    v_muted := COALESCE(v_muted, ARRAY['checkin','chat']);
    IF v_mode <> 'instant' OR email_notification_category(NEW.type) = ANY(v_muted) THEN RETURN NEW; END IF;
    IF NEW.sender_id IS NOT NULL THEN SELECT full_name INTO v_sender FROM profiles WHERE id = NEW.sender_id; END IF;

    INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload, dedupe_key)
    VALUES (NEW.organization_id, NEW.recipient_id, v_email, v_name, 'notification',
      jsonb_build_object('title', NEW.title, 'body', NEW.body, 'link', NEW.link, 'type', NEW.type,
                         'category', email_notification_category(NEW.type), 'sender', v_sender, 'created_at', NEW.created_at),
      'notif:' || NEW.id)
    ON CONFLICT (dedupe_key) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- email is best-effort; the in-app notification already succeeded
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS notifications_enqueue_email ON notifications;
CREATE TRIGGER notifications_enqueue_email AFTER INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION enqueue_email_for_notification();

/* ═══ Worker-side RPCs (service role only) ═══ */
CREATE OR REPLACE FUNCTION _email_worker_guard() RETURNS VOID AS $$
BEGIN
  IF auth.role() <> 'service_role' AND NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Daily digests: for every digest-mode user whose org-local hour is their
-- digest_hour and who hasn't had one in the last 20h, bundle the
-- notifications since their previous digest (unmuted categories only).
CREATE OR REPLACE FUNCTION enqueue_email_digests() RETURNS INT AS $$
DECLARE r RECORD; v_items JSONB; v_count INT := 0; v_since TIMESTAMPTZ;
BEGIN
  PERFORM _email_worker_guard();
  FOR r IN
    SELECT ep.user_id, ep.organization_id, ep.muted_categories, ep.last_digest_at, p.email, p.full_name,
           COALESCE(s.timezone, 'Asia/Kolkata') AS tz
    FROM email_preferences ep
    JOIN profiles p ON p.id = ep.user_id AND COALESCE(p.is_active, true) AND p.email IS NOT NULL
    JOIN org_email_settings s ON s.organization_id = ep.organization_id AND s.enabled
    WHERE ep.mode = 'digest'
      AND EXTRACT(HOUR FROM now() AT TIME ZONE COALESCE(s.timezone, 'Asia/Kolkata')) = ep.digest_hour
      AND (ep.last_digest_at IS NULL OR ep.last_digest_at < now() - interval '20 hours')
  LOOP
    v_since := COALESCE(r.last_digest_at, now() - interval '1 day');
    SELECT jsonb_agg(jsonb_build_object('title', n.title, 'body', n.body, 'link', n.link, 'type', n.type,
                                        'category', email_notification_category(n.type), 'created_at', n.created_at,
                                        'read', n.read_at IS NOT NULL) ORDER BY n.created_at DESC)
      INTO v_items
    FROM (SELECT * FROM notifications
          WHERE recipient_id = r.user_id AND created_at > v_since
            AND NOT (email_notification_category(type) = ANY(r.muted_categories))
          ORDER BY created_at DESC LIMIT 50) n;

    UPDATE email_preferences SET last_digest_at = now() WHERE user_id = r.user_id;
    IF v_items IS NOT NULL THEN
      INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload, dedupe_key)
      VALUES (r.organization_id, r.user_id, r.email, r.full_name, 'digest',
              jsonb_build_object('items', v_items, 'since', v_since),
              'digest:' || r.user_id || ':' || to_char(now() AT TIME ZONE r.tz, 'YYYY-MM-DD'))
      ON CONFLICT (dedupe_key) DO NOTHING;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Report schedules due this hour (org-local) and not yet sent today:
-- one outbox row per recipient. The worker computes the report itself.
CREATE OR REPLACE FUNCTION enqueue_due_report_emails() RETURNS INT AS $$
DECLARE r RECORD; v_local TIMESTAMP; v_day DATE; v_count INT := 0; v_to RECORD;
BEGIN
  PERFORM _email_worker_guard();
  FOR r IN
    SELECT sch.*, COALESCE(s.timezone, 'Asia/Kolkata') AS tz
    FROM email_report_schedules sch
    JOIN org_email_settings s ON s.organization_id = sch.organization_id AND s.enabled
    WHERE sch.enabled
  LOOP
    v_local := now() AT TIME ZONE r.tz;
    v_day := v_local::date;
    CONTINUE WHEN EXTRACT(HOUR FROM v_local) <> r.send_hour;
    CONTINUE WHEN r.last_sent_on = v_day;
    CONTINUE WHEN r.period = 'daily'   AND r.weekdays_only AND EXTRACT(DOW FROM v_local) IN (0, 6);
    CONTINUE WHEN r.period = 'weekly'  AND EXTRACT(DOW FROM v_local) <> COALESCE(r.send_weekday, 5);
    CONTINUE WHEN r.period = 'monthly' AND EXTRACT(DAY FROM v_local) <> COALESCE(r.send_monthday, 1);

    FOR v_to IN
      SELECT p.id, p.email, p.full_name FROM profiles p
      WHERE p.id = ANY(r.recipient_ids) AND p.email IS NOT NULL AND COALESCE(p.is_active, true)
      UNION
      SELECT NULL::uuid, lower(trim(e)), NULL FROM unnest(r.extra_emails) e WHERE trim(e) <> ''
    LOOP
      INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload, dedupe_key)
      VALUES (r.organization_id, v_to.id, v_to.email, v_to.full_name, 'team_report',
              jsonb_build_object('schedule_id', r.id, 'name', r.name, 'period', r.period, 'department_id', r.department_id,
                                 'as_of', v_day, 'timezone', r.tz),
              'report:' || r.id || ':' || v_day || ':' || v_to.email)
      ON CONFLICT (dedupe_key) DO NOTHING;
      v_count := v_count + 1;
    END LOOP;
    UPDATE email_report_schedules SET last_sent_on = v_day WHERE id = r.id;
  END LOOP;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Claim a batch (FOR UPDATE SKIP LOCKED — concurrent runs never double-send).
-- Rows stuck in 'sending' for 10+ minutes (a crashed run) are re-claimed.
CREATE OR REPLACE FUNCTION claim_email_batch(p_limit INT DEFAULT 50)
RETURNS TABLE (id UUID, organization_id UUID, recipient_id UUID, to_email TEXT, to_name TEXT, template TEXT, payload JSONB,
               attempts INT, from_name TEXT, reply_to TEXT, footer_text TEXT, timezone TEXT, org_name TEXT) AS $$
BEGIN
  PERFORM _email_worker_guard();
  RETURN QUERY
  WITH c AS (
    SELECT o.id FROM email_outbox o
    WHERE (o.status = 'pending' OR (o.status = 'sending' AND o.claimed_at < now() - interval '10 minutes'))
      AND o.attempts < 5
    ORDER BY o.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ), u AS (
    UPDATE email_outbox o SET status = 'sending', claimed_at = now(), attempts = o.attempts + 1
    FROM c WHERE o.id = c.id
    RETURNING o.*
  )
  SELECT u.id, u.organization_id, u.recipient_id, u.to_email, u.to_name, u.template, u.payload, u.attempts,
         s.from_name, s.reply_to, s.footer_text, COALESCE(s.timezone, 'Asia/Kolkata'), org.name
  FROM u
  LEFT JOIN org_email_settings s ON s.organization_id = u.organization_id
  LEFT JOIN organizations org ON org.id = u.organization_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Record the outcome. Failures go back to 'pending' until 5 attempts,
-- then stay 'failed'. A sent welcome email has its temporary password
-- scrubbed from the payload.
CREATE OR REPLACE FUNCTION mark_email_result(p_id UUID, p_ok BOOLEAN, p_subject TEXT DEFAULT NULL, p_error TEXT DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
  PERFORM _email_worker_guard();
  UPDATE email_outbox SET
    status     = CASE WHEN p_ok THEN 'sent' WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
    sent_at    = CASE WHEN p_ok THEN now() ELSE sent_at END,
    subject    = COALESCE(p_subject, subject),
    last_error = CASE WHEN p_ok THEN NULL ELSE left(p_error, 1000) END,
    payload    = CASE WHEN p_ok THEN payload - 'temp_password' ELSE payload END
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION prune_email_outbox() RETURNS VOID AS $$
  DELETE FROM email_outbox WHERE status = 'sent' AND sent_at < now() - interval '30 days';
  UPDATE email_outbox SET payload = payload - 'temp_password' WHERE status = 'failed' AND payload ? 'temp_password';
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION enqueue_email_digests()                   TO service_role;
GRANT EXECUTE ON FUNCTION enqueue_due_report_emails()               TO service_role;
GRANT EXECUTE ON FUNCTION claim_email_batch(INT)                    TO service_role;
GRANT EXECUTE ON FUNCTION mark_email_result(UUID, BOOLEAN, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION prune_email_outbox()                      TO service_role;

/* ═══ App-side RPCs (authenticated) ═══ */

-- Settings → Email → "Send test email": to the caller's own address.
CREATE OR REPLACE FUNCTION request_test_email() RETURNS UUID AS $$
DECLARE v_id UUID; v_email TEXT; v_name TEXT;
BEGIN
  IF NOT is_org_email_admin() THEN RAISE EXCEPTION 'Only an admin can send a test email'; END IF;
  SELECT email, full_name INTO v_email, v_name FROM profiles WHERE id = auth.uid();
  IF v_email IS NULL THEN RAISE EXCEPTION 'Your profile has no email address'; END IF;
  INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload)
  VALUES (current_org_id(), auth.uid(), v_email, v_name, 'test', jsonb_build_object('requested_at', now()))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION request_test_email() TO authenticated;

-- "Send now" on a report schedule, delivered to the caller only (preview).
CREATE OR REPLACE FUNCTION request_report_preview(p_schedule_id UUID) RETURNS UUID AS $$
DECLARE v_id UUID; v_email TEXT; v_name TEXT; r email_report_schedules; v_tz TEXT;
BEGIN
  IF NOT is_org_report_manager() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT * INTO r FROM email_report_schedules WHERE id = p_schedule_id AND organization_id = current_org_id();
  IF r.id IS NULL THEN RAISE EXCEPTION 'Schedule not found'; END IF;
  SELECT email, full_name INTO v_email, v_name FROM profiles WHERE id = auth.uid();
  IF v_email IS NULL THEN RAISE EXCEPTION 'Your profile has no email address'; END IF;
  SELECT COALESCE(timezone, 'Asia/Kolkata') INTO v_tz FROM org_email_settings WHERE organization_id = r.organization_id;
  v_tz := COALESCE(v_tz, 'Asia/Kolkata');
  INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload)
  VALUES (r.organization_id, auth.uid(), v_email, v_name, 'team_report',
          jsonb_build_object('schedule_id', r.id, 'name', r.name, 'period', r.period, 'department_id', r.department_id,
                             'as_of', (now() AT TIME ZONE v_tz)::date, 'timezone', v_tz, 'preview', true))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION request_report_preview(UUID) TO authenticated;

-- Welcome email for a member an admin just created (Users page). The
-- temporary password is optional and scrubbed once the email is sent.
CREATE OR REPLACE FUNCTION send_welcome_email(p_user_id UUID, p_temp_password TEXT DEFAULT NULL) RETURNS UUID AS $$
DECLARE v_id UUID; p profiles; v_admin TEXT;
BEGIN
  IF NOT is_org_email_admin() THEN RAISE EXCEPTION 'Only an admin can send welcome emails'; END IF;
  SELECT * INTO p FROM profiles WHERE id = p_user_id;
  IF p.id IS NULL OR p.organization_id IS DISTINCT FROM current_org_id() THEN RAISE EXCEPTION 'User not found in your organization'; END IF;
  IF p.email IS NULL THEN RAISE EXCEPTION 'That user has no email address'; END IF;
  SELECT full_name INTO v_admin FROM profiles WHERE id = auth.uid();
  INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload)
  VALUES (p.organization_id, p.id, p.email, p.full_name, 'welcome',
          jsonb_strip_nulls(jsonb_build_object('invited_by', v_admin, 'role', p.role, 'temp_password', NULLIF(p_temp_password, ''))))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION send_welcome_email(UUID, TEXT) TO authenticated;

-- Email an existing invite code (Settings → Organization → invites).
CREATE OR REPLACE FUNCTION send_invite_email(p_invite_id UUID, p_email TEXT, p_name TEXT DEFAULT NULL) RETURNS UUID AS $$
DECLARE v_id UUID; v_code TEXT; v_role TEXT; v_exp TIMESTAMPTZ; v_org UUID; v_admin TEXT;
BEGIN
  IF NOT is_org_email_admin() THEN RAISE EXCEPTION 'Only an admin can email invites'; END IF;
  IF p_email IS NULL OR p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'Enter a valid email address'; END IF;
  SELECT code, role, expires_at, organization_id INTO v_code, v_role, v_exp, v_org
  FROM organization_invites WHERE id = p_invite_id AND NOT COALESCE(revoked, false);
  IF v_code IS NULL OR v_org IS DISTINCT FROM current_org_id() THEN RAISE EXCEPTION 'Invite not found or revoked'; END IF;
  SELECT full_name INTO v_admin FROM profiles WHERE id = auth.uid();
  INSERT INTO email_outbox (organization_id, to_email, to_name, template, payload)
  VALUES (v_org, lower(trim(p_email)), NULLIF(trim(p_name), ''), 'invite',
          jsonb_build_object('code', v_code, 'role', v_role, 'expires_at', v_exp, 'invited_by', v_admin))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION send_invite_email(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- AFTER RUNNING THIS (not SQL):
--  1. Function secrets (Dashboard → Edge Functions → Secrets, or CLI):
--       supabase secrets set SMTP_HOST=smtp.gmail.com SMTP_PORT=465 \
--         SMTP_USER=notifications@yourdomain.com SMTP_PASS=<app password> \
--         SMTP_FROM_EMAIL=notifications@yourdomain.com APP_URL=https://your-app-domain \
--         CRON_SECRET=<any long random string>
--     Port must be 465 (SSL). Supabase Edge Functions block outbound 25/587.
--  2. Deploy: supabase functions deploy send-email --no-verify-jwt
--     (the function checks CRON_SECRET itself; newer sb_secret_ API keys
--     are not JWTs and fail the gateway check with 401 Invalid JWT)
--  3. Schedule every minute (SQL editor, needs pg_cron + pg_net enabled):
--       select cron.schedule('send-email', '* * * * *', $$
--         select net.http_post(
--           url := 'https://<project-ref>.supabase.co/functions/v1/send-email',
--           headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
--         ) $$);
--       select cron.schedule('prune-email-outbox', '15 3 * * *', 'select prune_email_outbox()');
--  4. Password-reset emails are sent by Supabase Auth itself: Dashboard →
--     Authentication → SMTP Settings → use the same mailbox (Auth's own
--     SMTP is not subject to the Edge Function port limit, 587 is fine).
--     Add <APP_URL>/reset-password to Authentication → URL Configuration →
--     Redirect URLs.
-- ============================================================
