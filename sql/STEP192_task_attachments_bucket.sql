-- STEP192: Storage bucket for inline images pasted/attached into Task
-- descriptions and Daily Update comments (rich text editor).
--
-- Mirrors STEP176's wiki-attachments bucket exactly, minus the separate
-- metadata table — these images are embedded inline as <img> tags inside
-- project_tasks.description / task_comments.comment (now rich-text HTML,
-- sanitized client-side with DOMPurify before render), not listed in a
-- side panel, so there's nothing else to track in Postgres. Object paths
-- are namespaced `<organization_id>/<task_id>/<filename>` (task_id is
-- 'pending' while composing a not-yet-created task) so the storage
-- policies can enforce org isolation via storage.foldername() alone.

INSERT INTO storage.buckets (id, name, public) VALUES ('task-attachments', 'task-attachments', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS task_attachments_select ON storage.objects;
DROP POLICY IF EXISTS task_attachments_insert ON storage.objects;
DROP POLICY IF EXISTS task_attachments_delete ON storage.objects;

-- Public read (images render inline in the editor/view without an auth
-- header, same trust level as wiki-attachments/landing-assets). Write
-- scoped to the caller's own org via the path's first folder segment.
CREATE POLICY task_attachments_select ON storage.objects FOR SELECT USING (bucket_id = 'task-attachments');
CREATE POLICY task_attachments_insert ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'task-attachments' AND (storage.foldername(name))[1] = current_org_id()::text
);
CREATE POLICY task_attachments_delete ON storage.objects FOR DELETE USING (
  bucket_id = 'task-attachments' AND (storage.foldername(name))[1] = current_org_id()::text
);

NOTIFY pgrst, 'reload schema';
