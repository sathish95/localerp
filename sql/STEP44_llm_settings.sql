-- ============================================================
-- STEP44: LLM Settings (org-wide, UI-configurable API keys)
-- Single-row table so admins can save DeepSeek/Gemini API keys and the
-- Ollama URL from the Settings UI instead of only via .env. Readable by
-- any authenticated user (the browser calls the LLM APIs directly, same
-- exposure level as the existing VITE_ env vars already bundled client-side)
-- but writable only by admin/ceo.
-- Run in Supabase SQL Editor after STEP43.
-- ============================================================

CREATE TABLE IF NOT EXISTS llm_settings (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  deepseek_api_key  TEXT,
  gemini_api_key    TEXT,
  ollama_url        TEXT,
  updated_by        UUID,
  updated_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE llm_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS llm_settings_select ON llm_settings;
CREATE POLICY llm_settings_select ON llm_settings FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS llm_settings_write ON llm_settings;
CREATE POLICY llm_settings_write ON llm_settings FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','ceo'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','ceo'))
);

NOTIFY pgrst, 'reload schema';
