import { supabase } from './supabase'

// Industry-Adaptive Platform Phase 6 — Shift patterns + assignments.

export async function listShiftPatterns(orgId) {
  const { data, error } = await supabase.from('shift_patterns').select('*').eq('organization_id', orgId).order('name')
  if (error) throw error
  return data || []
}

export async function createShiftPattern(orgId, patch) {
  const { error } = await supabase.from('shift_patterns').insert({
    organization_id: orgId, name: patch.name, pattern_type: patch.pattern_type || 'fixed',
    start_time: patch.start_time || null, end_time: patch.end_time || null,
  })
  if (error) throw error
}

export async function updateShiftPattern(id, patch) {
  const { error } = await supabase.from('shift_patterns').update({
    name: patch.name, pattern_type: patch.pattern_type || 'fixed',
    start_time: patch.start_time || null, end_time: patch.end_time || null,
  }).eq('id', id)
  if (error) throw error
}

export async function deleteShiftPattern(id) {
  const { error } = await supabase.from('shift_patterns').delete().eq('id', id)
  if (error) throw error
}

export async function listShiftAssignments(orgId) {
  const { data, error } = await supabase
    .from('person_shift_assignments')
    .select('*, person:profiles!person_id(id,full_name), shift:shift_patterns!shift_pattern_id(id,name,start_time,end_time)')
    .eq('organization_id', orgId)
    .order('effective_from', { ascending: false })
  if (error) throw error
  return data || []
}

export async function assignShift(orgId, personId, shiftPatternId, effectiveFrom, effectiveTo = null) {
  const { error } = await supabase.from('person_shift_assignments').insert({
    organization_id: orgId, person_id: personId, shift_pattern_id: shiftPatternId,
    effective_from: effectiveFrom, effective_to: effectiveTo,
  })
  if (error) throw error
}

export async function deleteShiftAssignment(id) {
  const { error } = await supabase.from('person_shift_assignments').delete().eq('id', id)
  if (error) throw error
}

// Today's active shift assignment for a person, if any — read-only
// lookup used by MyWorkPage.jsx's check-in banner (context text only,
// never gates check-in itself).
export async function getTodayShift(personId) {
  const today = new Date().toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('person_shift_assignments')
    .select('*, shift:shift_patterns!shift_pattern_id(id,name,start_time,end_time)')
    .eq('person_id', personId)
    .lte('effective_from', today)
    .or(`effective_to.is.null,effective_to.gte.${today}`)
    .order('effective_from', { ascending: false })
    .limit(1)
  if (error) throw error
  return data?.[0] || null
}
