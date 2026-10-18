import { supabase } from './supabase'

// Industry-Adaptive Platform Phase 6 — Teams. Same CRUD shape as
// src/lib/locations.js / src/lib/onboarding.js's departments.

export async function listTeams(orgId) {
  const { data, error } = await supabase
    .from('teams')
    .select('*, lead:profiles!lead_id(id,full_name), members:team_members(id,person_id,role,person:profiles!person_id(id,full_name))')
    .eq('organization_id', orgId)
    .order('name')
  if (error) throw error
  return data || []
}

export async function createTeam(orgId, patch) {
  const { error } = await supabase.from('teams').insert({
    organization_id: orgId, name: patch.name, department_id: patch.department_id || null, lead_id: patch.lead_id || null,
  })
  if (error) throw error
}

export async function updateTeam(id, patch) {
  const { error } = await supabase.from('teams').update({
    name: patch.name, department_id: patch.department_id || null, lead_id: patch.lead_id || null,
  }).eq('id', id)
  if (error) throw error
}

export async function deleteTeam(id) {
  const { error } = await supabase.from('teams').delete().eq('id', id)
  if (error) throw error
}

export async function addTeamMember(teamId, personId, role = 'member') {
  const { error } = await supabase.from('team_members').insert({ team_id: teamId, person_id: personId, role })
  if (error) throw error
}

export async function removeTeamMember(id) {
  const { error } = await supabase.from('team_members').delete().eq('id', id)
  if (error) throw error
}
