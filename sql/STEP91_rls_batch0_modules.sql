-- ============================================================
-- STEP91: Multi-tenant RLS retrofit — Batch 0 (modules /
-- module_role_visibility).
--
-- These two tables already gained organization_id in STEP89 (Phase 1),
-- but their RLS policies were deliberately left unchanged then — with
-- only one organization in the system at the time, there was nothing to
-- leak between orgs. Now that src/lib/modules.js / SettingsPage.jsx /
-- TabVisibilityContext.jsx (Phase 3 app-layer wiring) query these
-- tables scoped by organization_id client-side, this closes the loop by
-- making that scoping real at the RLS layer too — a second org's admin
-- could otherwise still write org #1's module config by omitting the
-- client-side filter (e.g. via a raw API call).
--
-- is_platform_super_admin() bypass added to both write policies (not
-- present in the original STEP43 policies) — a genuine platform Super
-- Admin should be able to configure any organization's modules for
-- support purposes, same reasoning already applied to app_events'
-- ae_admin policy in STEP90.
-- ============================================================

DROP POLICY IF EXISTS modules_select ON modules;
DROP POLICY IF EXISTS modules_update ON modules;
DROP POLICY IF EXISTS modules_insert ON modules;

CREATE POLICY modules_select ON modules FOR SELECT USING (
  organization_id = current_org_id() OR is_platform_super_admin()
);
CREATE POLICY modules_update ON modules FOR UPDATE USING (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
) WITH CHECK (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
);
CREATE POLICY modules_insert ON modules FOR INSERT WITH CHECK (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
);

DROP POLICY IF EXISTS module_role_visibility_select ON module_role_visibility;
DROP POLICY IF EXISTS module_role_visibility_write  ON module_role_visibility;

CREATE POLICY module_role_visibility_select ON module_role_visibility FOR SELECT USING (
  organization_id = current_org_id() OR is_platform_super_admin()
);
CREATE POLICY module_role_visibility_write ON module_role_visibility FOR ALL USING (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
) WITH CHECK (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
);

NOTIFY pgrst, 'reload schema';
