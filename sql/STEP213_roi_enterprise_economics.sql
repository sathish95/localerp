-- ============================================================
-- STEP213: ROI Enterprise & Commercial Economics layer.
--
-- EXTENDS STEP212 — nothing from v1 (roi_proposal, roi_site,
-- roi_cost_driver, roi_capture_rate, roi_efficiency_weight,
-- roi_calculation_snapshot, roi_burn_entry, roi_forecast_run, the
-- pm/cto/finance/ceo approval chain) is replaced or dropped. This adds:
-- Customer Baseline, Benefit Drivers (running alongside v1's per-
-- equipment/site-wide savings, per org decision — NOT a migration off
-- them), Investment line items, Delivery Cost (internal-only), PO
-- reconciliation, Gross Profit, split Customer/Internal ROI results,
-- Sensitivity Analysis, NPV/IRR, an extended Approval summary, and a
-- tokenized public Customer View link.
--
-- FinancialValue: the brief's universal source-tagging object
-- ({amount, currency, source, source_ref, updated_at, status}) is
-- implemented as JSONB, not six physical columns per monetary field —
-- see src/lib/financialValue.js for the JS-side constructor/reader used
-- against every column of this shape below. Every such column here is
-- named with no suffix (e.g. `labor_cost`, not `labor_cost_amount`) and
-- is JSONB holding that shape.
--
-- Customer View access: per org decision, this is a genuine external
-- client portal, not just an internal serializer — so this file adds a
-- tokenized, unauthenticated public link (roi_customer_portal_link) and
-- a SECURITY DEFINER RPC (get_roi_customer_view_public), the exact same
-- pattern STEP75's public lead-capture form already uses in this
-- codebase: anon gets EXECUTE on the RPC only, zero direct table grants.
-- There is no client login/password/session model — a client opens their
-- unique link and the RPC returns a whitelisted read-only payload. That
-- is a materially lighter interpretation of "portal" than real client
-- accounts; flagged in the handover notes for the org to revisit if
-- account-based access (vs a durable secret link) is actually required.
--
-- Every table is organization_id-scoped (NOT NULL DEFAULT
-- current_org_id(), RLS = organization_id = current_org_id()), same
-- convention STEP212 already established.
-- ============================================================

-- ── Org-level settings singleton (discount rate default, variance/risk thresholds) ──
CREATE TABLE IF NOT EXISTS roi_settings (
  id                             UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id                UUID          NOT NULL UNIQUE DEFAULT current_org_id() REFERENCES organizations(id),
  default_discount_rate_pct      NUMERIC(5,2)  NOT NULL DEFAULT 12,
  cost_variance_at_risk_pct      NUMERIC(5,2)  NOT NULL DEFAULT 10,   -- |variance%| beyond this => 'at_risk'
  cost_variance_over_budget_pct  NUMERIC(5,2)  NOT NULL DEFAULT 20,   -- |variance%| beyond this => 'over_budget'
  risk_low_spread_pct            NUMERIC(6,2)  NOT NULL DEFAULT 15,   -- sensitivity ROI% spread below this => 'low'
  risk_high_spread_pct           NUMERIC(6,2)  NOT NULL DEFAULT 40,   -- spread above this => 'high' (between = 'medium')
  created_at                     TIMESTAMPTZ   DEFAULT now(),
  updated_at                     TIMESTAMPTZ   DEFAULT now()
);

-- ── Extend roi_proposal: extended approval summary + decision outcome ──
-- status ('draft'/'pending_approval'/'approved'/'rejected') is UNCHANGED —
-- v1's state machine keeps working exactly as before. decision_outcome is
-- an additional log of the LAST approval action's flavor (the brief's
-- approve/approve_with_conditions/revise/reject), separate from status so
-- nothing about v1's approval engine has to change to support it.
ALTER TABLE roi_proposal ADD COLUMN IF NOT EXISTS decision_outcome TEXT CHECK (decision_outcome IN ('approve','approve_with_conditions','revise','reject'));
ALTER TABLE roi_proposal ADD COLUMN IF NOT EXISTS conditions_text TEXT;
-- Set true only by an 'approve_with_conditions' decision — lets calculate()
-- run again on an otherwise-frozen approved proposal for the specific
-- constrained follow-up edit the conditions call for, instead of forcing a
-- brand-new proposal. Cleared back to false the next time it's recalculated.
ALTER TABLE roi_proposal ADD COLUMN IF NOT EXISTS constrained_edit_open BOOLEAN NOT NULL DEFAULT false;
-- Snapshotted at submit-for-approval time (Section 6 of the brief) — frozen
-- the moment it's written, same immutability spirit as roi_calculation_snapshot.
ALTER TABLE roi_proposal ADD COLUMN IF NOT EXISTS approval_summary JSONB;

-- ── 1. roi_customer_baseline — the "before state" (one row per proposal) ──
CREATE TABLE IF NOT EXISTS roi_customer_baseline (
  id                   UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id      UUID          NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  proposal_id          UUID          NOT NULL UNIQUE REFERENCES roi_proposal(id) ON DELETE CASCADE,
  labor_cost           JSONB,
  energy_cost          JSONB,
  maintenance_cost     JSONB,
  operating_cost       JSONB,
  current_revenue      JSONB,
  waste_cost           JSONB,
  productivity_metric  JSONB,
  technology_spend     JSONB,
  created_at           TIMESTAMPTZ   DEFAULT now(),
  updated_at           TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roi_customer_baseline_org_idx ON roi_customer_baseline(organization_id);

-- ── 2. roi_benefit_driver — named, sourced benefit lines. Runs ALONSIDE
-- v1's per-equipment/site-wide roi_calculation_snapshot breakdown (org
-- decision: keep both) — this table is what Executive Overview,
-- Sensitivity Analysis and the Customer View aggregate over, uniformly,
-- regardless of whether a line came from v1's engine or was added by hand.
-- Auto-populated (source='calculated') from v1's snapshot breakdown every
-- time calculate() runs (see src/lib/roiProposals.js), and independently
-- addable by hand (source='manual') for lines the v1 engine doesn't model. ──
CREATE TABLE IF NOT EXISTS roi_benefit_driver (
  id                UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id   UUID          NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  proposal_id       UUID          NOT NULL REFERENCES roi_proposal(id) ON DELETE CASCADE,
  scenario          TEXT          NOT NULL CHECK (scenario IN ('conservative','expected','aggressive')),
  category          TEXT          NOT NULL CHECK (category IN ('cost_saving','revenue_uplift','productivity')),
  name              TEXT          NOT NULL,
  potential_value   JSONB         NOT NULL,
  capture_rate_pct  NUMERIC(6,3)  NOT NULL DEFAULT 0,
  realized_value    JSONB         NOT NULL, -- calculated = potential x capture_rate, source='calculated' always
  source_line_key   TEXT,         -- when auto-populated from v1: which snapshot breakdown key this mirrors (e.g. 'service_saving') — null for hand-added lines
  created_at        TIMESTAMPTZ   DEFAULT now(),
  updated_at        TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roi_benefit_driver_org_idx      ON roi_benefit_driver(organization_id);
CREATE INDEX IF NOT EXISTS roi_benefit_driver_proposal_idx ON roi_benefit_driver(proposal_id, scenario);

-- ── 3. roi_investment_line — itemized CUSTOMER-side investment, richer
-- than v1's flat iot_logger_unit_cost/software_dev_cost_onetime (which
-- stay untouched on roi_cost_driver for the existing Investment tab). ──
CREATE TABLE IF NOT EXISTS roi_investment_line (
  id               UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID          NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  proposal_id      UUID          NOT NULL REFERENCES roi_proposal(id) ON DELETE CASCADE,
  timing           TEXT          NOT NULL CHECK (timing IN ('one_time','recurring')),
  category         TEXT          NOT NULL CHECK (category IN (
                     'hardware','software','implementation','integration','training','deployment','support','subscription','other'
                   )),
  name             TEXT          NOT NULL,
  amount           JSONB         NOT NULL,
  created_at       TIMESTAMPTZ   DEFAULT now(),
  updated_at       TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roi_investment_line_org_idx      ON roi_investment_line(organization_id);
CREATE INDEX IF NOT EXISTS roi_investment_line_proposal_idx ON roi_investment_line(proposal_id);

-- ── 4. roi_delivery_cost_line — INTERNAL-side cost. Never sent to the
-- public Customer View — get_roi_customer_view_public() below never
-- queries this table at all, by construction. ──
CREATE TABLE IF NOT EXISTS roi_delivery_cost_line (
  id               UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID          NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  proposal_id      UUID          NOT NULL REFERENCES roi_proposal(id) ON DELETE CASCADE,
  category         TEXT          NOT NULL CHECK (category IN (
                     'development','engineering','product','implementation','project_management','solution_architecture',
                     'qa','infrastructure','cloud','licenses','hardware','support','contractors','travel','miscellaneous','contingency'
                   )),
  name             TEXT          NOT NULL,
  existing_amount  JSONB,  -- source='existing_project' — pulled from project_hardware_costs/project_software_costs/project_support_costs, refresh-only
  manual_amount    JSONB,  -- source='manual' — always creates a roi_manual_adjustment row too (see src/lib/roiEconomics.js)
  created_at       TIMESTAMPTZ   DEFAULT now(),
  updated_at       TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roi_delivery_cost_line_org_idx      ON roi_delivery_cost_line(organization_id);
CREATE INDEX IF NOT EXISTS roi_delivery_cost_line_proposal_idx ON roi_delivery_cost_line(proposal_id);

-- ── 5. roi_po_record + roi_po_change_order ──
CREATE TABLE IF NOT EXISTS roi_po_record (
  id               UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID          NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  proposal_id      UUID          NOT NULL UNIQUE REFERENCES roi_proposal(id) ON DELETE CASCADE,
  original_po      JSONB         NOT NULL,
  expansion_po      JSONB,
  credits           JSONB,
  created_at        TIMESTAMPTZ   DEFAULT now(),
  updated_at        TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roi_po_record_org_idx ON roi_po_record(organization_id);

CREATE TABLE IF NOT EXISTS roi_po_change_order (
  id             UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID         NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  po_record_id   UUID          NOT NULL REFERENCES roi_po_record(id) ON DELETE CASCADE,
  description    TEXT,
  amount         JSONB         NOT NULL, -- always source='manual' — a change order is inherently a hand-entered event
  date           DATE          NOT NULL DEFAULT CURRENT_DATE,
  created_by     UUID          REFERENCES profiles(id),
  created_at     TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roi_po_change_order_po_idx ON roi_po_change_order(po_record_id);

-- ── 6. roi_manual_adjustment — THE audit ledger. Every manual override
-- anywhere in this module (cost-driver edit after approval, capture-rate
-- override, a PO change order, a delivery-cost manual line) creates a row
-- here — this table is the audit trail, nothing else duplicates it. ──
CREATE TABLE IF NOT EXISTS roi_manual_adjustment (
  id               UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID          NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  proposal_id      UUID          NOT NULL REFERENCES roi_proposal(id) ON DELETE CASCADE,
  category         TEXT          NOT NULL, -- free text: which field/line this adjusts (e.g. 'delivery_cost:cloud', 'po_record:change_order')
  type             TEXT          NOT NULL CHECK (type IN ('revenue','cost')),
  amount           JSONB         NOT NULL, -- FinancialValue, source='manual' always
  reason           TEXT          NOT NULL,
  owner            UUID          NOT NULL REFERENCES profiles(id),
  date             DATE          NOT NULL DEFAULT CURRENT_DATE,
  comment          TEXT,
  approval_status  TEXT          NOT NULL DEFAULT 'none' CHECK (approval_status IN ('none','pending','approved','rejected')),
  created_at       TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roi_manual_adjustment_org_idx      ON roi_manual_adjustment(organization_id);
CREATE INDEX IF NOT EXISTS roi_manual_adjustment_proposal_idx ON roi_manual_adjustment(proposal_id, created_at DESC);

-- ── 7. roi_gross_profit_snapshot (calculated, immutable) ──
CREATE TABLE IF NOT EXISTS roi_gross_profit_snapshot (
  id                    UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id       UUID          NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  proposal_id           UUID          NOT NULL REFERENCES roi_proposal(id) ON DELETE CASCADE,
  total_po              NUMERIC(16,2) NOT NULL,
  actual_delivery_cost  NUMERIC(16,2) NOT NULL,
  gross_profit          NUMERIC(16,2) NOT NULL,
  gross_margin_pct      NUMERIC(8,3),
  breakdown             JSONB         NOT NULL, -- by delivery_cost category
  computed_at           TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roi_gross_profit_snapshot_org_idx      ON roi_gross_profit_snapshot(organization_id);
CREATE INDEX IF NOT EXISTS roi_gross_profit_snapshot_proposal_idx ON roi_gross_profit_snapshot(proposal_id, computed_at DESC);

-- ── 8. roi_result_snapshot — split Customer ROI / Internal ROI (calculated,
-- immutable). Additive alongside v1's roi_calculation_snapshot, which keeps
-- driving the existing Scenarios tab exactly as before. ──
CREATE TABLE IF NOT EXISTS roi_result_snapshot (
  id                        UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id           UUID          NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  proposal_id               UUID          NOT NULL REFERENCES roi_proposal(id) ON DELETE CASCADE,
  scenario                  TEXT          NOT NULL CHECK (scenario IN ('conservative','expected','aggressive')),
  horizon                   TEXT          NOT NULL CHECK (horizon IN ('annual','3yr','5yr')),
  customer_investment       NUMERIC(16,2) NOT NULL,
  customer_net_benefit      NUMERIC(16,2) NOT NULL,
  customer_roi_pct          NUMERIC(12,4),
  customer_payback_months   NUMERIC(10,2),
  gross_profit              NUMERIC(16,2),
  actual_delivery_cost      NUMERIC(16,2),
  internal_roi_pct          NUMERIC(12,4),
  internal_payback_months   NUMERIC(10,2),
  computed_at               TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roi_result_snapshot_org_idx    ON roi_result_snapshot(organization_id);
CREATE INDEX IF NOT EXISTS roi_result_snapshot_lookup_idx ON roi_result_snapshot(proposal_id, scenario, horizon, computed_at DESC);

-- ── 9. roi_sensitivity_run (on-demand; persisted immutably every run,
-- same audit-log convention as roi_forecast_run — no separate
-- "unsaved draft" state) ──
CREATE TABLE IF NOT EXISTS roi_sensitivity_run (
  id               UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID          NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  proposal_id      UUID          NOT NULL REFERENCES roi_proposal(id) ON DELETE CASCADE,
  scenario         TEXT          NOT NULL CHECK (scenario IN ('conservative','expected','aggressive')),
  variable_x       TEXT          NOT NULL, -- e.g. 'capture_rate_multiplier'
  variable_y       TEXT          NOT NULL, -- e.g. 'investment_multiplier'
  grid             JSONB         NOT NULL, -- { x_values:[...], y_values:[...], cells: [[{roi_pct,payback_months}...]] }
  roi_spread_pct   NUMERIC(10,3), -- max(roi_pct) - min(roi_pct) across the grid — what risk_rating is derived from
  run_at           TIMESTAMPTZ   DEFAULT now(),
  triggered_by     UUID          REFERENCES profiles(id)
);
CREATE INDEX IF NOT EXISTS roi_sensitivity_run_org_idx      ON roi_sensitivity_run(organization_id);
CREATE INDEX IF NOT EXISTS roi_sensitivity_run_proposal_idx ON roi_sensitivity_run(proposal_id, run_at DESC);

-- ── 10. roi_npv_irr_result (calculated, one per proposal per scenario/horizon) ──
CREATE TABLE IF NOT EXISTS roi_npv_irr_result (
  id                   UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id      UUID          NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  proposal_id          UUID          NOT NULL REFERENCES roi_proposal(id) ON DELETE CASCADE,
  scenario             TEXT          NOT NULL CHECK (scenario IN ('conservative','expected','aggressive')),
  horizon_years        INT           NOT NULL CHECK (horizon_years > 0),
  discount_rate_pct    NUMERIC(6,3)  NOT NULL,
  initial_investment   NUMERIC(16,2) NOT NULL,
  annual_cash_flows    JSONB         NOT NULL, -- [year1, year2, ...]
  npv                  NUMERIC(16,2),
  irr_pct              NUMERIC(10,4),
  computed_at          TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roi_npv_irr_result_org_idx      ON roi_npv_irr_result(organization_id);
CREATE INDEX IF NOT EXISTS roi_npv_irr_result_proposal_idx ON roi_npv_irr_result(proposal_id, computed_at DESC);

-- ── 11. roi_customer_portal_link — tokenized, unauthenticated external
-- access (org decision: a real external "portal" experience, but built as
-- a durable secret link + SECURITY DEFINER RPC, the exact pattern STEP75's
-- public lead-capture form already uses, rather than standing up a full
-- client account/login system. Flagged for the org: this is link-based
-- access control, not authenticated client accounts — revisit if actual
-- per-client login is required later. ──
CREATE TABLE IF NOT EXISTS roi_customer_portal_link (
  id               UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID          NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  proposal_id      UUID          NOT NULL UNIQUE REFERENCES roi_proposal(id) ON DELETE CASCADE,
  -- Two concatenated UUIDs (256 bits of randomness) instead of pgcrypto's
  -- gen_random_bytes — this codebase installs pgcrypto inconsistently
  -- (sometimes WITH SCHEMA extensions, sometimes not; see STEP190/191 vs
  -- STEP130/136), while gen_random_uuid() is core Postgres (13+), already
  -- used unqualified everywhere else in this schema with no extension risk.
  token            TEXT          NOT NULL UNIQUE DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  is_active        BOOLEAN       NOT NULL DEFAULT true,
  expires_at       TIMESTAMPTZ,
  created_by       UUID          REFERENCES profiles(id),
  created_at       TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roi_customer_portal_link_org_idx ON roi_customer_portal_link(organization_id);

-- ── updated_at triggers ───────────────────────────────────────
DROP TRIGGER IF EXISTS roi_settings_updated_at ON roi_settings;
CREATE TRIGGER roi_settings_updated_at BEFORE UPDATE ON roi_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS roi_customer_baseline_updated_at ON roi_customer_baseline;
CREATE TRIGGER roi_customer_baseline_updated_at BEFORE UPDATE ON roi_customer_baseline FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS roi_benefit_driver_updated_at ON roi_benefit_driver;
CREATE TRIGGER roi_benefit_driver_updated_at BEFORE UPDATE ON roi_benefit_driver FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS roi_investment_line_updated_at ON roi_investment_line;
CREATE TRIGGER roi_investment_line_updated_at BEFORE UPDATE ON roi_investment_line FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS roi_delivery_cost_line_updated_at ON roi_delivery_cost_line;
CREATE TRIGGER roi_delivery_cost_line_updated_at BEFORE UPDATE ON roi_delivery_cost_line FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS roi_po_record_updated_at ON roi_po_record;
CREATE TRIGGER roi_po_record_updated_at BEFORE UPDATE ON roi_po_record FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS: organization_id = current_org_id() scoping, permissive
-- within-org SELECT + role-gated writes (same convention as STEP212).
-- Calculated/immutable tables (gross_profit_snapshot, result_snapshot,
-- sensitivity_run, npv_irr_result) get INSERT only, no UPDATE/DELETE. ──
ALTER TABLE roi_settings                ENABLE ROW LEVEL SECURITY;
ALTER TABLE roi_customer_baseline       ENABLE ROW LEVEL SECURITY;
ALTER TABLE roi_benefit_driver          ENABLE ROW LEVEL SECURITY;
ALTER TABLE roi_investment_line         ENABLE ROW LEVEL SECURITY;
ALTER TABLE roi_delivery_cost_line      ENABLE ROW LEVEL SECURITY;
ALTER TABLE roi_po_record               ENABLE ROW LEVEL SECURITY;
ALTER TABLE roi_po_change_order         ENABLE ROW LEVEL SECURITY;
ALTER TABLE roi_manual_adjustment       ENABLE ROW LEVEL SECURITY;
ALTER TABLE roi_gross_profit_snapshot   ENABLE ROW LEVEL SECURITY;
ALTER TABLE roi_result_snapshot         ENABLE ROW LEVEL SECURITY;
ALTER TABLE roi_sensitivity_run         ENABLE ROW LEVEL SECURITY;
ALTER TABLE roi_npv_irr_result          ENABLE ROW LEVEL SECURITY;
ALTER TABLE roi_customer_portal_link    ENABLE ROW LEVEL SECURITY;

-- Internal management roles — same set STEP212 used throughout.
DO $$
DECLARE
  mgmt_roles TEXT[] := ARRAY['admin','ceo','cto','finance','pm','manager','department_head'];
  t TEXT;
BEGIN
  -- roi_settings: readable by anyone in-org, writable by admin/ceo/finance only
  EXECUTE 'DROP POLICY IF EXISTS roi_settings_select ON roi_settings';
  EXECUTE 'DROP POLICY IF EXISTS roi_settings_write  ON roi_settings';
  EXECUTE 'CREATE POLICY roi_settings_select ON roi_settings FOR SELECT USING (organization_id = current_org_id())';
  EXECUTE format($p$CREATE POLICY roi_settings_write ON roi_settings FOR ALL USING (
    organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
  ) WITH CHECK (
    organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
  )$p$);

  FOREACH t IN ARRAY ARRAY['roi_customer_baseline','roi_benefit_driver','roi_investment_line','roi_delivery_cost_line','roi_po_record','roi_po_change_order','roi_manual_adjustment','roi_customer_portal_link'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_select ON %1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_write  ON %1$s', t);
    EXECUTE format($p$CREATE POLICY %1$s_select ON %1$s FOR SELECT USING (organization_id = current_org_id())$p$, t);
    EXECUTE format($p$CREATE POLICY %1$s_write ON %1$s FOR ALL USING (
      organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = ANY (%2$L::text[]))
    ) WITH CHECK (
      organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = ANY (%2$L::text[]))
    )$p$, t, mgmt_roles);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['roi_gross_profit_snapshot','roi_result_snapshot','roi_sensitivity_run','roi_npv_irr_result'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_select ON %1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_insert ON %1$s', t);
    EXECUTE format($p$CREATE POLICY %1$s_select ON %1$s FOR SELECT USING (organization_id = current_org_id())$p$, t);
    EXECUTE format($p$CREATE POLICY %1$s_insert ON %1$s FOR INSERT WITH CHECK (
      organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = ANY (%2$L::text[]))
    )$p$, t, mgmt_roles);
  END LOOP;
END $$;

-- ── Public, tokenized Customer View RPC — anon gets EXECUTE only, no
-- direct table grants at all (same as STEP75's get_landing_link_public).
-- Whitelists fields explicitly (never delivery_cost, gross_profit,
-- internal_roi_pct, po_record internals, or any manual_adjustment row). ──
CREATE OR REPLACE FUNCTION get_roi_customer_view_public(p_token TEXT)
RETURNS JSONB AS $$
DECLARE v_link RECORD; v_proposal RECORD; v_result JSONB;
BEGIN
  SELECT * INTO v_link FROM roi_customer_portal_link
    WHERE token = p_token AND is_active AND (expires_at IS NULL OR expires_at > now());
  IF v_link IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_proposal FROM roi_proposal WHERE id = v_link.proposal_id;
  IF v_proposal IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'proposal', jsonb_build_object(
      'name', v_proposal.name, 'currency', v_proposal.currency,
      'duration_months', v_proposal.duration_months, 'active_scenario', v_proposal.active_scenario,
      'status', v_proposal.status
    ),
    'investment_lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('timing', il.timing, 'category', il.category, 'name', il.name, 'amount', il.amount))
      FROM roi_investment_line il WHERE il.proposal_id = v_proposal.id
    ), '[]'::jsonb),
    'benefit_drivers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('category', bd.category, 'name', bd.name, 'potential_value', bd.potential_value, 'capture_rate_pct', bd.capture_rate_pct, 'realized_value', bd.realized_value))
      FROM roi_benefit_driver bd WHERE bd.proposal_id = v_proposal.id AND bd.scenario = v_proposal.active_scenario
    ), '[]'::jsonb),
    'results_by_scenario', COALESCE((
      SELECT jsonb_object_agg(sub.scenario, sub.row)
      FROM (
        SELECT DISTINCT ON (rs.scenario) rs.scenario,
          jsonb_build_object('customer_roi_pct', rs.customer_roi_pct, 'customer_payback_months', rs.customer_payback_months,
            'customer_investment', rs.customer_investment, 'customer_net_benefit', rs.customer_net_benefit, 'horizon', rs.horizon) AS row
        FROM roi_result_snapshot rs WHERE rs.proposal_id = v_proposal.id AND rs.horizon = 'annual'
        ORDER BY rs.scenario, rs.computed_at DESC
      ) sub
    ), '{}'::jsonb),
    'npv_irr', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('scenario', n.scenario, 'horizon_years', n.horizon_years, 'discount_rate_pct', n.discount_rate_pct, 'npv', n.npv, 'irr_pct', n.irr_pct))
      FROM (SELECT DISTINCT ON (scenario) * FROM roi_npv_irr_result WHERE proposal_id = v_proposal.id ORDER BY scenario, computed_at DESC) n
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION get_roi_customer_view_public(TEXT) TO anon, authenticated;

-- Regenerate a portal link's token (invalidates the old link) — a plain
-- (not SECURITY DEFINER) function so it still runs as the calling user and
-- is subject to roi_customer_portal_link's normal RLS write policy above.
CREATE OR REPLACE FUNCTION regenerate_roi_portal_token(p_link_id UUID)
RETURNS TEXT AS $$
DECLARE v_token TEXT;
BEGIN
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  UPDATE roi_customer_portal_link SET token = v_token WHERE id = p_link_id;
  RETURN v_token;
END;
$$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION regenerate_roi_portal_token(UUID) TO authenticated;

-- ── Per-org seed: roi_settings default row (org-configurable afterward) ──
DO $$
DECLARE v_org RECORD;
BEGIN
  FOR v_org IN SELECT id FROM organizations LOOP
    INSERT INTO roi_settings (organization_id) VALUES (v_org.id)
    ON CONFLICT (organization_id) DO NOTHING;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
