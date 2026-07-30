import { supabase } from './supabase'

export async function listTemplates(templateType) {
  let q = supabase.from('proposal_templates').select('*').order('template_type').order('template_name')
  if (templateType) q = q.eq('template_type', templateType)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function getDefaultTemplate(templateType) {
  const { data } = await supabase.from('proposal_templates').select('*').eq('template_type', templateType).eq('is_default', true).maybeSingle()
  return data || null
}

export async function createTemplate(patch, userId) {
  // Only one default per type — clear any existing default first if this one is being set as default.
  if (patch.is_default) await supabase.from('proposal_templates').update({ is_default: false }).eq('template_type', patch.template_type)
  const { error } = await supabase.from('proposal_templates').insert({ ...patch, created_by: userId })
  if (error) throw error
}

export async function updateTemplate(id, patch) {
  if (patch.is_default) {
    const { data: existing } = await supabase.from('proposal_templates').select('template_type').eq('id', id).single()
    await supabase.from('proposal_templates').update({ is_default: false }).eq('template_type', existing.template_type).neq('id', id)
  }
  const { error } = await supabase.from('proposal_templates').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteTemplate(id) {
  const { error } = await supabase.from('proposal_templates').delete().eq('id', id)
  if (error) throw error
}
