-- ============================================================
-- STEP241: Keep equipment ID / name / category in sync between the
-- device master (Device Instances) and Go-Live enrollments.
--
-- Until now the three fields were copied onto an enrollment only when the
-- device was enrolled, so a later edit or Excel import in Device Instances
-- never reached Go-Live (Devices tab, Daily Checks). Now:
--
--   Device Instances → Go-Live   a change on device_instances is written to
--                                every live enrollment of that device (not
--                                unenrolled, engagement not CLOSED/CANCELLED)
--   Go-Live → Device Instances   a change on an enrollment (edit form or the
--                                Devices-tab Excel upload) is written back to
--                                the device master, and from there to the
--                                device's other live enrollments
--
-- Only the columns that actually changed are copied, and every write is
-- guarded by IS DISTINCT FROM, so the two triggers settle after one hop
-- (no loop). Enrollment updates go through the normal triggers: version is
-- bumped (an open edit form gets a conflict instead of overwriting) and the
-- change lands in the engagement timeline.
--
-- A blank category on an enrollment still defaults to the product's device
-- type (STEP237); that default is then written back to the master too.
--
-- The one-time backfill at the bottom brings existing data in line:
-- master values win where the master has one; where the master is blank
-- and an enrollment has a value, the enrollment's value fills the master.
--
-- Requires STEP235, STEP237 and STEP240. Safe to re-run.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.golive_enrollments') IS NULL THEN
    RAISE EXCEPTION 'STEP241 needs STEP235 — run sql/STEP235_golive_support.sql first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'golive_enrollments' AND column_name = 'equipment_name') THEN
    RAISE EXCEPTION 'STEP241 needs STEP237 — run sql/STEP237_golive_hours_and_reports.sql first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'device_instances' AND column_name = 'equipment_id') THEN
    RAISE EXCEPTION 'STEP241 needs STEP240 — run sql/STEP240_device_equipment_fields.sql first';
  END IF;
END $$;

/* ═══ Device Instances → Go-Live ═══ */

CREATE OR REPLACE FUNCTION golive_equipment_from_master() RETURNS TRIGGER AS $$
DECLARE
  c_id BOOLEAN := NEW.equipment_id IS DISTINCT FROM OLD.equipment_id;
  c_name BOOLEAN := NEW.equipment_name IS DISTINCT FROM OLD.equipment_name;
  c_cat BOOLEAN := NEW.equipment_category IS DISTINCT FROM OLD.equipment_category;
BEGIN
  IF NOT (c_id OR c_name OR c_cat) THEN RETURN NULL; END IF;
  UPDATE golive_enrollments e SET
    equipment_id = CASE WHEN c_id THEN NEW.equipment_id ELSE e.equipment_id END,
    equipment_name = CASE WHEN c_name THEN NEW.equipment_name ELSE e.equipment_name END,
    equipment_category = CASE WHEN c_cat THEN NEW.equipment_category ELSE e.equipment_category END
  FROM golive_engagements g
  WHERE e.device_id = NEW.id AND e.deleted_at IS NULL AND e.unenrolled_at IS NULL
    AND g.id = e.engagement_id AND g.status NOT IN ('CLOSED','CANCELLED')
    AND ((c_id AND e.equipment_id IS DISTINCT FROM NEW.equipment_id)
      OR (c_name AND e.equipment_name IS DISTINCT FROM NEW.equipment_name)
      OR (c_cat AND e.equipment_category IS DISTINCT FROM NEW.equipment_category));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS device_instances_golive_equipment ON device_instances;
CREATE TRIGGER device_instances_golive_equipment AFTER UPDATE OF equipment_id, equipment_name, equipment_category ON device_instances
  FOR EACH ROW EXECUTE FUNCTION golive_equipment_from_master();

/* ═══ Go-Live → Device Instances ═══ */

CREATE OR REPLACE FUNCTION golive_equipment_to_master() RETURNS TRIGGER AS $$
DECLARE
  c_id BOOLEAN := NEW.equipment_id IS DISTINCT FROM OLD.equipment_id;
  c_name BOOLEAN := NEW.equipment_name IS DISTINCT FROM OLD.equipment_name;
  c_cat BOOLEAN := NEW.equipment_category IS DISTINCT FROM OLD.equipment_category;
BEGIN
  IF NOT (c_id OR c_name OR c_cat) OR NEW.deleted_at IS NOT NULL OR NEW.unenrolled_at IS NOT NULL THEN RETURN NULL; END IF;
  UPDATE device_instances d SET
    equipment_id = CASE WHEN c_id THEN NEW.equipment_id ELSE d.equipment_id END,
    equipment_name = CASE WHEN c_name THEN NEW.equipment_name ELSE d.equipment_name END,
    equipment_category = CASE WHEN c_cat THEN NEW.equipment_category ELSE d.equipment_category END
  WHERE d.id = NEW.device_id
    AND ((c_id AND d.equipment_id IS DISTINCT FROM NEW.equipment_id)
      OR (c_name AND d.equipment_name IS DISTINCT FROM NEW.equipment_name)
      OR (c_cat AND d.equipment_category IS DISTINCT FROM NEW.equipment_category));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS golive_enrollments_equipment_to_master ON golive_enrollments;
CREATE TRIGGER golive_enrollments_equipment_to_master AFTER UPDATE OF equipment_id, equipment_name, equipment_category ON golive_enrollments
  FOR EACH ROW EXECUTE FUNCTION golive_equipment_to_master();

/* ═══ One-time backfill ═══ */

-- 1. blanks on the master filled from its most recently updated live enrollment
WITH src AS (
  SELECT DISTINCT ON (e.device_id) e.device_id, e.equipment_id, e.equipment_name, e.equipment_category
  FROM golive_enrollments e JOIN golive_engagements g ON g.id = e.engagement_id
  WHERE e.deleted_at IS NULL AND e.unenrolled_at IS NULL AND g.status NOT IN ('CLOSED','CANCELLED')
  ORDER BY e.device_id, e.updated_at DESC NULLS LAST
)
UPDATE device_instances d SET
  equipment_id = COALESCE(NULLIF(trim(d.equipment_id), ''), src.equipment_id),
  equipment_name = COALESCE(NULLIF(trim(d.equipment_name), ''), src.equipment_name),
  equipment_category = COALESCE(NULLIF(trim(d.equipment_category), ''), src.equipment_category)
FROM src
WHERE d.id = src.device_id
  AND ((NULLIF(trim(d.equipment_id), '') IS NULL AND src.equipment_id IS NOT NULL)
    OR (NULLIF(trim(d.equipment_name), '') IS NULL AND src.equipment_name IS NOT NULL)
    OR (NULLIF(trim(d.equipment_category), '') IS NULL AND src.equipment_category IS NOT NULL));
-- (that UPDATE fires the master → Go-Live trigger, which aligns the other enrollments)

-- 2. master values onto every live enrollment that differs
UPDATE golive_enrollments e SET
  equipment_id = COALESCE(d.equipment_id, e.equipment_id),
  equipment_name = COALESCE(d.equipment_name, e.equipment_name),
  equipment_category = COALESCE(d.equipment_category, e.equipment_category)
FROM device_instances d, golive_engagements g
WHERE d.id = e.device_id AND g.id = e.engagement_id
  AND e.deleted_at IS NULL AND e.unenrolled_at IS NULL AND g.status NOT IN ('CLOSED','CANCELLED')
  AND ((d.equipment_id IS NOT NULL AND e.equipment_id IS DISTINCT FROM d.equipment_id)
    OR (d.equipment_name IS NOT NULL AND e.equipment_name IS DISTINCT FROM d.equipment_name)
    OR (d.equipment_category IS NOT NULL AND e.equipment_category IS DISTINCT FROM d.equipment_category));

NOTIFY pgrst, 'reload schema';
