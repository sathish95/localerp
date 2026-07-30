import { supabase } from './supabase'

export async function getKbModules() {
  const { data, error } = await supabase.from('kb_modules').select('*').order('section').order('sort_order')
  if (error) { console.error('[knowledgeBase:get]', error); return [] }
  return data || []
}

export async function updateKbModule(id, fields, userId) {
  const { error } = await supabase.from('kb_modules').update({
    ...fields,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw error
}
