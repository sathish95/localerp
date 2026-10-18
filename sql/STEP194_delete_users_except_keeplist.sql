-- ============================================================
-- STEP194: Delete every user in the 'thingsalive' organization EXCEPT
-- a keep-list of roles + specific people. Full delete — removes both
-- the `profiles` row and the `auth.users` login row, so a deleted
-- account can no longer sign in at all (this is NOT what the app's own
-- Delete button in User Management does — that only removes `profiles`
-- and leaves the login intact; this is a stronger, less reversible
-- action, done at the user's explicit request).
--
-- KEEP LIST (case-insensitive PREFIX match on full_name or the email's
-- local part, e.g. 'prem' matches 'Prem' / 'prem@gmail.com'):
--   Roles: ceo, hr, finance
--   Names: sathish, tapas, prem, tagore, akash, guru, sai, manjula,
--          maheshwari, mansoor, thippesh, emp
--
-- NOTE on "akasha": the original request listed "akasha", but the only
-- matching seeded account (STEP191) is "Akash" — one letter off. This
-- script matches the prefix "akash", which covers "Akash" (kept, as
-- almost certainly intended) and would equally cover a real "Akasha" if
-- one existed. If "akasha" was actually meant to be a *different*,
-- distinct person, tell me and I'll add them separately — as written,
-- nobody literally named "Akasha" gets protected beyond the "Akash"
-- prefix already covering it.
--
-- ORPHANED DATA WARNING: this app's convention (see CLAUDE.md) is soft
-- UUID references almost everywhere (task assignee, expense requester,
-- timesheet owner, approval actor, etc.) rather than hard foreign keys.
-- That means deleting a profile will NOT usually error out even if that
-- person authored/owns historical records — those records simply keep
-- a now-dangling user id and will show as blank/"Unknown" wherever the
-- app looks up the name (e.g. old expense requests, task history,
-- approval logs). This script does not attempt to clean up or
-- reassign any of that; review the PREVIEW step below and make sure
-- everyone about to be deleted is genuinely disposable (no
-- meaningfully-owned historical data you still need attributed) before
-- running the DELETE step.
--
-- HOW TO RUN — two separate steps, on purpose:
--   1) Run the PREVIEW query first. Read the "action" column for every
--      row and confirm it looks right BEFORE touching the DELETE step.
--   2) Only after reviewing, run the DELETE block. It hard-aborts if the
--      keep-list match for "sathish" comes back empty, as a guard
--      against a bad match wiping every account including your own.
-- ============================================================

-- ── STEP 1: PREVIEW — read this output before running anything else ──
WITH org AS (SELECT id FROM organizations WHERE slug = 'thingsalive')
SELECT
  p.full_name, p.email, p.role,
  CASE WHEN (
    p.role IN ('ceo','hr','finance')
    OR p.full_name ILIKE ANY (ARRAY['sathish%','tapas%','prem%','tagore%','akash%','guru%','sai%','manjula%','maheshwari%','mansoor%','thippesh%','emp%'])
    OR split_part(p.email,'@',1) ILIKE ANY (ARRAY['sathish%','tapas%','prem%','tagore%','akash%','guru%','sai%','manjula%','maheshwari%','mansoor%','thippesh%','emp%'])
  ) THEN 'KEEP' ELSE 'DELETE' END AS action
FROM profiles p, org
WHERE p.organization_id = org.id
ORDER BY action DESC, p.full_name;

-- ── STEP 2: DELETE — run only after reviewing the preview above ──
DO $$
DECLARE
  v_org_id UUID;
  v_keep_count INT;
  v_del_count  INT;
BEGIN
  SELECT id INTO v_org_id FROM organizations WHERE slug = 'thingsalive';
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'organizations row with slug=thingsalive not found';
  END IF;

  -- Safety guard: abort if "sathish" doesn't resolve to at least one
  -- account — a silent typo/rename here could otherwise delete every
  -- single user, including the admin running this script.
  SELECT count(*) INTO v_keep_count FROM profiles
  WHERE organization_id = v_org_id
    AND (full_name ILIKE 'sathish%' OR split_part(email,'@',1) ILIKE 'sathish%');
  IF v_keep_count = 0 THEN
    RAISE EXCEPTION 'Safety abort: no account matched "sathish%%" — refusing to delete anyone. Fix the keep-list match and re-run.';
  END IF;

  SELECT count(*) INTO v_del_count FROM profiles p
  WHERE p.organization_id = v_org_id
    AND NOT (
      p.role IN ('ceo','hr','finance')
      OR p.full_name ILIKE ANY (ARRAY['sathish%','tapas%','prem%','tagore%','akash%','guru%','sai%','manjula%','maheshwari%','mansoor%','thippesh%','emp%'])
      OR split_part(p.email,'@',1) ILIKE ANY (ARRAY['sathish%','tapas%','prem%','tagore%','akash%','guru%','sai%','manjula%','maheshwari%','mansoor%','thippesh%','emp%'])
    );

  -- auth.users deleted first: if profiles.id -> auth.users.id has an
  -- ON DELETE CASCADE FK (the standard Supabase pattern), this alone
  -- already removes the matching profiles rows too. The DELETE FROM
  -- profiles below then just matches 0 of those (already gone) — safe
  -- either way, whether or not that cascade actually exists here.
  DELETE FROM auth.users WHERE id IN (
    SELECT p.id FROM profiles p
    WHERE p.organization_id = v_org_id
      AND NOT (
        p.role IN ('ceo','hr','finance')
        OR p.full_name ILIKE ANY (ARRAY['sathish%','tapas%','prem%','tagore%','akash%','guru%','sai%','manjula%','maheshwari%','mansoor%','thippesh%','emp%'])
        OR split_part(p.email,'@',1) ILIKE ANY (ARRAY['sathish%','tapas%','prem%','tagore%','akash%','guru%','sai%','manjula%','maheshwari%','mansoor%','thippesh%','emp%'])
      )
  );

  DELETE FROM profiles p
  WHERE p.organization_id = v_org_id
    AND NOT (
      p.role IN ('ceo','hr','finance')
      OR p.full_name ILIKE ANY (ARRAY['sathish%','tapas%','prem%','tagore%','akash%','guru%','sai%','manjula%','maheshwari%','mansoor%','thippesh%','emp%'])
      OR split_part(p.email,'@',1) ILIKE ANY (ARRAY['sathish%','tapas%','prem%','tagore%','akash%','guru%','sai%','manjula%','maheshwari%','mansoor%','thippesh%','emp%'])
    );

  RAISE NOTICE '% user(s) deleted (profile + login), % kept', v_del_count, v_keep_count;
END $$;
