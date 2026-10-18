-- ============================================================
-- STEP254: Go-Live daily check — no mandatory fields.
--
--   * Severity on an ATTENTION check is optional (STEP249 required it).
--     High severity still can't be waived without an incident.
--   * The reason for editing a back-dated check is optional (STEP235 A7);
--     it's still stored when given.
--   * The parameter checklist is optional: an unreviewed checklist no
--     longer makes the day INCOMPLETE. A parameter marked Not working
--     still makes it ATTENTION.
--
-- golive_compute_daily_result() and goLiveRules.js computeDailyResult()
-- must match — run node --test src/lib/goLiveRules.test.mjs.
--
-- Requires STEP239, STEP249, STEP250. Safe to re-run.
-- ============================================================

DO $$
BEGIN
  IF to_regprocedure('golive_check_severity()') IS NULL THEN
    RAISE EXCEPTION 'STEP254 needs STEP249/250 — run sql/STEP249_golive_result_rules.sql and STEP250 first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION golive_compute_daily_result(c golive_daily_checks) RETURNS TEXT AS $$
BEGIN
  IF c.check_date IS NULL THEN RETURN 'INCOMPLETE'; END IF;
  IF c.power_check = 'FAIL' OR c.cable_indicator_check = 'FAIL'
     OR (c.connectivity IN ('OFFLINE','INTERMITTENT') AND NOT COALESCE(c.equipment_maintenance, false))
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
     OR 'NOT_CHECKED' IN (c.power_check, c.cable_indicator_check, c.connectivity, c.firmware_health, c.application_health, c.data_quality) THEN
     -- STEP254: the parameter checklist is optional (no longer makes the day INCOMPLETE)
    RETURN 'INCOMPLETE';
  END IF;
  RETURN 'HEALTHY';
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION golive_check_severity() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.daily_result IS DISTINCT FROM 'ATTENTION' THEN RETURN NEW; END IF;
  IF NEW.import_batch_id IS NULL AND current_setting('golive.recompute', true) IS DISTINCT FROM 'on' THEN
    IF NEW.attention_severity = 'HIGH' AND NULLIF(trim(NEW.attention_waiver_reason), '') IS NOT NULL THEN
      RAISE EXCEPTION 'High-severity attention needs an incident — it can''t be waived';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION golive_check_before() RETURNS TRIGGER AS $$
DECLARE
  e RECORD; g RECORD;
  v_onsite BOOLEAN; v_fw BOOLEAN; v_app BOOLEAN;
  v_is_import BOOLEAN := NEW.import_batch_id IS NOT NULL;
  v_uid UUID := auth.uid();
BEGIN
  SELECT * INTO e FROM golive_enrollments WHERE id = NEW.enrollment_id;
  IF NOT FOUND OR e.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Device is not enrolled in this engagement'; END IF;
  SELECT * INTO g FROM golive_engagements WHERE id = e.engagement_id;
  NEW.engagement_id := e.engagement_id;

  IF TG_OP = 'INSERT' AND NOT v_is_import THEN
    IF NEW.check_date > golive_ist_today() THEN RAISE EXCEPTION 'Check date cannot be in the future'; END IF;
    IF e.support_status = 'DECOMMISSIONED' OR e.unenrolled_at IS NOT NULL THEN
      RAISE EXCEPTION 'Device is decommissioned / unenrolled — no new checks';
    END IF;
    IF g.status NOT IN ('ACTIVE','EXIT_REVIEW') THEN
      RAISE EXCEPTION 'Checks can only be logged while the engagement is active';
    END IF;
  END IF;

  -- §3.4 snapshots so history doesn't shift with the master
  IF TG_OP = 'INSERT' THEN
    NEW.site_snapshot := COALESCE(NULLIF(trim(NEW.site_snapshot), ''), e.site);
    NEW.equipment_snapshot := COALESCE(NULLIF(trim(NEW.equipment_snapshot), ''), e.equipment_id);
    NEW.firmware_version_snapshot := COALESCE(NEW.firmware_version_snapshot, e.firmware_version);
  END IF;

  -- A7 (STEP254): the reason for a back-dated edit is optional — stored when given

  v_onsite := CASE WHEN TG_OP = 'INSERT' THEN
      COALESCE(NEW.power_check, NEW.cable_indicator_check, NEW.connectivity) IS NOT NULL OR NEW.last_data_received_at IS NOT NULL
      OR NEW.onsite_coordinator_user_id IS NOT NULL OR NEW.evidence <> '[]'::jsonb
    ELSE
      (NEW.power_check, NEW.cable_indicator_check, NEW.connectivity, NEW.last_data_received_at, NEW.onsite_coordinator_user_id, NEW.site_snapshot, NEW.equipment_snapshot, NEW.evidence)
      IS DISTINCT FROM (OLD.power_check, OLD.cable_indicator_check, OLD.connectivity, OLD.last_data_received_at, OLD.onsite_coordinator_user_id, OLD.site_snapshot, OLD.equipment_snapshot, OLD.evidence)
    END;
  v_fw := CASE WHEN TG_OP = 'INSERT' THEN NEW.firmware_health IS NOT NULL OR NEW.firmware_reviewer_user_id IS NOT NULL
    ELSE (NEW.firmware_health, NEW.firmware_reviewer_user_id) IS DISTINCT FROM (OLD.firmware_health, OLD.firmware_reviewer_user_id) END;
  v_app := CASE WHEN TG_OP = 'INSERT' THEN NEW.application_health IS NOT NULL OR NEW.application_reviewer_user_id IS NOT NULL OR NEW.data_quality IS NOT NULL
      OR NEW.parameter_checks IS NOT NULL
    ELSE (NEW.application_health, NEW.application_reviewer_user_id, NEW.data_quality, NEW.parameter_checks)
      IS DISTINCT FROM (OLD.application_health, OLD.application_reviewer_user_id, OLD.data_quality, OLD.parameter_checks) END;

  -- STEP239: parameter checklist values
  IF NEW.parameter_checks IS NOT NULL THEN
    IF jsonb_typeof(NEW.parameter_checks) <> 'object' THEN RAISE EXCEPTION 'Parameter checks must be an object of parameter → status'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each(NEW.parameter_checks) x
               WHERE jsonb_typeof(x.value) <> 'string' OR x.value #>> '{}' NOT IN ('WORKING','NOT_WORKING','NA')) THEN
      RAISE EXCEPTION 'Parameter status must be Working, Not working or N/A';
    END IF;
  END IF;

  -- §11 section permissions (admins always; imports and system jobs skip)
  IF NOT v_is_import AND v_uid IS NOT NULL AND NOT golive_is_admin() THEN
    IF v_onsite AND NOT (golive_has_role(e.engagement_id, 'ONSITE_COORDINATOR') OR golive_can_manage(e.engagement_id)) THEN
      RAISE EXCEPTION 'Only the onsite coordinator or PM can fill the onsite section';
    END IF;
    IF v_fw AND NOT golive_has_role(e.engagement_id, 'FIRMWARE_ENGINEER') THEN
      RAISE EXCEPTION 'Only a firmware engineer on this engagement can complete the firmware review';
    END IF;
    IF v_app AND NOT golive_has_role(e.engagement_id, 'APPLICATION_ENGINEER') THEN
      RAISE EXCEPTION 'Only an application engineer on this engagement can complete the application review';
    END IF;
  END IF;

  IF v_onsite AND NOT v_is_import THEN NEW.onsite_submitted_by := v_uid; NEW.onsite_submitted_at := now(); END IF;
  IF v_fw AND NOT v_is_import THEN NEW.firmware_submitted_by := v_uid; NEW.firmware_submitted_at := now(); END IF;
  IF v_app AND NOT v_is_import THEN NEW.application_submitted_by := v_uid; NEW.application_submitted_at := now(); END IF;

  NEW.data_gap_minutes := CASE WHEN NEW.last_data_received_at IS NULL THEN NULL
    ELSE GREATEST(0, floor(extract(epoch FROM (COALESCE(NEW.onsite_submitted_at, now()) - NEW.last_data_received_at)) / 60))::int END;

  NEW.daily_result := golive_compute_daily_result(NEW);
  NEW.result_computed_at := now();
  NEW.reviewed_complete_at := CASE
    WHEN NEW.firmware_health IS NOT NULL AND NEW.application_health IS NOT NULL
     AND (NEW.firmware_reviewer_user_id IS NOT NULL OR NEW.firmware_reviewer_legacy IS NOT NULL)
     AND (NEW.application_reviewer_user_id IS NOT NULL OR NEW.application_reviewer_legacy IS NOT NULL)
    THEN COALESCE(CASE WHEN TG_OP = 'UPDATE' THEN OLD.reviewed_complete_at END, now()) END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS golive_daily_checks_before ON golive_daily_checks;
CREATE TRIGGER golive_daily_checks_before BEFORE INSERT OR UPDATE ON golive_daily_checks
  FOR EACH ROW EXECUTE FUNCTION golive_check_before();

-- re-evaluate saved checks so days left INCOMPLETE only by the checklist update
-- (golive.recompute skips the severity trigger, as for sensor rechecks)
SELECT set_config('golive.recompute', 'on', false);
UPDATE golive_daily_checks c SET daily_result = golive_compute_daily_result(c), result_computed_at = now()
WHERE c.deleted_at IS NULL AND c.daily_result = 'INCOMPLETE' AND golive_compute_daily_result(c) <> 'INCOMPLETE';
SELECT set_config('golive.recompute', 'off', false);

NOTIFY pgrst, 'reload schema';
