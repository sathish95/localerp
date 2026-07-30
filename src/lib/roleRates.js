import { supabase } from './supabase'

// Picks the role_rates row effective on `onDate` for `designation`. Returns null
// if none found — callers should fall back to the existing per-employee
// resource_rates formula (hourly_rate || monthly_salary/(22*8)).
export async function getRateForDesignation(designation, onDate) {
  if (!designation) return null
  const iso = (onDate instanceof Date ? onDate : new Date(onDate)).toISOString().slice(0, 10)
  const { data } = await supabase.from('role_rates').select('*')
    .eq('designation', designation)
    .lte('effective_from', iso)
    .or(`effective_to.is.null,effective_to.gte.${iso}`)
    .order('effective_from', { ascending: false })
    .limit(1)
  return data?.[0] || null
}

export async function listRoleRates() {
  const { data } = await supabase.from('role_rates').select('*').order('designation').order('effective_from', { ascending: false })
  return data || []
}

// Adds a new rate for a designation. If an open-ended rate already exists for
// that designation, close it the day before the new rate's effective_from so
// the effective-dated history never overlaps.
export async function upsertRoleRate({ designation, hourly_rate, effective_from, notes, created_by }) {
  const { data: openRows } = await supabase.from('role_rates').select('*')
    .eq('designation', designation).is('effective_to', null)
  for (const row of openRows || []) {
    const dayBefore = new Date(effective_from)
    dayBefore.setDate(dayBefore.getDate() - 1)
    await supabase.from('role_rates').update({ effective_to: dayBefore.toISOString().slice(0, 10) }).eq('id', row.id)
  }
  const { error } = await supabase.from('role_rates').insert({
    designation, hourly_rate, effective_from, notes: notes || null, created_by,
  })
  if (error) throw error
}

export async function deleteRoleRate(id) {
  await supabase.from('role_rates').delete().eq('id', id)
}
