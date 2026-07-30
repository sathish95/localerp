import { supabase } from './supabase'

// Cached in-memory so every LLM call doesn't re-fetch; cleared on save so
// the new key takes effect on the very next call, same tab.
let cached = null

export async function getLLMSettings() {
  if (cached) return cached
  try {
    const { data, error } = await supabase.from('llm_settings').select('*').limit(1).maybeSingle()
    if (error) throw error
    cached = data || {}
  } catch (err) {
    console.error('[llmSettings:get]', err)
    cached = {}
  }
  return cached
}

export async function saveLLMSettings(fields, profileId) {
  const existing = await getLLMSettings()
  const payload = { ...fields, updated_by: profileId, updated_at: new Date().toISOString() }
  const { error } = existing?.id
    ? await supabase.from('llm_settings').update(payload).eq('id', existing.id)
    : await supabase.from('llm_settings').insert(payload)
  if (error) throw error
  cached = null
  return getLLMSettings()
}
