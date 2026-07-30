-- ============================================================
-- STEP40: warranty_claims.device_warranty_id must be nullable.
--
-- A claim can legitimately be logged against a device that has NO
-- device_warranties record at all (never deployed, or Workflow A's
-- auto-creation never ran) — per spec this is still loggable as a
-- 'Rejected-Out of Warranty' claim for record-keeping, not blocked.
-- src/lib/warranty.js's createWarrantyClaim() already inserts
-- device_warranty_id: null for exactly this case; STEP37 originally
-- declared the column NOT NULL, which this corrects.
-- ============================================================

ALTER TABLE warranty_claims ALTER COLUMN device_warranty_id DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
