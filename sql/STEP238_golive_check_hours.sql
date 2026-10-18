-- ============================================================
-- STEP238: Hours entered inside the daily check.
--
-- The daily check now carries the day's hours per device:
--   firmware section    → manual log hours   (source MANUAL)
--   application section → IoT / application hours (source IOT), plus the
--                         day's fuel consumed (litres); average fuel
--                         consumption (L/h) = fuel ÷ IoT running hours
-- They are stored in golive_hours_readings (STEP237), the same table file
-- uploads and the IoT API write to, so the comparison view, mismatch
-- tasks and shared reports all see one set of numbers.
--
-- golive_set_check_hours() enforces the same section rights as the check
-- trigger: manual log hours by a firmware engineer, IoT hours by an
-- application engineer (admins always). p_running NULL clears the value.
--
-- Requires STEP237. Safe to re-run.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.golive_hours_readings') IS NULL THEN
    RAISE EXCEPTION 'STEP238 needs STEP237 — run sql/STEP237_golive_hours_and_reports.sql first';
  END IF;
  -- the fuel columns on the comparison view come from the latest STEP237;
  -- without them fuel is saved but never read back (and a later save blanks it)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'golive_hours_compare' AND column_name = 'iot_fuel_litres') THEN
    RAISE EXCEPTION 'Re-run the latest sql/STEP237_golive_hours_and_reports.sql first (it adds fuel to the hours comparison), then run STEP238 again';
  END IF;
END $$;

-- fuel column also added by STEP237; repeated so either order works
ALTER TABLE golive_hours_readings ADD COLUMN IF NOT EXISTS fuel_litres NUMERIC(10,2);

-- earlier 5-argument version (without fuel)
DROP FUNCTION IF EXISTS golive_set_check_hours(UUID, DATE, TEXT, NUMERIC, NUMERIC);

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

  IF p_running IS NULL THEN
    UPDATE golive_hours_readings SET deleted_at = now(), updated_at = now()
    WHERE enrollment_id = p_enrollment AND reading_date = p_date AND source = p_source AND deleted_at IS NULL;
  ELSE
    IF p_running < 0 OR p_running > 24 THEN RAISE EXCEPTION 'Running hours must be between 0 and 24'; END IF;
    IF p_offline IS NOT NULL AND (p_offline < 0 OR p_offline > 24) THEN RAISE EXCEPTION 'Offline hours must be between 0 and 24'; END IF;
    IF p_offline IS NOT NULL AND p_running + p_offline > 24.01 THEN RAISE EXCEPTION 'Running + offline hours is more than 24'; END IF;
    IF p_fuel IS NOT NULL AND p_fuel < 0 THEN RAISE EXCEPTION 'Fuel consumed cannot be negative'; END IF;
    INSERT INTO golive_hours_readings (organization_id, engagement_id, enrollment_id, reading_date, source, running_hours, offline_hours, fuel_litres, equipment_ref, created_by)
    VALUES (g.organization_id, g.id, p_enrollment, p_date, p_source, p_running, p_offline, p_fuel, e.equipment_id, auth.uid())
    ON CONFLICT (enrollment_id, reading_date, source) WHERE deleted_at IS NULL
    DO UPDATE SET running_hours = EXCLUDED.running_hours, offline_hours = EXCLUDED.offline_hours, fuel_litres = EXCLUDED.fuel_litres,
                  upload_id = NULL, updated_at = now();
  END IF;

  INSERT INTO golive_events (organization_id, engagement_id, entity, entity_id, event_type, summary, changes, actor_id)
  VALUES (g.organization_id, g.id, 'hours', p_enrollment, 'hours_entered',
          CASE p_source WHEN 'MANUAL' THEN 'Manual log' ELSE 'IoT' END || ' hours ' || p_date || ': ' || COALESCE(p_running::text, 'cleared'),
          jsonb_build_object('running', p_running, 'offline', p_offline, 'fuel', p_fuel, 'source', p_source), auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION golive_set_check_hours(UUID, DATE, TEXT, NUMERIC, NUMERIC, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';
