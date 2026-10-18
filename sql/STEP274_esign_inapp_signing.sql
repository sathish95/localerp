-- STEP274 — Sign inside the app (Agreements & e-Sign tab)
--
--  • Team members who must sign get a link to /agreements?id=<doc>&sign=1
--    (in the email and the in-app notification) instead of the public page;
--    the tab opens the document with the signing panel. External signers
--    still get /sign/<token>.
--  • esign_my_signing_token(doc): the signed-in user's own signing token for a
--    document, so the tab can use the same esign_public_* RPCs (code check,
--    audit trail) as the public page.
--  • A team member's signing email is always sent: if their notification
--    preferences didn't queue one (digest / muted / off), it is queued directly.
-- Needs STEP273. Re-runnable.

CREATE OR REPLACE FUNCTION esign_my_signing_token(p_doc UUID) RETURNS TEXT AS $$
  SELECT s.token FROM esign_signers s
   WHERE s.document_id = p_doc AND s.profile_id = auth.uid() AND s.organization_id = current_org_id()
   ORDER BY s.seq LIMIT 1
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION esign_my_signing_token(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION esign_my_signing_token(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION _esign_mail(p_doc esign_documents, s esign_signers, p_kind TEXT) RETURNS VOID AS $$
DECLARE v_title TEXT; v_body TEXT; v_org TEXT := _esign_org_name(p_doc.organization_id); v_link TEXT; v_nid UUID;
BEGIN
  v_title := CASE p_kind
    WHEN 'REMINDER'  THEN 'Reminder: please sign ' || p_doc.title
    WHEN 'COMPLETED' THEN 'Signed by everyone: ' || p_doc.title
    ELSE 'Please sign: ' || p_doc.title END;
  v_body := CASE p_kind
    WHEN 'COMPLETED' THEN 'All parties have signed ' || p_doc.doc_number || '. Open it to download the signed PDF.'
    ELSE v_org || ' has sent you ' || p_doc.doc_number || ' (' || p_doc.title || ') to review and sign electronically.'
         || COALESCE(E'\n\n' || NULLIF(p_doc.message, ''), '')
         || CASE WHEN p_doc.sign_by IS NOT NULL THEN E'\n\nPlease sign by ' || to_char(p_doc.sign_by, 'DD Mon YYYY') || '.' ELSE '' END
         || CASE WHEN s.profile_id IS NULL THEN E'\n\nThis link is personal to you — please do not forward it.' ELSE '' END END;
  v_link := CASE
    WHEN s.profile_id IS NULL THEN '/sign/' || s.token
    WHEN p_kind = 'COMPLETED' THEN '/agreements?id=' || p_doc.id
    ELSE '/agreements?id=' || p_doc.id || '&sign=1' END;

  IF s.profile_id IS NOT NULL THEN
    BEGIN
      INSERT INTO notifications (recipient_id, sender_id, type, title, body, link, organization_id)
      VALUES (s.profile_id, auth.uid(), 'esign_approval', v_title, v_body, v_link, p_doc.organization_id)
      RETURNING id INTO v_nid;
    EXCEPTION WHEN OTHERS THEN v_nid := NULL;
    END;
    -- the notification trigger queued the email → done
    IF v_nid IS NOT NULL AND EXISTS (SELECT 1 FROM email_outbox WHERE dedupe_key = 'notif:' || v_nid) THEN RETURN; END IF;
  END IF;
  INSERT INTO email_outbox (organization_id, recipient_id, to_email, to_name, template, payload, dedupe_key)
  VALUES (p_doc.organization_id, s.profile_id, s.email, s.name, 'notification',
          jsonb_build_object('title', v_title, 'body', v_body, 'link', v_link, 'category', 'approvals', 'sender', v_org),
          'esign:' || s.id || ':' || p_kind || ':' || extract(epoch FROM clock_timestamp())::bigint)
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION _esign_mail(esign_documents, esign_signers, TEXT) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
