-- ============================================================
-- STEP147: Scenario Comparison (Phase 10). Per the Phase 1 design
-- decision: stores only the SELECTION (which versions, a name) — the
-- actual KPI numbers are always read live from simulation_results via
-- compare_scenario_versions() below, never cached, so a comparison is
-- always accurate even if a version gets re-simulated afterward.
-- ============================================================

CREATE TABLE IF NOT EXISTS scenario_comparisons (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  name            TEXT        NOT NULL,
  version_ids     UUID[]      NOT NULL CHECK (array_length(version_ids, 1) BETWEEN 2 AND 5),
  created_by      UUID        REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scenario_comparisons_org_idx ON scenario_comparisons(organization_id);

ALTER TABLE scenario_comparisons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scenario_comparisons_select ON scenario_comparisons;
DROP POLICY IF EXISTS scenario_comparisons_write  ON scenario_comparisons;
CREATE POLICY scenario_comparisons_select ON scenario_comparisons FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY scenario_comparisons_write ON scenario_comparisons FOR ALL USING (
  organization_id = current_org_id()
  AND (created_by = auth.uid() OR has_permission_or_role('SCENARIO_EDIT', ARRAY['admin','ceo']))
) WITH CHECK (
  organization_id = current_org_id() AND has_permission_or_role('SCENARIO_CREATE', ARRAY['admin','ceo','manager','department_head','finance'])
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scenario_comparisons TO authenticated;

-- ── compare_scenario_versions() — live KPI pull for up to 5 versions,
-- each version's LATEST simulation run only, plus a simple
-- recommendation (highest ROI among versions whose risk_score is at or
-- below the org's median risk among the compared set — favors return
-- without blindly picking the riskiest option). ──
CREATE OR REPLACE FUNCTION compare_scenario_versions(p_version_ids UUID[])
RETURNS TABLE (
  version_id UUID, scenario_name TEXT, version_number INT, status TEXT,
  projected_cost NUMERIC, projected_revenue NUMERIC, projected_margin NUMERIC,
  projected_roi_percent NUMERIC, capacity_headcount NUMERIC, timeline_days NUMERIC,
  risk_score NUMERIC, is_recommended BOOLEAN
) AS $$
BEGIN
  IF array_length(p_version_ids, 1) IS NULL OR array_length(p_version_ids, 1) < 2 OR array_length(p_version_ids, 1) > 5 THEN
    RAISE EXCEPTION 'Compare between 2 and 5 scenario versions';
  END IF;

  RETURN QUERY
  WITH latest_sim AS (
    SELECT sv.id AS v_id, s.name AS s_name, sv.version_number AS v_num, sv.status AS v_status,
      (SELECT id FROM scenario_simulations WHERE scenario_version_id = sv.id ORDER BY run_number DESC LIMIT 1) AS sim_id
    FROM scenario_versions sv JOIN scenarios s ON s.id = sv.scenario_id
    WHERE sv.id = ANY(p_version_ids) AND sv.organization_id = current_org_id()
  ),
  agg AS (
    SELECT
      l.v_id, l.s_name, l.v_num, l.v_status,
      COALESCE(MAX(CASE WHEN r.metric_key = 'projected_cost' THEN r.value END), 0) AS a_cost,
      COALESCE(MAX(CASE WHEN r.metric_key = 'projected_revenue' THEN r.value END), 0) AS a_revenue,
      COALESCE(MAX(CASE WHEN r.metric_key = 'projected_margin' THEN r.value END), 0) AS a_margin,
      COALESCE(MAX(CASE WHEN r.metric_key = 'projected_roi_percent' THEN r.value END), 0) AS a_roi,
      COALESCE(MAX(CASE WHEN r.metric_key = 'capacity_headcount' THEN r.value END), 0) AS a_headcount,
      COALESCE(MAX(CASE WHEN r.metric_key = 'timeline_days' THEN r.value END), 0) AS a_days,
      COALESCE(MAX(CASE WHEN r.metric_key = 'risk_score' THEN r.value END), 0) AS a_risk
    FROM latest_sim l LEFT JOIN simulation_results r ON r.simulation_id = l.sim_id
    GROUP BY l.v_id, l.s_name, l.v_num, l.v_status
  ),
  -- percentile_cont is an ordered-set aggregate — Postgres does not
  -- allow OVER() on those (unlike plain aggregates such as SUM/AVG),
  -- so the median has to be computed once via a scalar subquery and
  -- attached to every row, not as a window function.
  scored AS (
    SELECT a.*, (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY a_risk) FROM agg) AS median_risk FROM agg a
  ),
  ranked AS (
    SELECT *, RANK() OVER (ORDER BY (CASE WHEN a_risk <= median_risk THEN a_roi ELSE -999999 END) DESC) AS rnk FROM scored
  )
  SELECT v_id, s_name, v_num, v_status, a_cost, a_revenue, a_margin, a_roi, a_headcount, a_days, a_risk, (rnk = 1)
  FROM ranked;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION compare_scenario_versions(UUID[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
