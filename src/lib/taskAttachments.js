import { supabase } from './supabase'

// Mirrors src/lib/wikiAttachments.js's exact upload pattern against the
// 'task-attachments' bucket (STEP192) — used for images pasted/attached
// inline into a Task description or Daily Update comment via
// RichTextEditor. taskId is 'pending' while composing a not-yet-created
// task; the bucket path only needs the org segment for storage RLS.
export async function uploadTaskImage(taskId, file, orgId) {
  const path = `${orgId}/${taskId || 'pending'}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`
  const { error } = await supabase.storage.from('task-attachments').upload(path, file, { upsert: true })
  if (error) throw error
  const { data } = supabase.storage.from('task-attachments').getPublicUrl(path)
  return data?.publicUrl
}
