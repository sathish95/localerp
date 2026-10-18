-- ============================================================
-- OPS (one-off): remove temperature and pressure sensors from a list of
-- equipment. Run the three parts in order in the Supabase SQL Editor and
-- check each result before running the next.
--
-- The IDs are matched against device_instances.equipment_id, and also
-- device_code / serial_number in case some of them are device numbers.
-- A sensor counts as "temperature / pressure" when its sensor type name
-- contains "temperature" or "pressure".
--
-- Removing = status REMOVED (the device's history keeps it, it can be
-- re-fitted from the device view). Project hardware cost lines and today's
-- daily-check result update automatically (STEP246 / STEP249 triggers).
-- ============================================================

-- ── 1. Which IDs match which device — anything "NOT FOUND" needs checking first
WITH ids(ref) AS (VALUES
  ('3706000'),('4700044'),('4700064'),('4600068'),('4600246'),('4100040'),('4100620'),('3702054'),('3705955'),
  ('3705956'),('3100374'),('3100491'),('4700136'),('4600143'),('4600293'),('4100224'),('4100389'),('3300189'),('4600094')
)
SELECT i.ref,
       COALESCE(d.device_code, 'NOT FOUND') AS device, d.equipment_id, d.equipment_name, d.equipment_category,
       p.name AS project, d.current_location AS site,
       CASE WHEN d.id IS NULL THEN NULL WHEN trim(d.equipment_id) = i.ref THEN 'equipment_id'
            WHEN d.device_code = i.ref THEN 'device_code' ELSE 'serial_number' END AS matched_on
FROM ids i
LEFT JOIN device_instances d ON trim(d.equipment_id) = i.ref OR d.device_code = i.ref OR d.serial_number = i.ref
LEFT JOIN projects p ON p.id = d.project_id
ORDER BY d.id IS NULL DESC, i.ref;

-- ── 2. Preview: the sensors that will be removed
WITH ids(ref) AS (VALUES
  ('3706000'),('4700044'),('4700064'),('4600068'),('4600246'),('4100040'),('4100620'),('3702054'),('3705955'),
  ('3705956'),('3100374'),('3100491'),('4700136'),('4600143'),('4600293'),('4100224'),('4100389'),('3300189'),('4600094')
), dev AS (
  SELECT DISTINCT d.id, d.device_code, d.equipment_id FROM ids i
  JOIN device_instances d ON trim(d.equipment_id) = i.ref OR d.device_code = i.ref OR d.serial_number = i.ref
)
SELECT dev.equipment_id, dev.device_code, st.name AS sensor, ds.serial_number, ds.position, ds.status
FROM dev
JOIN device_sensors ds ON ds.device_id = dev.id AND ds.status <> 'REMOVED'
JOIN sensor_types st ON st.id = ds.sensor_type_id
WHERE st.name ILIKE '%temperature%' OR st.name ILIKE '%pressure%'
ORDER BY dev.equipment_id, st.name;

-- ── 3. Remove them (run only after checking 1 and 2)
WITH ids(ref) AS (VALUES
  ('3706000'),('4700044'),('4700064'),('4600068'),('4600246'),('4100040'),('4100620'),('3702054'),('3705955'),
  ('3705956'),('3100374'),('3100491'),('4700136'),('4600143'),('4600293'),('4100224'),('4100389'),('3300189'),('4600094')
), dev AS (
  SELECT DISTINCT d.id FROM ids i
  JOIN device_instances d ON trim(d.equipment_id) = i.ref OR d.device_code = i.ref OR d.serial_number = i.ref
)
UPDATE device_sensors ds SET status = 'REMOVED'
FROM sensor_types st
WHERE st.id = ds.sensor_type_id AND ds.device_id IN (SELECT id FROM dev) AND ds.status <> 'REMOVED'
  AND (st.name ILIKE '%temperature%' OR st.name ILIKE '%pressure%')
RETURNING ds.device_id, st.name AS removed_sensor;
