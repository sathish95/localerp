import { supabase } from './supabase'

// Template Library + Builder (Phases 7/8).

export async function listTemplates() {
  const { data, error } = await supabase.from('scenario_templates').select('*, variables:scenario_template_variables(*)').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getTemplate(id) {
  const { data, error } = await supabase.from('scenario_templates').select('*, variables:scenario_template_variables(*)').eq('id', id).single()
  if (error) throw error
  return data
}

export async function createTemplate({ name, category, description }) {
  const { data, error } = await supabase.from('scenario_templates').insert({ name, category: category || 'general', description: description || null }).select().single()
  if (error) throw error
  return data
}

export async function updateTemplate(id, fields) {
  const { error } = await supabase.from('scenario_templates').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function duplicateTemplate(id) {
  const original = await getTemplate(id)
  const { data: copy, error } = await supabase.from('scenario_templates').insert({
    name: `${original.name} (Copy)`, category: original.category, description: original.description,
    sections: original.sections, status: 'draft',
  }).select().single()
  if (error) throw error
  if (original.variables?.length) {
    const { error: vErr } = await supabase.from('scenario_template_variables').insert(
      original.variables.map(v => ({ template_id: copy.id, key: v.key, label: v.label, data_type: v.data_type, default_value: v.default_value, formula: v.formula, sort_order: v.sort_order }))
    )
    if (vErr) throw vErr
  }
  return copy
}

export async function setTemplateStatus(id, status) {
  const { error } = await supabase.from('scenario_templates').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function deleteTemplate(id) {
  const { error } = await supabase.from('scenario_templates').delete().eq('id', id)
  if (error) throw error
}

/* ═══ Template sections (drag-and-drop-free reordering — up/down move, see STEP150-era Phase 1 note on no new DnD dependency) ═══ */

export async function setTemplateSections(id, sections) {
  const { error } = await supabase.from('scenario_templates').update({ sections, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

/* ═══ Template variables ═══ */

export async function addTemplateVariable(templateId, { key, label, dataType, defaultValue, formula, sortOrder }) {
  const { error } = await supabase.from('scenario_template_variables').insert({
    template_id: templateId, key, label, data_type: dataType || 'number', default_value: defaultValue || null, formula: formula || null, sort_order: sortOrder || 0,
  })
  if (error) throw error
}

export async function updateTemplateVariable(id, fields) {
  const { error } = await supabase.from('scenario_template_variables').update(fields).eq('id', id)
  if (error) throw error
}

export async function deleteTemplateVariable(id) {
  const { error } = await supabase.from('scenario_template_variables').delete().eq('id', id)
  if (error) throw error
}

export async function reorderTemplateVariables(orderedIds) {
  await Promise.all(orderedIds.map((id, i) => supabase.from('scenario_template_variables').update({ sort_order: i }).eq('id', id)))
}
