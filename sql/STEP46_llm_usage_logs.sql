-- ============================================================
-- STEP46: LLM Usage Logs (chatbot/AI request + token monitoring)
-- One row per LLM API call (Data Assistant + Neo Task AI), with token
-- counts, latency, and success/failure — feeds the /llm-monitor page.
-- Run in Supabase SQL Editor after STEP45.
-- ============================================================

CREATE TABLE IF NOT EXISTS llm_usage_logs (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID,
  source            TEXT,       -- 'data_assistant' | 'neo_task_ai'
  provider          TEXT,       -- 'deepseek' | 'gemini' | 'ollama' | 'claude'
  model             TEXT,
  question          TEXT,       -- truncated prompt/question, for context in the request log
  prompt_tokens     INT,
  completion_tokens INT,
  total_tokens      INT,
  latency_ms        INT,
  success           BOOLEAN     DEFAULT true,
  error_message     TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS llm_usage_logs_created_idx ON llm_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS llm_usage_logs_user_idx    ON llm_usage_logs(user_id);

ALTER TABLE llm_usage_logs ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can log their own request (the app inserts a row
-- right after each LLM call completes or fails).
DROP POLICY IF EXISTS llm_usage_logs_insert ON llm_usage_logs;
CREATE POLICY llm_usage_logs_insert ON llm_usage_logs FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Only admin/ceo can read the monitor data — matches app-monitor's existing gate.
DROP POLICY IF EXISTS llm_usage_logs_select ON llm_usage_logs;
CREATE POLICY llm_usage_logs_select ON llm_usage_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','ceo'))
);

NOTIFY pgrst, 'reload schema';
