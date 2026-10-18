-- ============================================================
-- OPS (one-off): set Equipment Category by Equipment ID (53 equipment).
-- Run the three parts in order in the Supabase SQL Editor; check each result.
--
-- Matches device_instances.equipment_id; when the device master has no
-- equipment ID but a live go-live enrollment does, that enrollment's device
-- is matched instead. Writing the category on the device master:
--   * syncs it to the device's live go-live enrollments (STEP241 / STEP242)
--   * fits that category's default sensors, if any are set up in the Sensor
--     catalog for the new category name (STEP243) — none are removed
-- ============================================================

-- ── 1. Match check — NOT FOUND rows are skipped by step 3
WITH src(equipment_id, category) AS (VALUES
  ('4100460', 'Diesel Generator Set'),
  ('4600055', 'Pick & Carry Crane'),
  ('3100357', 'Concrete Pump Stationary'),
  ('3100374', 'Concrete Placer Boom'),
  ('3100458', 'Concrete Placer Boom'),
  ('3100491', 'Concrete Pump Stationary'),
  ('3100733', 'Concrete Pump Stationary'),
  ('3100751', 'Concrete Pump Stationary'),
  ('3100940', 'Concrete Placer Boom'),
  ('3300189', 'Pilling Hammer - Hyd'),
  ('3300249', 'Hydraul Pilling Rig'),
  ('3300323', 'Hydraul Pilling Rig'),
  ('3300415', 'Hydraul Pilling Rig'),
  ('3300424', 'Hydraul Pilling Rig'),
  ('3702054', 'Air Compressor'),
  ('3705955', 'Air Compressor'),
  ('3705956', 'Air Compressor'),
  ('3706000', 'Air Compressor'),
  ('3800060', 'Tipper/Dumper'),
  ('3800061', 'Tipper/Dumper'),
  ('3800062', 'Tipper/Dumper'),
  ('3800063', 'Tipper/Dumper'),
  ('3800064', 'Tipper/Dumper'),
  ('3800065', 'Tipper/Dumper'),
  ('3800066', 'Tipper/Dumper'),
  ('3800067', 'Tipper/Dumper'),
  ('3800068', 'Tipper/Dumper'),
  ('3800069', 'Tipper/Dumper'),
  ('4100040', 'Diesel Generator Set'),
  ('4100154', 'Diesel Generator Set'),
  ('4100200', 'Diesel Generator Set'),
  ('4100201', 'Diesel Generator Set'),
  ('4100224', 'Diesel Generator Set'),
  ('4100318', 'Diesel Generator Set'),
  ('4100620', 'Diesel Generator Set'),
  ('4600036', 'Crane Tyr Mntd - Hyd'),
  ('4600068', 'Crawler Crane - Hyd'),
  ('4600143', 'Crawler Crane - Hyd'),
  ('4600246', 'Crawler Crane - Hyd'),
  ('4600292', 'Crane Tyr Mntd - Hyd'),
  ('4600318', 'Crawler Crane - Hyd'),
  ('4700122', 'Excavator'),
  ('4700136', 'Excavator'),
  ('4700137', 'Excavator'),
  ('4700142', 'Excavator'),
  ('4700143', 'Excavator'),
  ('4700064', 'Motor grader'),
  ('4600293', 'Pick & Carry Crane'),
  ('4700044', 'Backhoe Loader/Loadr'),
  ('4100389', 'Diesel Generator Set'),
  ('4100388', 'Diesel Generator Set'),
  ('4600094', 'Pick & Carry Crane'),
  ('4600306', 'Truck Loader Crane')
),
hit AS (
  SELECT s.equipment_id, s.category, d.id AS device_id
  FROM src s
  LEFT JOIN LATERAL (
    SELECT d.id FROM device_instances d WHERE trim(d.equipment_id) = s.equipment_id
    UNION
    SELECT e.device_id FROM golive_enrollments e WHERE trim(e.equipment_id) = s.equipment_id AND e.deleted_at IS NULL AND e.unenrolled_at IS NULL
  ) d ON true
)
SELECT h.equipment_id, COALESCE(d.device_code, 'NOT FOUND') AS device, d.equipment_name,
       d.equipment_category AS current_category, h.category AS new_category,
       CASE WHEN d.id IS NULL THEN 'not found' WHEN d.equipment_category IS NOT DISTINCT FROM h.category THEN 'no change' ELSE 'will update' END AS action,
       p.name AS project
FROM hit h
LEFT JOIN device_instances d ON d.id = h.device_id
LEFT JOIN projects p ON p.id = d.project_id
ORDER BY (d.id IS NULL) DESC, h.category, h.equipment_id;

-- ── 2. Summary per category (how many will change)
WITH src(equipment_id, category) AS (VALUES
  ('4100460', 'Diesel Generator Set'),
  ('4600055', 'Pick & Carry Crane'),
  ('3100357', 'Concrete Pump Stationary'),
  ('3100374', 'Concrete Placer Boom'),
  ('3100458', 'Concrete Placer Boom'),
  ('3100491', 'Concrete Pump Stationary'),
  ('3100733', 'Concrete Pump Stationary'),
  ('3100751', 'Concrete Pump Stationary'),
  ('3100940', 'Concrete Placer Boom'),
  ('3300189', 'Pilling Hammer - Hyd'),
  ('3300249', 'Hydraul Pilling Rig'),
  ('3300323', 'Hydraul Pilling Rig'),
  ('3300415', 'Hydraul Pilling Rig'),
  ('3300424', 'Hydraul Pilling Rig'),
  ('3702054', 'Air Compressor'),
  ('3705955', 'Air Compressor'),
  ('3705956', 'Air Compressor'),
  ('3706000', 'Air Compressor'),
  ('3800060', 'Tipper/Dumper'),
  ('3800061', 'Tipper/Dumper'),
  ('3800062', 'Tipper/Dumper'),
  ('3800063', 'Tipper/Dumper'),
  ('3800064', 'Tipper/Dumper'),
  ('3800065', 'Tipper/Dumper'),
  ('3800066', 'Tipper/Dumper'),
  ('3800067', 'Tipper/Dumper'),
  ('3800068', 'Tipper/Dumper'),
  ('3800069', 'Tipper/Dumper'),
  ('4100040', 'Diesel Generator Set'),
  ('4100154', 'Diesel Generator Set'),
  ('4100200', 'Diesel Generator Set'),
  ('4100201', 'Diesel Generator Set'),
  ('4100224', 'Diesel Generator Set'),
  ('4100318', 'Diesel Generator Set'),
  ('4100620', 'Diesel Generator Set'),
  ('4600036', 'Crane Tyr Mntd - Hyd'),
  ('4600068', 'Crawler Crane - Hyd'),
  ('4600143', 'Crawler Crane - Hyd'),
  ('4600246', 'Crawler Crane - Hyd'),
  ('4600292', 'Crane Tyr Mntd - Hyd'),
  ('4600318', 'Crawler Crane - Hyd'),
  ('4700122', 'Excavator'),
  ('4700136', 'Excavator'),
  ('4700137', 'Excavator'),
  ('4700142', 'Excavator'),
  ('4700143', 'Excavator'),
  ('4700064', 'Motor grader'),
  ('4600293', 'Pick & Carry Crane'),
  ('4700044', 'Backhoe Loader/Loadr'),
  ('4100389', 'Diesel Generator Set'),
  ('4100388', 'Diesel Generator Set'),
  ('4600094', 'Pick & Carry Crane'),
  ('4600306', 'Truck Loader Crane')
),
hit AS (
  SELECT s.equipment_id, s.category, d.id AS device_id
  FROM src s
  LEFT JOIN LATERAL (
    SELECT d.id FROM device_instances d WHERE trim(d.equipment_id) = s.equipment_id
    UNION
    SELECT e.device_id FROM golive_enrollments e WHERE trim(e.equipment_id) = s.equipment_id AND e.deleted_at IS NULL AND e.unenrolled_at IS NULL
  ) d ON true
)
SELECT h.category, count(*) AS in_list, count(h.device_id) AS found,
       count(*) FILTER (WHERE d.id IS NOT NULL AND d.equipment_category IS DISTINCT FROM h.category) AS will_update
FROM hit h LEFT JOIN device_instances d ON d.id = h.device_id
GROUP BY h.category ORDER BY h.category;

-- ── 3. Apply (run only after checking 1 and 2)
WITH src(equipment_id, category) AS (VALUES
  ('4100460', 'Diesel Generator Set'),
  ('4600055', 'Pick & Carry Crane'),
  ('3100357', 'Concrete Pump Stationary'),
  ('3100374', 'Concrete Placer Boom'),
  ('3100458', 'Concrete Placer Boom'),
  ('3100491', 'Concrete Pump Stationary'),
  ('3100733', 'Concrete Pump Stationary'),
  ('3100751', 'Concrete Pump Stationary'),
  ('3100940', 'Concrete Placer Boom'),
  ('3300189', 'Pilling Hammer - Hyd'),
  ('3300249', 'Hydraul Pilling Rig'),
  ('3300323', 'Hydraul Pilling Rig'),
  ('3300415', 'Hydraul Pilling Rig'),
  ('3300424', 'Hydraul Pilling Rig'),
  ('3702054', 'Air Compressor'),
  ('3705955', 'Air Compressor'),
  ('3705956', 'Air Compressor'),
  ('3706000', 'Air Compressor'),
  ('3800060', 'Tipper/Dumper'),
  ('3800061', 'Tipper/Dumper'),
  ('3800062', 'Tipper/Dumper'),
  ('3800063', 'Tipper/Dumper'),
  ('3800064', 'Tipper/Dumper'),
  ('3800065', 'Tipper/Dumper'),
  ('3800066', 'Tipper/Dumper'),
  ('3800067', 'Tipper/Dumper'),
  ('3800068', 'Tipper/Dumper'),
  ('3800069', 'Tipper/Dumper'),
  ('4100040', 'Diesel Generator Set'),
  ('4100154', 'Diesel Generator Set'),
  ('4100200', 'Diesel Generator Set'),
  ('4100201', 'Diesel Generator Set'),
  ('4100224', 'Diesel Generator Set'),
  ('4100318', 'Diesel Generator Set'),
  ('4100620', 'Diesel Generator Set'),
  ('4600036', 'Crane Tyr Mntd - Hyd'),
  ('4600068', 'Crawler Crane - Hyd'),
  ('4600143', 'Crawler Crane - Hyd'),
  ('4600246', 'Crawler Crane - Hyd'),
  ('4600292', 'Crane Tyr Mntd - Hyd'),
  ('4600318', 'Crawler Crane - Hyd'),
  ('4700122', 'Excavator'),
  ('4700136', 'Excavator'),
  ('4700137', 'Excavator'),
  ('4700142', 'Excavator'),
  ('4700143', 'Excavator'),
  ('4700064', 'Motor grader'),
  ('4600293', 'Pick & Carry Crane'),
  ('4700044', 'Backhoe Loader/Loadr'),
  ('4100389', 'Diesel Generator Set'),
  ('4100388', 'Diesel Generator Set'),
  ('4600094', 'Pick & Carry Crane'),
  ('4600306', 'Truck Loader Crane')
),
hit AS (
  SELECT DISTINCT s.equipment_id, s.category, d.id AS device_id
  FROM src s
  JOIN LATERAL (
    SELECT d.id FROM device_instances d WHERE trim(d.equipment_id) = s.equipment_id
    UNION
    SELECT e.device_id FROM golive_enrollments e WHERE trim(e.equipment_id) = s.equipment_id AND e.deleted_at IS NULL AND e.unenrolled_at IS NULL
  ) d ON true
)
UPDATE device_instances d
SET equipment_category = h.category,
    equipment_id = COALESCE(NULLIF(trim(d.equipment_id), ''), h.equipment_id)   -- fills a blank master equipment ID from the list
FROM hit h
WHERE d.id = h.device_id
  AND (d.equipment_category IS DISTINCT FROM h.category OR NULLIF(trim(d.equipment_id), '') IS NULL)
RETURNING d.device_code, d.equipment_id, d.equipment_category;
