-- ============================================================
-- STEP242: Firmware version management (per product).
--
-- product_firmware_versions   the release list for each product
--                             (part number): version, release date,
--                             status CURRENT / SUPPORTED / DEPRECATED,
--                             release notes. One CURRENT per product —
--                             marking a release current demotes the old
--                             one to SUPPORTED.
-- device_instances.firmware_version
--                             the firmware on the device itself. It is
--                             picked from the product's release list in
--                             Device Instances and in Go-Live, and kept in
--                             sync with golive_enrollments.firmware_version
--                             both ways (STEP241's triggers, extended here
--                             to cover firmware). Firmware changes on an
--                             enrollment already land in the engagement
--                             timeline, so upgrades have a history.
--
-- Requires STEP241. Safe to re-run.
-- ============================================================

DO $$
BEGIN
  IF to_regprocedure('golive_equipment_from_master()') IS NULL THEN
    RAISE EXCEPTION 'STEP242 needs STEP241 — run sql/STEP241_golive_equipment_sync.sql first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS product_firmware_versions (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  part_number     TEXT        NOT NULL,          -- soft ref → products.part_number
  version         TEXT        NOT NULL,
  release_date    DATE,
  status          TEXT        NOT NULL DEFAULT 'SUPPORTED' CHECK (status IN ('CURRENT','SUPPORTED','DEPRECATED')),
  release_notes   TEXT,
  created_by      UUID        DEFAULT auth.uid(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_firmware_versions_uq ON product_firmware_versions (organization_id, part_number, version);
CREATE UNIQUE INDEX IF NOT EXISTS product_firmware_versions_current ON product_firmware_versions (organization_id, part_number) WHERE status = 'CURRENT';

CREATE OR REPLACE FUNCTION product_firmware_before() RETURNS TRIGGER AS $$
BEGIN
  NEW.version := trim(NEW.version);
  IF NEW.version = '' THEN RAISE EXCEPTION 'Firmware version is required'; END IF;
  NEW.updated_at := now();
  -- one CURRENT release per product: the previous one becomes SUPPORTED
  IF NEW.status = 'CURRENT' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'CURRENT') THEN
    UPDATE product_firmware_versions SET status = 'SUPPORTED', updated_at = now()
    WHERE organization_id = NEW.organization_id AND part_number = NEW.part_number AND status = 'CURRENT' AND id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS product_firmware_versions_before ON product_firmware_versions;
CREATE TRIGGER product_firmware_versions_before BEFORE INSERT OR UPDATE ON product_firmware_versions
  FOR EACH ROW EXECUTE FUNCTION product_firmware_before();

ALTER TABLE product_firmware_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_firmware_select ON product_firmware_versions;
DROP POLICY IF EXISTS product_firmware_write ON product_firmware_versions;
CREATE POLICY product_firmware_select ON product_firmware_versions FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY product_firmware_write ON product_firmware_versions FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cto','manager','department_head','procurement_lead','pm','project_manager'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cto','manager','department_head','procurement_lead','pm','project_manager'))
);

/* ═══ Firmware on the device master, synced with Go-Live ═══ */

ALTER TABLE device_instances ADD COLUMN IF NOT EXISTS firmware_version TEXT;

CREATE OR REPLACE FUNCTION golive_equipment_from_master() RETURNS TRIGGER AS $$
DECLARE
  c_id BOOLEAN := NEW.equipment_id IS DISTINCT FROM OLD.equipment_id;
  c_name BOOLEAN := NEW.equipment_name IS DISTINCT FROM OLD.equipment_name;
  c_cat BOOLEAN := NEW.equipment_category IS DISTINCT FROM OLD.equipment_category;
  c_fw BOOLEAN := NEW.firmware_version IS DISTINCT FROM OLD.firmware_version;
BEGIN
  IF NOT (c_id OR c_name OR c_cat OR c_fw) THEN RETURN NULL; END IF;
  UPDATE golive_enrollments e SET
    equipment_id = CASE WHEN c_id THEN NEW.equipment_id ELSE e.equipment_id END,
    equipment_name = CASE WHEN c_name THEN NEW.equipment_name ELSE e.equipment_name END,
    equipment_category = CASE WHEN c_cat THEN NEW.equipment_category ELSE e.equipment_category END,
    firmware_version = CASE WHEN c_fw THEN NEW.firmware_version ELSE e.firmware_version END
  FROM golive_engagements g
  WHERE e.device_id = NEW.id AND e.deleted_at IS NULL AND e.unenrolled_at IS NULL
    AND g.id = e.engagement_id AND g.status NOT IN ('CLOSED','CANCELLED')
    AND ((c_id AND e.equipment_id IS DISTINCT FROM NEW.equipment_id)
      OR (c_name AND e.equipment_name IS DISTINCT FROM NEW.equipment_name)
      OR (c_cat AND e.equipment_category IS DISTINCT FROM NEW.equipment_category)
      OR (c_fw AND e.firmware_version IS DISTINCT FROM NEW.firmware_version));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS device_instances_golive_equipment ON device_instances;
CREATE TRIGGER device_instances_golive_equipment AFTER UPDATE OF equipment_id, equipment_name, equipment_category, firmware_version ON device_instances
  FOR EACH ROW EXECUTE FUNCTION golive_equipment_from_master();

CREATE OR REPLACE FUNCTION golive_equipment_to_master() RETURNS TRIGGER AS $$
DECLARE
  c_id BOOLEAN := NEW.equipment_id IS DISTINCT FROM OLD.equipment_id;
  c_name BOOLEAN := NEW.equipment_name IS DISTINCT FROM OLD.equipment_name;
  c_cat BOOLEAN := NEW.equipment_category IS DISTINCT FROM OLD.equipment_category;
  c_fw BOOLEAN := NEW.firmware_version IS DISTINCT FROM OLD.firmware_version;
BEGIN
  IF NOT (c_id OR c_name OR c_cat OR c_fw) OR NEW.deleted_at IS NOT NULL OR NEW.unenrolled_at IS NOT NULL THEN RETURN NULL; END IF;
  UPDATE device_instances d SET
    equipment_id = CASE WHEN c_id THEN NEW.equipment_id ELSE d.equipment_id END,
    equipment_name = CASE WHEN c_name THEN NEW.equipment_name ELSE d.equipment_name END,
    equipment_category = CASE WHEN c_cat THEN NEW.equipment_category ELSE d.equipment_category END,
    firmware_version = CASE WHEN c_fw THEN NEW.firmware_version ELSE d.firmware_version END
  WHERE d.id = NEW.device_id
    AND ((c_id AND d.equipment_id IS DISTINCT FROM NEW.equipment_id)
      OR (c_name AND d.equipment_name IS DISTINCT FROM NEW.equipment_name)
      OR (c_cat AND d.equipment_category IS DISTINCT FROM NEW.equipment_category)
      OR (c_fw AND d.firmware_version IS DISTINCT FROM NEW.firmware_version));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS golive_enrollments_equipment_to_master ON golive_enrollments;
CREATE TRIGGER golive_enrollments_equipment_to_master AFTER UPDATE OF equipment_id, equipment_name, equipment_category, firmware_version ON golive_enrollments
  FOR EACH ROW EXECUTE FUNCTION golive_equipment_to_master();

-- backfill: the device master takes the firmware of its most recently updated live enrollment
WITH src AS (
  SELECT DISTINCT ON (e.device_id) e.device_id, e.firmware_version
  FROM golive_enrollments e JOIN golive_engagements g ON g.id = e.engagement_id
  WHERE e.deleted_at IS NULL AND e.unenrolled_at IS NULL AND g.status NOT IN ('CLOSED','CANCELLED') AND NULLIF(trim(e.firmware_version), '') IS NOT NULL
  ORDER BY e.device_id, e.updated_at DESC NULLS LAST
)
UPDATE device_instances d SET firmware_version = src.firmware_version
FROM src WHERE d.id = src.device_id AND NULLIF(trim(d.firmware_version), '') IS NULL;

-- seed each product's release list with the versions already in the field
INSERT INTO product_firmware_versions (organization_id, part_number, version, status)
SELECT DISTINCT d.organization_id, d.part_number, trim(d.firmware_version), 'SUPPORTED'
FROM device_instances d
WHERE d.part_number IS NOT NULL AND NULLIF(trim(d.firmware_version), '') IS NOT NULL
ON CONFLICT (organization_id, part_number, version) DO NOTHING;

NOTIFY pgrst, 'reload schema';
