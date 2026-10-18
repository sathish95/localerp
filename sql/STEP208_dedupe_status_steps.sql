-- ============================================================
-- STEP208: Clean up duplicate (flow_id, status_key) rows in
-- department_status_steps — e.g. two seed scripts both inserting a
-- 'release_approval' step into the same flow — and add a unique
-- constraint so it can't happen again. Without this, React sees two
-- steps with the same key in any dropdown/Kanban column built off
-- stepsForDept() and throws "Encountered two children with the same
-- key" (TasksPage.jsx already dedupes defensively at render time, but
-- the DB should not hold duplicates in the first place).
-- Keeps the lowest sort_order row (first-seeded) per duplicate pair.
-- ============================================================

DELETE FROM department_status_steps a
USING department_status_steps b
WHERE a.flow_id = b.flow_id
  AND a.status_key = b.status_key
  AND (a.sort_order, a.id) > (b.sort_order, b.id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'department_status_steps_flow_key_uniq'
  ) THEN
    ALTER TABLE department_status_steps
      ADD CONSTRAINT department_status_steps_flow_key_uniq UNIQUE (flow_id, status_key);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
