import { supabase } from './supabase'

// One row per org (STEP113) — the letterhead/GST config used both by
// Settings -> GST Settings and by customerInvoiceExport.js /
// deliveryNoteExport.js when building the PDF. Cached in-memory per the
// same reasoning as llmSettings.js — cleared on save so a fresh export
// immediately picks up an edited letterhead.
let cached = null

export async function getDocumentSettings() {
  if (cached) return cached
  try {
    const { data, error } = await supabase.from('document_settings').select('*').limit(1).maybeSingle()
    if (error) throw error
    cached = data || {}
  } catch (err) {
    console.error('[documentSettings:get]', err)
    cached = {}
  }
  return cached
}

export async function saveDocumentSettings(fields, profileId) {
  const existing = await getDocumentSettings()
  const payload = { ...fields, updated_by: profileId }
  const { error } = existing?.id
    ? await supabase.from('document_settings').update(payload).eq('id', existing.id)
    : await supabase.from('document_settings').insert(payload)
  if (error) throw error
  cached = null
  return getDocumentSettings()
}
