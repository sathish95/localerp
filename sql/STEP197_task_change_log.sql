-- ============================================================
-- STEP197: Task change history — a complete audit trail of field
-- changes on a task (status, assignee, priority, department, dates,
-- hours, etc.), so anyone can verify exactly what changed, when, and by
-- whom — separate from the free-text Daily Updates (task_comments),
-- which are narrative progress notes, not a structured change log.
--
-- Soft references (task_id, changed_by) — no hard REFERENCES, matching
-- this app's established convention (see CLAUDE.md) — and the same
-- organization_id + "open" RLS shape STEP96 already uses for every other
-- Tasks-module table (project_tasks, task_comments, task_status_log, etc).
-- ============================================================

CREATE TABLE IF NOT EXISTS task_change_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  task_id         UUID        NOT NULL,   -- soft ref -> project_tasks(id)
  changed_by      UUID,                   -- soft ref -> profiles(id)
  field_name      TEXT        NOT NULL,
  old_value       TEXT,
  new_value       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_change_log_task_idx ON task_change_log(task_id);

ALTER TABLE task_change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS open ON task_change_log;
CREATE POLICY open ON task_change_log FOR ALL TO authenticated
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_change_log TO authenticated;

NOTIFY pgrst, 'reload schema';
