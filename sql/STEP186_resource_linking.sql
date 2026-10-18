-- ============================================================
-- STEP186: Industry-Adaptive Platform — Phase 9 Resource Modules,
-- correctly reframed.
--
-- The master prompt's Phase 9 literally says "Implement incrementally:
-- Equipment, Assets, Materials, Inventory, Expenses" — read naively that
-- sounds like new domain tables. It is not. This ERP already has mature,
-- pre-existing modules for every one of those:
--   - `assets`        (AssetsPage.jsx — asset_code, name, category, make,
--                       model, serial_number, status, assigned_to,
--                       project_id, ...)
--   - `products`       (InventoryPage.jsx / src/lib/inventory.js —
--                       part_number, name, device_type, standard_cost,
--                       is_serialized, reorder_level, reorder_qty — this
--                       IS the "materials/components" domain)
--   - `expense_requests` (ExpensesPage.jsx — already has an optional
--                       `project_id`, confirmed nullable at the
--                       application layer, same pattern as time_logs)
--
-- The master prompt's own overriding principle (its very first section)
-- is "Do NOT create separate applications or duplicated domain models
-- for individual industries." Building a second, parallel
-- equipment/materials table set here would directly violate that. What
-- Phase 9 actually needs, per master prompt §39 ("Tasks should be
-- capable of referencing resources later" — later is now), is LINKING
-- tables connecting the Universal Task Engine (project_tasks, from
-- Phase 4) to these already-real resource domains — nothing more.
--
-- What this adds:
--   task_equipment  — links a task to an existing `assets` row (which
--                     asset it needs/is using), with its own
--                     assigned_at/returned_at — completely independent
--                     of `assets.status`/`assets.assigned_to`, which
--                     remain the asset module's own concern, untouched.
--   task_materials  — links a task to an existing `products` row with a
--                     quantity_required / quantity_used pair.
--                     RECORD-KEEPING ONLY — this migration does not
--                     decrement `inventory_transactions` or any stock
--                     level. Automatic stock consumption on task
--                     completion is a real future feature, deliberately
--                     out of scope here (would mean touching live
--                     inventory logic this phase has no mandate to
--                     touch).
--   expense_requests.task_id — one new nullable soft-ref column.
--                     `expense_requests.project_id` is already optional
--                     (ExpensesPage.jsx: `project_id: form.project_id ||
--                     null`) and the project-budget-increment logic
--                     there is keyed purely off `project_id` — adding an
--                     independent, always-optional `task_id` alongside
--                     it cannot affect that logic in any way.
--
-- Both new tables follow task_contributors' exact RLS shape from
-- STEP182 (scoped via the parent project_tasks row's organization_id,
-- since neither new table carries its own organization_id column).
-- ============================================================

CREATE TABLE IF NOT EXISTS task_equipment (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      UUID NOT NULL, -- soft ref -> project_tasks(id)
  asset_id     UUID NOT NULL, -- soft ref -> assets(id)
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  returned_at  TIMESTAMPTZ,
  assigned_by  UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_equipment_task_idx ON task_equipment(task_id);
CREATE INDEX IF NOT EXISTS task_equipment_asset_idx ON task_equipment(asset_id);

CREATE TABLE IF NOT EXISTS task_materials (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           UUID NOT NULL, -- soft ref -> project_tasks(id)
  product_id        UUID NOT NULL, -- soft ref -> products(id)
  quantity_required NUMERIC,
  quantity_used     NUMERIC,
  added_by          UUID REFERENCES profiles(id),
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_materials_task_idx ON task_materials(task_id);
CREATE INDEX IF NOT EXISTS task_materials_product_idx ON task_materials(product_id);

ALTER TABLE expense_requests ADD COLUMN IF NOT EXISTS task_id UUID; -- soft ref -> project_tasks(id), nullable

ALTER TABLE task_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_materials ENABLE ROW LEVEL SECURITY;

-- ::text casts below are deliberate, not stylistic: this org's live
-- schema threw "operator does not exist: uuid = text" on the plain
-- comparison (project_tasks.id/organization_id's real type couldn't be
-- confirmed from tracked migrations alone — see this file's header and
-- docs/industry-adaptive/EXISTING_SYSTEM_ANALYSIS.md's untracked-base-
-- schema note). Comparing as text works regardless of which side is
-- the actual UUID and which is TEXT.
DROP POLICY IF EXISTS task_equipment_select ON task_equipment;
DROP POLICY IF EXISTS task_equipment_write  ON task_equipment;
CREATE POLICY task_equipment_select ON task_equipment FOR SELECT USING (
  EXISTS (SELECT 1 FROM project_tasks pt WHERE pt.id::text = task_id::text AND pt.organization_id::text = current_org_id()::text)
);
CREATE POLICY task_equipment_write ON task_equipment FOR ALL USING (
  EXISTS (SELECT 1 FROM project_tasks pt WHERE pt.id::text = task_id::text AND pt.organization_id::text = current_org_id()::text)
) WITH CHECK (
  EXISTS (SELECT 1 FROM project_tasks pt WHERE pt.id::text = task_id::text AND pt.organization_id::text = current_org_id()::text)
);

DROP POLICY IF EXISTS task_materials_select ON task_materials;
DROP POLICY IF EXISTS task_materials_write  ON task_materials;
CREATE POLICY task_materials_select ON task_materials FOR SELECT USING (
  EXISTS (SELECT 1 FROM project_tasks pt WHERE pt.id::text = task_id::text AND pt.organization_id::text = current_org_id()::text)
);
CREATE POLICY task_materials_write ON task_materials FOR ALL USING (
  EXISTS (SELECT 1 FROM project_tasks pt WHERE pt.id::text = task_id::text AND pt.organization_id::text = current_org_id()::text)
) WITH CHECK (
  EXISTS (SELECT 1 FROM project_tasks pt WHERE pt.id::text = task_id::text AND pt.organization_id::text = current_org_id()::text)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_equipment TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_materials TO authenticated;

NOTIFY pgrst, 'reload schema';
