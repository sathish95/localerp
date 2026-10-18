-- STEP187: Industry-Adaptive Platform — fix-up for Phase 6.
--
-- Five soft-ref columns from STEP183 (teams.lead_id, team_members.team_id,
-- team_members.person_id, person_shift_assignments.person_id,
-- person_shift_assignments.shift_pattern_id)
-- were declared as plain UUID with no REFERENCES, per this repo's normal
-- soft-FK convention for tables that "may not exist yet." But their
-- application code (src/lib/teams.js, src/lib/shifts.js) queries them
-- using PostgREST's embedded-resource syntax
-- (`profiles!person_id(...)`), which requires PostgREST to be able to
-- infer the relationship from an ACTUAL foreign key constraint — it
-- cannot embed through a soft ref. Result: PGRST200 "Could not find a
-- relationship" at runtime.
--
-- profiles, teams, and shift_patterns are all foundational/always-exist
-- tables (teams and shift_patterns exist because STEP183 itself creates
-- them in this same migration sequence) — exactly the case where this
-- repo's own convention already uses a REAL FK instead of a soft one
-- (see task_contributors.person_id UUID NOT NULL REFERENCES profiles(id)
-- in STEP182). This migration corrects all five columns to match that
-- precedent. Every table involved is new (from this same build) and
-- holds no orphaned data, so adding the constraint is a safe, instant,
-- additive fix — no backfill or cleanup needed.
--
-- Idempotent: each ADD CONSTRAINT is guarded so re-running this file is
-- safe even if it partially applied before.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teams_lead_id_fkey'
  ) THEN
    ALTER TABLE teams ADD CONSTRAINT teams_lead_id_fkey
      FOREIGN KEY (lead_id) REFERENCES profiles(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'team_members_person_id_fkey'
  ) THEN
    ALTER TABLE team_members ADD CONSTRAINT team_members_person_id_fkey
      FOREIGN KEY (person_id) REFERENCES profiles(id);
  END IF;

  -- Needed for teams.js's nested `members:team_members(...)` embed (the
  -- reverse direction, teams-has-many-team_members) to resolve via
  -- PostgREST — same requirement as the forward direction above.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'team_members_team_id_fkey'
  ) THEN
    ALTER TABLE team_members ADD CONSTRAINT team_members_team_id_fkey
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'psa_person_id_fkey'
  ) THEN
    ALTER TABLE person_shift_assignments ADD CONSTRAINT psa_person_id_fkey
      FOREIGN KEY (person_id) REFERENCES profiles(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'psa_shift_pattern_id_fkey'
  ) THEN
    ALTER TABLE person_shift_assignments ADD CONSTRAINT psa_shift_pattern_id_fkey
      FOREIGN KEY (shift_pattern_id) REFERENCES shift_patterns(id);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
