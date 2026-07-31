import { supabase } from './supabase'

// Part 7 admin config panel backend — regions, role definitions, rep
// assignments, pipeline stages, lookup lists, assignment rules, stale
// thresholds, and the profit-attribution visibility flag. CRUD shape
// modeled on src/lib/roles.js.

export const DOMAINS = ['B2B', 'B2C', 'D2C', 'Government', 'Non-Government']
export const DIRECTIONS = ['Inbound', 'Outbound']

/* ── Regions ── */
export async function listRegions() {
  const { data } = await supabase.from('sales_regions').select('*').order('region_name')
  return data || []
}
export async function createRegion({ region_name, parent_region_id }) {
  const { data, error } = await supabase.from('sales_regions').insert({ region_name, parent_region_id: parent_region_id || null }).select().single()
  if (error) throw error
  return data
}
export async function updateRegion(id, patch) {
  const { error } = await supabase.from('sales_regions').update(patch).eq('id', id)
  if (error) throw error
}
export async function deleteRegion(id) {
  const { error } = await supabase.from('sales_regions').delete().eq('id', id)
  if (error) throw error
}

/* ── Role definitions ── */
export async function listRoleDefinitions() {
  const { data } = await supabase.from('sales_role_definitions').select('*, region:sales_regions(region_name)').order('domain').order('direction')
  return data || []
}
export async function createRoleDefinition({ direction, domain, region_id, role_title }) {
  const title = role_title?.trim() || `${direction} ${domain}${region_id ? '' : ' (All Regions)'}`
  const { data, error } = await supabase.from('sales_role_definitions').insert({ direction, domain, region_id: region_id || null, role_title: title }).select().single()
  if (error) throw error
  return data
}
export async function updateRoleDefinition(id, patch) {
  const { error } = await supabase.from('sales_role_definitions').update(patch).eq('id', id)
  if (error) throw error
}
export async function deleteRoleDefinition(id) {
  const { error } = await supabase.from('sales_role_definitions').delete().eq('id', id)
  if (error) throw error
}

/* ── Rep assignments ── */
export async function listRepAssignments() {
  const { data } = await supabase.from('sales_rep_assignments')
    .select('*, profile:profiles!profile_id(full_name), role_def:sales_role_definitions(role_title, direction, domain, region_id)')
    .order('created_at', { ascending: false })
  return data || []
}
export async function createRepAssignment({ profile_id, sales_role_definition_id, quota_target, quota_currency, active_from, active_to }) {
  const { data, error } = await supabase.from('sales_rep_assignments').insert({
    profile_id, sales_role_definition_id, quota_target: quota_target || null, quota_currency: quota_currency || 'INR',
    active_from: active_from || new Date().toISOString().slice(0, 10), active_to: active_to || null,
  }).select().single()
  if (error) throw error
  return data
}
export async function deleteRepAssignment(id) {
  const { error } = await supabase.from('sales_rep_assignments').delete().eq('id', id)
  if (error) throw error
}

/* ── Pipeline stages (per domain) ── */
export async function listPipelineStages(domain) {
  let q = supabase.from('sales_pipeline_stages').select('*').order('domain').order('sort_order')
  if (domain) q = q.eq('domain', domain)
  const { data } = await q
  return data || []
}
export async function createPipelineStage({ domain, stage_name, sort_order, default_probability_percent }) {
  const { data, error } = await supabase.from('sales_pipeline_stages').insert({
    domain, stage_name, sort_order: sort_order ?? 0, default_probability_percent: default_probability_percent ?? 0,
  }).select().single()
  if (error) throw error
  return data
}
export async function updatePipelineStage(id, patch) {
  const { error } = await supabase.from('sales_pipeline_stages').update(patch).eq('id', id)
  if (error) throw error
}
export async function deletePipelineStage(id) {
  const { error } = await supabase.from('sales_pipeline_stages').delete().eq('id', id)
  if (error) throw error
}

/* ── Simple lookup lists (lead sources / activity types / task types / outcomes) ── */
const LIST_TABLES = {
  leadSources: 'sales_lead_sources',
  activityTypes: 'sales_activity_types',
  taskTypes: 'sales_task_types',
  outcomes: 'sales_activity_outcomes',
  campaignTypes: 'marketing_campaign_types',
  costTypes: 'marketing_campaign_cost_types',
}
export async function listLookup(kind) {
  const table = LIST_TABLES[kind]
  const { data } = await supabase.from(table).select('*').order('name')
  return data || []
}
export async function createLookup(kind, name) {
  const table = LIST_TABLES[kind]
  const { data, error } = await supabase.from(table).insert({ name: name.trim() }).select().single()
  if (error) throw error
  return data
}
export async function setLookupActive(kind, id, is_active) {
  const table = LIST_TABLES[kind]
  const { error } = await supabase.from(table).update({ is_active }).eq('id', id)
  if (error) throw error
}
export async function deleteLookup(kind, id) {
  const table = LIST_TABLES[kind]
  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) throw error
}

/* ── Assignment rules ── */
export async function listAssignmentRules() {
  const { data } = await supabase.from('sales_assignment_rules').select('*, region:sales_regions(region_name)').order('domain')
  return data || []
}
export async function createAssignmentRule({ domain, region_id, rule_type }) {
  const { data, error } = await supabase.from('sales_assignment_rules').insert({ domain, region_id: region_id || null, rule_type: rule_type || 'domain_region_match' }).select().single()
  if (error) throw error
  return data
}
export async function updateAssignmentRule(id, patch) {
  const { error } = await supabase.from('sales_assignment_rules').update(patch).eq('id', id)
  if (error) throw error
}
export async function deleteAssignmentRule(id) {
  const { error } = await supabase.from('sales_assignment_rules').delete().eq('id', id)
  if (error) throw error
}

/* ── Stale/overdue thresholds ── */
export async function listStaleThresholds() {
  const { data } = await supabase.from('sales_stale_threshold_config').select('*, region:sales_regions(region_name)').order('domain')
  return data || []
}
export async function updateStaleThreshold(id, patch) {
  const { error } = await supabase.from('sales_stale_threshold_config').update(patch).eq('id', id)
  if (error) throw error
}

/* ── Config flags ── */
export async function getConfigFlag(key) {
  const { data } = await supabase.from('sales_config_flags').select('*').eq('key', key).maybeSingle()
  return data?.value ?? null
}
export async function setConfigFlag(key, value, profileId) {
  const { error } = await supabase.from('sales_config_flags').upsert({ key, value, updated_by: profileId || null }, { onConflict: 'organization_id,key' })
  if (error) throw error
}
