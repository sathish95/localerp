-- ============================================================
-- STEP139: Real payout tracking for vendor commissions — a payout is
-- now its own record (method, reference number, notes, who processed
-- it, when), and every commission line item it settles is linked back
-- to it. Previously "Mark Paid" just flipped a status flag on one row
-- at a time with no way to know HOW or under what reference a partner
-- was actually paid — this replaces that with a batch operation: pick
-- some or all of a vendor's pending commission rows, enter how they
-- were paid, and one payout record covers all of them atomically.
-- ============================================================

CREATE TABLE IF NOT EXISTS vendor_payouts (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id         UUID        NOT NULL REFERENCES referral_vendors(id) ON DELETE CASCADE,
  amount            NUMERIC(10,2) NOT NULL,
  method            TEXT        NOT NULL DEFAULT 'bank_transfer' CHECK (method IN ('bank_transfer', 'upi', 'cheque', 'other')),
  reference_number  TEXT,
  notes             TEXT,
  paid_by           UUID        REFERENCES profiles(id),
  paid_at           TIMESTAMPTZ DEFAULT now(),
  created_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendor_payouts_vendor_idx ON vendor_payouts(vendor_id);

ALTER TABLE vendor_commissions ADD COLUMN IF NOT EXISTS payout_id UUID REFERENCES vendor_payouts(id);

ALTER TABLE vendor_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_payouts_select ON vendor_payouts;
-- No write policy at all — every payout is created exclusively through
-- super_admin_process_payout() below (SECURITY DEFINER, bypasses RLS),
-- so there's never a path where a payout record and its linked
-- commission rows can drift out of sync with each other.
CREATE POLICY vendor_payouts_select ON vendor_payouts FOR SELECT USING (
  is_platform_super_admin() OR vendor_id = current_vendor_id()
);
GRANT SELECT ON public.vendor_payouts TO authenticated;

-- ── super_admin_process_payout() — the only writer for both tables.
-- Validates every commission id actually belongs to this vendor and is
-- still pending (so a stale client-side selection can't double-pay or
-- reach into another vendor's rows), sums them into one payout record,
-- then settles all of them against it in the same transaction. ──
CREATE OR REPLACE FUNCTION super_admin_process_payout(
  p_vendor_id UUID, p_commission_ids UUID[], p_method TEXT, p_reference TEXT, p_notes TEXT
) RETURNS UUID AS $$
DECLARE
  v_amount NUMERIC;
  v_payout_id UUID;
  v_matched_count INT;
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF array_length(p_commission_ids, 1) IS NULL OR array_length(p_commission_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Select at least one commission to pay out';
  END IF;

  SELECT count(*), COALESCE(sum(amount), 0) INTO v_matched_count, v_amount
  FROM vendor_commissions
  WHERE id = ANY(p_commission_ids) AND vendor_id = p_vendor_id AND status = 'pending';

  IF v_matched_count <> array_length(p_commission_ids, 1) THEN
    RAISE EXCEPTION 'One or more selected commissions are no longer pending or do not belong to this vendor';
  END IF;

  INSERT INTO vendor_payouts (vendor_id, amount, method, reference_number, notes, paid_by)
  VALUES (p_vendor_id, v_amount, p_method, p_reference, p_notes, auth.uid())
  RETURNING id INTO v_payout_id;

  UPDATE vendor_commissions
  SET status = 'paid', paid_at = now(), paid_by = auth.uid(), payout_id = v_payout_id
  WHERE id = ANY(p_commission_ids) AND vendor_id = p_vendor_id AND status = 'pending';

  RETURN v_payout_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION super_admin_process_payout(UUID, UUID[], TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
