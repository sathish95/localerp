-- ============================================================
-- STEP237: Go-Live Support — manual vs IoT hours reconciliation,
-- equipment categories, mismatch actions and shareable reports.
--
--   golive_enrollments.equipment_name / equipment_category   (new columns)
--   golive_hours_uploads       one row per file upload / API push
--   golive_hours_readings      running (+ offline) hours per equipment per
--                              day, source MANUAL (client report) or IOT;
--                              IOT rows can also carry fuel consumed (litres)
--   golive_hours_compare       view: manual vs IoT per equipment-day, with
--                              the tolerance applied → MATCH / MISMATCH /
--                              MISSING_MANUAL / MISSING_IOT
--   golive_hours_actions       what was done about a mismatch: task for the
--                              field user + linked incident, or an accepted
--                              variance with a reason
--   golive_report_links        tokenised public report URLs (customer /
--                              management view, chosen sections, period)
--
-- Tolerance lives in golive_engagements.config.hours_tolerance:
--   { "default_pct": 2, "abs_hours": 0.25, "by_category": { "Compressor": 3 } }
-- A day matches when |IoT − manual| ≤ abs_hours OR ≤ pct % of manual hours.
-- Manual (client) hours are the reference for the percentage.
--
-- golive_ingest_hours() is the single write path for both file uploads and
-- a future IoT API feed (callable with the service role key).
--
-- Requires STEP235. Safe to re-run.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.golive_engagements') IS NULL OR to_regprocedure('public.golive_on_engagement(uuid)') IS NULL THEN
    RAISE EXCEPTION 'STEP237 needs STEP235 (Go-Live Support) — run sql/STEP235_golive_support.sql first';
  END IF;
END $$;

/* ═══ Equipment on the enrollment ═══ */

ALTER TABLE golive_enrollments ADD COLUMN IF NOT EXISTS equipment_name TEXT;
ALTER TABLE golive_enrollments ADD COLUMN IF NOT EXISTS equipment_category TEXT;
CREATE INDEX IF NOT EXISTS golive_enrollments_category ON golive_enrollments (engagement_id, equipment_category);

-- A blank equipment category defaults to the product's device type
-- (products.device_type via device_instances.part_number), so hours,
-- tolerance and equipment status all group the same way.
CREATE OR REPLACE FUNCTION golive_enrollment_default_category() RETURNS TRIGGER AS $$
BEGIN
  IF NULLIF(trim(NEW.equipment_category), '') IS NULL THEN
    SELECT NULLIF(trim(p.device_type), '') INTO NEW.equipment_category
    FROM device_instances d JOIN products p ON p.part_number = d.part_number
    WHERE d.id = NEW.device_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS golive_enrollments_default_category ON golive_enrollments;
CREATE TRIGGER golive_enrollments_default_category BEFORE INSERT OR UPDATE OF device_id, equipment_category ON golive_enrollments
  FOR EACH ROW EXECUTE FUNCTION golive_enrollment_default_category();

-- backfill existing devices (pure data migration: skip the row triggers)
ALTER TABLE golive_enrollments DISABLE TRIGGER USER;
UPDATE golive_enrollments e SET equipment_category = NULLIF(trim(p.device_type), '')
FROM device_instances d JOIN products p ON p.part_number = d.part_number
WHERE d.id = e.device_id AND NULLIF(trim(e.equipment_category), '') IS NULL AND NULLIF(trim(p.device_type), '') IS NOT NULL;
ALTER TABLE golive_enrollments ENABLE TRIGGER USER;

/* ═══ Hours ═══ */

CREATE TABLE IF NOT EXISTS golive_hours_uploads (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  engagement_id   UUID        NOT NULL REFERENCES golive_engagements(id) ON DELETE CASCADE,
  source          TEXT        NOT NULL CHECK (source IN ('MANUAL','IOT')),
  channel         TEXT        NOT NULL DEFAULT 'FILE' CHECK (channel IN ('FILE','API','ENTRY')),
  file_name       TEXT,
  period_from     DATE,
  period_to       DATE,
  row_count       INT         NOT NULL DEFAULT 0,
  matched         INT         NOT NULL DEFAULT 0,
  unmatched       INT         NOT NULL DEFAULT 0,
  created_by      UUID        DEFAULT auth.uid(),
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS golive_hours_uploads_eng ON golive_hours_uploads (engagement_id, created_at DESC);

CREATE TABLE IF NOT EXISTS golive_hours_readings (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  engagement_id   UUID        NOT NULL REFERENCES golive_engagements(id) ON DELETE CASCADE,
  enrollment_id   UUID        NOT NULL REFERENCES golive_enrollments(id) ON DELETE CASCADE,
  reading_date    DATE        NOT NULL,
  source          TEXT        NOT NULL CHECK (source IN ('MANUAL','IOT')),
  running_hours   NUMERIC(6,2) NOT NULL CHECK (running_hours BETWEEN 0 AND 24),
  offline_hours   NUMERIC(6,2) CHECK (offline_hours BETWEEN 0 AND 24),
  equipment_ref   TEXT,       -- the equipment id as it appeared in the report
  upload_id       UUID,       -- soft ref → golive_hours_uploads
  created_by      UUID        DEFAULT auth.uid(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  CHECK (offline_hours IS NULL OR running_hours + offline_hours <= 24.01)
);
-- One reading per equipment per day per source; a re-upload replaces it.
-- Fuel consumed that day (litres), from the application / IoT side.
-- Average fuel consumption = fuel ÷ IoT running hours (L/h).
ALTER TABLE golive_hours_readings ADD COLUMN IF NOT EXISTS fuel_litres NUMERIC(10,2);
ALTER TABLE golive_hours_readings DROP CONSTRAINT IF EXISTS golive_hours_readings_fuel_check;
ALTER TABLE golive_hours_readings ADD CONSTRAINT golive_hours_readings_fuel_check CHECK (fuel_litres IS NULL OR fuel_litres >= 0);
CREATE UNIQUE INDEX IF NOT EXISTS golive_hours_readings_one
  ON golive_hours_readings (enrollment_id, reading_date, source) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS golive_hours_readings_eng_date ON golive_hours_readings (engagement_id, reading_date);

CREATE TABLE IF NOT EXISTS golive_hours_actions (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  engagement_id   UUID        NOT NULL REFERENCES golive_engagements(id) ON DELETE CASCADE,
  enrollment_id   UUID        NOT NULL REFERENCES golive_enrollments(id) ON DELETE CASCADE,
  reading_date    DATE        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','ACCEPTED')),
  manual_hours    NUMERIC(6,2),   -- snapshot when the action was raised
  iot_hours       NUMERIC(6,2),
  diff_hours      NUMERIC(6,2),
  diff_pct        NUMERIC(7,2),
  tolerance_pct   NUMERIC(5,2),
  note            TEXT,           -- task brief / accepted-variance reason / resolution
  task_id         UUID,           -- soft ref → project_tasks
  incident_id     UUID,           -- soft ref → golive_incidents
  assigned_to     UUID,           -- field user
  resolved_by     UUID,
  resolved_at     TIMESTAMPTZ,
  created_by      UUID        DEFAULT auth.uid(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_by      UUID,
  updated_at      TIMESTAMPTZ DEFAULT now(),
  version         INT         NOT NULL DEFAULT 1,
  CHECK (status <> 'ACCEPTED' OR NULLIF(trim(note), '') IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS golive_hours_actions_one ON golive_hours_actions (enrollment_id, reading_date);
CREATE INDEX IF NOT EXISTS golive_hours_actions_eng ON golive_hours_actions (engagement_id, status);

CREATE OR REPLACE FUNCTION golive_hours_action_before() RETURNS TRIGGER AS $$
BEGIN
  SELECT engagement_id INTO NEW.engagement_id FROM golive_enrollments WHERE id = NEW.enrollment_id;
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now(); NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by); NEW.version := OLD.version + 1;
    IF NEW.status <> 'OPEN' AND OLD.status = 'OPEN' THEN NEW.resolved_by := auth.uid(); NEW.resolved_at := now(); END IF;
    IF NEW.status = 'OPEN' THEN NEW.resolved_by := NULL; NEW.resolved_at := NULL; END IF;
  ELSIF NEW.status <> 'OPEN' THEN
    NEW.resolved_by := auth.uid(); NEW.resolved_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS golive_hours_actions_before ON golive_hours_actions;
CREATE TRIGGER golive_hours_actions_before BEFORE INSERT OR UPDATE ON golive_hours_actions
  FOR EACH ROW EXECUTE FUNCTION golive_hours_action_before();

-- Tolerance for a category: category override → default % (2) and absolute floor (0.25 h).
CREATE OR REPLACE FUNCTION golive_hours_tolerance(p_config JSONB, p_category TEXT, OUT pct NUMERIC, OUT abs_hours NUMERIC) AS $$
  SELECT COALESCE(NULLIF(p_config->'hours_tolerance'->'by_category'->>p_category, '')::numeric,
                  NULLIF(p_config->'hours_tolerance'->>'default_pct', '')::numeric, 2),
         COALESCE(NULLIF(p_config->'hours_tolerance'->>'abs_hours', '')::numeric, 0.25)
$$ LANGUAGE sql IMMUTABLE;

-- Manual vs IoT per equipment-day. security_invoker so RLS on the base tables applies.
-- Dropped first: re-running after the fuel columns were added changes the column list.
DROP VIEW IF EXISTS golive_hours_compare;
CREATE VIEW golive_hours_compare WITH (security_invoker = true) AS
WITH m AS (SELECT * FROM golive_hours_readings WHERE source = 'MANUAL' AND deleted_at IS NULL),
     i AS (SELECT * FROM golive_hours_readings WHERE source = 'IOT' AND deleted_at IS NULL),
     p AS (
       SELECT COALESCE(m.organization_id, i.organization_id) AS organization_id,
              COALESCE(m.engagement_id, i.engagement_id) AS engagement_id,
              COALESCE(m.enrollment_id, i.enrollment_id) AS enrollment_id,
              COALESCE(m.reading_date, i.reading_date) AS reading_date,
              m.running_hours AS manual_hours, m.offline_hours AS manual_offline_hours,
              i.running_hours AS iot_hours, i.offline_hours AS iot_offline_hours,
              i.fuel_litres AS iot_fuel_litres
       FROM m FULL JOIN i ON i.enrollment_id = m.enrollment_id AND i.reading_date = m.reading_date
     )
SELECT p.*,
       e.equipment_id, e.equipment_name, COALESCE(NULLIF(trim(e.equipment_category), ''), 'Uncategorised') AS equipment_category,
       e.device_id, e.site,
       t.pct AS tolerance_pct, t.abs_hours AS tolerance_abs_hours,
       (p.iot_hours - p.manual_hours) AS diff_hours,
       CASE WHEN p.manual_hours > 0 THEN round((p.iot_hours - p.manual_hours) / p.manual_hours * 100, 2) END AS diff_pct,
       CASE WHEN p.manual_hours IS NULL THEN 'MISSING_MANUAL'
            WHEN p.iot_hours IS NULL THEN 'MISSING_IOT'
            WHEN abs(p.iot_hours - p.manual_hours) <= t.abs_hours
              OR (p.manual_hours > 0 AND abs(p.iot_hours - p.manual_hours) / p.manual_hours * 100 <= t.pct) THEN 'MATCH'
            ELSE 'MISMATCH' END AS status,
       a.id AS action_id, a.status AS action_status, a.task_id, a.incident_id, a.assigned_to AS action_assigned_to,
       CASE WHEN p.iot_hours > 0 AND p.iot_fuel_litres IS NOT NULL THEN round(p.iot_fuel_litres / p.iot_hours, 2) END AS iot_fuel_lph
FROM p
JOIN golive_enrollments e ON e.id = p.enrollment_id
JOIN golive_engagements g ON g.id = p.engagement_id
CROSS JOIN LATERAL golive_hours_tolerance(g.config, NULLIF(trim(e.equipment_category), '')) t
LEFT JOIN golive_hours_actions a ON a.enrollment_id = p.enrollment_id AND a.reading_date = p.reading_date;

/* ═══ Ingest — file upload and (later) IoT API ═══ */

-- p_rows: [{ "equipment_ref": "COMP-01", "enrollment_id": null, "category": "Compressor",
--            "date": "2026-09-30", "running_hours": 18.5, "offline_hours": 5.5 }, …]
-- equipment_ref matches the enrollment's equipment id, equipment name,
-- device code or serial (case-insensitive); enrollment_id wins when given.
-- Returns { upload_id, saved, unmatched: [refs], invalid: [{row, error}] }.
CREATE OR REPLACE FUNCTION golive_ingest_hours(p_eng UUID, p_source TEXT, p_rows JSONB, p_file_name TEXT DEFAULT NULL, p_channel TEXT DEFAULT 'FILE')
RETURNS JSONB AS $$
DECLARE
  g golive_engagements; r JSONB; v_idx INT := 0; v_enr UUID; v_ref TEXT; v_date DATE; v_run NUMERIC; v_off NUMERIC; v_fuel NUMERIC;
  v_upload UUID; v_saved INT := 0; v_unmatched TEXT[] := '{}'; v_invalid JSONB := '[]'; v_from DATE; v_to DATE;
  v_service BOOLEAN := COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'role', '') = 'service_role';
BEGIN
  SELECT * INTO g FROM golive_engagements WHERE id = p_eng AND deleted_at IS NULL
    AND (v_service OR organization_id = current_org_id());
  IF NOT FOUND THEN RAISE EXCEPTION 'Engagement not found'; END IF;
  IF NOT v_service AND NOT golive_on_engagement(p_eng) THEN RAISE EXCEPTION 'Only the engagement team can upload hours'; END IF;
  IF p_source NOT IN ('MANUAL','IOT') THEN RAISE EXCEPTION 'Source must be MANUAL or IOT'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'Rows must be a JSON array'; END IF;

  INSERT INTO golive_hours_uploads (organization_id, engagement_id, source, channel, file_name, row_count)
  VALUES (g.organization_id, p_eng, p_source, COALESCE(p_channel, 'FILE'), p_file_name, jsonb_array_length(p_rows))
  RETURNING id INTO v_upload;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_idx := v_idx + 1;
    BEGIN
      v_ref := NULLIF(trim(r->>'equipment_ref'), '');
      v_date := (r->>'date')::date;
      v_run := (r->>'running_hours')::numeric;
      v_off := NULLIF(r->>'offline_hours', '')::numeric;
      v_fuel := NULLIF(r->>'fuel_litres', '')::numeric;
      IF v_fuel < 0 THEN RAISE EXCEPTION 'fuel cannot be negative'; END IF;
      IF v_date IS NULL OR v_run IS NULL THEN RAISE EXCEPTION 'date and running hours are required'; END IF;

      v_enr := NULL;
      IF NULLIF(r->>'enrollment_id', '') IS NOT NULL THEN
        SELECT id INTO v_enr FROM golive_enrollments WHERE id = (r->>'enrollment_id')::uuid AND engagement_id = p_eng AND deleted_at IS NULL;
      END IF;
      IF v_enr IS NULL AND v_ref IS NOT NULL THEN
        SELECT e.id INTO v_enr FROM golive_enrollments e LEFT JOIN device_instances d ON d.id = e.device_id
        WHERE e.engagement_id = p_eng AND e.deleted_at IS NULL
          AND lower(v_ref) IN (lower(e.equipment_id), lower(e.equipment_name), lower(d.device_code), lower(d.serial_number))
        ORDER BY (lower(e.equipment_id) = lower(v_ref)) DESC NULLS LAST, e.unenrolled_at NULLS FIRST
        LIMIT 1;
      END IF;
      IF v_enr IS NULL THEN
        v_unmatched := array_append(v_unmatched, COALESCE(v_ref, '(blank)'));
        CONTINUE;
      END IF;

      INSERT INTO golive_hours_readings (organization_id, engagement_id, enrollment_id, reading_date, source, running_hours, offline_hours, fuel_litres, equipment_ref, upload_id, created_by)
      VALUES (g.organization_id, p_eng, v_enr, v_date, p_source, v_run, v_off, v_fuel, v_ref, v_upload, auth.uid())
      ON CONFLICT (enrollment_id, reading_date, source) WHERE deleted_at IS NULL
      DO UPDATE SET running_hours = EXCLUDED.running_hours, offline_hours = EXCLUDED.offline_hours,
                    -- a file without a fuel column keeps the fuel already recorded
                    fuel_litres = COALESCE(EXCLUDED.fuel_litres, golive_hours_readings.fuel_litres),
                    equipment_ref = EXCLUDED.equipment_ref, upload_id = EXCLUDED.upload_id, updated_at = now();

      -- fill a blank category from the report
      IF NULLIF(trim(r->>'category'), '') IS NOT NULL THEN
        UPDATE golive_enrollments SET equipment_category = trim(r->>'category')
        WHERE id = v_enr AND NULLIF(trim(equipment_category), '') IS NULL;
      END IF;
      v_saved := v_saved + 1;
      v_from := LEAST(COALESCE(v_from, v_date), v_date);
      v_to := GREATEST(COALESCE(v_to, v_date), v_date);
    EXCEPTION WHEN OTHERS THEN
      v_invalid := v_invalid || jsonb_build_object('row', v_idx, 'ref', v_ref, 'error', SQLERRM);
    END;
  END LOOP;

  UPDATE golive_hours_uploads SET matched = v_saved, unmatched = cardinality(v_unmatched), period_from = v_from, period_to = v_to
  WHERE id = v_upload;
  INSERT INTO golive_events (organization_id, engagement_id, entity, entity_id, event_type, summary, changes, actor_id)
  VALUES (g.organization_id, p_eng, 'hours', v_upload, 'hours_uploaded',
          initcap(p_source) || ' hours: ' || v_saved || ' saved, ' || cardinality(v_unmatched) || ' unmatched',
          jsonb_build_object('file', p_file_name, 'channel', p_channel), auth.uid());
  RETURN jsonb_build_object('upload_id', v_upload, 'saved', v_saved, 'unmatched', to_jsonb(v_unmatched), 'invalid', v_invalid);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION golive_ingest_hours(UUID, TEXT, JSONB, TEXT, TEXT) TO authenticated, service_role;

/* ═══ Report links ═══ */

CREATE TABLE IF NOT EXISTS golive_report_links (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  engagement_id   UUID        NOT NULL REFERENCES golive_engagements(id) ON DELETE CASCADE,
  token           TEXT        NOT NULL UNIQUE DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  audience        TEXT        NOT NULL DEFAULT 'CUSTOMER' CHECK (audience IN ('CUSTOMER','MANAGEMENT')),
  title           TEXT,
  sections        JSONB       NOT NULL DEFAULT '["summary","health","hours","equipment","incidents","actions","readiness"]',
  period_days     INT         CHECK (period_days BETWEEN 1 AND 366),   -- rolling window (null when a fixed range is set)
  period_from     DATE,
  period_to       DATE,
  expires_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  view_count      INT         NOT NULL DEFAULT 0,
  last_viewed_at  TIMESTAMPTZ,
  created_by      UUID        DEFAULT auth.uid(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  CHECK (period_days IS NOT NULL OR (period_from IS NOT NULL AND period_to IS NOT NULL AND period_to >= period_from))
);
CREATE INDEX IF NOT EXISTS golive_report_links_eng ON golive_report_links (engagement_id);

-- Public report payload. Customer view: no internal people names, only
-- customer-visible incidents, no device-issue text. Management adds
-- owners, SLAs, response times and exit readiness detail.
CREATE OR REPLACE FUNCTION get_golive_report(p_token TEXT) RETURNS JSONB AS $$
DECLARE
  l golive_report_links; g golive_engagements; v_from DATE; v_to DATE; v_mgmt BOOLEAN; v JSONB := '{}';
  v_customer TEXT; v_project TEXT;
BEGIN
  SELECT * INTO l FROM golive_report_links WHERE token = p_token AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO g FROM golive_engagements WHERE id = l.engagement_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE golive_report_links SET view_count = view_count + 1, last_viewed_at = now() WHERE id = l.id;

  v_mgmt := l.audience = 'MANAGEMENT';
  v_to := COALESCE(l.period_to, golive_ist_today());
  v_from := COALESCE(l.period_from, v_to - (COALESCE(l.period_days, 30) - 1));
  SELECT name INTO v_customer FROM customers WHERE id = g.customer_id;
  SELECT name INTO v_project FROM projects WHERE id = g.project_id;

  v := jsonb_build_object(
    'audience', l.audience, 'title', COALESCE(l.title, g.name || ' — hypercare report'), 'sections', l.sections,
    'period', jsonb_build_object('from', v_from, 'to', v_to), 'generated_at', now(),
    'engagement', jsonb_build_object('code', g.code, 'name', g.name, 'status', g.status, 'customer', v_customer, 'project', v_project,
      'sites', to_jsonb(g.sites), 'go_live_date', g.go_live_date, 'hypercare_start', g.hypercare_start,
      'hypercare_planned_end', g.hypercare_planned_end, 'hypercare_actual_end', g.hypercare_actual_end)
  );

  -- daily health (check records) across the period
  v := v || jsonb_build_object('health', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('date', d::date,
      'expected', (SELECT count(*) FROM golive_enrollments e WHERE e.engagement_id = g.id AND e.deleted_at IS NULL AND e.support_status = 'ACTIVE'
                    AND (e.enrolled_at AT TIME ZONE 'Asia/Kolkata')::date <= d AND (e.unenrolled_at IS NULL OR (e.unenrolled_at AT TIME ZONE 'Asia/Kolkata')::date > d)),
      'logged', (SELECT count(DISTINCT k.enrollment_id) FROM golive_daily_checks k WHERE k.engagement_id = g.id AND k.check_date = d AND k.deleted_at IS NULL),
      'healthy', (SELECT count(*) FROM golive_daily_checks k WHERE k.engagement_id = g.id AND k.check_date = d AND k.deleted_at IS NULL AND k.daily_result = 'HEALTHY'),
      'attention', (SELECT count(*) FROM golive_daily_checks k WHERE k.engagement_id = g.id AND k.check_date = d AND k.deleted_at IS NULL AND k.daily_result = 'ATTENTION'),
      'incomplete', (SELECT count(*) FROM golive_daily_checks k WHERE k.engagement_id = g.id AND k.check_date = d AND k.deleted_at IS NULL AND k.daily_result = 'INCOMPLETE')
    ) ORDER BY d)
    FROM generate_series(GREATEST(v_from, COALESCE(g.hypercare_start, v_from)), v_to, interval '1 day') d), '[]'::jsonb));

  -- hours reconciliation, per equipment-day
  v := v || jsonb_build_object('hours', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('date', c.reading_date, 'equipment', COALESCE(c.equipment_name, c.equipment_id, di.device_code, di.serial_number),
      'equipment_id', c.equipment_id, 'category', c.equipment_category, 'manual', c.manual_hours, 'iot', c.iot_hours,
      'manual_offline', c.manual_offline_hours, 'iot_offline', c.iot_offline_hours, 'diff', c.diff_hours, 'diff_pct', c.diff_pct,
      'fuel', c.iot_fuel_litres, 'fuel_lph', c.iot_fuel_lph,
      'tolerance_pct', c.tolerance_pct, 'status', c.status, 'action_status', c.action_status) ORDER BY c.reading_date, c.equipment_category)
    FROM golive_hours_compare c LEFT JOIN device_instances di ON di.id = c.device_id
    WHERE c.engagement_id = g.id AND c.reading_date BETWEEN v_from AND v_to), '[]'::jsonb));

  -- equipment status within the period: the latest onsite check's
  -- connectivity, or — when there's no newer check — the latest IoT hours
  -- (ran / didn't run); plus manual vs IoT hours, fuel and open issues.
  v := v || jsonb_build_object('equipment', COALESCE((
    SELECT jsonb_agg(x ORDER BY x->>'category', x->>'equipment') FROM (
      SELECT jsonb_build_object(
        'equipment', COALESCE(NULLIF(trim(e.equipment_name), ''), NULLIF(trim(e.equipment_id), ''), di.device_code, di.serial_number),
        'equipment_id', e.equipment_id, 'device', COALESCE(di.device_code, di.serial_number),
        'category', COALESCE(NULLIF(trim(e.equipment_category), ''), 'Uncategorised'), 'site', e.site, 'support_status', e.support_status,
        'last_check_date', lc.check_date, 'last_result', lc.daily_result, 'connectivity', lc.connectivity,
        'last_hours_date', lh.reading_date, 'last_manual', lh.manual_hours, 'last_iot', lh.iot_hours, 'last_hours_status', lh.status,
        'hour_days', hs.days, 'manual_hours', hs.manual, 'iot_hours', hs.iot,
        'manual_uptime_pct', CASE WHEN hs.both_days > 0 THEN round(hs.manual_both / (hs.both_days * 24) * 100, 1) END,
        'iot_uptime_pct', CASE WHEN hs.both_days > 0 THEN round(hs.iot_both / (hs.both_days * 24) * 100, 1) END,
        'fuel', hs.fuel, 'fuel_lph', CASE WHEN hs.fuel_hours > 0 THEN round(hs.fuel / hs.fuel_hours, 2) END,
        'status', CASE
          WHEN e.support_status <> 'ACTIVE' THEN e.support_status
          WHEN lc.connectivity IN ('ONLINE','OFFLINE','INTERMITTENT') AND (lh.reading_date IS NULL OR lc.check_date >= lh.reading_date) THEN lc.connectivity
          WHEN lh.iot_hours IS NOT NULL THEN CASE WHEN lh.iot_hours > 0 THEN 'RUNNING' ELSE 'NOT_RUNNING' END
          WHEN lc.connectivity IN ('ONLINE','OFFLINE','INTERMITTENT') THEN lc.connectivity
          ELSE 'NO_DATA' END,
        'open_issues', (SELECT count(*) FROM golive_device_notes n WHERE n.enrollment_id = e.id AND n.is_issue AND n.issue_status = 'OPEN' AND n.deleted_at IS NULL)
      ) AS x
      FROM golive_enrollments e
      LEFT JOIN device_instances di ON di.id = e.device_id
      LEFT JOIN LATERAL (SELECT k.check_date, k.daily_result, k.connectivity FROM golive_daily_checks k
                         WHERE k.enrollment_id = e.id AND k.deleted_at IS NULL AND k.check_date BETWEEN v_from AND v_to
                         ORDER BY k.check_date DESC LIMIT 1) lc ON true
      LEFT JOIN LATERAL (SELECT c.reading_date, c.manual_hours, c.iot_hours, c.status FROM golive_hours_compare c
                         WHERE c.enrollment_id = e.id AND c.reading_date BETWEEN v_from AND v_to
                         ORDER BY c.reading_date DESC LIMIT 1) lh ON true
      LEFT JOIN LATERAL (SELECT count(*) AS days, sum(c.manual_hours) AS manual, sum(c.iot_hours) AS iot,
                                count(*) FILTER (WHERE c.manual_hours IS NOT NULL AND c.iot_hours IS NOT NULL) AS both_days,
                                sum(c.manual_hours) FILTER (WHERE c.iot_hours IS NOT NULL) AS manual_both,
                                sum(c.iot_hours) FILTER (WHERE c.manual_hours IS NOT NULL) AS iot_both,
                                sum(c.iot_fuel_litres) AS fuel,
                                sum(c.iot_hours) FILTER (WHERE c.iot_fuel_litres IS NOT NULL) AS fuel_hours
                         FROM golive_hours_compare c
                         WHERE c.enrollment_id = e.id AND c.reading_date BETWEEN v_from AND v_to) hs ON true
      WHERE e.engagement_id = g.id AND e.deleted_at IS NULL AND e.unenrolled_at IS NULL
    ) s), '[]'::jsonb));

  -- incidents
  v := v || jsonb_build_object('incidents', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('number', i.number, 'title', i.title, 'priority', i.priority, 'category', i.category, 'status', i.status,
      'reported_at', i.reported_at, 'acknowledged_at', i.acknowledged_at, 'resolved_at', i.resolved_at, 'closed_at', i.closed_at,
      'next_action', i.next_action, 'action_due_at', i.action_due_at, 'follow_up_flag', golive_compute_follow_up_flag(i, now()),
      'owner', CASE WHEN v_mgmt THEN (SELECT full_name FROM profiles WHERE id = i.assigned_owner_user_id) END) ORDER BY i.reported_at DESC)
    FROM golive_incidents i
    WHERE i.engagement_id = g.id AND i.deleted_at IS NULL AND (v_mgmt OR i.customer_visible)
      AND (i.status <> 'CLOSED' OR i.closed_at >= v_from)), '[]'::jsonb));

  -- improvement actions: open hours actions, open device issues, open incident next actions
  v := v || jsonb_build_object('actions', COALESCE((
    SELECT jsonb_agg(x ORDER BY x->>'kind', x->>'date') FROM (
      SELECT jsonb_build_object('kind', 'hours', 'date', a.reading_date,
        'equipment', COALESCE(e.equipment_name, e.equipment_id, di.device_code),
        'text', 'Hours mismatch ' || COALESCE(a.diff_pct::text || '%', a.diff_hours::text || ' h') || ' (manual ' || COALESCE(a.manual_hours::text, '—') || ' h vs IoT ' || COALESCE(a.iot_hours::text, '—') || ' h)',
        'status', a.status, 'owner', CASE WHEN v_mgmt THEN (SELECT full_name FROM profiles WHERE id = a.assigned_to) END,
        'note', CASE WHEN v_mgmt THEN a.note END) AS x
      FROM golive_hours_actions a JOIN golive_enrollments e ON e.id = a.enrollment_id LEFT JOIN device_instances di ON di.id = e.device_id
      WHERE a.engagement_id = g.id AND a.status = 'OPEN'
      UNION ALL
      SELECT jsonb_build_object('kind', 'device_issue', 'date', (n.created_at AT TIME ZONE 'Asia/Kolkata')::date,
        'equipment', COALESCE(e.equipment_name, e.equipment_id, di.device_code),
        'text', CASE WHEN v_mgmt THEN left(n.body, 200) ELSE initcap(n.severity) || ' ' || lower(replace(COALESCE(n.issue_category, 'device'), '_', ' ')) || ' issue under follow-up' END,
        'status', n.issue_status, 'severity', n.severity, 'owner', CASE WHEN v_mgmt THEN (SELECT full_name FROM profiles WHERE id = n.created_by) END)
      FROM golive_device_notes n JOIN golive_enrollments e ON e.id = n.enrollment_id LEFT JOIN device_instances di ON di.id = e.device_id
      WHERE n.engagement_id = g.id AND n.is_issue AND n.issue_status = 'OPEN' AND n.deleted_at IS NULL
      UNION ALL
      SELECT jsonb_build_object('kind', 'incident', 'date', (i.reported_at AT TIME ZONE 'Asia/Kolkata')::date, 'equipment', i.number,
        'text', COALESCE(i.next_action, i.title), 'status', i.status, 'due', i.action_due_at,
        'owner', CASE WHEN v_mgmt THEN (SELECT full_name FROM profiles WHERE id = i.assigned_owner_user_id) END)
      FROM golive_incidents i
      WHERE i.engagement_id = g.id AND i.deleted_at IS NULL AND i.status NOT IN ('RESOLVED','CLOSED') AND (v_mgmt OR i.customer_visible)
    ) s), '[]'::jsonb));

  v := v || jsonb_build_object('readiness', golive_exit_readiness_sys(g.id));
  RETURN v;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION get_golive_report(TEXT) TO anon, authenticated;

/* ═══ RLS ═══ */

ALTER TABLE golive_hours_uploads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE golive_hours_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE golive_hours_actions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE golive_report_links   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE tbl TEXT;
BEGIN
  -- readings/uploads are written through golive_ingest_hours(); read org-wide, delete by the team
  FOREACH tbl IN ARRAY ARRAY['golive_hours_uploads','golive_hours_readings','golive_hours_actions','golive_report_links'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_select ON %1$s', tbl);
    EXECUTE format('CREATE POLICY %1$s_select ON %1$s FOR SELECT USING (organization_id = current_org_id())', tbl);
  END LOOP;
END $$;

DROP POLICY IF EXISTS golive_hours_readings_update ON golive_hours_readings;
CREATE POLICY golive_hours_readings_update ON golive_hours_readings FOR UPDATE
  USING (organization_id = current_org_id() AND golive_on_engagement(engagement_id)) WITH CHECK (organization_id = current_org_id());

DROP POLICY IF EXISTS golive_hours_actions_write ON golive_hours_actions;
CREATE POLICY golive_hours_actions_write ON golive_hours_actions FOR ALL
  USING (organization_id = current_org_id() AND golive_on_engagement(engagement_id))
  WITH CHECK (organization_id = current_org_id() AND golive_on_engagement(engagement_id));

DROP POLICY IF EXISTS golive_report_links_write ON golive_report_links;
CREATE POLICY golive_report_links_write ON golive_report_links FOR ALL
  USING (organization_id = current_org_id() AND golive_can_manage(engagement_id))
  WITH CHECK (organization_id = current_org_id() AND golive_can_manage(engagement_id));

GRANT SELECT ON public.golive_hours_uploads TO authenticated;
GRANT SELECT, UPDATE ON public.golive_hours_readings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.golive_hours_actions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.golive_report_links TO authenticated;
GRANT SELECT ON public.golive_hours_compare TO authenticated;

NOTIFY pgrst, 'reload schema';
