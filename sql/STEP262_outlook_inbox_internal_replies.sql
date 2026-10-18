-- STEP262 — Outlook Email inbox + internal replies (needs STEP261)
--
-- The "Outlook Email" tab (route /outlook-inbox, under Chat) shows every
-- email that arrives in a connected mailbox, whatever happened to it
-- (task created, review, ignored…), and lets the team discuss it in an
-- internal thread. Internal replies are NEVER sent to the customer — they
-- live only in outlook_email_notes (no Graph Mail.Send permission needed).
--
--   outlook_mailboxes.inbox_roles   which roles may open that mailbox's
--                                   inbox (default: admin/ceo/manager/
--                                   department_head — they always can; a
--                                   personal mailbox shouldn't be org-wide).
--   outlook_email_notes             internal replies per email; @-less
--                                   notifications go to everyone already in
--                                   the thread + the linked task's assignee.
--
-- Both tables are added to the supabase_realtime publication so the tab
-- updates live like Chat. Safe to re-run.

ALTER TABLE outlook_mailboxes ADD COLUMN IF NOT EXISTS inbox_roles TEXT[] NOT NULL
  DEFAULT ARRAY['admin','ceo','manager','department_head'];   -- add 'employee' etc. in Settings to open it wider
GRANT UPDATE (inbox_roles) ON outlook_mailboxes TO authenticated;

CREATE OR REPLACE FUNCTION _outlook_can_read_mailbox(p_mailbox UUID) RETURNS BOOLEAN AS $$
  SELECT _outlook_can_view() OR EXISTS (
    SELECT 1 FROM outlook_mailboxes b
     WHERE b.id = p_mailbox AND b.organization_id = current_org_id() AND _outlook_role() = ANY(b.inbox_roles))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Messages: inbox readers see their mailbox's mail (STEP261 policy widened).
DROP POLICY IF EXISTS outlook_msgs_select ON outlook_email_messages;
CREATE POLICY outlook_msgs_select ON outlook_email_messages FOR SELECT
  USING (organization_id = current_org_id() AND _outlook_can_read_mailbox(mailbox_id));

-- Inbox readers only get each mailbox's name — the connection details stay
-- behind the STEP261 policy (admins / managers).
CREATE OR REPLACE FUNCTION outlook_inbox_mailboxes()
RETURNS TABLE (id UUID, mailbox_address TEXT, display_name TEXT, enabled BOOLEAN) AS $$
  SELECT b.id, b.mailbox_address, b.display_name, b.enabled FROM outlook_mailboxes b
   WHERE b.organization_id = current_org_id() AND _outlook_can_read_mailbox(b.id)
   ORDER BY b.created_at
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
REVOKE EXECUTE ON FUNCTION outlook_inbox_mailboxes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION outlook_inbox_mailboxes() TO authenticated;

CREATE TABLE IF NOT EXISTS outlook_email_notes (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id  UUID        NOT NULL DEFAULT current_org_id(),
  message_id       UUID        NOT NULL,           -- soft ref → outlook_email_messages
  author_id        UUID        NOT NULL DEFAULT auth.uid(),
  body             TEXT        NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 5000),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS outlook_notes_msg ON outlook_email_notes (message_id, created_at);
CREATE INDEX IF NOT EXISTS outlook_notes_org ON outlook_email_notes (organization_id, created_at DESC);

CREATE OR REPLACE FUNCTION outlook_email_notes_before() RETURNS TRIGGER AS $$
DECLARE v_m outlook_email_messages;
BEGIN
  NEW.body := trim(NEW.body);
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_m FROM outlook_email_messages WHERE id = NEW.message_id;
    IF v_m.id IS NULL THEN RAISE EXCEPTION 'Email not found'; END IF;
    NEW.organization_id := v_m.organization_id;
    NEW.author_id := COALESCE(auth.uid(), NEW.author_id);
    NEW.created_at := now();
  ELSE
    NEW.message_id := OLD.message_id; NEW.author_id := OLD.author_id; NEW.organization_id := OLD.organization_id; NEW.created_at := OLD.created_at;
    IF NEW.body IS DISTINCT FROM OLD.body THEN NEW.edited_at := now(); END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS outlook_email_notes_before ON outlook_email_notes;
CREATE TRIGGER outlook_email_notes_before BEFORE INSERT OR UPDATE ON outlook_email_notes
  FOR EACH ROW EXECUTE FUNCTION outlook_email_notes_before();

-- Tell the thread: earlier authors + the linked task's assignee (not the writer).
CREATE OR REPLACE FUNCTION outlook_email_notes_after() RETURNS TRIGGER AS $$
DECLARE v_m outlook_email_messages; v_name TEXT;
BEGIN
  SELECT * INTO v_m FROM outlook_email_messages WHERE id = NEW.message_id;
  SELECT full_name INTO v_name FROM profiles WHERE id = NEW.author_id;
  INSERT INTO notifications (recipient_id, sender_id, type, title, body, link, organization_id)
  SELECT DISTINCT u, NEW.author_id, 'email_note', COALESCE(v_name, 'Someone') || ' replied internally on a customer email',
         left(COALESCE(v_m.subject, '(no subject)') || ' — ' || NEW.body, 250), '/outlook-inbox?id=' || NEW.message_id, NEW.organization_id
    FROM (SELECT author_id AS u FROM outlook_email_notes WHERE message_id = NEW.message_id AND id <> NEW.id
          UNION SELECT assigned_to FROM project_tasks WHERE id = v_m.task_id) x
   WHERE u IS NOT NULL AND u <> NEW.author_id
     AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = u AND p.organization_id = NEW.organization_id AND p.is_active IS NOT FALSE);
  PERFORM _outlook_log(NEW.organization_id, v_m.mailbox_id, NEW.message_id, 'INTERNAL_REPLY', jsonb_build_object('note_id', NEW.id));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS outlook_email_notes_after ON outlook_email_notes;
CREATE TRIGGER outlook_email_notes_after AFTER INSERT ON outlook_email_notes
  FOR EACH ROW EXECUTE FUNCTION outlook_email_notes_after();

ALTER TABLE outlook_email_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outlook_notes_select ON outlook_email_notes;
DROP POLICY IF EXISTS outlook_notes_insert ON outlook_email_notes;
DROP POLICY IF EXISTS outlook_notes_update ON outlook_email_notes;
DROP POLICY IF EXISTS outlook_notes_delete ON outlook_email_notes;
CREATE POLICY outlook_notes_select ON outlook_email_notes FOR SELECT USING (
  organization_id = current_org_id()
  AND _outlook_can_read_mailbox((SELECT m.mailbox_id FROM outlook_email_messages m WHERE m.id = message_id)));
CREATE POLICY outlook_notes_insert ON outlook_email_notes FOR INSERT WITH CHECK (
  author_id = auth.uid()
  AND EXISTS (SELECT 1 FROM outlook_email_messages m WHERE m.id = message_id AND m.organization_id = current_org_id()
              AND _outlook_can_read_mailbox(m.mailbox_id)));
CREATE POLICY outlook_notes_update ON outlook_email_notes FOR UPDATE USING (author_id = auth.uid() AND organization_id = current_org_id());
CREATE POLICY outlook_notes_delete ON outlook_email_notes FOR DELETE USING (
  organization_id = current_org_id() AND (author_id = auth.uid() OR _outlook_can_admin()));
GRANT SELECT, INSERT, UPDATE (body), DELETE ON outlook_email_notes TO authenticated;

-- live updates for the tab
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'outlook_email_messages') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE outlook_email_messages;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'outlook_email_notes') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE outlook_email_notes;
    END IF;
  END IF;
END$$;

NOTIFY pgrst, 'reload schema';
