-- ============================================================
-- STEP56: Sync purchase_orders.status when a GRN is received.
--
-- create_po_from_pr() (STEP54) always inserts a PO with status 'draft', and
-- receive_grn() (STEP55) never touched purchase_orders.status at all — so a
-- PO stayed "Draft" forever, even after being fully received, and remained
-- indefinitely eligible for more GRNs with no visible signal that it was
-- already fulfilled.
--
-- This replaces receive_grn() with the same body plus one addition: after
-- posting the GRN + line items + inventory ledger, it recomputes the PO's
-- cumulative receipt status across ALL grn_items ever posted against this
-- po_id (not just the current GRN — a PO can have several partial GRNs, so
-- "fully received" has to look at the running total per line, not any
-- single GRN in isolation) and updates purchase_orders.status to
-- 'delivered' once every line's cumulative received qty has met its
-- ordered qty, or 'sent' otherwise. Never touches a PO already 'closed' or
-- 'cancelled' — receiving stock doesn't reopen a closed/cancelled order.
--
-- Run AFTER STEP54 and STEP55.
-- ============================================================

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
  v_po_status    TEXT;
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
  -- sole source of truth (see STEP55 header comment).
  INSERT INTO inventory_transactions (part_number, txn_type, quantity, unit_cost, reference_type, reference_id, notes, created_by)
    SELECT p.part_number, 'stock_in', COALESCE((c->>'quantity_received')::NUMERIC, 0), COALESCE((c->>'unit_cost')::NUMERIC, 0),
           'grn', v_new_grn_id, 'Received via ' || p_grn_number, p_user_id
    FROM jsonb_array_elements(p_items) AS c
    JOIN products p ON p.part_number = c->>'part_number'
    WHERE p.is_serialized = false AND COALESCE((c->>'quantity_received')::NUMERIC, 0) > 0;

  -- Recompute the PO's overall receipt status from the running total per
  -- line (across every GRN posted against it so far, not just this one).
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM purchase_order_items poi
    WHERE poi.po_id = p_po_id
      AND poi.quantity > COALESCE((
        SELECT SUM(gi.quantity_received) FROM grn_items gi
        JOIN grn g ON g.id = gi.grn_id
        WHERE g.po_id = p_po_id AND gi.po_item_id = poi.id
      ), 0)
  ) THEN 'delivered' ELSE 'sent' END INTO v_po_status;

  UPDATE purchase_orders SET status = v_po_status
  WHERE id = p_po_id AND status NOT IN ('closed', 'cancelled');

  RETURN v_new_grn_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION receive_grn(TEXT, UUID, DATE, JSONB, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
