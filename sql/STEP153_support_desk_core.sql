-- ============================================================
-- STEP153: Platform Support Desk — core entities (Phase 1).
--
-- Different shape from every other module in this app: tickets belong
-- to ONE org (the tenant raising them) but must be visible/manageable
-- by PLATFORM staff across every org, not just the org's own members.
-- Every other table's RLS is scoped purely to organization_id =
-- current_org_id(); here it's that OR is_platform_super_admin() (the
-- existing single platform-level flag from STEP89 — confirmed via
-- audit to be the only platform identity concept in this app, no
-- separate "agent" role exists yet, hence support_agents in STEP154).
--
-- organization_id is a soft reference (plain UUID, no FK) — this app's
-- own established convention (see STEP108) — a ticket must survive an
-- org being soft-deleted (deleted_at set), since the platform desk
-- still needs to see/close out tickets for a departing org.
--
-- Any employee can raise a ticket (explicit product decision) — INSERT
-- policy has no role gate at all, only org-membership. Viewing is wider
-- than creating-only: an org's admin/manager/ceo/department_head can
-- see every ticket their org has raised, not just their own, so they
-- can track team-wide support load; a plain employee sees only their
-- own. Platform staff always see everything.
--
-- All mutations (status, priority, assignment) go through STEP155's
-- SECURITY DEFINER functions only — no UPDATE grant on support_tickets
-- at all, matching this app's "only the function writes it" convention
-- (see scenario_approvals/simulation_results) rather than a permissive
-- UPDATE RLS policy that would need to re-derive the same role logic.
-- ============================================================

CREATE TABLE IF NOT EXISTS support_tickets (
  id                     UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id        UUID        NOT NULL DEFAULT current_org_id(),
  ticket_number          TEXT        NOT NULL UNIQUE,
  subject                TEXT        NOT NULL,
  description            TEXT        NOT NULL,
  category               TEXT        NOT NULL DEFAULT 'general' CHECK (category IN ('billing', 'technical', 'feature_request', 'account', 'onboarding', 'general')),
  priority               TEXT        NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status                 TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed')),
  assigned_agent_id      UUID        REFERENCES profiles(id),
  created_by             UUID        NOT NULL REFERENCES profiles(id),
  project_id             UUID, -- soft ref (this app's convention) — optional tag, visibility gated by STEP156's role toggle
  first_response_due_at  TIMESTAMPTZ,
  resolution_due_at      TIMESTAMPTZ,
  first_response_at      TIMESTAMPTZ,
  resolved_at            TIMESTAMPTZ,
  closed_at              TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_tickets_org_idx ON support_tickets(organization_id);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON support_tickets(status);
CREATE INDEX IF NOT EXISTS support_tickets_assigned_idx ON support_tickets(assigned_agent_id);
CREATE INDEX IF NOT EXISTS support_tickets_project_idx ON support_tickets(project_id);
CREATE INDEX IF NOT EXISTS support_tickets_created_by_idx ON support_tickets(created_by);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id        UUID        NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id        UUID        REFERENCES profiles(id),
  body             TEXT        NOT NULL,
  is_internal_note BOOLEAN     NOT NULL DEFAULT false, -- platform-staff-only note, never visible to the reporting org
  created_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_ticket_messages_ticket_idx ON support_ticket_messages(ticket_id);

ALTER TABLE support_tickets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_messages ENABLE ROW LEVEL SECURITY;

-- Shared visibility check, used by both tables below — kept as a function
-- so the messages policy doesn't have to re-derive the same role logic
-- inline (and so a future column rename only needs to change one place).
CREATE OR REPLACE FUNCTION can_view_support_ticket(p_ticket_id UUID)
RETURNS BOOLEAN AS $$
  SELECT
    is_platform_super_admin()
    OR EXISTS (
      SELECT 1 FROM support_tickets t
      JOIN profiles p ON p.id = auth.uid()
      WHERE t.id = p_ticket_id
        AND t.organization_id = p.organization_id
        AND (t.created_by = auth.uid() OR p.role IN ('admin', 'ceo', 'manager', 'department_head'))
    )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

DROP POLICY IF EXISTS support_tickets_select ON support_tickets;
DROP POLICY IF EXISTS support_tickets_insert ON support_tickets;
CREATE POLICY support_tickets_select ON support_tickets FOR SELECT USING (
  is_platform_super_admin()
  OR (
    organization_id = current_org_id()
    AND (created_by = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'ceo', 'manager', 'department_head')))
  )
);
-- Any authenticated org member can raise a ticket — explicit product
-- decision, no role gate. created_by must be the caller (no spoofing).
CREATE POLICY support_tickets_insert ON support_tickets FOR INSERT WITH CHECK (
  organization_id = current_org_id() AND created_by = auth.uid()
);
-- No UPDATE/DELETE grant at all — every mutation goes through STEP155's
-- SECURITY DEFINER functions.
GRANT SELECT, INSERT ON public.support_tickets TO authenticated;

DROP POLICY IF EXISTS support_ticket_messages_select ON support_ticket_messages;
DROP POLICY IF EXISTS support_ticket_messages_insert ON support_ticket_messages;
CREATE POLICY support_ticket_messages_select ON support_ticket_messages FOR SELECT USING (
  can_view_support_ticket(ticket_id) AND (NOT is_internal_note OR is_platform_super_admin())
);
CREATE POLICY support_ticket_messages_insert ON support_ticket_messages FOR INSERT WITH CHECK (
  can_view_support_ticket(ticket_id)
  AND author_id = auth.uid()
  AND (NOT is_internal_note OR is_platform_super_admin())
);
GRANT SELECT, INSERT ON public.support_ticket_messages TO authenticated;

CREATE OR REPLACE FUNCTION next_ticket_number() RETURNS TEXT AS $$
  -- Global (not per-org) sequence — a shared platform desk numbers
  -- tickets from every org in one sequence, same way a real helpdesk
  -- would, rather than risking TKT-2026-0001 existing in five orgs.
  SELECT 'TKT-' || to_char(now(), 'YYYY') || '-' || lpad((
    SELECT COALESCE(count(*), 0) + 1 FROM support_tickets WHERE created_at >= date_trunc('year', now())
  )::text, 5, '0')
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

NOTIFY pgrst, 'reload schema';
