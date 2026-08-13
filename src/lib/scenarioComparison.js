import { supabase } from './supabase'

// Scenario Comparison (Phase 10) — numbers always computed live via
// compare_scenario_versions(); scenario_comparisons only stores which
// versions were selected under what name, per the Phase 1 design
// decision (never a cached/stale set of KPI values).

export async function compareVersions(versionIds) {
  const { data, error } = await supabase.rpc('compare_scenario_versions', { p_version_ids: versionIds })
  if (error) throw error
  return data || []
}

export async function saveComparison(name, versionIds) {
  const { data, error } = await supabase.from('scenario_comparisons').insert({ name, version_ids: versionIds }).select().single()
  if (error) throw error
  return data
}

export async function listSavedComparisons() {
  const { data, error } = await supabase.from('scenario_comparisons').select('*').order('created_at', { ascending: false }).limit(100)
  if (error) throw error
  return data || []
}

export async function deleteSavedComparison(id) {
  const { error } = await supabase.from('scenario_comparisons').delete().eq('id', id)
  if (error) throw error
}
