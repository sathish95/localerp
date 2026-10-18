-- ============================================================
-- SEED_roi_cemindia_demo.sql — a full, realistic ROI Planning use case:
-- "CemIndia" — a cement company's captive quarry/haulage fleet, rolling
-- out IoT telematics loggers across 3 sites to cut fuel theft, missed
-- servicing, logistics mismatches, and under-utilization.
--
-- Seeds every INPUT table only (project, proposal, sites, cost drivers,
-- capture rates incl. one custom category, efficiency weights, customer
-- baseline, investment lines split client/provider, delivery cost, PO +
-- a change order, and two manual-adjustment ledger entries). It does NOT
-- hand-write roi_calculation_snapshot / roi_benefit_driver / roi_gross_
-- profit_snapshot / roi_result_snapshot / roi_sensitivity_run / roi_npv_
-- irr_result — those are computed outputs, and duplicating the JS
-- engines' math in SQL risks a seed that quietly disagrees with the real
-- app. Generate them for real, in this order, after running this file:
--   1. Open the proposal -> Scenarios tab -> "Recalculate All Scenarios"
--   2. Benefit Drivers tab -> "Sync from Scenarios (v1)"
--   3. PO vs Actual Cost tab -> "Recompute Gross Profit"
--   4. ROI & Payback tab -> "Recompute ROI Result" (for Annual, then 3yr/5yr if wanted)
--   5. Sensitivity Analysis tab -> "Run Sensitivity Grid" (drives the risk rating)
--   6. NPV / IRR tab -> "Run NPV / IRR"
--   7. Approval tab -> "Submit for Approval" (freezes the Approval Summary)
--
-- Not idempotent: "CemIndia" is a demo name, not a unique key anywhere in
-- these tables except the project's `code` ('CEMINDIA-IOT-01') — re-running
-- this file will either error on that duplicate code (if `code` is unique
-- in your schema) or insert a second project+proposal (if it isn't). Either
-- way, if you want a clean single copy: delete the previously seeded
-- roi_proposal row first (cascades to every roi_* child table under it),
-- then the project row — project_id on roi_proposal is a soft ref, so
-- deleting the project does NOT cascade to the proposal on its own.
-- ============================================================

DO $$
DECLARE
  v_org UUID; v_admin UUID; v_dept UUID;
  v_project UUID; v_proposal UUID; v_po UUID;
BEGIN
  SELECT id INTO v_org FROM organizations WHERE slug = 'default-org';
  IF v_org IS NULL THEN SELECT id INTO v_org FROM organizations ORDER BY created_at LIMIT 1; END IF;

  SELECT id INTO v_admin FROM profiles WHERE role IN ('admin', 'ceo') ORDER BY created_at LIMIT 1;
  IF v_admin IS NULL THEN SELECT id INTO v_admin FROM profiles ORDER BY created_at LIMIT 1; END IF;

  SELECT id INTO v_dept FROM departments LIMIT 1;

  IF v_org IS NULL OR v_admin IS NULL THEN
    RAISE EXCEPTION 'No organization or profile found — seed at least one org/user before running this demo seed.';
  END IF;

  -- ── Project ──────────────────────────────────────────────
  INSERT INTO projects (name, code, description, department_id, project_type, budget, reserved_budget, start_date, end_date, status, created_by)
  VALUES (
    'CemIndia Fleet IoT Rollout', 'CEMINDIA-IOT-01',
    'IoT telematics rollout across CemIndia''s captive quarry/haulage fleet (Chandrapur, Sattur, Kurnool) to cut fuel theft, missed servicing, logistics mismatches and under-utilization.',
    v_dept, 'IoT Deployment', 4500000, 300000, CURRENT_DATE, CURRENT_DATE + 365, 'active', v_admin
  ) RETURNING id INTO v_project;

  -- ── ROI Proposal ─────────────────────────────────────────
  INSERT INTO roi_proposal (organization_id, project_id, name, currency, entry_mode, active_scenario, duration_months, status, created_by)
  VALUES (v_org, v_project, 'CemIndia Fleet IoT ROI — FY26', 'INR', 'manual_input', 'expected', 12, 'draft', v_admin)
  RETURNING id INTO v_proposal;

  -- ── Sites (3) ────────────────────────────────────────────
  INSERT INTO roi_site (organization_id, proposal_id, site_name, equipment_count, manual_labour_cost_monthly, logistics_mismatch_qty_per_quarter, logistics_cost_per_mismatch, project_contract_value, equipment_replacement_value, source) VALUES
    (v_org, v_proposal, 'Chandrapur Quarry', 60, 180000, 12, 8000, 45000000, 120000000, 'manual_override'),
    (v_org, v_proposal, 'Sattur Plant',      50, 150000,  9, 7500, 38000000, 100000000, 'manual_override'),
    (v_org, v_proposal, 'Kurnool Mines',     40, 130000, 15, 9000, 32000000,  85000000, 'manual_override');

  -- ── Cost Drivers (fleet-wide, 150 equipment total) ──────
  INSERT INTO roi_cost_driver (
    organization_id, proposal_id, diesel_price_per_litre, operating_days_per_year,
    service_overrun_per_equipment_year, fuel_theft_litres_per_day, missed_servicing_cost_per_equipment_year,
    parts_failure_cost_per_incident, parts_failure_frequency_per_year, project_loss_rate_pct,
    equipment_efficiency_loss_rate_pct, iot_logger_unit_cost, software_dev_cost_onetime
  ) VALUES (
    v_org, v_proposal, 96, 320,
    65000, 3.5, 42000,
    22000, 2.5, 2.2,
    6, 9500, 650000
  );

  -- ── Efficiency Weight — mining fleet skews toward utilization/unauthorized use ──
  INSERT INTO roi_efficiency_weight (organization_id, proposal_id, utilization_pct, rental_pct, operator_behavior_pct, unauthorized_usage_pct)
  VALUES (v_org, v_proposal, 30, 15, 25, 30);

  -- ── Capture Rates — the 11 core categories (realistic, not the generic
  -- system defaults) plus one custom, reference-only category ──
  INSERT INTO roi_capture_rate (organization_id, proposal_id, category, conservative_pct, expected_pct, aggressive_pct, is_custom) VALUES
    (v_org, v_proposal, 'service_overrun',    35, 55, 75, false),
    (v_org, v_proposal, 'fuel_theft',         45, 65, 85, false),
    (v_org, v_proposal, 'missed_servicing',   40, 60, 80, false),
    (v_org, v_proposal, 'parts_failure',      30, 50, 70, false),
    (v_org, v_proposal, 'labour',             20, 35, 50, false),
    (v_org, v_proposal, 'logistics',          35, 55, 75, false),
    (v_org, v_proposal, 'project_loss',       20, 35, 50, false),
    (v_org, v_proposal, 'utilization',        30, 50, 70, false),
    (v_org, v_proposal, 'rental',             25, 45, 65, false),
    (v_org, v_proposal, 'operator_behavior',  25, 40, 55, false),
    (v_org, v_proposal, 'unauthorized_usage', 45, 65, 85, false),
    (v_org, v_proposal, 'Insurance Premium Reduction', 10, 20, 30, true);

  -- ── Customer Baseline (monthly figures, "before" state) ──
  INSERT INTO roi_customer_baseline (organization_id, proposal_id, labor_cost, energy_cost, maintenance_cost, operating_cost, current_revenue, waste_cost, productivity_metric, technology_spend)
  VALUES (
    v_org, v_proposal,
    jsonb_build_object('amount', 460000, 'currency', 'INR', 'source', 'manual', 'source_ref', null, 'updated_at', now(), 'status', 'actual'),
    jsonb_build_object('amount', 210000, 'currency', 'INR', 'source', 'manual', 'source_ref', null, 'updated_at', now(), 'status', 'actual'),
    jsonb_build_object('amount', 310000, 'currency', 'INR', 'source', 'manual', 'source_ref', null, 'updated_at', now(), 'status', 'actual'),
    jsonb_build_object('amount', 1200000, 'currency', 'INR', 'source', 'manual', 'source_ref', null, 'updated_at', now(), 'status', 'actual'),
    jsonb_build_object('amount', 9000000, 'currency', 'INR', 'source', 'manual', 'source_ref', null, 'updated_at', now(), 'status', 'actual'),
    jsonb_build_object('amount', 95000, 'currency', 'INR', 'source', 'manual', 'source_ref', null, 'updated_at', now(), 'status', 'actual'),
    jsonb_build_object('amount', 18000, 'currency', 'INR', 'source', 'manual', 'source_ref', null, 'updated_at', now(), 'status', 'actual'),
    jsonb_build_object('amount', 40000, 'currency', 'INR', 'source', 'manual', 'source_ref', null, 'updated_at', now(), 'status', 'actual')
  );

  -- ── Investment Lines — Client-Side (what CemIndia pays) ─
  INSERT INTO roi_investment_line (organization_id, proposal_id, timing, category, name, party, qty, unit_cost, amount) VALUES
    (v_org, v_proposal, 'one_time', 'hardware', 'IoT Logger Hardware (150 units)', 'client', 150, 9500,
      jsonb_build_object('amount', 1425000, 'currency', 'INR', 'source', 'manual', 'updated_at', now(), 'status', 'actual')),
    (v_org, v_proposal, 'one_time', 'integration', 'Fleet Telematics Platform Integration', 'client', 1, 650000,
      jsonb_build_object('amount', 650000, 'currency', 'INR', 'source', 'manual', 'updated_at', now(), 'status', 'actual')),
    (v_org, v_proposal, 'one_time', 'training', 'Driver & Ops Training (3 sites)', 'client', 1, 180000,
      jsonb_build_object('amount', 180000, 'currency', 'INR', 'source', 'manual', 'updated_at', now(), 'status', 'actual')),
    (v_org, v_proposal, 'recurring', 'subscription', 'Telematics SaaS Subscription (Annual)', 'client', 1, 420000,
      jsonb_build_object('amount', 420000, 'currency', 'INR', 'source', 'manual', 'updated_at', now(), 'status', 'actual'));

  -- ── Investment Lines — Service-Provided (what we contribute) ─
  INSERT INTO roi_investment_line (organization_id, proposal_id, timing, category, name, party, qty, unit_cost, amount) VALUES
    (v_org, v_proposal, 'one_time', 'support', 'First-Year Onsite Support (Subsidized)', 'provider', 1, 250000,
      jsonb_build_object('amount', 250000, 'currency', 'INR', 'source', 'manual', 'updated_at', now(), 'status', 'actual'));

  -- ── Delivery Cost (internal-only — never shown to the customer) ─
  INSERT INTO roi_delivery_cost_line (organization_id, proposal_id, category, name, manual_amount) VALUES
    (v_org, v_proposal, 'development', 'Custom export format for CemIndia''s legacy ERP',
      jsonb_build_object('amount', 300000, 'currency', 'INR', 'source', 'manual', 'updated_at', now(), 'status', 'actual')),
    (v_org, v_proposal, 'implementation', 'Site rollout — 3 locations',
      jsonb_build_object('amount', 220000, 'currency', 'INR', 'source', 'manual', 'updated_at', now(), 'status', 'actual')),
    (v_org, v_proposal, 'project_management', 'PM allocation — 12 months',
      jsonb_build_object('amount', 150000, 'currency', 'INR', 'source', 'manual', 'updated_at', now(), 'status', 'actual')),
    (v_org, v_proposal, 'qa', 'QA cycles — 3 site configs',
      jsonb_build_object('amount', 80000, 'currency', 'INR', 'source', 'manual', 'updated_at', now(), 'status', 'actual')),
    (v_org, v_proposal, 'travel', 'Site visits — Chandrapur/Sattur/Kurnool',
      jsonb_build_object('amount', 60000, 'currency', 'INR', 'source', 'manual', 'updated_at', now(), 'status', 'actual')),
    (v_org, v_proposal, 'contingency', 'Contingency reserve',
      jsonb_build_object('amount', 100000, 'currency', 'INR', 'source', 'manual', 'updated_at', now(), 'status', 'actual'));

  -- ── PO Record + one Change Order ─────────────────────────
  INSERT INTO roi_po_record (organization_id, proposal_id, original_po, expansion_po, credits)
  VALUES (
    v_org, v_proposal,
    jsonb_build_object('amount', 4200000, 'currency', 'INR', 'source', 'manual', 'updated_at', now(), 'status', 'actual'),
    jsonb_build_object('amount', 300000, 'currency', 'INR', 'source', 'manual', 'updated_at', now(), 'status', 'actual'),
    jsonb_build_object('amount', 50000, 'currency', 'INR', 'source', 'manual', 'updated_at', now(), 'status', 'actual')
  ) RETURNING id INTO v_po;

  INSERT INTO roi_po_change_order (organization_id, po_record_id, description, amount, date, created_by)
  VALUES (
    v_org, v_po, 'Added Kurnool Mines site coverage (customer requested mid-deal)',
    jsonb_build_object('amount', 300000, 'currency', 'INR', 'source', 'manual', 'updated_at', now(), 'status', 'actual'),
    CURRENT_DATE, v_admin
  );

  -- ── Manual Adjustment ledger (the audit trail) ───────────
  INSERT INTO roi_manual_adjustment (organization_id, proposal_id, category, type, amount, reason, owner, date) VALUES
    (v_org, v_proposal, 'delivery_cost:development', 'cost',
      jsonb_build_object('amount', 300000, 'currency', 'INR', 'source', 'manual', 'updated_at', now(), 'status', 'actual'),
      'Custom integration work for CemIndia''s legacy ERP export format — not part of the standard platform build.', v_admin, CURRENT_DATE),
    (v_org, v_proposal, 'po_record:change_order', 'revenue',
      jsonb_build_object('amount', 300000, 'currency', 'INR', 'source', 'manual', 'updated_at', now(), 'status', 'actual'),
      'Customer requested additional site coverage (Kurnool Mines) after the original PO was signed.', v_admin, CURRENT_DATE);

  RAISE NOTICE 'Seeded CemIndia demo: project_id=%, proposal_id=%', v_project, v_proposal;
END $$;

NOTIFY pgrst, 'reload schema';
