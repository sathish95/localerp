-- ============================================================
-- STEP205: Wiki "action items" — typing `/task <description>` (optionally
-- with an @mention for the assignee) on its own line in a wiki page and
-- pressing Enter auto-creates a linked project_tasks row, right from the
-- editor (src/components/wiki/actionItemExtension.js).
--
-- source_wiki_page_id is a soft ref (plain UUID, this repo's convention
-- for referencing project_tasks/wiki_pages — see STEP182's header on why
-- neither table has a tracked base CREATE TABLE to hang a hard FK off).
-- Purely for traceability ("which wiki page did this task come from") —
-- nothing enforces it and no RLS depends on it.
-- ============================================================

ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS source_wiki_page_id UUID;
CREATE INDEX IF NOT EXISTS project_tasks_source_wiki_page_idx ON project_tasks(source_wiki_page_id);

NOTIFY pgrst, 'reload schema';
