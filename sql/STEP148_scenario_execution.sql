-- ============================================================
-- STEP148: Execution (Phase 12) — converts an APPROVED scenario version
-- into a real operational record. Scoped deliberately narrow for this
-- pass: creates one `budgets` row (verified schema: department_id,
-- project_id, category, fiscal_year, allocated, spent,
-- committed_amount, currency, created_by — src/lib/actualCost.js) per
-- linked project, allocated at that simulation's projected cost. Every
-- other linked_type (customer/task/resource/employee/vendor/contract/
-- sales_opportunity) is logged in scenario_execution_items as
-- "acknowledged, not yet convertible" rather than silently ignored —
-- honest about what this pass actually does versus invents.
--
-- Never overwrites an existing record: every execution INSERTs new
-- rows only. Running execute_scenario_version() twice on the same
-- version is blocked outright (status guard), not merely deduplicated.
-- ============================================================

CREATE TABLE IF NOT EXISTS scenario_executions (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id     UUID        NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  scenario_version_id UUID        NOT NULL REFERENCES scenario_versions(id),
  executed_by         UUID        REFERENCES profiles(id),
  executed_at         TIMESTAMPTZ DEFAULT now(),
  summary             JSONB       NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS scenario_executions_version_uq ON scenario_executions(scenario_version_id);

CREATE TABLE IF NOT EXISTS scenario_execution_items (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  execution_id   UUID        NOT NULL REFERENCES scenario_executions(id) ON DELETE CASCADE,
  target_type    TEXT        NOT NULL, -- 'budget' (created) or the original linked_type (acknowledged only)
  target_id      UUID,       -- the created record's id, when target_type='budget'; null otherwise
  source_link_id UUID        REFERENCES scenario_links(id),
  amount         NUMERIC(14,2),
  note           TEXT
);
CREATE INDEX IF NOT EXISTS scenario_execution_items_exec_idx ON scenario_execution_items(execution_id);

ALTER TABLE scenario_executions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_execution_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scenario_executions_select ON scenario_executions;
CREATE POLICY scenario_executions_select ON scenario_executions FOR SELECT USING (organization_id = current_org_id());
GRANT SELECT ON public.scenario_executions TO authenticated;

DROP POLICY IF EXISTS scenario_execution_items_select ON scenario_execution_items;
CREATE POLICY scenario_execution_items_select ON scenario_execution_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM scenario_executions e WHERE e.id = execution_id AND e.organization_id = current_org_id())
);
GRANT SELECT ON public.scenario_execution_items TO authenticated;
-- No client write policy on either — both written only by
-- execute_scenario_version() below.

-- ── preview_scenario_execution() — read-only dry run, exactly what
-- Phase 12 requires ("preview all changes before execution"). Same
-- shape as the real thing, minus any INSERT. ──
CREATE OR REPLACE FUNCTION preview_scenario_execution(p_version_id UUID)
RETURNS TABLE (linked_type TEXT, linked_id UUID, action TEXT, amount NUMERIC) AS $$
DECLARE v_cost NUMERIC; v_org_id UUID;
BEGIN
  -- SECURITY DEFINER bypasses RLS on its own reads, so this org check is
  -- what actually stops any authenticated user from previewing another
  -- tenant's scenario by guessing/observing its version id.
  SELECT organization_id INTO v_org_id FROM scenario_versions WHERE id = p_version_id;
  IF v_org_id IS NULL OR v_org_id <> current_org_id() THEN
    RAISE EXCEPTION 'Scenario version not found';
  END IF;

  SELECT r.value INTO v_cost FROM simulation_results r
  JOIN scenario_simulations s ON s.id = r.simulation_id
  WHERE s.scenario_version_id = p_version_id AND r.metric_key = 'projected_cost'
  ORDER BY s.run_number DESC LIMIT 1;

  RETURN QUERY
    SELECT l.linked_type, l.linked_id,
      CASE WHEN l.linked_type = 'project' THEN 'create budget allocation' ELSE 'acknowledge only (not yet convertible)' END,
      CASE WHEN l.linked_type = 'project' THEN COALESCE(v_cost, 0) ELSE NULL END
    FROM scenario_links l WHERE l.scenario_version_id = p_version_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION preview_scenario_execution(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION execute_scenario_version(p_version_id UUID)
RETURNS UUID AS $$
DECLARE
  v_org_id UUID;
  v_cost NUMERIC;
  v_exec_id UUID;
  v_link RECORD;
  v_budget_id UUID;
  v_created_count INT := 0;
  v_acknowledged_count INT := 0;
BEGIN
  IF NOT has_permission_or_role('SCENARIO_EXECUTE', ARRAY['admin','ceo','finance']) THEN
    RAISE EXCEPTION 'Not authorized to execute scenarios';
  END IF;

  SELECT organization_id INTO v_org_id FROM scenario_versions WHERE id = p_version_id AND status = 'approved';
  IF v_org_id IS NULL OR v_org_id <> current_org_id() THEN
    RAISE EXCEPTION 'Scenario version not found or not approved';
  END IF;
  IF EXISTS (SELECT 1 FROM scenario_executions WHERE scenario_version_id = p_version_id) THEN
    RAISE EXCEPTION 'This version has already been executed';
  END IF;

  SELECT r.value INTO v_cost FROM simulation_results r
  JOIN scenario_simulations s ON s.id = r.simulation_id
  WHERE s.scenario_version_id = p_version_id AND r.metric_key = 'projected_cost'
  ORDER BY s.run_number DESC LIMIT 1;

  INSERT INTO scenario_executions (organization_id, scenario_version_id, executed_by)
  VALUES (v_org_id, p_version_id, auth.uid())
  RETURNING id INTO v_exec_id;

  FOR v_link IN SELECT id, linked_type, linked_id FROM scenario_links WHERE scenario_version_id = p_version_id LOOP
    -- linked_id is a soft reference with no FK — re-verify the target
    -- project actually belongs to this org before creating anything
    -- against it, same defense-in-depth as run_scenario_simulation().
    IF v_link.linked_type = 'project' AND EXISTS (SELECT 1 FROM projects WHERE id = v_link.linked_id AND organization_id = v_org_id) THEN
      INSERT INTO budgets (project_id, category, fiscal_year, allocated, spent, committed_amount, currency, created_by, organization_id)
      VALUES (v_link.linked_id, 'Scenario Execution', date_part('year', now())::INT, COALESCE(v_cost, 0), 0, 0, 'INR', auth.uid(), v_org_id)
      RETURNING id INTO v_budget_id;

      INSERT INTO scenario_execution_items (execution_id, target_type, target_id, source_link_id, amount, note)
      VALUES (v_exec_id, 'budget', v_budget_id, v_link.id, v_cost, 'Created from scenario simulation');
      v_created_count := v_created_count + 1;
    ELSE
      INSERT INTO scenario_execution_items (execution_id, target_type, source_link_id, note)
      VALUES (v_exec_id, v_link.linked_type, v_link.id, 'Acknowledged — this linked_type has no automatic conversion yet');
      v_acknowledged_count := v_acknowledged_count + 1;
    END IF;
  END LOOP;

  UPDATE scenario_executions SET summary = jsonb_build_object('budgets_created', v_created_count, 'links_acknowledged', v_acknowledged_count)
  WHERE id = v_exec_id;
  UPDATE scenario_versions SET status = 'executed', updated_at = now() WHERE id = p_version_id;

  RETURN v_exec_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION execute_scenario_version(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
