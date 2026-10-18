-- ============================================================
-- STEP226: Task Field Rules — org-wide "is this field required"
-- toggles for the Task create/edit form (src/pages/TasksPage.jsx's
-- TaskForm / saveTask()).
--
-- Two independent flags per field: required_on_create and
-- required_on_edit — e.g. an org may want Description optional while
-- quickly capturing a new task, but mandatory by the time someone edits
-- it later. One row per (organization_id, field_key); a field with no
-- row is simply not required (both flags default false).
-- ============================================================

CREATE TABLE IF NOT EXISTS task_field_rules (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  field_key          TEXT NOT NULL,
  required_on_create BOOLEAN NOT NULL DEFAULT false,
  required_on_edit   BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, field_key)
);

DROP TRIGGER IF EXISTS task_field_rules_updated_at ON task_field_rules;
CREATE TRIGGER task_field_rules_updated_at BEFORE UPDATE ON task_field_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE task_field_rules ENABLE ROW LEVEL SECURITY;

-- Same posture as task_templates (STEP182): configuration, not
-- day-to-day operational data. Any org member can SELECT it — the Task
-- form must validate against it for every role, not just managers.
-- Writing it (Settings → Task Field Rules) is admin/ceo/manager/
-- department_head only, mirroring task_templates_write.
DROP POLICY IF EXISTS task_field_rules_select ON task_field_rules;
DROP POLICY IF EXISTS task_field_rules_write  ON task_field_rules;
CREATE POLICY task_field_rules_select ON task_field_rules FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY task_field_rules_write ON task_field_rules FOR ALL USING (
  organization_id = current_org_id() AND
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head'))
) WITH CHECK (
  organization_id = current_org_id() AND
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','manager','department_head'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_field_rules TO authenticated;

NOTIFY pgrst, 'reload schema';
