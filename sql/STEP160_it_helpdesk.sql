-- ============================================================
-- STEP160: Internal IT Helpdesk — an org-scoped ticketing module for
-- employees to raise IT requests (hardware, software, access, network…)
-- that their own org's admins / managers work.
--
-- Distinct from the platform Support Desk (STEP153–156), which is
-- tenant → SaaS-vendor. This one never leaves a single organization:
--   * every row is organization_id = current_org_id() scoped, no
--     is_platform_super_admin() branch anywhere;
--   * "agent" == a profile in the same org whose role is one of
--     admin / ceo / manager / department_head (it_helpdesk_is_agent());
--   * because requester and agent are always in the same org, profiles'
--     org-scoped RLS resolves fine — list/detail reads are plain client
--     selects, only mutations go through SECURITY DEFINER functions
--     (so status ↔ SLA stamps ↔ notifications never drift apart).
--
-- Config (categories, SLA targets, auto-assignment rules) is per-org and
-- editable by admin/ceo from /it-helpdesk/settings. ensure_it_helpdesk_seed()
-- lazily seeds sensible defaults the first time an admin opens the module
-- (same self-healing pattern as syncModulesFromConfig / modules.js).
--
-- Billing: it-helpdesk is folded into the existing hr_resources bundle
-- (STEP124) at the bottom of this file.
-- ============================================================

/* ═══════════════ Tables ═══════════════ */

CREATE TABLE IF NOT EXISTS it_helpdesk_categories (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  key             TEXT        NOT NULL,
  label           TEXT        NOT NULL,
  sort_order      INT         NOT NULL DEFAULT 0,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, key)
);

CREATE TABLE IF NOT EXISTS it_helpdesk_sla_policies (
  id                     UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id        UUID        NOT NULL DEFAULT current_org_id(),
  priority               TEXT        NOT NULL CHECK (priority IN ('low','medium','high','urgent')),
  first_response_minutes INT         NOT NULL,
  resolution_minutes     INT         NOT NULL,
  is_active              BOOLEAN     NOT NULL DEFAULT true,
  updated_at             TIMESTAMPTZ DEFAULT now(),
  updated_by             UUID        REFERENCES profiles(id),
  UNIQUE (organization_id, priority)
);

-- category / priority NULL = "applies to any". Most specific active rule
-- wins (see create_it_ticket ordering). 'least_loaded' picks whichever
-- agent has the fewest open/in_progress tickets right now; 'manual_default'
-- pins to one configured assignee.
CREATE TABLE IF NOT EXISTS it_helpdesk_assignment_rules (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  category        TEXT,
  priority        TEXT        CHECK (priority IN ('low','medium','high','urgent')),
  rule_type       TEXT        NOT NULL DEFAULT 'least_loaded' CHECK (rule_type IN ('least_loaded','manual_default')),
  assigned_to     UUID        REFERENCES profiles(id),
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  sort_order      INT         NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS it_helpdesk_tickets (
  id                     UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id        UUID        NOT NULL DEFAULT current_org_id(),
  ticket_number          TEXT        NOT NULL,
  subject                TEXT        NOT NULL,
  description            TEXT        NOT NULL,
  category               TEXT        NOT NULL DEFAULT 'other',
  priority               TEXT        NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status                 TEXT        NOT NULL DEFAULT 'open'   CHECK (status IN ('open','in_progress','waiting_on_requester','resolved','closed')),
  requester_id           UUID        NOT NULL REFERENCES profiles(id),
  assigned_to            UUID        REFERENCES profiles(id),
  first_response_due_at  TIMESTAMPTZ,
  resolution_due_at      TIMESTAMPTZ,
  first_response_at      TIMESTAMPTZ,
  resolved_at            TIMESTAMPTZ,
  closed_at              TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, ticket_number)
);
CREATE INDEX IF NOT EXISTS it_helpdesk_tickets_org_idx      ON it_helpdesk_tickets(organization_id);
CREATE INDEX IF NOT EXISTS it_helpdesk_tickets_status_idx   ON it_helpdesk_tickets(status);
CREATE INDEX IF NOT EXISTS it_helpdesk_tickets_assigned_idx ON it_helpdesk_tickets(assigned_to);
CREATE INDEX IF NOT EXISTS it_helpdesk_tickets_requester_idx ON it_helpdesk_tickets(requester_id);

CREATE TABLE IF NOT EXISTS it_helpdesk_ticket_messages (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id   UUID        NOT NULL REFERENCES it_helpdesk_tickets(id) ON DELETE CASCADE,
  author_id   UUID        REFERENCES profiles(id),
  body        TEXT        NOT NULL,
  is_internal BOOLEAN     NOT NULL DEFAULT false,  -- agent-only note, never shown to the requester
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS it_helpdesk_ticket_messages_ticket_idx ON it_helpdesk_ticket_messages(ticket_id);

/* ═══════════════ Helpers ═══════════════ */

-- An "agent" is anyone in the caller's org who works tickets.
CREATE OR REPLACE FUNCTION it_helpdesk_is_agent() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head')
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION can_view_it_ticket(p_ticket_id UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM it_helpdesk_tickets t
    WHERE t.id = p_ticket_id
      AND t.organization_id = current_org_id()
      AND (t.requester_id = auth.uid() OR it_helpdesk_is_agent())
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION next_it_ticket_number() RETURNS TEXT AS $$
  SELECT 'ITH-' || to_char(now(),'YYYY') || '-' || lpad((
    SELECT COALESCE(count(*),0) + 1 FROM it_helpdesk_tickets
    WHERE organization_id = current_org_id() AND created_at >= date_trunc('year', now())
  )::text, 5, '0')
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

/* ═══════════════ RLS ═══════════════ */

ALTER TABLE it_helpdesk_categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE it_helpdesk_sla_policies      ENABLE ROW LEVEL SECURITY;
ALTER TABLE it_helpdesk_assignment_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE it_helpdesk_tickets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE it_helpdesk_ticket_messages   ENABLE ROW LEVEL SECURITY;

-- Config tables: any org member reads (the new-ticket form needs the
-- category list); only admin/ceo writes.
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['it_helpdesk_categories','it_helpdesk_sla_policies','it_helpdesk_assignment_rules']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_select ON %1$s', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_write  ON %1$s', tbl);
    EXECUTE format($f$CREATE POLICY %1$s_select ON %1$s FOR SELECT USING (organization_id = current_org_id())$f$, tbl);
    EXECUTE format($f$CREATE POLICY %1$s_write ON %1$s FOR ALL
      USING (organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo')))
      WITH CHECK (organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo')))$f$, tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%s TO authenticated', tbl);
  END LOOP;
END $$;

DROP POLICY IF EXISTS it_helpdesk_tickets_select ON it_helpdesk_tickets;
DROP POLICY IF EXISTS it_helpdesk_tickets_insert ON it_helpdesk_tickets;
CREATE POLICY it_helpdesk_tickets_select ON it_helpdesk_tickets FOR SELECT USING (
  organization_id = current_org_id() AND (requester_id = auth.uid() OR it_helpdesk_is_agent())
);
-- Any org member may raise a ticket. requester_id must be the caller.
CREATE POLICY it_helpdesk_tickets_insert ON it_helpdesk_tickets FOR INSERT WITH CHECK (
  organization_id = current_org_id() AND requester_id = auth.uid()
);
-- No UPDATE/DELETE grant — mutations go through the functions below.
GRANT SELECT, INSERT ON public.it_helpdesk_tickets TO authenticated;

DROP POLICY IF EXISTS it_helpdesk_ticket_messages_select ON it_helpdesk_ticket_messages;
DROP POLICY IF EXISTS it_helpdesk_ticket_messages_insert ON it_helpdesk_ticket_messages;
CREATE POLICY it_helpdesk_ticket_messages_select ON it_helpdesk_ticket_messages FOR SELECT USING (
  can_view_it_ticket(ticket_id) AND (NOT is_internal OR it_helpdesk_is_agent())
);
CREATE POLICY it_helpdesk_ticket_messages_insert ON it_helpdesk_ticket_messages FOR INSERT WITH CHECK (
  can_view_it_ticket(ticket_id) AND author_id = auth.uid() AND (NOT is_internal OR it_helpdesk_is_agent())
);
GRANT SELECT, INSERT ON public.it_helpdesk_ticket_messages TO authenticated;

/* ═══════════════ Lifecycle functions ═══════════════ */

-- Auto-assignment pool is deliberately manager / department_head only —
-- least_loaded should not silently drop tickets on the CEO. Manual
-- assignment (assign_it_ticket) still allows any agent-role profile.
CREATE OR REPLACE FUNCTION create_it_ticket(
  p_subject TEXT, p_description TEXT, p_category TEXT, p_priority TEXT DEFAULT 'medium'
) RETURNS UUID AS $$
DECLARE
  v_org_id   UUID;
  v_ticket   UUID;
  v_number   TEXT;
  v_policy   RECORD;
  v_rule     RECORD;
  v_assignee UUID;
  v_attempt  INT := 0;
BEGIN
  SELECT organization_id INTO v_org_id FROM profiles WHERE id = auth.uid();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;
  IF p_priority NOT IN ('low','medium','high','urgent') THEN p_priority := 'medium'; END IF;
  IF coalesce(trim(p_subject),'') = '' OR coalesce(trim(p_description),'') = '' THEN
    RAISE EXCEPTION 'Subject and description are required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM it_helpdesk_categories WHERE organization_id = v_org_id AND key = p_category AND is_active) THEN
    RAISE EXCEPTION 'Unknown or inactive category "%"', p_category;
  END IF;

  SELECT * INTO v_policy FROM it_helpdesk_sla_policies
  WHERE organization_id = v_org_id AND priority = p_priority AND is_active;

  SELECT r.* INTO v_rule FROM it_helpdesk_assignment_rules r
  WHERE r.organization_id = v_org_id AND r.is_active
    AND (r.category IS NULL OR r.category = p_category)
    AND (r.priority IS NULL OR r.priority = p_priority)
  ORDER BY (r.category IS NOT NULL)::int + (r.priority IS NOT NULL)::int DESC, r.sort_order
  LIMIT 1;

  IF v_rule.rule_type = 'manual_default'
     AND EXISTS (SELECT 1 FROM profiles WHERE id = v_rule.assigned_to AND organization_id = v_org_id
                 AND is_active AND role IN ('admin','ceo','manager','department_head')) THEN
    v_assignee := v_rule.assigned_to;
  ELSE
    SELECT p.id INTO v_assignee FROM profiles p
    WHERE p.organization_id = v_org_id AND p.is_active AND p.role IN ('manager','department_head')
    ORDER BY (SELECT count(*) FROM it_helpdesk_tickets t
              WHERE t.assigned_to = p.id AND t.status IN ('open','in_progress')) ASC, random()
    LIMIT 1;
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    v_number := next_it_ticket_number();
    BEGIN
      INSERT INTO it_helpdesk_tickets (
        organization_id, ticket_number, subject, description, category, priority,
        requester_id, assigned_to, first_response_due_at, resolution_due_at
      ) VALUES (
        v_org_id, v_number, p_subject, p_description, p_category, p_priority,
        auth.uid(), v_assignee,
        CASE WHEN v_policy.id IS NOT NULL THEN now() + (v_policy.first_response_minutes || ' minutes')::interval END,
        CASE WHEN v_policy.id IS NOT NULL THEN now() + (v_policy.resolution_minutes    || ' minutes')::interval END
      ) RETURNING id INTO v_ticket;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN RAISE; END IF;   -- concurrent numbering race — retry
    END;
  END LOOP;

  IF v_assignee IS NOT NULL THEN
    INSERT INTO notifications (recipient_id, type, title, body, link)
    VALUES (v_assignee, 'it_helpdesk_assigned', 'New IT ticket: ' || v_number, p_subject, '/it-helpdesk/' || v_ticket);
  ELSE
    INSERT INTO notifications (recipient_id, type, title, body, link)
    SELECT p.id, 'it_helpdesk_unassigned', 'Unassigned IT ticket: ' || v_number, p_subject, '/it-helpdesk/' || v_ticket
    FROM profiles p WHERE p.organization_id = v_org_id AND p.is_active
      AND p.role IN ('admin','ceo','manager','department_head');
  END IF;

  RETURN v_ticket;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION create_it_ticket(TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION post_it_ticket_message(p_ticket_id UUID, p_body TEXT, p_is_internal BOOLEAN DEFAULT false)
RETURNS UUID AS $$
DECLARE v_ticket RECORD; v_msg UUID; v_is_agent BOOLEAN;
BEGIN
  IF NOT can_view_it_ticket(p_ticket_id) THEN RAISE EXCEPTION 'Ticket not found'; END IF;
  IF coalesce(trim(p_body),'') = '' THEN RAISE EXCEPTION 'Message body is required'; END IF;
  v_is_agent := it_helpdesk_is_agent();
  IF p_is_internal AND NOT v_is_agent THEN RAISE EXCEPTION 'Only agents can add internal notes'; END IF;

  SELECT * INTO v_ticket FROM it_helpdesk_tickets WHERE id = p_ticket_id;

  INSERT INTO it_helpdesk_ticket_messages (ticket_id, author_id, body, is_internal)
  VALUES (p_ticket_id, auth.uid(), p_body, p_is_internal)
  RETURNING id INTO v_msg;

  IF v_is_agent AND NOT p_is_internal THEN
    UPDATE it_helpdesk_tickets
      SET first_response_at = COALESCE(first_response_at, now()), updated_at = now()
      WHERE id = p_ticket_id;
    IF v_ticket.requester_id <> auth.uid() THEN
      INSERT INTO notifications (recipient_id, type, title, body, link)
      VALUES (v_ticket.requester_id, 'it_helpdesk_reply', 'Reply on ' || v_ticket.ticket_number, left(p_body, 140), '/it-helpdesk/' || p_ticket_id);
    END IF;
  ELSIF NOT v_is_agent THEN
    UPDATE it_helpdesk_tickets SET updated_at = now() WHERE id = p_ticket_id;
    IF v_ticket.assigned_to IS NOT NULL THEN
      INSERT INTO notifications (recipient_id, type, title, body, link)
      VALUES (v_ticket.assigned_to, 'it_helpdesk_reply', 'Reply on ' || v_ticket.ticket_number, left(p_body, 140), '/it-helpdesk/' || p_ticket_id);
    END IF;
  END IF;

  RETURN v_msg;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION post_it_ticket_message(UUID, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION assign_it_ticket(p_ticket_id UUID, p_assignee UUID)
RETURNS VOID AS $$
DECLARE v_org UUID; v_number TEXT; v_subject TEXT;
BEGIN
  IF NOT it_helpdesk_is_agent() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT organization_id INTO v_org FROM it_helpdesk_tickets WHERE id = p_ticket_id;
  IF v_org IS NULL OR v_org <> current_org_id() THEN RAISE EXCEPTION 'Ticket not found'; END IF;
  IF p_assignee IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = p_assignee AND organization_id = v_org AND is_active
      AND role IN ('admin','ceo','manager','department_head')
  ) THEN RAISE EXCEPTION 'That person is not an IT agent'; END IF;

  UPDATE it_helpdesk_tickets SET assigned_to = p_assignee, updated_at = now()
  WHERE id = p_ticket_id RETURNING ticket_number, subject INTO v_number, v_subject;

  IF p_assignee IS NOT NULL THEN
    INSERT INTO notifications (recipient_id, type, title, body, link)
    VALUES (p_assignee, 'it_helpdesk_assigned', 'Assigned: ' || v_number, v_subject, '/it-helpdesk/' || p_ticket_id);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION assign_it_ticket(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION update_it_ticket_status(p_ticket_id UUID, p_status TEXT)
RETURNS VOID AS $$
DECLARE v_ticket RECORD;
BEGIN
  IF NOT it_helpdesk_is_agent() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_status NOT IN ('open','in_progress','waiting_on_requester','resolved','closed') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  SELECT * INTO v_ticket FROM it_helpdesk_tickets WHERE id = p_ticket_id AND organization_id = current_org_id();
  IF v_ticket IS NULL THEN RAISE EXCEPTION 'Ticket not found'; END IF;

  UPDATE it_helpdesk_tickets SET
    status      = p_status,
    resolved_at = CASE WHEN p_status = 'resolved' AND v_ticket.resolved_at IS NULL THEN now() ELSE v_ticket.resolved_at END,
    closed_at   = CASE WHEN p_status = 'closed'   AND v_ticket.closed_at   IS NULL THEN now() ELSE v_ticket.closed_at   END,
    updated_at  = now()
  WHERE id = p_ticket_id;

  IF p_status IN ('resolved','closed') AND v_ticket.requester_id <> auth.uid() THEN
    INSERT INTO notifications (recipient_id, type, title, body, link)
    VALUES (v_ticket.requester_id, 'it_helpdesk_' || p_status,
      initcap(p_status) || ': ' || v_ticket.ticket_number, v_ticket.subject, '/it-helpdesk/' || p_ticket_id);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION update_it_ticket_status(UUID, TEXT) TO authenticated;

-- Priority change recomputes SLA due dates from the ORIGINAL created_at,
-- so re-triaging to 'urgent' doesn't grant a fresh clock.
CREATE OR REPLACE FUNCTION update_it_ticket_priority(p_ticket_id UUID, p_priority TEXT)
RETURNS VOID AS $$
DECLARE v_ticket RECORD; v_policy RECORD;
BEGIN
  IF NOT it_helpdesk_is_agent() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_priority NOT IN ('low','medium','high','urgent') THEN RAISE EXCEPTION 'Invalid priority'; END IF;
  SELECT * INTO v_ticket FROM it_helpdesk_tickets WHERE id = p_ticket_id AND organization_id = current_org_id();
  IF v_ticket IS NULL THEN RAISE EXCEPTION 'Ticket not found'; END IF;
  SELECT * INTO v_policy FROM it_helpdesk_sla_policies
  WHERE organization_id = v_ticket.organization_id AND priority = p_priority AND is_active;

  UPDATE it_helpdesk_tickets SET
    priority              = p_priority,
    first_response_due_at = CASE WHEN v_policy.id IS NOT NULL THEN v_ticket.created_at + (v_policy.first_response_minutes || ' minutes')::interval ELSE first_response_due_at END,
    resolution_due_at     = CASE WHEN v_policy.id IS NOT NULL THEN v_ticket.created_at + (v_policy.resolution_minutes    || ' minutes')::interval ELSE resolution_due_at END,
    updated_at            = now()
  WHERE id = p_ticket_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION update_it_ticket_priority(UUID, TEXT) TO authenticated;

-- ── Dashboard aggregates (agents only) ──
CREATE OR REPLACE FUNCTION it_helpdesk_stats()
RETURNS TABLE (
  open_count BIGINT, in_progress_count BIGINT, waiting_count BIGINT, unassigned_count BIGINT,
  resolved_7d BIGINT, overdue_response BIGINT, overdue_resolution BIGINT, avg_resolution_hours NUMERIC
) AS $$
  SELECT
    count(*) FILTER (WHERE status = 'open'),
    count(*) FILTER (WHERE status = 'in_progress'),
    count(*) FILTER (WHERE status = 'waiting_on_requester'),
    count(*) FILTER (WHERE status IN ('open','in_progress','waiting_on_requester') AND assigned_to IS NULL),
    count(*) FILTER (WHERE status IN ('resolved','closed') AND resolved_at >= now() - interval '7 days'),
    count(*) FILTER (WHERE status NOT IN ('resolved','closed') AND first_response_at IS NULL AND first_response_due_at < now()),
    count(*) FILTER (WHERE status NOT IN ('resolved','closed') AND resolution_due_at < now()),
    round((avg(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600.0) FILTER (WHERE resolved_at IS NOT NULL))::numeric, 1)
  FROM it_helpdesk_tickets
  WHERE organization_id = current_org_id() AND it_helpdesk_is_agent()
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION it_helpdesk_stats() TO authenticated;

-- ── Lazy per-org defaults (admin/ceo opens the module → seed once) ──
CREATE OR REPLACE FUNCTION ensure_it_helpdesk_seed()
RETURNS VOID AS $$
DECLARE v_org UUID := current_org_id();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo')) THEN
    RETURN;  -- silent no-op for non-admins, same as syncModulesFromConfig
  END IF;

  INSERT INTO it_helpdesk_categories (organization_id, key, label, sort_order)
  SELECT v_org, x.key, x.label, x.ord FROM (VALUES
    ('hardware','Hardware',1),
    ('software','Software / Applications',2),
    ('access','Access & Accounts',3),
    ('network','Network / Connectivity',4),
    ('email','Email',5),
    ('security','Security',6),
    ('other','Other',7)
  ) AS x(key,label,ord)
  WHERE NOT EXISTS (SELECT 1 FROM it_helpdesk_categories c WHERE c.organization_id = v_org AND c.key = x.key);

  INSERT INTO it_helpdesk_sla_policies (organization_id, priority, first_response_minutes, resolution_minutes)
  SELECT v_org, x.priority, x.frm, x.rm FROM (VALUES
    ('urgent',30,240),
    ('high',120,1440),
    ('medium',480,4320),
    ('low',1440,10080)
  ) AS x(priority,frm,rm)
  WHERE NOT EXISTS (SELECT 1 FROM it_helpdesk_sla_policies s WHERE s.organization_id = v_org AND s.priority = x.priority);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION ensure_it_helpdesk_seed() TO authenticated;

/* ═══════════════ Billing: fold into the hr_resources bundle (STEP124) ═══════════════ */
-- STEP124 seeds billing_bundles with ON CONFLICT DO NOTHING, so a plain
-- re-run there would never pick this up — append the key here instead.
UPDATE billing_bundles
SET module_keys = module_keys || '["it-helpdesk"]'::jsonb
WHERE key = 'hr_resources' AND NOT (module_keys ? 'it-helpdesk');

NOTIFY pgrst, 'reload schema';
