-- ============================================================
-- STEP234: Activity Planner — calendar of field activities
-- (installation, commissioning, maintenance, site survey, training …)
-- with the resources involved, costs involved and days required,
-- rolled up for management.
--
--   planned_activities            one row per activity (dates, days, status)
--   planned_activity_resources    people / equipment / vehicles / subcontractors
--                                 on the activity, each with days × rate per day
--   planned_activity_costs        other cost lines (travel, material, stay …)
--
-- Org-scoped. Everyone in the org can read (so it can be shown to
-- management); anyone can create; the creator or a manager-level role
-- can edit/delete. Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS planned_activities (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  title           TEXT        NOT NULL,
  activity_type   TEXT        NOT NULL DEFAULT 'Installation',
  project_id      UUID,       -- soft ref → projects
  customer_id     UUID,       -- soft ref → customers
  location        TEXT,
  start_date      DATE        NOT NULL,
  end_date        DATE        NOT NULL,
  days_required   NUMERIC(6,1) NOT NULL DEFAULT 1,
  status          TEXT        NOT NULL DEFAULT 'planned'
                  CHECK (status IN ('planned','confirmed','in_progress','completed','cancelled')),
  owner_id        UUID,       -- soft ref → profiles (activity lead)
  notes           TEXT,
  created_by      UUID        DEFAULT auth.uid(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS planned_activities_org_dates ON planned_activities (organization_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS planned_activity_resources (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  activity_id     UUID        NOT NULL REFERENCES planned_activities(id) ON DELETE CASCADE,
  resource_type   TEXT        NOT NULL DEFAULT 'person'
                  CHECK (resource_type IN ('person','equipment','vehicle','subcontractor')),
  person_id       UUID,       -- soft ref → profiles, when resource_type = 'person'
  name            TEXT        NOT NULL,
  role            TEXT,
  quantity        NUMERIC(8,1) NOT NULL DEFAULT 1,
  days            NUMERIC(6,1) NOT NULL DEFAULT 1,
  rate_per_day    NUMERIC(12,2) NOT NULL DEFAULT 0,
  sort_order      INT         NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS planned_activity_resources_activity ON planned_activity_resources (activity_id);
CREATE INDEX IF NOT EXISTS planned_activity_resources_person ON planned_activity_resources (person_id);

CREATE TABLE IF NOT EXISTS planned_activity_costs (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  activity_id     UUID        NOT NULL REFERENCES planned_activities(id) ON DELETE CASCADE,
  category        TEXT        NOT NULL DEFAULT 'Other',
  description     TEXT,
  amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
  sort_order      INT         NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS planned_activity_costs_activity ON planned_activity_costs (activity_id);

-- Creator of the activity, or a manager-level role, may change it.
CREATE OR REPLACE FUNCTION can_edit_planned_activity(p_activity UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM planned_activities a
    WHERE a.id = p_activity AND a.organization_id = current_org_id()
      AND (a.created_by = auth.uid() OR a.owner_id = auth.uid()
           OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
                      AND p.role IN ('admin','ceo','manager','department_head','cto','project_manager')))
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION can_edit_planned_activity(UUID) TO authenticated;

ALTER TABLE planned_activities         ENABLE ROW LEVEL SECURITY;
ALTER TABLE planned_activity_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE planned_activity_costs     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS planned_activities_select ON planned_activities;
CREATE POLICY planned_activities_select ON planned_activities FOR SELECT
  USING (organization_id = current_org_id());
DROP POLICY IF EXISTS planned_activities_insert ON planned_activities;
CREATE POLICY planned_activities_insert ON planned_activities FOR INSERT
  WITH CHECK (organization_id = current_org_id());
DROP POLICY IF EXISTS planned_activities_update ON planned_activities;
CREATE POLICY planned_activities_update ON planned_activities FOR UPDATE
  USING (can_edit_planned_activity(id)) WITH CHECK (organization_id = current_org_id());
DROP POLICY IF EXISTS planned_activities_delete ON planned_activities;
CREATE POLICY planned_activities_delete ON planned_activities FOR DELETE
  USING (can_edit_planned_activity(id));

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['planned_activity_resources','planned_activity_costs'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_select ON %1$s', tbl);
    EXECUTE format('CREATE POLICY %1$s_select ON %1$s FOR SELECT USING (organization_id = current_org_id())', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_write ON %1$s', tbl);
    EXECUTE format('CREATE POLICY %1$s_write ON %1$s FOR ALL USING (organization_id = current_org_id() AND can_edit_planned_activity(activity_id)) WITH CHECK (organization_id = current_org_id() AND can_edit_planned_activity(activity_id))', tbl);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.planned_activities         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.planned_activity_resources TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.planned_activity_costs     TO authenticated;

-- Module registry: the web app self-heals missing `modules` rows for
-- admin/ceo (syncModulesFromConfig), but seed every org now so the tab
-- is toggleable immediately.
INSERT INTO modules (organization_id, key, label)
SELECT o.id, 'activity-planner', 'Activity Planner' FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM modules m WHERE m.organization_id = o.id AND m.key = 'activity-planner');

-- Billing: fold into Operations Core (STEP124 seeds with ON CONFLICT DO NOTHING).
UPDATE billing_bundles
SET module_keys = module_keys || '["activity-planner"]'::jsonb
WHERE key = 'operations_core' AND NOT (module_keys ? 'activity-planner');

NOTIFY pgrst, 'reload schema';
