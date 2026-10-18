import { supabase } from './supabase'

export async function listSpaces() {
  const { data, error } = await supabase.from('wiki_spaces').select('*').is('archived_at', null).order('name')
  if (error) throw error
  return data || []
}

export async function getSpace(id) {
  const { data, error } = await supabase.from('wiki_spaces').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export async function createSpace({ key, name, description }, userId) {
  const { data, error } = await supabase.from('wiki_spaces')
    .insert({ key, name, description: description || null, created_by: userId })
    .select().single()
  if (error) throw error
  return data
}

export async function updateSpace(id, fields) {
  const { error } = await supabase.from('wiki_spaces').update(fields).eq('id', id)
  if (error) throw error
}

export async function archiveSpace(id) {
  const { error } = await supabase.from('wiki_spaces').update({ archived_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

function keyFrom(text, fallback) {
  const key = (text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)
  return key || fallback
}

// One space per project, created the first time anyone opens that
// project's wiki space — "prepopulated" rather than requiring a manual
// New Space step. Safe to call repeatedly; returns the existing space
// once it's been created once.
export async function ensureProjectSpace(project, userId) {
  const { data: existing, error: findErr } = await supabase.from('wiki_spaces')
    .select('*').eq('project_id', project.id).maybeSingle()
  if (findErr) throw findErr
  if (existing) return existing

  const key = keyFrom(project.code, keyFrom(project.id, 'PRJ'))
  const { data, error } = await supabase.from('wiki_spaces')
    .insert({ key, name: project.name, description: `Auto-created space for project "${project.name}"`, project_id: project.id, created_by: userId })
    .select().single()
  if (!error) return data

  // Unique violation — either the key or project_id collided with a row
  // created concurrently (e.g. two people opening the same project's
  // wiki space at the same moment). The space now exists either way —
  // fetch and use it instead of erroring the user out.
  if (error.code === '23505') {
    const { data: retry, error: retryErr } = await supabase.from('wiki_spaces').select('*').eq('project_id', project.id).maybeSingle()
    if (retryErr) throw retryErr
    if (retry) return retry
  }
  throw error
}
