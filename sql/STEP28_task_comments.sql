-- ============================================================
-- STEP28: Task Comments / Daily Updates + Progress %
-- Run in Supabase SQL editor after STEP27.
-- ============================================================

ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS progress_pct INT;

DROP TABLE IF EXISTS task_comments CASCADE;

CREATE TABLE task_comments (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id      UUID        NOT NULL,        -- soft ref to project_tasks
  user_id      UUID,                         -- soft ref to profiles
  comment      TEXT        NOT NULL,
  progress_pct INT,                          -- optional 0-100, snapshot at time of this update
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX task_comments_task_idx ON task_comments(task_id);

ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY task_comments_select ON task_comments FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY task_comments_write  ON task_comments FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_comments TO authenticated;

NOTIFY pgrst, 'reload schema';
