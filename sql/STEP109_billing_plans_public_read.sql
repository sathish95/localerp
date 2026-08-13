-- ============================================================
-- STEP109: Widen billing_plans SELECT to anonymous visitors.
--
-- The public landing page (src/pages/LandingPage.jsx) is getting a
-- pricing section that reads the real plan catalog (free/starter/pro/
-- enterprise from STEP107) so marketing copy never drifts out of sync
-- with what Settings -> Billing / Super Admin actually offer. But
-- billing_plans_select (STEP107) requires auth.uid() IS NOT NULL, and a
-- landing-page visitor is by definition not signed in yet.
--
-- Plan name/price/seat-limit/features are public marketing information
-- by nature (that's the whole point of a pricing page) — nothing in
-- billing_plans is per-organization or otherwise sensitive, unlike
-- organizations/profiles/billing_upgrade_requests which stay behind
-- auth.uid() IS NOT NULL or narrower.
-- ============================================================

DROP POLICY IF EXISTS billing_plans_select ON billing_plans;
CREATE POLICY billing_plans_select ON billing_plans FOR SELECT USING (true);
GRANT SELECT ON public.billing_plans TO anon;

NOTIFY pgrst, 'reload schema';
