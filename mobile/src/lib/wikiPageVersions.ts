import { supabase } from '@/lib/supabase';

// Mobile port of src/lib/wikiPageVersions.js. Restoring a version needs no
// Yjs/editor on mobile at all — it's a plain byte-copy through the
// existing save_wiki_page_version RPC, same as web.

export type WikiPageVersion = {
  id: string;
  page_id: string;
  version_no: number;
  status: 'active' | 'archived';
  content_text: string | null;
  ydoc_state?: string | null; // PostgREST bytea hex string, only present on getPageVersion
  edited_by: string | null;
  created_at: string;
};

export async function listPageVersions(pageId: string): Promise<WikiPageVersion[]> {
  const { data, error } = await supabase.from('wiki_page_versions')
    .select('id,page_id,version_no,status,content_text,edited_by,created_at')
    .eq('page_id', pageId).order('version_no', { ascending: false });
  if (error) throw error;
  return (data ?? []) as WikiPageVersion[];
}

export async function getPageVersion(id: string): Promise<WikiPageVersion | null> {
  const { data, error } = await supabase.from('wiki_page_versions').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as WikiPageVersion | null;
}

export async function saveWikiPageVersion(pageId: string, ydocStateHex: string | null, contentText: string, userId: string): Promise<string> {
  const { data, error } = await supabase.rpc('save_wiki_page_version', {
    p_page_id: pageId, p_ydoc_state: ydocStateHex, p_content_text: contentText, p_user_id: userId,
  });
  if (error) throw error;
  return data as string;
}

// See src/lib/wikiPageVersions.js's restorePageVersion for the same known
// limitation: if someone has the page open live right now, their in-memory
// Yjs doc won't reflect this until they reload.
export async function restorePageVersion(pageId: string, versionId: string, userId: string): Promise<string> {
  const version = await getPageVersion(versionId);
  if (!version) throw new Error('Version not found');
  await supabase.from('wiki_pages').update({
    ydoc_state: version.ydoc_state, content_text: version.content_text,
    updated_by: userId, updated_at: new Date().toISOString(),
  }).eq('id', pageId);
  return saveWikiPageVersion(pageId, version.ydoc_state ?? null, version.content_text ?? '', userId);
}
