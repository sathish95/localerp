-- STEP172: ThingsAlive Wiki — Phase 5 (version history)
--
-- Clone of product_bom_versions' shape (sql/STEP52_product_bom_versioning.sql):
-- one row per save, exactly one 'active' per page (enforced by the partial
-- unique index), written through a SECURITY DEFINER RPC that does the
-- archive-old + insert-new atomically (the Supabase JS client has no
-- multi-statement transaction of its own).

ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS current_version_no INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS wiki_page_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  page_id         UUID NOT NULL,   -- soft ref -> wiki_pages(id)
  version_no      INT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  ydoc_state      BYTEA,
  content_text    TEXT,
  edited_by       UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (page_id, version_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS wiki_page_versions_active_idx ON wiki_page_versions(page_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS wiki_page_versions_page_idx ON wiki_page_versions(page_id);

ALTER TABLE wiki_page_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wiki_page_versions_select ON wiki_page_versions;
DROP POLICY IF EXISTS wiki_page_versions_write  ON wiki_page_versions;
CREATE POLICY wiki_page_versions_select ON wiki_page_versions FOR SELECT USING (organization_id = current_org_id());
-- Row-level writes are still gated (defence in depth), but every real
-- write goes through save_wiki_page_version() below.
CREATE POLICY wiki_page_versions_write ON wiki_page_versions FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

GRANT SELECT ON public.wiki_page_versions TO authenticated;

CREATE OR REPLACE FUNCTION save_wiki_page_version(
  p_page_id      UUID,
  p_ydoc_state   BYTEA,
  p_content_text TEXT,
  p_user_id      UUID
) RETURNS UUID AS $$
DECLARE
  v_org   UUID;
  v_next  INT;
  v_id    UUID;
BEGIN
  SELECT organization_id INTO v_org FROM wiki_pages WHERE id = p_page_id;
  IF v_org IS NULL OR v_org <> current_org_id() THEN
    RAISE EXCEPTION 'Page not found';
  END IF;

  SELECT COALESCE(MAX(version_no), 0) + 1 INTO v_next FROM wiki_page_versions WHERE page_id = p_page_id;

  UPDATE wiki_page_versions SET status = 'archived' WHERE page_id = p_page_id AND status = 'active';

  INSERT INTO wiki_page_versions (page_id, organization_id, version_no, status, ydoc_state, content_text, edited_by)
    VALUES (p_page_id, v_org, v_next, 'active', p_ydoc_state, p_content_text, p_user_id)
    RETURNING id INTO v_id;

  UPDATE wiki_pages SET current_version_no = v_next WHERE id = p_page_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION save_wiki_page_version(UUID, BYTEA, TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
