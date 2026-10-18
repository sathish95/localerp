-- STEP176: ThingsAlive Wiki — Phase 9 (image & file attachments)
--
-- Mirrors src/lib/landingPageStorage.js's exact upload pattern (public
-- bucket + getPublicUrl, STEP80's storage.buckets/storage.objects idiom),
-- against a new 'wiki-attachments' bucket. Object paths are namespaced
-- `<organization_id>/<page_id>/<filename>` so the storage policies can
-- enforce org isolation via storage.foldername() without re-implementing
-- full page-restriction logic at the storage layer.

CREATE TABLE IF NOT EXISTS wiki_page_attachments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL DEFAULT current_org_id() REFERENCES organizations(id),
  page_id         UUID NOT NULL,   -- soft ref -> wiki_pages(id)
  storage_path    TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  mime_type       TEXT,
  size_bytes      BIGINT,
  uploaded_by     UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wiki_page_attachments_page_idx ON wiki_page_attachments(page_id);

ALTER TABLE wiki_page_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wiki_page_attachments_select ON wiki_page_attachments;
DROP POLICY IF EXISTS wiki_page_attachments_write  ON wiki_page_attachments;
CREATE POLICY wiki_page_attachments_select ON wiki_page_attachments FOR SELECT USING (
  organization_id = current_org_id() AND wiki_page_permitted(page_id, 'view')
);
CREATE POLICY wiki_page_attachments_write ON wiki_page_attachments FOR ALL
  USING (organization_id = current_org_id() AND wiki_page_permitted(page_id, 'edit'))
  WITH CHECK (organization_id = current_org_id() AND wiki_page_permitted(page_id, 'edit'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wiki_page_attachments TO authenticated;

INSERT INTO storage.buckets (id, name, public) VALUES ('wiki-attachments', 'wiki-attachments', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS wiki_attachments_select ON storage.objects;
DROP POLICY IF EXISTS wiki_attachments_insert ON storage.objects;
DROP POLICY IF EXISTS wiki_attachments_delete ON storage.objects;

-- Public read (images need to render inline in the editor without an
-- auth header, same trust level as landing-assets). Write scoped to the
-- caller's own org via the path's first folder segment.
CREATE POLICY wiki_attachments_select ON storage.objects FOR SELECT USING (bucket_id = 'wiki-attachments');
CREATE POLICY wiki_attachments_insert ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'wiki-attachments' AND (storage.foldername(name))[1] = current_org_id()::text
);
CREATE POLICY wiki_attachments_delete ON storage.objects FOR DELETE USING (
  bucket_id = 'wiki-attachments' AND (storage.foldername(name))[1] = current_org_id()::text
);

NOTIFY pgrst, 'reload schema';
