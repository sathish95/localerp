import { supabase } from './supabase'

export async function listRestrictions(pageId) {
  const { data, error } = await supabase.from('wiki_page_restrictions').select('*').eq('page_id', pageId).order('created_at')
  if (error) throw error
  return data || []
}

export async function addRestriction(pageId, subjectType, subjectId, permission, createdBy) {
  const { error } = await supabase.from('wiki_page_restrictions')
    .insert({ page_id: pageId, subject_type: subjectType, subject_id: subjectId, permission, created_by: createdBy })
  if (error) throw error
}

export async function removeRestriction(id) {
  const { error } = await supabase.from('wiki_page_restrictions').delete().eq('id', id)
  if (error) throw error
}
