-- ============================================================
-- STEP89: Multi-tenant SaaS — Phase 1 foundations.
--
-- Fully additive, non-breaking. No existing RLS policy is touched, no
-- existing column is dropped/tightened beyond what's backfilled in this
-- same script. Ships with ZERO required app-code changes — the running
-- app keeps working exactly as before because there is only one
-- organization's worth of data for any existing (still un-scoped) query
-- to see.
--
-- What this adds:
--   organizations                        — new table (mirrors the
--                                           `roles` table precedent,
--                                           STEP42: enum -> real table)
--   profiles.is_super_admin              — platform-level flag,
--                                           orthogonal to `role` (NOT a
--                                           12th `roles` row — `role` is
--                                           already load-bearing in
--                                           dozens of existing
--                                           `role IN (...)` RLS checks)
--   profiles.organization_id             — nullable. Stays nullable:
--                                           the Postgres trigger on
--                                           auth.users that creates a
--                                           profiles row on signup is
--                                           untracked (predates STEP20,
--                                           set up directly in Supabase)
--                                           and doesn't know about this
--                                           column yet — see
--                                           STEP89a_DIAGNOSTIC first.
--                                           Forcing NOT NULL here would
--                                           break every new signup until
--                                           that trigger is fixed in a
--                                           later phase.
--   modules / module_role_visibility     — gain organization_id,
--                                           composite PK rebuild, so the
--                                           SAME module-enablement
--                                           mechanism already used by
--                                           SettingsPage.jsx's Roles &
--                                           Modules tab becomes
--                                           per-organization instead of
--                                           company-wide. RLS on these
--                                           two tables is DELIBERATELY
--                                           left unchanged in this
--                                           script — org-scoping their
--                                           policies is "Batch 0" of the
--                                           later RLS retrofit phase,
--                                           run once a second real
--                                           organization exists (with
--                                           only one org today there is
--                                           nothing to leak between).
--   current_org_id() / is_platform_super_admin()
--                                         — STABLE SECURITY DEFINER
--                                           helpers, styled identically
--                                           to STEP66's is_hr_admin_ceo()
--                                           / is_manager_of(), so the
--                                           later table-by-table RLS
--                                           retrofit can reference them
--                                           instead of inlining
--                                           `organization_id = (SELECT
--                                           ...)` on every one of this
--                                           app's 116 tables.
--
-- Every other existing table in this app has NO organization_id yet —
-- adding it there, and rewriting those tables' RLS, is a separate,
-- much larger later phase (batched by module, one STEP file per batch),
-- not part of this script.
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ── organizations ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  slug         TEXT        NOT NULL UNIQUE,
  name         TEXT        NOT NULL,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_by   UUID        REFERENCES profiles(id),
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

DROP TRIGGER IF EXISTS organizations_updated_at ON organizations;
CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── profiles: platform flag + org membership ───────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

-- ── seed + backfill ─────────────────────────────────────────
INSERT INTO organizations (slug, name) VALUES ('default-org', 'Default Organization')
  ON CONFLICT (slug) DO NOTHING;

UPDATE profiles SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org')
WHERE organization_id IS NULL;

-- ── organizations RLS (added after profiles.is_super_admin exists,
-- since the write policy below references it) ──────────────
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_select ON organizations;
DROP POLICY IF EXISTS organizations_write  ON organizations;

-- Permissive SELECT for now (every user needs their own org's name for
-- UI chrome) — same posture as `roles`/`modules` today. Write access is
-- platform-level only: an org's own admin/ceo must NOT be able to
-- rename/create/deactivate organizations, including their own.
CREATE POLICY organizations_select ON organizations FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY organizations_write ON organizations FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true)
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;

-- ── modules / module_role_visibility: fold organization_id into
-- their identity so module enablement + role visibility become
-- per-organization. Order matters: the FK from module_role_visibility
-- to modules(key) must be dropped before modules' single-column PK can
-- be replaced with a composite one. ──
ALTER TABLE module_role_visibility DROP CONSTRAINT IF EXISTS module_role_visibility_module_key_fkey;

ALTER TABLE modules ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE modules SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org')
WHERE organization_id IS NULL;
ALTER TABLE modules ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE modules DROP CONSTRAINT IF EXISTS modules_pkey;
ALTER TABLE modules ADD CONSTRAINT modules_pkey PRIMARY KEY (organization_id, key);

ALTER TABLE module_role_visibility ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE module_role_visibility SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org')
WHERE organization_id IS NULL;
ALTER TABLE module_role_visibility ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE module_role_visibility DROP CONSTRAINT IF EXISTS module_role_visibility_pkey;
ALTER TABLE module_role_visibility ADD CONSTRAINT module_role_visibility_pkey
  PRIMARY KEY (organization_id, module_key, role);
ALTER TABLE module_role_visibility DROP CONSTRAINT IF EXISTS module_role_visibility_module_fkey;
ALTER TABLE module_role_visibility ADD CONSTRAINT module_role_visibility_module_fkey
  FOREIGN KEY (organization_id, module_key) REFERENCES modules(organization_id, key) ON DELETE CASCADE;

-- NOTE: RLS policies on modules/module_role_visibility are UNCHANGED by
-- this script (still company-wide auth.uid() IS NOT NULL / role IN
-- ('admin','ceo')) — deliberately deferred, see header comment.

-- ── shared helpers for the later RLS retrofit ──────────────
CREATE OR REPLACE FUNCTION current_org_id() RETURNS UUID AS $$
  SELECT organization_id FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION is_platform_super_admin() RETURNS BOOLEAN AS $$
  SELECT COALESCE((SELECT is_super_admin FROM profiles WHERE id = auth.uid()), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

NOTIFY pgrst, 'reload schema';
