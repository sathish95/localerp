-- ============================================================
-- STEP184: Industry-Adaptive Platform Phase 6 — Organization
-- Operations: Locations, Teams, Shifts, plus a small additive
-- extension to the existing Skill Management (STEP29) for
-- certification name/expiry tracking.
--
-- Departments already exist (departments table, STEP-era pre-179,
-- DepartmentsTab in SettingsPage.jsx) — not touched here.
-- Skills already exist (skills/employee_skills, STEP29,
-- SkillMatrixPage.jsx) — extended, not duplicated.
-- No existing "team" or "shift" entity was found anywhere in the
-- repo (grepped src/, mobile/src/, sql/ — the only "shift" hit was
-- STEP180's seeded operating_models label, not a data model).
--
-- RLS follows the exact "open" pattern departments/assets/etc. use
-- (STEP96_rls_batch_uniform_open.sql: FOR ALL TO authenticated USING
-- (organization_id = current_org_id())) — role gating for these Settings
-- tabs is done client-side, matching every sibling entity they're
-- modeled after, not a stricter admin-only policy invented for this
-- phase alone.
-- ============================================================

-- ── 1. LOCATIONS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS locations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          UUID NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  name                     TEXT NOT NULL,
  code                     TEXT,
  location_type            TEXT NOT NULL DEFAULT 'other' CHECK (location_type IN (
                             'office','branch','site','plant','store','warehouse',
                             'hospital','farm','customer_location','other'
                           )),
  address                  TEXT,
  latitude                 NUMERIC(10,6),
  longitude                NUMERIC(10,6),
  timezone                 TEXT,
  manager_id               UUID,   -- soft ref -> profiles(id)
  geofence_radius_meters   NUMERIC(8,2),
  status                   TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at               TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS locations_org_idx ON locations(organization_id);

-- ── 2. TEAMS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  department_id   UUID,   -- soft ref -> departments(id), nullable (a team may not sit under a department)
  name            TEXT NOT NULL,
  lead_id         UUID,   -- soft ref -> profiles(id)
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS teams_org_idx ON teams(organization_id);

CREATE TABLE IF NOT EXISTS team_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    UUID NOT NULL,   -- soft ref -> teams(id)
  person_id  UUID NOT NULL,   -- soft ref -> profiles(id)
  role       TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (team_id, person_id)
);
CREATE INDEX IF NOT EXISTS team_members_team_idx ON team_members(team_id);

-- ── 3. SHIFTS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shift_patterns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  name            TEXT NOT NULL,
  pattern_type    TEXT NOT NULL DEFAULT 'fixed' CHECK (pattern_type IN ('fixed','flexible','rotational','night','split')),
  start_time      TIME,
  end_time        TIME,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shift_patterns_org_idx ON shift_patterns(organization_id);

CREATE TABLE IF NOT EXISTS person_shift_assignments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  person_id        UUID NOT NULL,   -- soft ref -> profiles(id)
  shift_pattern_id UUID NOT NULL,   -- soft ref -> shift_patterns(id)
  effective_from   DATE NOT NULL,
  effective_to     DATE,            -- null = ongoing
  created_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS person_shift_assignments_person_idx ON person_shift_assignments(person_id);
CREATE INDEX IF NOT EXISTS person_shift_assignments_org_idx    ON person_shift_assignments(organization_id);

-- ── 4. SKILLS — additive certification tracking (extends STEP29) ──
-- STEP29's employee_skills already has a `certified` boolean; the
-- master prompt additionally asks for certification name + expiry.
-- Adding, not replacing.
ALTER TABLE employee_skills ADD COLUMN IF NOT EXISTS certification_name TEXT;
ALTER TABLE employee_skills ADD COLUMN IF NOT EXISTS certification_expiry DATE;

-- ── 5. RLS — "open" pattern, matching departments/assets/etc. ──
ALTER TABLE locations                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members               ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_patterns             ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_shift_assignments   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS locations_open ON locations;
CREATE POLICY locations_open ON locations FOR ALL TO authenticated
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

DROP POLICY IF EXISTS teams_open ON teams;
CREATE POLICY teams_open ON teams FOR ALL TO authenticated
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

-- team_members: scoped via its parent teams row (no organization_id of its own).
DROP POLICY IF EXISTS team_members_open ON team_members;
CREATE POLICY team_members_open ON team_members FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM teams t WHERE t.id = team_id AND t.organization_id = current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM teams t WHERE t.id = team_id AND t.organization_id = current_org_id()));

DROP POLICY IF EXISTS shift_patterns_open ON shift_patterns;
CREATE POLICY shift_patterns_open ON shift_patterns FOR ALL TO authenticated
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

DROP POLICY IF EXISTS person_shift_assignments_open ON person_shift_assignments;
CREATE POLICY person_shift_assignments_open ON person_shift_assignments FOR ALL TO authenticated
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.locations                to authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams                    to authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members             to authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_patterns           to authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.person_shift_assignments to authenticated;

NOTIFY pgrst, 'reload schema';
