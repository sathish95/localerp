import { supabase } from './supabase'
import { sendNotifToMany } from './notifications'

// PostgREST represents `bytea` as a hex string ("\x48656c6c6f") in both
// directions — these convert to/from the Uint8Array Yjs works with.
export function bytesToHex(bytes) {
  let hex = '\\x'
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex
}
export function hexToBytes(hex) {
  if (!hex) return null
  const clean = hex.startsWith('\\x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
  return bytes
}

export async function getPageYdoc(id) {
  const { data, error } = await supabase.from('wiki_pages').select('ydoc_state').eq('id', id).maybeSingle()
  if (error) throw error
  return hexToBytes(data?.ydoc_state)
}

export async function persistPageYdoc(id, bytes, contentText, userId) {
  const { error } = await supabase.from('wiki_pages')
    .update({ ydoc_state: bytesToHex(bytes), content_text: contentText, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// Replaces the page's mention list with whatever is currently in the
// content, and notifies only the newly-added ones — an autosave that
// still contains a mention from 5 minutes ago must not re-notify that
// person every few seconds.
export async function syncPageMentions(pageId, currentMentionIds, { title, senderId }) {
  const { data, error } = await supabase.from('wiki_pages').select('mentions,space_id').eq('id', pageId).maybeSingle()
  if (error) throw error
  const before = new Set(data?.mentions || [])
  const after = [...new Set(currentMentionIds)]
  const added = after.filter(id => !before.has(id) && id !== senderId)

  await supabase.from('wiki_pages').update({ mentions: after }).eq('id', pageId)

  if (added.length && data?.space_id) {
    await sendNotifToMany(added, {
      type: 'wiki_mention', title: `📄 Mentioned in "${title}"`,
      body: 'You were mentioned in a wiki page.', link: `/wiki?space=${data.space_id}&page=${pageId}`, senderId,
    })
  }
}

export async function listPages(spaceId) {
  const { data, error } = await supabase.from('wiki_pages').select('*').eq('space_id', spaceId).order('sort_order').order('created_at')
  if (error) throw error
  return data || []
}

export async function getPage(id) {
  const { data, error } = await supabase.from('wiki_pages').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export async function createPage({ spaceId, parentPageId, title, projectId }, userId) {
  const { data, error } = await supabase.from('wiki_pages')
    .insert({ space_id: spaceId, parent_page_id: parentPageId || null, title: title || 'Untitled page', project_id: projectId || null, created_by: userId, updated_by: userId })
    .select().single()
  if (error) throw error
  return data
}

export async function setPageProject(id, projectId) {
  const { error } = await supabase.from('wiki_pages').update({ project_id: projectId || null }).eq('id', id)
  if (error) throw error
}

export async function renamePage(id, title, userId) {
  const { error } = await supabase.from('wiki_pages').update({ title, updated_by: userId, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

// parent_page_id is a soft ref (no FK/CASCADE) — deleting a page without
// also deleting its descendants would leave them pointing at a
// now-nonexistent parent, which buildPageTree can never reach again
// (invisible, permanently orphaned rows). Always delete the whole subtree.
export async function deletePage(id, allPages) {
  const byParent = {}
  allPages.forEach(p => { (byParent[p.parent_page_id] ||= []).push(p.id) })
  const ids = [id]
  for (let i = 0; i < ids.length; i++) ids.push(...(byParent[ids[i]] || []))
  const { error } = await supabase.from('wiki_pages').delete().in('id', ids)
  if (error) throw error
}

// A move must not create a cycle (a page becoming its own, direct or
// transitive, descendant's child) — same DFS idea as src/lib/bom.js's
// wouldCreateCycle, adapted to a single-parent tree.
export function wouldCreateCycle(pageId, newParentId, allPages) {
  if (!newParentId) return false
  if (pageId === newParentId) return true
  const byId = Object.fromEntries(allPages.map(p => [p.id, p]))
  let cur = byId[newParentId]
  const seen = new Set()
  while (cur) {
    if (cur.id === pageId) return true
    if (seen.has(cur.id)) return true // pre-existing cycle in the data — stop rather than loop forever
    seen.add(cur.id)
    cur = cur.parent_page_id ? byId[cur.parent_page_id] : null
  }
  return false
}

export async function movePage(id, newParentId, allPages) {
  if (wouldCreateCycle(id, newParentId, allPages)) throw new Error('Cannot move a page under its own descendant.')
  const { error } = await supabase.from('wiki_pages').update({ parent_page_id: newParentId || null }).eq('id', id)
  if (error) throw error
}

export async function searchPages(query) {
  const q = query.trim()
  if (!q) return []
  const { data, error } = await supabase.from('wiki_pages')
    .select('id,space_id,title,content_text')
    .textSearch('search_vector', q, { type: 'websearch' })
    .limit(15)
  if (error) throw error
  return data || []
}

// Walks a Tiptap JSON doc (editor.getJSON()) collecting every @mention's
// user id, for diffing against wiki_pages.mentions on save.
export function extractMentionIds(node) {
  if (!node) return []
  const ids = node.type === 'mention' && node.attrs?.id ? [node.attrs.id] : []
  return ids.concat(...(node.content || []).map(extractMentionIds))
}

// Assemble a flat page list into a tree for sidebar rendering. Cycle guard
// mirrors src/lib/bom.js's getBomTree — belt-and-suspenders alongside the
// write-time check above.
export function buildPageTree(pages) {
  const byParent = {}
  pages.forEach(p => { (byParent[p.parent_page_id || '__root__'] ||= []).push(p) })
  function build(parentKey, visited) {
    return (byParent[parentKey] || []).map(p => {
      if (visited.has(p.id)) return { ...p, children: [], cycleDetected: true }
      const nextVisited = new Set(visited); nextVisited.add(p.id)
      return { ...p, children: build(p.id, nextVisited) }
    })
  }
  return build('__root__', new Set())
}
