-- ============================================================
-- STEP67: Fix final_ratings RLS — managers couldn't lock their own
-- direct report's rating.
--
-- STEP66 restricted final_ratings writes to is_hr_admin_ceo() only, but
-- TeamReviewsPage's "Lock Final Rating (no calibration needed)" button is
-- meant for ANY reviewer (including a plain manager/department_head) to
-- finalize their own direct report's rating when the cycle doesn't
-- require calibration — that path would have failed with a silent RLS
-- permission error for every non-HR manager.
--
-- Idempotent: safe to run whether or not STEP66 has already been applied
-- (this policy is now also fixed at the source in STEP66 itself, for
-- anyone running the full script fresh).
-- ============================================================

DROP POLICY IF EXISTS final_ratings_write ON final_ratings;
CREATE POLICY final_ratings_write ON final_ratings FOR ALL
  USING (is_manager_of(employee_id) OR is_hr_admin_ceo())
  WITH CHECK (is_manager_of(employee_id) OR is_hr_admin_ceo());

NOTIFY pgrst, 'reload schema';
