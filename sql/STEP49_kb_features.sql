-- ============================================================
-- STEP49: Adds a dedicated `features` column to kb_modules so the
-- Knowledge Base can show a complete, itemized capability list per
-- module (rendered as a bulleted list), distinct from the prose
-- `description` and step-by-step `flow` fields.
--
-- Format: one feature per line (newline-separated), same convention
-- as `flow`'s free-text field — no new data type needed, and the UI
-- just splits on \n to render bullets.
--
-- Run after STEP47_knowledge_base.sql, before re-running
-- SEED_knowledge_base.sql.
-- ============================================================

ALTER TABLE kb_modules ADD COLUMN IF NOT EXISTS features TEXT;

NOTIFY pgrst, 'reload schema';
