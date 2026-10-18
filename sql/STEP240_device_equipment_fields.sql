-- ============================================================
-- STEP240: Equipment ID, name + category on the device master.
--
-- device_instances gains the machine the device is fitted to:
--   equipment_id        the client's asset / equipment code, e.g. COMP-01, DT-12
--                       (the ID used in the client's hours report)
--   equipment_name      e.g. "Air Compressor 1", "Dumper Truck #12"
--   equipment_category  e.g. Compressor, Pump, Dumper — the same grouping
--                       Go-Live uses for category-wise hours and tolerance
-- All three are set from the Register / Edit Device form and from Device
-- Instances → Import from Excel (which now also updates existing devices,
-- matched by device_code then serial_number, so Export → edit → Import
-- round-trips). Enrolling a device into a go-live engagement copies them
-- onto the enrollment (golive_enrollments.equipment_id / _name / _category),
-- where they can still be overridden per engagement.
--
-- Plain nullable TEXT columns, no backfill. Safe to re-run.
-- ============================================================

ALTER TABLE device_instances ADD COLUMN IF NOT EXISTS equipment_id TEXT;
ALTER TABLE device_instances ADD COLUMN IF NOT EXISTS equipment_name TEXT;
ALTER TABLE device_instances ADD COLUMN IF NOT EXISTS equipment_category TEXT;

NOTIFY pgrst, 'reload schema';
