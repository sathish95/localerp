-- ============================================================
-- STEP146: Approval workflow (Phase 11).
--
-- CORRECTION to the Phase 1 design doc: approvalFlow.js is NOT a
-- generic reusable chain engine — it's tightly coupled to the
-- expense/travel record shape (manager_approved_by/ceo_approved_at
-- columns living directly on those tables, a fixed 4-step status
-- vocabulary). Forcing scenario_versions into that exact vocabulary
-- would mean dropping 'changes_requested', which Phase 11 explicitly
-- asks for. Built standalone instead: a simple, append-only action log
-- (scenario_approvals) — current state is just scenario_versions.status
-- (already on the table since STEP143) — using the same role/permission
-- check convention as everything else, and the same direct-notifications-
-- insert pattern already used by record_payment_success() etc.
-- ============================================================

CREATE TABLE IF NOT EXISTS scenario_approvals (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id     UUID        NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  scenario_version_id UUID        NOT NULL REFERENCES scenario_versions(id) ON DELETE CASCADE,
  action              TEXT        NOT NULL CHECK (action IN ('submit', 'approve', 'reject', 'request_changes')),
  actor_id            UUID        REFERENCES profiles(id),
  note                TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scenario_approvals_version_idx ON scenario_approvals(scenario_version_id);

ALTER TABLE scenario_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scenario_approvals_select ON scenario_approvals;
CREATE POLICY scenario_approvals_select ON scenario_approvals FOR SELECT USING (organization_id = current_org_id());
GRANT SELECT ON public.scenario_approvals TO authenticated;
-- No client INSERT policy — every row is written by the two RPCs below
-- (SECURITY DEFINER), which also own the scenario_versions.status
-- transition, so the log and the status can never drift apart.

CREATE OR REPLACE FUNCTION submit_scenario_version(p_version_id UUID, p_note TEXT DEFAULT NULL)
RETURNS VOID AS $$
DECLARE v_org_id UUID; v_owner UUID; v_name TEXT;
BEGIN
  SELECT sv.organization_id, s.created_by, s.name INTO v_org_id, v_owner, v_name
  FROM scenario_versions sv JOIN scenarios s ON s.id = sv.scenario_id
  WHERE sv.id = p_version_id AND sv.status IN ('draft', 'simulated', 'changes_requested');
  IF v_org_id IS NULL OR v_org_id <> current_org_id() THEN
    RAISE EXCEPTION 'Scenario version not found or not in a submittable state';
  END IF;
  -- Mirrors scenario_versions_write's own USING clause (STEP143) — this
  -- RPC is SECURITY DEFINER and bypasses that RLS policy entirely, so
  -- without this check any org member (even with zero SCENARIO_* grants)
  -- could submit another user's draft for approval.
  IF v_owner <> auth.uid() AND NOT has_permission_or_role('SCENARIO_EDIT', ARRAY['admin','ceo','manager','department_head','finance']) THEN
    RAISE EXCEPTION 'Not authorized to submit this scenario';
  END IF;

  UPDATE scenario_versions SET status = 'submitted', updated_at = now() WHERE id = p_version_id;
  INSERT INTO scenario_approvals (organization_id, scenario_version_id, action, actor_id, note)
  VALUES (v_org_id, p_version_id, 'submit', auth.uid(), p_note);

  INSERT INTO notifications (recipient_id, type, title, body, link)
  SELECT p.id, 'scenario_submitted', 'Scenario ready for review',
    COALESCE(v_name, 'A scenario') || ' was submitted for approval.', '/scenarios/approvals'
  FROM profiles p WHERE p.organization_id = v_org_id
    AND has_permission_or_role('SCENARIO_APPROVE', ARRAY['admin','ceo','finance','department_head']);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION submit_scenario_version(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION decide_scenario_version(p_version_id UUID, p_decision TEXT, p_note TEXT DEFAULT NULL)
RETURNS VOID AS $$
DECLARE v_org_id UUID; v_owner UUID; v_name TEXT; v_new_status TEXT;
BEGIN
  IF NOT has_permission_or_role('SCENARIO_APPROVE', ARRAY['admin','ceo','finance','department_head']) THEN
    RAISE EXCEPTION 'Not authorized to decide on scenarios';
  END IF;
  IF p_decision NOT IN ('approve', 'reject', 'request_changes') THEN
    RAISE EXCEPTION 'Invalid decision';
  END IF;

  SELECT sv.organization_id, s.created_by, s.name INTO v_org_id, v_owner, v_name
  FROM scenario_versions sv JOIN scenarios s ON s.id = sv.scenario_id
  WHERE sv.id = p_version_id AND sv.status IN ('submitted', 'under_review');
  IF v_org_id IS NULL OR v_org_id <> current_org_id() THEN
    RAISE EXCEPTION 'Scenario version not found or not awaiting a decision';
  END IF;

  v_new_status := CASE p_decision WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'changes_requested' END;
  UPDATE scenario_versions SET status = v_new_status, updated_at = now() WHERE id = p_version_id;
  INSERT INTO scenario_approvals (organization_id, scenario_version_id, action, actor_id, note)
  VALUES (v_org_id, p_version_id, p_decision, auth.uid(), p_note);

  -- notifications.recipient_id is NOT NULL — a scenario with no owner
  -- (orphaned data, deleted creator, etc.) must not be able to crash the
  -- whole decision and roll back the status change just because the
  -- notification side-effect has nobody to notify.
  IF v_owner IS NOT NULL THEN
    INSERT INTO notifications (recipient_id, type, title, body, link)
    VALUES (v_owner, 'scenario_decided',
      CASE p_decision WHEN 'approve' THEN 'Scenario approved' WHEN 'reject' THEN 'Scenario rejected' ELSE 'Changes requested on your scenario' END,
      COALESCE(v_name, 'Your scenario') || CASE p_decision WHEN 'approve' THEN ' was approved.' WHEN 'reject' THEN ' was rejected.' ELSE ' needs changes before resubmitting.' END,
      '/scenarios/my');
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION decide_scenario_version(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
