-- ============================================================
-- STEP233: Announcement emails (maintenance / new update / general) and
-- event-triggered emails (a rule builder) on top of STEP228–232.
--
-- 1. email_announcements
--    organization_id NULL  = platform notice, written by a platform super
--                            admin, to all organisations (or org_ids), with
--                            an optional role filter.
--    organization_id set   = an org admin's notice to their own staff
--                            (everyone / roles / departments / groups / people).
--    status: draft → scheduled → sent (or cancelled). The send-email worker
--    calls enqueue_due_announcements() every minute; maintenance notices can
--    send one reminder remind_before_minutes before starts_at.
--    Platform notices go out even if an org has switched its own email off
--    (they are operational notices about the service itself).
--
-- 2. email_event_rules + email_event_queue
--    AFTER INSERT/UPDATE triggers on 16 business tables capture a row change
--    into email_event_queue ONLY when that org has an enabled rule for that
--    entity (so untouched tables cost one EXISTS check). The trigger is
--    wrapped so it can never fail the user's write. process_email_events()
--    (worker, every minute) matches rules — event (created / status_changed
--    [to …] / updated), conditions, recipients — and queues 'event' emails.
--    The worker renders {placeholders}.
-- Safe to re-run.
-- ============================================================

/* ═════════════ 1. Announcements ═════════════ */

CREATE TABLE IF NOT EXISTS email_announcements (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id       UUID,       -- NULL = platform-wide (super admin)
  kind                  TEXT        NOT NULL DEFAULT 'general' CHECK (kind IN ('maintenance','update','general')),
  title                 TEXT        NOT NULL,
  message               TEXT,
  starts_at             TIMESTAMPTZ,            -- maintenance window
  ends_at               TIMESTAMPTZ,
  impact                TEXT,                   -- e.g. "App unavailable", "Slower performance"
  version               TEXT,                   -- update
  items                 JSONB       NOT NULL DEFAULT '[]', -- update: [{title, description}]
  cta_label             TEXT,
  cta_url               TEXT,
  audience_mode         TEXT        NOT NULL DEFAULT 'all' CHECK (audience_mode IN ('all','roles','departments','groups','people')),
  roles                 TEXT[]      NOT NULL DEFAULT '{}',
  department_ids        UUID[]      NOT NULL DEFAULT '{}',
  group_ids             UUID[]      NOT NULL DEFAULT '{}',
  people_ids            UUID[]      NOT NULL DEFAULT '{}',
  org_ids               UUID[]      NOT NULL DEFAULT '{}',   -- platform: empty = every organisation
  status                TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sent','cancelled')),
  send_at               TIMESTAMPTZ,            -- NULL = as soon as scheduled
  remind_before_minutes INT         CHECK (remind_before_minutes IS NULL OR remind_before_minutes BETWEEN 5 AND 10080),
  reminder_sent_at      TIMESTAMPTZ,
  sent_at               TIMESTAMPTZ,
  recipient_count       INT,
  created_by            UUID,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_announcements_org_idx ON email_announcements(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_announcements_due_idx ON email_announcements(status, send_at);
ALTER TABLE email_announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_announcements_rw ON email_announcements;
CREATE POLICY email_announcements_rw ON email_announcements FOR ALL
  USING ((organization_id IS NULL AND is_platform_super_admin())
      OR (organization_id = current_org_id() AND is_org_email_admin()))
  WITH CHECK ((organization_id IS NULL AND is_platform_super_admin())
      OR (organization_id = current_org_id() AND is_org_email_admin()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_announcements TO authenticated;

ALTER TABLE email_outbox DROP CONSTRAINT IF EXISTS email_outbox_template_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_template_check CHECK (template IN (
  'notification','digest','team_report','welcome','invite','test',
  'checkin_reminder','checkin_manager','overdue_digest','overdue_manager','announcement','event'));

-- Who an announcement goes to (active people with an email).
CREATE OR REPLACE FUNCTION _announcement_audience(a email_announcements)
RETURNS TABLE (id UUID, email TEXT, full_name TEXT, organization_id UUID) AS $$
  SELECT p.id, p.email, p.full_name, p.organization_id FROM profiles p
  LEFT JOIN organizations o ON o.id = p.organization_id
  WHERE COALESCE(p.is_active, true) AND p.email IS NOT NULL AND p.organization_id IS NOT NULL
    AND CASE WHEN a.organization_id IS NULL THEN
          COALESCE(o.is_active, true)
          AND (cardinality(a.org_ids) = 0 OR p.organization_id = ANY (a.org_ids))
          AND (cardinality(a.roles) = 0 OR p.role = ANY (a.roles))
        ELSE
          p.organization_id = a.organization_id
          AND CASE a.audience_mode
                WHEN 'roles'       THEN p.role = ANY (a.roles)
                WHEN 'departments' THEN p.department_id = ANY (a.department_ids)
                WHEN 'groups'      THEN p.id IN (SELECT _group_profile_ids(a.organization_id, a.group_ids))
                WHEN 'people'      THEN p.id = ANY (a.people_ids)
                ELSE true END
        END
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION _announcement_payload(a email_announcements, p_reminder BOOLEAN, p_preview BOOLEAN)
RETURNS JSONB AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'announcement_id', a.id, 'kind', a.kind, 'title', a.title, 'message', a.message,
    'starts_at', a.starts_at, 'ends_at', a.ends_at, 'impact', a.impact, 'version', a.version, 'items', a.items,
    'cta_label', a.cta_label, 'cta_url', a.cta_url, 'platform', CASE WHEN a.organization_id IS NULL THEN true END,
    -- Platform notices come from the platform, not from each customer org's sender name.
    'from_name', CASE WHEN a.organization_id IS NULL THEN 'ThingsAlive NeoX' END,
    'reminder', CASE WHEN p_reminder THEN true END, 'preview', CASE WHEN p_preview THEN true END))
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION enqueue_due_announcements() RETURNS INT AS $$
DECLARE a email_announcements; v_n INT; v_total INT := 0;
BEGIN
  PERFORM _email_worker_guard();
  -- First send
  FOR a IN SELECT * FROM email_announcements WHERE status = 'scheduled' AND COALESCE(send_at, now()) <= now()
           ORDER BY created_at FOR UPDATE SKIP LOCKED LOOP
    INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload, dedupe_key)
    SELECT u.organization_id, u.id, u.email, u.full_name, 'announcement', _announcement_payload(a, false, false),
           'ann:' || a.id || ':' || u.id
    FROM _announcement_audience(a) u
    WHERE a.organization_id IS NULL OR EXISTS (SELECT 1 FROM org_email_settings s WHERE s.organization_id = a.organization_id AND s.enabled)
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    UPDATE email_announcements SET status = 'sent', sent_at = now(), recipient_count = v_n WHERE id = a.id;
    v_total := v_total + v_n;
  END LOOP;
  -- Maintenance reminder, once, before the window starts
  FOR a IN SELECT * FROM email_announcements WHERE status = 'sent' AND kind = 'maintenance' AND remind_before_minutes IS NOT NULL
             AND reminder_sent_at IS NULL AND starts_at > now() AND starts_at - make_interval(mins => remind_before_minutes) <= now()
           FOR UPDATE SKIP LOCKED LOOP
    INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload, dedupe_key)
    SELECT u.organization_id, u.id, u.email, u.full_name, 'announcement', _announcement_payload(a, true, false),
           'ann-rem:' || a.id || ':' || u.id
    FROM _announcement_audience(a) u
    WHERE a.organization_id IS NULL OR EXISTS (SELECT 1 FROM org_email_settings s WHERE s.organization_id = a.organization_id AND s.enabled)
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    UPDATE email_announcements SET reminder_sent_at = now() WHERE id = a.id;
    v_total := v_total + v_n;
  END LOOP;
  RETURN v_total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION enqueue_due_announcements() TO service_role;

-- Audience size before sending (Settings / Super admin composer).
CREATE OR REPLACE FUNCTION announcement_audience_count(p_id UUID) RETURNS INT AS $$
DECLARE a email_announcements;
BEGIN
  SELECT * INTO a FROM email_announcements WHERE id = p_id;
  IF a.id IS NULL OR NOT ((a.organization_id IS NULL AND is_platform_super_admin()) OR (a.organization_id = current_org_id() AND is_org_email_admin())) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  RETURN (SELECT count(*) FROM _announcement_audience(a));
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION announcement_audience_count(UUID) TO authenticated;

-- Send the announcement to the caller only, exactly as recipients will see it.
CREATE OR REPLACE FUNCTION preview_announcement(p_id UUID) RETURNS VOID AS $$
DECLARE a email_announcements; me profiles;
BEGIN
  SELECT * INTO a FROM email_announcements WHERE id = p_id;
  IF a.id IS NULL OR NOT ((a.organization_id IS NULL AND is_platform_super_admin()) OR (a.organization_id = current_org_id() AND is_org_email_admin())) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  SELECT * INTO me FROM profiles WHERE id = auth.uid();
  IF me.email IS NULL THEN RAISE EXCEPTION 'Your profile has no email address'; END IF;
  IF me.organization_id IS NULL THEN RAISE EXCEPTION 'Your account is not in an organisation, so a preview cannot be sent'; END IF;
  INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload)
  VALUES (me.organization_id, me.id, me.email, me.full_name, 'announcement', _announcement_payload(a, false, true));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION preview_announcement(UUID) TO authenticated;

/* ═════════════ 2. Event rules ═════════════ */

-- The record types rules can watch. people = which columns hold the people a
-- rule can email ("assignee", "requester", …). The web UI (src/lib/email.js
-- EVENT_ENTITIES) mirrors the keys, labels and fields.
CREATE OR REPLACE FUNCTION _event_entity(p_entity TEXT) RETURNS JSONB AS $$
  SELECT CASE p_entity
    WHEN 'task'             THEN '{"table":"project_tasks","label":"Task","title":"task_name","code":"task_id","status":"status","due":"planned_end_date","link":"/tasks","people":{"assignee":"assigned_to","creator":"created_by"}}'
    WHEN 'expense'          THEN '{"table":"expense_requests","label":"Expense claim","title":"title","code":"expense_number","status":"status","amount":"total_amount","link":"/expenses","people":{"requester":"requested_by","approver":"current_approver"}}'
    WHEN 'leave'            THEN '{"table":"leave_requests","label":"Leave request","title":"leave_type","code":"request_number","status":"status","due":"from_date","link":"/leave","people":{"requester":"employee_id","approver":"approved_by"}}'
    WHEN 'purchase_request' THEN '{"table":"purchase_requisitions","label":"Purchase request","title":"title","code":"pr_number","status":"status","amount":"estimated_total","link":"/procurement","people":{"requester":"requested_by","approver":"approved_by"}}'
    WHEN 'purchase_order'   THEN '{"table":"purchase_orders","label":"Purchase order","title":"po_number","code":"po_number","status":"status","amount":"total_amount","link":"/procurement","people":{"creator":"created_by","approver":"approved_by"}}'
    WHEN 'vendor_bill'      THEN '{"table":"invoices","label":"Vendor bill","title":"invoice_number","code":"invoice_number","status":"status","amount":"total_amount","due":"due_date","link":"/invoices","people":{"creator":"created_by"}}'
    WHEN 'customer_invoice' THEN '{"table":"customer_invoices","label":"Customer invoice","title":"invoice_number","code":"invoice_number","status":"status","amount":"total_amount","due":"due_date","link":"/customer-invoices","people":{"creator":"created_by"}}'
    WHEN 'it_ticket'        THEN '{"table":"it_helpdesk_tickets","label":"IT ticket","title":"subject","code":"ticket_number","status":"status","link":"/it-helpdesk","people":{"requester":"requester_id","assignee":"assigned_to"}}'
    WHEN 'support_ticket'   THEN '{"table":"support_tickets","label":"Support ticket","title":"subject","code":"ticket_number","status":"status","link":"/support","people":{"assignee":"assigned_agent_id","creator":"created_by"}}'
    WHEN 'lead'             THEN '{"table":"sales_leads","label":"Lead","title":"company_name","code":"lead_number","status":"status","link":"/sales/leads","people":{"owner":"assigned_rep_id","creator":"created_by"}}'
    WHEN 'opportunity'      THEN '{"table":"sales_opportunities","label":"Opportunity","title":"opportunity_number","code":"opportunity_number","status":"status","amount":"expected_value","link":"/sales/opportunities","people":{"owner":"assigned_rep_id","creator":"created_by"}}'
    WHEN 'project'          THEN '{"table":"projects","label":"Project","title":"name","code":"code","status":"status","amount":"budget","link":"/projects","people":{"owner":"manager_id","creator":"created_by"}}'
    WHEN 'milestone'        THEN '{"table":"project_milestones","label":"Milestone","title":"title","status":"status","amount":"invoice_amount","due":"due_date","link":"/projects","people":{"creator":"created_by"}}'
    WHEN 'travel'           THEN '{"table":"travel_requests","label":"Travel request","title":"purpose","code":"request_number","status":"status","link":"/travel","people":{"requester":"requested_by"}}'
    WHEN 'user'             THEN '{"table":"profiles","label":"User","title":"full_name","status":"role","link":"/users","people":{"user":"id","manager":"manager_id"}}'
    WHEN 'timesheet'        THEN '{"table":"timesheet_approvals","label":"Timesheet","title":"period_month","status":"status","link":"/timesheet-approvals","people":{"requester":"employee_id","approver":"manager_id"}}'
  END::jsonb
$$ LANGUAGE sql IMMUTABLE;

CREATE TABLE IF NOT EXISTS email_event_rules (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  name            TEXT        NOT NULL,
  enabled         BOOLEAN     NOT NULL DEFAULT true,
  entity          TEXT        NOT NULL CHECK (_event_entity(entity) IS NOT NULL),
  event           TEXT        NOT NULL DEFAULT 'created' CHECK (event IN ('created','status_changed','updated')),
  status_to       TEXT[]      NOT NULL DEFAULT '{}',    -- status_changed: only to these (empty = any change)
  conditions      JSONB       NOT NULL DEFAULT '[]',    -- [{field, op, value}] — all must match
  recipient_roles TEXT[]      NOT NULL DEFAULT '{}',    -- 'assignee', 'requester', 'manager:requester', …
  people_ids      UUID[]      NOT NULL DEFAULT '{}',
  group_ids       UUID[]      NOT NULL DEFAULT '{}',
  extra_emails    TEXT[]      NOT NULL DEFAULT '{}',
  skip_actor      BOOLEAN     NOT NULL DEFAULT true,    -- don't email the person who made the change
  subject         TEXT,
  message         TEXT,
  last_fired_at   TIMESTAMPTZ,
  fire_count      INT         NOT NULL DEFAULT 0,
  created_by      UUID,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_event_rules_lookup_idx ON email_event_rules(organization_id, entity) WHERE enabled;
ALTER TABLE email_event_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_event_rules_rw ON email_event_rules;
CREATE POLICY email_event_rules_rw ON email_event_rules FOR ALL
  USING (organization_id = current_org_id() AND is_org_email_admin())
  WITH CHECK (organization_id = current_org_id() AND is_org_email_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_event_rules TO authenticated;

CREATE TABLE IF NOT EXISTS email_event_queue (
  id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID        NOT NULL,
  entity          TEXT        NOT NULL,
  op              TEXT        NOT NULL,
  new_row         JSONB       NOT NULL,
  old_row         JSONB,
  actor_id        UUID,
  created_at      TIMESTAMPTZ DEFAULT now(),
  processed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS email_event_queue_pending_idx ON email_event_queue(id) WHERE processed_at IS NULL;
ALTER TABLE email_event_queue ENABLE ROW LEVEL SECURITY; -- no policies: worker (service role) only

-- Row-change capture. TG_ARGV[0] = entity key. Never fails the user's write.
CREATE OR REPLACE FUNCTION _capture_email_event() RETURNS TRIGGER AS $$
DECLARE v_new JSONB; v_old JSONB; v_org UUID; v_actor UUID;
BEGIN
  BEGIN
    v_new := to_jsonb(NEW);
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
    IF TG_OP = 'UPDATE' AND v_new = v_old THEN RETURN NEW; END IF;
    v_org := NULLIF(v_new->>'organization_id', '')::uuid;
    IF v_org IS NULL AND TG_ARGV[0] = 'timesheet' THEN
      SELECT organization_id INTO v_org FROM profiles WHERE id = (v_new->>'employee_id')::uuid;
    END IF;
    IF v_org IS NULL THEN RETURN NEW; END IF;
    IF NOT EXISTS (SELECT 1 FROM email_event_rules r WHERE r.organization_id = v_org AND r.entity = TG_ARGV[0] AND r.enabled) THEN
      RETURN NEW;
    END IF;
    BEGIN v_actor := auth.uid(); EXCEPTION WHEN OTHERS THEN v_actor := NULL; END;
    INSERT INTO email_event_queue (organization_id, entity, op, new_row, old_row, actor_id)
    VALUES (v_org, TG_ARGV[0], TG_OP, v_new, v_old, v_actor);
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- email is best-effort; never block the business write
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DO $$
DECLARE e TEXT; t TEXT;
BEGIN
  FOREACH e IN ARRAY ARRAY['task','expense','leave','purchase_request','purchase_order','vendor_bill','customer_invoice',
                           'it_ticket','support_ticket','lead','opportunity','project','milestone','travel','user','timesheet'] LOOP
    t := _event_entity(e)->>'table';
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS email_event_capture ON %I', t);
      EXECUTE format('CREATE TRIGGER email_event_capture AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION _capture_email_event(%L)', t, e);
    END IF;
  END LOOP;
END $$;

-- One condition {field, op, value} against a row.
CREATE OR REPLACE FUNCTION _event_condition(p_row JSONB, c JSONB) RETURNS BOOLEAN AS $$
DECLARE v TEXT := p_row->>(c->>'field'); x TEXT := c->>'value'; n NUMERIC; m NUMERIC;
BEGIN
  CASE c->>'op'
    WHEN 'is_empty'  THEN RETURN v IS NULL OR v = '';
    WHEN 'not_empty' THEN RETURN v IS NOT NULL AND v <> '';
    WHEN 'equals'    THEN RETURN lower(coalesce(v, '')) = lower(coalesce(x, ''));
    WHEN 'not_equals' THEN RETURN lower(coalesce(v, '')) <> lower(coalesce(x, ''));
    WHEN 'contains'  THEN RETURN coalesce(v, '') ILIKE '%' || coalesce(x, '') || '%';
    WHEN 'in'        THEN RETURN lower(coalesce(v, '')) = ANY (SELECT lower(trim(s)) FROM unnest(string_to_array(x, ',')) s);
    WHEN 'gt', 'gte', 'lt', 'lte' THEN
      BEGIN n := v::numeric; m := x::numeric; EXCEPTION WHEN OTHERS THEN RETURN false; END;
      RETURN CASE c->>'op' WHEN 'gt' THEN n > m WHEN 'gte' THEN n >= m WHEN 'lt' THEN n < m ELSE n <= m END;
    ELSE RETURN false;
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Does a rule fire for a queued change?
CREATE OR REPLACE FUNCTION _event_rule_matches(r email_event_rules, q email_event_queue) RETURNS BOOLEAN AS $$
DECLARE sf TEXT := _event_entity(r.entity)->>'status'; c JSONB;
BEGIN
  IF r.event = 'created' AND q.op <> 'INSERT' THEN RETURN false; END IF;
  IF r.event = 'updated' AND q.op <> 'UPDATE' THEN RETURN false; END IF;
  IF r.event = 'status_changed' THEN
    IF q.op <> 'UPDATE' OR sf IS NULL OR (q.new_row->>sf) IS NOT DISTINCT FROM (q.old_row->>sf) THEN RETURN false; END IF;
    IF cardinality(r.status_to) > 0 AND NOT (lower(coalesce(q.new_row->>sf, '')) = ANY (SELECT lower(s) FROM unnest(r.status_to) s)) THEN RETURN false; END IF;
  END IF;
  FOR c IN SELECT * FROM jsonb_array_elements(r.conditions) LOOP
    IF NOT _event_condition(q.new_row, c) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$ LANGUAGE plpgsql STABLE;

-- Everyone a rule emails for one change (active people with email + outside addresses).
CREATE OR REPLACE FUNCTION _event_recipients(r email_event_rules, q email_event_queue)
RETURNS TABLE (id UUID, email TEXT, full_name TEXT) AS $$
DECLARE ent JSONB := _event_entity(r.entity);
BEGIN
  RETURN QUERY
  WITH role_people AS (
    SELECT CASE WHEN rr LIKE 'manager:%'
                THEN (SELECT COALESCE(p.reporting_manager_id, p.manager_id) FROM profiles p
                      WHERE p.id = NULLIF(q.new_row->>(ent->'people'->>substr(rr, 9)), '')::uuid)
                ELSE NULLIF(q.new_row->>(ent->'people'->>rr), '')::uuid END AS pid
    FROM unnest(r.recipient_roles) rr
    WHERE (rr LIKE 'manager:%' AND ent->'people' ? substr(rr, 9)) OR ent->'people' ? rr
  ), ids AS (
    SELECT pid FROM role_people WHERE pid IS NOT NULL
    UNION SELECT unnest(r.people_ids)
    UNION SELECT _group_profile_ids(r.organization_id, r.group_ids)
  )
  SELECT p.id, p.email, p.full_name FROM profiles p
  WHERE p.id IN (SELECT pid FROM ids) AND p.organization_id = r.organization_id
    AND COALESCE(p.is_active, true) AND p.email IS NOT NULL
    AND NOT (r.skip_actor AND q.actor_id IS NOT NULL AND p.id = q.actor_id)
  UNION
  SELECT NULL::uuid, lower(trim(e)), NULL FROM unnest(r.extra_emails) e WHERE trim(e) <> ''
  UNION
  SELECT NULL::uuid, g, NULL FROM _group_extra_emails(r.organization_id, r.group_ids) g;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION _event_payload(r email_event_rules, q email_event_queue, p_preview BOOLEAN) RETURNS JSONB AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'rule_id', r.id, 'rule_name', r.name, 'entity', r.entity, 'label', e->>'label', 'event', r.event, 'op', q.op,
    'subject', r.subject, 'message', r.message, 'link', e->>'link',
    'title', q.new_row->>(e->>'title'), 'code', q.new_row->>(e->>'code'),
    'status', q.new_row->>(e->>'status'), 'old_status', q.old_row->>(e->>'status'),
    'amount', q.new_row->>(e->>'amount'), 'due', q.new_row->>(e->>'due'),
    'actor', (SELECT full_name FROM profiles WHERE id = q.actor_id),
    'record', q.new_row - ARRAY['attachments','items','description','custom_fields','documents','document_url','evidence_urls'],
    'preview', CASE WHEN p_preview THEN true END))
  FROM (SELECT _event_entity(r.entity) AS e) x
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION process_email_events(p_limit INT DEFAULT 500) RETURNS INT AS $$
DECLARE q email_event_queue; r email_event_rules; v_n INT; v_total INT := 0;
BEGIN
  PERFORM _email_worker_guard();
  FOR q IN SELECT * FROM email_event_queue WHERE processed_at IS NULL ORDER BY id FOR UPDATE SKIP LOCKED LIMIT p_limit LOOP
    FOR r IN SELECT * FROM email_event_rules WHERE organization_id = q.organization_id AND entity = q.entity AND enabled LOOP
      CONTINUE WHEN NOT _event_rule_matches(r, q);
      INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload, dedupe_key)
      SELECT q.organization_id, x.id, x.email, x.full_name, 'event', _event_payload(r, q, false),
             'evt:' || q.id || ':' || r.id || ':' || x.email
      FROM _event_recipients(r, q) x
      WHERE EXISTS (SELECT 1 FROM org_email_settings s WHERE s.organization_id = q.organization_id AND s.enabled)
      ON CONFLICT (dedupe_key) DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n > 0 THEN
        UPDATE email_event_rules SET last_fired_at = now(), fire_count = fire_count + 1 WHERE id = r.id;
        v_total := v_total + v_n;
      END IF;
    END LOOP;
    UPDATE email_event_queue SET processed_at = now() WHERE id = q.id;
  END LOOP;
  DELETE FROM email_event_queue WHERE processed_at < now() - interval '7 days';
  RETURN v_total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION process_email_events(INT) TO service_role;

-- "Test" in the builder: take the newest record of the rule's type, render
-- the rule's email for it and send it to the caller only (conditions are
-- shown but not enforced, so there's always something to look at).
CREATE OR REPLACE FUNCTION preview_event_rule(p_rule_id UUID) RETURNS TEXT AS $$
DECLARE r email_event_rules; q email_event_queue; me profiles; v_row JSONB; v_table TEXT; v_order TEXT; v_match BOOLEAN;
BEGIN
  IF NOT is_org_email_admin() THEN RAISE EXCEPTION 'Only an admin can test event rules'; END IF;
  SELECT * INTO r FROM email_event_rules WHERE id = p_rule_id AND organization_id = current_org_id();
  IF r.id IS NULL THEN RAISE EXCEPTION 'Rule not found'; END IF;
  SELECT * INTO me FROM profiles WHERE id = auth.uid();
  IF me.email IS NULL THEN RAISE EXCEPTION 'Your profile has no email address'; END IF;
  v_table := _event_entity(r.entity)->>'table';
  v_order := CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = v_table AND column_name = 'created_at') THEN 'created_at DESC' ELSE '1' END;
  IF v_table = 'timesheet_approvals' THEN
    EXECUTE format('SELECT to_jsonb(t) FROM %I t JOIN profiles p ON p.id = t.employee_id WHERE p.organization_id = $1 ORDER BY t.%s LIMIT 1', v_table, v_order) INTO v_row USING r.organization_id;
  ELSE
    EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE t.organization_id = $1 ORDER BY t.%s LIMIT 1', v_table, v_order) INTO v_row USING r.organization_id;
  END IF;
  IF v_row IS NULL THEN RAISE EXCEPTION 'There are no % records yet to test with', lower(_event_entity(r.entity)->>'label'); END IF;
  q := ROW(0, r.organization_id, r.entity, CASE WHEN r.event = 'created' THEN 'INSERT' ELSE 'UPDATE' END, v_row,
           CASE WHEN r.event = 'status_changed' THEN v_row || jsonb_build_object(_event_entity(r.entity)->>'status', '(previous)') END,
           auth.uid(), now(), NULL)::email_event_queue;
  INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload)
  VALUES (r.organization_id, me.id, me.email, me.full_name, 'event', _event_payload(r, q, true));
  v_match := _event_rule_matches(r, q);
  RETURN COALESCE(q.new_row->>(_event_entity(r.entity)->>'title'), 'record') || CASE WHEN v_match THEN '' ELSE ' (note: this record does not meet the rule''s conditions)' END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION preview_event_rule(UUID) TO authenticated;

-- Distinct status values seen for an entity in the caller's org (builder suggestions).
CREATE OR REPLACE FUNCTION event_status_values(p_entity TEXT) RETURNS TEXT[] AS $$
DECLARE e JSONB := _event_entity(p_entity); v TEXT[];
BEGIN
  IF e IS NULL OR NOT is_org_email_admin() THEN RETURN '{}'; END IF;
  IF e->>'table' = 'timesheet_approvals' THEN
    RETURN ARRAY['draft','pending_manager','pending_hr','pending_finance','approved','rejected'];
  END IF;
  EXECUTE format('SELECT array_agg(DISTINCT %I::text) FROM %I WHERE organization_id = $1 AND %I IS NOT NULL', e->>'status', e->>'table', e->>'status')
    INTO v USING current_org_id();
  RETURN COALESCE(v, '{}');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION event_status_values(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
