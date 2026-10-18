-- ============================================================
-- STEP210: Monthly Capacity / Allocation Chart grid
-- Adds the two small tables the new "Allocation Chart" tab
-- (CapacityPage.jsx) needs on top of the EXISTING allocation data:
--   - working days for a given month (org-wide, one row per month)
--   - per-employee leave-taken / available-days for a given month
--     (seeded client-side from leave_requests, then editable/overridable
--     — see Harsha-style prorated joiners where Available Days doesn't
--     equal Working Days - Leave Taken)
-- Per-project day allocations are NOT duplicated here — they read/write
-- the EXISTING project_resource_alloc table (hours = days * 8), the same
-- table ProjectsPage.jsx's Resourcing tab already uses.
-- Run in Supabase SQL editor after STEP209.
-- ============================================================

CREATE TABLE IF NOT EXISTS capacity_working_days (
  year          INT         NOT NULL,
  month         INT         NOT NULL CHECK (month BETWEEN 1 AND 12),
  working_days  NUMERIC(5,2) NOT NULL DEFAULT 22,
  updated_by    UUID        REFERENCES profiles(id),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (year, month)
);

CREATE TABLE IF NOT EXISTS capacity_employee_days (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id     UUID        NOT NULL REFERENCES profiles(id),
  year            INT         NOT NULL,
  month           INT         NOT NULL CHECK (month BETWEEN 1 AND 12),
  leave_taken     NUMERIC(5,2) NOT NULL DEFAULT 0,
  available_days  NUMERIC(5,2) NOT NULL DEFAULT 0,
  updated_by      UUID        REFERENCES profiles(id),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (employee_id, year, month)
);
CREATE INDEX IF NOT EXISTS capacity_employee_days_period_idx ON capacity_employee_days(year, month);

ALTER TABLE capacity_working_days  ENABLE ROW LEVEL SECURITY;
ALTER TABLE capacity_employee_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY capacity_working_days_all  ON capacity_working_days  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY capacity_employee_days_all ON capacity_employee_days FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.capacity_working_days  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.capacity_employee_days TO authenticated;

NOTIFY pgrst, 'reload schema';
