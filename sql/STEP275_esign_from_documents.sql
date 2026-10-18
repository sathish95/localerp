-- STEP275 — Open a received document in Agreements & e-Sign
--
-- "Open file" on a document filed by Email Intelligence (Documents tab,
-- document filing, exceptions) opens it in Agreements & e-Sign: the first time
-- it becomes an agreement draft built from that PDF (source = UPLOAD, project
-- kept), later clicks reopen the same agreement. The link is
-- esign_documents.source_attachment_id (soft ref to ei_attachments, one
-- agreement per document). Needs STEP273. Re-runnable.

ALTER TABLE esign_documents ADD COLUMN IF NOT EXISTS source_attachment_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS esign_documents_source_attachment_uq
  ON esign_documents(organization_id, source_attachment_id) WHERE source_attachment_id IS NOT NULL;

-- STEP273 limits client inserts to named columns; add the new one.
GRANT INSERT (source_attachment_id) ON esign_documents TO authenticated;

NOTIFY pgrst, 'reload schema';
