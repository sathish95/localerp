-- STEP166: Project fund-flow closure via department sign-off
--
-- Adds a persisted "fund flow" open/closed state to projects (previously
-- src/lib/fundFlow.js had no backing table at all — it's a pure read-only
-- aggregation over budgets/purchase_orders/grn/invoices/payments). Also
-- introduces project_departments, the first explicit record of "which
-- departments are involved in this project" — everywhere else in the
-- schema department_id is a single nullable FK (projects, profiles,
-- budgets), never a set, so this is new territory, not a rename/extension
-- of an existing column.
--
-- Soft FKs only (project_id, department_id are plain UUID columns, no
-- REFERENCES) per this repo's convention for tables that reference
-- projects/departments — see CLAUDE.md.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS fund_flow_status TEXT NOT NULL DEFAULT 'open'
  CHECK (fund_flow_status IN ('open','closed'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS fund_flow_closed_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS fund_flow_closed_by UUID REFERENCES profiles(id);

CREATE TABLE IF NOT EXISTS project_departments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id(),
  project_id      UUID NOT NULL,
  department_id   UUID NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','signed_off')),
  signed_off_by   UUID REFERENCES profiles(id),
  signed_off_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (project_id, department_id)
);

ALTER TABLE project_departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_departments_select ON project_departments;
DROP POLICY IF EXISTS project_departments_write ON project_departments;

-- Permissive SELECT, org-scoped (matches the rest of the app's convention).
CREATE POLICY project_departments_select ON project_departments FOR SELECT
  USING (organization_id = current_org_id());

-- Row-level add/remove/sign-off is role-gated here (admin/ceo/manager/
-- department_head); the sign-off action itself is further narrowed in the
-- app layer to admin/ceo or the department_head/manager whose own
-- profiles.department_id matches the row, mirroring ProjectsPage.jsx's
-- existing canEdit role list.
CREATE POLICY project_departments_write ON project_departments FOR ALL
  USING (organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid()
      AND role IN ('admin','ceo','manager','department_head')
  ))
  WITH CHECK (organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid()
      AND role IN ('admin','ceo','manager','department_head')
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_departments TO authenticated;

NOTIFY pgrst, 'reload schema';
