-- STEP170: ThingsAlive Wiki — Phase 3 (@mentions)
--
-- mentions records who is currently @mentioned in a page's content, so a
-- save can diff against it and notify only NEWLY-added mentions (not
-- re-notify everyone every autosave). Array column, same convention as
-- spend_findings.related_department_ids.

ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS mentions UUID[] NOT NULL DEFAULT '{}';

NOTIFY pgrst, 'reload schema';
