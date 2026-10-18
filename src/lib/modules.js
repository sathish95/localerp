import { supabase } from './supabase'
import { MODULES } from '../config/modules'

// Module enablement (STEP43) — per-organization enabled switch + per-role
// visibility (STEP89/STEP90 added organization_id to both tables),
// replacing TabVisibilityContext's old localStorage-only DEFAULT_TABS.
// Every function here takes an explicit organizationId param (sourced
// from useAuth()'s profile.organization_id by callers) rather than
// resolving it internally, since this is a plain lib file, not a React
// hook — mirrors the existing setModuleEnabled(key, enabled, profileId)
// pattern of passing caller context in explicitly.

// 'settings' must never end up disabled for an org — that would lock
// every admin of that org out of the one screen that could turn it back on.
const PROTECTED_MODULE = 'settings'

export async function getModules(organizationId) {
  if (!organizationId) return []
  const { data } = await supabase.from('modules').select('*').eq('organization_id', organizationId).order('key')
  return data || []
}

export async function setModuleEnabled(key, enabled, profileId, organizationId) {
  if (key === PROTECTED_MODULE && !enabled) throw new Error('The Settings module cannot be disabled — it would lock out further configuration.')
  const { error } = await supabase.from('modules').update({ enabled, updated_by: profileId })
    .eq('key', key).eq('organization_id', organizationId)
  if (error) throw error
}

export async function getModuleRoleVisibility(organizationId) {
  if (!organizationId) return []
  const { data } = await supabase.from('module_role_visibility').select('*').eq('organization_id', organizationId)
  return data || []
}

export async function setModuleRoleVisibility(moduleKey, role, visible, organizationId) {
  const { error } = await supabase.from('module_role_visibility')
    .upsert({ organization_id: organizationId, module_key: moduleKey, role, visible }, { onConflict: 'organization_id,module_key,role' })
  if (error) throw error
}

// Bulk variant for "manage access for this role" — the per-cell toggle
// above is one write per click; this saves an entire role's whole module
// picklist as one upsert call instead of N. `rows` is [{module_key, visible}, ...].
export async function setModuleRoleVisibilityBulk(organizationId, role, rows) {
  if (!rows.length) return
  const { error } = await supabase.from('module_role_visibility')
    .upsert(rows.map(r => ({ organization_id: organizationId, module_key: r.module_key, role, visible: r.visible })), { onConflict: 'organization_id,module_key,role' })
  if (error) throw error
}

// Self-healing: inserts any module.js key missing from the DB table for
// THIS organization (enabled by default) so adding a new page later, or
// provisioning a new org, doesn't require a manual seed step. Safe to
// call repeatedly — INSERT ... ON CONFLICT DO NOTHING via a pre-filter
// against what's already there for this org.
export async function syncModulesFromConfig(organizationId) {
  if (!organizationId) return 0
  const existing = await getModules(organizationId)
  const existingKeys = new Set(existing.map(m => m.key))
  const missing = MODULES.filter(m => !existingKeys.has(m.key)).map(m => ({ key: m.key, label: m.label, organization_id: organizationId }))
  if (missing.length) await supabase.from('modules').insert(missing)
  return missing.length
}
