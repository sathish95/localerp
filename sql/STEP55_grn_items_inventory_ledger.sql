-- ============================================================
-- STEP55: GRN line items + the inventory stock ledger + the
-- receive-GRN RPC that posts stock automatically.
--
-- `grn.items` has always been a free-text JSON blob with no part_number
-- (seed data even writes it as '[]') and nothing in the app ever wrote to
-- it — GRNPage.jsx is read-only. This migration adds real `grn_items`
-- (part_number-linked, mirrors purchase_order_items) and
-- `inventory_transactions`, an append-only stock-movement ledger.
--
-- Ledger scope: NON-SERIALIZED components only (products.is_serialized =
-- false). Serialized products already have a correct on-hand source —
-- device_instances.status = 'in_storage' — receiving a serialized part on
-- a GRN records the receipt (in grn_items, for spend/audit) but does NOT
-- fabricate a device_instances row with a made-up serial number; the user
-- still registers real units in the Devices page, same as today.
--
-- On-hand quantity for a non-serialized part = SUM(quantity) from
-- inventory_transactions — no separate running-balance column, computed
-- on read, same convention as company_spend_rollup-style aggregates
-- already used elsewhere in this app (getBomCompanySummary, getSpendByProduct).
--
-- receive_grn() is SECURITY DEFINER (same pattern as save_bom_version /
-- create_po_from_pr): insert GRN header + N grn_items + N ledger postings
-- has to be one real transaction, not several sequential client calls.
--
-- Run AFTER STEP54 (references purchase_order_items indirectly via the
-- po_item_id soft ref passed in from the client). Purely additive.
-- ============================================================

CREATE TABLE IF NOT EXISTS grn_items (
  id                 UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  grn_id             UUID          NOT NULL,   -- soft ref to grn
  po_item_id         UUID,                      -- soft ref to purchase_order_items (nullable)
  part_number        TEXT,                      -- soft ref to products.part_number
  description        TEXT          NOT NULL,
  quantity_ordered   NUMERIC(12,2) DEFAULT 0,
  quantity_received  NUMERIC(12,2) DEFAULT 0,
  unit_cost          NUMERIC(14,2) DEFAULT 0,
  created_at         TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS grn_items_grn_idx  ON grn_items(grn_id);
CREATE INDEX IF NOT EXISTS grn_items_part_idx ON grn_items(part_number);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id             UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  part_number    TEXT          NOT NULL,        -- soft ref to products.part_number
  txn_type       TEXT          NOT NULL CHECK (txn_type IN ('stock_in','stock_out','adjustment')),
  quantity       NUMERIC(12,2) NOT NULL,         -- signed: stock_in > 0, stock_out < 0, adjustment either
  unit_cost      NUMERIC(14,2) DEFAULT 0,        -- cost snapshot at time of movement (audit only — valuation elsewhere always uses live products.standard_cost)
  reference_type TEXT          DEFAULT 'manual' CHECK (reference_type IN ('manual','grn','consumption')),
  reference_id   UUID,                           -- soft ref (grn.id when reference_type='grn')
  notes          TEXT,
  created_by     UUID          REFERENCES profiles(id),
  created_at     TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_txn_part_idx ON inventory_transactions(part_number);
CREATE INDEX IF NOT EXISTS inventory_txn_ref_idx  ON inventory_transactions(reference_type, reference_id);

ALTER TABLE grn_items               ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS grn_items_select ON grn_items;
DROP POLICY IF EXISTS grn_items_write  ON grn_items;
DROP POLICY IF EXISTS inventory_txn_select ON inventory_transactions;
DROP POLICY IF EXISTS inventory_txn_write  ON inventory_transactions;

CREATE POLICY grn_items_select ON grn_items FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY grn_items_write  ON grn_items FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
);

CREATE POLICY inventory_txn_select ON inventory_transactions FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY inventory_txn_write  ON inventory_transactions FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
);

CREATE OR REPLACE FUNCTION receive_grn(
  p_grn_number    TEXT,
  p_po_id         UUID,
  p_received_date DATE,
  p_items         JSONB,     -- array of {po_item_id, part_number, description, quantity_ordered, quantity_received, unit_cost}
  p_user_id       UUID,
  p_remarks       TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_new_grn_id   UUID;
  v_status       TEXT;
  v_received_amt NUMERIC(14,2);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead')) THEN
    RAISE EXCEPTION 'Not authorized to receive a GRN';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one item is required';
  END IF;

  SELECT
    CASE WHEN bool_and(COALESCE((c->>'quantity_received')::NUMERIC, 0) >= COALESCE((c->>'quantity_ordered')::NUMERIC, 0))
         THEN 'received' ELSE 'partial' END,
    COALESCE(SUM(COALESCE((c->>'quantity_received')::NUMERIC, 0) * COALESCE((c->>'unit_cost')::NUMERIC, 0)), 0)
  INTO v_status, v_received_amt
  FROM jsonb_array_elements(p_items) AS c;

  INSERT INTO grn (grn_number, po_id, received_date, status, remarks, items, received_amount)
    VALUES (p_grn_number, p_po_id, p_received_date, v_status, p_remarks, '[]', v_received_amt)
    RETURNING id INTO v_new_grn_id;

  INSERT INTO grn_items (grn_id, po_item_id, part_number, description, quantity_ordered, quantity_received, unit_cost)
    SELECT v_new_grn_id,
           NULLIF(c->>'po_item_id', '')::UUID,
           c->>'part_number',
           c->>'description',
           COALESCE((c->>'quantity_ordered')::NUMERIC, 0),
           COALESCE((c->>'quantity_received')::NUMERIC, 0),
           COALESCE((c->>'unit_cost')::NUMERIC, 0)
    FROM jsonb_array_elements(p_items) AS c;

  -- Auto-post stock-in only for non-serialized parts with a positive
  -- received quantity — serialized parts keep device_instances as their
  -- sole source of truth (see header comment).
  INSERT INTO inventory_transactions (part_number, txn_type, quantity, unit_cost, reference_type, reference_id, notes, created_by)
    SELECT p.part_number, 'stock_in', COALESCE((c->>'quantity_received')::NUMERIC, 0), COALESCE((c->>'unit_cost')::NUMERIC, 0),
           'grn', v_new_grn_id, 'Received via ' || p_grn_number, p_user_id
    FROM jsonb_array_elements(p_items) AS c
    JOIN products p ON p.part_number = c->>'part_number'
    WHERE p.is_serialized = false AND COALESCE((c->>'quantity_received')::NUMERIC, 0) > 0;

  RETURN v_new_grn_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION receive_grn(TEXT, UUID, DATE, JSONB, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
