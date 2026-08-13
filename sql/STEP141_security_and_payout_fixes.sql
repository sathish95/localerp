-- ============================================================
-- STEP141: Fixes from a review pass over the vendor/promoter system —
-- one critical, pre-existing platform-wide hole surfaced by that
-- review, plus three real correctness bugs in the payout/discount
-- logic built this session.
--
-- 1. CRITICAL — profiles had exactly one RLS policy (STEP96's `open`):
--      USING (organization_id = current_org_id() OR id = auth.uid())
--    with no column-level restriction at all. Any authenticated user
--    could run, from the browser console:
--      supabase.from('profiles').update({ is_super_admin: true }).eq('id', myOwnId)
--    and grant themselves platform super admin — or set `vendor_id` to
--    any existing referral_vendors.id and read that partner's
--    commission ledger/payouts, or set `role` to 'admin'/'ceo' outright.
--    This predates the vendor/promoter work but that work is what made
--    it newly consequential (a real commission/payout system now sits
--    on top of it). Fixed with a BEFORE UPDATE trigger that reverts
--    is_super_admin/vendor_id/role to their prior value unless the
--    caller is already a platform super admin (for is_super_admin/
--    vendor_id) or an org admin/ceo/hr (for role, matching the existing
--    UI-level convention in UsersPage.jsx) — every OTHER column on a
--    profile remains freely self-editable, unchanged. `auth.uid() IS
--    NULL` bypasses the check entirely: that's the signature of a
--    trusted internal context (handle_new_user()'s trigger-driven
--    INSERT ... ON CONFLICT DO UPDATE runs with no JWT at all, not a
--    browser session), never the exploitable path.
--
-- 2. `super_admin_mark_commission_paid()` (STEP134) let a commission be
--    marked paid one row at a time with zero payout record — exactly
--    what STEP139's atomic payout ledger was built to prevent. Nothing
--    in the app calls it anymore; dropped outright rather than left as
--    a live bypass reachable via supabase.rpc(...).
--
-- 3. `super_admin_process_payout()` (STEP139) validated commissions were
--    still 'pending' with a plain SELECT (no row lock) and never
--    checked the subsequent UPDATE actually affected every row —
--    two concurrent calls with overlapping commission_ids could both
--    pass validation and both create a payout record for the same
--    commissions, double-counting what was actually paid. Fixed with
--    SELECT ... FOR UPDATE and a post-UPDATE row-count check.
--
-- 4. create-payment-order rejected a fully-discounted (100%) order with
--    "Nothing to charge" instead of completing a legitimately free
--    transaction — see the Edge Function change alongside this file;
--    nothing to do here beyond noting it.
--
-- 5. _promoter_seats_used() had no GRANT/REVOKE at all, defaulting to
--    Postgres' PUBLIC-execute default — callable directly by anon/
--    authenticated to learn a vendor's aggregate live seat usage once
--    they have its id (organizations_select already exposes
--    referred_by_vendor_id to any authenticated user). Every legitimate
--    caller (vendor_my_seat_pool_status, check_promo_code,
--    super_admin_list_vendors, the create-payment-order Edge Function
--    via its service-role key) reaches it as a SECURITY DEFINER owner
--    or via service_role's own default privileges, neither of which
--    this REVOKE affects.
-- ============================================================

-- ── 1. Critical: protect privileged profiles columns ──
CREATE OR REPLACE FUNCTION protect_privileged_profile_columns()
RETURNS TRIGGER AS $$
DECLARE
  v_caller_is_org_admin BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- trusted internal context (e.g. handle_new_user()'s trigger), not a browser session
  END IF;

  IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin
     OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id THEN
    IF NOT is_platform_super_admin() THEN
      NEW.is_super_admin := OLD.is_super_admin;
      NEW.vendor_id := OLD.vendor_id;
    END IF;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    SELECT EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'ceo', 'hr')
    ) INTO v_caller_is_org_admin;
    IF NOT (is_platform_super_admin() OR v_caller_is_org_admin) THEN
      NEW.role := OLD.role;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS protect_privileged_profile_columns_trigger ON profiles;
CREATE TRIGGER protect_privileged_profile_columns_trigger
BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION protect_privileged_profile_columns();

-- ── 2. Remove the dangling single-row commission-paid bypass ──
DROP FUNCTION IF EXISTS super_admin_mark_commission_paid(UUID);

-- ── 3. Close the payout TOCTOU race ──
CREATE OR REPLACE FUNCTION super_admin_process_payout(
  p_vendor_id UUID, p_commission_ids UUID[], p_method TEXT, p_reference TEXT, p_notes TEXT
) RETURNS UUID AS $$
DECLARE
  v_amount NUMERIC;
  v_payout_id UUID;
  v_matched_count INT;
  v_updated_count INT;
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF array_length(p_commission_ids, 1) IS NULL OR array_length(p_commission_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Select at least one commission to pay out';
  END IF;

  -- FOR UPDATE locks these rows for the rest of this transaction, so a
  -- concurrent call touching any of the same commission_ids blocks
  -- until this one commits or rolls back — no more double-validation
  -- of the same pending rows.
  SELECT count(*), COALESCE(sum(amount), 0) INTO v_matched_count, v_amount
  FROM vendor_commissions
  WHERE id = ANY(p_commission_ids) AND vendor_id = p_vendor_id AND status = 'pending'
  FOR UPDATE;

  IF v_matched_count <> array_length(p_commission_ids, 1) THEN
    RAISE EXCEPTION 'One or more selected commissions are no longer pending or do not belong to this vendor';
  END IF;

  INSERT INTO vendor_payouts (vendor_id, amount, method, reference_number, notes, paid_by)
  VALUES (p_vendor_id, v_amount, p_method, p_reference, p_notes, auth.uid())
  RETURNING id INTO v_payout_id;

  UPDATE vendor_commissions
  SET status = 'paid', paid_at = now(), paid_by = auth.uid(), payout_id = v_payout_id
  WHERE id = ANY(p_commission_ids) AND vendor_id = p_vendor_id AND status = 'pending';
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count <> v_matched_count THEN
    RAISE EXCEPTION 'Payout row count mismatch (% locked, % updated) — rolled back', v_matched_count, v_updated_count;
  END IF;

  RETURN v_payout_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION super_admin_process_payout(UUID, UUID[], TEXT, TEXT, TEXT) TO authenticated;

-- ── 5. Lock down the internal seat-usage helper ──
REVOKE ALL ON FUNCTION _promoter_seats_used(UUID, UUID) FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
