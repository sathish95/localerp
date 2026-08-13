-- ============================================================
-- STEP135: Promoter program — a super-admin-allocated seat pool + a
-- discount percentage, distinct from STEP134's commission model. A
-- vendor row can be marked is_promoter (independent of whether it also
-- earns commission — the two are additive, not exclusive):
--   promoter_seat_allocation  — total seats granted (NULL = uncapped,
--                               same "NULL means unrestricted"
--                               convention as seat_limit_override).
--   promoter_discount_percent — % off every payment for every org this
--                               promoter refers, for as long as that
--                               org's seats fall within the shared pool.
--
-- The pool is SHARED across every org the promoter refers, and consumed
-- live by their current active headcounts (never a stored running
-- counter that could drift as employees are added/removed) — computed
-- fresh on every pricing call by _promoter_seats_used(). Once the pool
-- is exhausted, additional seats (in any of the promoter's orgs) bill
-- at full price; the discount is prorated seat-by-seat at the boundary
-- (see create-payment-order's getPromoterPricing(), which is where the
-- actual math lives — this migration only adds the schema + the RPCs
-- the UI needs to show pool status).
-- ============================================================

ALTER TABLE referral_vendors ADD COLUMN IF NOT EXISTS is_promoter BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE referral_vendors ADD COLUMN IF NOT EXISTS promoter_seat_allocation INT;
ALTER TABLE referral_vendors ADD COLUMN IF NOT EXISTS promoter_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0;

-- Financial audit trail — so a transaction record shows a discount was
-- applied and by which promoter, not just a suspiciously lower amount.
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS promoter_vendor_id UUID REFERENCES referral_vendors(id);

CREATE OR REPLACE FUNCTION _promoter_seats_used(p_vendor_id UUID, p_exclude_org_id UUID DEFAULT NULL)
RETURNS BIGINT AS $$
  SELECT COALESCE(SUM(
    (SELECT count(*) FROM profiles pr WHERE pr.organization_id = o.id AND pr.is_active = true)
  ), 0)
  FROM organizations o
  WHERE o.referred_by_vendor_id = p_vendor_id AND o.deleted_at IS NULL
    AND (p_exclude_org_id IS NULL OR o.id <> p_exclude_org_id)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ── vendor_my_seat_pool_status() — the promoter dashboard's read path. ──
CREATE OR REPLACE FUNCTION vendor_my_seat_pool_status()
RETURNS TABLE (is_promoter BOOLEAN, seat_allocation INT, discount_percent NUMERIC, seats_used BIGINT) AS $$
DECLARE v_vendor_id UUID := current_vendor_id();
BEGIN
  IF v_vendor_id IS NULL THEN
    RAISE EXCEPTION 'Not a vendor account';
  END IF;
  RETURN QUERY
    SELECT v.is_promoter, v.promoter_seat_allocation, v.promoter_discount_percent, _promoter_seats_used(v.id)
    FROM referral_vendors v WHERE v.id = v_vendor_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION vendor_my_seat_pool_status() TO authenticated;

-- ── super_admin_list_vendors() — extended with promoter fields. DROP
-- first: CREATE OR REPLACE cannot change a function's OUT-parameter row
-- type, only its body (same issue hit in STEP107/108/124/129). ──
DROP FUNCTION IF EXISTS super_admin_list_vendors();
CREATE OR REPLACE FUNCTION super_admin_list_vendors()
RETURNS TABLE (
  id UUID, name TEXT, code TEXT, commission_type TEXT, commission_rate NUMERIC,
  is_active BOOLEAN, created_at TIMESTAMPTZ,
  referred_org_count BIGINT, pending_commission NUMERIC, paid_commission NUMERIC,
  is_promoter BOOLEAN, promoter_seat_allocation INT, promoter_discount_percent NUMERIC, promoter_seats_used BIGINT
) AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT v.id, v.name, v.code, v.commission_type, v.commission_rate, v.is_active, v.created_at,
      (SELECT count(*) FROM organizations o WHERE o.referred_by_vendor_id = v.id AND o.deleted_at IS NULL),
      (SELECT COALESCE(sum(amount), 0) FROM vendor_commissions vc WHERE vc.vendor_id = v.id AND vc.status = 'pending'),
      (SELECT COALESCE(sum(amount), 0) FROM vendor_commissions vc WHERE vc.vendor_id = v.id AND vc.status = 'paid'),
      v.is_promoter, v.promoter_seat_allocation, v.promoter_discount_percent, _promoter_seats_used(v.id)
    FROM referral_vendors v
    ORDER BY v.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION super_admin_list_vendors() TO authenticated;

-- ── super_admin_set_promoter() — the only writer for the three new
-- columns (vendors_write RLS from STEP134 already covers a plain
-- UPDATE too, but a dedicated function keeps validation in one place). ──
CREATE OR REPLACE FUNCTION super_admin_set_promoter(
  p_vendor_id UUID, p_is_promoter BOOLEAN, p_seat_allocation INT, p_discount_percent NUMERIC
) RETURNS VOID AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_discount_percent < 0 OR p_discount_percent > 100 THEN
    RAISE EXCEPTION 'Discount percent must be between 0 and 100';
  END IF;
  UPDATE referral_vendors SET
    is_promoter = p_is_promoter,
    promoter_seat_allocation = p_seat_allocation,
    promoter_discount_percent = p_discount_percent
  WHERE id = p_vendor_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION super_admin_set_promoter(UUID, BOOLEAN, INT, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';
