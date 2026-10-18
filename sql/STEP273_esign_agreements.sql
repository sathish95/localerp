-- STEP273 — Agreements & e-Sign (/agreements, public /sign/:token)
--
--  • esign_documents: one agreement / NDA / EPC contract / SOW / purchase order
--    / work order. Made from a template (fields filled in → `content`) or from an
--    uploaded PDF (`esign_files`, bytes kept in the database, max 10 MB).
--  • esign_signers: who signs, in which order (SEQUENTIAL or PARALLEL). Each
--    signer gets a private link /sign/<token>; with `require_otp` (default) a
--    6-digit code is emailed before the signature is accepted.
--  • esign_events: the audit trail (created, sent, viewed, code sent, signed,
--    declined, reminded, cancelled, completed) with IP and browser.
--  • esign_templates: the org's own templates (built-in ones live in
--    src/lib/esignTemplates.js).
--  • A document is editable only while DRAFT. Sending freezes it and stores the
--    SHA-256 of the content / file; status after that changes only through the
--    RPCs below. The signed PDF (original + signature certificate) is built in
--    the browser from these rows (src/lib/esignPdf.js).
--  • Emails go through the existing outbox (template 'notification'), so no
--    Edge Function redeploy is needed. Internal signers also get an in-app
--    notification (their email then follows their notification preferences).
-- Needs STEP228 (email outbox). Re-runnable.

CREATE OR REPLACE FUNCTION _esign_role() RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid() AND is_active IS NOT FALSE
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION _esign_can_manage() RETURNS BOOLEAN AS $$
  SELECT COALESCE(_esign_role() IN ('admin','ceo','manager','department_head','finance','hr'), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

/* ═══ Tables ═══ */
CREATE TABLE IF NOT EXISTS esign_documents (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id   UUID        NOT NULL DEFAULT current_org_id(),
  doc_number        TEXT,
  title             TEXT        NOT NULL,
  doc_type          TEXT        NOT NULL DEFAULT 'AGREEMENT'
                    CHECK (doc_type IN ('AGREEMENT','NDA','EPC_CONTRACT','SOW','PURCHASE_ORDER','WORK_ORDER','MSA','AMENDMENT','OTHER')),
  source            TEXT        NOT NULL DEFAULT 'TEMPLATE' CHECK (source IN ('TEMPLATE','UPLOAD')),
  template_key      TEXT,
  content           TEXT,
  fields            JSONB       NOT NULL DEFAULT '{}',
  file_name         TEXT,
  counterparty_kind TEXT        CHECK (counterparty_kind IN ('CUSTOMER','VENDOR','OTHER')),
  counterparty_id   UUID,       -- soft ref to customers / vendors
  counterparty_name TEXT,
  project_id        UUID,       -- soft ref
  contract_value    NUMERIC,
  currency          TEXT        DEFAULT 'INR',
  effective_date    DATE,
  end_date          DATE,
  status            TEXT        NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT','SENT','IN_PROGRESS','COMPLETED','DECLINED','CANCELLED','EXPIRED')),
  signing_order     TEXT        NOT NULL DEFAULT 'SEQUENTIAL' CHECK (signing_order IN ('SEQUENTIAL','PARALLEL')),
  require_otp       BOOLEAN     NOT NULL DEFAULT true,
  message           TEXT,
  sign_by           DATE,
  content_hash      TEXT,
  sent_at           TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  cancel_reason     TEXT,
  created_by        UUID        DEFAULT auth.uid(),
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, doc_number)
);
CREATE INDEX IF NOT EXISTS esign_documents_org_idx ON esign_documents(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS esign_files (
  document_id     UUID        PRIMARY KEY REFERENCES esign_documents(id) ON DELETE CASCADE,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  bytes           BYTEA       NOT NULL,
  size_bytes      INT         NOT NULL,
  sha256          TEXT        NOT NULL,
  uploaded_by     UUID        DEFAULT auth.uid(),
  uploaded_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS esign_signers (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  document_id     UUID        NOT NULL REFERENCES esign_documents(id) ON DELETE CASCADE,
  seq             INT         NOT NULL DEFAULT 1,
  name            TEXT        NOT NULL,
  email           TEXT        NOT NULL,
  role_label      TEXT,
  profile_id      UUID,       -- set for internal signers
  token           TEXT        NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  status          TEXT        NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','NOTIFIED','VIEWED','SIGNED','DECLINED')),
  notified_at     TIMESTAMPTZ,
  viewed_at       TIMESTAMPTZ,
  signed_at       TIMESTAMPTZ,
  typed_name      TEXT,
  signature_kind  TEXT        CHECK (signature_kind IN ('DRAWN','TYPED')),
  signature_png   TEXT,
  ip              TEXT,
  user_agent      TEXT,
  otp_hash        TEXT,
  otp_sent_at     TIMESTAMPTZ,
  otp_expires_at  TIMESTAMPTZ,
  otp_attempts    INT         NOT NULL DEFAULT 0,
  otp_verified_at TIMESTAMPTZ,
  decline_reason  TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS esign_signers_doc_idx ON esign_signers(document_id, seq);
CREATE INDEX IF NOT EXISTS esign_signers_profile_idx ON esign_signers(profile_id) WHERE profile_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS esign_events (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL,
  document_id     UUID        NOT NULL REFERENCES esign_documents(id) ON DELETE CASCADE,
  signer_id       UUID,
  actor_id        UUID,
  event           TEXT        NOT NULL,
  detail          JSONB       NOT NULL DEFAULT '{}',
  ip              TEXT,
  user_agent      TEXT,
  at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS esign_events_doc_idx ON esign_events(document_id, at);

CREATE TABLE IF NOT EXISTS esign_templates (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL DEFAULT current_org_id(),
  name            TEXT        NOT NULL,
  doc_type        TEXT        NOT NULL DEFAULT 'AGREEMENT',
  body            TEXT        NOT NULL,
  fields          JSONB       NOT NULL DEFAULT '[]',
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_by      UUID        DEFAULT auth.uid(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

/* ═══ Numbering + housekeeping ═══ */
CREATE OR REPLACE FUNCTION _esign_documents_before() RETURNS TRIGGER AS $$
DECLARE n INT;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.doc_number IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('esign_number:' || NEW.organization_id::text));
    SELECT COALESCE(MAX(NULLIF(regexp_replace(doc_number, '^AGR-\d{4}-', ''), doc_number)::INT), 0) + 1 INTO n
      FROM esign_documents
     WHERE organization_id = NEW.organization_id AND doc_number LIKE 'AGR-' || to_char(now(), 'YYYY') || '-%';
    NEW.doc_number := 'AGR-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, 4, '0');
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS esign_documents_before ON esign_documents;
CREATE TRIGGER esign_documents_before BEFORE INSERT OR UPDATE ON esign_documents
  FOR EACH ROW EXECUTE FUNCTION _esign_documents_before();

CREATE OR REPLACE FUNCTION _esign_documents_created() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO esign_events (organization_id, document_id, actor_id, event, detail)
  VALUES (NEW.organization_id, NEW.id, auth.uid(), 'CREATED', jsonb_build_object('source', NEW.source, 'title', NEW.title));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS esign_documents_created ON esign_documents;
CREATE TRIGGER esign_documents_created AFTER INSERT ON esign_documents
  FOR EACH ROW EXECUTE FUNCTION _esign_documents_created();

/* ═══ Visibility ═══ */
CREATE OR REPLACE FUNCTION _esign_can_view(p_doc UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM esign_documents d
     WHERE d.id = p_doc AND d.organization_id = current_org_id()
       AND (_esign_can_manage() OR d.created_by = auth.uid()
            OR EXISTS (SELECT 1 FROM esign_signers s WHERE s.document_id = d.id AND s.profile_id = auth.uid())))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION _esign_is_signer(p_doc UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM esign_signers s WHERE s.document_id = p_doc AND s.profile_id = auth.uid())
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION _esign_can_edit(p_doc UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM esign_documents d
     WHERE d.id = p_doc AND d.organization_id = current_org_id() AND d.status = 'DRAFT'
       AND (_esign_can_manage() OR d.created_by = auth.uid()))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

ALTER TABLE esign_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE esign_files     ENABLE ROW LEVEL SECURITY;
ALTER TABLE esign_signers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE esign_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE esign_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS esign_documents_select ON esign_documents;
DROP POLICY IF EXISTS esign_documents_insert ON esign_documents;
DROP POLICY IF EXISTS esign_documents_update ON esign_documents;
DROP POLICY IF EXISTS esign_documents_delete ON esign_documents;
-- Row columns checked directly (not via _esign_can_view) so INSERT … RETURNING
-- sees the new row.
CREATE POLICY esign_documents_select ON esign_documents FOR SELECT USING (organization_id = current_org_id()
  AND (_esign_can_manage() OR created_by = auth.uid() OR _esign_is_signer(id)));
CREATE POLICY esign_documents_insert ON esign_documents FOR INSERT
  WITH CHECK (organization_id = current_org_id() AND _esign_can_manage() AND status = 'DRAFT');
CREATE POLICY esign_documents_update ON esign_documents FOR UPDATE
  USING (_esign_can_edit(id)) WITH CHECK (organization_id = current_org_id() AND status = 'DRAFT');
CREATE POLICY esign_documents_delete ON esign_documents FOR DELETE USING (_esign_can_edit(id));
-- Clients may only write the draft's own fields; number, hash, status dates
-- and the creator are set by triggers / RPCs.
REVOKE INSERT, UPDATE ON esign_documents FROM anon, authenticated;
GRANT INSERT (organization_id, title, doc_type, source, template_key, content, fields, file_name, counterparty_kind, counterparty_id,
              counterparty_name, project_id, contract_value, currency, effective_date, end_date, signing_order, require_otp, message, sign_by)
  ON esign_documents TO authenticated;
GRANT UPDATE (title, doc_type, source, template_key, content, fields, file_name, counterparty_kind, counterparty_id,
              counterparty_name, project_id, contract_value, currency, effective_date, end_date, signing_order, require_otp, message, sign_by)
  ON esign_documents TO authenticated;

-- Files: written / read through the RPCs below only.
DROP POLICY IF EXISTS esign_files_select ON esign_files;
CREATE POLICY esign_files_select ON esign_files FOR SELECT USING (_esign_can_view(document_id));
REVOKE INSERT, UPDATE, DELETE ON esign_files FROM anon, authenticated;

DROP POLICY IF EXISTS esign_signers_select ON esign_signers;
DROP POLICY IF EXISTS esign_signers_write ON esign_signers;
CREATE POLICY esign_signers_select ON esign_signers FOR SELECT USING (_esign_can_view(document_id));
CREATE POLICY esign_signers_write ON esign_signers FOR ALL
  USING (_esign_can_edit(document_id)) WITH CHECK (organization_id = current_org_id() AND _esign_can_edit(document_id));
-- The signing token and code hash are never readable by the app; the link is
-- fetched with esign_signing_link() by someone who can manage the document.
REVOKE SELECT, INSERT, UPDATE ON esign_signers FROM anon, authenticated;
GRANT SELECT (id, organization_id, document_id, seq, name, email, role_label, profile_id, status, notified_at, viewed_at,
              signed_at, typed_name, signature_kind, signature_png, ip, user_agent, decline_reason, created_at)
  ON esign_signers TO authenticated;
GRANT INSERT (organization_id, document_id, seq, name, email, role_label, profile_id) ON esign_signers TO authenticated;
GRANT UPDATE (seq, name, email, role_label, profile_id) ON esign_signers TO authenticated;
GRANT DELETE ON esign_signers TO authenticated;

DROP POLICY IF EXISTS esign_events_select ON esign_events;
CREATE POLICY esign_events_select ON esign_events FOR SELECT USING (_esign_can_view(document_id));
REVOKE INSERT, UPDATE, DELETE ON esign_events FROM anon, authenticated;

DROP POLICY IF EXISTS esign_templates_select ON esign_templates;
DROP POLICY IF EXISTS esign_templates_write ON esign_templates;
CREATE POLICY esign_templates_select ON esign_templates FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY esign_templates_write ON esign_templates FOR ALL
  USING (organization_id = current_org_id() AND _esign_can_manage())
  WITH CHECK (organization_id = current_org_id() AND _esign_can_manage());

/* ═══ Helpers ═══ */
CREATE OR REPLACE FUNCTION _esign_client() RETURNS JSONB AS $$
DECLARE h JSON; ip TEXT;
BEGIN
  BEGIN h := current_setting('request.headers', true)::json; EXCEPTION WHEN OTHERS THEN h := NULL; END;
  ip := split_part(COALESCE(h->>'x-forwarded-for', h->>'x-real-ip', ''), ',', 1);
  RETURN jsonb_build_object('ip', NULLIF(trim(ip), ''), 'ua', left(h->>'user-agent', 400));
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION _esign_event(p_doc esign_documents, p_signer UUID, p_event TEXT, p_detail JSONB DEFAULT '{}', p_ua TEXT DEFAULT NULL)
RETURNS VOID AS $$
DECLARE c JSONB := _esign_client();
BEGIN
  INSERT INTO esign_events (organization_id, document_id, signer_id, actor_id, event, detail, ip, user_agent)
  VALUES (p_doc.organization_id, p_doc.id, p_signer, auth.uid(), p_event, COALESCE(p_detail, '{}'), c->>'ip', COALESCE(left(p_ua, 400), c->>'ua'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION _esign_org_name(p_org UUID) RETURNS TEXT AS $$
  SELECT COALESCE((SELECT from_name FROM org_email_settings WHERE organization_id = p_org), (SELECT name FROM organizations WHERE id = p_org), 'ThingsAlive NeoX')
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Email (and for internal signers an in-app notification) to one signer.
CREATE OR REPLACE FUNCTION _esign_mail(p_doc esign_documents, s esign_signers, p_kind TEXT) RETURNS VOID AS $$
DECLARE v_title TEXT; v_body TEXT; v_org TEXT := _esign_org_name(p_doc.organization_id);
BEGIN
  v_title := CASE p_kind
    WHEN 'REMINDER'  THEN 'Reminder: please sign ' || p_doc.title
    WHEN 'COMPLETED' THEN 'Signed by everyone: ' || p_doc.title
    ELSE 'Please sign: ' || p_doc.title END;
  v_body := CASE p_kind
    WHEN 'COMPLETED' THEN 'All parties have signed ' || p_doc.doc_number || '. Open the link to download the signed PDF.'
    ELSE v_org || ' has sent you ' || p_doc.doc_number || ' (' || p_doc.title || ') to review and sign electronically.'
         || COALESCE(E'\n\n' || NULLIF(p_doc.message, ''), '')
         || CASE WHEN p_doc.sign_by IS NOT NULL THEN E'\n\nPlease sign by ' || to_char(p_doc.sign_by, 'DD Mon YYYY') || '.' ELSE '' END
         || E'\n\nThis link is personal to you — please do not forward it.' END;

  IF s.profile_id IS NOT NULL THEN
    BEGIN
      INSERT INTO notifications (recipient_id, sender_id, type, title, body, link, organization_id)
      VALUES (s.profile_id, auth.uid(), 'esign_approval', v_title, v_body, '/sign/' || s.token, p_doc.organization_id);
      RETURN;   -- the notification trigger emails them per their preferences
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload, dedupe_key)
  VALUES (p_doc.organization_id, s.profile_id, s.email, s.name, 'notification',
          jsonb_build_object('title', v_title, 'body', v_body, 'link', '/sign/' || s.token, 'category', 'approvals', 'sender', v_org),
          'esign:' || s.id || ':' || p_kind || ':' || extract(epoch FROM clock_timestamp())::bigint)
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Notify whoever may sign now (sequential: lowest unsigned seq; parallel: all).
CREATE OR REPLACE FUNCTION _esign_notify_next(p_doc esign_documents) RETURNS INT AS $$
DECLARE s esign_signers; n INT := 0; v_next INT;
BEGIN
  SELECT MIN(seq) INTO v_next FROM esign_signers WHERE document_id = p_doc.id AND status NOT IN ('SIGNED','DECLINED');
  -- notified_at, not status: a signer may have opened a copied link early.
  FOR s IN SELECT * FROM esign_signers WHERE document_id = p_doc.id AND notified_at IS NULL AND status NOT IN ('SIGNED','DECLINED')
             AND (p_doc.signing_order = 'PARALLEL' OR seq = v_next) ORDER BY seq LOOP
    PERFORM _esign_mail(p_doc, s, 'REQUEST');
    UPDATE esign_signers SET status = CASE WHEN status = 'PENDING' THEN 'NOTIFIED' ELSE status END, notified_at = now() WHERE id = s.id;
    PERFORM _esign_event(p_doc, s.id, 'NOTIFIED', jsonb_build_object('email', s.email));
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION _esign_is_turn(p_doc esign_documents, s esign_signers) RETURNS BOOLEAN AS $$
  SELECT p_doc.signing_order = 'PARALLEL'
      OR NOT EXISTS (SELECT 1 FROM esign_signers o WHERE o.document_id = p_doc.id AND o.seq < s.seq AND o.status <> 'SIGNED')
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

/* ═══ Internal RPCs ═══ */
CREATE OR REPLACE FUNCTION esign_set_file(p_doc UUID, p_file_name TEXT, p_base64 TEXT) RETURNS JSONB AS $$
DECLARE b BYTEA; h TEXT;
BEGIN
  IF NOT _esign_can_edit(p_doc) THEN RAISE EXCEPTION 'This document can no longer be edited'; END IF;
  b := decode(p_base64, 'base64');
  IF length(b) > 10 * 1024 * 1024 THEN RAISE EXCEPTION 'The file is larger than 10 MB'; END IF;
  IF substring(b FROM 1 FOR 5) <> '\x255044462d'::bytea THEN RAISE EXCEPTION 'Only PDF files can be signed'; END IF;
  h := encode(extensions.digest(b, 'sha256'), 'hex');
  INSERT INTO esign_files (document_id, organization_id, bytes, size_bytes, sha256)
  VALUES (p_doc, current_org_id(), b, length(b), h)
  ON CONFLICT (document_id) DO UPDATE SET bytes = EXCLUDED.bytes, size_bytes = EXCLUDED.size_bytes, sha256 = EXCLUDED.sha256,
    uploaded_by = auth.uid(), uploaded_at = now();
  UPDATE esign_documents SET file_name = left(p_file_name, 240), source = 'UPLOAD' WHERE id = p_doc;
  RETURN jsonb_build_object('size', length(b), 'sha256', h);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION esign_file_base64(p_doc UUID) RETURNS TEXT AS $$
  SELECT encode(f.bytes, 'base64') FROM esign_files f WHERE f.document_id = p_doc AND _esign_can_view(p_doc)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION esign_send(p_doc UUID) RETURNS JSONB AS $$
DECLARE d esign_documents; v_hash TEXT; n INT;
BEGIN
  IF NOT _esign_can_edit(p_doc) THEN RAISE EXCEPTION 'Only a draft you can manage can be sent'; END IF;
  SELECT * INTO d FROM esign_documents WHERE id = p_doc FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM esign_signers WHERE document_id = p_doc) THEN RAISE EXCEPTION 'Add at least one signer'; END IF;
  IF EXISTS (SELECT 1 FROM esign_signers WHERE document_id = p_doc AND (trim(name) = '' OR email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')) THEN
    RAISE EXCEPTION 'Every signer needs a name and a valid email';
  END IF;
  IF d.sign_by IS NOT NULL AND d.sign_by < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'The sign-by date is in the past'; END IF;
  IF d.source = 'UPLOAD' THEN
    SELECT sha256 INTO v_hash FROM esign_files WHERE document_id = p_doc;
    IF v_hash IS NULL THEN RAISE EXCEPTION 'Upload the PDF to be signed'; END IF;
  ELSE
    IF COALESCE(trim(d.content), '') = '' THEN RAISE EXCEPTION 'The document has no content'; END IF;
    v_hash := encode(extensions.digest(convert_to(d.content, 'UTF8'), 'sha256'), 'hex');
  END IF;
  UPDATE esign_documents SET status = 'SENT', sent_at = now(), content_hash = v_hash WHERE id = p_doc RETURNING * INTO d;
  PERFORM _esign_event(d, NULL, 'SENT', jsonb_build_object('sha256', v_hash, 'signers', (SELECT count(*) FROM esign_signers WHERE document_id = p_doc)));
  n := _esign_notify_next(d);
  RETURN jsonb_build_object('notified', n, 'sha256', v_hash);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION _esign_require_manager(p_doc UUID) RETURNS esign_documents AS $$
DECLARE d esign_documents;
BEGIN
  SELECT * INTO d FROM esign_documents WHERE id = p_doc AND organization_id = current_org_id();
  IF d.id IS NULL OR NOT (_esign_can_manage() OR d.created_by = auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN d;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION esign_signing_link(p_signer UUID) RETURNS TEXT AS $$
DECLARE s esign_signers;
BEGIN
  SELECT * INTO s FROM esign_signers WHERE id = p_signer;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Signer not found'; END IF;
  PERFORM _esign_require_manager(s.document_id);
  RETURN '/sign/' || s.token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION esign_remind(p_signer UUID) RETURNS VOID AS $$
DECLARE s esign_signers; d esign_documents;
BEGIN
  SELECT * INTO s FROM esign_signers WHERE id = p_signer;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Signer not found'; END IF;
  d := _esign_require_manager(s.document_id);
  IF d.status NOT IN ('SENT','IN_PROGRESS') THEN RAISE EXCEPTION 'The document is not out for signature'; END IF;
  IF s.status IN ('SIGNED','DECLINED') THEN RAISE EXCEPTION 'This signer has already responded'; END IF;
  IF NOT _esign_is_turn(d, s) THEN RAISE EXCEPTION 'It is not this signer''s turn yet'; END IF;
  PERFORM _esign_mail(d, s, 'REMINDER');
  UPDATE esign_signers SET status = CASE WHEN status = 'PENDING' THEN 'NOTIFIED' ELSE status END, notified_at = now() WHERE id = s.id;
  PERFORM _esign_event(d, s.id, 'REMINDED', jsonb_build_object('email', s.email));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION esign_cancel(p_doc UUID, p_reason TEXT) RETURNS VOID AS $$
DECLARE d esign_documents;
BEGIN
  d := _esign_require_manager(p_doc);
  IF d.status NOT IN ('SENT','IN_PROGRESS') THEN RAISE EXCEPTION 'Only a document out for signature can be cancelled'; END IF;
  IF COALESCE(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'Give a reason'; END IF;
  UPDATE esign_documents SET status = 'CANCELLED', cancel_reason = p_reason WHERE id = p_doc RETURNING * INTO d;
  PERFORM _esign_event(d, NULL, 'CANCELLED', jsonb_build_object('reason', p_reason));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

/* ═══ Public RPCs (anon, by signer token) ═══ */
DROP FUNCTION IF EXISTS _esign_by_token(TEXT);
CREATE OR REPLACE FUNCTION _esign_by_token(p_token TEXT) RETURNS esign_signers AS $$
DECLARE s esign_signers; d esign_documents;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 THEN RAISE EXCEPTION 'This signing link is not valid'; END IF;
  SELECT * INTO s FROM esign_signers WHERE token = p_token;
  IF s.id IS NULL THEN RAISE EXCEPTION 'This signing link is not valid'; END IF;
  SELECT * INTO d FROM esign_documents WHERE id = s.document_id;
  IF d.status = 'DRAFT' THEN RAISE EXCEPTION 'This document has not been sent yet'; END IF;
  IF d.status = 'CANCELLED' THEN RAISE EXCEPTION 'The sender cancelled this document'; END IF;
  IF d.status IN ('SENT','IN_PROGRESS') AND d.sign_by IS NOT NULL AND d.sign_by < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    UPDATE esign_documents SET status = 'EXPIRED' WHERE id = d.id RETURNING * INTO d;
    PERFORM _esign_event(d, NULL, 'EXPIRED');
  END IF;
  RETURN s;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION esign_public_get(p_token TEXT) RETURNS JSONB AS $$
DECLARE s esign_signers; d esign_documents; done BOOLEAN; v_signers JSONB; v_events JSONB;
BEGIN
  s := _esign_by_token(p_token);
  SELECT * INTO d FROM esign_documents WHERE id = s.document_id;
  IF s.status IN ('PENDING','NOTIFIED') AND d.status IN ('SENT','IN_PROGRESS') AND _esign_is_turn(d, s) THEN
    UPDATE esign_signers SET status = 'VIEWED', viewed_at = now() WHERE id = s.id RETURNING * INTO s;
    PERFORM _esign_event(d, s.id, 'VIEWED');
  END IF;
  done := d.status = 'COMPLETED';
  -- Other signers' emails, signatures and IPs are only shared once everyone has signed.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', o.id, 'seq', o.seq, 'name', o.name, 'role_label', o.role_label, 'status', o.status, 'signed_at', o.signed_at,
           'email', CASE WHEN done OR o.id = s.id THEN o.email END,
           'typed_name', CASE WHEN done OR o.id = s.id THEN o.typed_name END,
           'signature_kind', CASE WHEN done OR o.id = s.id THEN o.signature_kind END,
           'signature_png', CASE WHEN done OR o.id = s.id THEN o.signature_png END,
           'ip', CASE WHEN done OR o.id = s.id THEN o.ip END,
           'user_agent', CASE WHEN done OR o.id = s.id THEN o.user_agent END,
           'otp_verified', o.otp_verified_at IS NOT NULL) ORDER BY o.seq, o.created_at), '[]')
    INTO v_signers FROM esign_signers o WHERE o.document_id = d.id;
  IF done THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('event', e.event, 'at', e.at, 'ip', e.ip, 'signer_id', e.signer_id) ORDER BY e.at), '[]')
      INTO v_events FROM esign_events e WHERE e.document_id = d.id AND e.event <> 'CREATED';
  END IF;
  RETURN jsonb_build_object(
    'org_name', _esign_org_name(d.organization_id),
    'document', jsonb_build_object('id', d.id, 'doc_number', d.doc_number, 'title', d.title, 'doc_type', d.doc_type, 'source', d.source,
       'content', d.content, 'file_name', d.file_name, 'counterparty_name', d.counterparty_name, 'status', d.status,
       'signing_order', d.signing_order, 'require_otp', d.require_otp, 'message', d.message, 'sign_by', d.sign_by,
       'content_hash', d.content_hash, 'sent_at', d.sent_at, 'completed_at', d.completed_at,
       'contract_value', d.contract_value, 'currency', d.currency, 'effective_date', d.effective_date, 'end_date', d.end_date),
    'me', jsonb_build_object('id', s.id, 'name', s.name, 'email', s.email, 'role_label', s.role_label, 'status', s.status,
       'signed_at', s.signed_at, 'decline_reason', s.decline_reason,
       'can_sign', d.status IN ('SENT','IN_PROGRESS') AND s.status NOT IN ('SIGNED','DECLINED') AND _esign_is_turn(d, s)),
    'signers', v_signers,
    'events', v_events);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION esign_public_file(p_token TEXT) RETURNS TEXT AS $$
DECLARE s esign_signers; d esign_documents;
BEGIN
  s := _esign_by_token(p_token);
  SELECT * INTO d FROM esign_documents WHERE id = s.document_id;
  RETURN (SELECT encode(bytes, 'base64') FROM esign_files WHERE document_id = d.id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION esign_public_send_code(p_token TEXT) RETURNS JSONB AS $$
DECLARE s esign_signers; d esign_documents; v_code TEXT;
BEGIN
  s := _esign_by_token(p_token);
  SELECT * INTO d FROM esign_documents WHERE id = s.document_id;
  IF d.status NOT IN ('SENT','IN_PROGRESS') OR s.status IN ('SIGNED','DECLINED') THEN RAISE EXCEPTION 'This document can no longer be signed'; END IF;
  IF s.otp_sent_at IS NOT NULL AND s.otp_sent_at > now() - interval '45 seconds' THEN
    RAISE EXCEPTION 'A code was just sent — please wait a minute before asking again';
  END IF;
  IF (SELECT count(*) FROM esign_events WHERE signer_id = s.id AND event = 'CODE_SENT' AND at > now() - interval '1 hour') >= 6 THEN
    RAISE EXCEPTION 'Too many codes requested — try again in an hour';
  END IF;
  v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::int::bigint & 2147483647) % 1000000)::text, 6, '0');
  UPDATE esign_signers SET otp_hash = encode(extensions.digest(s.id::text || ':' || v_code, 'sha256'), 'hex'),
         otp_sent_at = now(), otp_expires_at = now() + interval '10 minutes', otp_attempts = 0 WHERE id = s.id;
  INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload, dedupe_key)
  VALUES (d.organization_id, s.profile_id, s.email, s.name, 'notification',
          jsonb_build_object('title', 'Your signing code: ' || v_code,
            'body', 'Use code ' || v_code || ' to sign ' || d.doc_number || ' (' || d.title || '). It is valid for 10 minutes. If you did not ask for it, ignore this email.',
            'link', '/sign/' || s.token, 'category', 'approvals', 'sender', _esign_org_name(d.organization_id)),
          'esign-otp:' || s.id || ':' || extract(epoch FROM clock_timestamp())::bigint);
  PERFORM _esign_event(d, s.id, 'CODE_SENT');
  RETURN jsonb_build_object('sent_to', regexp_replace(s.email, '^(.).*(@.*)$', '\1•••\2'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION esign_public_sign(p_token TEXT, p_code TEXT, p_typed_name TEXT, p_signature_png TEXT,
                                             p_kind TEXT, p_consent BOOLEAN, p_user_agent TEXT DEFAULT NULL) RETURNS JSONB AS $$
DECLARE s esign_signers; d esign_documents; c JSONB := _esign_client(); v_left INT; o esign_signers;
BEGIN
  s := _esign_by_token(p_token);
  SELECT * INTO d FROM esign_documents WHERE id = s.document_id;
  SELECT * INTO d FROM esign_documents WHERE id = d.id FOR UPDATE;
  SELECT * INTO s FROM esign_signers WHERE id = s.id FOR UPDATE;
  IF d.status NOT IN ('SENT','IN_PROGRESS') THEN RAISE EXCEPTION 'This document can no longer be signed'; END IF;
  IF s.status IN ('SIGNED','DECLINED') THEN RAISE EXCEPTION 'You have already responded to this document'; END IF;
  IF NOT _esign_is_turn(d, s) THEN RAISE EXCEPTION 'Earlier signers have not signed yet — you will get an email when it is your turn'; END IF;
  IF p_consent IS NOT TRUE THEN RAISE EXCEPTION 'Please agree to sign electronically'; END IF;
  IF length(trim(COALESCE(p_typed_name, ''))) < 2 THEN RAISE EXCEPTION 'Type your full name'; END IF;
  IF p_kind NOT IN ('DRAWN','TYPED') OR p_signature_png IS NULL OR p_signature_png NOT LIKE 'data:image/png;base64,%' OR length(p_signature_png) > 400000 THEN
    RAISE EXCEPTION 'The signature image is missing or too large';
  END IF;
  IF d.require_otp THEN
    IF s.otp_hash IS NULL OR s.otp_expires_at < now() THEN RAISE EXCEPTION 'The code has expired — ask for a new one'; END IF;
    IF s.otp_attempts >= 5 THEN RAISE EXCEPTION 'Too many wrong codes — ask for a new one'; END IF;
    IF encode(extensions.digest(s.id::text || ':' || trim(COALESCE(p_code, '')), 'sha256'), 'hex') <> s.otp_hash THEN
      UPDATE esign_signers SET otp_attempts = otp_attempts + 1 WHERE id = s.id;
      PERFORM _esign_event(d, s.id, 'CODE_FAILED');
      RETURN jsonb_build_object('ok', false, 'error', 'That code is not correct');
    END IF;
  END IF;

  UPDATE esign_signers SET status = 'SIGNED', signed_at = now(), typed_name = trim(p_typed_name), signature_kind = p_kind,
         signature_png = p_signature_png, ip = c->>'ip', user_agent = COALESCE(left(p_user_agent, 400), c->>'ua'),
         otp_verified_at = CASE WHEN d.require_otp THEN now() END, otp_hash = NULL
   WHERE id = s.id;
  PERFORM _esign_event(d, s.id, 'SIGNED', jsonb_build_object('name', trim(p_typed_name), 'kind', p_kind, 'code_verified', d.require_otp), p_user_agent);

  SELECT count(*) INTO v_left FROM esign_signers WHERE document_id = d.id AND status <> 'SIGNED';
  IF v_left = 0 THEN
    UPDATE esign_documents SET status = 'COMPLETED', completed_at = now() WHERE id = d.id RETURNING * INTO d;
    PERFORM _esign_event(d, NULL, 'COMPLETED');
    FOR o IN SELECT * FROM esign_signers WHERE document_id = d.id LOOP PERFORM _esign_mail(d, o, 'COMPLETED'); END LOOP;
    IF d.created_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM esign_signers WHERE document_id = d.id AND profile_id = d.created_by) THEN
      BEGIN
        INSERT INTO notifications (recipient_id, type, title, body, link, organization_id)
        VALUES (d.created_by, 'esign_approval', 'Signed by everyone: ' || d.title, d.doc_number || ' is fully signed.', '/agreements?id=' || d.id, d.organization_id);
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  ELSE
    UPDATE esign_documents SET status = 'IN_PROGRESS' WHERE id = d.id RETURNING * INTO d;
    PERFORM _esign_notify_next(d);
  END IF;
  RETURN jsonb_build_object('ok', true, 'completed', v_left = 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION esign_public_decline(p_token TEXT, p_reason TEXT) RETURNS VOID AS $$
DECLARE s esign_signers; d esign_documents;
BEGIN
  s := _esign_by_token(p_token);
  SELECT * INTO d FROM esign_documents WHERE id = s.document_id;
  IF d.status NOT IN ('SENT','IN_PROGRESS') OR s.status IN ('SIGNED','DECLINED') THEN RAISE EXCEPTION 'This document can no longer be declined'; END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Tell the sender why you are declining'; END IF;
  UPDATE esign_signers SET status = 'DECLINED', decline_reason = trim(p_reason) WHERE id = s.id;
  UPDATE esign_documents SET status = 'DECLINED' WHERE id = d.id RETURNING * INTO d;
  PERFORM _esign_event(d, s.id, 'DECLINED', jsonb_build_object('reason', trim(p_reason)));
  IF d.created_by IS NOT NULL THEN
    BEGIN
      INSERT INTO notifications (recipient_id, type, title, body, link, organization_id)
      VALUES (d.created_by, 'esign_approval', s.name || ' declined to sign ' || d.title, trim(p_reason), '/agreements?id=' || d.id, d.organization_id);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

/* ═══ Grants ═══ */
REVOKE ALL ON FUNCTION _esign_by_token(TEXT), _esign_mail(esign_documents, esign_signers, TEXT), _esign_notify_next(esign_documents),
  _esign_event(esign_documents, UUID, TEXT, JSONB, TEXT), _esign_require_manager(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION esign_public_get(TEXT), esign_public_file(TEXT), esign_public_send_code(TEXT),
  esign_public_sign(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT), esign_public_decline(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION esign_public_get(TEXT), esign_public_file(TEXT), esign_public_send_code(TEXT),
  esign_public_sign(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT), esign_public_decline(TEXT, TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION esign_set_file(UUID, TEXT, TEXT), esign_file_base64(UUID), esign_send(UUID), esign_signing_link(UUID),
  esign_remind(UUID), esign_cancel(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION esign_set_file(UUID, TEXT, TEXT), esign_file_base64(UUID), esign_send(UUID), esign_signing_link(UUID),
  esign_remind(UUID), esign_cancel(UUID, TEXT) TO authenticated;

/* ═══ Module registration (Settings → Roles & Modules) ═══ */
INSERT INTO modules (organization_id, key, label)
SELECT o.id, 'agreements', 'Agreements & e-Sign' FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM modules m WHERE m.organization_id = o.id AND m.key = 'agreements');

INSERT INTO module_role_visibility (organization_id, module_key, role, visible)
SELECT m.organization_id, m.key, r.role_key, false
FROM modules m CROSS JOIN roles r
WHERE m.key = 'agreements'
  AND r.role_key NOT IN ('admin','ceo','manager','department_head','finance','hr')
ON CONFLICT (organization_id, module_key, role) DO NOTHING;

NOTIFY pgrst, 'reload schema';
