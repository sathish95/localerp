-- ============================================================
-- STEP246: Project hardware cost from the device register.
--
-- Until now a project's Hardware cost (project_hardware_costs) was only the
-- lines typed in with "Add HW", so devices assigned to the project in Device
-- Instances — and the sensors fitted on them — cost nothing anywhere that
-- reads project hardware (project KPIs and budget bar, ROI, spend analyzer).
--
-- Now each project gets automatic lines (source = 'DEVICE_REGISTER'):
--   one per device product    qty = devices with project_id = the project
--                             unit price = products.standard_cost
--   one per sensor type       qty = non-removed sensors fitted on those devices
--                             unit price = the sensor product's standard_cost,
--                             else sensor_types.unit_cost (new column)
-- cost_company = qty × unit price. cost_client / proposal_cost keep the
-- line's existing mark-up ratio (×1.3 / ×1.5 for a new line), so a margin
-- edited on the line survives resyncs. A unit price edited on the line sets
-- price_override and is kept; otherwise it follows the catalogue.
--
-- Kept in sync by triggers on device_instances, device_sensors, products and
-- sensor_types; sync_project_device_hardware(project) can also be called
-- directly. Manual lines are never touched — remove a manual line that
-- duplicates an automatic one.
--
-- Requires STEP243. Safe to re-run.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.device_sensors') IS NULL THEN
    RAISE EXCEPTION 'STEP246 needs STEP243 — run sql/STEP243_device_sensors.sql first';
  END IF;
END $$;

ALTER TABLE project_hardware_costs ADD COLUMN IF NOT EXISTS source TEXT;             -- NULL = manual, 'DEVICE_REGISTER' = automatic
ALTER TABLE project_hardware_costs ADD COLUMN IF NOT EXISTS source_key TEXT;         -- 'device:<part_number>' | 'sensor:<sensor_type_id>'
ALTER TABLE project_hardware_costs ADD COLUMN IF NOT EXISTS price_override BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS project_hardware_costs_register_uq
  ON project_hardware_costs (project_id, source_key) WHERE source = 'DEVICE_REGISTER';

ALTER TABLE sensor_types ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(14,2);

CREATE OR REPLACE FUNCTION sync_project_device_hardware(p_project UUID) RETURNS VOID AS $$
DECLARE
  v_org UUID; r RECORD; ex project_hardware_costs; v_unit NUMERIC; v_co NUMERIC; v_keys TEXT[] := '{}';
BEGIN
  IF p_project IS NULL THEN RETURN; END IF;
  SELECT organization_id INTO v_org FROM projects WHERE id = p_project;
  IF NOT FOUND THEN RETURN; END IF;

  FOR r IN
    -- devices, per product
    SELECT 'device:' || d.part_number AS key, 'device' AS category,
           COALESCE(p.name, d.part_number) || ' (' || d.part_number || ')' AS name,
           count(*)::numeric AS qty, COALESCE(p.standard_cost, 0) AS unit,
           'Auto from Device Instances: ' || count(*) || ' device(s)'
             || COALESCE(' — ' || string_agg(DISTINCT d.status, ', '), '')
             || CASE WHEN COALESCE(p.standard_cost, 0) = 0 THEN '. No standard cost on the product — set it in Products.' ELSE '' END AS notes
    FROM device_instances d LEFT JOIN products p ON p.part_number = d.part_number
    WHERE d.project_id = p_project AND d.part_number IS NOT NULL
    GROUP BY d.part_number, p.name, p.standard_cost
    UNION ALL
    -- sensors fitted on those devices, per sensor type
    SELECT 'sensor:' || st.id, 'sensor', st.name || COALESCE(' (' || st.part_number || ')', ''),
           count(*)::numeric, COALESCE(NULLIF(sp.standard_cost, 0), st.unit_cost, 0),
           'Auto from sensor mapping: fitted on ' || count(DISTINCT ds.device_id) || ' device(s)'
             || CASE WHEN COALESCE(NULLIF(sp.standard_cost, 0), st.unit_cost, 0) = 0 THEN '. No unit cost — set it in the Sensor catalog.' ELSE '' END
    FROM device_sensors ds
    JOIN device_instances d ON d.id = ds.device_id AND d.project_id = p_project
    JOIN sensor_types st ON st.id = ds.sensor_type_id
    LEFT JOIN products sp ON sp.part_number = st.part_number
    WHERE ds.status <> 'REMOVED'
    GROUP BY st.id, st.name, st.part_number, st.unit_cost, sp.standard_cost
  LOOP
    v_keys := v_keys || r.key;
    SELECT * INTO ex FROM project_hardware_costs WHERE project_id = p_project AND source = 'DEVICE_REGISTER' AND source_key = r.key;
    IF FOUND THEN
      v_unit := CASE WHEN ex.price_override THEN COALESCE(ex.unit_price, 0) ELSE r.unit END;
      v_co := round(r.qty * v_unit, 2);
      UPDATE project_hardware_costs SET
        name = r.name, category = r.category, qty = r.qty, unit_price = v_unit, total_price = v_co, cost_company = v_co,
        -- keep the line's mark-up
        cost_client = round(v_co * COALESCE(NULLIF(ex.cost_client, 0) / NULLIF(ex.cost_company, 0), 1.3), 2),
        proposal_cost = round(v_co * COALESCE(NULLIF(ex.proposal_cost, 0) / NULLIF(ex.cost_company, 0), 1.5), 2),
        notes = r.notes
      WHERE id = ex.id
        AND (qty, unit_price, cost_company, name, notes) IS DISTINCT FROM (r.qty, v_unit, v_co, r.name, r.notes);
    ELSE
      v_co := round(r.qty * r.unit, 2);
      INSERT INTO project_hardware_costs (organization_id, project_id, name, category, qty, unit_price, total_price, cost_company, cost_client, proposal_cost, notes, source, source_key)
      VALUES (v_org, p_project, r.name, r.category, r.qty, r.unit, v_co, v_co, round(v_co * 1.3, 2), round(v_co * 1.5, 2), r.notes, 'DEVICE_REGISTER', r.key);
    END IF;
  END LOOP;

  -- products / sensor types no longer on the project
  DELETE FROM project_hardware_costs
  WHERE project_id = p_project AND source = 'DEVICE_REGISTER' AND NOT (source_key = ANY(v_keys));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION sync_project_device_hardware(UUID) TO authenticated;

/* ═══ Keep it in sync ═══ */

CREATE OR REPLACE FUNCTION device_instances_project_hardware() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN PERFORM sync_project_device_hardware(OLD.project_id); END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND (TG_OP = 'INSERT' OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.part_number IS DISTINCT FROM OLD.part_number OR NEW.status IS DISTINCT FROM OLD.status) THEN
    PERFORM sync_project_device_hardware(NEW.project_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS device_instances_project_hardware ON device_instances;
CREATE TRIGGER device_instances_project_hardware AFTER INSERT OR DELETE OR UPDATE OF project_id, part_number, status ON device_instances
  FOR EACH ROW EXECUTE FUNCTION device_instances_project_hardware();

CREATE OR REPLACE FUNCTION device_sensors_project_hardware() RETURNS TRIGGER AS $$
DECLARE v_old UUID; v_new UUID;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN SELECT project_id INTO v_old FROM device_instances WHERE id = OLD.device_id; END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN SELECT project_id INTO v_new FROM device_instances WHERE id = NEW.device_id; END IF;
  PERFORM sync_project_device_hardware(v_new);
  IF v_old IS DISTINCT FROM v_new THEN PERFORM sync_project_device_hardware(v_old); END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS device_sensors_project_hardware ON device_sensors;
CREATE TRIGGER device_sensors_project_hardware AFTER INSERT OR DELETE OR UPDATE OF status, sensor_type_id, device_id ON device_sensors
  FOR EACH ROW EXECUTE FUNCTION device_sensors_project_hardware();

-- catalogue price / name changes reach every project using them
CREATE OR REPLACE FUNCTION products_project_hardware() RETURNS TRIGGER AS $$
DECLARE pid UUID;
BEGIN
  FOR pid IN
    SELECT DISTINCT d.project_id FROM device_instances d WHERE d.part_number = NEW.part_number AND d.project_id IS NOT NULL
    UNION
    SELECT DISTINCT d.project_id FROM device_sensors ds JOIN sensor_types st ON st.id = ds.sensor_type_id JOIN device_instances d ON d.id = ds.device_id
    WHERE st.part_number = NEW.part_number AND d.project_id IS NOT NULL
  LOOP PERFORM sync_project_device_hardware(pid); END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS products_project_hardware ON products;
CREATE TRIGGER products_project_hardware AFTER UPDATE OF standard_cost, name ON products
  FOR EACH ROW EXECUTE FUNCTION products_project_hardware();

CREATE OR REPLACE FUNCTION sensor_types_project_hardware() RETURNS TRIGGER AS $$
DECLARE pid UUID;
BEGIN
  FOR pid IN SELECT DISTINCT d.project_id FROM device_sensors ds JOIN device_instances d ON d.id = ds.device_id
             WHERE ds.sensor_type_id = NEW.id AND d.project_id IS NOT NULL
  LOOP PERFORM sync_project_device_hardware(pid); END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS sensor_types_project_hardware ON sensor_types;
CREATE TRIGGER sensor_types_project_hardware AFTER UPDATE OF unit_cost, part_number, name ON sensor_types
  FOR EACH ROW EXECUTE FUNCTION sensor_types_project_hardware();

/* ═══ Backfill every project that has devices ═══ */

DO $$
DECLARE pid UUID;
BEGIN
  FOR pid IN SELECT DISTINCT project_id FROM device_instances WHERE project_id IS NOT NULL LOOP
    PERFORM sync_project_device_hardware(pid);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
