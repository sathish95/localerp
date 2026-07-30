-- ============================================================
-- STEP58: Fix component_vendors.vendor_id — STEP57 originally created it
-- as a plain UUID with no FK. src/lib/componentVendors.js's getVendorMap()
-- and getAllVendorMaps() rely on PostgREST's embed syntax
-- (vendor:vendors(id,name,...)), which requires that real FK to exist —
-- without it PostgREST returns PGRST200 "no relationship found between
-- 'component_vendors' and 'vendors'". Same class of fix as STEP53 for
-- product_bom_versions.created_by.
--
-- Run this once against any database that already ran STEP57 before this
-- fix landed. Safe to skip on a fresh install where STEP57 already
-- includes the REFERENCES clause.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'component_vendors_vendor_id_fkey'
  ) THEN
    ALTER TABLE component_vendors
      ADD CONSTRAINT component_vendors_vendor_id_fkey
      FOREIGN KEY (vendor_id) REFERENCES vendors(id);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
