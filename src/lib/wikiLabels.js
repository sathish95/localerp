import { supabase } from './supabase'

export async function listLabels() {
  const { data, error } = await supabase.from('wiki_labels').select('*').order('name')
  if (error) throw error
  return data || []
}

export async function createLabel(name, color) {
  const { data, error } = await supabase.from('wiki_labels').insert({ name: name.trim(), color: color || '#6366f1' }).select().single()
  if (error) throw error
  return data
}

export async function listPageLabels(pageId) {
  const { data, error } = await supabase.from('wiki_page_labels').select('label_id, label:wiki_labels(id,name,color)').eq('page_id', pageId)
  if (error) throw error
  return (data || []).map(r => r.label).filter(Boolean)
}

// Replaces the full label set on a page with `labelIds` in one call.
export async function setPageLabels(pageId, labelIds) {
  const { data: existing, error: readErr } = await supabase.from('wiki_page_labels').select('label_id').eq('page_id', pageId)
  if (readErr) throw readErr
  const before = new Set((existing || []).map(r => r.label_id))
  const after = new Set(labelIds)
  const toAdd = [...after].filter(id => !before.has(id))
  const toRemove = [...before].filter(id => !after.has(id))
  if (toAdd.length) await supabase.from('wiki_page_labels').insert(toAdd.map(label_id => ({ page_id: pageId, label_id })))
  if (toRemove.length) await supabase.from('wiki_page_labels').delete().eq('page_id', pageId).in('label_id', toRemove)
}
