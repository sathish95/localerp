-- ============================================================
-- STEP243: Sensor mapping per device.
--
-- sensor_types                 the sensor catalog (Fuel level probe,
--                              Coolant temperature sensor, …). parameter_key
--                              ties a sensor to the application-review
--                              checklist parameter it produces (STEP239 keys,
--                              e.g. fuel_level, engine_coolant_temperature).
-- equipment_sensor_defaults    the default sensor set per equipment category
--                              (Dumper → fuel level, coolant temp, oil
--                              pressure, …).
-- device_sensors               the sensors fitted to each device: type,
--                              optional serial number / position, own status
--                              ACTIVE / FAULTY / REMOVED, source DEFAULT or
--                              MANUAL.
--
-- Defaults are applied automatically — when a device gets (or changes to)
-- an equipment category, and when a default is added to a category — but
-- only sensor types the device doesn't have yet; nothing is removed.
-- Users can add more sensors to any device, or remove defaults.
--
-- device_sensor_status (view) adds the live status: the sensor's own status
-- when FAULTY / REMOVED, otherwise the latest daily-check result for its
-- parameter (WORKING / NOT_WORKING / NA), or NOT_REVIEWED.
--
-- Requires STEP235 (daily checks), STEP239 (parameter checklist) and
-- STEP240 (equipment category on the device master). Safe to re-run.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'device_instances' AND column_name = 'equipment_category') THEN
    RAISE EXCEPTION 'STEP243 needs STEP240 — run sql/STEP240_device_equipment_fields.sql first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'golive_daily_checks' AND column_name = 'parameter_checks') THEN
    RAISE EXCEPTION 'STEP243 needs STEP239 — run sql/STEP239_golive_parameter_checks.sql first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sensor_types (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  name            TEXT        NOT NULL,
  parameter_key   TEXT,                        -- checklist parameter this sensor produces
  unit            TEXT,
  part_number     TEXT,                        -- soft ref → products.part_number (the sensor hardware), optional
  description     TEXT,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_by      UUID        DEFAULT auth.uid(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sensor_types_name_uq ON sensor_types (organization_id, lower(name));

CREATE TABLE IF NOT EXISTS equipment_sensor_defaults (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id    UUID        NOT NULL DEFAULT current_org_id(),
  equipment_category TEXT        NOT NULL,
  sensor_type_id     UUID        NOT NULL REFERENCES sensor_types(id) ON DELETE CASCADE,
  created_by         UUID        DEFAULT auth.uid(),
  created_at         TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_sensor_defaults_uq ON equipment_sensor_defaults (organization_id, lower(equipment_category), sensor_type_id);

CREATE TABLE IF NOT EXISTS device_sensors (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  device_id       UUID        NOT NULL,        -- soft ref → device_instances
  sensor_type_id  UUID        NOT NULL REFERENCES sensor_types(id) ON DELETE CASCADE,
  serial_number   TEXT,
  position        TEXT,                        -- e.g. "Tank 1", "Front axle"
  status          TEXT        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','FAULTY','REMOVED')),
  source          TEXT        NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('DEFAULT','MANUAL')),
  installed_at    DATE,
  removed_at      DATE,
  notes           TEXT,
  created_by      UUID        DEFAULT auth.uid(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS device_sensors_device ON device_sensors (device_id) WHERE status <> 'REMOVED';

CREATE OR REPLACE FUNCTION device_sensors_before() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status = 'REMOVED' AND NEW.removed_at IS NULL THEN NEW.removed_at := (now() AT TIME ZONE 'Asia/Kolkata')::date; END IF;
  IF NEW.status <> 'REMOVED' THEN NEW.removed_at := NULL; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS device_sensors_before ON device_sensors;
CREATE TRIGGER device_sensors_before BEFORE INSERT OR UPDATE ON device_sensors FOR EACH ROW EXECUTE FUNCTION device_sensors_before();

/* ═══ Applying the default sensor set ═══ */

-- Adds the category's default sensor types a device doesn't have yet (in any
-- non-removed row). Returns the number of sensors added.
CREATE OR REPLACE FUNCTION apply_default_sensors(p_device_ids UUID[]) RETURNS INT AS $$
DECLARE v_n INT;
BEGIN
  INSERT INTO device_sensors (organization_id, device_id, sensor_type_id, source, installed_at)
  SELECT d.organization_id, d.id, sd.sensor_type_id, 'DEFAULT', d.installed_date
  FROM device_instances d
  JOIN equipment_sensor_defaults sd ON sd.organization_id = d.organization_id AND lower(sd.equipment_category) = lower(trim(d.equipment_category))
  JOIN sensor_types st ON st.id = sd.sensor_type_id AND st.is_active
  WHERE d.id = ANY(p_device_ids) AND d.organization_id = current_org_id()
    AND NOT EXISTS (SELECT 1 FROM device_sensors ds WHERE ds.device_id = d.id AND ds.sensor_type_id = sd.sensor_type_id AND ds.status <> 'REMOVED');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION apply_default_sensors(UUID[]) TO authenticated;

-- a device getting (or changing) its equipment category picks up that category's defaults
CREATE OR REPLACE FUNCTION device_instances_default_sensors() RETURNS TRIGGER AS $$
BEGIN
  IF NULLIF(trim(NEW.equipment_category), '') IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND lower(trim(NEW.equipment_category)) IS NOT DISTINCT FROM lower(trim(OLD.equipment_category)) THEN RETURN NULL; END IF;
  INSERT INTO device_sensors (organization_id, device_id, sensor_type_id, source, installed_at)
  SELECT NEW.organization_id, NEW.id, sd.sensor_type_id, 'DEFAULT', NEW.installed_date
  FROM equipment_sensor_defaults sd JOIN sensor_types st ON st.id = sd.sensor_type_id AND st.is_active
  WHERE sd.organization_id = NEW.organization_id AND lower(sd.equipment_category) = lower(trim(NEW.equipment_category))
    AND NOT EXISTS (SELECT 1 FROM device_sensors ds WHERE ds.device_id = NEW.id AND ds.sensor_type_id = sd.sensor_type_id AND ds.status <> 'REMOVED');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS device_instances_default_sensors ON device_instances;
CREATE TRIGGER device_instances_default_sensors AFTER INSERT OR UPDATE OF equipment_category ON device_instances
  FOR EACH ROW EXECUTE FUNCTION device_instances_default_sensors();

-- a new default for a category reaches every device already in that category
CREATE OR REPLACE FUNCTION equipment_sensor_defaults_apply() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO device_sensors (organization_id, device_id, sensor_type_id, source, installed_at)
  SELECT d.organization_id, d.id, NEW.sensor_type_id, 'DEFAULT', d.installed_date
  FROM device_instances d
  WHERE d.organization_id = NEW.organization_id AND lower(trim(d.equipment_category)) = lower(NEW.equipment_category)
    AND d.status <> 'decommissioned'
    AND NOT EXISTS (SELECT 1 FROM device_sensors ds WHERE ds.device_id = d.id AND ds.sensor_type_id = NEW.sensor_type_id AND ds.status <> 'REMOVED');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS equipment_sensor_defaults_apply ON equipment_sensor_defaults;
CREATE TRIGGER equipment_sensor_defaults_apply AFTER INSERT ON equipment_sensor_defaults
  FOR EACH ROW EXECUTE FUNCTION equipment_sensor_defaults_apply();

/* ═══ Live status ═══ */

-- Latest daily-check verdict for the sensor's parameter, across the
-- device's go-live enrollments.
CREATE OR REPLACE VIEW device_sensor_status WITH (security_invoker = true) AS
SELECT ds.id, ds.organization_id, ds.device_id, ds.sensor_type_id, st.name AS sensor_name, st.parameter_key, st.unit,
       ds.serial_number, ds.position, ds.status AS sensor_status, ds.source, ds.installed_at, ds.removed_at, ds.notes,
       lc.check_date AS last_check_date, lc.param_status AS last_param_status,
       CASE
         WHEN ds.status = 'REMOVED' THEN 'REMOVED'
         WHEN ds.status = 'FAULTY' THEN 'FAULTY'
         WHEN lc.param_status IS NOT NULL THEN lc.param_status
         ELSE 'NOT_REVIEWED'
       END AS health
FROM device_sensors ds
JOIN sensor_types st ON st.id = ds.sensor_type_id
LEFT JOIN LATERAL (
  SELECT k.check_date, k.parameter_checks ->> st.parameter_key AS param_status
  FROM golive_enrollments e JOIN golive_daily_checks k ON k.enrollment_id = e.id AND k.deleted_at IS NULL
  WHERE e.device_id = ds.device_id AND e.deleted_at IS NULL AND st.parameter_key IS NOT NULL
    AND k.parameter_checks ? st.parameter_key
  ORDER BY k.check_date DESC LIMIT 1
) lc ON true;

/* ═══ RLS ═══ */

ALTER TABLE sensor_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_sensor_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_sensors ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sensor_types','equipment_sensor_defaults','device_sensors'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_select ON %1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_write ON %1$s', t);
    EXECUTE format('CREATE POLICY %1$s_select ON %1$s FOR SELECT USING (organization_id = current_org_id())', t);
    EXECUTE format($p$CREATE POLICY %1$s_write ON %1$s FOR ALL USING (
      organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cto','manager','department_head','procurement_lead','pm','project_manager'))
    ) WITH CHECK (
      organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','cto','manager','department_head','procurement_lead','pm','project_manager'))
    )$p$, t);
  END LOOP;
END $$;

/* ═══ Starter catalog (from the application-review parameters) ═══ */

INSERT INTO sensor_types (organization_id, name, parameter_key, unit)
SELECT o.id, s.name, s.key, s.unit
FROM organizations o
CROSS JOIN (VALUES
  ('Fuel level sensor', 'fuel_level', 'ltr'),
  ('Engine coolant temperature sensor', 'engine_coolant_temperature', '°C'),
  ('Engine oil pressure sensor', 'engine_oil_pressure', 'kPa'),
  ('Engine oil temperature sensor', 'engine_oil_temperature', '°C'),
  ('Throttle position sensor', 'throttle_position', '%'),
  ('Engine load (CAN)', 'engine_load', '%'),
  ('Engine running status (ignition)', 'engine_running_status', 'ON / OFF'),
  ('Engine runtime (CAN hour meter)', 'engine_runtime', 'hours'),
  ('Hydraulic oil temperature sensor', 'hydraulic_oil_temperature', '°C')
) AS s(name, key, unit)
WHERE NOT EXISTS (SELECT 1 FROM sensor_types t WHERE t.organization_id = o.id AND lower(t.name) = lower(s.name));

NOTIFY pgrst, 'reload schema';
