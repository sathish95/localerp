-- STEP195: Add a "Tech Lead" role that can create every kind of task.
--
-- Reuses the 'lead' role_key rather than inventing a new one — TasksPage.jsx
-- (src/pages/TasksPage.jsx's DEF_PERMS/ALL_ROLES) already has a 'lead' role
-- pre-wired with full task permissions (can_view/create/edit/delete/
-- change_status all true), it was just never actually assignable because
-- no matching row existed in `roles` yet. This migration is what makes it
-- real: a `roles` row (so it shows up in the Role dropdown in User
-- Management) labeled "Tech Lead", plus an explicit `task_role_permissions`
-- row so the Task Permission Matrix (Settings-adjacent, Tasks page ->
-- Permissions) shows/edits it directly instead of silently falling back
-- to the in-code default.
--
-- is_system = true: this is a first-class role like admin/ceo/manager,
-- not an ad-hoc one an admin typed into "Add Role" — so it can't be
-- accidentally deleted from Settings -> Roles & Modules.

INSERT INTO roles (role_key, label, color, is_system)
VALUES ('lead', 'Tech Lead', '#0ea5e9', true)
ON CONFLICT (role_key) DO UPDATE SET label = EXCLUDED.label, is_system = true;

-- task_role_permissions got an organization_id column (NOT NULL, DEFAULT
-- current_org_id()) in STEP96's multi-tenant retrofit. That default reads
-- auth.uid(), which is NULL with no authenticated session — exactly the
-- case running this in the SQL Editor as postgres — so the plain INSERT
-- this file originally had left organization_id NULL and violated the
-- NOT NULL constraint. Resolve it explicitly instead (same lookup STEP191/
-- STEP193 use), and update-then-insert rather than ON CONFLICT since the
-- exact post-retrofit unique constraint shape (whether it's now
-- (organization_id, project_id, role) or still just (project_id, role))
-- isn't known from the app code alone.
DO $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT id INTO v_org_id FROM organizations WHERE slug = 'thingsalive';
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'organizations row with slug=thingsalive not found';
  END IF;

  UPDATE task_role_permissions
  SET can_view = true, can_create = true, can_edit = true, can_delete = true, can_change_status = true
  WHERE organization_id = v_org_id AND project_id IS NULL AND role = 'lead';

  IF NOT FOUND THEN
    INSERT INTO task_role_permissions (organization_id, project_id, role, can_view, can_create, can_edit, can_delete, can_change_status)
    VALUES (v_org_id, NULL, 'lead', true, true, true, true, true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
