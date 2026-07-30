-- ============================================================
-- STEP26: Procurement Request Workflow Rebuild (Phase 1)
-- Line items, request_type, threshold-based approval chain,
-- budget-overrun override on purchase_requisitions
-- Run in Supabase SQL editor after STEP25
-- ============================================================

ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS request_type TEXT
  DEFAULT 'on_demand' CHECK (request_type IN ('production','post_production','on_demand'));
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS budget_id UUID;
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS vendor_id UUID;             -- fixes a latent bug: form captured this but never persisted it
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS demand_reference TEXT;
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS estimated_total NUMERIC(14,2) DEFAULT 0;
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS chain_type TEXT CHECK (chain_type IN ('short','full'));
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS override_flag BOOLEAN DEFAULT false;
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS override_justification TEXT;

ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS procurement_lead_approved_by UUID;
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS procurement_lead_approved_at TIMESTAMPTZ;
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS pm_approved_by UUID;
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS pm_approved_at TIMESTAMPTZ;
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS cto_approved_by UUID;
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS cto_approved_at TIMESTAMPTZ;
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS finance_approved_by UUID;
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS finance_approved_at TIMESTAMPTZ;
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS ceo_approved_by UUID;
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS ceo_approved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS pr_status_idx       ON purchase_requisitions(status);
CREATE INDEX IF NOT EXISTS pr_request_type_idx ON purchase_requisitions(request_type);
CREATE INDEX IF NOT EXISTS pr_budget_idx       ON purchase_requisitions(budget_id);
CREATE INDEX IF NOT EXISTS pr_chain_type_idx   ON purchase_requisitions(chain_type);

-- Line items
DROP TABLE IF EXISTS purchase_requisition_items CASCADE;

CREATE TABLE purchase_requisition_items (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  pr_id        UUID        NOT NULL,                  -- soft ref to purchase_requisitions
  part_number  TEXT,                                   -- soft ref to products.part_number (nullable — free-text line allowed)
  description  TEXT        NOT NULL,
  quantity     NUMERIC(12,2) DEFAULT 1,
  unit_cost    NUMERIC(14,2) DEFAULT 0,
  line_total   NUMERIC(14,2) DEFAULT 0,                -- computed client-side as quantity * unit_cost
  preferred_supplier_id UUID,                           -- soft ref to vendors
  sort_order   INT         DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX pr_items_pr_idx   ON purchase_requisition_items(pr_id);
CREATE INDEX pr_items_part_idx ON purchase_requisition_items(part_number);

ALTER TABLE purchase_requisition_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY pr_items_select ON purchase_requisition_items FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY pr_items_all    ON purchase_requisition_items FOR ALL USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
-- Row-level ownership (e.g. only requester can edit while status='draft') enforced at app level,
-- matching this project's existing pattern for child/detail tables.

-- purchase_requisitions.status stays free TEXT (no CHECK added — adding one now risks
-- rejecting existing rows sitting in the old submitted/manager_review/... values).
-- New values used going forward:
--   draft, procurement_lead_review, pm_review, cto_review, finance_review, ceo_review,
--   approved, rejected, cancelled

NOTIFY pgrst, 'reload schema';
