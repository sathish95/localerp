-- STEP271 — Email Intelligence: duplicates and revision chains
--
-- Every received file stays its own record. Related records share a
-- version_group_id; exactly one per chain is current (is_current). Rules are
-- in supabase/functions/_shared/eiVersions.js (relateDocument):
--   EXACT_DUPLICATE / NEW_REVISION / OLDER_REVISION  → linked automatically
--   SAME_REVISION / SIMILAR                          → SUGGESTED, a person confirms or rejects
-- Nothing is deleted or overwritten; a superseded version stays readable.
-- Run after STEP263–270. Re-runnable.

ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS version_group_id    UUID;
ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS is_current          BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS superseded_by_id    UUID;
ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS version_relation    TEXT;
ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS related_document_id UUID;
ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS version_confidence  NUMERIC(4,3);
ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS version_reason      TEXT;
ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS version_link_state  TEXT NOT NULL DEFAULT 'NONE';
DO $$ BEGIN
  ALTER TABLE ei_attachments ADD CONSTRAINT ei_attachments_version_state_chk CHECK (version_link_state IN ('NONE','AUTO','SUGGESTED','CONFIRMED','REJECTED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- same normalisation as normNumber() in eiVersions.js
DO $$ BEGIN
  ALTER TABLE ei_attachments ADD COLUMN doc_number_norm TEXT GENERATED ALWAYS AS
    (NULLIF(regexp_replace(regexp_replace(upper(COALESCE(document_number, '')), '^(NO|NUMBER|REF)[[:space:].:#-]+', ''), '[^A-Z0-9]', '', 'g'), '')) STORED;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ei_attachments_docnorm ON ei_attachments (organization_id, doc_number_norm) WHERE doc_number_norm IS NOT NULL;
CREATE INDEX IF NOT EXISTS ei_attachments_vgroup ON ei_attachments (version_group_id) WHERE version_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ei_attachments_vsuggested ON ei_attachments (organization_id) WHERE version_link_state = 'SUGGESTED';

-- Make p_new the current version of its group (everything else in the group is superseded by it)
CREATE OR REPLACE FUNCTION _ei_make_current(p_new UUID, p_group UUID) RETURNS VOID AS $$
  UPDATE ei_attachments SET is_current = (id = p_new),
    superseded_by_id = CASE WHEN id = p_new THEN NULL WHEN is_current THEN p_new ELSE superseded_by_id END,
    updated_at = now()
  WHERE version_group_id = p_group
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;
REVOKE EXECUTE ON FUNCTION _ei_make_current(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Worker (service role): record the relation found for a new document.
CREATE OR REPLACE FUNCTION ei_link_document_version(p_id UUID, p_relation TEXT, p_related UUID, p_group UUID, p_confidence NUMERIC, p_reason TEXT)
RETURNS VOID AS $$
DECLARE a ei_attachments; r ei_attachments; v_group UUID;
BEGIN
  SELECT * INTO a FROM ei_attachments WHERE id = p_id FOR UPDATE;
  SELECT * INTO r FROM ei_attachments WHERE id = p_related FOR UPDATE;
  IF a.id IS NULL OR r.id IS NULL OR a.organization_id <> r.organization_id OR a.id = r.id THEN RETURN; END IF;
  IF p_relation IN ('EXACT_DUPLICATE','NEW_REVISION','OLDER_REVISION') THEN
    v_group := COALESCE(r.version_group_id, p_group, r.id);
    UPDATE ei_attachments SET version_group_id = v_group WHERE id = r.id AND version_group_id IS NULL;
    UPDATE ei_attachments SET version_group_id = v_group, version_relation = p_relation, related_document_id = r.id,
      version_confidence = p_confidence, version_reason = left(p_reason, 300), version_link_state = 'AUTO',
      is_current = false, updated_at = now()
    WHERE id = a.id;
    IF p_relation = 'NEW_REVISION' THEN PERFORM _ei_make_current(a.id, v_group);
    ELSIF p_relation = 'EXACT_DUPLICATE' THEN UPDATE ei_attachments SET superseded_by_id = NULL WHERE id = a.id;   -- a copy, not a version
    END IF;
  ELSIF p_relation IN ('SAME_REVISION','SIMILAR') THEN
    UPDATE ei_attachments SET version_relation = p_relation, related_document_id = r.id, version_confidence = p_confidence,
      version_reason = left(p_reason, 300), version_link_state = 'SUGGESTED', updated_at = now()
    WHERE id = a.id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE EXECUTE ON FUNCTION ei_link_document_version(UUID, TEXT, UUID, UUID, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ei_link_document_version(UUID, TEXT, UUID, UUID, NUMERIC, TEXT) TO service_role;

-- Reviewer: confirm or reject a suggested link. Confirming makes the newer
-- document (by received time) the current version of the chain.
CREATE OR REPLACE FUNCTION ei_document_version_decide(p_id UUID, p_accept BOOLEAN, p_note TEXT DEFAULT NULL) RETURNS VOID AS $$
DECLARE a ei_attachments; r ei_attachments; v_group UUID; v_newer UUID;
BEGIN
  SELECT * INTO a FROM ei_attachments WHERE id = p_id FOR UPDATE;
  IF a.id IS NULL OR a.organization_id <> current_org_id() OR NOT _ei_can_view() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF a.version_link_state <> 'SUGGESTED' OR a.related_document_id IS NULL THEN RAISE EXCEPTION 'Nothing to decide for this document'; END IF;
  SELECT * INTO r FROM ei_attachments WHERE id = a.related_document_id FOR UPDATE;
  IF p_accept AND r.id IS NOT NULL THEN
    v_group := COALESCE(r.version_group_id, r.id);
    UPDATE ei_attachments SET version_group_id = v_group WHERE id IN (a.id, r.id);
    UPDATE ei_attachments SET version_link_state = 'CONFIRMED', updated_at = now() WHERE id = a.id;
    v_newer := CASE WHEN a.created_at >= r.created_at THEN a.id ELSE r.id END;
    PERFORM _ei_make_current(v_newer, v_group);
  ELSE
    UPDATE ei_attachments SET version_link_state = 'REJECTED', updated_at = now() WHERE id = a.id;
  END IF;
  PERFORM _outlook_log(a.organization_id, (SELECT mailbox_id FROM outlook_email_messages WHERE id = a.message_id), a.message_id,
    CASE WHEN p_accept THEN 'DOCUMENT_VERSION_CONFIRMED' ELSE 'DOCUMENT_VERSION_REJECTED' END,
    jsonb_build_object('attachment_id', a.id, 'related', a.related_document_id, 'relation', a.version_relation, 'note', left(p_note, 200)));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Can the caller read this document? (EI viewers, or members of its filed project)
CREATE OR REPLACE FUNCTION _ei_can_read_document(p_id UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM ei_attachments a WHERE a.id = p_id AND a.organization_id = current_org_id()
     AND (_ei_can_view() OR (a.project_id IS NOT NULL AND a.project_status IN ('MATCHED','CONFIRMED') AND _ei_project_member(a.project_id))))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Version history of a document's chain, oldest first
CREATE OR REPLACE FUNCTION ei_document_versions(p_id UUID)
RETURNS TABLE (id UUID, file_name TEXT, title TEXT, document_number TEXT, revision TEXT, is_current BOOLEAN, version_relation TEXT,
               version_link_state TEXT, superseded_by_id UUID, storage_path TEXT, sender_email TEXT, received_at TIMESTAMPTZ, created_at TIMESTAMPTZ) AS $$
DECLARE v_group UUID;
BEGIN
  IF NOT _ei_can_read_document(p_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT COALESCE(a.version_group_id, a.id) INTO v_group FROM ei_attachments a WHERE a.id = p_id;
  RETURN QUERY
  SELECT a.id, a.file_name, a.title, a.document_number, a.revision, a.is_current, a.version_relation, a.version_link_state, a.superseded_by_id,
         CASE WHEN _ei_can_read_document(a.id) THEN a.storage_path END, m.sender_email, m.received_at, a.created_at
  FROM ei_attachments a LEFT JOIN outlook_email_messages m ON m.id = a.message_id
  WHERE a.organization_id = current_org_id() AND (a.version_group_id = v_group OR a.id = v_group OR a.id = p_id)
  ORDER BY COALESCE(m.received_at, a.created_at);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- Suggested links waiting for a person
CREATE OR REPLACE FUNCTION ei_version_suggestions() RETURNS TABLE (
  id UUID, file_name TEXT, title TEXT, document_number TEXT, revision TEXT, version_relation TEXT, version_reason TEXT, version_confidence NUMERIC,
  related_id UUID, related_file TEXT, related_revision TEXT, related_received TIMESTAMPTZ, project_id UUID, created_at TIMESTAMPTZ) AS $$
  SELECT a.id, a.file_name, a.title, a.document_number, a.revision, a.version_relation, a.version_reason, a.version_confidence,
         r.id, r.file_name, r.revision, r.created_at, a.project_id, a.created_at
  FROM ei_attachments a JOIN ei_attachments r ON r.id = a.related_document_id
  WHERE a.organization_id = current_org_id() AND a.version_link_state = 'SUGGESTED' AND _ei_can_view()
  ORDER BY a.created_at DESC LIMIT 500
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Project workspace now also returns version information
DROP FUNCTION IF EXISTS ei_project_documents(UUID, BOOLEAN);
CREATE OR REPLACE FUNCTION ei_project_documents(p_project UUID, p_include_suggested BOOLEAN DEFAULT false)
RETURNS TABLE (
  id UUID, file_name TEXT, content_type TEXT, size_bytes BIGINT, storage_path TEXT, title TEXT,
  doc_type_code TEXT, doc_type_name TEXT, doc_confidence NUMERIC, document_number TEXT, document_date DATE, revision TEXT,
  area TEXT, primary_module TEXT, related_modules TEXT[], project_status TEXT, project_method TEXT, project_confidence NUMERIC,
  vendor_id UUID, invoice_id UUID, po_id UUID, extraction JSONB, review_state TEXT,
  message_id UUID, subject TEXT, sender_email TEXT, sender_name TEXT, received_at TIMESTAMPTZ, web_link TEXT, created_at TIMESTAMPTZ,
  version_group_id UUID, is_current BOOLEAN, version_relation TEXT, version_link_state TEXT, superseded_by_id UUID, versions INT
) AS $$
BEGIN
  IF NOT _ei_project_member(p_project) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
  SELECT a.id, a.file_name, a.content_type, a.size_bytes, a.storage_path, a.title,
         a.doc_type_code, dt.name, a.doc_confidence, a.document_number, a.document_date, a.revision,
         a.area, a.primary_module, a.related_modules, a.project_status, a.project_method, a.project_confidence,
         a.vendor_id, a.invoice_id, a.po_id, a.extraction, a.review_state,
         a.message_id, m.subject, m.sender_email, m.sender_name, m.received_at, m.web_link, a.created_at,
         a.version_group_id, a.is_current, a.version_relation, a.version_link_state, a.superseded_by_id,
         CASE WHEN a.version_group_id IS NULL THEN 1 ELSE (SELECT count(*)::int FROM ei_attachments g WHERE g.version_group_id = a.version_group_id) END
  FROM ei_attachments a
  LEFT JOIN outlook_email_messages m ON m.id = a.message_id
  LEFT JOIN ei_document_types dt ON dt.organization_id = a.organization_id AND dt.code = a.doc_type_code
  WHERE a.organization_id = current_org_id() AND a.project_id = p_project AND a.status = 'PROCESSED'
    AND (a.project_status IN ('MATCHED','CONFIRMED') OR (p_include_suggested AND _ei_can_view() AND a.project_status = 'SUGGESTED'))
  ORDER BY COALESCE(m.received_at, a.created_at) DESC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION ei_project_documents(UUID, BOOLEAN), ei_document_versions(UUID), ei_version_suggestions(),
  ei_document_version_decide(UUID, BOOLEAN, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
