-- ============================================================
-- STEP57: Component ↔ Vendor mapping.
--
-- Today a vendor is only ever chosen per-PO (purchase_orders.vendor_id) —
-- there is no master mapping of "which vendor(s) supply this component,
-- at what cost". This adds that mapping so the Inventory → Components
-- view can show, per component, its approved/preferred supplier(s) and
-- (via the app layer, joining grn_items -> grn -> purchase_orders.vendor_id)
-- how much has actually been spent with each of them — the same GRN/PO
-- data the rest of the app's fund flow already uses, not a separate ledger.
--
-- part_number is a soft ref to products.part_number (matching this
-- project's established convention for tables that may not exist yet).
-- vendor_id is a REAL FK to vendors.id — the app layer uses PostgREST's
-- embed syntax (vendor:vendors(...)) in src/lib/componentVendors.js, which
-- requires a real FK to exist or PostgREST returns PGRST200 "no
-- relationship found" (same requirement STEP53 documents for
-- product_bom_versions.created_by). vendors is a pre-existing table (predates
-- this repo's sql/ folder) so there's no bootstrap-ordering risk in
-- referencing it directly, unlike products/user_stories/project_tasks.
--
-- Run after STEP25 (products) and the pre-existing vendors table.
-- ============================================================

CREATE TABLE IF NOT EXISTS component_vendors (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  part_number     TEXT        NOT NULL,   -- soft ref to products.part_number
  vendor_id       UUID        NOT NULL REFERENCES vendors(id),
  unit_cost       NUMERIC(14,2) DEFAULT 0,
  lead_time_days  INT,
  is_preferred    BOOLEAN     DEFAULT false,
  notes           TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(part_number, vendor_id)
);
CREATE INDEX IF NOT EXISTS component_vendors_part_idx   ON component_vendors(part_number);
CREATE INDEX IF NOT EXISTS component_vendors_vendor_idx ON component_vendors(vendor_id);

-- Enforces "at most one preferred vendor per component" at the DB level —
-- same pattern as product_bom_versions_active_idx (STEP52).
CREATE UNIQUE INDEX IF NOT EXISTS component_vendors_preferred_idx
  ON component_vendors(part_number) WHERE is_preferred = true;

CREATE TRIGGER component_vendors_updated_at BEFORE UPDATE ON component_vendors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE component_vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS component_vendors_select ON component_vendors;
DROP POLICY IF EXISTS component_vendors_write  ON component_vendors;

CREATE POLICY component_vendors_select ON component_vendors FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY component_vendors_write  ON component_vendors FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
);

NOTIFY pgrst, 'reload schema';
