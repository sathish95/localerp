-- STEP171: ThingsAlive Wiki — Phase 4 (page comments)
--
-- Clone of task_comments' shape (sql/STEP28_task_comments.sql) — simple
-- table, soft FK to the page, fetch-on-mount + insert-then-refetch on the
-- client (no realtime subscription, matching task_comments' own
-- convention). `mentions` records who was @mentioned in THIS comment
-- (separate from wiki_pages.mentions, which tracks the page body).

CREATE TABLE IF NOT EXISTS wiki_page_comments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  page_id         UUID NOT NULL,   -- soft ref -> wiki_pages(id)
  user_id         UUID REFERENCES profiles(id),
  comment         TEXT NOT NULL,
  mentions        UUID[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wiki_page_comments_page_idx ON wiki_page_comments(page_id);

ALTER TABLE wiki_page_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wiki_page_comments_select ON wiki_page_comments;
DROP POLICY IF EXISTS wiki_page_comments_write  ON wiki_page_comments;
CREATE POLICY wiki_page_comments_select ON wiki_page_comments FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY wiki_page_comments_write  ON wiki_page_comments FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wiki_page_comments TO authenticated;

NOTIFY pgrst, 'reload schema';
