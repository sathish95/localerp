-- ============================================================
-- STEP155: Support Desk — lifecycle functions (Phase 1 continued).
-- Every mutation on support_tickets goes through one of these
-- SECURITY DEFINER functions (no direct UPDATE grant exists on the
-- table itself — see STEP153) so status transitions, SLA timestamps,
-- assignment, and notifications can never drift out of sync with each
-- other the way separate client-side writes could.
-- ============================================================

-- ── create_support_ticket() — any org member (STEP153's INSERT policy
-- already allows this at the table level; this function is what a
-- normal ticket submission actually calls, since it also has to stamp
-- SLA due dates and run assignment, neither of which a plain INSERT
-- could do safely from the client). ──
CREATE OR REPLACE FUNCTION create_support_ticket(p_subject TEXT, p_description TEXT, p_category TEXT, p_priority TEXT DEFAULT 'medium', p_project_id UUID DEFAULT NULL)
RETURNS UUID AS $$
DECLARE
  v_org_id UUID;
  v_ticket_id UUID;
  v_number TEXT;
  v_policy RECORD;
  v_agent_id UUID;
  v_rule RECORD;
  v_project_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM profiles WHERE id = auth.uid();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;
  IF p_priority NOT IN ('low', 'medium', 'high', 'urgent') THEN p_priority := 'medium'; END IF;

  -- project_id is a soft reference (no FK) and this function is
  -- SECURITY DEFINER (bypasses RLS on its own writes) — re-verify the
  -- project actually belongs to the caller's own org before accepting
  -- it, same defense-in-depth already used for scenario_links elsewhere
  -- in this app, so a crafted client request can't tag a ticket against
  -- another org's project.
  IF p_project_id IS NOT NULL AND EXISTS (SELECT 1 FROM projects WHERE id = p_project_id AND organization_id = v_org_id) THEN
    v_project_id := p_project_id;
  END IF;

  v_number := next_ticket_number();

  SELECT * INTO v_policy FROM support_sla_policies WHERE priority = p_priority AND is_active;

  -- ── Assignment: most specific active rule wins (category+priority >
  -- category-only > priority-only > catch-all). A 'manual_default' rule
  -- assigns straight to its configured agent (if still active); anything
  -- else — including no rule at all — falls back to whichever active
  -- agent currently has the fewest open/in_progress tickets. ──
  SELECT r.* INTO v_rule FROM support_assignment_rules r
  WHERE r.is_active
    AND (r.category IS NULL OR r.category = p_category)
    AND (r.priority IS NULL OR r.priority = p_priority)
  ORDER BY (r.category IS NOT NULL)::int + (r.priority IS NOT NULL)::int DESC, r.sort_order
  LIMIT 1;

  IF v_rule.rule_type = 'manual_default' AND EXISTS (SELECT 1 FROM support_agents WHERE profile_id = v_rule.assigned_agent_id AND is_active) THEN
    v_agent_id := v_rule.assigned_agent_id;
  ELSE
    SELECT a.profile_id INTO v_agent_id FROM support_agents a
    WHERE a.is_active
    ORDER BY (SELECT count(*) FROM support_tickets t WHERE t.assigned_agent_id = a.profile_id AND t.status IN ('open', 'in_progress')) ASC, random()
    LIMIT 1;
  END IF;

  INSERT INTO support_tickets (
    organization_id, ticket_number, subject, description, category, priority, created_by, assigned_agent_id, project_id,
    first_response_due_at, resolution_due_at
  ) VALUES (
    v_org_id, v_number, p_subject, p_description, p_category, p_priority, auth.uid(), v_agent_id, v_project_id,
    CASE WHEN v_policy.id IS NOT NULL THEN now() + (v_policy.first_response_minutes || ' minutes')::interval ELSE NULL END,
    CASE WHEN v_policy.id IS NOT NULL THEN now() + (v_policy.resolution_minutes || ' minutes')::interval ELSE NULL END
  ) RETURNING id INTO v_ticket_id;

  IF v_agent_id IS NOT NULL THEN
    INSERT INTO notifications (recipient_id, type, title, body, link)
    VALUES (v_agent_id, 'support_ticket_assigned', 'New support ticket: ' || v_number, p_subject, '/support/' || v_ticket_id);
  ELSE
    -- No agent to assign — notify every active agent so it doesn't sit invisible.
    INSERT INTO notifications (recipient_id, type, title, body, link)
    SELECT a.profile_id, 'support_ticket_unassigned', 'Unassigned support ticket: ' || v_number, p_subject, '/support/' || v_ticket_id
    FROM support_agents a WHERE a.is_active;
  END IF;

  RETURN v_ticket_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION create_support_ticket(TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;

-- ── post_ticket_message() — both sides reply through this (never a
-- plain INSERT), so first_response_at gets stamped exactly once, by
-- whichever agent replies first, and the right party gets notified. ──
CREATE OR REPLACE FUNCTION post_ticket_message(p_ticket_id UUID, p_body TEXT, p_is_internal_note BOOLEAN DEFAULT false)
RETURNS UUID AS $$
DECLARE
  v_ticket RECORD;
  v_message_id UUID;
  v_is_agent BOOLEAN;
BEGIN
  IF NOT can_view_support_ticket(p_ticket_id) THEN RAISE EXCEPTION 'Ticket not found'; END IF;
  IF p_is_internal_note AND NOT is_platform_super_admin() THEN RAISE EXCEPTION 'Only platform staff can add internal notes'; END IF;

  SELECT * INTO v_ticket FROM support_tickets WHERE id = p_ticket_id;
  v_is_agent := is_platform_super_admin();

  INSERT INTO support_ticket_messages (ticket_id, author_id, body, is_internal_note)
  VALUES (p_ticket_id, auth.uid(), p_body, p_is_internal_note)
  RETURNING id INTO v_message_id;

  IF v_is_agent AND NOT p_is_internal_note THEN
    IF v_ticket.first_response_at IS NULL THEN
      UPDATE support_tickets SET first_response_at = now(), updated_at = now() WHERE id = p_ticket_id;
    ELSE
      UPDATE support_tickets SET updated_at = now() WHERE id = p_ticket_id;
    END IF;
    INSERT INTO notifications (recipient_id, type, title, body, link)
    VALUES (v_ticket.created_by, 'support_ticket_reply', 'New reply on ' || v_ticket.ticket_number, left(p_body, 140), '/support/' || p_ticket_id);
  ELSIF NOT v_is_agent THEN
    UPDATE support_tickets SET updated_at = now() WHERE id = p_ticket_id;
    IF v_ticket.assigned_agent_id IS NOT NULL THEN
      INSERT INTO notifications (recipient_id, type, title, body, link)
      VALUES (v_ticket.assigned_agent_id, 'support_ticket_reply', 'New reply on ' || v_ticket.ticket_number, left(p_body, 140), '/support/' || p_ticket_id);
    END IF;
  END IF;

  RETURN v_message_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION post_ticket_message(UUID, TEXT, BOOLEAN) TO authenticated;

-- ── assign_ticket() / update_ticket_status() / update_ticket_priority()
-- — platform-staff-only actions. Priority changes recompute SLA due
-- dates from the ORIGINAL created_at (not now()), so escalating a
-- ticket to urgent doesn't quietly grant it a fresh 30-minute clock
-- starting from the moment someone happened to re-triage it. ──
CREATE OR REPLACE FUNCTION assign_ticket(p_ticket_id UUID, p_agent_id UUID)
RETURNS VOID AS $$
DECLARE v_number TEXT; v_subject TEXT;
BEGIN
  IF NOT is_platform_super_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_agent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM support_agents WHERE profile_id = p_agent_id AND is_active) THEN
    RAISE EXCEPTION 'Not an active support agent';
  END IF;

  UPDATE support_tickets SET assigned_agent_id = p_agent_id, updated_at = now()
  WHERE id = p_ticket_id
  RETURNING ticket_number, subject INTO v_number, v_subject;
  IF v_number IS NULL THEN RAISE EXCEPTION 'Ticket not found'; END IF;

  IF p_agent_id IS NOT NULL THEN
    INSERT INTO notifications (recipient_id, type, title, body, link)
    VALUES (p_agent_id, 'support_ticket_assigned', 'Assigned: ' || v_number, v_subject, '/support/' || p_ticket_id);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION assign_ticket(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION update_ticket_status(p_ticket_id UUID, p_status TEXT)
RETURNS VOID AS $$
DECLARE v_ticket RECORD;
BEGIN
  IF NOT is_platform_super_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_status NOT IN ('open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed') THEN RAISE EXCEPTION 'Invalid status'; END IF;

  SELECT * INTO v_ticket FROM support_tickets WHERE id = p_ticket_id;
  IF v_ticket IS NULL THEN RAISE EXCEPTION 'Ticket not found'; END IF;

  UPDATE support_tickets SET
    status = p_status,
    resolved_at = CASE WHEN p_status = 'resolved' AND v_ticket.resolved_at IS NULL THEN now() ELSE v_ticket.resolved_at END,
    closed_at = CASE WHEN p_status = 'closed' AND v_ticket.closed_at IS NULL THEN now() ELSE v_ticket.closed_at END,
    updated_at = now()
  WHERE id = p_ticket_id;

  IF p_status IN ('resolved', 'closed') THEN
    INSERT INTO notifications (recipient_id, type, title, body, link)
    VALUES (v_ticket.created_by, 'support_ticket_' || p_status,
      initcap(p_status) || ': ' || v_ticket.ticket_number, v_ticket.subject, '/support/' || p_ticket_id);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION update_ticket_status(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION update_ticket_priority(p_ticket_id UUID, p_priority TEXT)
RETURNS VOID AS $$
DECLARE v_ticket RECORD; v_policy RECORD;
BEGIN
  IF NOT is_platform_super_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_priority NOT IN ('low', 'medium', 'high', 'urgent') THEN RAISE EXCEPTION 'Invalid priority'; END IF;

  SELECT * INTO v_ticket FROM support_tickets WHERE id = p_ticket_id;
  IF v_ticket IS NULL THEN RAISE EXCEPTION 'Ticket not found'; END IF;
  SELECT * INTO v_policy FROM support_sla_policies WHERE priority = p_priority AND is_active;

  UPDATE support_tickets SET
    priority = p_priority,
    first_response_due_at = CASE WHEN v_policy.id IS NOT NULL THEN v_ticket.created_at + (v_policy.first_response_minutes || ' minutes')::interval ELSE first_response_due_at END,
    resolution_due_at = CASE WHEN v_policy.id IS NOT NULL THEN v_ticket.created_at + (v_policy.resolution_minutes || ' minutes')::interval ELSE resolution_due_at END,
    updated_at = now()
  WHERE id = p_ticket_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION update_ticket_priority(UUID, TEXT) TO authenticated;

-- ── Ticket listing/detail RPCs — NOT plain embedded-join selects.
-- profiles' own RLS (organization_id = current_org_id() OR id =
-- auth.uid(), STEP96) has no cross-org bypass for platform staff, so a
-- client-side `select('*, creator:profiles!created_by(full_name)')`
-- would silently return NULL for that name on EVERY ticket where the
-- joined profile sits in a different org than the viewer — which is
-- always true for the agent name on the org side (agents are platform
-- staff, a different org from the reporting org) and for the creator
-- name on the platform side (every org but the viewer's own). Resolving
-- names here, server-side, inside a SECURITY DEFINER function sidesteps
-- that gap entirely rather than papering over it with a profiles RLS
-- change that would widen visibility for the whole app. ──
CREATE OR REPLACE FUNCTION list_my_org_tickets()
RETURNS TABLE (
  id UUID, ticket_number TEXT, subject TEXT, category TEXT, priority TEXT, status TEXT,
  created_by UUID, creator_name TEXT, assigned_agent_id UUID, agent_name TEXT,
  project_id UUID, project_name TEXT,
  first_response_due_at TIMESTAMPTZ, resolution_due_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
) AS $$
  SELECT t.id, t.ticket_number, t.subject, t.category, t.priority, t.status,
    t.created_by, creator.full_name, t.assigned_agent_id, agent.full_name, t.project_id, proj.name,
    t.first_response_due_at, t.resolution_due_at, t.resolved_at, t.created_at, t.updated_at
  FROM support_tickets t
  LEFT JOIN profiles creator ON creator.id = t.created_by
  LEFT JOIN projects proj ON proj.id = t.project_id
  LEFT JOIN profiles agent ON agent.id = t.assigned_agent_id
  WHERE t.organization_id = current_org_id()
    AND (t.created_by = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'ceo', 'manager', 'department_head')))
  ORDER BY t.created_at DESC
  LIMIT 200
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION list_my_org_tickets() TO authenticated;

CREATE OR REPLACE FUNCTION list_all_support_tickets()
RETURNS TABLE (
  id UUID, ticket_number TEXT, subject TEXT, category TEXT, priority TEXT, status TEXT,
  organization_id UUID, org_name TEXT, created_by UUID, creator_name TEXT,
  assigned_agent_id UUID, agent_name TEXT, project_id UUID, project_name TEXT,
  first_response_due_at TIMESTAMPTZ, resolution_due_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
) AS $$
  SELECT t.id, t.ticket_number, t.subject, t.category, t.priority, t.status,
    t.organization_id, org.name, t.created_by, creator.full_name, t.assigned_agent_id, agent.full_name, t.project_id, proj.name,
    t.first_response_due_at, t.resolution_due_at, t.resolved_at, t.created_at, t.updated_at
  FROM support_tickets t
  LEFT JOIN organizations org ON org.id = t.organization_id
  LEFT JOIN profiles creator ON creator.id = t.created_by
  LEFT JOIN profiles agent ON agent.id = t.assigned_agent_id
  LEFT JOIN projects proj ON proj.id = t.project_id
  WHERE is_platform_super_admin()
  ORDER BY t.created_at DESC
  LIMIT 500
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION list_all_support_tickets() TO authenticated;

CREATE OR REPLACE FUNCTION get_ticket_detail(p_ticket_id UUID)
RETURNS TABLE (
  id UUID, ticket_number TEXT, subject TEXT, description TEXT, category TEXT, priority TEXT, status TEXT,
  organization_id UUID, org_name TEXT, created_by UUID, creator_name TEXT, creator_email TEXT,
  assigned_agent_id UUID, agent_name TEXT, project_id UUID, project_name TEXT,
  first_response_due_at TIMESTAMPTZ, resolution_due_at TIMESTAMPTZ, first_response_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
) AS $$
  SELECT t.id, t.ticket_number, t.subject, t.description, t.category, t.priority, t.status,
    t.organization_id, org.name, t.created_by, creator.full_name, creator.email, t.assigned_agent_id, agent.full_name, t.project_id, proj.name,
    t.first_response_due_at, t.resolution_due_at, t.first_response_at, t.resolved_at, t.closed_at, t.created_at, t.updated_at
  FROM support_tickets t
  LEFT JOIN organizations org ON org.id = t.organization_id
  LEFT JOIN profiles creator ON creator.id = t.created_by
  LEFT JOIN profiles agent ON agent.id = t.assigned_agent_id
  LEFT JOIN projects proj ON proj.id = t.project_id
  WHERE t.id = p_ticket_id AND can_view_support_ticket(p_ticket_id)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION get_ticket_detail(UUID) TO authenticated;

-- Same profiles-RLS gap applies to message authors — an org user's
-- reply author name resolves fine (same org), but an agent's author
-- name would not, and vice versa for platform staff reading an org
-- user's message.
CREATE OR REPLACE FUNCTION list_ticket_messages(p_ticket_id UUID)
RETURNS TABLE (id UUID, author_id UUID, author_name TEXT, body TEXT, is_internal_note BOOLEAN, created_at TIMESTAMPTZ) AS $$
  SELECT m.id, m.author_id, author.full_name, m.body, m.is_internal_note, m.created_at
  FROM support_ticket_messages m
  LEFT JOIN profiles author ON author.id = m.author_id
  WHERE m.ticket_id = p_ticket_id
    AND can_view_support_ticket(p_ticket_id)
    AND (NOT m.is_internal_note OR is_platform_super_admin())
  ORDER BY m.created_at
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION list_ticket_messages(UUID) TO authenticated;

-- Same profiles-RLS gap again: an agent's profile can sit in any org,
-- so a plain embedded join from support_agents/support_assignment_rules
-- (both already is_platform_super_admin()-gated at the table level)
-- would still silently null out the agent's own name/email/role.
CREATE OR REPLACE FUNCTION list_support_agents()
RETURNS TABLE (id UUID, profile_id UUID, full_name TEXT, email TEXT, role TEXT, is_active BOOLEAN, created_at TIMESTAMPTZ) AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
    SELECT a.id, a.profile_id, p.full_name, p.email, p.role, a.is_active, a.created_at
    FROM support_agents a JOIN profiles p ON p.id = a.profile_id
    ORDER BY a.created_at;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION list_support_agents() TO authenticated;

CREATE OR REPLACE FUNCTION list_support_assignment_rules()
RETURNS TABLE (id UUID, category TEXT, priority TEXT, rule_type TEXT, assigned_agent_id UUID, agent_name TEXT, is_active BOOLEAN, sort_order INT) AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
    SELECT r.id, r.category, r.priority, r.rule_type, r.assigned_agent_id, p.full_name, r.is_active, r.sort_order
    FROM support_assignment_rules r LEFT JOIN profiles p ON p.id = r.assigned_agent_id
    ORDER BY r.sort_order;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION list_support_assignment_rules() TO authenticated;

-- ── list_platform_staff() — profiles' own RLS is org-scoped
-- (organization_id = current_org_id() OR id = auth.uid(), STEP96), so a
-- plain client query for "every is_super_admin profile" would only ever
-- return the caller's own org's super-admins, not the whole platform —
-- same class of gap super_admin_list_organizations() already exists to
-- close for the orgs table. Needed so Support Desk Settings can offer
-- the full pool of platform accounts when adding an agent. ──
CREATE OR REPLACE FUNCTION list_platform_staff()
RETURNS TABLE (id UUID, full_name TEXT, email TEXT) AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY SELECT p.id, p.full_name, p.email FROM profiles p WHERE p.is_super_admin = true ORDER BY p.full_name;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION list_platform_staff() TO authenticated;

NOTIFY pgrst, 'reload schema';
