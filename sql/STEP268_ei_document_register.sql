-- STEP268 — Email Intelligence: document register + project document workspace
--
-- ei_attachments (STEP265) stays the ONE canonical record per received file;
-- this step adds what is needed to file it:
--   • header data: title, document_number, document_date, revision
--   • workspace area + primary / related app modules (from the document type)
--   • project mapping with its own status / method / confidence / candidates
--   • review_state = what a person still has to confirm (type, project, both)
-- Mapping a document never approves or changes the business record it relates to.
--
-- Access
--   • Email Intelligence viewers (_ei_can_view: admin, ceo, finance, manager,
--     department_head) see every document, as before.
--   • Project members additionally see documents filed (MATCHED / CONFIRMED)
--     on a project they can access, through ei_project_documents() and the
--     storage policy below — never the unassigned queue.
--   • Filing changes go only through ei_document_set_project / ei_document_set_type.
--
-- Run after STEP261–265. Re-runnable.

-- ── 1. document register columns ──
ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS title              TEXT;
ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS document_number    TEXT;
ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS document_date      DATE;
ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS revision           TEXT;
ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS area               TEXT NOT NULL DEFAULT 'OTHER';
ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS primary_module     TEXT;
ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS related_modules    TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS project_status     TEXT NOT NULL DEFAULT 'UNASSIGNED';
ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS project_method     TEXT;
ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS project_confidence NUMERIC(4,3);
ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS project_candidates JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS project_reason     TEXT;
ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS review_state       TEXT NOT NULL DEFAULT 'OK';
ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS conversation_id    TEXT;
ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS filed_by           UUID;
ALTER TABLE ei_attachments ADD COLUMN IF NOT EXISTS filed_at           TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE ei_attachments ADD CONSTRAINT ei_attachments_project_status_chk
    CHECK (project_status IN ('MATCHED','CONFIRMED','SUGGESTED','AMBIGUOUS','UNASSIGNED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE ei_attachments ADD CONSTRAINT ei_attachments_review_state_chk
    CHECK (review_state IN ('OK','NEEDS_TYPE','NEEDS_PROJECT','NEEDS_BOTH'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ei_attachments_project ON ei_attachments (project_id, area) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ei_attachments_review ON ei_attachments (organization_id, review_state) WHERE review_state <> 'OK';
CREATE INDEX IF NOT EXISTS ei_attachments_conv ON ei_attachments (organization_id, conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ei_attachments_docnum ON ei_attachments (organization_id, upper(document_number)) WHERE document_number IS NOT NULL;

-- ── 2. filing defaults on document types (editable in the configuration centre) ──
ALTER TABLE ei_document_types ADD COLUMN IF NOT EXISTS area            TEXT;
ALTER TABLE ei_document_types ADD COLUMN IF NOT EXISTS primary_module  TEXT;
ALTER TABLE ei_document_types ADD COLUMN IF NOT EXISTS related_modules TEXT[] NOT NULL DEFAULT '{}';

-- Same table as DOC_TYPE_MAPPING in supabase/functions/_shared/eiDocuments.js
CREATE TEMP TABLE _ei_doc_map (code TEXT, area TEXT, primary_module TEXT, related TEXT[]) ON COMMIT DROP;
INSERT INTO _ei_doc_map VALUES
  ('TAX_INVOICE','FINANCE','invoices','{procurement,projects}'), ('PROFORMA_INVOICE','FINANCE','invoices','{procurement}'),
  ('REVISED_INVOICE','FINANCE','invoices','{procurement}'), ('CREDIT_NOTE','FINANCE','invoices','{payments}'),
  ('DEBIT_NOTE','FINANCE','invoices','{payments}'), ('PURCHASE_ORDER','PROCUREMENT','pos','{procurement,projects}'),
  ('PURCHASE_REQUISITION','PROCUREMENT','procurement','{projects}'), ('QUOTATION','PROCUREMENT','procurement','{vendors}'),
  ('GOODS_RECEIPT_NOTE','LOGISTICS','grn','{pos,inventory}'), ('DELIVERY_CHALLAN','LOGISTICS','delivery-notes','{grn,pos}'),
  ('PACKING_LIST','LOGISTICS','delivery-notes','{grn}'), ('PROOF_OF_DELIVERY','LOGISTICS','delivery-notes','{projects,customer-invoices}'),
  ('PAYMENT_ADVICE','FINANCE','payments','{invoices}'), ('VENDOR_STATEMENT','FINANCE','invoices','{vendors,payments}'),
  ('BANK_CONFIRMATION','FINANCE','vendors','{payments}'), ('TAX_CERTIFICATE','FINANCE','vendors','{invoices}'),
  ('VENDOR_REGISTRATION','PROCUREMENT','vendors','{}'), ('CONTRACT','TENDER_CONTRACT','projects','{vendors,customers}'),
  ('PURCHASE_AGREEMENT','TENDER_CONTRACT','procurement','{vendors}'), ('WORK_ORDER','TENDER_CONTRACT','projects','{pos}'),
  ('COMPLETION_CERTIFICATE','HANDOVER','projects','{customer-invoices}'), ('MEASUREMENT_SHEET','SITE','projects','{customer-invoices}'),
  ('PROJECT_EXPENSE_EVIDENCE','FINANCE','expenses','{projects}'), ('SERVICE_REPORT','OPERATIONS','projects','{golive-support}'),
  ('MAINTENANCE_REPORT','OPERATIONS','assets','{projects}'), ('WARRANTY_DOCUMENT','OPERATIONS','warranty','{assets}'),
  ('INSURANCE_CERTIFICATE','SAFETY_COMPLIANCE','vendors','{projects}'), ('COMPLIANCE_CERTIFICATE','SAFETY_COMPLIANCE','projects','{vendors}'),
  ('SPREADSHEET','OTHER',NULL,'{}'), ('SUPPORTING_PHOTOGRAPH','SITE','projects','{}'),
  ('GENERAL_ATTACHMENT','OTHER',NULL,'{}'), ('UNKNOWN_DOCUMENT','OTHER',NULL,'{}');

UPDATE ei_document_types d SET area = m.area, primary_module = m.primary_module, related_modules = m.related
FROM _ei_doc_map m WHERE d.code = m.code AND d.area IS NULL;

-- ── 3. backfill documents received before this step ──
UPDATE ei_attachments a SET
  area = COALESCE(m.area, 'OTHER'), primary_module = m.primary_module, related_modules = COALESCE(m.related, '{}'),
  project_status = CASE WHEN a.project_id IS NOT NULL THEN 'MATCHED' ELSE 'UNASSIGNED' END,
  project_method = CASE WHEN a.project_id IS NOT NULL THEN 'PO' END,
  project_confidence = CASE WHEN a.project_id IS NOT NULL THEN 0.95 END,
  review_state = CASE
    WHEN (a.doc_type_code IS NULL OR a.doc_type_code = 'UNKNOWN_DOCUMENT') AND a.project_id IS NULL THEN 'NEEDS_BOTH'
    WHEN a.doc_type_code IS NULL OR a.doc_type_code = 'UNKNOWN_DOCUMENT' THEN 'NEEDS_TYPE'
    WHEN a.project_id IS NULL THEN 'NEEDS_PROJECT' ELSE 'OK' END,
  title = COALESCE(a.title, regexp_replace(a.file_name, '\.[A-Za-z0-9]{1,5}$', '')),
  document_number = COALESCE(a.document_number, a.extraction #>> '{invoice_number,value}', a.extraction #>> '{po_number,value}')
FROM ei_attachments a2 LEFT JOIN _ei_doc_map m ON m.code = a2.doc_type_code
WHERE a.id = a2.id AND a.status = 'PROCESSED' AND a.filed_at IS NULL AND a.primary_module IS NULL;

UPDATE ei_attachments a SET conversation_id = m.conversation_id
FROM outlook_email_messages m WHERE m.id = a.message_id AND a.conversation_id IS NULL;

-- Skipped / failed files are not documents to review
UPDATE ei_attachments SET review_state = 'OK' WHERE status IN ('SKIPPED','FAILED');

-- ── 4. access helpers ──
-- Can the caller see this project's documents? Management roles: any project
-- in the org; everyone else: projects they are assigned to.
CREATE OR REPLACE FUNCTION _ei_project_member(p_project UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM projects p WHERE p.id = p_project AND p.organization_id = current_org_id())
     AND (_ei_can_view()
          OR EXISTS (SELECT 1 FROM project_assignments pa WHERE pa.project_id = p_project AND pa.user_id = auth.uid()))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- File in the email-attachments bucket readable by the caller as a filed project document
CREATE OR REPLACE FUNCTION _ei_can_open_document(p_name TEXT) RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM ei_attachments a
                 WHERE a.storage_path = p_name AND a.organization_id = current_org_id()
                   AND a.project_id IS NOT NULL AND a.project_status IN ('MATCHED','CONFIRMED')
                   AND _ei_project_member(a.project_id))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

DROP POLICY IF EXISTS "email attachments project members" ON storage.objects;
CREATE POLICY "email attachments project members" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'email-attachments' AND _ei_can_open_document(name));

-- ── 5. project document workspace ──
-- Filed documents of one project + their email header. p_include_suggested
-- also returns documents only SUGGESTED for this project (EI viewers only).
CREATE OR REPLACE FUNCTION ei_project_documents(p_project UUID, p_include_suggested BOOLEAN DEFAULT false)
RETURNS TABLE (
  id UUID, file_name TEXT, content_type TEXT, size_bytes BIGINT, storage_path TEXT, title TEXT,
  doc_type_code TEXT, doc_type_name TEXT, doc_confidence NUMERIC, document_number TEXT, document_date DATE, revision TEXT,
  area TEXT, primary_module TEXT, related_modules TEXT[], project_status TEXT, project_method TEXT, project_confidence NUMERIC,
  vendor_id UUID, invoice_id UUID, po_id UUID, extraction JSONB, review_state TEXT,
  message_id UUID, subject TEXT, sender_email TEXT, sender_name TEXT, received_at TIMESTAMPTZ, web_link TEXT, created_at TIMESTAMPTZ
) AS $$
BEGIN
  IF NOT _ei_project_member(p_project) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
  SELECT a.id, a.file_name, a.content_type, a.size_bytes, a.storage_path, a.title,
         a.doc_type_code, dt.name, a.doc_confidence, a.document_number, a.document_date, a.revision,
         a.area, a.primary_module, a.related_modules, a.project_status, a.project_method, a.project_confidence,
         a.vendor_id, a.invoice_id, a.po_id, a.extraction, a.review_state,
         a.message_id, m.subject, m.sender_email, m.sender_name, m.received_at, m.web_link, a.created_at
  FROM ei_attachments a
  LEFT JOIN outlook_email_messages m ON m.id = a.message_id
  LEFT JOIN ei_document_types dt ON dt.organization_id = a.organization_id AND dt.code = a.doc_type_code
  WHERE a.organization_id = current_org_id() AND a.project_id = p_project AND a.status = 'PROCESSED'
    AND (a.project_status IN ('MATCHED','CONFIRMED') OR (p_include_suggested AND _ei_can_view() AND a.project_status = 'SUGGESTED'))
  ORDER BY COALESCE(m.received_at, a.created_at) DESC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- ── 6. reviewer actions ──
-- File a document on a project (or clear it with p_project = NULL).
CREATE OR REPLACE FUNCTION ei_document_set_project(p_id UUID, p_project UUID, p_note TEXT DEFAULT NULL) RETURNS VOID AS $$
DECLARE a ei_attachments; v_type_ok BOOLEAN;
BEGIN
  SELECT * INTO a FROM ei_attachments WHERE id = p_id FOR UPDATE;
  IF a.id IS NULL OR a.organization_id <> current_org_id() OR NOT _ei_can_view() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_project IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects WHERE id = p_project AND organization_id = a.organization_id) THEN
    RAISE EXCEPTION 'Project not found';
  END IF;
  v_type_ok := a.review_state NOT IN ('NEEDS_TYPE','NEEDS_BOTH');
  UPDATE ei_attachments SET
    project_id = p_project,
    project_status = CASE WHEN p_project IS NULL THEN 'UNASSIGNED' ELSE 'CONFIRMED' END,
    project_method = CASE WHEN p_project IS NULL THEN NULL ELSE 'MANUAL' END,
    project_confidence = CASE WHEN p_project IS NULL THEN NULL ELSE 1 END,
    project_reason = NULLIF(trim(p_note), ''),
    review_state = CASE WHEN p_project IS NULL THEN (CASE WHEN v_type_ok THEN 'NEEDS_PROJECT' ELSE 'NEEDS_BOTH' END)
                        ELSE (CASE WHEN v_type_ok THEN 'OK' ELSE 'NEEDS_TYPE' END) END,
    filed_by = auth.uid(), filed_at = now(), updated_at = now()
  WHERE id = p_id;
  PERFORM _outlook_log(a.organization_id, (SELECT mailbox_id FROM outlook_email_messages WHERE id = a.message_id), a.message_id,
    CASE WHEN p_project IS NULL THEN 'DOCUMENT_UNFILED' ELSE 'DOCUMENT_FILED' END,
    jsonb_build_object('attachment_id', p_id, 'file', a.file_name, 'from_project', a.project_id, 'to_project', p_project, 'note', left(p_note, 200)));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Confirm / correct a document's type; re-applies the type's area and modules.
CREATE OR REPLACE FUNCTION ei_document_set_type(p_id UUID, p_code TEXT, p_note TEXT DEFAULT NULL) RETURNS VOID AS $$
DECLARE a ei_attachments; dt ei_document_types; v_proj_ok BOOLEAN;
BEGIN
  SELECT * INTO a FROM ei_attachments WHERE id = p_id FOR UPDATE;
  IF a.id IS NULL OR a.organization_id <> current_org_id() OR NOT _ei_can_view() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT * INTO dt FROM ei_document_types WHERE organization_id = a.organization_id AND code = p_code;
  IF dt.id IS NULL THEN RAISE EXCEPTION 'Unknown document type %', p_code; END IF;
  v_proj_ok := a.project_status IN ('MATCHED','CONFIRMED');
  UPDATE ei_attachments SET
    doc_type_code = dt.code, doc_confidence = 1,
    doc_rules = COALESCE(doc_rules, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('name', 'Confirmed by reviewer', 'previous', a.doc_type_code)),
    area = COALESCE(dt.area, 'OTHER'), primary_module = dt.primary_module, related_modules = COALESCE(dt.related_modules, '{}'),
    review_state = CASE WHEN dt.code = 'UNKNOWN_DOCUMENT' THEN (CASE WHEN v_proj_ok THEN 'NEEDS_TYPE' ELSE 'NEEDS_BOTH' END)
                        WHEN v_proj_ok THEN 'OK' ELSE 'NEEDS_PROJECT' END,
    updated_at = now()
  WHERE id = p_id;
  PERFORM _outlook_log(a.organization_id, (SELECT mailbox_id FROM outlook_email_messages WHERE id = a.message_id), a.message_id, 'DOCUMENT_RETYPED',
    jsonb_build_object('attachment_id', p_id, 'file', a.file_name, 'from', a.doc_type_code, 'to', dt.code, 'note', left(p_note, 200)));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Per-project counts for the workspace badge / portfolio
CREATE OR REPLACE FUNCTION ei_document_counts() RETURNS TABLE (review_state TEXT, n BIGINT) AS $$
  SELECT a.review_state, count(*) FROM ei_attachments a
  WHERE a.organization_id = current_org_id() AND a.status = 'PROCESSED' AND _ei_can_view()
  GROUP BY a.review_state
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION ei_project_documents(UUID, BOOLEAN), ei_document_set_project(UUID, UUID, TEXT),
  ei_document_set_type(UUID, TEXT, TEXT), ei_document_counts() TO authenticated;

NOTIFY pgrst, 'reload schema';
