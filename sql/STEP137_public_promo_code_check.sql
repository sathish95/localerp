-- ============================================================
-- STEP137: Anonymous, pre-signup promo code preview for the landing
-- page estimator — same shape as STEP105's preview_invite_code(): a
-- SECURITY DEFINER RPC granted to anon that returns ONLY what a visitor
-- needs to see (is it valid, what's the discount, is the pool still
-- open) — never the vendor's name, commission rate, or anything else
-- from the vendors table, which anon has no SELECT access to at all.
-- ============================================================

CREATE OR REPLACE FUNCTION check_promo_code(p_code TEXT)
RETURNS TABLE (valid BOOLEAN, discount_percent NUMERIC, seats_remaining INT, reason TEXT) AS $$
DECLARE
  v_vendor referral_vendors%ROWTYPE;
  v_used BIGINT;
  v_remaining INT;
BEGIN
  SELECT * INTO v_vendor FROM referral_vendors WHERE code = upper(trim(p_code));

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::NUMERIC, NULL::INT, 'Code not found';
    RETURN;
  END IF;
  IF NOT v_vendor.is_active OR NOT v_vendor.is_promoter OR v_vendor.promoter_discount_percent <= 0 THEN
    RETURN QUERY SELECT false, NULL::NUMERIC, NULL::INT, 'This code has no active discount';
    RETURN;
  END IF;

  v_used := _promoter_seats_used(v_vendor.id);
  v_remaining := CASE WHEN v_vendor.promoter_seat_allocation IS NULL THEN NULL ELSE GREATEST(0, v_vendor.promoter_seat_allocation - v_used::INT) END;

  IF v_remaining IS NOT NULL AND v_remaining <= 0 THEN
    RETURN QUERY SELECT false, v_vendor.promoter_discount_percent, 0, 'This code''s discount pool is fully used';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_vendor.promoter_discount_percent, v_remaining, NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION check_promo_code(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
