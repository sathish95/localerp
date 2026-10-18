-- ============================================================
-- STEP165: Let an org admin preview ANOTHER user's effective module
-- access (for the web "Mobile App" settings tab). Factors STEP162's
-- resolver into an internal helper so the self RPC and the preview RPC
-- share one implementation.
--
-- Safe scope: get_effective_modules_for() only runs for a target user in
-- the CALLER's own org, and only for an admin/ceo caller — which also
-- means current_org_id() (used by org_has_bundle() and the subqueries
-- below) is the target user's org too, so the resolution is correct.
-- ============================================================

CREATE OR REPLACE FUNCTION _resolve_effective_modules(p_uid UUID, p_platform TEXT)
RETURNS TABLE (
  module_key TEXT, label TEXT, allowed BOOLEAN, reason TEXT, bundle_key TEXT, source TEXT
) AS $$
DECLARE
  v_org     UUID := current_org_id();
  v_role    TEXT;
  v_plan    TEXT;
  v_enforce BOOLEAN;
  v_admin   BOOLEAN;
BEGIN
  IF p_uid IS NULL OR v_org IS NULL THEN RETURN; END IF;
  SELECT p.role INTO v_role FROM profiles p WHERE p.id = p_uid;
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
          WHERE a.organization_id = v_org AND a.bundle_key = module_bundle_key(m.key) AND a.user_id = p_uid
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

-- Public self RPC now delegates (behaviour unchanged from STEP162).
CREATE OR REPLACE FUNCTION get_effective_modules(p_platform TEXT DEFAULT 'web')
RETURNS TABLE (
  module_key TEXT, label TEXT, allowed BOOLEAN, reason TEXT, bundle_key TEXT, source TEXT
) AS $$
  SELECT * FROM _resolve_effective_modules(auth.uid(), p_platform)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION get_effective_modules(TEXT) TO authenticated;

-- Preview another user in the caller's org (admin/ceo only).
CREATE OR REPLACE FUNCTION get_effective_modules_for(p_user_id UUID, p_platform TEXT DEFAULT 'web')
RETURNS TABLE (
  module_key TEXT, label TEXT, allowed BOOLEAN, reason TEXT, bundle_key TEXT, source TEXT
) AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo')) THEN
    RAISE EXCEPTION 'Only an org admin or CEO can preview another user''s access';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id AND organization_id = current_org_id()) THEN
    RAISE EXCEPTION 'That user is not in your organization';
  END IF;
  RETURN QUERY SELECT * FROM _resolve_effective_modules(p_user_id, p_platform);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION get_effective_modules_for(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
