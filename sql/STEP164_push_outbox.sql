-- ============================================================
-- STEP164: Mobile push notifications — device tokens + delivery outbox.
--
-- Outbox pattern, on purpose: the AFTER INSERT trigger on `notifications`
-- does ONE cheap local INSERT into push_delivery_outbox (guarded so it
-- can never fail the notification write, and skipped entirely when the
-- recipient has no live device). A separate worker — an Edge Function on
-- a cron (see the checklist at the bottom, NOT created by this SQL) —
-- drains the outbox and calls the Expo Push API. No pg_net / external
-- HTTP call sits in the trigger path.
--
-- push_tokens is user-owned: a member manages only their own device
-- rows; platform super admins can read all (device/session management).
-- ============================================================

/* ═══ Device tokens ═══ */

CREATE TABLE IF NOT EXISTS push_tokens (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  organization_id UUID        REFERENCES organizations(id) ON DELETE SET NULL,
  platform        TEXT        NOT NULL CHECK (platform IN ('ios','android','web')),
  token           TEXT        NOT NULL,
  device_name     TEXT,
  app_version     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  last_seen_at    TIMESTAMPTZ DEFAULT now(),
  revoked_at      TIMESTAMPTZ,
  UNIQUE (user_id, token)
);
CREATE INDEX IF NOT EXISTS push_tokens_user_idx   ON push_tokens(user_id) WHERE revoked_at IS NULL;

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_tokens_own  ON push_tokens;
DROP POLICY IF EXISTS push_tokens_read ON push_tokens;
CREATE POLICY push_tokens_own ON push_tokens FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY push_tokens_read ON push_tokens FOR SELECT
  USING (user_id = auth.uid() OR is_platform_super_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_tokens TO authenticated;

CREATE OR REPLACE FUNCTION register_push_token(
  p_token TEXT, p_platform TEXT, p_device_name TEXT DEFAULT NULL, p_app_version TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_platform NOT IN ('ios','android','web') THEN RAISE EXCEPTION 'Invalid platform'; END IF;
  IF coalesce(trim(p_token),'') = '' THEN RAISE EXCEPTION 'Token required'; END IF;

  INSERT INTO push_tokens (user_id, organization_id, platform, token, device_name, app_version, last_seen_at, revoked_at)
  VALUES (auth.uid(), current_org_id(), p_platform, p_token, p_device_name, p_app_version, now(), NULL)
  ON CONFLICT (user_id, token) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    platform        = EXCLUDED.platform,
    device_name     = COALESCE(EXCLUDED.device_name, push_tokens.device_name),
    app_version     = COALESCE(EXCLUDED.app_version, push_tokens.app_version),
    last_seen_at    = now(),
    revoked_at      = NULL
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION register_push_token(TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION revoke_push_token(p_token TEXT) RETURNS VOID AS $$
BEGIN
  UPDATE push_tokens SET revoked_at = now()
  WHERE token = p_token AND user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION revoke_push_token(TEXT) TO authenticated;

/* ═══ Delivery outbox ═══ */

CREATE TABLE IF NOT EXISTS push_delivery_outbox (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  notification_id UUID,                        -- soft ref (notifications has no ON DELETE we depend on)
  recipient_id    UUID        NOT NULL,
  title           TEXT,
  body            TEXT,
  link            TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  claimed_at      TIMESTAMPTZ,
  processed_at    TIMESTAMPTZ,
  attempts        INT         NOT NULL DEFAULT 0,
  last_error      TEXT
);
CREATE INDEX IF NOT EXISTS push_delivery_outbox_pending_idx
  ON push_delivery_outbox(created_at) WHERE processed_at IS NULL;

ALTER TABLE push_delivery_outbox ENABLE ROW LEVEL SECURITY;
-- No authenticated access at all — only the service-role worker (which
-- bypasses RLS) and the SECURITY DEFINER functions below touch it.
DROP POLICY IF EXISTS push_delivery_outbox_none ON push_delivery_outbox;
CREATE POLICY push_delivery_outbox_none ON push_delivery_outbox FOR SELECT USING (is_platform_super_admin());

-- Trigger: enqueue on every notification INSERT, but only if the
-- recipient has a live device, and never let a failure here roll back
-- the notification itself.
CREATE OR REPLACE FUNCTION enqueue_push_delivery() RETURNS TRIGGER AS $$
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM push_tokens WHERE user_id = NEW.recipient_id AND revoked_at IS NULL) THEN
      INSERT INTO push_delivery_outbox (notification_id, recipient_id, title, body, link)
      VALUES (NEW.id, NEW.recipient_id, NEW.title, NEW.body, NEW.link);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- push is best-effort; the in-app notification already succeeded
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS notifications_enqueue_push ON notifications;
CREATE TRIGGER notifications_enqueue_push AFTER INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION enqueue_push_delivery();

-- Worker API (called by the Edge Function using the service role key).
-- FOR UPDATE SKIP LOCKED so multiple worker invocations don't double-send.
CREATE OR REPLACE FUNCTION claim_push_batch(p_limit INT DEFAULT 100)
RETURNS TABLE (
  id UUID, recipient_id UUID, title TEXT, body TEXT, link TEXT,
  tokens JSONB
) AS $$
BEGIN
  IF auth.role() <> 'service_role' AND NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
  WITH claimed AS (
    SELECT o.id
    FROM push_delivery_outbox o
    WHERE o.processed_at IS NULL AND o.attempts < 5
    ORDER BY o.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ), upd AS (
    UPDATE push_delivery_outbox o
    SET claimed_at = now(), attempts = o.attempts + 1
    FROM claimed WHERE o.id = claimed.id
    RETURNING o.*
  )
  SELECT u.id, u.recipient_id, u.title, u.body, u.link,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('platform', t.platform, 'token', t.token))
      FROM push_tokens t WHERE t.user_id = u.recipient_id AND t.revoked_at IS NULL
    ), '[]'::jsonb)
  FROM upd u;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION claim_push_batch(INT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION mark_push_delivered(p_ids UUID[], p_error TEXT DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
  IF auth.role() <> 'service_role' AND NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE push_delivery_outbox
  SET processed_at = CASE WHEN p_error IS NULL THEN now() ELSE processed_at END,
      last_error   = p_error
  WHERE id = ANY(p_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION mark_push_delivered(UUID[], TEXT) TO authenticated, service_role;

-- Housekeeping: drop delivered rows older than 7 days (call from cron).
CREATE OR REPLACE FUNCTION prune_push_outbox() RETURNS VOID AS $$
  DELETE FROM push_delivery_outbox WHERE processed_at IS NOT NULL AND processed_at < now() - interval '7 days';
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- REMAINING (not SQL — do after this migration):
--  1. supabase/functions/send-push/index.ts — loop: claim_push_batch()
--     → POST https://exp.host/--/api/v2/push/send (Expo) → mark_push_delivered().
--     On an Expo "DeviceNotRegistered" receipt, call revoke_push_token().
--  2. Schedule it every ~1 min (pg_cron + pg_net, or an external cron
--     hitting the function URL with the service-role key).
--  3. Mobile app: expo-notifications → register_push_token() on login,
--     revoke_push_token() on logout; deep-link taps to `link`.
-- ============================================================
