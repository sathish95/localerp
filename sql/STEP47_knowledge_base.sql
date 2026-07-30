-- ============================================================
-- STEP47: Knowledge Base (documents every module — description,
-- flow, primary tables, cross-links). Admin/CEO-editable from the UI
-- at /knowledge-base, readable by every authenticated user.
-- Run in Supabase SQL Editor after STEP46, then run SEED_knowledge_base.sql.
-- ============================================================

CREATE TABLE IF NOT EXISTS kb_modules (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  key              TEXT        UNIQUE NOT NULL,   -- matches src/config/modules.js module keys
  section          TEXT        NOT NULL,          -- matches MODULE_SECTIONS
  label            TEXT        NOT NULL,
  description      TEXT,                          -- what it does
  flow             TEXT,                          -- step-by-step flow, real status values
  primary_tables   TEXT,                          -- key Supabase tables
  linked_modules   TEXT[]      DEFAULT '{}',       -- other kb_modules.key values, for cross-link chips
  notes            TEXT,                           -- gaps/quirks worth flagging
  sort_order       INT         DEFAULT 0,
  updated_by       UUID,
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kb_modules_section_idx ON kb_modules(section, sort_order);

ALTER TABLE kb_modules ENABLE ROW LEVEL SECURITY;

-- Documentation, not sensitive data — any authenticated user can read.
DROP POLICY IF EXISTS kb_modules_select ON kb_modules;
CREATE POLICY kb_modules_select ON kb_modules FOR SELECT USING (auth.uid() IS NOT NULL);

-- Only admin/ceo can write — same convention as modules.js / llmSettings.js.
DROP POLICY IF EXISTS kb_modules_write ON kb_modules;
CREATE POLICY kb_modules_write ON kb_modules FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo'))
);

NOTIFY pgrst, 'reload schema';
