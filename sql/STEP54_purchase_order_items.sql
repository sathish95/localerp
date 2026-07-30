-- ============================================================
-- STEP54: Purchase Order line items + PO-creation RPC
--
-- `purchase_orders` has existed since before this repo's sql/ migration
-- folder started (no CREATE TABLE for it anywhere in sql/), but nothing in
-- the app ever actually creates a row in it — PurchaseOrdersPage.jsx is a
-- pure list/detail view, every existing PO comes from SEED_demo_data_part2.
-- This migration adds real per-part_number line items (mirroring
-- purchase_requisition_items exactly) and the RPC that creates a PO from
-- an approved purchase_requisition, copying its items across.
--
-- create_po_from_pr() is SECURITY DEFINER (same pattern as save_bom_version
-- in STEP52): copying N items + computing totals + inserting the PO header
-- has to be one real transaction, which the Supabase JS client can't give
-- us across multiple calls. It re-checks the caller's role itself since
-- SECURITY DEFINER bypasses RLS.
--
-- Run in Supabase SQL Editor. Purely additive — does not touch existing
-- purchase_orders/grn rows.
-- ============================================================

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id           UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  po_id        UUID          NOT NULL,              -- soft ref to purchase_orders
  part_number  TEXT,                                 -- soft ref to products.part_number (nullable — free-text line allowed, mirrors PR items)
  description  TEXT          NOT NULL,
  quantity     NUMERIC(12,2) DEFAULT 1,
  unit_cost    NUMERIC(14,2) DEFAULT 0,
  line_total   NUMERIC(14,2) DEFAULT 0,
  sort_order   INT           DEFAULT 0,
  created_at   TIMESTAMPTZ   DEFAULT now()
);
CREATE INDEX IF NOT EXISTS po_items_po_idx   ON purchase_order_items(po_id);
CREATE INDEX IF NOT EXISTS po_items_part_idx ON purchase_order_items(part_number);

ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS po_items_select ON purchase_order_items;
DROP POLICY IF EXISTS po_items_write  ON purchase_order_items;

CREATE POLICY po_items_select ON purchase_order_items FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY po_items_write  ON purchase_order_items FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead'))
);

CREATE OR REPLACE FUNCTION create_po_from_pr(
  p_po_number     TEXT,
  p_pr_id         UUID,
  p_vendor_id     UUID,
  p_delivery_date DATE,
  p_user_id       UUID,
  p_gst_percent   NUMERIC DEFAULT 18,
  p_terms         TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_subtotal    NUMERIC(14,2);
  v_gst_amount  NUMERIC(14,2);
  v_total       NUMERIC(14,2);
  v_new_po_id   UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead')) THEN
    RAISE EXCEPTION 'Not authorized to create a Purchase Order';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM purchase_requisitions WHERE id = p_pr_id AND status = 'approved') THEN
    RAISE EXCEPTION 'Purchase requisition is not approved';
  END IF;

  IF EXISTS (SELECT 1 FROM purchase_orders WHERE pr_id = p_pr_id) THEN
    RAISE EXCEPTION 'A Purchase Order already exists for this requisition';
  END IF;

  SELECT COALESCE(SUM(line_total), 0) INTO v_subtotal FROM purchase_requisition_items WHERE pr_id = p_pr_id;
  v_gst_amount := ROUND(v_subtotal * COALESCE(p_gst_percent, 0) / 100, 2);
  v_total      := v_subtotal + v_gst_amount;

  INSERT INTO purchase_orders (po_number, vendor_id, pr_id, order_date, delivery_date, subtotal, gst_amount, total_amount, status, terms)
    VALUES (p_po_number, p_vendor_id, p_pr_id, CURRENT_DATE, p_delivery_date, v_subtotal, v_gst_amount, v_total, 'draft', p_terms)
    RETURNING id INTO v_new_po_id;

  INSERT INTO purchase_order_items (po_id, part_number, description, quantity, unit_cost, line_total, sort_order)
    SELECT v_new_po_id, part_number, description, quantity, unit_cost, line_total, sort_order
    FROM purchase_requisition_items WHERE pr_id = p_pr_id;

  RETURN v_new_po_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION create_po_from_pr(TEXT, UUID, UUID, DATE, UUID, NUMERIC, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
