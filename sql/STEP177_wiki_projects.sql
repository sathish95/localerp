-- STEP177: ThingsAlive Wiki — link Projects into the Wiki
--
-- Two independent links, both soft refs to `projects`:
--   wiki_spaces.project_id  — set when a space was auto-created FOR a
--                             project (one space per project, enforced by
--                             the partial unique index below). Manually
--                             created team/topic spaces leave this NULL.
--   wiki_pages.project_id   — optional per-page tag, independent of which
--                             space the page lives in (a page in a
--                             non-project space can still reference a
--                             project). Pre-filled client-side from the
--                             space's project_id when creating a page
--                             inside a project space, but always
--                             changeable.

ALTER TABLE wiki_spaces ADD COLUMN IF NOT EXISTS project_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS wiki_spaces_project_idx ON wiki_spaces(project_id) WHERE project_id IS NOT NULL;

ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS project_id UUID;
CREATE INDEX IF NOT EXISTS wiki_pages_project_idx ON wiki_pages(project_id);

NOTIFY pgrst, 'reload schema';
