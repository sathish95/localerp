-- ============================================================
-- STEP236: New modules show by default for workspaces with a saved
-- module list.
--
-- workspace_profiles.enabled_module_keys (STEP180) is an allow-list, so
-- any module added to the app after an admin saved it was hidden. This
-- records which modules existed when the list was saved; the app now
-- hides only a module that was known and unticked
-- (src/lib/workspace.js isModuleInWorkspace()).
--
-- Existing rows stay NULL: the app treats them as "every module except
-- those added since" (ADDED_AFTER_LEGACY_LISTS in workspace.js). The next
-- save from Settings → Workspace fills this column in.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE workspace_profiles ADD COLUMN IF NOT EXISTS known_module_keys JSONB;

COMMENT ON COLUMN workspace_profiles.known_module_keys IS
  'Module keys that existed when enabled_module_keys was saved. A module not in this list is newer than the saved selection and is shown by default.';

NOTIFY pgrst, 'reload schema';
