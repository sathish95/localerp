-- ============================================================
-- SEED_catalog_v2: Fresh demo data for the Product / Device / Component
-- scheme, meant to run right after STEP59_reset_catalog_data.sql empties
-- the catalog. Demonstrates the full linked model in one small, coherent
-- set: Components (bulk/consumable parts) -> assembled via BOM into
-- Products (serialized catalog entries) -> registered as individual
-- Devices (device_instances) -> optionally mapped to a Vendor.
--
-- Idempotent — safe to re-run: every insert is guarded so re-running this
-- script (with the same part numbers/serials already present) does nothing
-- rather than erroring or duplicating rows.
--
-- Vendor mapping is best-effort: it only inserts if at least one row
-- already exists in `vendors` (this script doesn't know your vendor
-- names, so it just picks by name order) — skipped silently otherwise.
-- ============================================================

-- ── 1. COMPONENTS (bulk/consumable — is_serialized = false) ──
INSERT INTO products (part_number, name, device_type, standard_cost, reorder_level, reorder_qty, is_serialized, status)
VALUES
  ('CMP-1001', 'Temperature Sensor Module', 'Sensors',      450, 20, 50, false, 'active'),
  ('CMP-1002', 'Enclosure — Standard',      'Enclosures',   320, 15, 30, false, 'active'),
  ('CMP-1003', 'Mounting Bracket Set',      'Hardware',      40, 50, 100, false, 'active'),
  ('CMP-1004', 'Power Adapter 5V 2A',       'Power',        180, 25, 50, false, 'active'),
  ('CMP-1005', 'GPS Module',                'Sensors',      620, 10, 25, false, 'active'),
  ('CMP-1006', 'Antenna — External',        'Connectivity',  95, 20, 40, false, 'active')
ON CONFLICT (part_number) DO NOTHING;

-- ── 2. PRODUCTS (finished goods, tracked as Devices — is_serialized = true) ──
INSERT INTO products (part_number, name, device_type, warranty_months, standard_cost, is_serialized, status)
VALUES
  ('PRD-2001', 'NeoX Temperature Logger', 'IoT Logger', 12, 970, true, 'active'),
  ('PRD-2002', 'NeoX Gateway Hub',        'Gateway',    24, 785, true, 'active')
ON CONFLICT (part_number) DO NOTHING;

-- ── 3. BOM — each Product's active version, built from Components above ──
DO $$
DECLARE
  v_creator UUID := (SELECT id FROM profiles WHERE role IN ('admin','ceo') ORDER BY created_at LIMIT 1);
  v_version_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM product_bom_versions WHERE part_number = 'PRD-2001') THEN
    INSERT INTO product_bom_versions (part_number, version_no, status, created_by, notes)
      VALUES ('PRD-2001', 1, 'active', v_creator, 'Seed BOM')
      RETURNING id INTO v_version_id;
    INSERT INTO product_bom_version_components (version_id, component_part_number, quantity) VALUES
      (v_version_id, 'CMP-1001', 1),
      (v_version_id, 'CMP-1002', 1),
      (v_version_id, 'CMP-1004', 1);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM product_bom_versions WHERE part_number = 'PRD-2002') THEN
    INSERT INTO product_bom_versions (part_number, version_no, status, created_by, notes)
      VALUES ('PRD-2002', 1, 'active', v_creator, 'Seed BOM')
      RETURNING id INTO v_version_id;
    INSERT INTO product_bom_version_components (version_id, component_part_number, quantity) VALUES
      (v_version_id, 'CMP-1002', 1),
      (v_version_id, 'CMP-1004', 1),
      (v_version_id, 'CMP-1005', 1),
      (v_version_id, 'CMP-1006', 2);
  END IF;
END $$;

-- ── 4. DEVICES — registered units of each Product ──
INSERT INTO device_instances (device_code, part_number, serial_number, status)
VALUES
  ('NEOX-TL-0001', 'PRD-2001', 'SN-TL-0001', 'deployed'),
  ('NEOX-TL-0002', 'PRD-2001', 'SN-TL-0002', 'deployed'),
  ('NEOX-TL-0003', 'PRD-2001', 'SN-TL-0003', 'in_storage'),
  ('NEOX-GW-0001', 'PRD-2002', 'SN-GW-0001', 'deployed'),
  ('NEOX-GW-0002', 'PRD-2002', 'SN-GW-0002', 'in_storage')
ON CONFLICT (serial_number) DO NOTHING;

-- ── 5. VENDOR MAPPING — best-effort, only if vendors already exist ──
-- Left un-preferred deliberately (is_preferred defaults to false): the
-- partial unique index only allows one preferred vendor per component, and
-- this script may run in a DB that already has a preferred vendor mapped —
-- mark one preferred yourself from the Components tab once this lands.
INSERT INTO component_vendors (part_number, vendor_id, unit_cost)
SELECT 'CMP-1001', v.id, 450 FROM vendors v ORDER BY v.name LIMIT 1
ON CONFLICT (part_number, vendor_id) DO NOTHING;

INSERT INTO component_vendors (part_number, vendor_id, unit_cost)
SELECT 'CMP-1002', v.id, 320 FROM vendors v ORDER BY v.name LIMIT 1
ON CONFLICT (part_number, vendor_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
