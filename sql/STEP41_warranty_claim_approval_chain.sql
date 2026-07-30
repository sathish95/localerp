-- ============================================================
-- STEP41: Warranty Claim Approval Chain — Field Technician submits ->
-- PM approves -> CEO approves -> Finance approves.
--
-- STEP37 originally gave warranty_claims a single-step "Finance only"
-- review (finance_approved_by/at, plus an unused procurement_lead step
-- copied from STEP26's shape). This adds the two missing per-step
-- columns (pm, ceo) and widens the status CHECK to the chain's named
-- steps, matching src/lib/warrantyApproval.js's new fixed 3-step chain.
--
-- Claims below warranty_settings.claim_auto_approve_threshold still skip
-- the chain entirely (status goes straight to 'Approved') — only claims
-- at/above the threshold walk PM Review -> CEO Review -> Finance Review.
-- ============================================================

ALTER TABLE warranty_claims ADD COLUMN IF NOT EXISTS pm_approved_by  UUID REFERENCES profiles(id);
ALTER TABLE warranty_claims ADD COLUMN IF NOT EXISTS pm_approved_at  TIMESTAMPTZ;
ALTER TABLE warranty_claims ADD COLUMN IF NOT EXISTS ceo_approved_by UUID REFERENCES profiles(id);
ALTER TABLE warranty_claims ADD COLUMN IF NOT EXISTS ceo_approved_at TIMESTAMPTZ;

-- Widen status CHECK — keeps the old 'Under Review' value valid too, so
-- any claims already inserted under the previous single-step model don't
-- violate the constraint; new claims use the granular per-step names.
ALTER TABLE warranty_claims DROP CONSTRAINT IF EXISTS warranty_claims_status_check;
ALTER TABLE warranty_claims ADD CONSTRAINT warranty_claims_status_check CHECK (
  status IN ('Reported','Under Review','PM Review','CEO Review','Finance Review','Approved','Resolved','Rejected')
);

NOTIFY pgrst, 'reload schema';
