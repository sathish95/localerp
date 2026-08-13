import { supabase } from './supabase'

// Scenario Management Platform — core CRUD + lifecycle (Phases 2/5/9/
// 10/11/12/13/14). Thin wrappers over Supabase, matching every other
// domain file in src/lib/ — RLS + the SECURITY DEFINER functions in
// sql/STEP143-150 do the real validation/authorization work.

/* ═══ Scenarios ═══ */

export async function listMyScenarios() {
  const { data: user } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('scenarios')
    .select('*, latest_version:scenario_versions(id, version_number, status, created_at)')
    .eq('created_by', user?.user?.id)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return data || []
}

export async function listAllScenarios() {
  const { data, error } = await supabase.from('scenarios')
    .select('*, creator:profiles!created_by(full_name), versions:scenario_versions(id, version_number, status, updated_at)')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return data || []
}

export async function getScenario(id) {
  const { data, error } = await supabase.from('scenarios').select('*, creator:profiles!created_by(full_name)').eq('id', id).single()
  if (error) throw error
  return data
}

export async function createScenario({ name, objective, category, templateId }) {
  const { data: codeData } = await supabase.rpc('next_scenario_code')
  const { data: user } = await supabase.auth.getUser()
  const { data: scenario, error } = await supabase.from('scenarios').insert({
    name, objective: objective || null, category: category || 'general', template_id: templateId || null, code: codeData,
    created_by: user?.user?.id,
  }).select().single()
  if (error) throw error

  const { data: version, error: vErr } = await supabase.from('scenario_versions').insert({
    scenario_id: scenario.id, version_number: 1, status: 'draft', created_by: user?.user?.id,
  }).select().single()
  if (vErr) throw vErr

  return { scenario, version }
}

export async function updateScenario(id, fields) {
  const { error } = await supabase.from('scenarios').update(fields).eq('id', id)
  if (error) throw error
}

export async function deleteScenario(id) {
  const { error } = await supabase.from('scenarios').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

/* ═══ Versions ═══ */

export async function listVersions(scenarioId) {
  const { data, error } = await supabase.from('scenario_versions').select('*').eq('scenario_id', scenarioId).order('version_number')
  if (error) throw error
  return data || []
}

export async function getVersion(id) {
  const { data, error } = await supabase.from('scenario_versions').select('*, scenario:scenarios(name, code, objective)').eq('id', id).single()
  if (error) throw error
  return data
}

export async function updateVersion(id, fields) {
  const { error } = await supabase.from('scenario_versions').update(fields).eq('id', id)
  if (error) throw error
}

/* ═══ Variables ═══ */

export async function listVariables(versionId) {
  const { data, error } = await supabase.from('scenario_variables').select('*').eq('scenario_version_id', versionId).order('sort_order')
  if (error) throw error
  return data || []
}

export async function upsertVariable(versionId, { key, label, dataType, value, sortOrder }) {
  const { error } = await supabase.from('scenario_variables').upsert({
    scenario_version_id: versionId, key, label, data_type: dataType || 'number', value: String(value ?? ''), sort_order: sortOrder || 0,
  }, { onConflict: 'scenario_version_id,key' })
  if (error) throw error
}

export async function deleteVariable(id) {
  const { error } = await supabase.from('scenario_variables').delete().eq('id', id)
  if (error) throw error
}

/* ═══ Overrides ═══ */

export async function listOverrides(versionId) {
  const { data, error } = await supabase.from('scenario_overrides').select('*').eq('scenario_version_id', versionId).order('created_at')
  if (error) throw error
  return data || []
}

export async function addOverride(versionId, { linkId, field, adjustmentType, adjustmentValue, note }) {
  const { error } = await supabase.from('scenario_overrides').insert({
    scenario_version_id: versionId, scenario_link_id: linkId || null, field,
    adjustment_type: adjustmentType || 'percent', adjustment_value: Number(adjustmentValue) || 0, note: note || null,
  })
  if (error) throw error
}

export async function deleteOverride(id) {
  const { error } = await supabase.from('scenario_overrides').delete().eq('id', id)
  if (error) throw error
}

/* ═══ Simulation ═══ */

export async function runSimulation(versionId) {
  const { data, error } = await supabase.rpc('run_scenario_simulation', { p_version_id: versionId })
  if (error) throw error
  return data
}

export async function listSimulations(versionId) {
  const { data, error } = await supabase.from('scenario_simulations').select('*').eq('scenario_version_id', versionId).order('run_number', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getSimulationResults(simulationId) {
  const { data, error } = await supabase.from('simulation_results').select('*').eq('simulation_id', simulationId)
  if (error) throw error
  return data || []
}

export async function getLatestSimulationResults(versionId, knownSims) {
  const sims = knownSims || await listSimulations(versionId)
  if (!sims.length) return null
  const results = await getSimulationResults(sims[0].id)
  const byKey = {}
  results.forEach(r => { byKey[r.metric_key] = r })
  return { simulation: sims[0], results: byKey }
}

/* ═══ Approval (Phase 11) ═══ */

export async function submitVersion(versionId, note) {
  const { error } = await supabase.rpc('submit_scenario_version', { p_version_id: versionId, p_note: note || null })
  if (error) throw error
}

export async function decideVersion(versionId, decision, note) {
  const { error } = await supabase.rpc('decide_scenario_version', { p_version_id: versionId, p_decision: decision, p_note: note || null })
  if (error) throw error
}

export async function listApprovalLog(versionId) {
  const { data, error } = await supabase.from('scenario_approvals').select('*, actor:profiles!actor_id(full_name)').eq('scenario_version_id', versionId).order('created_at')
  if (error) throw error
  return data || []
}

export async function listPendingApprovals() {
  const { data, error } = await supabase.from('scenario_versions')
    .select('*, scenario:scenarios(name, code, created_by, creator:profiles!created_by(full_name))')
    .in('status', ['submitted', 'under_review'])
    .order('updated_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return data || []
}

/* ═══ Execution (Phase 12) ═══ */

export async function previewExecution(versionId) {
  const { data, error } = await supabase.rpc('preview_scenario_execution', { p_version_id: versionId })
  if (error) throw error
  return data || []
}

export async function executeVersion(versionId) {
  const { data, error } = await supabase.rpc('execute_scenario_version', { p_version_id: versionId })
  if (error) throw error
  return data
}

export async function getExecution(versionId) {
  const { data, error } = await supabase.from('scenario_executions').select('*, items:scenario_execution_items(*)').eq('scenario_version_id', versionId).maybeSingle()
  if (error) throw error
  return data
}

/* ═══ Actuals & Variance (Phase 13) / Reforecast (Phase 14) ═══ */

export async function getVariance(versionId) {
  const { data, error } = await supabase.rpc('get_scenario_variance', { p_version_id: versionId })
  if (error) throw error
  return data?.[0] || null
}

export async function createReforecast(versionId) {
  const { data, error } = await supabase.rpc('create_scenario_reforecast', { p_version_id: versionId })
  if (error) throw error
  return data
}

/* ═══ Portfolio rollup (Phase 15 role dashboards) ═══ */

export async function getPortfolioSummary() {
  const { data, error } = await supabase.rpc('get_scenario_portfolio_summary')
  if (error) throw error
  return data || []
}
