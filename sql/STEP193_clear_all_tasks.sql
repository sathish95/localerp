-- ============================================================
-- STEP193: Clear all Tasks (Task Management module) for the
-- 'thingsalive' organization.
--
-- DESTRUCTIVE. Deletes every row in project_tasks plus everything that
-- references a task via task_id: task_comments (Daily Updates),
-- task_status_log, task_contributors, task_equipment, task_materials.
-- Does NOT touch Projects, Stories, Sprints, Epics, or Change Requests —
-- only individual tasks. expense_requests linked to a deleted task via
-- its nullable task_id column are NOT deleted, only unlinked
-- (task_id set to NULL) so no expense record is lost.
--
-- Scoped to the 'thingsalive' org by slug rather than current_org_id() —
-- the Supabase SQL Editor runs as postgres with no authenticated
-- session, so current_org_id() (which reads auth.uid()) resolves to
-- NULL there and would silently delete nothing. To wipe every org
-- instead, delete the "AND organization_id = v_org_id" fragments below
-- (or change the slug).
--
-- task_contributors/task_equipment/task_materials only exist if
-- STEP182/STEP186 have been run in this project — each DELETE is
-- skipped (not an error) when its table isn't present, so this script
-- is safe to run regardless of which optional migrations are applied.
-- ============================================================

DO $$
DECLARE
  v_org_id UUID;
  v_count  INT;
  t        TEXT;
BEGIN
  SELECT id INTO v_org_id FROM organizations WHERE slug = 'thingsalive';
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'organizations row with slug=thingsalive not found';
  END IF;

  -- Unlink (never delete) any expenses tied to a task about to be removed
  UPDATE expense_requests SET task_id = NULL
  WHERE task_id IN (SELECT id FROM project_tasks WHERE organization_id = v_org_id);

  FOREACH t IN ARRAY ARRAY['task_comments','task_status_log','task_contributors','task_equipment','task_materials']
  LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format(
        'DELETE FROM %I WHERE task_id IN (SELECT id FROM project_tasks WHERE organization_id = $1)', t
      ) USING v_org_id;
    END IF;
  END LOOP;

  DELETE FROM project_tasks WHERE organization_id = v_org_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RAISE NOTICE '% task(s) deleted for organization %', v_count, v_org_id;
END $$;
