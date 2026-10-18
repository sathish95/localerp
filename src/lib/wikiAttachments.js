import { supabase } from './supabase'

// Mirrors src/lib/landingPageStorage.js's exact upload pattern against the
// 'wiki-attachments' bucket (STEP176), namespaced by org + page so storage
// RLS can enforce org isolation via the path's first folder segment.
export async function uploadAttachment(pageId, file, userId, orgId) {
  const path = `${orgId}/${pageId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`
  const { error: upErr } = await supabase.storage.from('wiki-attachments').upload(path, file, { upsert: true })
  if (upErr) throw upErr
  const { data } = supabase.storage.from('wiki-attachments').getPublicUrl(path)
  const { error } = await supabase.from('wiki_page_attachments').insert({
    page_id: pageId, storage_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size, uploaded_by: userId,
  })
  if (error) throw error
  return data?.publicUrl
}

export async function listAttachments(pageId) {
  const { data, error } = await supabase.from('wiki_page_attachments').select('*').eq('page_id', pageId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function deleteAttachment(id, storagePath) {
  await supabase.storage.from('wiki-attachments').remove([storagePath])
  const { error } = await supabase.from('wiki_page_attachments').delete().eq('id', id)
  if (error) throw error
}

export function attachmentUrl(storagePath) {
  const { data } = supabase.storage.from('wiki-attachments').getPublicUrl(storagePath)
  return data?.publicUrl
}
