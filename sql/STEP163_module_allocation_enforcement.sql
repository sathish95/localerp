-- ============================================================
-- STEP163: Make per-user module allocation enforcing.
--
-- STEP131 added organization_module_allocations as an INFORMATIONAL
-- utilization list ("who on my team actually uses this bundle"). This
-- step lets an org turn it into a real access gate:
--
--   organizations.allocation_enforcement_enabled  (NEW column, default
--   FALSE) — while false, get_effective_modules() ignores allocation
--   entirely (unchanged behaviour). While true, a non-admin, non-
--   enterprise user is denied a bundled module unless they hold an
--   allocation row for its bundle. admin/ceo always bypass (they
--   administer the system — same reason they bypass role visibility).
--
-- Flipping the flag on is only safe once every current user who should
-- keep their modules has an allocation row, so:
--
--   preview_allocation_impact()   — dry run: who loses what right now
--   backfill_module_allocations() — grant every active member a row for
--                                   every active bundle in their org
--   set_allocation_enforcement(true)  — runs the backfill THEN flips the
--                                   flag, so "enable" can never strand a
--                                   user who has access today
--
-- Billing is deliberately NOT changed here: org_bundle_monthly_total()
-- still charges by total seats (STEP124). Moving the charge to allocated
-- headcount is a separate pricing decision, out of scope.
--
-- Enforcement is at the resolver + app-route level (matches STEP124's
-- stated "UI-gated" posture); table-level RLS on the bundled feature
-- tables is a later, larger migration.
-- ============================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS allocation_enforcement_enabled BOOLEAN NOT NULL DEFAULT false;

-- ── Dry run: which (user, bundle) pairs would be denied if enforcement
-- were on right now — active members, active bundles, no allocation row,
-- non-admin. ──
CREATE OR REPLACE FUNCTION preview_allocation_impact()
RETURNS TABLE (user_id UUID, full_name TEXT, role TEXT, bundle_key TEXT, bundle_name TEXT) AS $$
DECLARE v_org UUID := current_org_id();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo')) THEN
    RAISE EXCEPTION 'Only an org admin or CEO can preview allocation impact';
  END IF;
  RETURN QUERY
    SELECT p.id, p.full_name, p.role, obs.bundle_key, bb.name
    FROM profiles p
    CROSS JOIN organization_bundle_subscriptions obs
    JOIN billing_bundles bb ON bb.key = obs.bundle_key
    WHERE p.organization_id = v_org AND p.is_active
      AND obs.organization_id = v_org AND obs.status = 'active'
      AND p.role NOT IN ('admin','ceo')
      AND NOT EXISTS (
        SELECT 1 FROM organization_module_allocations a
        WHERE a.organization_id = v_org AND a.bundle_key = obs.bundle_key AND a.user_id = p.id
      )
    ORDER BY p.full_name, bb.name;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION preview_allocation_impact() TO authenticated;

-- ── Backfill: give every active member an allocation row for every
-- active bundle in the caller's org. Idempotent. Returns rows inserted. ──
CREATE OR REPLACE FUNCTION backfill_module_allocations()
RETURNS INT AS $$
DECLARE v_org UUID := current_org_id(); v_count INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo')) THEN
    RAISE EXCEPTION 'Only an org admin or CEO can backfill allocations';
  END IF;
  WITH ins AS (
    INSERT INTO organization_module_allocations (organization_id, bundle_key, user_id, allocated_by)
    SELECT v_org, obs.bundle_key, p.id, auth.uid()
    FROM organization_bundle_subscriptions obs
    JOIN profiles p ON p.organization_id = v_org AND p.is_active
    WHERE obs.organization_id = v_org AND obs.status = 'active'
    ON CONFLICT (organization_id, bundle_key, user_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION backfill_module_allocations() TO authenticated;

-- ── Convenience for "allocate-on-invite": give one member a row for
-- every currently-active bundle. ──
CREATE OR REPLACE FUNCTION allocate_member_all_bundles(p_user_id UUID)
RETURNS INT AS $$
DECLARE v_org UUID := current_org_id(); v_count INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo')) THEN
    RAISE EXCEPTION 'Only an org admin or CEO can allocate modules';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id AND organization_id = v_org) THEN
    RAISE EXCEPTION 'That user is not in your organization';
  END IF;
  WITH ins AS (
    INSERT INTO organization_module_allocations (organization_id, bundle_key, user_id, allocated_by)
    SELECT v_org, obs.bundle_key, p_user_id, auth.uid()
    FROM organization_bundle_subscriptions obs
    WHERE obs.organization_id = v_org AND obs.status = 'active'
    ON CONFLICT (organization_id, bundle_key, user_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION allocate_member_all_bundles(UUID) TO authenticated;

-- ── The safe switch: backfill first, then flip. Disabling just flips. ──
CREATE OR REPLACE FUNCTION set_allocation_enforcement(p_enabled BOOLEAN)
RETURNS BOOLEAN AS $$
DECLARE v_org UUID := current_org_id();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo')) THEN
    RAISE EXCEPTION 'Only an org admin or CEO can change allocation enforcement';
  END IF;
  IF p_enabled THEN
    PERFORM backfill_module_allocations();
  END IF;
  UPDATE organizations SET allocation_enforcement_enabled = p_enabled WHERE id = v_org;
  RETURN p_enabled;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION set_allocation_enforcement(BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';
