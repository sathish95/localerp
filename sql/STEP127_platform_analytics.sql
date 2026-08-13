-- ============================================================
-- STEP127: Platform-level analytics for the Super Admin dashboard —
-- organization counts by billing status, user counts, MRR/ARR, plan
-- distribution, and a per-org usage snapshot.
--
-- MRR is computed from real data (billing_plans.price_monthly for each
-- org currently on billing_status='active', plus org_bundle_monthly_
-- total() for their active à-la-carte module add-ons, STEP124) — not
-- estimated or faked. There is still no payment gateway wired up, so
-- this is what the org is CONFIGURED to owe, not a confirmed-collected
-- amount from a processor; that distinction matters once a real gateway
-- (Stripe/Razorpay/etc — a vendor decision, not made here) lands and
-- can report actual charges/failures.
--
-- Usage meters are scoped to what's ACTUALLY measurable today: seats,
-- employees, departments, awards granted, certificates issued. Storage/
-- AI-credit/API-call meters from the original spec are NOT included —
-- no instrumentation exists anywhere in this app to produce real numbers
-- for those, and fabricating placeholder figures would be worse than
-- omitting them.
-- ============================================================

CREATE OR REPLACE FUNCTION platform_dashboard_stats()
RETURNS TABLE (
  total_orgs BIGINT, active_orgs BIGINT, trial_orgs BIGINT, past_due_orgs BIGINT,
  canceled_orgs BIGINT, suspended_orgs BIGINT,
  total_users BIGINT, active_users BIGINT,
  mrr NUMERIC, arr NUMERIC
) AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  WITH org_mrr AS (
    SELECT o.id, COALESCE(bp.price_monthly, 0) + org_bundle_monthly_total(o.id) AS org_monthly
    FROM organizations o
    JOIN billing_plans bp ON bp.key = o.plan_key
    WHERE o.billing_status = 'active' AND o.deleted_at IS NULL
  )
  SELECT
    (SELECT count(*) FROM organizations WHERE deleted_at IS NULL),
    (SELECT count(*) FROM organizations WHERE billing_status = 'active' AND deleted_at IS NULL),
    (SELECT count(*) FROM organizations WHERE billing_status = 'trialing' AND deleted_at IS NULL),
    (SELECT count(*) FROM organizations WHERE billing_status = 'past_due' AND deleted_at IS NULL),
    (SELECT count(*) FROM organizations WHERE billing_status = 'canceled' AND deleted_at IS NULL),
    (SELECT count(*) FROM organizations WHERE is_active = false AND deleted_at IS NULL),
    (SELECT count(*) FROM profiles),
    (SELECT count(*) FROM profiles WHERE is_active = true),
    COALESCE((SELECT SUM(org_monthly) FROM org_mrr), 0),
    COALESCE((SELECT SUM(org_monthly) FROM org_mrr), 0) * 12;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION platform_dashboard_stats() TO authenticated;

CREATE OR REPLACE FUNCTION platform_plan_distribution()
RETURNS TABLE (plan_key TEXT, plan_name TEXT, org_count BIGINT) AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT bp.key, bp.name, count(o.id)
  FROM billing_plans bp
  LEFT JOIN organizations o ON o.plan_key = bp.key AND o.deleted_at IS NULL
  GROUP BY bp.key, bp.name, bp.sort_order
  ORDER BY bp.sort_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION platform_plan_distribution() TO authenticated;

CREATE OR REPLACE FUNCTION super_admin_org_usage(p_org_id UUID)
RETURNS TABLE (
  seat_count BIGINT, seat_limit INT, department_count BIGINT,
  awards_granted BIGINT, certificates_issued BIGINT, active_bundle_count BIGINT
) AS $$
BEGIN
  IF NOT is_platform_super_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*) FROM profiles WHERE organization_id = p_org_id),
    org_seat_limit(p_org_id),
    (SELECT count(*) FROM departments WHERE organization_id = p_org_id),
    (SELECT count(*) FROM award_participants WHERE organization_id = p_org_id AND status = 'granted'),
    (SELECT count(*) FROM award_certificates WHERE organization_id = p_org_id),
    (SELECT count(*) FROM organization_bundle_subscriptions WHERE organization_id = p_org_id AND status = 'active');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
GRANT EXECUTE ON FUNCTION super_admin_org_usage(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
