-- ============================================================
-- STEP106: Fix cross-org data leaks in pre-existing SECURITY DEFINER
-- procurement/BOM RPCs, surfaced by the multi-tenant RLS retrofit
-- (STEP96/STEP97) org-scoping the tables these functions read from.
--
-- create_po_from_pr() (STEP54), receive_grn() (STEP55) and
-- save_bom_version() (STEP52) are all SECURITY DEFINER — they bypass
-- RLS entirely — and none of them re-check that the id they're handed
-- (a PR id, a PO id, a part number) actually belongs to the caller's
-- own organization. STEP97's own header claimed create_po_from_pr()/
-- receive_grn() "need no changes" because the tables they INSERT INTO
-- pick up organization_id via DEFAULT current_org_id() — true for the
-- write side, but irrelevant to the read side: nothing stopped a user
-- in Org A from passing a PR id (or PO id, or part number) that
-- belongs to Org B and having this function silently copy Org B's
-- requisition/PO/BOM line-item data into a new row that lands in Org
-- A's tenant (organization_id = current_org_id() = Org A, via the
-- DEFAULT). A single WHERE ... organization_id = current_org_id()
-- clause on each lookup closes this.
--
-- Same three functions also accepted p_user_id as a bare parameter and
-- only checked its role, never that it was the actual caller
-- (auth.uid()) — meaning any authenticated user could have named a
-- more-privileged colleague's profile id to pass the role check. Every
-- app-code caller (src/lib/purchaseOrders.js, grn.js, bom.js) already
-- always passes the signed-in user's own id here, so tightening this
-- to require p_user_id = auth.uid() changes no legitimate call site.
-- ============================================================

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
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to create a Purchase Order';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead')) THEN
    RAISE EXCEPTION 'Not authorized to create a Purchase Order';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM purchase_requisitions WHERE id = p_pr_id AND status = 'approved' AND organization_id = current_org_id()) THEN
    RAISE EXCEPTION 'Purchase requisition is not approved';
  END IF;

  IF EXISTS (SELECT 1 FROM purchase_orders WHERE pr_id = p_pr_id AND organization_id = current_org_id()) THEN
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION receive_grn(
  p_grn_number    TEXT,
  p_po_id         UUID,
  p_received_date DATE,
  p_items         JSONB,
  p_user_id       UUID,
  p_remarks       TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_new_grn_id   UUID;
  v_status       TEXT;
  v_received_amt NUMERIC(14,2);
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to receive a GRN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead')) THEN
    RAISE EXCEPTION 'Not authorized to receive a GRN';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM purchase_orders WHERE id = p_po_id AND organization_id = current_org_id()) THEN
    RAISE EXCEPTION 'Purchase order not found';
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

  INSERT INTO inventory_transactions (part_number, txn_type, quantity, unit_cost, reference_type, reference_id, notes, created_by)
    SELECT p.part_number, 'stock_in', COALESCE((c->>'quantity_received')::NUMERIC, 0), COALESCE((c->>'unit_cost')::NUMERIC, 0),
           'grn', v_new_grn_id, 'Received via ' || p_grn_number, p_user_id
    FROM jsonb_array_elements(p_items) AS c
    JOIN products p ON p.part_number = c->>'part_number'
    WHERE p.is_serialized = false AND COALESCE((c->>'quantity_received')::NUMERIC, 0) > 0;

  RETURN v_new_grn_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION save_bom_version(
  p_part_number TEXT,
  p_components  JSONB,
  p_user_id     UUID,
  p_notes       TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_next_version INT;
  v_new_version_id UUID;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to edit BOM';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id AND role IN ('admin','ceo','manager','department_head','finance','procurement_lead')) THEN
    RAISE EXCEPTION 'Not authorized to edit BOM';
  END IF;

  SELECT COALESCE(MAX(version_no), 0) + 1 INTO v_next_version FROM product_bom_versions WHERE part_number = p_part_number AND organization_id = current_org_id();

  UPDATE product_bom_versions SET status = 'archived' WHERE part_number = p_part_number AND status = 'active' AND organization_id = current_org_id();

  INSERT INTO product_bom_versions (part_number, version_no, status, notes, created_by)
    VALUES (p_part_number, v_next_version, 'active', p_notes, p_user_id)
    RETURNING id INTO v_new_version_id;

  INSERT INTO product_bom_version_components (version_id, component_part_number, quantity, notes)
    SELECT v_new_version_id, (c->>'component_part_number')::TEXT, (c->>'quantity')::NUMERIC, c->>'notes'
    FROM jsonb_array_elements(p_components) AS c;

  RETURN v_new_version_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

NOTIFY pgrst, 'reload schema';
