-- ============================================================
-- STEP45: Add Claude (Anthropic) API key to llm_settings
-- Adds a column for the new Claude Opus 5 model option in the Data
-- Assistant / Neo Task AI model picker. Idempotent — safe to run whether
-- or not STEP44 has already been applied.
-- Run in Supabase SQL Editor after STEP44.
-- ============================================================

ALTER TABLE llm_settings ADD COLUMN IF NOT EXISTS claude_api_key TEXT;

NOTIFY pgrst, 'reload schema';
