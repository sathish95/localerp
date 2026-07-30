-- ============================================================
-- STEP31: Budget & Finance Module — Master Data & Extensions
-- Run in Supabase SQL editor after STEP30.
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ── 1. CURRENCY BACKFILL on pre-existing monetary tables ──
ALTER TABLE budgets  ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR';

-- ── 2. ROLE_RATES (designation-keyed, effective-dated) ──
-- Soft-matches profiles.designation (free TEXT, no master table).
CREATE TABLE IF NOT EXISTS role_rates (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  designation     TEXT        NOT NULL,
  hourly_rate     NUMERIC(12,2) NOT NULL,
  currency        TEXT        DEFAULT 'INR',
  effective_from  DATE        NOT NULL,
  effective_to    DATE,                          -- null = open-ended/current rate
  notes           TEXT,
  created_by      UUID        REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS role_rates_designation_idx ON role_rates(designation);
CREATE INDEX IF NOT EXISTS role_rates_effective_idx   ON role_rates(designation, effective_from, effective_to);
DROP TRIGGER IF EXISTS role_rates_updated_at ON role_rates;
CREATE TRIGGER role_rates_updated_at BEFORE UPDATE ON role_rates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 3. FINANCE_SETTINGS (singleton row — mirrors capacity_settings precedent) ──
CREATE TABLE IF NOT EXISTS finance_settings (
  id                            INT          PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  match_variance_tolerance_pct  NUMERIC(5,2) NOT NULL DEFAULT 5,
  burn_rate_warning_pct         NUMERIC(5,2) NOT NULL DEFAULT 80,
  aging_bucket_days             INT[]        NOT NULL DEFAULT '{30,60,90}',
  updated_by                    UUID         REFERENCES profiles(id),
  updated_at                    TIMESTAMPTZ  DEFAULT now()
);
INSERT INTO finance_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
DROP TRIGGER IF EXISTS finance_settings_updated_at ON finance_settings;
CREATE TRIGGER finance_settings_updated_at BEFORE UPDATE ON finance_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 4. INVOICES extension (vendor/AP invoice — 3-way match) ──
-- match_status is NEW and separate from the pre-existing free-choice `status`
-- dropdown (which already has a 'matched' value with zero logic behind it —
-- status stays the human workflow state; match_status is the automated verdict).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS po_id              UUID;         -- soft ref to purchase_orders
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS match_status       TEXT DEFAULT 'unmatched'
  CHECK (match_status IN ('unmatched','matched','variance','override_approved'));
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS variance_percent   NUMERIC(6,2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS variance_notes     TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS match_override_by  UUID REFERENCES profiles(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS match_override_at  TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS invoices_po_idx ON invoices(po_id);

-- ── 5. PROJECT_MILESTONES extension (billing dimension) ──
-- billing_status is a SEPARATE axis from the existing CHECK-constrained `status`
-- (pending/in_progress/completed/delayed) — a milestone can be 'completed' and
-- still 'not_invoiced'. Free TEXT, no CHECK (mirrors purchase_requisitions.status's
-- precedent for an evolving status-like column). Values used: not_invoiced,
-- invoiced, partially_paid, paid.
ALTER TABLE project_milestones ADD COLUMN IF NOT EXISTS invoice_amount NUMERIC(14,2) DEFAULT 0;
ALTER TABLE project_milestones ADD COLUMN IF NOT EXISTS billing_status TEXT DEFAULT 'not_invoiced';
ALTER TABLE project_milestones ADD COLUMN IF NOT EXISTS invoiced_at TIMESTAMPTZ;
ALTER TABLE project_milestones ADD COLUMN IF NOT EXISTS currency    TEXT DEFAULT 'INR';
CREATE INDEX IF NOT EXISTS project_milestones_billing_idx ON project_milestones(billing_status);

-- ── 6. GRN extension (flagged gap: no amount field existed) ──
-- Nullable. If absent, 3-way match degrades gracefully to a 2-way PO-vs-Invoice
-- check rather than restructuring the unstructured `items` JSON blob.
ALTER TABLE grn ADD COLUMN IF NOT EXISTS received_amount NUMERIC(14,2);

-- ── 7. ROW LEVEL SECURITY (standard permissive pattern for the 2 new tables) ──
ALTER TABLE role_rates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY role_rates_all       ON role_rates       FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY finance_settings_all ON finance_settings FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- ── 8. GRANTS ──
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_rates       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_settings TO authenticated;

NOTIFY pgrst, 'reload schema';
