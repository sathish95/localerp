-- ============================================================
-- STEP105: Phase 4 — real signup flow (create a new org vs join an
-- existing one via invite code) + Super Admin platform RPCs.
--
-- Until now every signup landed on 'default-org' (STOPGAP DESIGN, per
-- STEP95's header) because there was no way for a user to create or join
-- a specific organization. This closes that gap:
--
--   1. organization_invites — short-code invites an org's admin/ceo
--      generates from the new Settings -> Organization tab. Consumed
--      once (or up to max_uses times) by handle_new_user() at signup.
--   2. handle_new_user() rewritten to branch on raw_user_meta_data:
--      - org_mode='create' + org_name  -> creates a brand-new
--        organizations row, makes this user its 'admin' (overriding
--        whatever role was picked in the UI — the org's first user is
--        always its admin).
--      - org_mode='join' + invite_code -> resolves organization_id +
--        role from a valid organization_invites row, increments its
--        use_count.
--      - neither present (old links, direct API signups) -> unchanged
--        fallback to 'default-org', preserving today's behavior exactly.
--   3. preview_invite_code(p_code) — anon-callable SECURITY DEFINER RPC
--      so the signup form can show "You're joining Acme Corp" (or a
--      clear error) BEFORE calling auth.signUp(), rather than only
--      finding out after an auth.users row already exists. This is a
--      UX check, not the security boundary — handle_new_user() is the
--      real enforcement and re-validates independently.
--   4. Super Admin platform RPCs — organizations_write (STEP89) already
--      lets a super admin INSERT/UPDATE the organizations table directly
--      via RLS, so no RPC is needed for create/suspend. What RLS
--      genuinely can't give a super admin is cross-org visibility into
--      profiles (organization_id = current_org_id() only covers their
--      own org) — so super_admin_list_organizations() is a SECURITY
--      DEFINER read that aggregates member/module counts per org,
--      gated on is_platform_super_admin() internally.
-- ============================================================

-- ── organization_invites ────────────────────────────────────
CREATE TABLE IF NOT EXISTS organization_invites (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code            TEXT        NOT NULL UNIQUE DEFAULT upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 8)),
  role            TEXT        NOT NULL DEFAULT 'employee',
  max_uses        INT,                              -- null = unlimited
  use_count       INT         NOT NULL DEFAULT 0,
  expires_at      TIMESTAMPTZ,                       -- null = never expires
  revoked         BOOLEAN     NOT NULL DEFAULT false,
  created_by      UUID        REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organization_invites_org_idx  ON organization_invites(organization_id);
CREATE INDEX IF NOT EXISTS organization_invites_code_idx ON organization_invites(code);

ALTER TABLE organization_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_invites_select ON organization_invites;
DROP POLICY IF EXISTS organization_invites_write  ON organization_invites;
-- Readable by the issuing org's admin/ceo, or any platform super admin
-- (cross-org support/ops visibility) — never by anon or other roles.
CREATE POLICY organization_invites_select ON organization_invites FOR SELECT USING (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
);
CREATE POLICY organization_invites_write ON organization_invites FOR ALL USING (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
) WITH CHECK (
  is_platform_super_admin() OR (
    organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
  )
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_invites TO authenticated;

-- ── preview_invite_code() — anon-callable, read-only, no PII beyond the org name ──
CREATE OR REPLACE FUNCTION preview_invite_code(p_code TEXT)
RETURNS TABLE (valid BOOLEAN, org_name TEXT, role TEXT, reason TEXT) AS $$
DECLARE
  v_inv organization_invites%ROWTYPE;
  v_org_name TEXT;
BEGIN
  SELECT * INTO v_inv FROM organization_invites WHERE code = upper(trim(p_code));
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::TEXT, NULL::TEXT, 'Invite code not found';
    RETURN;
  END IF;
  IF v_inv.revoked THEN
    RETURN QUERY SELECT false, NULL::TEXT, NULL::TEXT, 'This invite has been revoked';
    RETURN;
  END IF;
  IF v_inv.expires_at IS NOT NULL AND v_inv.expires_at < now() THEN
    RETURN QUERY SELECT false, NULL::TEXT, NULL::TEXT, 'This invite has expired';
    RETURN;
  END IF;
  IF v_inv.max_uses IS NOT NULL AND v_inv.use_count >= v_inv.max_uses THEN
    RETURN QUERY SELECT false, NULL::TEXT, NULL::TEXT, 'This invite has already been used';
    RETURN;
  END IF;
  SELECT name INTO v_org_name FROM organizations WHERE id = v_inv.organization_id AND is_active = true;
  IF v_org_name IS NULL THEN
    RETURN QUERY SELECT false, NULL::TEXT, NULL::TEXT, 'This organization is not available';
    RETURN;
  END IF;
  RETURN QUERY SELECT true, v_org_name, v_inv.role, NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION preview_invite_code(TEXT) TO anon, authenticated;

-- ── handle_new_user() — adds org_mode branching on top of STEP95's version ──
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_role      TEXT := 'employee';
  v_name      TEXT;
  v_org_id    UUID;
  v_org_mode  TEXT;
  v_org_name  TEXT;
  v_slug      TEXT;
  v_inv       organization_invites%ROWTYPE;
BEGIN
  -- Resolve role — plain TEXT, FK-validated on insert below
  -- profiles.role is plain TEXT with an FK to roles(role_key) (STEP42
  -- converted it off the old user_role enum) — no cast needed, and a bad
  -- value is caught by that FK on the INSERT below (same outer safety net
  -- as any other failure), not by an enum-cast exception here. Casting to
  -- ::user_role (as STEP95's version — copied from the live pasted
  -- source — still did) only ever worked by accident: the enum type
  -- object is left in place unused per STEP42's own header, so a cast
  -- only succeeds for its small original member set (admin/ceo/manager/
  -- finance/hr/employee) and would hard-fail for any dynamic role added
  -- since (sales_rep, cmo, campaign_manager, etc.) — exactly the roles
  -- this invite flow needs to assign.
  v_role := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'role'), ''), 'employee');

  -- Safely get name — never NULL
  v_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(split_part(NEW.email, '@', 1)), ''),
    'User'
  );

  v_org_mode := NEW.raw_user_meta_data->>'org_mode';

  IF v_org_mode = 'create' AND NULLIF(TRIM(NEW.raw_user_meta_data->>'org_name'), '') IS NOT NULL THEN
    v_org_name := TRIM(NEW.raw_user_meta_data->>'org_name');
    v_slug := lower(regexp_replace(v_org_name, '[^a-zA-Z0-9]+', '-', 'g'));
    v_slug := trim(both '-' from v_slug);
    IF v_slug = '' THEN v_slug := 'org'; END IF;
    -- Guarantee uniqueness without erroring on collision — append a short suffix.
    IF EXISTS (SELECT 1 FROM organizations WHERE slug = v_slug) THEN
      v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text,'-',''), 1, 6);
    END IF;
    -- created_by is deliberately left NULL here, not NEW.id — organizations.created_by
    -- REFERENCES profiles(id) (STEP89), and no profiles row for NEW.id exists yet at
    -- this point in the function (that INSERT happens below, after this branch). Setting
    -- it to NEW.id here trips the FK, which this function's own EXCEPTION WHEN OTHERS
    -- silently swallows — rolling back the org insert too (implicit savepoint) and
    -- leaving the user with NO profile at all. Backfilled via UPDATE further down, once
    -- the profiles row actually exists.
    INSERT INTO organizations (slug, name) VALUES (v_slug, v_org_name)
    RETURNING id INTO v_org_id;
    v_role := 'admin';  -- the org's creator is always its admin, regardless of any role picked in the UI

  ELSIF v_org_mode = 'join' AND NULLIF(TRIM(NEW.raw_user_meta_data->>'invite_code'), '') IS NOT NULL THEN
    SELECT * INTO v_inv FROM organization_invites
      WHERE code = upper(trim(NEW.raw_user_meta_data->>'invite_code'))
        AND revoked = false
        AND (expires_at IS NULL OR expires_at > now())
        AND (max_uses IS NULL OR use_count < max_uses);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid or expired invite code';
    END IF;
    v_org_id := v_inv.organization_id;
    v_role := v_inv.role;
    UPDATE organization_invites SET use_count = use_count + 1 WHERE id = v_inv.id;

  ELSE
    -- Unchanged fallback (STEP95) — old links / direct API signups with no org_mode.
    SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'default-org';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, is_active, organization_id)
  VALUES (NEW.id, NEW.email, v_name, v_role, TRUE, v_org_id)
  ON CONFLICT (id) DO UPDATE
    SET
      email            = EXCLUDED.email,
      full_name        = CASE WHEN EXCLUDED.full_name <> 'User' THEN EXCLUDED.full_name ELSE profiles.full_name END,
      role             = EXCLUDED.role,
      organization_id  = COALESCE(profiles.organization_id, EXCLUDED.organization_id);

  -- Now that this profiles row exists, it's safe to point the new org's
  -- created_by at it without tripping the FK (see comment above).
  IF v_org_mode = 'create' AND v_org_id IS NOT NULL THEN
    UPDATE organizations SET created_by = NEW.id WHERE id = v_org_id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let trigger crash — log and continue (STEP95's convention).
  -- A raised 'Invalid or expired invite code' lands here too: the
  -- auth.users row still gets created but no profiles row does, which
  -- AuthContext's existing retry-then-fallback loop already handles
  -- (falls back to a bare profile with organization_id left null,
  -- treated as "show everything" by TabVisibilityContext until an
  -- admin/super admin sorts it out) — same safety net as any other
  -- signup failure mode today, not a new edge case.
  RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── Super Admin: cross-org read (RLS can't give a super admin visibility
-- into other orgs' profiles — current_org_id() only ever resolves their
-- own) ──
CREATE OR REPLACE FUNCTION super_admin_list_organizations()
RETURNS TABLE (
  id UUID, slug TEXT, name TEXT, is_active BOOLEAN, created_at TIMESTAMPTZ,
  member_count BIGINT, enabled_module_count BIGINT
) AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT o.id, o.slug, o.name, o.is_active, o.created_at,
      (SELECT count(*) FROM profiles p WHERE p.organization_id = o.id),
      (SELECT count(*) FROM modules m WHERE m.organization_id = o.id AND m.enabled = true)
    FROM organizations o
    ORDER BY o.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION super_admin_list_organizations() TO authenticated;

NOTIFY pgrst, 'reload schema';
