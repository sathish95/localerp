-- ============================================================
-- STEP30: Capacity Snapshots, Leave Types, Holidays, Bench/Utilization
-- (Phase 2 of Resource Allocation & Capacity module)
-- Run in Supabase SQL editor after STEP29.
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ── 1. LEAVE_TYPES (catalog — replaces hardcoded LEAVE_COLORS as source of truth) ──
CREATE TABLE IF NOT EXISTS leave_types (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  code                  TEXT        NOT NULL UNIQUE,   -- slug, matches leave_requests.leave_type values
  name                  TEXT        NOT NULL,
  default_annual_quota  NUMERIC(5,2) DEFAULT 0,        -- days, or hours for permission-style types
  requires_approval     BOOLEAN     NOT NULL DEFAULT true,
  icon                  TEXT,
  color_bg              TEXT,
  color_hex             TEXT,
  is_active             BOOLEAN     DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT now()
);

-- Seed rows mirror today's hardcoded LEAVE_COLORS exactly so existing leave_requests
-- rows (leave_type='sick'/'casual'/'personal'/'permission') keep resolving correctly.
INSERT INTO leave_types (code, name, default_annual_quota, requires_approval, icon, color_bg, color_hex) VALUES
  ('sick',       'Sick Leave',          12, true, '🤒', '#fee2e2', '#dc2626'),
  ('casual',     'Casual Leave',        12, true, '🏖️', '#dbeafe', '#1d4ed8'),
  ('personal',   'Personal Leave',       6, true, '👤', '#ede9fe', '#6d28d9'),
  ('permission', 'Permission (Hours)',  24, true, '⏰', '#fef3c7', '#b45309')
ON CONFLICT (code) DO NOTHING;

-- ── 2. HOLIDAYS (company-wide, no multi-region) ──
CREATE TABLE IF NOT EXISTS holidays (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  holiday_date DATE        NOT NULL UNIQUE,
  name         TEXT        NOT NULL,
  scope        TEXT        DEFAULT 'company',
  created_by   UUID        REFERENCES profiles(id),
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS holidays_date_idx ON holidays(holiday_date);

-- ── 3. CAPACITY_SNAPSHOTS (recomputed client-side, never via trigger/proc) ──
CREATE TABLE IF NOT EXISTS capacity_snapshots (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id         UUID        NOT NULL REFERENCES profiles(id),
  week_start_date     DATE        NOT NULL,             -- Monday of the ISO week
  available_hours     NUMERIC(6,2) DEFAULT 0,
  allocated_hours      NUMERIC(6,2) DEFAULT 0,
  leave_hours          NUMERIC(6,2) DEFAULT 0,
  utilization_percent  NUMERIC(6,2) DEFAULT 0,
  computed_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (employee_id, week_start_date)
);
CREATE INDEX IF NOT EXISTS capacity_snapshots_employee_idx ON capacity_snapshots(employee_id);
CREATE INDEX IF NOT EXISTS capacity_snapshots_week_idx     ON capacity_snapshots(week_start_date);

-- ── 4. CAPACITY_SETTINGS (singleton row — configurable bench/burnout thresholds) ──
CREATE TABLE IF NOT EXISTS capacity_settings (
  id                         INT         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  bench_risk_threshold_pct   NUMERIC(5,2) NOT NULL DEFAULT 30,
  burnout_risk_threshold_pct NUMERIC(5,2) NOT NULL DEFAULT 100,
  updated_by                 UUID        REFERENCES profiles(id),
  updated_at                 TIMESTAMPTZ DEFAULT now()
);
INSERT INTO capacity_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS capacity_settings_updated_at ON capacity_settings;
CREATE TRIGGER capacity_settings_updated_at BEFORE UPDATE ON capacity_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 5. ROW LEVEL SECURITY ──
ALTER TABLE leave_types        ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays           ENABLE ROW LEVEL SECURITY;
ALTER TABLE capacity_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE capacity_settings  ENABLE ROW LEVEL SECURITY;

CREATE POLICY leave_types_all        ON leave_types        FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY holidays_all           ON holidays           FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY capacity_snapshots_all ON capacity_snapshots FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY capacity_settings_all  ON capacity_settings  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- ── 6. GRANTS (RLS alone is not enough — base table privileges required too) ──
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_types        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.holidays           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.capacity_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.capacity_settings  TO authenticated;

NOTIFY pgrst, 'reload schema';
