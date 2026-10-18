-- ============================================================
-- STEP249: Daily-result rules — parameters, sensors, severity.
--
-- golive_compute_daily_result() (STEP235) now also returns:
--   ATTENTION   when any application-review parameter is NOT_WORKING
--               (parameter_checks, STEP239), or a sensor fitted on the device
--               is FAULTY (device_sensors, STEP243). Operation = No (OFFLINE)
--               stays ATTENTION as before.
--   INCOMPLETE  while the parameter checklist hasn't been saved
--               (parameter_checks IS NULL) — imported checks are exempt.
-- The function reads device_sensors, so it becomes STABLE (was IMMUTABLE).
--
-- golive_daily_checks.attention_severity  HIGH / MEDIUM / LOW. Required
-- whenever a check's result is ATTENTION (not for imports or automatic
-- re-evaluation); a HIGH attention can't be waived — it needs an incident.
--
-- Marking a sensor Faulty (or back to Active) re-evaluates today's check for
-- that device straight away.
--
-- Requires STEP239 and STEP243. Safe to re-run.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.device_sensors') IS NULL THEN
    RAISE EXCEPTION 'STEP249 needs STEP243 — run sql/STEP243_device_sensors.sql first';
  END IF;
END $$;

ALTER TABLE golive_daily_checks ADD COLUMN IF NOT EXISTS attention_severity TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golive_daily_checks_attention_severity_chk') THEN
    ALTER TABLE golive_daily_checks ADD CONSTRAINT golive_daily_checks_attention_severity_chk CHECK (attention_severity IN ('HIGH','MEDIUM','LOW'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION golive_compute_daily_result(c golive_daily_checks) RETURNS TEXT AS $$
BEGIN
  IF c.check_date IS NULL THEN RETURN 'INCOMPLETE'; END IF;
  IF c.power_check = 'FAIL' OR c.cable_indicator_check = 'FAIL'
     OR c.connectivity IN ('OFFLINE','INTERMITTENT')
     OR c.firmware_health = 'FAIL' OR c.application_health = 'FAIL' OR c.data_quality = 'FAIL'
     -- STEP249: a parameter not working, or a faulty sensor on the device
     OR EXISTS (SELECT 1 FROM jsonb_each_text(COALESCE(c.parameter_checks, '{}'::jsonb)) x WHERE x.value = 'NOT_WORKING')
     OR EXISTS (SELECT 1 FROM golive_enrollments e JOIN device_sensors s ON s.device_id = e.device_id
                WHERE e.id = c.enrollment_id AND s.status = 'FAULTY') THEN
    RETURN 'ATTENTION';
  END IF;
  IF NULLIF(trim(c.site_snapshot), '') IS NULL
     OR (c.onsite_coordinator_user_id IS NULL AND NULLIF(trim(c.onsite_coordinator_legacy), '') IS NULL)
     OR c.power_check IS NULL OR c.cable_indicator_check IS NULL OR c.connectivity IS NULL
     OR c.last_data_received_at IS NULL
     OR c.firmware_health IS NULL
     OR (c.firmware_reviewer_user_id IS NULL AND NULLIF(trim(c.firmware_reviewer_legacy), '') IS NULL)
     OR c.application_health IS NULL
     OR (c.application_reviewer_user_id IS NULL AND NULLIF(trim(c.application_reviewer_legacy), '') IS NULL)
     OR c.data_quality IS NULL
     OR 'NOT_CHECKED' IN (c.power_check, c.cable_indicator_check, c.connectivity, c.firmware_health, c.application_health, c.data_quality)
     -- STEP249: the parameter checklist is mandatory (imports exempt)
     OR (c.parameter_checks IS NULL AND c.import_batch_id IS NULL) THEN
    RETURN 'INCOMPLETE';
  END IF;
  RETURN 'HEALTHY';
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- Severity: required on ATTENTION; HIGH can't be waived. Runs after
-- golive_daily_checks_before (trigger names fire in alphabetical order), so
-- NEW.daily_result is already computed.
CREATE OR REPLACE FUNCTION golive_check_severity() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.daily_result IS DISTINCT FROM 'ATTENTION' THEN RETURN NEW; END IF;
  IF NEW.import_batch_id IS NULL AND current_setting('golive.recompute', true) IS DISTINCT FROM 'on' THEN
    IF NEW.attention_severity IS NULL THEN
      RAISE EXCEPTION 'This check needs attention — set the severity (High / Medium / Low) before saving';
    END IF;
    IF NEW.attention_severity = 'HIGH' AND NULLIF(trim(NEW.attention_waiver_reason), '') IS NOT NULL THEN
      RAISE EXCEPTION 'High-severity attention needs an incident — it can''t be waived';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
DROP TRIGGER IF EXISTS golive_daily_checks_severity ON golive_daily_checks;
CREATE TRIGGER golive_daily_checks_severity BEFORE INSERT OR UPDATE ON golive_daily_checks
  FOR EACH ROW EXECUTE FUNCTION golive_check_severity();

-- A sensor turning Faulty (or back) re-evaluates today's check for its device.
CREATE OR REPLACE FUNCTION device_sensors_recheck_today() RETURNS TRIGGER AS $$
DECLARE v_dev UUID := COALESCE(NEW.device_id, OLD.device_id);
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
  PERFORM set_config('golive.recompute', 'on', true);
  UPDATE golive_daily_checks k SET updated_at = now()
  FROM golive_enrollments e
  WHERE e.id = k.enrollment_id AND e.device_id = v_dev AND k.deleted_at IS NULL AND k.check_date = golive_ist_today();
  PERFORM set_config('golive.recompute', 'off', true);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS device_sensors_recheck_today ON device_sensors;
CREATE TRIGGER device_sensors_recheck_today AFTER INSERT OR DELETE OR UPDATE OF status ON device_sensors
  FOR EACH ROW EXECUTE FUNCTION device_sensors_recheck_today();

NOTIFY pgrst, 'reload schema';
