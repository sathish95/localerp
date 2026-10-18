-- ============================================================
-- STEP212: ROI Planning & Burn Forecast module.
--
-- Sits under Budget & Finance / Project Overview -> Finance tab, anchored
-- to the existing Department -> Project -> Budget Line spine by FK only
-- (roi_proposal.project_id -> projects, roi_burn_entry.budget_line_id ->
-- budgets — `budgets` is this codebase's actual "Budget Line" table:
-- one row per project+category with allocated/committed_amount/spent,
-- referenced from project_hardware_costs etc. There is no separate
-- `budget_line` table to reference — see CLAUDE.md's Architecture notes
-- for why soft FKs are used throughout this codebase).
--
-- Every table here is organization_id-scoped (NOT NULL DEFAULT
-- current_org_id(), RLS = organization_id = current_org_id()), matching
-- the convention every module built after STEP89's multi-tenant retrofit
-- uses (see STEP160 IT Helpdesk) — not the older auth.uid()-only pattern
-- STEP64's project_planned_budget used, which predates multi-tenancy.
-- current_org_id() reads auth.uid(), so it only resolves inside an
-- authenticated app session — the one-time seed data below (cost-driver
-- and capture-rate defaults, the approval chain) is looped over every
-- row in `organizations` instead, same as STEP160's category/SLA seeding.
--
-- Decisions locked in with the org before writing this file (no reference
-- workbook was available, so the Calculation Engine is built strictly to
-- the written spec — see src/lib/roiCalcEngine.js for the acceptance-test
-- note):
--   - equipment_efficiency_loss_rate_pct splits across its four sub-items
--     (utilization/rental/operator_behavior/unauthorized_usage) via a
--     configurable, per-proposal weight row (roi_efficiency_weight),
--     seeded 25/25/25/25 and editable like capture rates.
--   - roi_pct = total_annual_saving / total_investment (not "minus 1"),
--     matching the brief's stated reference-workbook convention.
--   - No project in this schema emits incident-level telemetry today
--     (device_instances has no fuel-theft/service-overrun event log), so
--     Option 1 always falls back to system-default cost-driver benchmarks
--     and the Forecast Engine's realized_savings_to_date is always NULL —
--     the UI must always show the "unadjusted — no telemetry" label.
--
-- Approval: reuses the existing DB-configurable approval_chains/
-- approval_chain_steps engine (STEP48) the same way Proposals (STEP63)
-- and Warranty do — but no PM->CTO->Finance->CEO chain existed anywhere
-- in this schema before this file; it is seeded fresh below, not "reused"
-- verbatim. pm/cto/finance/ceo are all pre-existing roles (see `roles`
-- table, STEP42).
-- ============================================================

-- ── 1. roi_proposal ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roi_proposal (
  id               UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID          NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  project_id       UUID          NOT NULL,   -- soft ref -> projects
  name             TEXT          NOT NULL,
  currency         TEXT          NOT NULL DEFAULT 'INR',
  entry_mode       TEXT          NOT NULL CHECK (entry_mode IN ('historical_map','manual_input')),
  active_scenario  TEXT          NOT NULL DEFAULT 'expected' CHECK (active_scenario IN ('conservative','expected','aggressive')),
  duration_months  INT           NOT NULL DEFAULT 12 CHECK (duration_months > 0),
  status           TEXT          NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','rejected')),
  -- Two status columns, same pattern as proposals (see src/lib/proposalApproval.js):
  -- `status` is the coarse vocabulary the rest of the module reasons about;
  -- `approval_status` is the chain position ('pm_review'/'cto_review'/
  -- 'finance_review'/'ceo_review'/'approved') that src/lib/roiApproval.js walks.
  approval_status   TEXT,
  pm_approved_by     UUID          REFERENCES profiles(id),
  pm_approved_at     TIMESTAMPTZ,
  cto_approved_by    UUID          REFERENCES profiles(id),
  cto_approved_at    TIMESTAMPTZ,
  finance_approved_by UUID         REFERENCES profiles(id),
  finance_approved_at TIMESTAMPTZ,
  ceo_approved_by    UUID          REFERENCES profiles(id),
  ceo_approved_at    TIMESTAMPTZ,
  rejection_reason   TEXT,
  created_by       UUID          REFERENCES profiles(id),
  created_at       TIMESTAMPTZ   DEFAULT now(),
  approved_at      TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roi_proposal_org_idx     ON roi_proposal(organization_id);
CREATE INDEX IF NOT EXISTS roi_proposal_project_idx ON roi_proposal(project_id);
CREATE INDEX IF NOT EXISTS roi_proposal_status_idx  ON roi_proposal(status);
CREATE INDEX IF NOT EXISTS roi_proposal_approval_status_idx ON roi_proposal(approval_status);

-- ── 2. roi_site (child, one row per site) ────────────────────
CREATE TABLE IF NOT EXISTS roi_site (
  id                                 UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id                    UUID          NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  proposal_id                        UUID          NOT NULL REFERENCES roi_proposal(id) ON DELETE CASCADE,
  site_name                          TEXT          NOT NULL,
  equipment_count                    NUMERIC(10,2) NOT NULL DEFAULT 0,
  manual_labour_cost_monthly         NUMERIC(14,2) NOT NULL DEFAULT 0,
  logistics_mismatch_qty_per_quarter NUMERIC(14,2) NOT NULL DEFAULT 0,
  logistics_cost_per_mismatch        NUMERIC(14,2) NOT NULL DEFAULT 0,
  project_contract_value             NUMERIC(16,2) NOT NULL DEFAULT 0,
  equipment_replacement_value        NUMERIC(16,2) NOT NULL DEFAULT 0,
  source                             TEXT          NOT NULL DEFAULT 'manual_override' CHECK (source IN ('sourced','manual_override')),
  created_at                         TIMESTAMPTZ   DEFAULT now(),
  updated_at                         TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roi_site_org_idx      ON roi_site(organization_id);
CREATE INDEX IF NOT EXISTS roi_site_proposal_idx ON roi_site(proposal_id);

-- ── 3. roi_cost_driver (one row per proposal, fleet-wide) ────
CREATE TABLE IF NOT EXISTS roi_cost_driver (
  id                                       UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id                          UUID          NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  proposal_id                              UUID          NOT NULL UNIQUE REFERENCES roi_proposal(id) ON DELETE CASCADE,
  diesel_price_per_litre                   NUMERIC(10,2) NOT NULL DEFAULT 0,
  operating_days_per_year                  NUMERIC(6,2)  NOT NULL DEFAULT 0,
  service_overrun_per_equipment_year       NUMERIC(14,2) NOT NULL DEFAULT 0,
  fuel_theft_litres_per_day                NUMERIC(10,2) NOT NULL DEFAULT 0,
  missed_servicing_cost_per_equipment_year NUMERIC(14,2) NOT NULL DEFAULT 0,
  parts_failure_cost_per_incident          NUMERIC(14,2) NOT NULL DEFAULT 0,
  parts_failure_frequency_per_year         NUMERIC(8,2)  NOT NULL DEFAULT 0,
  project_loss_rate_pct                    NUMERIC(6,3)  NOT NULL DEFAULT 0,
  equipment_efficiency_loss_rate_pct       NUMERIC(6,3)  NOT NULL DEFAULT 0,
  iot_logger_unit_cost                     NUMERIC(12,2) NOT NULL DEFAULT 0,
  software_dev_cost_onetime                NUMERIC(14,2) NOT NULL DEFAULT 0,
  telemetry_sourced                        BOOLEAN       NOT NULL DEFAULT false, -- always false today — no telemetry feed exists; kept for a future ingestion module
  created_at                               TIMESTAMPTZ   DEFAULT now(),
  updated_at                               TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roi_cost_driver_org_idx ON roi_cost_driver(organization_id);

-- System-default benchmark values + UI-only hint text for the Cost Drivers
-- form. Never read by the Calculation Engine — display/pre-fill only.
-- Per-org (an admin could tune these later), seeded below for every org.
CREATE TABLE IF NOT EXISTS roi_cost_driver_defaults (
  id              UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID          NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  field_key       TEXT          NOT NULL CHECK (field_key IN (
                    'diesel_price_per_litre','operating_days_per_year','service_overrun_per_equipment_year',
                    'fuel_theft_litres_per_day','missed_servicing_cost_per_equipment_year','parts_failure_cost_per_incident',
                    'parts_failure_frequency_per_year','project_loss_rate_pct','equipment_efficiency_loss_rate_pct',
                    'iot_logger_unit_cost','software_dev_cost_onetime'
                  )),
  default_value   NUMERIC(14,4) NOT NULL DEFAULT 0,
  benchmark_hint  TEXT,
  UNIQUE (organization_id, field_key)
);

-- ── 4. roi_capture_rate (11 rows per proposal x 3 scenario columns) ──
CREATE TABLE IF NOT EXISTS roi_capture_rate (
  id                 UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id    UUID          NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  proposal_id        UUID          NOT NULL REFERENCES roi_proposal(id) ON DELETE CASCADE,
  category           TEXT          NOT NULL CHECK (category IN (
                       'service_overrun','fuel_theft','missed_servicing','parts_failure',
                       'labour','logistics','project_loss',
                       'utilization','rental','operator_behavior','unauthorized_usage'
                     )),
  conservative_pct   NUMERIC(6,3)  NOT NULL DEFAULT 0,
  expected_pct       NUMERIC(6,3)  NOT NULL DEFAULT 0,
  aggressive_pct     NUMERIC(6,3)  NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ   DEFAULT now(),
  updated_at         TIMESTAMPTZ   DEFAULT now(),
  UNIQUE(proposal_id, category)
);
CREATE INDEX IF NOT EXISTS roi_capture_rate_org_idx      ON roi_capture_rate(organization_id);
CREATE INDEX IF NOT EXISTS roi_capture_rate_proposal_idx ON roi_capture_rate(proposal_id);

-- System defaults, seeded onto every new proposal (Section 1 of the brief). Per-org.
CREATE TABLE IF NOT EXISTS roi_capture_rate_defaults (
  id                 UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id    UUID          NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  category           TEXT          NOT NULL CHECK (category IN (
                       'service_overrun','fuel_theft','missed_servicing','parts_failure',
                       'labour','logistics','project_loss',
                       'utilization','rental','operator_behavior','unauthorized_usage'
                     )),
  conservative_pct   NUMERIC(6,3)  NOT NULL DEFAULT 0,
  expected_pct       NUMERIC(6,3)  NOT NULL DEFAULT 0,
  aggressive_pct     NUMERIC(6,3)  NOT NULL DEFAULT 0,
  UNIQUE (organization_id, category)
);

-- ── 4b. roi_efficiency_weight — split of equipment_efficiency_loss_rate_pct
-- across its four sub-items. Configurable per proposal (org decision:
-- no reference-workbook ratio was available), seeded equal.
CREATE TABLE IF NOT EXISTS roi_efficiency_weight (
  id                     UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id        UUID          NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  proposal_id            UUID          NOT NULL UNIQUE REFERENCES roi_proposal(id) ON DELETE CASCADE,
  utilization_pct        NUMERIC(5,2)  NOT NULL DEFAULT 25,
  rental_pct             NUMERIC(5,2)  NOT NULL DEFAULT 25,
  operator_behavior_pct  NUMERIC(5,2)  NOT NULL DEFAULT 25,
  unauthorized_usage_pct NUMERIC(5,2)  NOT NULL DEFAULT 25,
  created_at             TIMESTAMPTZ   DEFAULT now(),
  updated_at             TIMESTAMPTZ   DEFAULT now(),
  CHECK (utilization_pct + rental_pct + operator_behavior_pct + unauthorized_usage_pct BETWEEN 99.9 AND 100.1)
);
CREATE INDEX IF NOT EXISTS roi_efficiency_weight_org_idx ON roi_efficiency_weight(organization_id);

-- ── 5. roi_calculation_snapshot (system-generated, immutable) ────
CREATE TABLE IF NOT EXISTS roi_calculation_snapshot (
  id                     UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id        UUID          NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  proposal_id            UUID          NOT NULL REFERENCES roi_proposal(id) ON DELETE CASCADE,
  scenario               TEXT          NOT NULL CHECK (scenario IN ('conservative','expected','aggressive')),
  per_equipment_savings  JSONB         NOT NULL, -- {service_saving, fuel_theft_saving, missed_servicing_saving, parts_failure_saving, per_equipment_total, fleet_total}
  site_wide_savings      JSONB         NOT NULL, -- {labour_saving, logistics_mismatch_saving, project_loss_avoided, equipment_utilization_saving, rental_optimization_saving, operator_behavior_saving, unauthorized_usage_saving, site_level_total}
  total_annual_saving    NUMERIC(16,2) NOT NULL,
  total_investment       NUMERIC(16,2) NOT NULL,
  roi_pct                NUMERIC(12,4) NOT NULL,
  payback_months         NUMERIC(10,2),
  computed_at            TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roi_calc_snapshot_org_idx    ON roi_calculation_snapshot(organization_id);
CREATE INDEX IF NOT EXISTS roi_calc_snapshot_lookup_idx ON roi_calculation_snapshot(proposal_id, scenario, computed_at DESC);

-- ── 6. roi_burn_entry (snapshot-based; read-only mirror of Budget & Finance actuals) ──
CREATE TABLE IF NOT EXISTS roi_burn_entry (
  id             UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID         NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  proposal_id    UUID          NOT NULL REFERENCES roi_proposal(id) ON DELETE CASCADE,
  budget_line_id UUID          NOT NULL,   -- soft ref -> budgets(id), the project+category "Budget Line" row funding this proposal's investment
  amount         NUMERIC(14,2) NOT NULL,
  currency       TEXT          NOT NULL DEFAULT 'INR',
  recorded_at    DATE          NOT NULL DEFAULT CURRENT_DATE,
  description    TEXT,
  source_table   TEXT,         -- e.g. 'project_hardware_costs' — the actual-cost table this entry was synced from
  source_row_id  UUID,         -- that table's row id, for idempotent re-sync
  created_at     TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roi_burn_entry_org_idx      ON roi_burn_entry(organization_id);
CREATE INDEX IF NOT EXISTS roi_burn_entry_proposal_idx ON roi_burn_entry(proposal_id);
CREATE UNIQUE INDEX IF NOT EXISTS roi_burn_entry_source_uniq ON roi_burn_entry(source_table, source_row_id) WHERE source_row_id IS NOT NULL;

-- ── 7. roi_forecast_run (system-generated, immutable, one per request) ──
CREATE TABLE IF NOT EXISTS roi_forecast_run (
  id                          UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id             UUID          NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  proposal_id                 UUID          NOT NULL REFERENCES roi_proposal(id) ON DELETE CASCADE,
  run_at                      TIMESTAMPTZ   DEFAULT now(),
  requested_duration_months   INT,
  scenario                    TEXT          NOT NULL CHECK (scenario IN ('conservative','expected','aggressive')),
  results                     JSONB         NOT NULL,
  triggered_by                UUID          REFERENCES profiles(id)
);
CREATE INDEX IF NOT EXISTS roi_forecast_run_org_idx      ON roi_forecast_run(organization_id);
CREATE INDEX IF NOT EXISTS roi_forecast_run_proposal_idx ON roi_forecast_run(proposal_id, run_at DESC);

-- ── updated_at triggers ───────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS roi_proposal_updated_at ON roi_proposal;
CREATE TRIGGER roi_proposal_updated_at BEFORE UPDATE ON roi_proposal
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS roi_site_updated_at ON roi_site;
CREATE TRIGGER roi_site_updated_at BEFORE UPDATE ON roi_site
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS roi_cost_driver_updated_at ON roi_cost_driver;
CREATE TRIGGER roi_cost_driver_updated_at BEFORE UPDATE ON roi_cost_driver
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS roi_capture_rate_updated_at ON roi_capture_rate;
CREATE TRIGGER roi_capture_rate_updated_at BEFORE UPDATE ON roi_capture_rate
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS roi_efficiency_weight_updated_at ON roi_efficiency_weight;
CREATE TRIGGER roi_efficiency_weight_updated_at BEFORE UPDATE ON roi_efficiency_weight
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS: organization_id = current_org_id() scoping on every table (the
-- current-generation convention — see STEP160 IT Helpdesk), permissive
-- within-org SELECT + role-gated writes. Snapshot/forecast tables get
-- INSERT only — no UPDATE/DELETE policy at all, enforcing immutability
-- at the DB layer, not just by app convention. ──
ALTER TABLE roi_proposal               ENABLE ROW LEVEL SECURITY;
ALTER TABLE roi_site                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE roi_cost_driver            ENABLE ROW LEVEL SECURITY;
ALTER TABLE roi_cost_driver_defaults   ENABLE ROW LEVEL SECURITY;
ALTER TABLE roi_capture_rate           ENABLE ROW LEVEL SECURITY;
ALTER TABLE roi_capture_rate_defaults  ENABLE ROW LEVEL SECURITY;
ALTER TABLE roi_efficiency_weight      ENABLE ROW LEVEL SECURITY;
ALTER TABLE roi_calculation_snapshot   ENABLE ROW LEVEL SECURITY;
ALTER TABLE roi_burn_entry             ENABLE ROW LEVEL SECURITY;
ALTER TABLE roi_forecast_run           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roi_proposal_select ON roi_proposal;
DROP POLICY IF EXISTS roi_proposal_write  ON roi_proposal;
CREATE POLICY roi_proposal_select ON roi_proposal FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY roi_proposal_write  ON roi_proposal FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cto','finance','pm','manager','department_head'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cto','finance','pm','manager','department_head'))
);

DROP POLICY IF EXISTS roi_site_select ON roi_site;
DROP POLICY IF EXISTS roi_site_write  ON roi_site;
CREATE POLICY roi_site_select ON roi_site FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY roi_site_write  ON roi_site FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cto','finance','pm','manager','department_head'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cto','finance','pm','manager','department_head'))
);

DROP POLICY IF EXISTS roi_cost_driver_select ON roi_cost_driver;
DROP POLICY IF EXISTS roi_cost_driver_write  ON roi_cost_driver;
CREATE POLICY roi_cost_driver_select ON roi_cost_driver FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY roi_cost_driver_write  ON roi_cost_driver FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cto','finance','pm','manager','department_head'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cto','finance','pm','manager','department_head'))
);

DROP POLICY IF EXISTS roi_cost_driver_defaults_select ON roi_cost_driver_defaults;
CREATE POLICY roi_cost_driver_defaults_select ON roi_cost_driver_defaults FOR SELECT USING (organization_id = current_org_id());

DROP POLICY IF EXISTS roi_capture_rate_select ON roi_capture_rate;
DROP POLICY IF EXISTS roi_capture_rate_write  ON roi_capture_rate;
CREATE POLICY roi_capture_rate_select ON roi_capture_rate FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY roi_capture_rate_write  ON roi_capture_rate FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cto','finance','pm','manager','department_head'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cto','finance','pm','manager','department_head'))
);

DROP POLICY IF EXISTS roi_capture_rate_defaults_select ON roi_capture_rate_defaults;
CREATE POLICY roi_capture_rate_defaults_select ON roi_capture_rate_defaults FOR SELECT USING (organization_id = current_org_id());

DROP POLICY IF EXISTS roi_efficiency_weight_select ON roi_efficiency_weight;
DROP POLICY IF EXISTS roi_efficiency_weight_write  ON roi_efficiency_weight;
CREATE POLICY roi_efficiency_weight_select ON roi_efficiency_weight FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY roi_efficiency_weight_write  ON roi_efficiency_weight FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cto','finance','pm','manager','department_head'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cto','finance','pm','manager','department_head'))
);

DROP POLICY IF EXISTS roi_calculation_snapshot_select ON roi_calculation_snapshot;
DROP POLICY IF EXISTS roi_calculation_snapshot_insert ON roi_calculation_snapshot;
CREATE POLICY roi_calculation_snapshot_select ON roi_calculation_snapshot FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY roi_calculation_snapshot_insert ON roi_calculation_snapshot FOR INSERT WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cto','finance','pm','manager','department_head'))
);

DROP POLICY IF EXISTS roi_burn_entry_select ON roi_burn_entry;
DROP POLICY IF EXISTS roi_burn_entry_insert ON roi_burn_entry;
CREATE POLICY roi_burn_entry_select ON roi_burn_entry FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY roi_burn_entry_insert ON roi_burn_entry FOR INSERT WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cto','finance','pm','manager','department_head'))
);

DROP POLICY IF EXISTS roi_forecast_run_select ON roi_forecast_run;
DROP POLICY IF EXISTS roi_forecast_run_insert ON roi_forecast_run;
CREATE POLICY roi_forecast_run_select ON roi_forecast_run FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY roi_forecast_run_insert ON roi_forecast_run FOR INSERT WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cto','finance','pm','manager','department_head'))
);

-- ── Per-org seed data. current_org_id() only resolves inside an
-- authenticated app session, so this script (run from the SQL Editor,
-- no session) loops over every existing organization explicitly — same
-- reasoning as STEP160's it_helpdesk_categories/sla_policies seeding. ──
DO $$
DECLARE v_org RECORD;
BEGIN
  FOR v_org IN SELECT id FROM organizations LOOP

    -- Cost-driver benchmark defaults
    INSERT INTO roi_cost_driver_defaults (organization_id, field_key, default_value, benchmark_hint) VALUES
      (v_org.id, 'diesel_price_per_litre',                   95,     'Reported range: Rs 90–100/litre'),
      (v_org.id, 'operating_days_per_year',                  300,    'Reported range: 260–320 days/year'),
      (v_org.id, 'service_overrun_per_equipment_year',       60000,  'Reported range: Rs 60,000–80,000/year'),
      (v_org.id, 'fuel_theft_litres_per_day',                2,      'Reported range: 1–4 litres/day'),
      (v_org.id, 'missed_servicing_cost_per_equipment_year', 30000,  'Reported range: Rs 25,000–40,000/year'),
      (v_org.id, 'parts_failure_cost_per_incident',          15000,  'Reported range: Rs 10,000–20,000/incident'),
      (v_org.id, 'parts_failure_frequency_per_year',         2,      'Reported range: 1–3 incidents/year'),
      (v_org.id, 'project_loss_rate_pct',                    2,      'Reported range: 1–3% of contract value'),
      (v_org.id, 'equipment_efficiency_loss_rate_pct',       5,      'Reported range: 3–8% of replacement value'),
      (v_org.id, 'iot_logger_unit_cost',                     8000,   'Reported range: Rs 6,000–10,000/unit'),
      (v_org.id, 'software_dev_cost_onetime',                500000, 'One-time platform integration cost')
    ON CONFLICT (organization_id, field_key) DO NOTHING;

    -- Capture-rate defaults
    INSERT INTO roi_capture_rate_defaults (organization_id, category, conservative_pct, expected_pct, aggressive_pct) VALUES
      (v_org.id, 'service_overrun',     40, 60, 80),
      (v_org.id, 'fuel_theft',          40, 60, 80),
      (v_org.id, 'missed_servicing',    40, 60, 80),
      (v_org.id, 'parts_failure',       30, 50, 70),
      (v_org.id, 'labour',              20, 35, 50),
      (v_org.id, 'logistics',           30, 50, 70),
      (v_org.id, 'project_loss',        20, 35, 50),
      (v_org.id, 'utilization',         30, 50, 70),
      (v_org.id, 'rental',              30, 50, 70),
      (v_org.id, 'operator_behavior',   20, 35, 50),
      (v_org.id, 'unauthorized_usage',  40, 60, 80)
    ON CONFLICT (organization_id, category) DO NOTHING;

  END LOOP;
END $$;

-- Approval chain: PM -> CTO -> Finance -> CEO, seeded fresh (no such chain
-- existed anywhere in this schema before this file — see header). NOT
-- looped per-org: approval_chains.key is a plain global UNIQUE column
-- (STEP48 — it was never retrofitted to a per-org composite unique the way
-- STEP97 did for organization_id itself), so this seeds exactly one chain
-- row, owned by the org STEP97's own backfill designated as the default
-- ('default-org') — every other org-scoped table above still gets its own
-- per-org rows via the loop; only this shared chain "template" is global.
-- selector_type 'always' (one fixed chain for the whole workflow, same as
-- Proposals/Warranty — no branching by proposal value). reject_behavior
-- 'reset_to_draft': any rejection sends the proposal back to 'draft' for
-- the author to revise and resubmit — and per the brief, any capture-rate
-- override or cost-driver edit after initial creation re-triggers approval
-- (src/lib/roiProposals.js enforces this by flipping status back to
-- 'draft' on such edits, not here).
DO $$
DECLARE v_default_org UUID; v_chain_id UUID;
BEGIN
  SELECT id INTO v_default_org FROM organizations WHERE slug = 'default-org';
  IF v_default_org IS NULL THEN SELECT id INTO v_default_org FROM organizations ORDER BY created_at LIMIT 1; END IF;

  IF v_default_org IS NOT NULL AND NOT EXISTS (SELECT 1 FROM approval_chains WHERE key = 'roi_proposal_default') THEN
    INSERT INTO approval_chains (organization_id, workflow, key, label, selector_type, selector_value, reject_behavior)
      VALUES (v_default_org, 'roi_proposal', 'roi_proposal_default', 'ROI Proposal Approval Chain', 'always', NULL, 'reset_to_draft')
      RETURNING id INTO v_chain_id;
    INSERT INTO approval_chain_steps (organization_id, chain_id, step_order, status_value, approver_role, label) VALUES
      (v_default_org, v_chain_id, 1, 'pm_review',      'pm',      'PM'),
      (v_default_org, v_chain_id, 2, 'cto_review',     'cto',     'CTO'),
      (v_default_org, v_chain_id, 3, 'finance_review', 'finance', 'Finance'),
      (v_default_org, v_chain_id, 4, 'ceo_review',     'ceo',     'CEO');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
