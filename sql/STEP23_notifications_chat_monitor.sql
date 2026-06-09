-- ============================================================
-- STEP23: In-App Notifications + Chat + App Monitor
-- Run in Supabase SQL editor
-- Safe to re-run: DROP TABLE ... CASCADE removes policies too
-- ============================================================

-- ── 1. NOTIFICATIONS ─────────────────────────────────────────

DROP TABLE IF EXISTS notifications CASCADE;

CREATE TABLE notifications (
  id           UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_id UUID         NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sender_id    UUID         REFERENCES profiles(id) ON DELETE SET NULL,
  type         TEXT         NOT NULL,
  title        TEXT         NOT NULL,
  body         TEXT,
  link         TEXT,
  metadata     JSONB        DEFAULT '{}',
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  DEFAULT now()
);

CREATE INDEX notif_recipient_idx ON notifications(recipient_id, created_at DESC);
CREATE INDEX notif_unread_idx    ON notifications(recipient_id, read_at) WHERE read_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notif_select ON notifications FOR SELECT USING (recipient_id = auth.uid());
CREATE POLICY notif_update ON notifications FOR UPDATE USING (recipient_id = auth.uid());
CREATE POLICY notif_delete ON notifications FOR DELETE USING (recipient_id = auth.uid());
CREATE POLICY notif_insert ON notifications FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

ALTER TABLE notifications REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
END$$;


-- ── 2. CHAT ──────────────────────────────────────────────────
-- Drop in reverse dependency order so CASCADE works cleanly

DROP TABLE IF EXISTS chat_messages    CASCADE;
DROP TABLE IF EXISTS chat_room_members CASCADE;
DROP TABLE IF EXISTS chat_rooms        CASCADE;

CREATE TABLE chat_rooms (
  id           UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  type         TEXT    DEFAULT 'direct' CHECK (type IN ('direct','group')),
  name         TEXT,
  canonical_id TEXT    UNIQUE,   -- sorted user pair: 'uuid_a::uuid_b'
  created_by   UUID    REFERENCES profiles(id),
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chat_room_members (
  room_id   UUID NOT NULL REFERENCES chat_rooms(id)  ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES profiles(id)    ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE chat_messages (
  id         UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id    UUID    NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  sender_id  UUID    NOT NULL REFERENCES profiles(id),
  message    TEXT    NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX chat_msg_room_idx ON chat_messages(room_id, created_at);

ALTER TABLE chat_rooms        ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages     ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_room_member_see ON chat_rooms FOR SELECT USING (
  EXISTS (SELECT 1 FROM chat_room_members WHERE room_id = id AND user_id = auth.uid())
);
CREATE POLICY chat_room_admin_see ON chat_rooms FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);
-- Any user can look up a DM room they would be a party to via canonical_id
-- (needed for "find or create" DM flow before membership is established)
CREATE POLICY chat_room_canonical_lookup ON chat_rooms FOR SELECT USING (
  canonical_id IS NOT NULL AND (
    canonical_id LIKE (auth.uid()::text || '::%')
    OR canonical_id LIKE ('%::' || auth.uid()::text)
  )
);
CREATE POLICY chat_room_insert ON chat_rooms FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY crm_own ON chat_room_members FOR SELECT USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);
CREATE POLICY crm_insert ON chat_room_members FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY msg_member_see ON chat_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM chat_room_members WHERE room_id = chat_messages.room_id AND user_id = auth.uid())
);
CREATE POLICY msg_admin_see ON chat_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);
CREATE POLICY msg_insert ON chat_messages FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM chat_room_members WHERE room_id = chat_messages.room_id AND user_id = auth.uid())
);

ALTER TABLE chat_messages REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
  END IF;
END$$;


-- ── 3. APP MONITOR ───────────────────────────────────────────

DROP TABLE IF EXISTS app_events CASCADE;

CREATE TABLE app_events (
  id         UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT    NOT NULL CHECK (event_type IN ('page_view','session_start','session_end','error','api_call')),
  path       TEXT,
  user_id    UUID    REFERENCES profiles(id) ON DELETE SET NULL,
  session_id TEXT,
  metadata   JSONB   DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX app_events_type_idx    ON app_events(event_type, created_at DESC);
CREATE INDEX app_events_user_idx    ON app_events(user_id, created_at DESC);
CREATE INDEX app_events_session_idx ON app_events(session_id);

ALTER TABLE app_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY ae_insert ON app_events FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY ae_admin  ON app_events FOR SELECT  USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);
