-- ============================================================
-- STEP37: Warranty Management — core tables
-- Run AFTER STEP37a (field_technician role must exist first) and
-- after STEP25 (products, device_instances, deployment_history).
--
-- Integrates with, does not duplicate, the existing device register
-- (device_instances) and product catalog (products). A device's
-- warranty clock ticks from DEPLOYMENT date, not purchase/manufacture
-- date — see device_warranties.deployment_date below.
--
-- warranty_end_date is a plain DATE, computed CLIENT-SIDE at insert
-- time by src/lib/warranty.js (computeWarrantyWindow), NOT a Postgres
-- generated column — this app never uses DB-computed derived values
-- (see actual_cost_snapshots, capacity_snapshots, company_spend_rollup
-- for the same convention); all "recompute" logic lives in the JS lib
-- layer and is triggered manually, there's no cron/serverless layer.
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ── 1. WARRANTY_POLICIES — one row per product type ──
CREATE TABLE IF NOT EXISTS warranty_policies (
  id                              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  part_number                     TEXT,                                    -- soft ref -> products.part_number
  policy_name                     TEXT        NOT NULL,
  warranty_duration_months        INT         NOT NULL DEFAULT 12,
  coverage_type                   TEXT        NOT NULL DEFAULT 'Both' CHECK (coverage_type IN ('Replacement','Repair','Both')),
  hardware_covered                BOOLEAN     NOT NULL DEFAULT true,
  software_covered                BOOLEAN     NOT NULL DEFAULT false,
  fresh_warranty_on_replacement   BOOLEAN     NOT NULL DEFAULT true,        -- true = replacement gets a full fresh window; false = inherits remaining time
  terms_notes                     TEXT,
  is_active                       BOOLEAN     NOT NULL DEFAULT true,
  created_by                      UUID        REFERENCES profiles(id),
  created_at                      TIMESTAMPTZ DEFAULT now(),
  updated_at                      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warranty_policies_part_idx ON warranty_policies(part_number);

DROP TRIGGER IF EXISTS warranty_policies_updated_at ON warranty_policies;
CREATE TRIGGER warranty_policies_updated_at BEFORE UPDATE ON warranty_policies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. DEVICE_WARRANTIES — one row per deployment lifecycle (a replacement
-- device gets its OWN row, linked back via replaced_from_warranty_id). This
-- is the audit-trail source of truth; device_instances.warranty_start/
-- warranty_end (already existing columns DevicesPage.jsx's near-expiry
-- badge reads) are kept in sync as a current-state mirror, not replaced. ──
CREATE TABLE IF NOT EXISTS device_warranties (
  id                        UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id                 UUID        NOT NULL,                -- soft ref -> device_instances.id
  warranty_policy_id        UUID,                                 -- soft ref -> warranty_policies.id
  deployment_date           DATE        NOT NULL,
  warranty_start_date       DATE        NOT NULL,
  warranty_end_date         DATE        NOT NULL,                 -- client-computed at insert, see file header
  project_id                UUID,                                 -- soft ref -> projects.id
  status                    TEXT        NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Expired','Voided')),
  replaced_from_warranty_id UUID,                                 -- soft self-ref -> device_warranties.id
  created_by                UUID        REFERENCES profiles(id),
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS device_warranties_device_idx  ON device_warranties(device_id);
CREATE INDEX IF NOT EXISTS device_warranties_project_idx ON device_warranties(project_id);
CREATE INDEX IF NOT EXISTS device_warranties_end_idx     ON device_warranties(warranty_end_date);
CREATE INDEX IF NOT EXISTS device_warranties_replaced_idx ON device_warranties(replaced_from_warranty_id);

DROP TRIGGER IF EXISTS device_warranties_updated_at ON device_warranties;
CREATE TRIGGER device_warranties_updated_at BEFORE UPDATE ON device_warranties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 3. WARRANTY_CLAIMS — one row per failure/claim event. Approval columns
-- mirror STEP26's per-step pattern (a cost-threshold-branched chain, same
-- shape as src/lib/procurementApproval.js — a SEPARATE engine from the
-- submitter-role-indexed approvalFlow.js). ──
CREATE TABLE IF NOT EXISTS warranty_claims (
  id                            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_number                  TEXT        NOT NULL UNIQUE,
  device_warranty_id            UUID,                              -- soft ref -> device_warranties.id; NULL when the device has no warranty record at all (still a loggable Rejected-Out of Warranty claim)
  device_id                     UUID        NOT NULL,             -- denormalized soft ref -> device_instances.id, for serial search
  claim_date                    DATE        NOT NULL DEFAULT CURRENT_DATE,
  issue_description             TEXT        NOT NULL,
  issue_type                    TEXT        NOT NULL CHECK (issue_type IN ('Hardware Failure','Software-Firmware Issue','Sensor Drift','Other')),
  resolution_type                TEXT        CHECK (resolution_type IN ('Replace','Repair','Remote Fix-No Cost','Rejected-Out of Warranty')),
  replacement_device_id         UUID,                              -- soft ref -> device_instances.id, nullable
  status                        TEXT        NOT NULL DEFAULT 'Reported' CHECK (status IN ('Reported','Under Review','Approved','Resolved','Rejected')),
  raised_by                     UUID        REFERENCES profiles(id),
  resolved_date                 DATE,
  estimated_cost                NUMERIC(14,2) DEFAULT 0,           -- non-authoritative estimate used only to route the approval chain
  chain_type                    TEXT        CHECK (chain_type IN ('short','full')),
  procurement_lead_approved_by  UUID        REFERENCES profiles(id),
  procurement_lead_approved_at  TIMESTAMPTZ,
  finance_approved_by           UUID        REFERENCES profiles(id),
  finance_approved_at           TIMESTAMPTZ,
  rejection_reason              TEXT,
  override_flag                 BOOLEAN     DEFAULT false,
  override_justification        TEXT,
  created_at                    TIMESTAMPTZ DEFAULT now(),
  updated_at                    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warranty_claims_device_idx     ON warranty_claims(device_id);
CREATE INDEX IF NOT EXISTS warranty_claims_devwty_idx     ON warranty_claims(device_warranty_id);
CREATE INDEX IF NOT EXISTS warranty_claims_status_idx     ON warranty_claims(status);
CREATE INDEX IF NOT EXISTS warranty_claims_date_idx       ON warranty_claims(claim_date);

DROP TRIGGER IF EXISTS warranty_claims_updated_at ON warranty_claims;
CREATE TRIGGER warranty_claims_updated_at BEFORE UPDATE ON warranty_claims
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 4. WARRANTY_COST_ENTRIES — the actual money, always split Hardware vs
-- Software as separate rows, never lumped. source_standard_cost_snapshot
-- freezes products.standard_cost at replacement time so later cost changes
-- don't retroactively rewrite historical warranty cost records. ──
CREATE TABLE IF NOT EXISTS warranty_cost_entries (
  id                              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  warranty_claim_id               UUID        NOT NULL,            -- soft ref -> warranty_claims.id
  cost_type                       TEXT        NOT NULL CHECK (cost_type IN ('Hardware','Software')),
  amount                          NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency                        TEXT        NOT NULL DEFAULT 'INR',
  cost_breakdown                  TEXT,                             -- e.g. replacement unit cost, shipping, technician time, support hours
  incurred_date                   DATE        NOT NULL DEFAULT CURRENT_DATE,
  source_standard_cost_snapshot   NUMERIC(14,2),                    -- products.standard_cost AT TIME OF REPLACEMENT, frozen — not a live reference
  created_by                      UUID        REFERENCES profiles(id),
  created_at                      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warranty_cost_entries_claim_idx ON warranty_cost_entries(warranty_claim_id);
CREATE INDEX IF NOT EXISTS warranty_cost_entries_date_idx  ON warranty_cost_entries(incurred_date);

-- ── 5. WARRANTY_BUDGETS — the "planned" side, compared against actual
-- warranty_cost_entries totals. scope_key is a deterministic non-null
-- column (part_number, or 'PROJECT:'+project_id) because Postgres treats
-- NULLs as distinct in a UNIQUE constraint — a nullable part_number/
-- project_id pair would silently allow duplicate rows (same pitfall
-- company_spend_rollup's design had to account for). ──
CREATE TABLE IF NOT EXISTS warranty_budgets (
  id                        UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  scope_type                TEXT        NOT NULL CHECK (scope_type IN ('product_type','project')),
  scope_key                 TEXT        NOT NULL,                   -- part_number, or 'PROJECT:'+project_id
  part_number                TEXT,                                   -- soft ref -> products.part_number, set when scope_type='product_type'
  project_id                 UUID,                                   -- soft ref -> projects.id, set when scope_type='project'
  period_key                 TEXT        NOT NULL,                   -- e.g. '2026' or '2026-Q1'
  planned_warranty_reserve   NUMERIC(14,2) NOT NULL DEFAULT 0,
  planning_method             TEXT        NOT NULL DEFAULT 'flat_per_unit' CHECK (planning_method IN ('pct_unit_cost','pct_revenue','flat_per_unit')),
  planning_param               NUMERIC(10,4) DEFAULT 0,               -- the % (as e.g. 5.00) or flat amount, interpreted per planning_method
  created_by                  UUID        REFERENCES profiles(id),
  created_at                  TIMESTAMPTZ DEFAULT now(),
  updated_at                  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (scope_key, period_key)
);
CREATE INDEX IF NOT EXISTS warranty_budgets_scope_idx ON warranty_budgets(scope_type);

DROP TRIGGER IF EXISTS warranty_budgets_updated_at ON warranty_budgets;
CREATE TRIGGER warranty_budgets_updated_at BEFORE UPDATE ON warranty_budgets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 6. WARRANTY_SETTINGS (singleton row) — mirrors capacity_settings (STEP30) ──
CREATE TABLE IF NOT EXISTS warranty_settings (
  id                                    INT         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  claim_auto_approve_threshold          NUMERIC(14,2) NOT NULL DEFAULT 25000,
  near_expiry_alert_days                INT         NOT NULL DEFAULT 30,
  default_fresh_warranty_on_replacement BOOLEAN     NOT NULL DEFAULT true,
  updated_by                            UUID        REFERENCES profiles(id),
  updated_at                            TIMESTAMPTZ DEFAULT now()
);
INSERT INTO warranty_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS warranty_settings_updated_at ON warranty_settings;
CREATE TRIGGER warranty_settings_updated_at BEFORE UPDATE ON warranty_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 7. WARRANTY_ANALYTICS_ROLLUP — claim rate / cost-per-claim / time-to-
-- failure, materialized like company_spend_rollup, recomputed manually via
-- a "Recompute Now" button (no cron/serverless layer in this stack). ──
CREATE TABLE IF NOT EXISTS warranty_analytics_rollup (
  id                        UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  period_key                TEXT        NOT NULL,                   -- 'YYYY' or 'ALL' (lifetime-to-date)
  part_number                TEXT        NOT NULL DEFAULT 'ALL',     -- 'ALL' = company-wide row
  issue_type                 TEXT        NOT NULL DEFAULT 'ALL',
  units_deployed              INT         DEFAULT 0,
  claims_count                 INT         DEFAULT 0,
  claim_rate_per_100           NUMERIC(8,2) DEFAULT 0,
  avg_cost_per_claim            NUMERIC(14,2) DEFAULT 0,
  avg_time_to_failure_days      NUMERIC(8,2) DEFAULT 0,
  hardware_cost_total           NUMERIC(14,2) DEFAULT 0,
  software_cost_total           NUMERIC(14,2) DEFAULT 0,
  planned_reserve_total         NUMERIC(14,2) DEFAULT 0,
  actual_cost_total             NUMERIC(14,2) DEFAULT 0,
  variance_amount                NUMERIC(14,2) DEFAULT 0,            -- client-computed = actual - planned
  computed_at                    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (period_key, part_number, issue_type)
);
CREATE INDEX IF NOT EXISTS warranty_analytics_rollup_period_idx ON warranty_analytics_rollup(period_key);
CREATE INDEX IF NOT EXISTS warranty_analytics_rollup_part_idx   ON warranty_analytics_rollup(part_number);

-- ── 8. ROW LEVEL SECURITY ──
-- Permissive (client-gated in WarrantyPage.jsx / role checks) for tables
-- without direct $ exposure beyond a non-authoritative estimate:
ALTER TABLE warranty_policies         ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_warranties         ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranty_claims           ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranty_settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranty_analytics_rollup ENABLE ROW LEVEL SECURITY;

-- DROP POLICY IF EXISTS before each CREATE POLICY so this script is safely
-- re-runnable — Postgres has no CREATE POLICY IF NOT EXISTS, unlike the
-- CREATE TABLE/INDEX/TRIGGER statements above.
DROP POLICY IF EXISTS warranty_policies_all         ON warranty_policies;
DROP POLICY IF EXISTS device_warranties_all         ON device_warranties;
DROP POLICY IF EXISTS warranty_claims_all           ON warranty_claims;
DROP POLICY IF EXISTS warranty_settings_all         ON warranty_settings;
DROP POLICY IF EXISTS warranty_analytics_rollup_all ON warranty_analytics_rollup;

CREATE POLICY warranty_policies_all         ON warranty_policies         FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY device_warranties_all         ON device_warranties         FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY warranty_claims_all           ON warranty_claims           FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY warranty_settings_all         ON warranty_settings         FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY warranty_analytics_rollup_all ON warranty_analytics_rollup FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Restrictive server-side RLS for the real $ tables — same precedent as
-- profit_margins (STEP35) / the existing /fundflow isFinance gate, since
-- these carry the figures that directly move profit.
ALTER TABLE warranty_cost_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranty_budgets      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warranty_cost_entries_select ON warranty_cost_entries;
DROP POLICY IF EXISTS warranty_cost_entries_insert ON warranty_cost_entries;
DROP POLICY IF EXISTS warranty_cost_entries_update ON warranty_cost_entries;
DROP POLICY IF EXISTS warranty_budgets_select ON warranty_budgets;
DROP POLICY IF EXISTS warranty_budgets_insert ON warranty_budgets;
DROP POLICY IF EXISTS warranty_budgets_update ON warranty_budgets;
DROP POLICY IF EXISTS warranty_budgets_delete ON warranty_budgets;

CREATE POLICY warranty_cost_entries_select ON warranty_cost_entries FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
);
CREATE POLICY warranty_cost_entries_insert ON warranty_cost_entries FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
);
CREATE POLICY warranty_cost_entries_update ON warranty_cost_entries FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
);

CREATE POLICY warranty_budgets_select ON warranty_budgets FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
);
CREATE POLICY warranty_budgets_insert ON warranty_budgets FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
);
CREATE POLICY warranty_budgets_update ON warranty_budgets FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
);
CREATE POLICY warranty_budgets_delete ON warranty_budgets FOR DELETE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','finance'))
);

-- ── 9. GRANTS (RLS alone is not enough — base table privileges required too) ──
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warranty_policies         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_warranties         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warranty_claims           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warranty_settings         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warranty_analytics_rollup TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.warranty_cost_entries     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warranty_budgets          TO authenticated;

NOTIFY pgrst, 'reload schema';
