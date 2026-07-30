-- ============================================================
-- SEED: Represents every approval chain that exists today as data,
-- with the exact same status vocabulary each engine already uses (see
-- src/lib/approvalFlow.js, procurementApproval.js, warrantyApproval.js,
-- and the inline chain in TimesheetApprovalPage.jsx). Nothing about
-- live behavior changes by running this — it just makes the existing
-- chains editable. Idempotent: each chain is only inserted if its key
-- doesn't already exist, so it's safe to re-run and won't clobber any
-- chain an admin has since edited or a custom chain they've created.
-- Run once, after STEP48_approval_chains.sql.
-- ============================================================

DO $$
DECLARE v_id UUID;
BEGIN

  -- ── Expense chains (src/lib/approvalFlow.js CHAINS, keyed by submitter role) ──
  IF NOT EXISTS (SELECT 1 FROM approval_chains WHERE key = 'expense_employee') THEN
    INSERT INTO approval_chains (workflow, key, label, selector_type, selector_value, reject_behavior)
      VALUES ('expense', 'expense_employee', 'Employee Expense Chain', 'submitter_role', 'employee', 'terminal')
      RETURNING id INTO v_id;
    INSERT INTO approval_chain_steps (chain_id, step_order, status_value, approver_role, label) VALUES
      (v_id, 1, 'manager_review', 'manager', 'Manager'),
      (v_id, 2, 'ceo_review', 'ceo', 'CEO'),
      (v_id, 3, 'finance_review', 'finance', 'Finance');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM approval_chains WHERE key = 'expense_manager') THEN
    INSERT INTO approval_chains (workflow, key, label, selector_type, selector_value, reject_behavior)
      VALUES ('expense', 'expense_manager', 'Manager Expense Chain', 'submitter_role', 'manager', 'terminal')
      RETURNING id INTO v_id;
    INSERT INTO approval_chain_steps (chain_id, step_order, status_value, approver_role, label) VALUES
      (v_id, 1, 'ceo_review', 'ceo', 'CEO'),
      (v_id, 2, 'finance_review', 'finance', 'Finance');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM approval_chains WHERE key = 'expense_finance') THEN
    INSERT INTO approval_chains (workflow, key, label, selector_type, selector_value, reject_behavior)
      VALUES ('expense', 'expense_finance', 'Finance Expense Chain', 'submitter_role', 'finance', 'terminal')
      RETURNING id INTO v_id;
    INSERT INTO approval_chain_steps (chain_id, step_order, status_value, approver_role, label) VALUES
      (v_id, 1, 'manager_review', 'manager', 'Manager'),
      (v_id, 2, 'ceo_review', 'ceo', 'CEO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM approval_chains WHERE key = 'expense_hr') THEN
    INSERT INTO approval_chains (workflow, key, label, selector_type, selector_value, reject_behavior)
      VALUES ('expense', 'expense_hr', 'HR Expense Chain', 'submitter_role', 'hr', 'terminal')
      RETURNING id INTO v_id;
    INSERT INTO approval_chain_steps (chain_id, step_order, status_value, approver_role, label) VALUES
      (v_id, 1, 'manager_review', 'manager', 'Manager'),
      (v_id, 2, 'ceo_review', 'ceo', 'CEO'),
      (v_id, 3, 'finance_review', 'finance', 'Finance');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM approval_chains WHERE key = 'expense_department_head') THEN
    INSERT INTO approval_chains (workflow, key, label, selector_type, selector_value, reject_behavior)
      VALUES ('expense', 'expense_department_head', 'Department Head Expense Chain', 'submitter_role', 'department_head', 'terminal')
      RETURNING id INTO v_id;
    INSERT INTO approval_chain_steps (chain_id, step_order, status_value, approver_role, label) VALUES
      (v_id, 1, 'ceo_review', 'ceo', 'CEO'),
      (v_id, 2, 'finance_review', 'finance', 'Finance');
  END IF;

  -- ── Travel chains (same engine/shape as Expense) ──
  IF NOT EXISTS (SELECT 1 FROM approval_chains WHERE key = 'travel_employee') THEN
    INSERT INTO approval_chains (workflow, key, label, selector_type, selector_value, reject_behavior)
      VALUES ('travel', 'travel_employee', 'Employee Travel Chain', 'submitter_role', 'employee', 'terminal')
      RETURNING id INTO v_id;
    INSERT INTO approval_chain_steps (chain_id, step_order, status_value, approver_role, label) VALUES
      (v_id, 1, 'manager_review', 'manager', 'Manager'),
      (v_id, 2, 'ceo_review', 'ceo', 'CEO'),
      (v_id, 3, 'finance_review', 'finance', 'Finance');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM approval_chains WHERE key = 'travel_manager') THEN
    INSERT INTO approval_chains (workflow, key, label, selector_type, selector_value, reject_behavior)
      VALUES ('travel', 'travel_manager', 'Manager Travel Chain', 'submitter_role', 'manager', 'terminal')
      RETURNING id INTO v_id;
    INSERT INTO approval_chain_steps (chain_id, step_order, status_value, approver_role, label) VALUES
      (v_id, 1, 'ceo_review', 'ceo', 'CEO'),
      (v_id, 2, 'finance_review', 'finance', 'Finance');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM approval_chains WHERE key = 'travel_finance') THEN
    INSERT INTO approval_chains (workflow, key, label, selector_type, selector_value, reject_behavior)
      VALUES ('travel', 'travel_finance', 'Finance Travel Chain', 'submitter_role', 'finance', 'terminal')
      RETURNING id INTO v_id;
    INSERT INTO approval_chain_steps (chain_id, step_order, status_value, approver_role, label) VALUES
      (v_id, 1, 'manager_review', 'manager', 'Manager'),
      (v_id, 2, 'ceo_review', 'ceo', 'CEO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM approval_chains WHERE key = 'travel_hr') THEN
    INSERT INTO approval_chains (workflow, key, label, selector_type, selector_value, reject_behavior)
      VALUES ('travel', 'travel_hr', 'HR Travel Chain', 'submitter_role', 'hr', 'terminal')
      RETURNING id INTO v_id;
    INSERT INTO approval_chain_steps (chain_id, step_order, status_value, approver_role, label) VALUES
      (v_id, 1, 'manager_review', 'manager', 'Manager'),
      (v_id, 2, 'ceo_review', 'ceo', 'CEO'),
      (v_id, 3, 'finance_review', 'finance', 'Finance');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM approval_chains WHERE key = 'travel_department_head') THEN
    INSERT INTO approval_chains (workflow, key, label, selector_type, selector_value, reject_behavior)
      VALUES ('travel', 'travel_department_head', 'Department Head Travel Chain', 'submitter_role', 'department_head', 'terminal')
      RETURNING id INTO v_id;
    INSERT INTO approval_chain_steps (chain_id, step_order, status_value, approver_role, label) VALUES
      (v_id, 1, 'ceo_review', 'ceo', 'CEO'),
      (v_id, 2, 'finance_review', 'finance', 'Finance');
  END IF;

  -- ── Procurement chains (src/lib/procurementApproval.js, keyed by chain_type) ──
  IF NOT EXISTS (SELECT 1 FROM approval_chains WHERE key = 'procurement_short') THEN
    INSERT INTO approval_chains (workflow, key, label, selector_type, selector_value, reject_behavior)
      VALUES ('procurement', 'procurement_short', 'Short Chain (On-Demand / Below Threshold)', 'chain_type', 'short', 'reset_to_draft')
      RETURNING id INTO v_id;
    INSERT INTO approval_chain_steps (chain_id, step_order, status_value, approver_role, label) VALUES
      (v_id, 1, 'procurement_lead_review', 'procurement_lead', 'Procurement Lead'),
      (v_id, 2, 'pm_review', 'pm', 'PM');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM approval_chains WHERE key = 'procurement_full') THEN
    INSERT INTO approval_chains (workflow, key, label, selector_type, selector_value, reject_behavior)
      VALUES ('procurement', 'procurement_full', 'Full Chain (Production / Above Threshold)', 'chain_type', 'full', 'reset_to_draft')
      RETURNING id INTO v_id;
    INSERT INTO approval_chain_steps (chain_id, step_order, status_value, approver_role, label) VALUES
      (v_id, 1, 'procurement_lead_review', 'procurement_lead', 'Procurement Lead'),
      (v_id, 2, 'pm_review', 'pm', 'PM'),
      (v_id, 3, 'cto_review', 'cto', 'CTO'),
      (v_id, 4, 'finance_review', 'finance', 'Finance'),
      (v_id, 5, 'ceo_review', 'ceo', 'CEO');
  END IF;

  -- ── Warranty chain (src/lib/warrantyApproval.js — single fixed chain) ──
  IF NOT EXISTS (SELECT 1 FROM approval_chains WHERE key = 'warranty_default') THEN
    INSERT INTO approval_chains (workflow, key, label, selector_type, selector_value, reject_behavior)
      VALUES ('warranty', 'warranty_default', 'Warranty Claim Chain', 'always', NULL, 'terminal')
      RETURNING id INTO v_id;
    INSERT INTO approval_chain_steps (chain_id, step_order, status_value, approver_role, label) VALUES
      (v_id, 1, 'PM Review', 'pm', 'PM'),
      (v_id, 2, 'CEO Review', 'ceo', 'CEO'),
      (v_id, 3, 'Finance Review', 'finance', 'Finance');
  END IF;

  -- ── Timesheet chain (currently inline in TimesheetApprovalPage.jsx, extracted alongside this) ──
  IF NOT EXISTS (SELECT 1 FROM approval_chains WHERE key = 'timesheet_default') THEN
    INSERT INTO approval_chains (workflow, key, label, selector_type, selector_value, reject_behavior)
      VALUES ('timesheet', 'timesheet_default', 'Timesheet Approval Chain', 'always', NULL, 'terminal')
      RETURNING id INTO v_id;
    INSERT INTO approval_chain_steps (chain_id, step_order, status_value, approver_role, label) VALUES
      (v_id, 1, 'pending_manager', 'manager', 'Manager'),
      (v_id, 2, 'pending_hr', 'hr', 'HR'),
      (v_id, 3, 'pending_finance', 'finance', 'Finance');
  END IF;

  -- ── Leave (no ordered chain today — any manager-tier role can act. Represented
  -- as a trivial 1-step chain here for visibility/consistency in the admin UI
  -- only; leave's runtime approval logic is intentionally left untouched.) ──
  IF NOT EXISTS (SELECT 1 FROM approval_chains WHERE key = 'leave_default') THEN
    INSERT INTO approval_chains (workflow, key, label, selector_type, selector_value, reject_behavior)
      VALUES ('leave', 'leave_default', 'Leave Approval', 'always', NULL, 'terminal')
      RETURNING id INTO v_id;
    INSERT INTO approval_chain_steps (chain_id, step_order, status_value, approver_role, label) VALUES
      (v_id, 1, 'pending', 'manager', 'Any Manager-Tier Role');
  END IF;

END $$;
