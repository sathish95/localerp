-- STEP265 — Email Intelligence processing: attachments, extraction, matching,
-- invoice intake into the EXISTING invoices register, exception queue
-- (needs STEP261, STEP263)
--
--   outlook_email_messages  + intents (primary + secondary, with the rules
--                           that fired), config_version, attachment_count.
--   ei_attachments          one row per file in an email (unique per email +
--                           Graph attachment id): stored privately in the
--                           `email-attachments` bucket under <org>/<message>/,
--                           SHA-256, extracted text excerpt + method, document
--                           type + confidence + rules, extracted fields,
--                           validations, vendor / PO / GRN / project matches,
--                           duplicate candidate, created invoice, outcome,
--                           config version. Each attachment is classified on
--                           its own; they stay linked through message_id.
--   ei_exceptions           the review queue: one OPEN row per (email or
--                           attachment, kind) — a retry never adds a second.
--                           Kinds: VENDOR_VERIFICATION, PENDING_PO,
--                           PENDING_RECEIPT, DUPLICATE_REVIEW, REVISED_INVOICE,
--                           INVOICE_MISMATCH, DATA_VALIDATION, CREDIT_NOTE,
--                           CLASSIFICATION_REVIEW, EXTRACTION_REVIEW,
--                           BANK_DETAIL_CHANGE, VENDOR_MASTER_CHANGE,
--                           DOCUMENT_REVIEW, CATEGORY_REVIEW.
--   invoices                + source_email_id, source_attachment_id (UNIQUE —
--                           one invoice per attachment, whatever retries
--                           happen), revision_of_invoice_id, intake_notes.
--
-- ei_create_invoice() is the only automated writer to `invoices`: one
-- transaction, row lock on the attachment, ownership checks (vendor / PO /
-- project in the same org, PO belongs to the vendor), duplicate check
-- (vendor + invoice number), INSERT … ON CONFLICT (source_attachment_id),
-- status 'uploaded' — the existing lifecycle (verify → match → pay) and its
-- approvals are unchanged; nothing is approved, posted or paid
-- automatically. Safe to re-run.

-- Finance works the invoice exceptions, so it can read the emails, events and
-- review queue too (STEP261 had admin/ceo/manager/department_head).
CREATE OR REPLACE FUNCTION _outlook_can_view() RETURNS BOOLEAN AS $$
  SELECT COALESCE(_outlook_role() IN ('admin','ceo','manager','department_head','finance'), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

ALTER TABLE outlook_email_messages ADD COLUMN IF NOT EXISTS intents JSONB;
ALTER TABLE outlook_email_messages ADD COLUMN IF NOT EXISTS config_version INT;
ALTER TABLE outlook_email_messages ADD COLUMN IF NOT EXISTS attachment_count INT NOT NULL DEFAULT 0;
ALTER TABLE outlook_email_messages ADD COLUMN IF NOT EXISTS vendor_id UUID;   -- soft ref → vendors

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source_email_id UUID;          -- soft ref → outlook_email_messages
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source_attachment_id UUID;     -- soft ref → ei_attachments
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS revision_of_invoice_id UUID;   -- soft ref → invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS intake_notes TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_source_attachment ON invoices (source_attachment_id) WHERE source_attachment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS invoices_vendor_number ON invoices (organization_id, vendor_id, lower(invoice_number));

CREATE TABLE IF NOT EXISTS ei_attachments (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id       UUID        NOT NULL,
  message_id            UUID        NOT NULL,          -- soft ref → outlook_email_messages
  graph_attachment_id   TEXT        NOT NULL,
  file_name             TEXT,
  content_type          TEXT,
  size_bytes            BIGINT,
  sha256                TEXT,
  storage_path          TEXT,                          -- email-attachments/<org>/<message>/<id>-<name>
  status                TEXT        NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','STORED','SKIPPED','FAILED','PROCESSED')),
  skip_reason           TEXT,
  text_method           TEXT,                          -- PDF_TEXT | SHEET | TEXT | AI | NONE
  text_excerpt          TEXT,                          -- ≤ 20 000 chars, cleared after retention
  doc_type_code         TEXT,
  doc_confidence        NUMERIC(4,3),
  doc_rules             JSONB       NOT NULL DEFAULT '[]'::jsonb,
  extraction            JSONB,                         -- {field: {value, confidence, source}}
  extraction_confidence NUMERIC(4,3),
  validations           JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- [{check, ok, detail}]
  vendor_id             UUID,
  vendor_method         TEXT,
  vendor_confidence     NUMERIC(4,3),
  po_id                 UUID,
  grn_ids               UUID[]      NOT NULL DEFAULT '{}',
  project_id            UUID,
  duplicate_of_invoice_id UUID,
  invoice_id            UUID,
  outcome               TEXT,                          -- INVOICE_CREATED | EXCEPTION | RECORDED | SKIPPED
  outcome_reason        TEXT,
  config_version        INT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE (message_id, graph_attachment_id)
);
CREATE INDEX IF NOT EXISTS ei_attachments_org ON ei_attachments (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ei_attachments_sha ON ei_attachments (organization_id, sha256) WHERE sha256 IS NOT NULL;

CREATE TABLE IF NOT EXISTS ei_exceptions (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID        NOT NULL,
  message_id       UUID,
  attachment_id    UUID,
  kind             TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','DISMISSED')),
  priority         TEXT        NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  summary          TEXT        NOT NULL,
  detail           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  assigned_role    TEXT,                               -- finance / manager / admin … (queue)
  assigned_to      UUID,
  department_id    UUID,
  due_at           TIMESTAMPTZ,
  config_version   INT,
  resolved_by      UUID,
  resolved_at      TIMESTAMPTZ,
  resolution_note  TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ei_exceptions_open ON ei_exceptions (COALESCE(attachment_id, message_id), kind) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS ei_exceptions_org ON ei_exceptions (organization_id, status, created_at DESC);

ALTER TABLE ei_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ei_exceptions  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ei_attachments_select ON ei_attachments;
DROP POLICY IF EXISTS ei_exceptions_select ON ei_exceptions;
CREATE POLICY ei_attachments_select ON ei_attachments FOR SELECT USING (organization_id = current_org_id() AND _ei_can_view());
CREATE POLICY ei_exceptions_select  ON ei_exceptions  FOR SELECT USING (organization_id = current_org_id() AND _ei_can_view());
REVOKE INSERT, UPDATE, DELETE ON ei_attachments, ei_exceptions FROM anon, authenticated;

-- ── private storage for attachments ──────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('email-attachments', 'email-attachments', false, 26214400)
ON CONFLICT (id) DO UPDATE SET public = false;
DROP POLICY IF EXISTS "email attachments read" ON storage.objects;
CREATE POLICY "email attachments read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'email-attachments' AND (storage.foldername(name))[1] = current_org_id()::text AND _ei_can_view());
-- writes: service role only (no insert/update/delete policy for users)

-- ── service-role helpers ─────────────────────────────────────────────────
-- Upsert one exception (OPEN rows are unique per item + kind).
CREATE OR REPLACE FUNCTION ei_raise_exception(p_org UUID, p_message UUID, p_attachment UUID, p_kind TEXT, p_summary TEXT,
  p_detail JSONB DEFAULT '{}'::jsonb, p_priority TEXT DEFAULT 'medium', p_role TEXT DEFAULT NULL, p_department UUID DEFAULT NULL,
  p_due_hours INT DEFAULT NULL, p_version INT DEFAULT NULL)
RETURNS UUID AS $$
DECLARE v_id UUID; v_new BOOLEAN := false;
BEGIN
  SELECT id INTO v_id FROM ei_exceptions WHERE COALESCE(attachment_id, message_id) = COALESCE(p_attachment, p_message) AND kind = p_kind AND status = 'OPEN';
  IF v_id IS NULL THEN
    INSERT INTO ei_exceptions (organization_id, message_id, attachment_id, kind, summary, detail, priority, assigned_role, department_id, due_at, config_version)
    VALUES (p_org, p_message, p_attachment, p_kind, left(p_summary, 500), COALESCE(p_detail, '{}'),
            CASE WHEN p_priority IN ('low','medium','high','critical') THEN p_priority ELSE 'medium' END, p_role, p_department,
            CASE WHEN p_due_hours IS NOT NULL THEN now() + make_interval(hours => p_due_hours) END, p_version)
    ON CONFLICT DO NOTHING RETURNING id INTO v_id;
    v_new := v_id IS NOT NULL;
    IF v_id IS NULL THEN SELECT id INTO v_id FROM ei_exceptions WHERE COALESCE(attachment_id, message_id) = COALESCE(p_attachment, p_message) AND kind = p_kind AND status = 'OPEN'; END IF;
  ELSE
    UPDATE ei_exceptions SET summary = left(p_summary, 500), detail = COALESCE(p_detail, detail), updated_at = now() WHERE id = v_id;
  END IF;
  IF v_new THEN
    PERFORM _outlook_log(p_org, (SELECT mailbox_id FROM outlook_email_messages WHERE id = p_message), p_message, 'EXCEPTION_RAISED',
      jsonb_build_object('kind', p_kind, 'summary', left(p_summary, 200), 'attachment_id', p_attachment));
    -- tell the queue's people (role within the org), capped
    INSERT INTO notifications (recipient_id, type, title, body, link, organization_id)
    SELECT p.id, 'email_exception', 'Email needs attention: ' || replace(initcap(replace(p_kind, '_', ' ')), 'Po', 'PO'), left(p_summary, 250),
           '/email-to-tasks?tab=exceptions', p_org
      FROM profiles p
     WHERE p.organization_id = p_org AND p.is_active IS NOT FALSE AND p.role = COALESCE(p_role, 'finance')
     LIMIT 20;
  END IF;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- The only automated writer to `invoices`. Returns {status, invoice_id, …}:
--   CREATED / EXISTS (idempotent re-run) / DUPLICATE (vendor + number already
--   in the register) / INVALID (ownership check failed).
CREATE OR REPLACE FUNCTION ei_create_invoice(p_attachment UUID, p JSONB) RETURNS JSONB AS $$
DECLARE a ei_attachments; m outlook_email_messages; mb outlook_mailboxes; v vendors; po purchase_orders; v_inv UUID; v_dup UUID; v_num TEXT;
BEGIN
  SELECT * INTO a FROM ei_attachments WHERE id = p_attachment FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Attachment not found'; END IF;
  IF a.invoice_id IS NOT NULL THEN RETURN jsonb_build_object('status', 'EXISTS', 'invoice_id', a.invoice_id); END IF;
  SELECT id INTO v_inv FROM invoices WHERE source_attachment_id = p_attachment;
  IF v_inv IS NOT NULL THEN
    UPDATE ei_attachments SET invoice_id = v_inv, outcome = 'INVOICE_CREATED', updated_at = now() WHERE id = p_attachment;
    RETURN jsonb_build_object('status', 'EXISTS', 'invoice_id', v_inv);
  END IF;
  SELECT * INTO m FROM outlook_email_messages WHERE id = a.message_id;
  SELECT * INTO mb FROM outlook_mailboxes WHERE id = m.mailbox_id;
  v_num := NULLIF(trim(p->>'invoice_number'), '');
  IF v_num IS NULL OR NULLIF(p->>'total_amount', '') IS NULL THEN RETURN jsonb_build_object('status', 'INVALID', 'reason', 'Invoice number and total are required'); END IF;

  SELECT * INTO v FROM vendors WHERE id = (p->>'vendor_id')::uuid AND organization_id = a.organization_id;
  IF v.id IS NULL THEN RETURN jsonb_build_object('status', 'INVALID', 'reason', 'Vendor not found in this organization'); END IF;
  IF v.status::text <> 'active' THEN RETURN jsonb_build_object('status', 'INVALID', 'reason', 'Vendor is ' || v.status::text); END IF;
  IF NULLIF(p->>'po_id', '') IS NOT NULL THEN
    SELECT * INTO po FROM purchase_orders WHERE id = (p->>'po_id')::uuid AND organization_id = a.organization_id;
    IF po.id IS NULL THEN RETURN jsonb_build_object('status', 'INVALID', 'reason', 'PO not found in this organization'); END IF;
    IF po.vendor_id IS DISTINCT FROM v.id THEN RETURN jsonb_build_object('status', 'INVALID', 'reason', 'PO ' || po.po_number || ' belongs to a different vendor'); END IF;
  END IF;
  IF NULLIF(p->>'project_id', '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects WHERE id = (p->>'project_id')::uuid AND organization_id = a.organization_id) THEN
    RETURN jsonb_build_object('status', 'INVALID', 'reason', 'Project not found in this organization');
  END IF;

  -- duplicate: same vendor + invoice number already in the register (any source, any mailbox)
  PERFORM pg_advisory_xact_lock(hashtext('ei_invoice:' || v.id || ':' || lower(v_num)));
  SELECT id INTO v_dup FROM invoices WHERE organization_id = a.organization_id AND vendor_id = v.id AND lower(invoice_number) = lower(v_num)
     AND (NULLIF(p->>'revision_of_invoice_id', '') IS NULL OR id <> (p->>'revision_of_invoice_id')::uuid) LIMIT 1;
  IF v_dup IS NOT NULL THEN
    UPDATE ei_attachments SET duplicate_of_invoice_id = v_dup, updated_at = now() WHERE id = p_attachment;
    RETURN jsonb_build_object('status', 'DUPLICATE', 'invoice_id', v_dup);
  END IF;

  INSERT INTO invoices (invoice_number, vendor_id, vendor_name, po_id, grn_id, project_id, invoice_date, due_date, subtotal, gst_amount, total_amount,
                        currency, status, three_way_match, match_status, variance_percent, variance_notes, document_url, created_by, organization_id,
                        source_email_id, source_attachment_id, revision_of_invoice_id, intake_notes)
  VALUES (left(v_num, 60), v.id, v.name, po.id, NULLIF(p->>'grn_id', '')::uuid, COALESCE(NULLIF(p->>'project_id', '')::uuid, po.project_id),
          NULLIF(p->>'invoice_date', '')::date, NULLIF(p->>'due_date', '')::date, NULLIF(p->>'subtotal', '')::numeric,
          COALESCE(NULLIF(p->>'gst_amount', '')::numeric, 0), (p->>'total_amount')::numeric, COALESCE(NULLIF(p->>'currency', ''), 'INR'),
          'uploaded', COALESCE((p->>'three_way_match')::boolean, false), COALESCE(NULLIF(p->>'match_status', ''), 'unmatched'),
          NULLIF(p->>'variance_percent', '')::numeric, left(p->>'variance_notes', 500), NULL, mb.created_by, a.organization_id,
          a.message_id, a.id, NULLIF(p->>'revision_of_invoice_id', '')::uuid, left(p->>'intake_notes', 2000))
  ON CONFLICT (source_attachment_id) WHERE source_attachment_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_inv;
  IF v_inv IS NULL THEN SELECT id INTO v_inv FROM invoices WHERE source_attachment_id = p_attachment; END IF;

  UPDATE ei_attachments SET invoice_id = v_inv, outcome = 'INVOICE_CREATED', outcome_reason = NULL, updated_at = now() WHERE id = p_attachment;
  PERFORM _outlook_log(a.organization_id, m.mailbox_id, a.message_id, 'INVOICE_CREATED',
    jsonb_build_object('invoice_id', v_inv, 'invoice_number', v_num, 'vendor_id', v.id, 'po_id', po.id, 'attachment_id', a.id));
  RETURN jsonb_build_object('status', 'CREATED', 'invoice_id', v_inv);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── reviewer actions (admin / ceo / finance / manager / department_head) ──
CREATE OR REPLACE FUNCTION ei_resolve_exception(p_id UUID, p_status TEXT, p_note TEXT) RETURNS VOID AS $$
DECLARE e ei_exceptions;
BEGIN
  SELECT * INTO e FROM ei_exceptions WHERE id = p_id;
  IF e.id IS NULL OR e.organization_id <> current_org_id() OR NOT _ei_can_view() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_status NOT IN ('RESOLVED','DISMISSED') THEN RAISE EXCEPTION 'Bad status'; END IF;
  IF NULLIF(trim(p_note), '') IS NULL THEN RAISE EXCEPTION 'A resolution note is required'; END IF;
  -- sensitive vendor-master items: only admin / ceo / finance may close them
  IF e.kind IN ('BANK_DETAIL_CHANGE','VENDOR_MASTER_CHANGE') AND NOT _ei_can_admin() THEN RAISE EXCEPTION 'Only admin, CEO or finance can close vendor-master changes'; END IF;
  UPDATE ei_exceptions SET status = p_status, resolved_by = auth.uid(), resolved_at = now(), resolution_note = left(trim(p_note), 1000), updated_at = now() WHERE id = p_id;
  PERFORM _outlook_log(e.organization_id, (SELECT mailbox_id FROM outlook_email_messages WHERE id = e.message_id), e.message_id, 'EXCEPTION_' || p_status,
    jsonb_build_object('kind', e.kind, 'note', left(p_note, 200), 'attachment_id', e.attachment_id));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION ei_assign_exception(p_id UUID, p_user UUID) RETURNS VOID AS $$
DECLARE e ei_exceptions;
BEGIN
  SELECT * INTO e FROM ei_exceptions WHERE id = p_id;
  IF e.id IS NULL OR e.organization_id <> current_org_id() OR NOT _ei_can_view() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user AND organization_id = e.organization_id AND is_active IS NOT FALSE) THEN
    RAISE EXCEPTION 'User not in this organization';
  END IF;
  UPDATE ei_exceptions SET assigned_to = p_user, updated_at = now() WHERE id = p_id;
  IF p_user IS NOT NULL AND p_user <> auth.uid() THEN
    INSERT INTO notifications (recipient_id, sender_id, type, title, body, link, organization_id)
    VALUES (p_user, auth.uid(), 'email_exception', 'Email exception assigned to you', left(e.summary, 250), '/email-to-tasks?tab=exceptions', e.organization_id);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Reviewer creates the invoice after correcting fields (same checks as the automation).
CREATE OR REPLACE FUNCTION ei_review_create_invoice(p_attachment UUID, p JSONB, p_note TEXT) RETURNS JSONB AS $$
DECLARE a ei_attachments; r JSONB;
BEGIN
  SELECT * INTO a FROM ei_attachments WHERE id = p_attachment;
  IF a.id IS NULL OR a.organization_id <> current_org_id() OR _outlook_role() NOT IN ('admin','ceo','finance') THEN
    RAISE EXCEPTION 'Only admin, CEO or finance can create invoices from email';
  END IF;
  IF NULLIF(trim(p_note), '') IS NULL THEN RAISE EXCEPTION 'A reason for the manual correction is required'; END IF;
  r := ei_create_invoice(p_attachment, p || jsonb_build_object('intake_notes', 'Created from email by reviewer: ' || trim(p_note)));
  PERFORM _outlook_log(a.organization_id, NULL, a.message_id, 'MANUAL_CORRECTION',
    jsonb_build_object('attachment_id', a.id, 'result', r->>'status', 'note', left(p_note, 200), 'fields', p));
  IF r->>'status' IN ('CREATED','EXISTS') THEN
    UPDATE ei_exceptions SET status = 'RESOLVED', resolved_by = auth.uid(), resolved_at = now(), resolution_note = 'Invoice created: ' || left(trim(p_note), 900), updated_at = now()
     WHERE attachment_id = p_attachment AND status = 'OPEN';
  END IF;
  RETURN r;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Signed links to attachments are created by the client; this lists what a viewer may open.
REVOKE EXECUTE ON FUNCTION ei_raise_exception(UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, UUID, INT, INT), ei_create_invoice(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ei_raise_exception(UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, UUID, INT, INT), ei_create_invoice(UUID, JSONB) TO service_role;
REVOKE EXECUTE ON FUNCTION ei_resolve_exception(UUID, TEXT, TEXT), ei_assign_exception(UUID, UUID), ei_review_create_invoice(UUID, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ei_resolve_exception(UUID, TEXT, TEXT), ei_assign_exception(UUID, UUID), ei_review_create_invoice(UUID, JSONB, TEXT) TO authenticated;

-- retention: attachment text follows the mailbox retention (files stay; they back invoices)
CREATE OR REPLACE FUNCTION outlook_prune_email_data() RETURNS INT AS $$
DECLARE n INT;
BEGIN
  UPDATE outlook_email_messages m SET body_excerpt = NULL,
         classification = CASE WHEN m.classification IS NULL THEN NULL ELSE m.classification - 'description' - 'reason' END
    FROM outlook_mailboxes b
   WHERE b.id = m.mailbox_id AND m.body_excerpt IS NOT NULL AND m.created_at < now() - make_interval(days => b.retention_days);
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE ei_attachments x SET text_excerpt = NULL
    FROM outlook_email_messages m JOIN outlook_mailboxes b ON b.id = m.mailbox_id
   WHERE x.message_id = m.id AND x.text_excerpt IS NOT NULL AND x.created_at < now() - make_interval(days => b.retention_days);
  DELETE FROM outlook_email_events e USING outlook_email_messages m, outlook_mailboxes b
   WHERE e.message_id = m.id AND b.id = m.mailbox_id AND m.status IN ('IGNORED','DISMISSED')
     AND m.created_at < now() - make_interval(days => b.retention_days)
     AND NOT EXISTS (SELECT 1 FROM ei_attachments x WHERE x.message_id = m.id);
  DELETE FROM outlook_email_messages m USING outlook_mailboxes b
   WHERE b.id = m.mailbox_id AND m.status IN ('IGNORED','DISMISSED') AND m.created_at < now() - make_interval(days => b.retention_days)
     AND NOT EXISTS (SELECT 1 FROM ei_attachments x WHERE x.message_id = m.id);
  RETURN n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── processing status PROCESSED (handled by Email Intelligence) ──────────
ALTER TABLE outlook_email_messages DROP CONSTRAINT IF EXISTS outlook_email_messages_status_check;
ALTER TABLE outlook_email_messages ADD CONSTRAINT outlook_email_messages_status_check
  CHECK (status IN ('PENDING','PROCESSING','TASK_CREATED','REVIEW','IGNORED','FAILED','DEAD','DISMISSED','PROCESSED'));

-- STEP261's result writer + retry, extended with intents / config version /
-- attachment count / vendor and the PROCESSED status. Re-running an email
-- (e.g. after a rule change) is safe: attachments, exceptions and invoices
-- are all unique per source item.
CREATE OR REPLACE FUNCTION outlook_record_result(p_message UUID, p_status TEXT, p_fields JSONB DEFAULT '{}'::jsonb, p_retry_after_secs INT DEFAULT NULL)
RETURNS TEXT AS $$
DECLARE v_m outlook_email_messages; v_status TEXT := p_status; v_mb outlook_mailboxes; f JSONB := COALESCE(p_fields, '{}'::jsonb);
BEGIN
  IF p_status NOT IN ('PROCESSING','REVIEW','IGNORED','FAILED','PROCESSED') THEN RAISE EXCEPTION 'Bad status %', p_status; END IF;
  SELECT * INTO v_m FROM outlook_email_messages WHERE id = p_message FOR UPDATE;
  IF v_m.id IS NULL THEN RETURN NULL; END IF;
  IF v_m.status IN ('TASK_CREATED','DISMISSED') OR v_m.task_id IS NOT NULL THEN RETURN v_m.status; END IF;  -- never downgrade
  IF v_status = 'FAILED' AND v_m.attempts >= 6 THEN v_status := 'DEAD'; END IF;

  UPDATE outlook_email_messages SET
    status              = v_status,
    internet_message_id = COALESCE(f->>'internet_message_id', internet_message_id),
    conversation_id     = COALESCE(f->>'conversation_id', conversation_id),
    subject             = COALESCE(f->>'subject', subject),
    sender_email        = COALESCE(lower(f->>'sender_email'), sender_email),
    sender_name         = COALESCE(f->>'sender_name', sender_name),
    to_recipients       = CASE WHEN jsonb_typeof(f->'to_recipients') = 'array'
                            THEN ARRAY(SELECT jsonb_array_elements_text(f->'to_recipients')) ELSE to_recipients END,
    received_at         = COALESCE((f->>'received_at')::timestamptz, received_at),
    web_link            = COALESCE(f->>'web_link', web_link),
    body_excerpt        = COALESCE(left(f->>'body_excerpt', 8000), body_excerpt),
    classifier          = COALESCE(f->>'classifier', classifier),
    classification      = COALESCE(f->'classification', classification),
    category            = COALESCE(f->>'category', category),
    priority            = COALESCE(f->>'priority', priority),
    confidence          = COALESCE((f->>'confidence')::numeric, confidence),
    decision_reason     = COALESCE(f->>'decision_reason', decision_reason),
    matched_project_id  = COALESCE((f->>'matched_project_id')::uuid, matched_project_id),
    matched_customer_id = COALESCE((f->>'matched_customer_id')::uuid, matched_customer_id),
    match_method        = COALESCE(f->>'match_method', match_method),
    match_confidence    = COALESCE((f->>'match_confidence')::numeric, match_confidence),
    candidates          = COALESCE(f->'candidates', candidates),
    intents             = COALESCE(f->'intents', intents),
    config_version      = COALESCE((f->>'config_version')::int, config_version),
    attachment_count    = COALESCE((f->>'attachment_count')::int, attachment_count),
    vendor_id           = COALESCE((f->>'vendor_id')::uuid, vendor_id),
    last_error          = CASE WHEN v_status IN ('FAILED','DEAD') THEN left(f->>'error', 1000) ELSE NULL END,
    next_attempt_at     = CASE WHEN v_status = 'FAILED'
                            THEN now() + make_interval(secs => COALESCE(p_retry_after_secs, LEAST(21600, 60 * power(2, GREATEST(v_m.attempts - 1, 0)))::int))
                            ELSE next_attempt_at END,
    processed_at        = CASE WHEN v_status IN ('REVIEW','IGNORED','DEAD','PROCESSED') THEN now() ELSE processed_at END,
    locked_at           = CASE WHEN v_status = 'PROCESSING' THEN locked_at ELSE NULL END,
    updated_at          = now()
  WHERE id = p_message;

  PERFORM _outlook_log(v_m.organization_id, v_m.mailbox_id, p_message,
    CASE v_status WHEN 'PROCESSED' THEN 'PROCESSED' WHEN 'PROCESSING' THEN 'CLASSIFIED' WHEN 'REVIEW' THEN 'SENT_TO_REVIEW' WHEN 'IGNORED' THEN 'IGNORED' WHEN 'DEAD' THEN 'DEAD_LETTER' ELSE 'FAILED' END,
    jsonb_strip_nulls(jsonb_build_object('reason', f->>'decision_reason', 'error', left(f->>'error', 300),
      'attempt', v_m.attempts, 'category', f->>'category', 'confidence', f->>'confidence', 'match', f->>'match_method',
      'intent', f->'intents'->>'primary', 'config_version', f->>'config_version')));

  -- review queue: tell the configured people once
  IF v_status = 'REVIEW' AND v_m.status <> 'REVIEW' THEN
    SELECT * INTO v_mb FROM outlook_mailboxes WHERE id = v_m.mailbox_id;
    INSERT INTO notifications (recipient_id, type, title, body, link, organization_id)
    SELECT u, 'email_review', 'Customer email needs a project', left(COALESCE(f->>'subject', v_m.subject, '(no subject)'), 200),
           '/email-to-tasks?tab=review', v_m.organization_id
      FROM unnest(v_mb.notify_user_ids) u
     WHERE EXISTS (SELECT 1 FROM profiles p WHERE p.id = u AND p.organization_id = v_m.organization_id AND p.is_active IS NOT FALSE);
  END IF;
  RETURN v_status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION outlook_retry_message(p_message UUID) RETURNS VOID AS $$
DECLARE v_m outlook_email_messages := _outlook_msg_for_user(p_message);
BEGIN
  IF v_m.status NOT IN ('FAILED','DEAD','REVIEW','IGNORED','DISMISSED','PROCESSED') THEN RAISE EXCEPTION 'Only failed, ignored, review or processed emails can be re-run'; END IF;
  UPDATE outlook_email_messages SET status = 'PENDING', attempts = 0, next_attempt_at = now(), locked_at = NULL,
         last_error = NULL, updated_at = now() WHERE id = p_message AND task_id IS NULL;
  PERFORM _outlook_log(v_m.organization_id, v_m.mailbox_id, p_message, 'RETRY_REQUESTED', jsonb_build_object('from', v_m.status));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Draft (unpublished) configuration for the dry-run tester (service role).
CREATE OR REPLACE FUNCTION ei_draft_config(p_org UUID) RETURNS TABLE (version INT, snapshot JSONB) AS $$
  SELECT COALESCE((SELECT max(v.version) FROM ei_config_versions v WHERE v.organization_id = p_org), 0), _ei_snapshot(p_org)
   WHERE EXISTS (SELECT 1 FROM ei_email_categories c WHERE c.organization_id = p_org)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
REVOKE EXECUTE ON FUNCTION ei_draft_config(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ei_draft_config(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
