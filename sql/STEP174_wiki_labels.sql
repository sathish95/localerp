-- STEP174: ThingsAlive Wiki — Phase 7 (labels/tags)

CREATE TABLE IF NOT EXISTS wiki_labels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  name            TEXT NOT NULL,
  color           TEXT NOT NULL DEFAULT '#6366f1',
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS wiki_page_labels (
  page_id  UUID NOT NULL,   -- soft ref -> wiki_pages(id)
  label_id UUID NOT NULL,   -- soft ref -> wiki_labels(id)
  PRIMARY KEY (page_id, label_id)
);
CREATE INDEX IF NOT EXISTS wiki_page_labels_label_idx ON wiki_page_labels(label_id);

ALTER TABLE wiki_labels       ENABLE ROW LEVEL SECURITY;
ALTER TABLE wiki_page_labels  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wiki_labels_select ON wiki_labels;
DROP POLICY IF EXISTS wiki_labels_write  ON wiki_labels;
CREATE POLICY wiki_labels_select ON wiki_labels FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY wiki_labels_write  ON wiki_labels FOR ALL
  USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

DROP POLICY IF EXISTS wiki_page_labels_select ON wiki_page_labels;
DROP POLICY IF EXISTS wiki_page_labels_write  ON wiki_page_labels;
CREATE POLICY wiki_page_labels_select ON wiki_page_labels FOR SELECT USING (
  EXISTS (SELECT 1 FROM wiki_pages p WHERE p.id = page_id AND p.organization_id = current_org_id())
);
CREATE POLICY wiki_page_labels_write ON wiki_page_labels FOR ALL USING (
  EXISTS (SELECT 1 FROM wiki_pages p WHERE p.id = page_id AND p.organization_id = current_org_id())
) WITH CHECK (
  EXISTS (SELECT 1 FROM wiki_pages p WHERE p.id = page_id AND p.organization_id = current_org_id())
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wiki_labels TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wiki_page_labels TO authenticated;

NOTIFY pgrst, 'reload schema';
