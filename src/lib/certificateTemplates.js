import { supabase } from './supabase'

export const PAGE_SIZE_PRESETS = {
  A4:     { landscape: [1200, 849],  portrait: [849, 1200] },
  Letter: { landscape: [1200, 927],  portrait: [927, 1200] },
}

export function dimensionsFor(pageSize, orientation) {
  if (pageSize === 'Custom') return null
  return PAGE_SIZE_PRESETS[pageSize]?.[orientation] || PAGE_SIZE_PRESETS.A4.landscape
}

export async function listTemplates() {
  const { data, error } = await supabase.from('award_certificate_templates')
    .select('*, category:award_categories(name)').order('updated_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getTemplate(id) {
  const { data, error } = await supabase.from('award_certificate_templates').select('*').eq('id', id).single()
  if (error) throw error
  return data
}

export async function getLatestVersion(templateId) {
  const { data, error } = await supabase.from('award_certificate_template_versions')
    .select('*').eq('template_id', templateId).order('version', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return data
}

export async function createTemplate(patch, userId) {
  const [w, h] = dimensionsFor(patch.page_size || 'A4', patch.orientation || 'landscape') || [1200, 849]
  const { data, error } = await supabase.from('award_certificate_templates').insert({
    name: patch.name, award_category_id: patch.award_category_id || null,
    page_size: patch.page_size || 'A4', orientation: patch.orientation || 'landscape',
    canvas_width: w, canvas_height: h, background_color: '#ffffff', elements: [],
    created_by: userId, updated_by: userId,
  }).select().single()
  if (error) throw error
  return data
}

export async function updateTemplate(id, patch, userId) {
  const { error } = await supabase.from('award_certificate_templates').update({ ...patch, updated_by: userId }).eq('id', id)
  if (error) throw error
}

export async function duplicateTemplate(id, userId) {
  const original = await getTemplate(id)
  const { data, error } = await supabase.from('award_certificate_templates').insert({
    name: `${original.name} (Copy)`, award_category_id: original.award_category_id,
    page_size: original.page_size, orientation: original.orientation,
    canvas_width: original.canvas_width, canvas_height: original.canvas_height,
    background_color: original.background_color, background_image: original.background_image,
    elements: original.elements, status: 'draft', version: 0,
    created_by: userId, updated_by: userId,
  }).select().single()
  if (error) throw error
  return data
}

// Snapshots the live template into an immutable version row and bumps
// the live template's version counter + status. Every certificate
// generated from this point on links to THIS version_id — later edits
// to the live template (even another Publish) never touch it.
export async function publishTemplate(id, userId) {
  const template = await getTemplate(id)
  const nextVersion = (template.version || 0) + 1
  const { error: versionErr } = await supabase.from('award_certificate_template_versions').insert({
    template_id: id, version: nextVersion, name: template.name,
    page_size: template.page_size, orientation: template.orientation,
    canvas_width: template.canvas_width, canvas_height: template.canvas_height,
    background_color: template.background_color, background_image: template.background_image,
    elements: template.elements, published_by: userId,
  })
  if (versionErr) throw versionErr
  const { error: updateErr } = await supabase.from('award_certificate_templates')
    .update({ version: nextVersion, status: 'active', updated_by: userId }).eq('id', id)
  if (updateErr) throw updateErr
}

export async function archiveTemplate(id) {
  const { error } = await supabase.from('award_certificate_templates').update({ status: 'archived' }).eq('id', id)
  if (error) throw error
}

// Blocks deletion (suggesting archive instead) once any certificate has
// ever been generated from one of this template's published versions —
// deleting the template would leave those certificates' template_version_id
// dangling (ON DELETE SET NULL), which would break re-rendering their PDF.
export async function deleteTemplate(id) {
  const { data: versions } = await supabase.from('award_certificate_template_versions').select('id').eq('template_id', id)
  const versionIds = (versions || []).map(v => v.id)
  if (versionIds.length) {
    const { count, error: countErr } = await supabase.from('award_certificates').select('id', { count: 'exact', head: true }).in('template_version_id', versionIds)
    if (countErr) throw countErr
    if (count > 0) throw new Error(`${count} certificate(s) were generated from this template. Archive it instead of deleting.`)
  }
  const { error } = await supabase.from('award_certificate_templates').delete().eq('id', id)
  if (error) throw error
}
