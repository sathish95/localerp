-- ============================================================
-- STEP149: Actuals & Variance (Phase 13). Plan comes from the latest
-- simulation's projected_cost; actual comes from a LIVE read of the
-- same linked projects'/budgets' current .spent — never a stored
-- snapshot, so variance always reflects reality as of the moment it's
-- viewed. Same organization_id defense-in-depth as STEP145/148.
-- ============================================================

CREATE OR REPLACE FUNCTION get_scenario_variance(p_version_id UUID)
RETURNS TABLE (planned_cost NUMERIC, actual_cost NUMERIC, variance_amount NUMERIC, variance_percent NUMERIC, root_cause TEXT) AS $$
DECLARE
  v_org_id UUID;
  v_planned NUMERIC := 0;
  v_actual NUMERIC := 0;
  v_variance NUMERIC;
  v_pct NUMERIC;
  v_cause TEXT;
BEGIN
  SELECT organization_id INTO v_org_id FROM scenario_versions WHERE id = p_version_id;
  IF v_org_id IS NULL OR v_org_id <> current_org_id() THEN
    RAISE EXCEPTION 'Scenario version not found';
  END IF;

  SELECT r.value INTO v_planned FROM simulation_results r
  JOIN scenario_simulations s ON s.id = r.simulation_id
  WHERE s.scenario_version_id = p_version_id AND r.metric_key = 'projected_cost'
  ORDER BY s.run_number DESC LIMIT 1;
  v_planned := COALESCE(v_planned, 0);

  SELECT COALESCE(SUM(p.spent), 0) INTO v_actual
  FROM scenario_links l JOIN projects p ON p.id = l.linked_id AND p.organization_id = v_org_id
  WHERE l.scenario_version_id = p_version_id AND l.linked_type = 'project';

  v_actual := v_actual + COALESCE((
    SELECT SUM(b.spent) FROM scenario_links l JOIN budgets b ON b.id = l.linked_id AND b.organization_id = v_org_id
    WHERE l.scenario_version_id = p_version_id AND l.linked_type = 'budget'
  ), 0);

  -- Include actuals against any budget this scenario itself created on execution.
  v_actual := v_actual + COALESCE((
    SELECT SUM(b.spent) FROM scenario_execution_items i
    JOIN scenario_executions e ON e.id = i.execution_id AND e.scenario_version_id = p_version_id
    JOIN budgets b ON b.id = i.target_id AND i.target_type = 'budget' AND b.organization_id = v_org_id
  ), 0);

  v_variance := v_actual - v_planned;
  v_pct := CASE WHEN v_planned > 0 THEN round(v_variance / v_planned * 100, 2) ELSE 0 END;
  v_cause := CASE
    WHEN v_planned = 0 THEN 'No baseline plan to compare against yet — run a simulation first.'
    WHEN v_pct > 15 THEN 'Actual spend is running significantly over plan — review linked budgets for scope or cost overruns.'
    WHEN v_pct < -15 THEN 'Actual spend is significantly under plan — check whether linked work is behind schedule or under-resourced.'
    ELSE 'Actual spend is tracking close to plan.'
  END;

  RETURN QUERY SELECT v_planned, v_actual, v_variance, v_pct, v_cause;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION get_scenario_variance(UUID) TO authenticated;

-- ── create_scenario_reforecast() — Phase 14. Freezes the current
-- version (already 'executed' or any terminal-ish state) and opens a
-- new draft version copying variables/links forward, chained via
-- parent_version_id. v1 is never mutated. ──
CREATE OR REPLACE FUNCTION create_scenario_reforecast(p_version_id UUID)
RETURNS UUID AS $$
DECLARE
  v_org_id UUID;
  v_scenario_id UUID;
  v_new_version_id UUID;
  v_next_num INT;
BEGIN
  SELECT organization_id, scenario_id INTO v_org_id, v_scenario_id FROM scenario_versions WHERE id = p_version_id;
  IF v_org_id IS NULL OR v_org_id <> current_org_id() THEN
    RAISE EXCEPTION 'Scenario version not found';
  END IF;
  IF NOT has_permission_or_role('SCENARIO_EDIT', ARRAY['admin','ceo','manager','department_head','finance']) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_num FROM scenario_versions WHERE scenario_id = v_scenario_id;

  INSERT INTO scenario_versions (organization_id, scenario_id, version_number, parent_version_id, status, context, assumptions, start_date, end_date, created_by)
  SELECT organization_id, scenario_id, v_next_num, id, 'draft', context, assumptions, start_date, end_date, auth.uid()
  FROM scenario_versions WHERE id = p_version_id
  RETURNING id INTO v_new_version_id;

  INSERT INTO scenario_links (organization_id, scenario_version_id, linked_type, linked_id, link_mode, snapshot, created_by)
  SELECT organization_id, v_new_version_id, linked_type, linked_id, link_mode, snapshot, auth.uid()
  FROM scenario_links WHERE scenario_version_id = p_version_id;

  INSERT INTO scenario_variables (organization_id, scenario_version_id, key, label, data_type, value, sort_order)
  SELECT organization_id, v_new_version_id, key, label, data_type, value, sort_order
  FROM scenario_variables WHERE scenario_version_id = p_version_id;

  RETURN v_new_version_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION create_scenario_reforecast(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
