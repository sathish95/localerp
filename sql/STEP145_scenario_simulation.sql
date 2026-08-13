-- ============================================================
-- STEP145: Simulation engine (Phase 9). Computes projected cost,
-- revenue, margin, ROI, capacity, and timeline for a scenario version
-- from its linked projects/budgets + overrides + a revenue assumption
-- — WITHOUT ever writing to projects/budgets/profiles. Every read below
-- is a plain SELECT; the only INSERTs are into scenario_simulations/
-- simulation_results, both new tables this migration creates.
--
-- Baseline sources verified directly against this codebase's actual
-- columns (src/lib/actualCost.js, dataIndex.js) rather than assumed:
--   projects.budget, projects.spent, projects.start_date/end_date
--   budgets.allocated, budgets.spent
-- Employee/resource links contribute headcount to the capacity KPI
-- only — this app has no verified per-role costing table wired into
-- this pass, so headcount is treated as a capacity signal, not priced.
--
-- Overrides (scenario_overrides.field) recognized by this engine:
--   'cost'      — adjusts total projected cost
--   'revenue'   — adjusts the revenue assumption
--   'timeline'  — adjusts the computed duration (days)
--   'capacity'  — adjusts the linked headcount figure
-- Any other field value is stored (for the UI/audit trail) but not
-- yet interpreted numerically — documented here rather than silently
-- ignored, so a future phase extending this doesn't have to guess why.
-- ============================================================

CREATE TABLE IF NOT EXISTS scenario_simulations (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id     UUID        NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  scenario_version_id UUID        NOT NULL REFERENCES scenario_versions(id) ON DELETE CASCADE,
  run_number          INT         NOT NULL DEFAULT 1,
  triggered_by        UUID        REFERENCES profiles(id),
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scenario_simulations_version_idx ON scenario_simulations(scenario_version_id);

CREATE TABLE IF NOT EXISTS simulation_results (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  simulation_id  UUID        NOT NULL REFERENCES scenario_simulations(id) ON DELETE CASCADE,
  metric_key     TEXT        NOT NULL CHECK (metric_key IN (
                    'projected_cost', 'projected_revenue', 'projected_margin', 'projected_roi_percent',
                    'capacity_headcount', 'timeline_days', 'risk_score'
                  )),
  value          NUMERIC(16,2) NOT NULL DEFAULT 0,
  baseline_value NUMERIC(16,2) NOT NULL DEFAULT 0, -- same metric, no overrides applied — lets the UI show "+12% vs baseline"
  UNIQUE (simulation_id, metric_key)
);
CREATE INDEX IF NOT EXISTS simulation_results_sim_idx ON simulation_results(simulation_id);

ALTER TABLE scenario_simulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulation_results   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scenario_simulations_select ON scenario_simulations;
DROP POLICY IF EXISTS scenario_simulations_write  ON scenario_simulations;
CREATE POLICY scenario_simulations_select ON scenario_simulations FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY scenario_simulations_write ON scenario_simulations FOR ALL USING (
  organization_id = current_org_id() AND has_permission_or_role('SCENARIO_SIMULATE', ARRAY['admin','ceo','manager','department_head','finance'])
) WITH CHECK (
  organization_id = current_org_id() AND has_permission_or_role('SCENARIO_SIMULATE', ARRAY['admin','ceo','manager','department_head','finance'])
);
GRANT SELECT, INSERT ON public.scenario_simulations TO authenticated;

DROP POLICY IF EXISTS simulation_results_select ON simulation_results;
CREATE POLICY simulation_results_select ON simulation_results FOR SELECT USING (
  EXISTS (SELECT 1 FROM scenario_simulations s WHERE s.id = simulation_id AND s.organization_id = current_org_id())
);
GRANT SELECT ON public.simulation_results TO authenticated;
-- No client INSERT/UPDATE policy on simulation_results — written
-- exclusively by run_scenario_simulation() below (SECURITY DEFINER),
-- same "only the function writes it" posture as vendor_commissions.

-- ── run_scenario_simulation() — the engine itself. ──
CREATE OR REPLACE FUNCTION run_scenario_simulation(p_version_id UUID)
RETURNS UUID AS $$
DECLARE
  v_org_id UUID;
  v_sim_id UUID;
  v_run_number INT;
  v_base_cost NUMERIC := 0;
  v_base_headcount NUMERIC := 0;
  v_base_days NUMERIC := 0;
  v_cost NUMERIC := 0;
  v_revenue NUMERIC := 0;
  v_headcount NUMERIC := 0;
  v_days NUMERIC := 0;
  v_margin NUMERIC := 0;
  v_roi NUMERIC := 0;
  v_risk NUMERIC := 0;
  v_start DATE; v_end DATE;
  v_ov RECORD;
BEGIN
  SELECT organization_id INTO v_org_id FROM scenario_versions WHERE id = p_version_id;
  IF v_org_id IS NULL OR v_org_id <> current_org_id() THEN
    RAISE EXCEPTION 'Scenario version not found';
  END IF;
  -- SECURITY DEFINER bypasses scenario_simulations_write's own
  -- SCENARIO_SIMULATE RLS requirement entirely — this check is what
  -- actually enforces it.
  IF NOT has_permission_or_role('SCENARIO_SIMULATE', ARRAY['admin','ceo','manager','department_head','finance']) THEN
    RAISE EXCEPTION 'Not authorized to run simulations';
  END IF;

  -- ── Baseline: linked projects + budgets (cost), employees + resources
  -- (headcount). This function is SECURITY DEFINER (bypasses RLS on its
  -- own reads), so every join explicitly re-checks organization_id
  -- itself — scenario_links.linked_id is a soft reference with no FK,
  -- so nothing else stops a bogus row from pointing at another org's
  -- project; this is what actually prevents that from leaking data. ──
  SELECT COALESCE(SUM(p.budget), 0) INTO v_base_cost
  FROM scenario_links l JOIN projects p ON p.id = l.linked_id AND p.organization_id = v_org_id
  WHERE l.scenario_version_id = p_version_id AND l.linked_type = 'project';

  v_base_cost := v_base_cost + COALESCE((
    SELECT SUM(b.allocated) FROM scenario_links l JOIN budgets b ON b.id = l.linked_id AND b.organization_id = v_org_id
    WHERE l.scenario_version_id = p_version_id AND l.linked_type = 'budget'
  ), 0);

  SELECT COALESCE(count(*), 0) INTO v_base_headcount
  FROM scenario_links l WHERE l.scenario_version_id = p_version_id AND l.linked_type IN ('employee', 'resource');

  SELECT min(p.start_date), max(p.end_date) INTO v_start, v_end
  FROM scenario_links l JOIN projects p ON p.id = l.linked_id AND p.organization_id = v_org_id
  WHERE l.scenario_version_id = p_version_id AND l.linked_type = 'project';
  v_base_days := COALESCE(v_end - v_start, 0);

  -- Revenue starts from an explicit assumption variable, if the wizard set one.
  -- Written as an outer SELECT wrapping a scalar subquery (not a plain
  -- "SELECT ... INTO ... FROM ... WHERE") deliberately: when the WHERE
  -- clause matches zero rows, a plain SELECT INTO assigns NULL to the
  -- target regardless of any COALESCE in its select list or the
  -- variable's DECLARE-time default — COALESCE only guards a matched
  -- row whose value is NULL, not the no-row-at-all case. Most scenarios
  -- never set an 'expected_revenue' variable, so this was hit on nearly
  -- every simulation run before being caught.
  SELECT COALESCE((
    SELECT value::NUMERIC FROM scenario_variables WHERE scenario_version_id = p_version_id AND key = 'expected_revenue'
  ), 0) INTO v_revenue;

  v_cost := v_base_cost; v_headcount := v_base_headcount; v_days := v_base_days;

  -- ── Apply overrides on top of baseline — never touching projects/budgets themselves ──
  FOR v_ov IN SELECT field, adjustment_type, adjustment_value FROM scenario_overrides WHERE scenario_version_id = p_version_id LOOP
    IF v_ov.field = 'cost' THEN
      v_cost := CASE v_ov.adjustment_type
        WHEN 'percent' THEN v_cost * (1 + v_ov.adjustment_value / 100)
        WHEN 'flat' THEN v_cost + v_ov.adjustment_value
        ELSE v_ov.adjustment_value END;
    ELSIF v_ov.field = 'revenue' THEN
      v_revenue := CASE v_ov.adjustment_type
        WHEN 'percent' THEN v_revenue * (1 + v_ov.adjustment_value / 100)
        WHEN 'flat' THEN v_revenue + v_ov.adjustment_value
        ELSE v_ov.adjustment_value END;
    ELSIF v_ov.field = 'timeline' THEN
      v_days := CASE v_ov.adjustment_type
        WHEN 'percent' THEN v_days * (1 + v_ov.adjustment_value / 100)
        WHEN 'flat' THEN v_days + v_ov.adjustment_value
        ELSE v_ov.adjustment_value END;
    ELSIF v_ov.field = 'capacity' THEN
      v_headcount := CASE v_ov.adjustment_type
        WHEN 'percent' THEN v_headcount * (1 + v_ov.adjustment_value / 100)
        WHEN 'flat' THEN v_headcount + v_ov.adjustment_value
        ELSE v_ov.adjustment_value END;
    END IF;
  END LOOP;

  v_margin := v_revenue - v_cost;
  v_roi := CASE WHEN v_cost > 0 THEN round(v_margin / v_cost * 100, 2) ELSE 0 END;
  -- Simple, explainable risk heuristic: further from baseline cost = more
  -- assumption risk. Deliberately not a black box — clamped 0-100.
  v_risk := CASE WHEN v_base_cost > 0 THEN LEAST(100, GREATEST(0, ABS(v_cost - v_base_cost) / v_base_cost * 100)) ELSE 0 END;

  SELECT COALESCE(max(run_number), 0) + 1 INTO v_run_number FROM scenario_simulations WHERE scenario_version_id = p_version_id;
  INSERT INTO scenario_simulations (organization_id, scenario_version_id, run_number, triggered_by)
  VALUES (v_org_id, p_version_id, v_run_number, auth.uid())
  RETURNING id INTO v_sim_id;

  INSERT INTO simulation_results (simulation_id, metric_key, value, baseline_value) VALUES
    (v_sim_id, 'projected_cost', v_cost, v_base_cost),
    (v_sim_id, 'projected_revenue', v_revenue, v_revenue),
    (v_sim_id, 'projected_margin', v_margin, v_revenue - v_base_cost),
    (v_sim_id, 'projected_roi_percent', v_roi, CASE WHEN v_base_cost > 0 THEN round((v_revenue - v_base_cost) / v_base_cost * 100, 2) ELSE 0 END),
    (v_sim_id, 'capacity_headcount', v_headcount, v_base_headcount),
    (v_sim_id, 'timeline_days', v_days, v_base_days),
    (v_sim_id, 'risk_score', v_risk, 0);

  UPDATE scenario_versions SET status = 'simulated', updated_at = now()
  WHERE id = p_version_id AND status IN ('draft', 'simulated');

  RETURN v_sim_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION run_scenario_simulation(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
