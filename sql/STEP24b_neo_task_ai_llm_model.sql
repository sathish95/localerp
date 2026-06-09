-- STEP24b: Add llm_model column to ai_analysis_sessions
-- Run in Supabase SQL Editor after STEP24

ALTER TABLE ai_analysis_sessions
  ADD COLUMN IF NOT EXISTS llm_model TEXT DEFAULT 'deepseek-v3';

NOTIFY pgrst, 'reload schema';
