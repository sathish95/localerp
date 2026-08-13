-- ============================================================
-- STEP151: Portfolio-level rollup for Phase 15's role-based dashboards.
-- This app's actual roles (per CLAUDE.md) are admin/ceo/manager/
-- department_head/finance/hr/employee — there is no distinct CFO/COO/PMO
-- role. The master prompt's named audiences are mapped onto these real
-- roles in the frontend (ScenarioDashboardPage) rather than inventing
-- roles that don't exist anywhere else in this app.
--
-- Aggregates each scenario version's LATEST simulation run, grouped by
-- status, org-scoped directly via scenario_versions.organization_id (no
-- polymorphic/soft-referenced join here, so no extra org re-check needed
-- beyond the normal current_org_id() filter).
-- ============================================================

CREATE OR REPLACE FUNCTION get_scenario_portfolio_summary()
RETURNS TABLE (
  status TEXT, scenario_count BIGINT,
  total_projected_cost NUMERIC, total_projected_revenue NUMERIC,
  total_projected_margin NUMERIC, avg_roi_percent NUMERIC, avg_risk_score NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH latest_sim AS (
    SELECT sv.id AS v_id, sv.status AS v_status,
      (SELECT id FROM scenario_simulations WHERE scenario_version_id = sv.id ORDER BY run_number DESC LIMIT 1) AS sim_id
    FROM scenario_versions sv
    WHERE sv.organization_id = current_org_id()
  ),
  agg AS (
    SELECT
      l.v_status,
      COALESCE(MAX(CASE WHEN r.metric_key = 'projected_cost' THEN r.value END), 0) AS a_cost,
      COALESCE(MAX(CASE WHEN r.metric_key = 'projected_revenue' THEN r.value END), 0) AS a_revenue,
      COALESCE(MAX(CASE WHEN r.metric_key = 'projected_margin' THEN r.value END), 0) AS a_margin,
      COALESCE(MAX(CASE WHEN r.metric_key = 'projected_roi_percent' THEN r.value END), 0) AS a_roi,
      COALESCE(MAX(CASE WHEN r.metric_key = 'risk_score' THEN r.value END), 0) AS a_risk
    FROM latest_sim l LEFT JOIN simulation_results r ON r.simulation_id = l.sim_id
    GROUP BY l.v_id, l.v_status
  )
  SELECT v_status, count(*),
    sum(a_cost), sum(a_revenue), sum(a_margin),
    round(avg(a_roi), 2), round(avg(a_risk), 2)
  FROM agg GROUP BY v_status;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION get_scenario_portfolio_summary() TO authenticated;

NOTIFY pgrst, 'reload schema';
