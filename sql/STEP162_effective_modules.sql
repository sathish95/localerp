-- ============================================================
-- STEP162: The one module-access resolver, shared by every client.
--
-- get_effective_modules(p_platform) returns, for the calling user, one
-- row per module in their org's `modules` table with a boolean `allowed`
-- and, when not allowed, the first failing gate as `reason`:
--
--   purchased      org has the module's billing bundle active, or is on
--                  the enterprise plan  (foundational modules skip this)
--   org_disabled   modules.enabled kill switch is off
--   role_hidden    module_role_visibility says hidden for this role
--                  (admin/ceo bypass, exactly like web isTabVisible())
--   not_allocated  org.allocation_enforcement_enabled is ON and this
--                  user has no organization_module_allocations row for
--                  the module's bundle  (admin/ceo + enterprise bypass)
--   not_on_mobile  p_platform<>'web' and the module has no mobile screen,
--                  or the org disabled it in mobile_module_config, or the
--                  caller is below its min_role floor
--
-- p_platform = 'web' skips only the not_on_mobile gate — every other gate
-- applies identically, so the web app can adopt this same RPC later
-- without behaviour drift.
--
-- me_bootstrap(p_platform) bundles profile + org + effective modules +
-- unread count into one call for a mobile cold start.
-- ============================================================

-- The resolver reads organizations.allocation_enforcement_enabled, which
-- STEP163 owns. Added here too (IF NOT EXISTS) so this file runs whether
-- or not STEP163 has been applied yet — either way the column ends up
-- with the same definition.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS allocation_enforcement_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION get_effective_modules(p_platform TEXT DEFAULT 'web')
RETURNS TABLE (
  module_key TEXT, label TEXT, allowed BOOLEAN, reason TEXT, bundle_key TEXT, source TEXT
) AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_org     UUID := current_org_id();
  v_role    TEXT;
  v_plan    TEXT;
  v_enforce BOOLEAN;
  v_admin   BOOLEAN;
BEGIN
  IF v_uid IS NULL OR v_org IS NULL THEN RETURN; END IF;
  SELECT p.role INTO v_role FROM profiles p WHERE p.id = v_uid;
  IF v_role IS NULL THEN RETURN; END IF;
  v_admin := v_role IN ('admin','ceo');
  SELECT o.plan_key, COALESCE(o.allocation_enforcement_enabled, false)
    INTO v_plan, v_enforce
    FROM organizations o WHERE o.id = v_org;

  RETURN QUERY
  WITH calc AS (
    SELECT
      m.key, m.label, m.enabled,
      module_bundle_key(m.key) AS bkey,
      (module_bundle_key(m.key) IS NULL
        OR v_plan = 'enterprise'
        OR org_has_bundle(module_bundle_key(m.key))) AS purchased,
      (v_admin OR NOT EXISTS (
        SELECT 1 FROM module_role_visibility v
        WHERE v.organization_id = v_org AND v.module_key = m.key AND v.role = v_role AND v.visible = false
      )) AS role_visible,
      (module_bundle_key(m.key) IS NULL
        OR NOT v_enforce
        OR v_admin
        OR v_plan = 'enterprise'
        OR EXISTS (
          SELECT 1 FROM organization_module_allocations a
          WHERE a.organization_id = v_org AND a.bundle_key = module_bundle_key(m.key) AND a.user_id = v_uid
        )) AS allocated,
      (p_platform = 'web' OR (
        m.key = ANY (mobile_module_capable_keys())
        AND COALESCE((SELECT c.is_enabled FROM mobile_module_config c
                      WHERE c.organization_id = v_org AND c.module_key = m.key), true)
        AND mobile_role_rank(v_role) >= mobile_role_rank(
              COALESCE((SELECT c.min_role FROM mobile_module_config c
                        WHERE c.organization_id = v_org AND c.module_key = m.key), 'employee'))
      )) AS mobile_ok
    FROM modules m
    WHERE m.organization_id = v_org
  )
  SELECT
    c.key, c.label,
    (c.purchased AND c.enabled AND c.role_visible AND c.allocated AND c.mobile_ok),
    CASE
      WHEN NOT c.purchased    THEN 'not_purchased'
      WHEN NOT c.enabled      THEN 'org_disabled'
      WHEN NOT c.role_visible THEN 'role_hidden'
      WHEN NOT c.allocated    THEN 'not_allocated'
      WHEN NOT c.mobile_ok    THEN 'not_on_mobile'
      ELSE 'ok'
    END,
    c.bkey,
    COALESCE((SELECT bb.name FROM billing_bundles bb WHERE bb.key = c.bkey), 'Foundational')
  FROM calc c
  ORDER BY c.label;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION get_effective_modules(TEXT) TO authenticated;

-- ── me_bootstrap() — one round trip for the mobile app on launch ──
CREATE OR REPLACE FUNCTION me_bootstrap(p_platform TEXT DEFAULT 'web')
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_org UUID := current_org_id();
  v_res JSONB;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'profile', (
      SELECT jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'email', p.email, 'role', p.role,
        'is_active', p.is_active, 'is_super_admin', p.is_super_admin,
        'organization_id', p.organization_id, 'department_id', p.department_id
      ) FROM profiles p WHERE p.id = v_uid
    ),
    'organization', (
      SELECT jsonb_build_object(
        'id', o.id, 'name', o.name, 'slug', o.slug, 'plan_key', o.plan_key,
        'billing_status', o.billing_status, 'is_active', o.is_active, 'deleted_at', o.deleted_at,
        'allocation_enforcement_enabled', COALESCE(o.allocation_enforcement_enabled, false)
      ) FROM organizations o WHERE o.id = v_org
    ),
    'modules', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'key', module_key, 'label', label, 'allowed', allowed, 'reason', reason,
        'bundle_key', bundle_key, 'source', source
      ) ORDER BY label), '[]'::jsonb)
      FROM get_effective_modules(p_platform)
    ),
    'unread_notifications', (
      SELECT count(*) FROM notifications WHERE recipient_id = v_uid AND read_at IS NULL
    )
  ) INTO v_res;

  RETURN v_res;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION me_bootstrap(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
