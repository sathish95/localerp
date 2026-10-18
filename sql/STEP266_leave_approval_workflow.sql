-- STEP266 — Multi-step leave approval workflow
--
--   Employee applies → Tech Lead → Manager → HR → Finance → CEO → approved
--
-- * The chain is built per request when it is inserted (web or mobile) by a
--   BEFORE INSERT trigger, so every client gets the same routing.
-- * Stages at or below the applicant's own level are skipped (a Tech Lead's
--   leave starts at Manager, a Manager's at HR, HR's at Finance, ...).
-- * The Tech Lead stage = the applicant's reporting manager when that person
--   is a Tech Lead (role 'lead'); otherwise any active Tech Lead in the same
--   department. No Tech Lead found → the stage is skipped (never stalls).
-- * status stays 'pending' until the last stage approves, so everything that
--   reads leave_requests.status (capacity, calendar, dashboards, emails) is
--   unchanged. A rejection at any stage ends the request.
-- * Decisions go only through leave_decide() (SECURITY DEFINER); a trigger
--   blocks direct client edits of the workflow columns.
-- * admin can act at any stage; nobody approves their own request except
--   the CEO / admin (top of the chain).

ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approval_chain   TEXT[];
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS current_step     INT  DEFAULT 1;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS current_stage    TEXT;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS lead_approver_id UUID;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approval_history JSONB DEFAULT '[]'::jsonb;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Level of each role in the chain (unlisted roles = 0, i.e. a regular employee)
CREATE OR REPLACE FUNCTION leave_role_rank(p_role TEXT) RETURNS INT AS $$
  SELECT CASE p_role
    WHEN 'lead' THEN 1
    WHEN 'manager' THEN 2 WHEN 'department_head' THEN 2
    WHEN 'hr' THEN 3
    WHEN 'finance' THEN 4
    WHEN 'ceo' THEN 5 WHEN 'admin' THEN 5
    ELSE 0 END
$$ LANGUAGE sql IMMUTABLE;

-- Tech Lead for an employee: reporting manager if they are a lead, else NULL
CREATE OR REPLACE FUNCTION leave_lead_for(p_employee UUID) RETURNS UUID AS $$
  SELECT m.id FROM profiles e JOIN profiles m ON m.id = e.reporting_manager_id
  WHERE e.id = p_employee AND m.role = 'lead' AND m.is_active IS NOT FALSE
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION leave_build_chain(p_employee UUID) RETURNS TEXT[] AS $$
DECLARE e profiles; r INT; chain TEXT[] := '{}'; has_lead BOOLEAN;
BEGIN
  SELECT * INTO e FROM profiles WHERE id = p_employee;
  r := leave_role_rank(e.role);
  IF r < 1 THEN
    has_lead := leave_lead_for(p_employee) IS NOT NULL OR EXISTS (
      SELECT 1 FROM profiles p WHERE p.role = 'lead' AND p.is_active IS NOT FALSE
        AND p.id <> p_employee AND p.organization_id = e.organization_id
        AND e.department_id IS NOT NULL AND p.department_id = e.department_id);
    IF has_lead THEN chain := chain || 'lead'::text; END IF;
  END IF;
  IF r < 2 THEN chain := chain || 'manager'::text; END IF;
  IF r < 3 THEN chain := chain || 'hr'::text; END IF;
  IF r < 4 THEN chain := chain || 'finance'::text; END IF;
  chain := chain || 'ceo'::text;   -- CEO is always the final approver
  RETURN chain;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- Can p_user act on the request's current stage?
CREATE OR REPLACE FUNCTION leave_can_act(p_req leave_requests, p_user UUID) RETURNS BOOLEAN AS $$
DECLARE u profiles; emp profiles;
BEGIN
  IF p_req.status <> 'pending' OR p_req.current_stage IS NULL THEN RETURN false; END IF;
  SELECT * INTO u FROM profiles WHERE id = p_user;
  IF u.id IS NULL OR u.is_active IS FALSE OR u.organization_id IS DISTINCT FROM p_req.organization_id THEN RETURN false; END IF;
  IF u.role = 'admin' THEN RETURN true; END IF;
  -- no self-approval below the CEO stage
  IF p_req.employee_id = p_user AND p_req.current_stage <> 'ceo' THEN RETURN false; END IF;
  CASE p_req.current_stage
    WHEN 'lead' THEN
      IF u.role <> 'lead' THEN RETURN false; END IF;
      IF p_req.lead_approver_id IS NOT NULL THEN RETURN p_req.lead_approver_id = p_user; END IF;
      SELECT * INTO emp FROM profiles WHERE id = p_req.employee_id;
      RETURN emp.department_id IS NOT NULL AND emp.department_id = u.department_id;
    WHEN 'manager' THEN RETURN u.role IN ('manager','department_head');
    WHEN 'hr'      THEN RETURN u.role = 'hr';
    WHEN 'finance' THEN RETURN u.role = 'finance';
    WHEN 'ceo'     THEN RETURN u.role = 'ceo';
    ELSE RETURN false;
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- Route a new request
CREATE OR REPLACE FUNCTION leave_requests_route() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    NEW.approval_chain   := leave_build_chain(NEW.employee_id);
    NEW.current_step     := 1;
    NEW.current_stage    := NEW.approval_chain[1];
    NEW.lead_approver_id := leave_lead_for(NEW.employee_id);
    NEW.approval_history := '[]'::jsonb;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_leave_requests_route ON leave_requests;
CREATE TRIGGER trg_leave_requests_route BEFORE INSERT ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION leave_requests_route();

-- Workflow columns can only change through leave_decide()
CREATE OR REPLACE FUNCTION leave_requests_guard() RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('leave.deciding', true) = 'on' THEN RETURN NEW; END IF;
  IF OLD.status = 'pending' AND NEW.status IN ('approved','rejected') THEN
    RAISE EXCEPTION 'Leave decisions go through the approval workflow';
  END IF;
  IF NEW.approval_chain   IS DISTINCT FROM OLD.approval_chain
  OR NEW.current_step     IS DISTINCT FROM OLD.current_step
  OR NEW.current_stage    IS DISTINCT FROM OLD.current_stage
  OR NEW.approval_history IS DISTINCT FROM OLD.approval_history THEN
    RAISE EXCEPTION 'Leave approval fields are read-only';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leave_requests_guard ON leave_requests;
CREATE TRIGGER trg_leave_requests_guard BEFORE UPDATE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION leave_requests_guard();

-- Approve / reject the current stage. Returns the updated row.
CREATE OR REPLACE FUNCTION leave_decide(p_id UUID, p_action TEXT, p_comment TEXT DEFAULT NULL)
RETURNS leave_requests AS $$
DECLARE req leave_requests; me profiles; nxt INT; entry JSONB; recipients UUID[];
BEGIN
  SELECT * INTO req FROM leave_requests WHERE id = p_id FOR UPDATE;
  IF req.id IS NULL THEN RAISE EXCEPTION 'Leave request not found'; END IF;
  IF p_action NOT IN ('approve','reject') THEN RAISE EXCEPTION 'Bad action'; END IF;
  IF NOT leave_can_act(req, auth.uid()) THEN RAISE EXCEPTION 'You cannot act on this request at its current stage'; END IF;
  IF p_action = 'reject' AND NULLIF(trim(p_comment), '') IS NULL THEN RAISE EXCEPTION 'A reason is required to reject'; END IF;

  SELECT * INTO me FROM profiles WHERE id = auth.uid();
  entry := jsonb_build_object('stage', req.current_stage, 'action', p_action, 'by', me.id,
    'by_name', me.full_name, 'by_role', me.role, 'at', now(), 'comment', NULLIF(trim(p_comment), ''));

  PERFORM set_config('leave.deciding', 'on', true);
  IF p_action = 'reject' THEN
    UPDATE leave_requests SET status = 'rejected', current_stage = NULL, rejection_reason = trim(p_comment),
      approved_by = me.id, approved_at = now(), approval_history = COALESCE(approval_history, '[]'::jsonb) || entry
    WHERE id = p_id RETURNING * INTO req;
  ELSE
    nxt := COALESCE(req.current_step, 1) + 1;
    IF nxt > COALESCE(array_length(req.approval_chain, 1), 0) THEN
      UPDATE leave_requests SET status = 'approved', current_stage = NULL, current_step = nxt,
        approved_by = me.id, approved_at = now(), approval_history = COALESCE(approval_history, '[]'::jsonb) || entry
      WHERE id = p_id RETURNING * INTO req;
    ELSE
      UPDATE leave_requests SET current_step = nxt, current_stage = approval_chain[nxt],
        approval_history = COALESCE(approval_history, '[]'::jsonb) || entry
      WHERE id = p_id RETURNING * INTO req;
    END IF;
  END IF;
  PERFORM set_config('leave.deciding', 'off', true);

  -- Notify the applicant, and the next stage's approvers
  INSERT INTO notifications (recipient_id, sender_id, type, title, body, link, organization_id)
  VALUES (req.employee_id, me.id, 'leave',
    CASE WHEN req.status = 'approved' THEN 'Leave approved'
         WHEN req.status = 'rejected' THEN 'Leave rejected'
         ELSE 'Leave approved by ' || initcap(entry->>'stage') || ' — now with ' || initcap(req.current_stage) END,
    req.request_number || COALESCE(' · ' || NULLIF(trim(p_comment), ''), ''), '/leave', req.organization_id);

  IF req.status = 'pending' THEN
    SELECT array_agg(p.id) INTO recipients FROM profiles p
    WHERE p.organization_id = req.organization_id AND p.is_active IS NOT FALSE AND p.id <> req.employee_id
      AND leave_can_act(req, p.id) AND p.role <> 'admin';
    INSERT INTO notifications (recipient_id, sender_id, type, title, body, link, organization_id)
    SELECT unnest(recipients), me.id, 'leave', 'Leave request awaiting your approval', req.request_number, '/leave', req.organization_id;
  END IF;
  RETURN req;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Who should be told about a freshly submitted request (first-stage approvers)
CREATE OR REPLACE FUNCTION leave_stage_approvers(p_id UUID) RETURNS SETOF UUID AS $$
  SELECT p.id FROM leave_requests r JOIN profiles p ON p.organization_id = r.organization_id
  WHERE r.id = p_id AND r.organization_id = current_org_id() AND p.is_active IS NOT FALSE
    AND p.id <> r.employee_id AND p.role <> 'admin' AND leave_can_act(r, p.id)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION leave_decide(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION leave_stage_approvers(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION leave_can_act(leave_requests, UUID) TO authenticated;

-- Route requests that are already pending (start them at the first stage)
DO $$
DECLARE r RECORD; ch TEXT[];
BEGIN
  PERFORM set_config('leave.deciding', 'on', true);
  FOR r IN SELECT id, employee_id FROM leave_requests WHERE status = 'pending' AND approval_chain IS NULL LOOP
    ch := leave_build_chain(r.employee_id);
    UPDATE leave_requests SET approval_chain = ch, current_step = 1, current_stage = ch[1],
      lead_approver_id = leave_lead_for(r.employee_id), approval_history = '[]'::jsonb
    WHERE id = r.id;
  END LOOP;
  PERFORM set_config('leave.deciding', 'off', true);
END $$;

NOTIFY pgrst, 'reload schema';
