import { supabase } from './supabase'

// Industry-Adaptive Platform — Phase 1 data layer (STEP180). Every
// function takes an explicit organizationId param rather than resolving
// it internally, matching src/lib/modules.js's existing convention
// (this is a plain lib file, not a hook — callers source the org id from
// useAuth()'s profile.organization_id).
//
// getWorkspaceProfile()'s auto-create fallback is defensive only —
// STEP180 already seeds a legacy-default row for every org that exists
// at migration time, and new-org signup will get one created explicitly
// during onboarding (Phase 2). This just guards against the edge case
// of an org created between "STEP180 ran" and "the next migration that
// seeds new orgs" ships.

export async function getWorkspaceProfile(organizationId) {
  if (!organizationId) return null
  const { data, error } = await supabase
    .from('workspace_profiles')
    .select('*, industry_profile:industry_profiles(id,key,name,icon), business_type:business_types(id,key,name)')
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (error) throw error
  if (data) return data

  const { data: created, error: createErr } = await supabase
    .from('workspace_profiles')
    .insert({ organization_id: organizationId, is_legacy_default: true, terminology_overrides: {} })
    .select('*, industry_profile:industry_profiles(id,key,name,icon), business_type:business_types(id,key,name)')
    .single()
  if (createErr) throw createErr
  return created
}

export async function listIndustryProfiles() {
  const { data, error } = await supabase.from('industry_profiles').select('*').eq('active', true).order('sort_order')
  if (error) throw error
  return data || []
}

export async function listBusinessTypes(industryProfileId) {
  if (!industryProfileId) return []
  const { data, error } = await supabase
    .from('business_types')
    .select('*')
    .eq('industry_profile_id', industryProfileId)
    .eq('active', true)
    .order('sort_order')
  if (error) throw error
  return data || []
}

export async function listOperatingModels() {
  const { data, error } = await supabase.from('operating_models').select('*').eq('active', true).order('sort_order')
  if (error) throw error
  return data || []
}

// Modules added after workspace module lists could first be saved (the
// Workspace tab / onboarding wizard). Lists saved before STEP236 have no
// known_module_keys, so this is their baseline: every other module was on
// screen when they were saved. Only needs keys that predate STEP236 —
// anything added later is covered by known_module_keys.
const ADDED_AFTER_LEGACY_LISTS = ['golive-support', 'contacts']

// Is a module part of this workspace's selection? No saved list = no
// override. A module the admin saw and unticked stays hidden; one added
// to the app after the list was saved shows by default.
export function isModuleInWorkspace(workspace, key) {
  const enabled = workspace?.enabled_module_keys
  if (!Array.isArray(enabled) || enabled.includes(key)) return true
  const known = workspace.known_module_keys
  if (Array.isArray(known)) return !known.includes(key)
  return ADDED_AFTER_LEGACY_LISTS.includes(key)
}

// patch: { industry_profile_id?, business_type_id?, terminology_overrides?,
// enabled_module_keys?, known_module_keys?, is_legacy_default?, onboarding_completed_at? }
// RLS restricts this to admin/ceo/platform-super-admin — callers don't
// need to re-check role, the write will just fail (silently, for the
// UI to surface) for anyone else.
export async function updateWorkspaceProfile(id, patch) {
  const run = p => supabase
    .from('workspace_profiles')
    .update(p)
    .eq('id', id)
    .select('*, industry_profile:industry_profiles(id,key,name,icon), business_type:business_types(id,key,name)')
    .single()
  let { data, error } = await run(patch)
  // Database without STEP236 yet — save the rest rather than failing the whole save.
  if (error && 'known_module_keys' in patch && /known_module_keys/.test(error.message || '')) {
    const { known_module_keys, ...rest } = patch
    ;({ data, error } = await run(rest))
  }
  if (error) throw error
  return data
}

export async function listWorkspaceOperatingModels(workspaceProfileId) {
  if (!workspaceProfileId) return []
  const { data, error } = await supabase
    .from('workspace_operating_models')
    .select('*, operating_model:operating_models(id,key,name,description)')
    .eq('workspace_profile_id', workspaceProfileId)
  if (error) throw error
  return data || []
}

// Replace-all semantics: deletes whatever this workspace had and inserts
// the new set in one go, rather than diffing — the calling UI (a
// multi-select) always has the full intended set in hand anyway.
export async function setWorkspaceOperatingModels(workspaceProfileId, operatingModelIds) {
  const { error: delErr } = await supabase
    .from('workspace_operating_models')
    .delete()
    .eq('workspace_profile_id', workspaceProfileId)
  if (delErr) throw delErr

  if (!operatingModelIds.length) return []

  const { data, error } = await supabase
    .from('workspace_operating_models')
    .insert(operatingModelIds.map(operatingModelId => ({ workspace_profile_id: workspaceProfileId, operating_model_id: operatingModelId })))
    .select('*, operating_model:operating_models(id,key,name,description)')
  if (error) throw error
  return data || []
}
