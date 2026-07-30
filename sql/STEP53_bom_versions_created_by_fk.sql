-- ============================================================
-- STEP53: Fix product_bom_versions.created_by — STEP52 created it as a
-- plain UUID with no FK. Every other "who did this" column in this app
-- (requested_by, recorded_by, moved_by, etc.) has a real
-- REFERENCES profiles(id) constraint, and src/lib/bom.js's
-- getVersionsForProduct() relies on PostgREST's embed syntax
-- (profiles!created_by(full_name)), which requires that real FK to exist
-- — without it PostgREST returns PGRST200 "no relationship found".
--
-- Run this once against any database that already ran STEP52 before this
-- fix landed. Safe to skip on a fresh install where STEP52 already
-- includes the REFERENCES clause.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_bom_versions_created_by_fkey'
  ) THEN
    ALTER TABLE product_bom_versions
      ADD CONSTRAINT product_bom_versions_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES profiles(id);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
