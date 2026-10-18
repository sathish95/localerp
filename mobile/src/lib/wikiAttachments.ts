import { supabase } from '@/lib/supabase';

// Mobile port of src/lib/wikiAttachments.js, against the same
// 'wiki-attachments' bucket (STEP176). Upload mechanics mirror
// requests.ts's uploadReceipt: fetch(localUri) -> blob() -> storage upload
// — the standard Expo/RN pattern for turning a picker URI into bytes
// Supabase Storage accepts, same as the web app's receipt upload.

export type WikiAttachment = {
  id: string;
  page_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
};

export async function listAttachments(pageId: string): Promise<WikiAttachment[]> {
  const { data, error } = await supabase.from('wiki_page_attachments').select('*').eq('page_id', pageId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as WikiAttachment[];
}

export async function uploadAttachment(
  pageId: string, localUri: string, fileName: string, userId: string, orgId: string, mimeType?: string,
): Promise<string> {
  const res = await fetch(localUri);
  const blob = await res.blob();
  const path = `${orgId}/${pageId}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  const { error: upErr } = await supabase.storage.from('wiki-attachments').upload(path, blob, { upsert: true, contentType: mimeType || blob.type || 'application/octet-stream' });
  if (upErr) throw upErr;
  const { data } = supabase.storage.from('wiki-attachments').getPublicUrl(path);
  const { error } = await supabase.from('wiki_page_attachments').insert({
    page_id: pageId, storage_path: path, file_name: fileName, mime_type: mimeType || blob.type || null, size_bytes: blob.size, uploaded_by: userId,
  });
  if (error) throw error;
  return data.publicUrl;
}

export async function deleteAttachment(id: string, storagePath: string) {
  await supabase.storage.from('wiki-attachments').remove([storagePath]);
  const { error } = await supabase.from('wiki_page_attachments').delete().eq('id', id);
  if (error) throw error;
}

export function attachmentUrl(storagePath: string): string {
  const { data } = supabase.storage.from('wiki-attachments').getPublicUrl(storagePath);
  return data.publicUrl;
}
