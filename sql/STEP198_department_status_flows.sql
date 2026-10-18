-- ============================================================
-- STEP198: Per-department task status flows + the data behind a master
-- settings panel to configure them (Settings -> Task Status Flows).
--
-- Replaces the single global status list (Backlog/To Do/In Progress/
-- Delayed/QA/Ready for Demo/Closed) with one independently-configurable
-- ordered pipeline PER DEPARTMENT, e.g.:
--   Application: Backlog -> Todo -> Analysis -> ...
--   Firmware:    Backlog -> POC -> Pilot -> Test -> ...
--   Hardware:    Backlog -> POC -> Assemble -> ...
-- Tasks with no department use a dedicated "Unassigned" flow
-- (department_id IS NULL) rather than a hardcoded fallback — per
-- explicit product decision, every department INCLUDING "none" gets a
-- real, editable flow row, no exceptions.
-- ============================================================

CREATE TABLE IF NOT EXISTS department_status_flows (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  department_id   UUID        REFERENCES departments(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- At most one flow per real department...
CREATE UNIQUE INDEX IF NOT EXISTS dept_status_flows_dept_uq ON department_status_flows(organization_id, department_id) WHERE department_id IS NOT NULL;
-- ...and at most one "Unassigned" (no department) flow per org.
CREATE UNIQUE INDEX IF NOT EXISTS dept_status_flows_null_uq ON department_status_flows(organization_id) WHERE department_id IS NULL;

CREATE TABLE IF NOT EXISTS department_status_steps (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  flow_id         UUID        NOT NULL REFERENCES department_status_flows(id) ON DELETE CASCADE,
  status_key      TEXT        NOT NULL,
  label           TEXT        NOT NULL,
  color           TEXT        NOT NULL DEFAULT '#6366f1',
  sort_order      INT         NOT NULL DEFAULT 0,
  is_closed       BOOLEAN     NOT NULL DEFAULT false,   -- marks which step(s) count as "done" for stats/reports
  UNIQUE(flow_id, status_key)
);
CREATE INDEX IF NOT EXISTS department_status_steps_flow_idx ON department_status_steps(flow_id);

ALTER TABLE department_status_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_status_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS open ON department_status_flows;
DROP POLICY IF EXISTS open ON department_status_steps;
CREATE POLICY open ON department_status_flows FOR ALL TO authenticated
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());
CREATE POLICY open ON department_status_steps FOR ALL TO authenticated
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.department_status_flows TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.department_status_steps TO authenticated;

-- Seed: every existing department (every org) + one "Unassigned" bucket
-- per org gets today's legacy global list as its starting flow, so
-- nothing breaks or looks empty the moment this ships — admins then
-- customize each department's flow from Settings -> Task Status Flows.
-- Idempotent: skips any department/org that already has a flow row.
DO $$
DECLARE
  d RECORD;
  o RECORD;
  v_flow_id UUID;
  v_legacy JSONB := '[
    {"key":"backlog","label":"Backlog","color":"#64748b"},
    {"key":"todo","label":"To Do","color":"#3b82f6"},
    {"key":"in_progress","label":"In Progress","color":"#f59e0b"},
    {"key":"delayed","label":"Delayed","color":"#e11d48"},
    {"key":"qa","label":"QA Testing","color":"#8b5cf6"},
    {"key":"ready_for_demo","label":"Ready for Demo","color":"#10b981"},
    {"key":"closed","label":"Closed","color":"#94a3b8","closed":true}
  ]'::jsonb;
  step JSONB;
  i INT;
BEGIN
  FOR d IN SELECT id, organization_id FROM departments LOOP
    IF EXISTS (SELECT 1 FROM department_status_flows WHERE department_id = d.id) THEN CONTINUE; END IF;
    INSERT INTO department_status_flows (organization_id, department_id) VALUES (d.organization_id, d.id) RETURNING id INTO v_flow_id;
    i := 0;
    FOR step IN SELECT * FROM jsonb_array_elements(v_legacy) LOOP
      INSERT INTO department_status_steps (organization_id, flow_id, status_key, label, color, sort_order, is_closed)
      VALUES (d.organization_id, v_flow_id, step->>'key', step->>'label', step->>'color', i, COALESCE((step->>'closed')::boolean,false));
      i := i + 1;
    END LOOP;
  END LOOP;

  FOR o IN SELECT id FROM organizations LOOP
    IF EXISTS (SELECT 1 FROM department_status_flows WHERE organization_id = o.id AND department_id IS NULL) THEN CONTINUE; END IF;
    INSERT INTO department_status_flows (organization_id, department_id) VALUES (o.id, NULL) RETURNING id INTO v_flow_id;
    i := 0;
    FOR step IN SELECT * FROM jsonb_array_elements(v_legacy) LOOP
      INSERT INTO department_status_steps (organization_id, flow_id, status_key, label, color, sort_order, is_closed)
      VALUES (o.id, v_flow_id, step->>'key', step->>'label', step->>'color', i, COALESCE((step->>'closed')::boolean,false));
      i := i + 1;
    END LOOP;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
