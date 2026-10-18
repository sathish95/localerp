-- ============================================================
-- STEP251: Sensor type (kind) on the sensor catalog.
--
-- sensor_types.sensor_kind — Temperature, Pressure, Level, Position, Load,
-- Status, Runtime, Speed, Voltage / Current, Location, Other. Existing
-- sensor types are classified from their name / unit (editable in
-- Device Instances → Sensor catalog). device_sensor_status gains the column
-- (appended at the end, so the view is replaced in place).
--
-- Requires STEP243. Safe to re-run (a kind already set is never overwritten).
-- ============================================================

ALTER TABLE sensor_types ADD COLUMN IF NOT EXISTS sensor_kind TEXT;

UPDATE sensor_types SET sensor_kind = CASE
    WHEN name ILIKE '%temp%' OR unit IN ('°C','°F','C','F') THEN 'Temperature'
    WHEN name ILIKE '%pressure%' OR unit ILIKE ANY (ARRAY['kpa','bar','psi','mpa']) THEN 'Pressure'
    WHEN name ILIKE '%level%' OR name ILIKE '%fuel%' OR unit ILIKE ANY (ARRAY['ltr','l','litre%','liter%']) THEN 'Level'
    WHEN name ILIKE '%throttle%' OR name ILIKE '%position%' OR name ILIKE '%angle%' THEN 'Position'
    WHEN name ILIKE '%load%' OR name ILIKE '%weight%' THEN 'Load'
    WHEN name ILIKE '%runtime%' OR name ILIKE '%hour%' OR unit ILIKE 'hour%' THEN 'Runtime'
    WHEN name ILIKE '%status%' OR name ILIKE '%ignition%' OR name ILIKE '%running%' OR unit ILIKE '%on%off%' THEN 'Status'
    WHEN name ILIKE '%speed%' OR name ILIKE '%rpm%' OR unit ILIKE 'rpm' THEN 'Speed'
    WHEN name ILIKE '%volt%' OR name ILIKE '%current%' OR name ILIKE '%battery%' OR unit IN ('V','A','mA') THEN 'Voltage / Current'
    WHEN name ILIKE '%gps%' OR name ILIKE '%location%' THEN 'Location'
    ELSE 'Other' END
WHERE sensor_kind IS NULL;

CREATE OR REPLACE VIEW device_sensor_status WITH (security_invoker = true) AS
SELECT ds.id, ds.organization_id, ds.device_id, ds.sensor_type_id, st.name AS sensor_name, st.parameter_key, st.unit,
       ds.serial_number, ds.position, ds.status AS sensor_status, ds.source, ds.installed_at, ds.removed_at, ds.notes,
       lc.check_date AS last_check_date, lc.param_status AS last_param_status,
       CASE
         WHEN ds.status = 'REMOVED' THEN 'REMOVED'
         WHEN ds.status = 'FAULTY' THEN 'FAULTY'
         WHEN lc.param_status IS NOT NULL THEN lc.param_status
         ELSE 'NOT_REVIEWED'
       END AS health,
       st.sensor_kind
FROM device_sensors ds
JOIN sensor_types st ON st.id = ds.sensor_type_id
LEFT JOIN LATERAL (
  SELECT k.check_date, k.parameter_checks ->> st.parameter_key AS param_status
  FROM golive_enrollments e JOIN golive_daily_checks k ON k.enrollment_id = e.id AND k.deleted_at IS NULL
  WHERE e.device_id = ds.device_id AND e.deleted_at IS NULL AND st.parameter_key IS NOT NULL
    AND k.parameter_checks ? st.parameter_key
  ORDER BY k.check_date DESC LIMIT 1
) lc ON true;

NOTIFY pgrst, 'reload schema';
