import { supabase } from './supabase'

// Industry-Adaptive Platform Phase 6 — Locations. Same shape as
// src/lib/onboarding.js's department functions, kept in its own file
// rather than added there since that file is specifically about the
// org-onboarding-status checklist, not general org-structure CRUD.

export async function listLocations(orgId) {
  const { data, error } = await supabase.from('locations').select('*').eq('organization_id', orgId).order('name')
  if (error) throw error
  return data || []
}

export async function createLocation(orgId, patch) {
  const { error } = await supabase.from('locations').insert({
    organization_id: orgId, name: patch.name, code: patch.code || null,
    location_type: patch.location_type || 'other', address: patch.address || null,
  })
  if (error) throw error
}

export async function updateLocation(id, patch) {
  const { error } = await supabase.from('locations').update({
    name: patch.name, code: patch.code || null, location_type: patch.location_type || 'other',
    address: patch.address || null, status: patch.status || 'active',
  }).eq('id', id)
  if (error) throw error
}

export async function deleteLocation(id) {
  const { error } = await supabase.from('locations').delete().eq('id', id)
  if (error) throw error
}
