import { supabase } from './supabase'

// Unified template system (STEP114) spanning Invoice, Delivery Note,
// Proposal, Warranty and GRN — generalizes the old proposal-only
// proposalTemplates.js. `audience` only means anything for 'proposal'
// ('customer' | 'internal'); pass undefined/null for the other four types.
//
// Lifecycle is Draft -> Active -> Archived instead of a plain is_default
// flag. Only one Active template per (org, document_type, audience) is
// ever read by an export function — enforced here by clearing any
// existing Active sibling before activating a new one, the same
// clear-then-set pattern proposalTemplates.js used for is_default.

function scoped(query, documentType, audience) {
  let q = query.eq('document_type', documentType)
  return audience ? q.eq('audience', audience) : q.is('audience', null)
}

export async function listTemplates(documentType, audience) {
  const { data, error } = await scoped(
    supabase.from('document_templates').select('*'), documentType, audience
  ).order('status').order('template_name')
  if (error) throw error
  return data || []
}

export async function getActiveTemplate(documentType, audience) {
  const { data } = await scoped(
    supabase.from('document_templates').select('*').eq('status', 'active'), documentType, audience
  ).maybeSingle()
  return data || null
}

async function clearActiveSibling(documentType, audience, exceptId) {
  let q = supabase.from('document_templates').update({ status: 'draft' })
  q = scoped(q, documentType, audience).eq('status', 'active')
  if (exceptId) q = q.neq('id', exceptId)
  await q
}

export async function createTemplate(patch, userId) {
  if (patch.status === 'active') await clearActiveSibling(patch.document_type, patch.audience)
  const { error } = await supabase.from('document_templates').insert({ ...patch, created_by: userId })
  if (error) throw error
}

export async function updateTemplate(id, patch) {
  if (patch.status === 'active') {
    const { data: existing } = await supabase.from('document_templates').select('document_type,audience').eq('id', id).single()
    if (existing) await clearActiveSibling(existing.document_type, existing.audience, id)
  }
  const { error } = await supabase.from('document_templates').update(patch).eq('id', id)
  if (error) throw error
}

// One-click list action — separate from updateTemplate so the edit modal
// never has to reason about clearing siblings itself.
export async function setActive(id) {
  const { data: existing, error: fetchErr } = await supabase.from('document_templates').select('document_type,audience').eq('id', id).single()
  if (fetchErr) throw fetchErr
  await clearActiveSibling(existing.document_type, existing.audience, id)
  const { error } = await supabase.from('document_templates').update({ status: 'active' }).eq('id', id)
  if (error) throw error
}

export async function archiveTemplate(id) {
  const { error } = await supabase.from('document_templates').update({ status: 'archived' }).eq('id', id)
  if (error) throw error
}

export async function deleteTemplate(id) {
  const { error } = await supabase.from('document_templates').delete().eq('id', id)
  if (error) throw error
}
