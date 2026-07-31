-- ============================================================
-- STEP95: Wire organization_id into the signup trigger.
--
-- Rewrites handle_new_user() (confirmed via STEP89a's diagnostic output
-- — the pasted function source matched Supabase's standard
-- "handle_new_user" trigger pattern verbatim: safe role cast with an
-- invalid_text_representation fallback, name fallback chain, ON
-- CONFLICT DO UPDATE, outer EXCEPTION WHEN OTHERS so the trigger can
-- never fail auth.users' own insert). Preserves every existing behavior
-- unchanged; only addition is organization_id.
--
-- STOPGAP DESIGN: every new signup is assigned to the Default
-- Organization (same one every existing user already belongs to,
-- STEP89) — there is no create-org/join-org signup flow yet (that's
-- Phase 4, not built). This exactly preserves today's single-org
-- behavior; it just also correctly populates organization_id going
-- forward instead of leaving it NULL (which previously left
-- TabVisibilityContext falling back to its "show everything" default
-- for brand-new signups — not wrong, just not real org membership).
-- Revisit once Phase 4's real signup flow exists.
--
-- ON CONFLICT: organization_id only gets set if the existing row didn't
-- already have one — an existing profile's org membership (e.g. one a
-- Super Admin manually moved to a different org later) is never
-- silently reset if this trigger re-fires for any reason.
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_role    user_role := 'employee';
  v_name    TEXT;
  v_org_id  UUID;
BEGIN
  -- Safely cast role — fall back to employee if invalid/missing
  BEGIN
    v_role := COALESCE(
      (NEW.raw_user_meta_data->>'role')::user_role,
      'employee'::user_role
    );
  EXCEPTION WHEN invalid_text_representation THEN
    v_role := 'employee'::user_role;
  END;

  -- Safely get name — never NULL
  v_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(split_part(NEW.email, '@', 1)), ''),
    'User'
  );

  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'default-org';

  INSERT INTO public.profiles (id, email, full_name, role, is_active, organization_id)
  VALUES (NEW.id, NEW.email, v_name, v_role, TRUE, v_org_id)
  ON CONFLICT (id) DO UPDATE
    SET
      email            = EXCLUDED.email,
      full_name        = CASE WHEN EXCLUDED.full_name <> 'User' THEN EXCLUDED.full_name ELSE profiles.full_name END,
      role             = EXCLUDED.role,
      organization_id  = COALESCE(profiles.organization_id, EXCLUDED.organization_id);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let trigger crash — log and continue
  RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── Verification — run this and check the result ──
-- A row back confirms the trigger on auth.users really does call this
-- exact function, so the fix above is live. If this returns NO rows,
-- the real function has a different name than 'handle_new_user' and the
-- CREATE OR REPLACE above created a harmless, unused function instead —
-- paste back the trigger_name/function_name columns from STEP89a's
-- first query so this can be retargeted at the real name.
SELECT t.tgname AS trigger_name, p.proname AS function_name
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace cn ON cn.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE cn.nspname = 'auth' AND c.relname = 'users' AND NOT t.tgisinternal AND p.proname = 'handle_new_user';
