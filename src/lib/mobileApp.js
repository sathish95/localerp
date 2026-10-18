import { supabase } from './supabase'

// Backs Settings → "Mobile App" tab (STEP161/163/165). Capability (does a
// mobile screen exist) is code-owned via mobile_module_capable_keys();
// this file only touches the per-org preference + allocation enforcement.

export async function getMobileCapableKeys() {
  const { data, error } = await supabase.rpc('mobile_module_capable_keys')
  if (error) throw error
  return data || []
}

export async function getMobileModuleConfig(organizationId) {
  const { data, error } = await supabase.from('mobile_module_config').select('*').eq('organization_id', organizationId)
  if (error) throw error
  return data || []
}

// fields: { is_enabled?, min_role? }. Absence of a row = enabled, no role floor.
export async function setMobileModuleConfig(organizationId, moduleKey, fields, profileId) {
  const { error } = await supabase.from('mobile_module_config').upsert(
    { organization_id: organizationId, module_key: moduleKey, updated_by: profileId, ...fields },
    { onConflict: 'organization_id,module_key' },
  )
  if (error) throw error
}

/* ── Allocation enforcement (STEP163) ── */

export async function getAllocationEnforcement(organizationId) {
  const { data, error } = await supabase.from('organizations')
    .select('allocation_enforcement_enabled').eq('id', organizationId).single()
  if (error) throw error
  return !!data?.allocation_enforcement_enabled
}

export async function previewAllocationImpact() {
  const { data, error } = await supabase.rpc('preview_allocation_impact')
  if (error) throw error
  return data || []
}

export async function backfillAllocations() {
  const { data, error } = await supabase.rpc('backfill_module_allocations')
  if (error) throw error
  return Number(data) || 0
}

export async function setAllocationEnforcement(enabled) {
  const { error } = await supabase.rpc('set_allocation_enforcement', { p_enabled: enabled })
  if (error) throw error
}

/* ── Effective-access preview (STEP165) ── */

export async function effectiveModulesFor(userId, platform) {
  const { data, error } = await supabase.rpc('get_effective_modules_for', { p_user_id: userId, p_platform: platform })
  if (error) throw error
  return data || []
}

export const REASON_LABEL = {
  ok: 'Available',
  not_purchased: 'Not in the plan',
  org_disabled: 'Disabled org-wide',
  role_hidden: 'Hidden for this role',
  not_allocated: 'No seat allocated',
  not_on_mobile: 'No mobile screen / hidden',
}
