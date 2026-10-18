-- ============================================================================
-- STEP160-165 CONSOLIDATED — Internal IT Helpdesk + Mobile app module-access
--
-- One-shot bundle of every pending migration from this workstream. Paste the
-- whole thing into the Supabase SQL Editor and run once. Order matters and is
-- preserved below:
--
--   160  it_helpdesk            — internal IT ticketing (tables, RLS, RPCs);
--                                 folds `it-helpdesk` into the hr_resources bundle
--   161  mobile_module_config   — mobile capability list + per-org override table
--   162  effective_modules      — get_effective_modules() / me_bootstrap() resolver
--                                 (also ADD COLUMN organizations.allocation_enforcement_enabled)
--   163  allocation_enforcement — preview / backfill / set_allocation_enforcement()
--   164  push_outbox            — push_tokens + delivery outbox + notifications trigger
--   165  effective_modules_prev — refactor resolver into a shared helper +
--                                 get_effective_modules_for(user) for the admin preview
--
-- Safe to re-run: everything is CREATE ... IF NOT EXISTS / CREATE OR REPLACE /
-- idempotent DML. Prereqs already in your DB: STEP42 roles, STEP43/89/90 modules,
-- STEP107 billing_plans, STEP124 billing_bundles, STEP131 organization_module_allocations,
-- STEP153-156 support desk helpers (current_org_id, is_platform_super_admin, set_updated_at).
-- ============================================================================




-- ####################################################################
-- >>> STEP160_it_helpdesk.sql
-- ####################################################################

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


-- ####################################################################
-- >>> STEP161_mobile_module_config.sql
-- ####################################################################

-- ============================================================
-- STEP161: Mobile app — module capability + per-org mobile config.
--
-- Two separate concerns, deliberately kept apart:
--
--  1. CAPABILITY (code-owned, global) — does a mobile screen even exist
--     for this module? That's a product fact, not an org setting. Lives
--     in mobile_module_capable_keys(); extend it with a one-line
--     follow-up migration each time a new mobile screen ships.
--
--  2. PREFERENCE (data, per-org) — an org admin wants to hide an
--     otherwise mobile-capable module from their mobile users, or raise
--     the role floor for it. Lives in mobile_module_config. Absence of a
--     row = "capable ⇒ shown" (default-on, same posture as the web
--     `modules` / `module_role_visibility` tables).
--
-- The actual resolution (purchased ∩ org-enabled ∩ role-visible ∩
-- allocated ∩ mobile-eligible) is get_effective_modules() in STEP162.
-- This file only defines the inputs it reads.
-- ============================================================

-- ── Capability: module keys with a built mobile screen (companion set) ──
-- Keep in sync with the mobile app's src/lib/modules.ts registry.
CREATE OR REPLACE FUNCTION mobile_module_capable_keys() RETURNS TEXT[] AS $$
  SELECT ARRAY[
    'dashboard',
    'org-home',
    'tasks',
    'expenses',
    'travel',
    'approvals',
    'it-helpdesk',
    'leave',
    'timesheet'
  ]::text[]
$$ LANGUAGE sql IMMUTABLE;

-- ── Coarse role ranking for mobile_module_config.min_role ──
-- Fine-grained per-screen allow-lists stay in the app; this is only the
-- optional "manager and above" style floor an admin can set per module.
CREATE OR REPLACE FUNCTION mobile_role_rank(p_role TEXT) RETURNS INT AS $$
  SELECT CASE p_role
    WHEN 'admin'            THEN 100
    WHEN 'ceo'              THEN 100
    WHEN 'cto'              THEN 90
    WHEN 'finance'          THEN 60
    WHEN 'hr'               THEN 60
    WHEN 'manager'          THEN 50
    WHEN 'department_head'  THEN 50
    WHEN 'procurement_lead' THEN 50
    WHEN 'pm'               THEN 50
    ELSE 10  -- employee, field_technician, custom/unknown roles
  END
$$ LANGUAGE sql IMMUTABLE;

-- The web "Mobile App" settings tab calls mobile_module_capable_keys()
-- directly to know which modules to show; grant it explicitly.
GRANT EXECUTE ON FUNCTION mobile_module_capable_keys() TO authenticated;
GRANT EXECUTE ON FUNCTION mobile_role_rank(TEXT) TO authenticated;

-- ── Per-org preference override ──
CREATE TABLE IF NOT EXISTS mobile_module_config (
  organization_id UUID        NOT NULL DEFAULT current_org_id() REFERENCES organizations(id) ON DELETE CASCADE,
  module_key      TEXT        NOT NULL,
  is_enabled      BOOLEAN     NOT NULL DEFAULT true,
  min_role        TEXT,                         -- NULL = no extra floor beyond web role-visibility
  updated_by      UUID        REFERENCES profiles(id),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (organization_id, module_key)
);

ALTER TABLE mobile_module_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mobile_module_config_select ON mobile_module_config;
DROP POLICY IF EXISTS mobile_module_config_write  ON mobile_module_config;
-- Any org member reads (the mobile client + the resolver need it); only
-- admin/ceo writes — matches the app's isAdmin gate for settings screens.
CREATE POLICY mobile_module_config_select ON mobile_module_config FOR SELECT USING (
  organization_id = current_org_id() OR is_platform_super_admin()
);
CREATE POLICY mobile_module_config_write ON mobile_module_config FOR ALL USING (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
) WITH CHECK (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mobile_module_config TO authenticated;

-- set_updated_at() is the shared trigger fn from STEP43.
DROP TRIGGER IF EXISTS mobile_module_config_updated_at ON mobile_module_config;
CREATE TRIGGER mobile_module_config_updated_at BEFORE UPDATE ON mobile_module_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

NOTIFY pgrst, 'reload schema';


-- ####################################################################
-- >>> STEP162_effective_modules.sql
-- ####################################################################

-- ============================================================
-- STEP162: The one module-access resolver, shared by every client.
--
-- get_effective_modules(p_platform) returns, for the calling user, one
-- row per module in their org's `modules` table with a boolean `allowed`
-- and, when not allowed, the first failing gate as `reason`:
--
--   purchased      org has the module's billing bundle active, or is on
--                  the enterprise plan  (foundational modules skip this)
--   org_disabled   modules.enabled kill switch is off
--   role_hidden    module_role_visibility says hidden for this role
--                  (admin/ceo bypass, exactly like web isTabVisible())
--   not_allocated  org.allocation_enforcement_enabled is ON and this
--                  user has no organization_module_allocations row for
--                  the module's bundle  (admin/ceo + enterprise bypass)
--   not_on_mobile  p_platform<>'web' and the module has no mobile screen,
--                  or the org disabled it in mobile_module_config, or the
--                  caller is below its min_role floor
--
-- p_platform = 'web' skips only the not_on_mobile gate — every other gate
-- applies identically, so the web app can adopt this same RPC later
-- without behaviour drift.
--
-- me_bootstrap(p_platform) bundles profile + org + effective modules +
-- unread count into one call for a mobile cold start.
-- ============================================================

-- The resolver reads organizations.allocation_enforcement_enabled, which
-- STEP163 owns. Added here too (IF NOT EXISTS) so this file runs whether
-- or not STEP163 has been applied yet — either way the column ends up
-- with the same definition.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS allocation_enforcement_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION get_effective_modules(p_platform TEXT DEFAULT 'web')
RETURNS TABLE (
  module_key TEXT, label TEXT, allowed BOOLEAN, reason TEXT, bundle_key TEXT, source TEXT
) AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_org     UUID := current_org_id();
  v_role    TEXT;
  v_plan    TEXT;
  v_enforce BOOLEAN;
  v_admin   BOOLEAN;
BEGIN
  IF v_uid IS NULL OR v_org IS NULL THEN RETURN; END IF;
  SELECT p.role INTO v_role FROM profiles p WHERE p.id = v_uid;
  IF v_role IS NULL THEN RETURN; END IF;
  v_admin := v_role IN ('admin','ceo');
  SELECT o.plan_key, COALESCE(o.allocation_enforcement_enabled, false)
    INTO v_plan, v_enforce
    FROM organizations o WHERE o.id = v_org;

  RETURN QUERY
  WITH calc AS (
    SELECT
      m.key, m.label, m.enabled,
      module_bundle_key(m.key) AS bkey,
      (module_bundle_key(m.key) IS NULL
        OR v_plan = 'enterprise'
        OR org_has_bundle(module_bundle_key(m.key))) AS purchased,
      (v_admin OR NOT EXISTS (
        SELECT 1 FROM module_role_visibility v
        WHERE v.organization_id = v_org AND v.module_key = m.key AND v.role = v_role AND v.visible = false
      )) AS role_visible,
      (module_bundle_key(m.key) IS NULL
        OR NOT v_enforce
        OR v_admin
        OR v_plan = 'enterprise'
        OR EXISTS (
          SELECT 1 FROM organization_module_allocations a
          WHERE a.organization_id = v_org AND a.bundle_key = module_bundle_key(m.key) AND a.user_id = v_uid
        )) AS allocated,
      (p_platform = 'web' OR (
        m.key = ANY (mobile_module_capable_keys())
        AND COALESCE((SELECT c.is_enabled FROM mobile_module_config c
                      WHERE c.organization_id = v_org AND c.module_key = m.key), true)
        AND mobile_role_rank(v_role) >= mobile_role_rank(
              COALESCE((SELECT c.min_role FROM mobile_module_config c
                        WHERE c.organization_id = v_org AND c.module_key = m.key), 'employee'))
      )) AS mobile_ok
    FROM modules m
    WHERE m.organization_id = v_org
  )
  SELECT
    c.key, c.label,
    (c.purchased AND c.enabled AND c.role_visible AND c.allocated AND c.mobile_ok),
    CASE
      WHEN NOT c.purchased    THEN 'not_purchased'
      WHEN NOT c.enabled      THEN 'org_disabled'
      WHEN NOT c.role_visible THEN 'role_hidden'
      WHEN NOT c.allocated    THEN 'not_allocated'
      WHEN NOT c.mobile_ok    THEN 'not_on_mobile'
      ELSE 'ok'
    END,
    c.bkey,
    COALESCE((SELECT bb.name FROM billing_bundles bb WHERE bb.key = c.bkey), 'Foundational')
  FROM calc c
  ORDER BY c.label;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION get_effective_modules(TEXT) TO authenticated;

-- ── me_bootstrap() — one round trip for the mobile app on launch ──
CREATE OR REPLACE FUNCTION me_bootstrap(p_platform TEXT DEFAULT 'web')
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_org UUID := current_org_id();
  v_res JSONB;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'profile', (
      SELECT jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'email', p.email, 'role', p.role,
        'is_active', p.is_active, 'is_super_admin', p.is_super_admin,
        'organization_id', p.organization_id, 'department_id', p.department_id
      ) FROM profiles p WHERE p.id = v_uid
    ),
    'organization', (
      SELECT jsonb_build_object(
        'id', o.id, 'name', o.name, 'slug', o.slug, 'plan_key', o.plan_key,
        'billing_status', o.billing_status, 'is_active', o.is_active, 'deleted_at', o.deleted_at,
        'allocation_enforcement_enabled', COALESCE(o.allocation_enforcement_enabled, false)
      ) FROM organizations o WHERE o.id = v_org
    ),
    'modules', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'key', module_key, 'label', label, 'allowed', allowed, 'reason', reason,
        'bundle_key', bundle_key, 'source', source
      ) ORDER BY label), '[]'::jsonb)
      FROM get_effective_modules(p_platform)
    ),
    'unread_notifications', (
      SELECT count(*) FROM notifications WHERE recipient_id = v_uid AND read_at IS NULL
    )
  ) INTO v_res;

  RETURN v_res;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION me_bootstrap(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ####################################################################
-- >>> STEP163_module_allocation_enforcement.sql
-- ####################################################################

-- ============================================================
-- STEP163: Make per-user module allocation enforcing.
--
-- STEP131 added organization_module_allocations as an INFORMATIONAL
-- utilization list ("who on my team actually uses this bundle"). This
-- step lets an org turn it into a real access gate:
--
--   organizations.allocation_enforcement_enabled  (NEW column, default
--   FALSE) — while false, get_effective_modules() ignores allocation
--   entirely (unchanged behaviour). While true, a non-admin, non-
--   enterprise user is denied a bundled module unless they hold an
--   allocation row for its bundle. admin/ceo always bypass (they
--   administer the system — same reason they bypass role visibility).
--
-- Flipping the flag on is only safe once every current user who should
-- keep their modules has an allocation row, so:
--
--   preview_allocation_impact()   — dry run: who loses what right now
--   backfill_module_allocations() — grant every active member a row for
--                                   every active bundle in their org
--   set_allocation_enforcement(true)  — runs the backfill THEN flips the
--                                   flag, so "enable" can never strand a
--                                   user who has access today
--
-- Billing is deliberately NOT changed here: org_bundle_monthly_total()
-- still charges by total seats (STEP124). Moving the charge to allocated
-- headcount is a separate pricing decision, out of scope.
--
-- Enforcement is at the resolver + app-route level (matches STEP124's
-- stated "UI-gated" posture); table-level RLS on the bundled feature
-- tables is a later, larger migration.
-- ============================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS allocation_enforcement_enabled BOOLEAN NOT NULL DEFAULT false;

-- ── Dry run: which (user, bundle) pairs would be denied if enforcement
-- were on right now — active members, active bundles, no allocation row,
-- non-admin. ──
CREATE OR REPLACE FUNCTION preview_allocation_impact()
RETURNS TABLE (user_id UUID, full_name TEXT, role TEXT, bundle_key TEXT, bundle_name TEXT) AS $$
DECLARE v_org UUID := current_org_id();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo')) THEN
    RAISE EXCEPTION 'Only an org admin or CEO can preview allocation impact';
  END IF;
  RETURN QUERY
    SELECT p.id, p.full_name, p.role, obs.bundle_key, bb.name
    FROM profiles p
    CROSS JOIN organization_bundle_subscriptions obs
    JOIN billing_bundles bb ON bb.key = obs.bundle_key
    WHERE p.organization_id = v_org AND p.is_active
      AND obs.organization_id = v_org AND obs.status = 'active'
      AND p.role NOT IN ('admin','ceo')
      AND NOT EXISTS (
        SELECT 1 FROM organization_module_allocations a
        WHERE a.organization_id = v_org AND a.bundle_key = obs.bundle_key AND a.user_id = p.id
      )
    ORDER BY p.full_name, bb.name;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION preview_allocation_impact() TO authenticated;

-- ── Backfill: give every active member an allocation row for every
-- active bundle in the caller's org. Idempotent. Returns rows inserted. ──
CREATE OR REPLACE FUNCTION backfill_module_allocations()
RETURNS INT AS $$
DECLARE v_org UUID := current_org_id(); v_count INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo')) THEN
    RAISE EXCEPTION 'Only an org admin or CEO can backfill allocations';
  END IF;
  WITH ins AS (
    INSERT INTO organization_module_allocations (organization_id, bundle_key, user_id, allocated_by)
    SELECT v_org, obs.bundle_key, p.id, auth.uid()
    FROM organization_bundle_subscriptions obs
    JOIN profiles p ON p.organization_id = v_org AND p.is_active
    WHERE obs.organization_id = v_org AND obs.status = 'active'
    ON CONFLICT (organization_id, bundle_key, user_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION backfill_module_allocations() TO authenticated;

-- ── Convenience for "allocate-on-invite": give one member a row for
-- every currently-active bundle. ──
CREATE OR REPLACE FUNCTION allocate_member_all_bundles(p_user_id UUID)
RETURNS INT AS $$
DECLARE v_org UUID := current_org_id(); v_count INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo')) THEN
    RAISE EXCEPTION 'Only an org admin or CEO can allocate modules';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id AND organization_id = v_org) THEN
    RAISE EXCEPTION 'That user is not in your organization';
  END IF;
  WITH ins AS (
    INSERT INTO organization_module_allocations (organization_id, bundle_key, user_id, allocated_by)
    SELECT v_org, obs.bundle_key, p_user_id, auth.uid()
    FROM organization_bundle_subscriptions obs
    WHERE obs.organization_id = v_org AND obs.status = 'active'
    ON CONFLICT (organization_id, bundle_key, user_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION allocate_member_all_bundles(UUID) TO authenticated;

-- ── The safe switch: backfill first, then flip. Disabling just flips. ──
CREATE OR REPLACE FUNCTION set_allocation_enforcement(p_enabled BOOLEAN)
RETURNS BOOLEAN AS $$
DECLARE v_org UUID := current_org_id();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo')) THEN
    RAISE EXCEPTION 'Only an org admin or CEO can change allocation enforcement';
  END IF;
  IF p_enabled THEN
    PERFORM backfill_module_allocations();
  END IF;
  UPDATE organizations SET allocation_enforcement_enabled = p_enabled WHERE id = v_org;
  RETURN p_enabled;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION set_allocation_enforcement(BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ####################################################################
-- >>> STEP164_push_outbox.sql
-- ####################################################################

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


-- ####################################################################
-- >>> STEP165_effective_modules_preview.sql
-- ####################################################################

-- ============================================================
-- STEP165: Let an org admin preview ANOTHER user's effective module
-- access (for the web "Mobile App" settings tab). Factors STEP162's
-- resolver into an internal helper so the self RPC and the preview RPC
-- share one implementation.
--
-- Safe scope: get_effective_modules_for() only runs for a target user in
-- the CALLER's own org, and only for an admin/ceo caller — which also
-- means current_org_id() (used by org_has_bundle() and the subqueries
-- below) is the target user's org too, so the resolution is correct.
-- ============================================================

CREATE OR REPLACE FUNCTION _resolve_effective_modules(p_uid UUID, p_platform TEXT)
RETURNS TABLE (
  module_key TEXT, label TEXT, allowed BOOLEAN, reason TEXT, bundle_key TEXT, source TEXT
) AS $$
DECLARE
  v_org     UUID := current_org_id();
  v_role    TEXT;
  v_plan    TEXT;
  v_enforce BOOLEAN;
  v_admin   BOOLEAN;
BEGIN
  IF p_uid IS NULL OR v_org IS NULL THEN RETURN; END IF;
  SELECT p.role INTO v_role FROM profiles p WHERE p.id = p_uid;
  IF v_role IS NULL THEN RETURN; END IF;
  v_admin := v_role IN ('admin','ceo');
  SELECT o.plan_key, COALESCE(o.allocation_enforcement_enabled, false)
    INTO v_plan, v_enforce
    FROM organizations o WHERE o.id = v_org;

  RETURN QUERY
  WITH calc AS (
    SELECT
      m.key, m.label, m.enabled,
      module_bundle_key(m.key) AS bkey,
      (module_bundle_key(m.key) IS NULL
        OR v_plan = 'enterprise'
        OR org_has_bundle(module_bundle_key(m.key))) AS purchased,
      (v_admin OR NOT EXISTS (
        SELECT 1 FROM module_role_visibility v
        WHERE v.organization_id = v_org AND v.module_key = m.key AND v.role = v_role AND v.visible = false
      )) AS role_visible,
      (module_bundle_key(m.key) IS NULL
        OR NOT v_enforce
        OR v_admin
        OR v_plan = 'enterprise'
        OR EXISTS (
          SELECT 1 FROM organization_module_allocations a
          WHERE a.organization_id = v_org AND a.bundle_key = module_bundle_key(m.key) AND a.user_id = p_uid
        )) AS allocated,
      (p_platform = 'web' OR (
        m.key = ANY (mobile_module_capable_keys())
        AND COALESCE((SELECT c.is_enabled FROM mobile_module_config c
                      WHERE c.organization_id = v_org AND c.module_key = m.key), true)
        AND mobile_role_rank(v_role) >= mobile_role_rank(
              COALESCE((SELECT c.min_role FROM mobile_module_config c
                        WHERE c.organization_id = v_org AND c.module_key = m.key), 'employee'))
      )) AS mobile_ok
    FROM modules m
    WHERE m.organization_id = v_org
  )
  SELECT
    c.key, c.label,
    (c.purchased AND c.enabled AND c.role_visible AND c.allocated AND c.mobile_ok),
    CASE
      WHEN NOT c.purchased    THEN 'not_purchased'
      WHEN NOT c.enabled      THEN 'org_disabled'
      WHEN NOT c.role_visible THEN 'role_hidden'
      WHEN NOT c.allocated    THEN 'not_allocated'
      WHEN NOT c.mobile_ok    THEN 'not_on_mobile'
      ELSE 'ok'
    END,
    c.bkey,
    COALESCE((SELECT bb.name FROM billing_bundles bb WHERE bb.key = c.bkey), 'Foundational')
  FROM calc c
  ORDER BY c.label;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- Public self RPC now delegates (behaviour unchanged from STEP162).
CREATE OR REPLACE FUNCTION get_effective_modules(p_platform TEXT DEFAULT 'web')
RETURNS TABLE (
  module_key TEXT, label TEXT, allowed BOOLEAN, reason TEXT, bundle_key TEXT, source TEXT
) AS $$
  SELECT * FROM _resolve_effective_modules(auth.uid(), p_platform)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION get_effective_modules(TEXT) TO authenticated;

-- Preview another user in the caller's org (admin/ceo only).
CREATE OR REPLACE FUNCTION get_effective_modules_for(p_user_id UUID, p_platform TEXT DEFAULT 'web')
RETURNS TABLE (
  module_key TEXT, label TEXT, allowed BOOLEAN, reason TEXT, bundle_key TEXT, source TEXT
) AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo')) THEN
    RAISE EXCEPTION 'Only an org admin or CEO can preview another user''s access';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id AND organization_id = current_org_id()) THEN
    RAISE EXCEPTION 'That user is not in your organization';
  END IF;
  RETURN QUERY SELECT * FROM _resolve_effective_modules(p_user_id, p_platform);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION get_effective_modules_for(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
