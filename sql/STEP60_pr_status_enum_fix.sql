-- ============================================================
-- STEP60: Fix purchase_requisitions.status — it's a native Postgres ENUM
-- type (pr_status), not plain TEXT as STEP26's own comment assumed
-- ("purchase_requisitions.status stays free TEXT — no CHECK added").
-- That assumption was wrong for this database: the table/enum predate
-- this repo's sql/ migration folder (created directly in Supabase, like
-- purchase_orders and vendors), and the enum was never updated when the
-- app's multi-step approval chain (src/lib/procurementApproval.js) started
-- writing statuses like 'procurement_lead_review' — hence:
--
--   error: invalid input value for enum pr_status: "procurement_lead_review"
--
-- This adds every status value the procurement workflow actually writes.
-- Safe/idempotent — ADD VALUE IF NOT EXISTS (Postgres 12+) skips any label
-- that's already there.
--
-- IMPORTANT — run each ALTER TYPE line individually (select just that one
-- line and hit Run), not the whole file in one go. Postgres does not allow
-- "ALTER TYPE ... ADD VALUE" inside a multi-statement transaction block,
-- and Supabase's SQL editor sends a pasted script as one such block — you
-- will get "ALTER TYPE ... ADD VALUE cannot run inside a transaction
-- block" if you run them all together. Running the final NOTIFY together
-- with the last ALTER TYPE line is fine; it's only ADD VALUE statements
-- that can't share a transaction with each other.
-- ============================================================

ALTER TYPE pr_status ADD VALUE IF NOT EXISTS 'procurement_lead_review';
ALTER TYPE pr_status ADD VALUE IF NOT EXISTS 'pm_review';
ALTER TYPE pr_status ADD VALUE IF NOT EXISTS 'cto_review';
ALTER TYPE pr_status ADD VALUE IF NOT EXISTS 'finance_review';
ALTER TYPE pr_status ADD VALUE IF NOT EXISTS 'ceo_review';
ALTER TYPE pr_status ADD VALUE IF NOT EXISTS 'draft';
ALTER TYPE pr_status ADD VALUE IF NOT EXISTS 'approved';
ALTER TYPE pr_status ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE pr_status ADD VALUE IF NOT EXISTS 'cancelled';

NOTIFY pgrst, 'reload schema';
