import { supabase } from './supabase'
import { bytesToHex, hexToBytes } from './wikiPages'

export async function listPageVersions(pageId) {
  const { data, error } = await supabase.from('wiki_page_versions')
    .select('id,version_no,status,content_text,edited_by,created_at')
    .eq('page_id', pageId).order('version_no', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getPageVersion(id) {
  const { data, error } = await supabase.from('wiki_page_versions').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export async function saveWikiPageVersion(pageId, ydocStateBytes, contentText, userId) {
  const { data, error } = await supabase.rpc('save_wiki_page_version', {
    p_page_id: pageId, p_ydoc_state: bytesToHex(ydocStateBytes), p_content_text: contentText, p_user_id: userId,
  })
  if (error) throw error
  return data
}

// Restoring an old version overwrites the page's CURRENT saved state (so
// the next person to open it sees the restored content) and records the
// restore as a brand-new version — never mutates/deletes history, same as
// Confluence's own "restore" semantics.
//
// Known limitation: if someone has the page open live right now, their
// in-memory Yjs doc keeps its own state until they reload — merging an
// old snapshot into a live, actively-edited CRDT document safely would
// need real document-replace surgery (diffing two Y.Doc XML fragments),
// which is out of scope here. Restoring while someone else is actively
// co-editing the same page is the one case this doesn't handle live.
export async function restorePageVersion(pageId, versionId, userId) {
  const version = await getPageVersion(versionId)
  if (!version) throw new Error('Version not found')
  await supabase.from('wiki_pages').update({
    ydoc_state: version.ydoc_state, content_text: version.content_text,
    updated_by: userId, updated_at: new Date().toISOString(),
  }).eq('id', pageId)
  return saveWikiPageVersion(pageId, hexToBytes(version.ydoc_state), version.content_text, userId)
}
