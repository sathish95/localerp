-- ============================================================
-- STEP248: Support visits — check-in / check-out on devices, billed to
-- the project's Support costs.
--
-- time_logs (the existing check-in / check-out) gains:
--   visit_type        'SUPPORT' for a support / site visit (NULL = ordinary work)
--   engagement_id     go-live engagement the visit is for (soft ref)
--   site              site visited
--   check_in_lat/lng, check_out_lat/lng   browser GPS at check-in / out (optional)
-- time_log_devices    devices worked on during a visit: activity type,
--                     optional minutes, note. Adding a device marks the log
--                     as a SUPPORT visit.
-- device_visits (view) one row per device per visit with the minutes
--                     attributed to it: the minutes entered, else the
--                     visit's remaining time split evenly across the devices
--                     without minutes.
--
-- Support billing: every project gets one automatic line per month in
-- project_support_costs (source = 'SUPPORT_VISITS', source_key 'visits:YYYY-MM'):
--   hours         = checked-out SUPPORT visit hours on the project that month
--   cost_company  = Σ hours × the person's hourly rate (role_rates for their
--                   designation on that date, else resource_rates.hourly_rate,
--                   else monthly_salary / 176)
--   cost_client   = hours × projects.support_hourly_rate (new column), else
--                   cost_company × 1.3
--   proposal_cost = cost_client
-- Kept in sync by triggers on time_logs, time_log_devices and the project's
-- support rate; sync_project_support_visits(project) can be called directly.
-- The project page counts SUPPORT visit hours under Support, not HR, so they
-- are not counted twice.
--
-- Requires STEP243 (device sensors era tables) only for context; needs
-- time_logs, project_support_costs, role_rates, resource_rates. Safe to re-run.
-- ============================================================

ALTER TABLE time_logs ADD COLUMN IF NOT EXISTS visit_type TEXT;
ALTER TABLE time_logs ADD COLUMN IF NOT EXISTS engagement_id UUID;
ALTER TABLE time_logs ADD COLUMN IF NOT EXISTS site TEXT;
ALTER TABLE time_logs ADD COLUMN IF NOT EXISTS check_in_lat NUMERIC(9,6);
ALTER TABLE time_logs ADD COLUMN IF NOT EXISTS check_in_lng NUMERIC(9,6);
ALTER TABLE time_logs ADD COLUMN IF NOT EXISTS check_out_lat NUMERIC(9,6);
ALTER TABLE time_logs ADD COLUMN IF NOT EXISTS check_out_lng NUMERIC(9,6);
CREATE INDEX IF NOT EXISTS time_logs_support_idx ON time_logs (project_id, work_date) WHERE visit_type = 'SUPPORT';

ALTER TABLE projects ADD COLUMN IF NOT EXISTS support_hourly_rate NUMERIC(12,2);   -- client billing rate per support hour

ALTER TABLE project_support_costs ADD COLUMN IF NOT EXISTS source TEXT;        -- NULL = manual, 'SUPPORT_VISITS' = automatic
ALTER TABLE project_support_costs ADD COLUMN IF NOT EXISTS source_key TEXT;    -- 'visits:YYYY-MM'
ALTER TABLE project_support_costs ADD COLUMN IF NOT EXISTS hours NUMERIC(10,2);
CREATE UNIQUE INDEX IF NOT EXISTS project_support_costs_visits_uq
  ON project_support_costs (project_id, source_key) WHERE source = 'SUPPORT_VISITS';

CREATE TABLE IF NOT EXISTS time_log_devices (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  time_log_id     UUID        NOT NULL REFERENCES time_logs(id) ON DELETE CASCADE,
  device_id       UUID        NOT NULL,        -- soft ref → device_instances
  activity_type   TEXT        NOT NULL DEFAULT 'INSPECTION'
                  CHECK (activity_type IN ('INSPECTION','INSTALLATION','FIRMWARE_UPGRADE','SENSOR_FITTING','REPAIR','CALIBRATION','REPLACEMENT','OTHER')),
  minutes         INT         CHECK (minutes IS NULL OR minutes >= 0),
  note            TEXT,
  created_by      UUID        DEFAULT auth.uid(),
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS time_log_devices_log ON time_log_devices (time_log_id);
CREATE INDEX IF NOT EXISTS time_log_devices_device ON time_log_devices (device_id);

ALTER TABLE time_log_devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS time_log_devices_select ON time_log_devices;
DROP POLICY IF EXISTS time_log_devices_write ON time_log_devices;
CREATE POLICY time_log_devices_select ON time_log_devices FOR SELECT USING (organization_id = current_org_id());
-- the person who owns the check-in (or a manager) records what was done on it
CREATE POLICY time_log_devices_write ON time_log_devices FOR ALL USING (
  organization_id = current_org_id() AND (
    EXISTS (SELECT 1 FROM time_logs t WHERE t.id = time_log_id AND t.employee_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cto','manager','department_head','pm','project_manager'))
  )
) WITH CHECK (
  organization_id = current_org_id() AND (
    EXISTS (SELECT 1 FROM time_logs t WHERE t.id = time_log_id AND t.employee_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cto','manager','department_head','pm','project_manager'))
  )
);

/* ═══ Per-device visit view ═══ */

CREATE OR REPLACE VIEW device_visits WITH (security_invoker = true) AS
SELECT d.id, d.organization_id, d.device_id, d.time_log_id, d.activity_type, d.note, d.minutes AS minutes_entered,
       t.employee_id, t.project_id, t.engagement_id, t.site, t.work_date, t.check_in, t.check_out, t.hours_worked,
       t.check_in_lat, t.check_in_lng,
       round(COALESCE(d.minutes::numeric,
         GREATEST(0, COALESCE(t.hours_worked, 0) * 60 - COALESCE(s.explicit, 0)) / NULLIF(s.unset, 0)), 0) AS minutes
FROM time_log_devices d
JOIN time_logs t ON t.id = d.time_log_id
JOIN LATERAL (SELECT sum(x.minutes) AS explicit, count(*) FILTER (WHERE x.minutes IS NULL) AS unset
              FROM time_log_devices x WHERE x.time_log_id = d.time_log_id) s ON true;

/* ═══ Rates ═══ */

CREATE OR REPLACE FUNCTION employee_hourly_rate(p_employee UUID, p_on DATE) RETURNS NUMERIC AS $$
  SELECT COALESCE(
    (SELECT rr.hourly_rate FROM role_rates rr JOIN profiles p ON p.designation = rr.designation
     WHERE p.id = p_employee AND rr.effective_from <= p_on AND (rr.effective_to IS NULL OR rr.effective_to >= p_on)
     ORDER BY rr.effective_from DESC LIMIT 1),
    (SELECT COALESCE(r.hourly_rate, r.monthly_salary / 176.0) FROM resource_rates r WHERE r.employee_id = p_employee LIMIT 1),
    0)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

/* ═══ Support billing lines ═══ */

CREATE OR REPLACE FUNCTION sync_project_support_visits(p_project UUID) RETURNS VOID AS $$
DECLARE v_org UUID; v_rate NUMERIC; r RECORD; v_keys TEXT[] := '{}'; v_client NUMERIC;
BEGIN
  IF p_project IS NULL THEN RETURN; END IF;
  SELECT organization_id, support_hourly_rate INTO v_org, v_rate FROM projects WHERE id = p_project;
  IF NOT FOUND THEN RETURN; END IF;
  FOR r IN
    WITH m AS (
      SELECT to_char(t.work_date, 'YYYY-MM') AS ym, min(t.work_date) AS first_day,
             round(sum(COALESCE(t.hours_worked, 0)), 2) AS hours,
             round(sum(COALESCE(t.hours_worked, 0) * employee_hourly_rate(t.employee_id, t.work_date)), 2) AS cost,
             count(*) AS visits, count(DISTINCT t.employee_id) AS people
      FROM time_logs t
      WHERE t.project_id = p_project AND t.visit_type = 'SUPPORT' AND t.check_out IS NOT NULL AND t.work_date IS NOT NULL
      GROUP BY 1
    ), dv AS (
      SELECT to_char(t.work_date, 'YYYY-MM') AS ym, count(DISTINCT d.device_id) AS devices
      FROM time_log_devices d JOIN time_logs t ON t.id = d.time_log_id
      WHERE t.project_id = p_project AND t.visit_type = 'SUPPORT' AND t.check_out IS NOT NULL AND t.work_date IS NOT NULL
      GROUP BY 1
    )
    SELECT m.*, COALESCE(dv.devices, 0) AS devices FROM m LEFT JOIN dv USING (ym)
  LOOP
    v_keys := v_keys || ('visits:' || r.ym);
    v_client := CASE WHEN COALESCE(v_rate, 0) > 0 THEN round(r.hours * v_rate, 2) ELSE round(r.cost * 1.3, 2) END;
    INSERT INTO project_support_costs (organization_id, project_id, name, category, cost_company, cost_client, proposal_cost, date, notes, source, source_key, hours)
    VALUES (v_org, p_project, 'Support visits · ' || to_char(r.first_day, 'Mon YYYY'), 'support_visits', r.cost, v_client, v_client,
            date_trunc('month', r.first_day)::date,
            r.visits || ' visit(s) · ' || r.people || ' engineer(s) · ' || r.devices || ' device(s) · ' || r.hours || ' h'
              || CASE WHEN COALESCE(v_rate, 0) > 0 THEN ' · billed at ' || v_rate || '/h' ELSE ' · no support rate set, billed at cost × 1.3' END,
            'SUPPORT_VISITS', 'visits:' || r.ym, r.hours)
    ON CONFLICT (project_id, source_key) WHERE source = 'SUPPORT_VISITS' DO UPDATE SET
      name = EXCLUDED.name, cost_company = EXCLUDED.cost_company, cost_client = EXCLUDED.cost_client,
      proposal_cost = EXCLUDED.proposal_cost, date = EXCLUDED.date, notes = EXCLUDED.notes, hours = EXCLUDED.hours;
  END LOOP;
  DELETE FROM project_support_costs WHERE project_id = p_project AND source = 'SUPPORT_VISITS' AND NOT (source_key = ANY(v_keys));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION sync_project_support_visits(UUID) TO authenticated;

-- a support visit's changes re-bill its project(s)
CREATE OR REPLACE FUNCTION time_logs_support_visits() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.visit_type = 'SUPPORT' THEN PERFORM sync_project_support_visits(OLD.project_id); END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.visit_type = 'SUPPORT'
     AND (TG_OP = 'INSERT' OR OLD.visit_type IS DISTINCT FROM 'SUPPORT' OR NEW.project_id IS DISTINCT FROM OLD.project_id) THEN
    PERFORM sync_project_support_visits(NEW.project_id);
  END IF;
  -- (an edit within the same project was already re-synced through OLD above)
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS time_logs_support_visits ON time_logs;
CREATE TRIGGER time_logs_support_visits AFTER INSERT OR DELETE OR UPDATE OF visit_type, project_id, hours_worked, check_out, work_date, employee_id ON time_logs
  FOR EACH ROW EXECUTE FUNCTION time_logs_support_visits();

-- recording a device on a check-in makes it a support visit
CREATE OR REPLACE FUNCTION time_log_devices_mark_visit() RETURNS TRIGGER AS $$
BEGIN
  UPDATE time_logs SET visit_type = 'SUPPORT' WHERE id = NEW.time_log_id AND visit_type IS DISTINCT FROM 'SUPPORT';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS time_log_devices_mark_visit ON time_log_devices;
CREATE TRIGGER time_log_devices_mark_visit AFTER INSERT ON time_log_devices FOR EACH ROW EXECUTE FUNCTION time_log_devices_mark_visit();

-- device count in the line notes follows device rows too
CREATE OR REPLACE FUNCTION time_log_devices_resync() RETURNS TRIGGER AS $$
DECLARE pid UUID;
BEGIN
  SELECT project_id INTO pid FROM time_logs WHERE id = COALESCE(NEW.time_log_id, OLD.time_log_id);
  PERFORM sync_project_support_visits(pid);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS time_log_devices_resync ON time_log_devices;
CREATE TRIGGER time_log_devices_resync AFTER INSERT OR DELETE ON time_log_devices FOR EACH ROW EXECUTE FUNCTION time_log_devices_resync();

CREATE OR REPLACE FUNCTION projects_support_rate() RETURNS TRIGGER AS $$
BEGIN
  PERFORM sync_project_support_visits(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS projects_support_rate ON projects;
CREATE TRIGGER projects_support_rate AFTER UPDATE OF support_hourly_rate ON projects FOR EACH ROW EXECUTE FUNCTION projects_support_rate();

NOTIFY pgrst, 'reload schema';
