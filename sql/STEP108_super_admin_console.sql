-- ============================================================
-- STEP108: Super Admin console expansion — Phase 6 of the multi-tenant
-- SaaS conversion. Closes the two remaining gaps noted after Phase 5
-- (billing, STEP107): cross-org member management, usage/audit
-- visibility beyond member/module counts, and org deletion.
--
-- Org deletion is a SOFT delete (organizations.deleted_at) by explicit
-- decision, not a hard cascading DELETE: most of this app's ~116
-- org-scoped tables use a plain UUID organization_id with no real FK
-- (this repo's documented "soft FK" convention, CLAUDE.md), so a real
-- DROP would either fail on the handful of tables that DO have a FK, or
-- silently orphan rows in the many that don't. Soft delete is safe,
-- reversible (super_admin_restore_organization), and keeps data intact
-- for any later audit/legal need. A true hard purge is a distinct,
-- separately-audited task if ever needed — not assumed here.
--
-- Discovered while building this: organizations.is_active ("Suspend" in
-- the console) has never actually been enforced anywhere — no RLS policy
-- and no app-layer check reads it, so today's "Suspend" button is
-- cosmetic. Since deletion is a strictly stronger form of the same
-- state, and a "Delete" that doesn't actually block access would be
-- exactly as broken, this migration exposes deleted_at (and is_active,
-- unchanged) on the profile.org join so the app layer can gate on both
-- in one place (App.jsx) rather than touching the dozens of individual
-- per-table RLS policies STEP89's own header explicitly deferred as a
-- separate, much larger phase.
-- ============================================================

-- ── organizations: soft-delete flag ────────────────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- organizations_select/organizations_write (STEP89) already cover this
-- new column — no policy change needed. Deliberately NOT filtering
-- deleted orgs out of organizations_select: the suspended/deleted user's
-- own lockout screen (App.jsx) still needs to read their own org's name
-- and status to explain why they're locked out.

-- ── super_admin_list_members() — cross-org member roster. RLS on
-- profiles scopes a normal query to the caller's own org
-- (organization_id = current_org_id()); a super admin needs to see any
-- org's members, same cross-org-visibility gap STEP105/107 already
-- solved this way for orgs/billing. ──
CREATE OR REPLACE FUNCTION super_admin_list_members(p_org_id UUID)
RETURNS TABLE (
  id UUID, email TEXT, full_name TEXT, role TEXT, is_active BOOLEAN,
  created_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ
) AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT p.id, p.email, p.full_name, p.role, p.is_active, p.created_at,
      (SELECT max(ae.created_at) FROM app_events ae WHERE ae.user_id = p.id)
    FROM profiles p
    WHERE p.organization_id = p_org_id
    ORDER BY p.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION super_admin_list_members(UUID) TO authenticated;

-- ── super_admin_set_member_role() — roles is a global (not org-scoped)
-- catalog, STEP42, so any role_key is valid for any org. ──
CREATE OR REPLACE FUNCTION super_admin_set_member_role(p_member_id UUID, p_role TEXT)
RETURNS VOID AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM roles WHERE role_key = p_role) THEN
    RAISE EXCEPTION 'Unknown role';
  END IF;
  UPDATE profiles SET role = p_role WHERE id = p_member_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION super_admin_set_member_role(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION super_admin_set_member_active(p_member_id UUID, p_is_active BOOLEAN)
RETURNS VOID AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE profiles SET is_active = p_is_active WHERE id = p_member_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION super_admin_set_member_active(UUID, BOOLEAN) TO authenticated;

-- ── super_admin_org_activity() — usage visibility beyond the member/
-- module counts super_admin_list_organizations() already gives. Built
-- from app_events (STEP23, org-scoped since STEP90) — the same table
-- AppMonitorPage already aggregates for a single org's own admin/ceo. ──
CREATE OR REPLACE FUNCTION super_admin_org_activity(p_org_id UUID)
RETURNS TABLE (events_30d BIGINT, active_users_30d BIGINT, last_event_at TIMESTAMPTZ) AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT count(*), count(DISTINCT user_id), max(created_at)
    FROM app_events
    WHERE organization_id = p_org_id AND created_at > now() - interval '30 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION super_admin_org_activity(UUID) TO authenticated;

-- ── super_admin_delete_organization() / super_admin_restore_organization()
-- — soft delete + reversal. Deleting also revokes every outstanding
-- invite for that org so no new signup can land there while it's gone. ──
CREATE OR REPLACE FUNCTION super_admin_delete_organization(p_org_id UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE organizations SET is_active = false, deleted_at = now() WHERE id = p_org_id;
  UPDATE organization_invites SET revoked = true WHERE organization_id = p_org_id AND revoked = false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION super_admin_delete_organization(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION super_admin_restore_organization(p_org_id UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  -- Deliberately leaves is_active = false — restoring un-deletes the org
  -- (its data/console visibility comes back) but reactivating login
  -- access is still a separate, deliberate "Reactivate" click.
  UPDATE organizations SET deleted_at = NULL WHERE id = p_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION super_admin_restore_organization(UUID) TO authenticated;

-- ── super_admin_list_organizations() — add deleted_at. DROP first:
-- CREATE OR REPLACE cannot change a function's OUT-parameter row type,
-- only its body (hit this in STEP107 too). ──
DROP FUNCTION IF EXISTS super_admin_list_organizations();
CREATE OR REPLACE FUNCTION super_admin_list_organizations()
RETURNS TABLE (
  id UUID, slug TEXT, name TEXT, is_active BOOLEAN, created_at TIMESTAMPTZ,
  member_count BIGINT, enabled_module_count BIGINT,
  plan_key TEXT, billing_status TEXT, trial_ends_at TIMESTAMPTZ, seat_limit INT,
  deleted_at TIMESTAMPTZ
) AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT o.id, o.slug, o.name, o.is_active, o.created_at,
      (SELECT count(*) FROM profiles p WHERE p.organization_id = o.id),
      (SELECT count(*) FROM modules m WHERE m.organization_id = o.id AND m.enabled = true),
      o.plan_key, o.billing_status, o.trial_ends_at, org_seat_limit(o.id),
      o.deleted_at
    FROM organizations o
    ORDER BY o.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION super_admin_list_organizations() TO authenticated;

NOTIFY pgrst, 'reload schema';
