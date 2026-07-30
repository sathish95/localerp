-- ============================================================
-- STEP29: Resource Allocation & Skill Management (Phase 1)
-- profiles reporting-line fields, Skill Matrix, Resource Allocations
-- Run in Supabase SQL editor after STEP28.
-- No enum pre-step needed: employment_type / proficiency_level / status
-- are plain TEXT+CHECK, not user_role enum values.
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ── 1. PROFILES: reporting line & capacity fields ────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS reporting_manager_id UUID REFERENCES profiles(id);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS employment_type TEXT
  CHECK (employment_type IN ('FTE','Contractor','Intern'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS default_weekly_capacity_hours NUMERIC(5,2) DEFAULT 40;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS date_joined DATE;
CREATE INDEX IF NOT EXISTS profiles_reporting_manager_idx ON profiles(reporting_manager_id);

-- ── 2. SKILLS (global catalog) ────────────────────────────────
CREATE TABLE IF NOT EXISTS skills (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  skill_name  TEXT        NOT NULL UNIQUE,
  category    TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS skills_category_idx ON skills(category);

-- ── 3. EMPLOYEE_SKILLS (claims + endorsements) ────────────────
CREATE TABLE IF NOT EXISTS employee_skills (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id       UUID        NOT NULL REFERENCES profiles(id),
  skill_id          UUID        NOT NULL REFERENCES skills(id),
  proficiency_level TEXT        NOT NULL CHECK (proficiency_level IN ('Beginner','Intermediate','Expert','Master')),
  years_experience  NUMERIC(4,1) DEFAULT 0,
  certified         BOOLEAN     DEFAULT false,
  endorsed_by       UUID        REFERENCES profiles(id),
  endorsed_at       TIMESTAMPTZ,
  last_updated      TIMESTAMPTZ DEFAULT now(),
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (employee_id, skill_id)
);
CREATE INDEX IF NOT EXISTS employee_skills_employee_idx ON employee_skills(employee_id);
CREATE INDEX IF NOT EXISTS employee_skills_skill_idx    ON employee_skills(skill_id);

-- ── 4. ALLOCATIONS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS allocations (
  id                        UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id               UUID         NOT NULL REFERENCES profiles(id),
  project_id                UUID         NOT NULL REFERENCES projects(id),
  allocation_percent        NUMERIC(5,2) NOT NULL CHECK (allocation_percent > 0 AND allocation_percent <= 100),
  allocation_hours_per_week NUMERIC(6,2),           -- computed client-side (percent × employee's default_weekly_capacity_hours)
  role_on_project           TEXT,
  start_date                DATE         NOT NULL,
  end_date                  DATE,                    -- null = ongoing/open-ended
  status                    TEXT         NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','approved','rejected','active','completed','cancelled')),
  requested_by              UUID         NOT NULL REFERENCES profiles(id),
  approved_by               UUID         REFERENCES profiles(id),
  approved_at               TIMESTAMPTZ,
  rejection_reason          TEXT,
  override_flag             BOOLEAN      DEFAULT false,  -- true if requested/approved despite the >100% conflict warning
  override_justification    TEXT,
  created_at                TIMESTAMPTZ  DEFAULT now(),
  updated_at                TIMESTAMPTZ  DEFAULT now()
);
CREATE INDEX IF NOT EXISTS allocations_employee_idx ON allocations(employee_id);
CREATE INDEX IF NOT EXISTS allocations_project_idx  ON allocations(project_id);
CREATE INDEX IF NOT EXISTS allocations_status_idx   ON allocations(status);
CREATE INDEX IF NOT EXISTS allocations_dates_idx    ON allocations(start_date, end_date);

DROP TRIGGER IF EXISTS allocations_updated_at ON allocations;
CREATE TRIGGER allocations_updated_at BEFORE UPDATE ON allocations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 5. ROW LEVEL SECURITY ────────────────────────────────────
-- Matches this app's convention: readable/writable by any authenticated user,
-- role gating done client-side (see CustomDashboardsPanel.jsx, procurement tables).
ALTER TABLE skills           ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_skills  ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocations      ENABLE ROW LEVEL SECURITY;

CREATE POLICY skills_select          ON skills          FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY skills_all             ON skills          FOR ALL    USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY employee_skills_select ON employee_skills FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY employee_skills_all    ON employee_skills FOR ALL    USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY allocations_select     ON allocations     FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY allocations_all        ON allocations     FOR ALL    USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- ── 6. GRANTS (RLS alone is not enough — base table privileges required too) ──
GRANT SELECT, INSERT, UPDATE, DELETE ON public.skills           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_skills  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.allocations      TO authenticated;

-- ── 7. Seed a starter skill catalog (safe to skip / edit) ────
INSERT INTO skills (skill_name, category) VALUES
  ('Embedded C', 'Firmware'), ('RTOS', 'Firmware'), ('PCB Design', 'Hardware Design'),
  ('Schematic Capture', 'Hardware Design'), ('AWS', 'Cloud'), ('Azure', 'Cloud'),
  ('Node.js', 'Cloud'), ('React', 'Cloud'), ('Python', 'Cloud'),
  ('Manual Testing', 'QA'), ('Automation Testing', 'QA'),
  ('Project Planning', 'PM'), ('Stakeholder Management', 'PM')
ON CONFLICT (skill_name) DO NOTHING;

NOTIFY pgrst, 'reload schema';
