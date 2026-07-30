-- ============================================================
-- STEP63: Seed the Proposal approval chain — Sales Lead Review →
-- Finance Review → CTO/Leadership Sign-off — using the same DB-configurable
-- approval_chains/approval_chain_steps pattern (STEP48) every other
-- workflow uses, editable later from Settings → Approval Chain.
--
-- selector_type = 'always' (one fixed chain for the whole workflow, same
-- as warranty/timesheet — no branching by proposal value today; if that's
-- ever wanted, switch to 'chain_type' and branch like procurement does).
-- reject_behavior = 'reset_to_draft': a rejection at any stage sends the
-- proposal back to 'Revision Requested' (src/lib/proposalApproval.js
-- maps this to that specific status, not literally 'Draft', but the
-- chain-level semantics — "not moving forward, needs the author's
-- attention" — are the same as procurement's reset_to_draft).
--
-- Idempotent — only inserts if the chain key doesn't already exist.
-- Run after STEP48_approval_chains.sql and STEP62_proposal_core.sql
-- (needs the 'sales_lead' role from STEP61 to exist for the first step).
-- ============================================================

DO $$
DECLARE v_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM approval_chains WHERE key = 'proposal_default') THEN
    INSERT INTO approval_chains (workflow, key, label, selector_type, selector_value, reject_behavior)
      VALUES ('proposal', 'proposal_default', 'Proposal Approval Chain', 'always', NULL, 'reset_to_draft')
      RETURNING id INTO v_id;
    INSERT INTO approval_chain_steps (chain_id, step_order, status_value, approver_role, label) VALUES
      (v_id, 1, 'sales_lead_review', 'sales_lead', 'Sales Lead'),
      (v_id, 2, 'finance_review', 'finance', 'Finance'),
      (v_id, 3, 'cto_review', 'cto', 'CTO / Leadership');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
