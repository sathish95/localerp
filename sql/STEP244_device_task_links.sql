-- ============================================================
-- STEP244: Tasks linked to a device, and firmware upgrade tasks.
--
-- project_tasks.device_id        soft ref → device_instances. Any Task
--                                Management task can be tied to a device;
--                                the device's history (Device 360, Device
--                                Instances) lists these tasks with their live
--                                status.
-- project_tasks.device_task_kind 'FIRMWARE_UPGRADE' for an upgrade task
-- project_tasks.firmware_target_version
--                                the version the upgrade installs
--
-- When a FIRMWARE_UPGRADE task reaches a closed status (a status step with
-- is_closed in the task's department flow, or done/completed/closed when the
-- org has no flow for it), the device's firmware_version is set to the
-- target. STEP242's sync carries that to the live go-live enrollments, whose
-- audit trail records the change.
--
-- Go-Live hours-mismatch tasks created before this step are linked to their
-- device from golive_hours_actions.
--
-- Requires STEP242. Safe to re-run.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'device_instances' AND column_name = 'firmware_version') THEN
    RAISE EXCEPTION 'STEP244 needs STEP242 — run sql/STEP242_firmware_releases.sql first';
  END IF;
END $$;

ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS device_id UUID;               -- soft ref → device_instances
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS device_task_kind TEXT;        -- FIRMWARE_UPGRADE | NULL
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS firmware_target_version TEXT;
CREATE INDEX IF NOT EXISTS project_tasks_device_idx ON project_tasks (device_id) WHERE device_id IS NOT NULL;

-- true when the task's status is a closed step of its department's flow
CREATE OR REPLACE FUNCTION task_status_is_closed(p_org UUID, p_department UUID, p_status TEXT) RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT bool_or(s.is_closed) FROM department_status_steps s JOIN department_status_flows f ON f.id = s.flow_id
     WHERE f.organization_id = p_org AND s.status_key = p_status
       AND (f.department_id = p_department OR (f.department_id IS NULL AND p_department IS NULL))),
    lower(p_status) IN ('done','completed','closed'))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION project_tasks_firmware_upgrade() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.device_task_kind = 'FIRMWARE_UPGRADE' AND NEW.device_id IS NOT NULL AND NULLIF(trim(NEW.firmware_target_version), '') IS NOT NULL
     AND NEW.status IS DISTINCT FROM OLD.status
     AND task_status_is_closed(NEW.organization_id, NEW.department_id, NEW.status)
     AND NOT task_status_is_closed(NEW.organization_id, NEW.department_id, OLD.status) THEN
    UPDATE device_instances SET firmware_version = trim(NEW.firmware_target_version)
    WHERE id = NEW.device_id AND organization_id = NEW.organization_id
      AND firmware_version IS DISTINCT FROM trim(NEW.firmware_target_version);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS project_tasks_firmware_upgrade ON project_tasks;
CREATE TRIGGER project_tasks_firmware_upgrade AFTER UPDATE OF status ON project_tasks
  FOR EACH ROW EXECUTE FUNCTION project_tasks_firmware_upgrade();

-- link existing go-live hours-mismatch tasks to their device
UPDATE project_tasks t SET device_id = e.device_id
FROM golive_hours_actions a JOIN golive_enrollments e ON e.id = a.enrollment_id
WHERE a.task_id = t.id AND t.device_id IS NULL;

NOTIFY pgrst, 'reload schema';
