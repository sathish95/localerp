-- STEP261 — Outlook email → project action items (Microsoft Graph)
--
-- A customer email that reports a project issue becomes a Task Management
-- task (project_tasks) under the right, existing project. Flow:
--
--   Outlook inbox → Graph change notification → Edge Function
--   outlook-webhook (validation token, clientState check, 202 at once)
--   → outlook_email_messages row (PENDING) → Edge Function outlook-sync
--   (cron, every minute: claim → fetch from Graph → classify → match
--   project → create task / send to review) → audit trail.
--
--   outlook_mailboxes         one row per monitored mailbox (per org):
--                             Entra app ids, processing rules, Graph
--                             subscription state, delta link for
--                             reconciliation of missed notifications.
--   outlook_mailbox_secrets   client secret + webhook clientState. RLS on,
--                             NO policies, revoked from anon/authenticated:
--                             only SECURITY DEFINER functions and the
--                             service role (Edge Functions) can read it.
--   outlook_email_messages    the processing record — one per mailbox +
--                             Graph message id (UNIQUE), also unique on
--                             internetMessageId once known. Holds only
--                             minimal metadata + a short body excerpt,
--                             cleared after retention_days.
--   outlook_email_events      audit history (received, classified, task
--                             created, sent to review, retried, config…).
--   project_tasks             + source_type ('OUTLOOK_EMAIL') and
--                             source_email_id with a UNIQUE partial index:
--                             the database itself guarantees one task per
--                             email, whatever retries / duplicate
--                             notifications happen.
--
-- Task creation is ONE transaction (outlook_create_task): row lock on the
-- message, insert the task ON CONFLICT DO NOTHING, link it, notify, audit —
-- so a crash between "task created" and "message marked" can't leave a
-- second task behind on retry.
--
-- Roles: admin/ceo configure mailboxes; admin/ceo/manager/department_head
-- see the activity, retry, dismiss and resolve the review queue. The
-- processing functions are service_role only.
--
-- Safe to re-run. Additive only — no existing data is changed.

-- ── helpers ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _outlook_role() RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid() AND is_active IS NOT FALSE
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION _outlook_can_admin() RETURNS BOOLEAN AS $$
  SELECT COALESCE(_outlook_role() IN ('admin','ceo'), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION _outlook_can_view() RETURNS BOOLEAN AS $$
  SELECT COALESCE(_outlook_role() IN ('admin','ceo','manager','department_head'), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- 64 hex chars from the server's CSPRNG. gen_random_uuid() is core Postgres,
-- so this doesn't depend on which schema pgcrypto was installed into.
CREATE OR REPLACE FUNCTION _outlook_random_state() RETURNS TEXT AS $$
  SELECT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$ LANGUAGE sql VOLATILE;

-- A project can receive email tasks only while it is running.
CREATE OR REPLACE FUNCTION _outlook_project_open(p_status TEXT) RETURNS BOOLEAN AS $$
  SELECT lower(COALESCE(p_status, 'active')) IN ('active','planning','in_progress')
$$ LANGUAGE sql IMMUTABLE;

-- ── mailboxes ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outlook_mailboxes (
  id                       UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id          UUID        NOT NULL DEFAULT current_org_id(),
  mailbox_address          TEXT        NOT NULL,
  display_name             TEXT,
  tenant_id                TEXT,       -- Entra tenant (GUID or domain); blank = MS_GRAPH_TENANT_ID secret
  client_id                TEXT,       -- Entra app (client) id;        blank = MS_GRAPH_CLIENT_ID secret
  enabled                  BOOLEAN     NOT NULL DEFAULT false,   -- receive + process mail
  auto_create              BOOLEAN     NOT NULL DEFAULT true,    -- false = every actionable email goes to review
  categories               TEXT[]      NOT NULL DEFAULT ARRAY['BUG','DELAY','INTEGRATION_FAILURE','PRODUCTION_ISSUE','CHANGE_REQUEST','BLOCKER','COMPLAINT','PENDING_DELIVERABLE'],
  min_confidence           NUMERIC(3,2) NOT NULL DEFAULT 0.75 CHECK (min_confidence BETWEEN 0.30 AND 1.00),
  default_priority         TEXT        NOT NULL DEFAULT 'medium' CHECK (default_priority IN ('low','medium','high','critical')),
  assign_mode              TEXT        NOT NULL DEFAULT 'PROJECT_MANAGER' CHECK (assign_mode IN ('PROJECT_MANAGER','FIXED','SUGGESTED','NONE')),
  default_assignee_id      UUID,       -- soft ref → profiles (FIXED mode, and fallback)
  default_status           TEXT        NOT NULL DEFAULT 'backlog',
  default_due_days         INT         CHECK (default_due_days BETWEEN 0 AND 365),  -- NULL = no due date unless the email states one
  ai_provider              TEXT        NOT NULL DEFAULT 'auto' CHECK (ai_provider IN ('auto','claude','deepseek','gemini','rules')),
  notify_user_ids          UUID[]      NOT NULL DEFAULT '{}',   -- told about review-queue items
  retention_days           INT         NOT NULL DEFAULT 90 CHECK (retention_days BETWEEN 7 AND 3650),
  process_since            TIMESTAMPTZ,                         -- set when first enabled; older mail is never processed
  subscription_id          TEXT,
  subscription_status      TEXT        NOT NULL DEFAULT 'NONE' CHECK (subscription_status IN ('NONE','ACTIVE','ERROR','REMOVED')),
  subscription_expires_at  TIMESTAMPTZ,
  subscription_renewed_at  TIMESTAMPTZ,
  delta_link               TEXT,
  last_reconciled_at       TIMESTAMPTZ,
  last_notification_at     TIMESTAMPTZ,
  last_test_at             TIMESTAMPTZ,
  last_test_ok             BOOLEAN,
  last_error               TEXT,
  last_error_at            TIMESTAMPTZ,
  created_by               UUID        DEFAULT auth.uid(),
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_by               UUID,
  updated_at               TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS outlook_mailboxes_addr ON outlook_mailboxes (organization_id, lower(mailbox_address));
CREATE UNIQUE INDEX IF NOT EXISTS outlook_mailboxes_sub  ON outlook_mailboxes (subscription_id) WHERE subscription_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS outlook_mailbox_secrets (
  mailbox_id     UUID        PRIMARY KEY,   -- soft ref → outlook_mailboxes
  client_secret  TEXT,                      -- Entra client secret; NULL = MS_GRAPH_CLIENT_SECRET function secret
  client_state   TEXT        NOT NULL,      -- random, echoed by Graph in every notification
  updated_by     UUID,
  updated_at     TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE outlook_mailbox_secrets ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: nobody reads this through PostgREST.
REVOKE ALL ON public.outlook_mailbox_secrets FROM anon, authenticated;

-- ── processing records ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outlook_email_messages (
  id                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id      UUID        NOT NULL,
  mailbox_id           UUID        NOT NULL,          -- soft ref → outlook_mailboxes
  graph_message_id     TEXT        NOT NULL,          -- immutable Graph id
  internet_message_id  TEXT,
  conversation_id      TEXT,
  source               TEXT        NOT NULL DEFAULT 'WEBHOOK' CHECK (source IN ('WEBHOOK','RECONCILE','MANUAL')),
  status               TEXT        NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING','PROCESSING','TASK_CREATED','REVIEW','IGNORED','FAILED','DEAD','DISMISSED')),
  subject              TEXT,
  sender_email         TEXT,
  sender_name          TEXT,
  to_recipients        TEXT[]      NOT NULL DEFAULT '{}',
  received_at          TIMESTAMPTZ,
  web_link             TEXT,
  body_excerpt         TEXT,                          -- plain-text body (quoted history stripped, ≤ 8000 chars), cleared after retention
  classifier           TEXT,                          -- 'claude' | 'deepseek' | 'gemini' | 'rules' | 'rules (AI failed)'
  classification       JSONB,                         -- validated classifier output (no raw model text)
  category             TEXT,
  priority             TEXT,
  confidence           NUMERIC(4,3),
  decision_reason      TEXT,
  matched_project_id   UUID,
  matched_customer_id  UUID,
  match_method         TEXT,                          -- CODE | CONVERSATION | NAME | CUSTOMER | MANUAL
  match_confidence     NUMERIC(4,3),
  candidates           JSONB       NOT NULL DEFAULT '[]'::jsonb,
  task_id              UUID,                          -- soft ref → project_tasks
  attempts             INT         NOT NULL DEFAULT 0,
  next_attempt_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at            TIMESTAMPTZ,
  last_error           TEXT,
  processed_at         TIMESTAMPTZ,
  reviewed_by          UUID,
  reviewed_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS outlook_msgs_graph ON outlook_email_messages (mailbox_id, graph_message_id);
CREATE UNIQUE INDEX IF NOT EXISTS outlook_msgs_imid  ON outlook_email_messages (mailbox_id, internet_message_id) WHERE internet_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS outlook_msgs_queue ON outlook_email_messages (next_attempt_at) WHERE status IN ('PENDING','FAILED','PROCESSING');
CREATE INDEX IF NOT EXISTS outlook_msgs_org   ON outlook_email_messages (organization_id, status, received_at DESC);
CREATE INDEX IF NOT EXISTS outlook_msgs_conv  ON outlook_email_messages (mailbox_id, conversation_id) WHERE conversation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS outlook_email_events (
  id               BIGSERIAL   PRIMARY KEY,
  organization_id  UUID        NOT NULL,
  mailbox_id       UUID,
  message_id       UUID,
  event            TEXT        NOT NULL,
  detail           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  actor_id         UUID,                      -- NULL = automation
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outlook_events_org ON outlook_email_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS outlook_events_msg ON outlook_email_events (message_id) WHERE message_id IS NOT NULL;

-- ── task linkage (additive) ──────────────────────────────────────────────
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS source_type TEXT;       -- 'OUTLOOK_EMAIL' | NULL
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS source_email_id UUID;   -- soft ref → outlook_email_messages
CREATE UNIQUE INDEX IF NOT EXISTS project_tasks_source_email ON project_tasks (source_email_id) WHERE source_email_id IS NOT NULL;

-- ── audit writer ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _outlook_log(p_org UUID, p_mailbox UUID, p_message UUID, p_event TEXT, p_detail JSONB DEFAULT '{}'::jsonb)
RETURNS VOID AS $$
DECLARE v_actor UUID;
BEGIN
  BEGIN v_actor := auth.uid(); EXCEPTION WHEN OTHERS THEN v_actor := NULL; END;
  INSERT INTO outlook_email_events (organization_id, mailbox_id, message_id, event, detail, actor_id)
  VALUES (p_org, p_mailbox, p_message, p_event, COALESCE(p_detail, '{}'::jsonb), v_actor);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── mailbox triggers ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION outlook_mailboxes_before() RETURNS TRIGGER AS $$
BEGIN
  NEW.mailbox_address := lower(trim(NEW.mailbox_address));
  IF NEW.mailbox_address !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'Enter a valid mailbox address'; END IF;
  NEW.tenant_id := NULLIF(trim(COALESCE(NEW.tenant_id, '')), '');
  NEW.client_id := NULLIF(trim(COALESCE(NEW.client_id, '')), '');
  NEW.categories := ARRAY(SELECT DISTINCT c FROM unnest(NEW.categories) c
    WHERE c IN ('BUG','DELAY','INTEGRATION_FAILURE','PRODUCTION_ISSUE','CHANGE_REQUEST','BLOCKER','COMPLAINT','PENDING_DELIVERABLE','OTHER'));
  IF NEW.default_assignee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = NEW.default_assignee_id AND organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'Default assignee is not a member of this organization';
  END IF;
  IF NEW.enabled AND NEW.process_since IS NULL THEN NEW.process_since := now(); END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.organization_id := OLD.organization_id;   -- never moves between orgs
    NEW.updated_at := now();
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    -- a new address / app means the old subscription and delta are void
    IF NEW.mailbox_address IS DISTINCT FROM OLD.mailbox_address
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.client_id IS DISTINCT FROM OLD.client_id THEN
      NEW.delta_link := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS outlook_mailboxes_before ON outlook_mailboxes;
CREATE TRIGGER outlook_mailboxes_before BEFORE INSERT OR UPDATE ON outlook_mailboxes
  FOR EACH ROW EXECUTE FUNCTION outlook_mailboxes_before();

CREATE OR REPLACE FUNCTION outlook_mailboxes_after() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO outlook_mailbox_secrets (mailbox_id, client_state)
    VALUES (NEW.id, _outlook_random_state()) ON CONFLICT (mailbox_id) DO NOTHING;
    PERFORM _outlook_log(NEW.organization_id, NEW.id, NULL, 'MAILBOX_ADDED', jsonb_build_object('mailbox', NEW.mailbox_address));
  ELSIF TG_OP = 'UPDATE' AND auth.uid() IS NOT NULL THEN
    -- user edits only; the service role's status writes are not config changes
    PERFORM _outlook_log(NEW.organization_id, NEW.id, NULL, 'CONFIG_CHANGED', jsonb_build_object(
      'enabled', NEW.enabled, 'auto_create', NEW.auto_create, 'min_confidence', NEW.min_confidence,
      'assign_mode', NEW.assign_mode, 'ai_provider', NEW.ai_provider, 'categories', NEW.categories));
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM outlook_mailbox_secrets WHERE mailbox_id = OLD.id;
    PERFORM _outlook_log(OLD.organization_id, OLD.id, NULL, 'MAILBOX_REMOVED', jsonb_build_object('mailbox', OLD.mailbox_address));
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS outlook_mailboxes_after ON outlook_mailboxes;
CREATE TRIGGER outlook_mailboxes_after AFTER INSERT OR UPDATE OR DELETE ON outlook_mailboxes
  FOR EACH ROW EXECUTE FUNCTION outlook_mailboxes_after();

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE outlook_mailboxes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE outlook_email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE outlook_email_events   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outlook_mailboxes_select ON outlook_mailboxes;
DROP POLICY IF EXISTS outlook_mailboxes_insert ON outlook_mailboxes;
DROP POLICY IF EXISTS outlook_mailboxes_update ON outlook_mailboxes;
DROP POLICY IF EXISTS outlook_mailboxes_delete ON outlook_mailboxes;
CREATE POLICY outlook_mailboxes_select ON outlook_mailboxes FOR SELECT USING (organization_id = current_org_id() AND _outlook_can_view());
CREATE POLICY outlook_mailboxes_insert ON outlook_mailboxes FOR INSERT WITH CHECK (organization_id = current_org_id() AND _outlook_can_admin());
CREATE POLICY outlook_mailboxes_update ON outlook_mailboxes FOR UPDATE USING (organization_id = current_org_id() AND _outlook_can_admin())
  WITH CHECK (organization_id = current_org_id());
CREATE POLICY outlook_mailboxes_delete ON outlook_mailboxes FOR DELETE USING (organization_id = current_org_id() AND _outlook_can_admin());

-- messages / events: read-only for viewers; every write goes through the RPCs below
DROP POLICY IF EXISTS outlook_msgs_select ON outlook_email_messages;
CREATE POLICY outlook_msgs_select ON outlook_email_messages FOR SELECT USING (organization_id = current_org_id() AND _outlook_can_view());
DROP POLICY IF EXISTS outlook_events_select ON outlook_email_events;
CREATE POLICY outlook_events_select ON outlook_email_events FOR SELECT USING (organization_id = current_org_id() AND _outlook_can_view());
REVOKE INSERT, UPDATE, DELETE ON outlook_email_messages, outlook_email_events FROM anon, authenticated;

-- Subscription / delta fields are written by the service role only.
REVOKE UPDATE ON outlook_mailboxes FROM authenticated;
GRANT UPDATE (mailbox_address, display_name, tenant_id, client_id, enabled, auto_create, categories, min_confidence,
  default_priority, assign_mode, default_assignee_id, default_status, default_due_days, ai_provider, notify_user_ids,
  retention_days) ON outlook_mailboxes TO authenticated;

-- ── secret management (admin/ceo, write-only) ────────────────────────────
CREATE OR REPLACE FUNCTION outlook_set_client_secret(p_mailbox UUID, p_secret TEXT) RETURNS VOID AS $$
DECLARE v_org UUID;
BEGIN
  SELECT organization_id INTO v_org FROM outlook_mailboxes WHERE id = p_mailbox;
  IF v_org IS NULL OR v_org <> current_org_id() OR NOT _outlook_can_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  INSERT INTO outlook_mailbox_secrets (mailbox_id, client_secret, client_state, updated_by, updated_at)
  VALUES (p_mailbox, NULLIF(trim(COALESCE(p_secret, '')), ''), _outlook_random_state(), auth.uid(), now())
  ON CONFLICT (mailbox_id) DO UPDATE SET client_secret = EXCLUDED.client_secret, updated_by = auth.uid(), updated_at = now();
  PERFORM _outlook_log(v_org, p_mailbox, NULL, CASE WHEN NULLIF(trim(COALESCE(p_secret, '')), '') IS NULL THEN 'SECRET_CLEARED' ELSE 'SECRET_SET' END);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION outlook_secret_status(p_mailbox UUID)
RETURNS TABLE (has_secret BOOLEAN, updated_at TIMESTAMPTZ) AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM outlook_mailboxes WHERE id = p_mailbox AND organization_id = current_org_id()) OR NOT _outlook_can_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY SELECT s.client_secret IS NOT NULL, s.updated_at FROM outlook_mailbox_secrets s WHERE s.mailbox_id = p_mailbox;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- New clientState: the current subscription stops validating, so the UI
-- re-subscribes right after (outlook-sync action 'subscribe').
CREATE OR REPLACE FUNCTION outlook_rotate_client_state(p_mailbox UUID) RETURNS VOID AS $$
DECLARE v_org UUID;
BEGIN
  SELECT organization_id INTO v_org FROM outlook_mailboxes WHERE id = p_mailbox;
  IF v_org IS NULL OR v_org <> current_org_id() OR NOT _outlook_can_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE outlook_mailbox_secrets SET client_state = _outlook_random_state(), updated_by = auth.uid(), updated_at = now()
   WHERE mailbox_id = p_mailbox;
  PERFORM _outlook_log(v_org, p_mailbox, NULL, 'CLIENT_STATE_ROTATED');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── queue (service role) ─────────────────────────────────────────────────
-- Webhook / reconciliation: record a message id. Duplicate notifications
-- hit the unique index and are dropped here.
CREATE OR REPLACE FUNCTION outlook_enqueue_message(p_mailbox UUID, p_graph_id TEXT, p_source TEXT DEFAULT 'WEBHOOK')
RETURNS BOOLEAN AS $$
DECLARE v_mb outlook_mailboxes; v_id UUID;
BEGIN
  SELECT * INTO v_mb FROM outlook_mailboxes WHERE id = p_mailbox;
  IF v_mb.id IS NULL OR NOT v_mb.enabled OR NULLIF(trim(COALESCE(p_graph_id, '')), '') IS NULL THEN RETURN false; END IF;
  INSERT INTO outlook_email_messages (organization_id, mailbox_id, graph_message_id, source)
  VALUES (v_mb.organization_id, p_mailbox, left(trim(p_graph_id), 512), COALESCE(p_source, 'WEBHOOK'))
  ON CONFLICT (mailbox_id, graph_message_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN false; END IF;
  PERFORM _outlook_log(v_mb.organization_id, p_mailbox, v_id, 'RECEIVED', jsonb_build_object('source', p_source));
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Claim due messages. SKIP LOCKED + the PROCESSING status make two workers
-- never take the same row; a worker that died leaves PROCESSING rows that
-- are reclaimed after 10 minutes.
CREATE OR REPLACE FUNCTION outlook_claim_messages(p_limit INT DEFAULT 10, p_message UUID DEFAULT NULL)
RETURNS SETOF outlook_email_messages AS $$
BEGIN
  RETURN QUERY
  UPDATE outlook_email_messages m
     SET status = 'PROCESSING', locked_at = now(), attempts = m.attempts + 1, updated_at = now()
   WHERE m.id IN (
     SELECT x.id FROM outlook_email_messages x
       JOIN outlook_mailboxes b ON b.id = x.mailbox_id AND b.enabled
      WHERE (p_message IS NULL OR x.id = p_message)
        AND ( (x.status IN ('PENDING','FAILED') AND x.next_attempt_at <= now())
           OR (x.status = 'PROCESSING' AND x.locked_at < now() - interval '10 minutes') )
      ORDER BY x.next_attempt_at
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 100))
      FOR UPDATE OF x SKIP LOCKED)
  RETURNING m.*;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Record the outcome of one processing attempt (every status except
-- TASK_CREATED, which only outlook_create_task sets). PROCESSING saves the
-- fetched / classified fields mid-run (status unchanged). FAILED schedules a
-- retry with exponential backoff (1, 2, 4 … min, ≤ 6 h) or Graph's
-- Retry-After; after 6 attempts the message is DEAD (the dead-letter list).
CREATE OR REPLACE FUNCTION outlook_record_result(p_message UUID, p_status TEXT, p_fields JSONB DEFAULT '{}'::jsonb, p_retry_after_secs INT DEFAULT NULL)
RETURNS TEXT AS $$
DECLARE v_m outlook_email_messages; v_status TEXT := p_status; v_mb outlook_mailboxes; f JSONB := COALESCE(p_fields, '{}'::jsonb);
BEGIN
  IF p_status NOT IN ('PROCESSING','REVIEW','IGNORED','FAILED') THEN RAISE EXCEPTION 'Bad status %', p_status; END IF;
  SELECT * INTO v_m FROM outlook_email_messages WHERE id = p_message FOR UPDATE;
  IF v_m.id IS NULL THEN RETURN NULL; END IF;
  IF v_m.status IN ('TASK_CREATED','DISMISSED') OR v_m.task_id IS NOT NULL THEN RETURN v_m.status; END IF;  -- never downgrade
  IF v_status = 'FAILED' AND v_m.attempts >= 6 THEN v_status := 'DEAD'; END IF;

  UPDATE outlook_email_messages SET
    status              = v_status,
    internet_message_id = COALESCE(f->>'internet_message_id', internet_message_id),
    conversation_id     = COALESCE(f->>'conversation_id', conversation_id),
    subject             = COALESCE(f->>'subject', subject),
    sender_email        = COALESCE(lower(f->>'sender_email'), sender_email),
    sender_name         = COALESCE(f->>'sender_name', sender_name),
    to_recipients       = CASE WHEN jsonb_typeof(f->'to_recipients') = 'array'
                            THEN ARRAY(SELECT jsonb_array_elements_text(f->'to_recipients')) ELSE to_recipients END,
    received_at         = COALESCE((f->>'received_at')::timestamptz, received_at),
    web_link            = COALESCE(f->>'web_link', web_link),
    body_excerpt        = COALESCE(left(f->>'body_excerpt', 8000), body_excerpt),
    classifier          = COALESCE(f->>'classifier', classifier),
    classification      = COALESCE(f->'classification', classification),
    category            = COALESCE(f->>'category', category),
    priority            = COALESCE(f->>'priority', priority),
    confidence          = COALESCE((f->>'confidence')::numeric, confidence),
    decision_reason     = COALESCE(f->>'decision_reason', decision_reason),
    matched_project_id  = COALESCE((f->>'matched_project_id')::uuid, matched_project_id),
    matched_customer_id = COALESCE((f->>'matched_customer_id')::uuid, matched_customer_id),
    match_method        = COALESCE(f->>'match_method', match_method),
    match_confidence    = COALESCE((f->>'match_confidence')::numeric, match_confidence),
    candidates          = COALESCE(f->'candidates', candidates),
    last_error          = CASE WHEN v_status IN ('FAILED','DEAD') THEN left(f->>'error', 1000) ELSE NULL END,
    next_attempt_at     = CASE WHEN v_status = 'FAILED'
                            THEN now() + make_interval(secs => COALESCE(p_retry_after_secs, LEAST(21600, 60 * power(2, GREATEST(v_m.attempts - 1, 0)))::int))
                            ELSE next_attempt_at END,
    processed_at        = CASE WHEN v_status IN ('REVIEW','IGNORED','DEAD') THEN now() ELSE processed_at END,
    locked_at           = CASE WHEN v_status = 'PROCESSING' THEN locked_at ELSE NULL END,
    updated_at          = now()
  WHERE id = p_message;

  PERFORM _outlook_log(v_m.organization_id, v_m.mailbox_id, p_message,
    CASE v_status WHEN 'PROCESSING' THEN 'CLASSIFIED' WHEN 'REVIEW' THEN 'SENT_TO_REVIEW' WHEN 'IGNORED' THEN 'IGNORED' WHEN 'DEAD' THEN 'DEAD_LETTER' ELSE 'FAILED' END,
    jsonb_strip_nulls(jsonb_build_object('reason', f->>'decision_reason', 'error', left(f->>'error', 300),
      'attempt', v_m.attempts, 'category', f->>'category', 'confidence', f->>'confidence', 'match', f->>'match_method')));

  -- review queue: tell the configured people once
  IF v_status = 'REVIEW' AND v_m.status <> 'REVIEW' THEN
    SELECT * INTO v_mb FROM outlook_mailboxes WHERE id = v_m.mailbox_id;
    INSERT INTO notifications (recipient_id, type, title, body, link, organization_id)
    SELECT u, 'email_review', 'Customer email needs a project', left(COALESCE(f->>'subject', v_m.subject, '(no subject)'), 200),
           '/email-to-tasks?tab=review', v_m.organization_id
      FROM unnest(v_mb.notify_user_ids) u
     WHERE EXISTS (SELECT 1 FROM profiles p WHERE p.id = u AND p.organization_id = v_m.organization_id AND p.is_active IS NOT FALSE);
  END IF;
  RETURN v_status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- The ONE place an email becomes a task. Idempotent: a message that already
-- has a task (or a task already pointing at it) returns that task.
CREATE OR REPLACE FUNCTION _outlook_create_task(
  p_message UUID, p_project UUID, p_title TEXT, p_description TEXT, p_priority TEXT,
  p_assignee UUID, p_due DATE, p_actor UUID, p_method TEXT, p_match_conf NUMERIC, p_customer UUID)
RETURNS UUID AS $$
DECLARE v_m outlook_email_messages; v_mb outlook_mailboxes; v_p projects; v_task UUID; v_code TEXT; v_assignee UUID := p_assignee;
BEGIN
  SELECT * INTO v_m FROM outlook_email_messages WHERE id = p_message FOR UPDATE;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'Email record not found'; END IF;
  IF v_m.task_id IS NOT NULL THEN RETURN v_m.task_id; END IF;
  SELECT id INTO v_task FROM project_tasks WHERE source_email_id = p_message;
  IF v_task IS NULL THEN
    SELECT * INTO v_mb FROM outlook_mailboxes WHERE id = v_m.mailbox_id;
    SELECT * INTO v_p FROM projects WHERE id = p_project;
    IF v_p.id IS NULL OR v_p.organization_id <> v_m.organization_id THEN RAISE EXCEPTION 'Project not found in this organization'; END IF;
    IF NOT _outlook_project_open(v_p.status) THEN RAISE EXCEPTION 'Project % is %, not active', v_p.code, v_p.status; END IF;
    IF v_assignee IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM profiles WHERE id = v_assignee AND organization_id = v_m.organization_id AND is_active IS NOT FALSE) THEN
      v_assignee := NULL;   -- never assign outside the org / to a deactivated user
    END IF;

    INSERT INTO project_tasks (task_name, task_type, description, priority, status, project_id, department_id,
                               assigned_to, planned_end_date, organization_id, created_by, source_type, source_email_id)
    VALUES (left(COALESCE(NULLIF(trim(p_title), ''), v_m.subject, 'Customer email'), 250), 'task', p_description,
            CASE WHEN p_priority IN ('low','medium','high','critical') THEN p_priority ELSE v_mb.default_priority END,
            COALESCE(NULLIF(v_mb.default_status, ''), 'backlog'), v_p.id, v_p.department_id,
            v_assignee, p_due, v_m.organization_id, COALESCE(p_actor, v_mb.created_by), 'OUTLOOK_EMAIL', p_message)
    ON CONFLICT (source_email_id) WHERE source_email_id IS NOT NULL DO NOTHING
    RETURNING id, task_id INTO v_task, v_code;
    IF v_task IS NULL THEN SELECT id INTO v_task FROM project_tasks WHERE source_email_id = p_message; END IF;

    IF v_code IS NOT NULL AND v_assignee IS NOT NULL THEN
      INSERT INTO notifications (recipient_id, sender_id, type, title, body, link, organization_id)
      VALUES (v_assignee, p_actor, 'task_assigned', 'New task from a customer email',
              left(v_code || ' · ' || COALESCE(NULLIF(trim(p_title), ''), v_m.subject, ''), 250), '/tasks?taskId=' || v_task, v_m.organization_id);
    END IF;
  END IF;

  UPDATE outlook_email_messages SET
    status = 'TASK_CREATED', task_id = v_task, matched_project_id = p_project,
    matched_customer_id = COALESCE(p_customer, matched_customer_id),
    match_method = COALESCE(p_method, match_method), match_confidence = COALESCE(p_match_conf, match_confidence),
    processed_at = now(), locked_at = NULL, last_error = NULL, updated_at = now(),
    reviewed_by = CASE WHEN p_actor IS NOT NULL THEN p_actor ELSE reviewed_by END,
    reviewed_at = CASE WHEN p_actor IS NOT NULL THEN now() ELSE reviewed_at END
  WHERE id = p_message;
  PERFORM _outlook_log(v_m.organization_id, v_m.mailbox_id, p_message,
    CASE WHEN p_actor IS NULL THEN 'TASK_CREATED' ELSE 'REVIEW_RESOLVED' END,
    jsonb_build_object('task_id', v_task, 'task_code', v_code, 'project_id', p_project, 'method', p_method, 'assigned_to', v_assignee));
  RETURN v_task;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Automation path (service role).
CREATE OR REPLACE FUNCTION outlook_create_task(
  p_message UUID, p_project UUID, p_title TEXT, p_description TEXT, p_priority TEXT,
  p_assignee UUID, p_due DATE, p_method TEXT, p_match_conf NUMERIC, p_customer UUID)
RETURNS UUID AS $$
  SELECT _outlook_create_task(p_message, p_project, p_title, p_description, p_priority, p_assignee, p_due, NULL, p_method, p_match_conf, p_customer)
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- ── review queue actions (viewers in the same org) ───────────────────────
CREATE OR REPLACE FUNCTION _outlook_msg_for_user(p_message UUID) RETURNS outlook_email_messages AS $$
DECLARE v_m outlook_email_messages;
BEGIN
  SELECT * INTO v_m FROM outlook_email_messages WHERE id = p_message;
  IF v_m.id IS NULL OR v_m.organization_id <> current_org_id() OR NOT _outlook_can_view() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN v_m;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION outlook_review_create_task(
  p_message UUID, p_project UUID, p_title TEXT, p_description TEXT, p_priority TEXT, p_assignee UUID, p_due DATE)
RETURNS UUID AS $$
DECLARE v_m outlook_email_messages := _outlook_msg_for_user(p_message);
BEGIN
  IF v_m.status IN ('PENDING','PROCESSING') THEN RAISE EXCEPTION 'This email is still being processed'; END IF;
  RETURN _outlook_create_task(p_message, p_project, p_title, p_description, p_priority, p_assignee, p_due, auth.uid(), 'MANUAL', 1, NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION outlook_retry_message(p_message UUID) RETURNS VOID AS $$
DECLARE v_m outlook_email_messages := _outlook_msg_for_user(p_message);
BEGIN
  IF v_m.status NOT IN ('FAILED','DEAD','REVIEW','IGNORED','DISMISSED') THEN RAISE EXCEPTION 'Only failed, ignored or review emails can be retried'; END IF;
  UPDATE outlook_email_messages SET status = 'PENDING', attempts = 0, next_attempt_at = now(), locked_at = NULL,
         last_error = NULL, updated_at = now() WHERE id = p_message AND task_id IS NULL;
  PERFORM _outlook_log(v_m.organization_id, v_m.mailbox_id, p_message, 'RETRY_REQUESTED', jsonb_build_object('from', v_m.status));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION outlook_dismiss_message(p_message UUID, p_note TEXT DEFAULT NULL) RETURNS VOID AS $$
DECLARE v_m outlook_email_messages := _outlook_msg_for_user(p_message);
BEGIN
  IF v_m.status NOT IN ('REVIEW','FAILED','DEAD','IGNORED') THEN RAISE EXCEPTION 'Only review, failed or ignored emails can be dismissed'; END IF;
  UPDATE outlook_email_messages SET status = 'DISMISSED', reviewed_by = auth.uid(), reviewed_at = now(),
         decision_reason = COALESCE(NULLIF(trim(p_note), ''), decision_reason), updated_at = now() WHERE id = p_message;
  PERFORM _outlook_log(v_m.organization_id, v_m.mailbox_id, p_message, 'DISMISSED', jsonb_strip_nulls(jsonb_build_object('note', NULLIF(trim(p_note), ''))));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── worker helpers (service role) ────────────────────────────────────────
-- Webhook: subscription id → mailbox + clientState to compare.
CREATE OR REPLACE FUNCTION outlook_webhook_lookup(p_subscription_ids TEXT[])
RETURNS TABLE (subscription_id TEXT, mailbox_id UUID, organization_id UUID, enabled BOOLEAN, tenant_id TEXT, client_state TEXT) AS $$
  SELECT b.subscription_id, b.id, b.organization_id, b.enabled, b.tenant_id, s.client_state
    FROM outlook_mailboxes b JOIN outlook_mailbox_secrets s ON s.mailbox_id = b.id
   WHERE b.subscription_id = ANY(p_subscription_ids)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION outlook_mailbox_credentials(p_mailbox UUID)
RETURNS TABLE (client_secret TEXT, client_state TEXT) AS $$
  SELECT client_secret, client_state FROM outlook_mailbox_secrets WHERE mailbox_id = p_mailbox
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Retention: drop the body excerpt and classifier text of old mail; delete
-- old ignored / dismissed records and their events entirely.
CREATE OR REPLACE FUNCTION outlook_prune_email_data() RETURNS INT AS $$
DECLARE n INT;
BEGIN
  UPDATE outlook_email_messages m SET body_excerpt = NULL,
         classification = CASE WHEN m.classification IS NULL THEN NULL ELSE m.classification - 'description' - 'reason' END
    FROM outlook_mailboxes b
   WHERE b.id = m.mailbox_id AND m.body_excerpt IS NOT NULL AND m.created_at < now() - make_interval(days => b.retention_days);
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM outlook_email_events e USING outlook_email_messages m, outlook_mailboxes b
   WHERE e.message_id = m.id AND b.id = m.mailbox_id AND m.status IN ('IGNORED','DISMISSED')
     AND m.created_at < now() - make_interval(days => b.retention_days);
  DELETE FROM outlook_email_messages m USING outlook_mailboxes b
   WHERE b.id = m.mailbox_id AND m.status IN ('IGNORED','DISMISSED') AND m.created_at < now() - make_interval(days => b.retention_days);
  RETURN n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── grants: functions are PUBLIC-executable by default — lock them down ──
REVOKE EXECUTE ON FUNCTION _outlook_log(UUID, UUID, UUID, TEXT, JSONB),
  outlook_enqueue_message(UUID, TEXT, TEXT), outlook_claim_messages(INT, UUID),
  outlook_record_result(UUID, TEXT, JSONB, INT),
  _outlook_create_task(UUID, UUID, TEXT, TEXT, TEXT, UUID, DATE, UUID, TEXT, NUMERIC, UUID),
  outlook_create_task(UUID, UUID, TEXT, TEXT, TEXT, UUID, DATE, TEXT, NUMERIC, UUID),
  outlook_webhook_lookup(TEXT[]), outlook_mailbox_credentials(UUID), outlook_prune_email_data()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION outlook_enqueue_message(UUID, TEXT, TEXT), outlook_claim_messages(INT, UUID),
  outlook_record_result(UUID, TEXT, JSONB, INT),
  outlook_create_task(UUID, UUID, TEXT, TEXT, TEXT, UUID, DATE, TEXT, NUMERIC, UUID),
  outlook_webhook_lookup(TEXT[]), outlook_mailbox_credentials(UUID), outlook_prune_email_data()
  TO service_role;

REVOKE EXECUTE ON FUNCTION outlook_set_client_secret(UUID, TEXT), outlook_secret_status(UUID), outlook_rotate_client_state(UUID),
  _outlook_msg_for_user(UUID), outlook_review_create_task(UUID, UUID, TEXT, TEXT, TEXT, UUID, DATE),
  outlook_retry_message(UUID), outlook_dismiss_message(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION outlook_set_client_secret(UUID, TEXT), outlook_secret_status(UUID), outlook_rotate_client_state(UUID),
  outlook_review_create_task(UUID, UUID, TEXT, TEXT, TEXT, UUID, DATE),
  outlook_retry_message(UUID), outlook_dismiss_message(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Setup checklist (see CLAUDE.md → "Outlook email → tasks" for details)
--  1. Run this script.
--  2. Deploy both functions WITHOUT gateway JWT checks (Graph sends no JWT;
--     outlook-webhook checks clientState, outlook-sync checks CRON_SECRET
--     or the caller's own Supabase session):
--       supabase functions deploy outlook-webhook --no-verify-jwt
--       supabase functions deploy outlook-sync    --no-verify-jwt
--  3. Schedule the worker (same CRON_SECRET as send-email):
--       select cron.schedule('outlook-sync', '* * * * *', $$
--         select net.http_post(
--           url := 'https://<project-ref>.supabase.co/functions/v1/outlook-sync',
--           headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>', 'Content-Type', 'application/json'),
--           body := '{"action":"run"}'::jsonb) $$);
--       select cron.schedule('outlook-prune', '20 3 * * *', 'select outlook_prune_email_data()');
--  4. Settings → Outlook Email: add the mailbox, tenant + client id, client
--     secret, Test connection, enable, Subscribe.
-- ============================================================
