-- ============================================================
-- STEP253: Go-Live hours — no 24 h cap, nothing mandatory.
--
-- Engine running hours can be any amount (an hour-meter reading, a
-- multi-day log, or 0). The 0–24 caps and "running + offline ≤ 24" rule
-- from STEP237/238 are removed, the columns are widened beyond 9999.99,
-- and running hours is no longer required: offline hours or fuel can be
-- saved on their own. Only negatives are still rejected.
--
-- golive_set_check_hours(): a source's reading is cleared only when
-- running, offline and fuel are all blank.
--
-- Requires STEP237 + STEP238. Safe to re-run.
-- ============================================================

-- drop the hour range checks (inline CHECKs have generated names)
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.golive_hours_readings'::regclass AND contype = 'c'
             AND (pg_get_constraintdef(oid) ILIKE '%running_hours%' OR pg_get_constraintdef(oid) ILIKE '%offline_hours%')
  LOOP
    EXECUTE format('ALTER TABLE golive_hours_readings DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- the comparison view depends on the column types: drop, alter, recreate (same as STEP237)
DROP VIEW IF EXISTS golive_hours_compare;

ALTER TABLE golive_hours_readings ALTER COLUMN running_hours DROP NOT NULL;
ALTER TABLE golive_hours_readings ALTER COLUMN running_hours TYPE NUMERIC(12,2);
ALTER TABLE golive_hours_readings ALTER COLUMN offline_hours TYPE NUMERIC(12,2);
ALTER TABLE golive_hours_readings ADD CONSTRAINT golive_hours_readings_running_nonneg CHECK (running_hours IS NULL OR running_hours >= 0);
ALTER TABLE golive_hours_readings ADD CONSTRAINT golive_hours_readings_offline_nonneg CHECK (offline_hours IS NULL OR offline_hours >= 0);

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
GRANT SELECT ON public.golive_hours_compare TO authenticated;

CREATE OR REPLACE FUNCTION golive_set_check_hours(p_enrollment UUID, p_date DATE, p_source TEXT, p_running NUMERIC,
                                                  p_offline NUMERIC DEFAULT NULL, p_fuel NUMERIC DEFAULT NULL)
RETURNS VOID AS $$
DECLARE e RECORD; g golive_engagements;
BEGIN
  SELECT * INTO e FROM golive_enrollments WHERE id = p_enrollment AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Device is not enrolled in this engagement'; END IF;
  SELECT * INTO g FROM golive_engagements WHERE id = e.engagement_id AND organization_id = current_org_id() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Engagement not found'; END IF;
  IF p_source NOT IN ('MANUAL','IOT') THEN RAISE EXCEPTION 'Source must be MANUAL or IOT'; END IF;
  IF p_date IS NULL OR p_date > golive_ist_today() THEN RAISE EXCEPTION 'Hours can only be entered for today or earlier'; END IF;
  IF NOT golive_is_admin() THEN
    IF p_source = 'MANUAL' AND NOT golive_has_role(g.id, 'FIRMWARE_ENGINEER') THEN
      RAISE EXCEPTION 'Only a firmware engineer on this engagement can enter manual log hours';
    END IF;
    IF p_source = 'IOT' AND NOT golive_has_role(g.id, 'APPLICATION_ENGINEER') THEN
      RAISE EXCEPTION 'Only an application engineer on this engagement can enter IoT hours';
    END IF;
  END IF;

  IF p_running IS NULL AND p_offline IS NULL AND p_fuel IS NULL THEN
    UPDATE golive_hours_readings SET deleted_at = now(), updated_at = now()
    WHERE enrollment_id = p_enrollment AND reading_date = p_date AND source = p_source AND deleted_at IS NULL;
  ELSE
    IF p_running < 0 THEN RAISE EXCEPTION 'Running hours cannot be negative'; END IF;
    IF p_offline < 0 THEN RAISE EXCEPTION 'Offline hours cannot be negative'; END IF;
    IF p_fuel < 0 THEN RAISE EXCEPTION 'Fuel consumed cannot be negative'; END IF;
    INSERT INTO golive_hours_readings (organization_id, engagement_id, enrollment_id, reading_date, source, running_hours, offline_hours, fuel_litres, equipment_ref, created_by)
    VALUES (g.organization_id, g.id, p_enrollment, p_date, p_source, p_running, p_offline, p_fuel, e.equipment_id, auth.uid())
    ON CONFLICT (enrollment_id, reading_date, source) WHERE deleted_at IS NULL
    DO UPDATE SET running_hours = EXCLUDED.running_hours, offline_hours = EXCLUDED.offline_hours, fuel_litres = EXCLUDED.fuel_litres,
                  upload_id = NULL, updated_at = now();
  END IF;

  INSERT INTO golive_events (organization_id, engagement_id, entity, entity_id, event_type, summary, changes, actor_id)
  VALUES (g.organization_id, g.id, 'hours', p_enrollment, 'hours_entered',
          CASE p_source WHEN 'MANUAL' THEN 'Manual log' ELSE 'IoT' END || ' hours ' || p_date || ': ' || COALESCE(p_running::text, CASE WHEN p_offline IS NULL AND p_fuel IS NULL THEN 'cleared' ELSE '—' END),
          jsonb_build_object('running', p_running, 'offline', p_offline, 'fuel', p_fuel, 'source', p_source), auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION golive_set_check_hours(UUID, DATE, TEXT, NUMERIC, NUMERIC, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';
