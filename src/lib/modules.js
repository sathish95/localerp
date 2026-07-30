import { supabase } from './supabase'
import { MODULES } from '../config/modules'

// Module enablement (STEP43) — company-wide enabled switch + per-role
// visibility, replacing TabVisibilityContext's old localStorage-only
// DEFAULT_TABS. See src/context/TabVisibilityContext.jsx for how these
// are consumed.

// 'settings' must never end up disabled company-wide — that would lock
// every admin out of the one screen that could turn it back on again.
const PROTECTED_MODULE = 'settings'

export async function getModules() {
  const { data } = await supabase.from('modules').select('*').order('key')
  return data || []
}

export async function setModuleEnabled(key, enabled, profileId) {
  if (key === PROTECTED_MODULE && !enabled) throw new Error('The Settings module cannot be disabled — it would lock out further configuration.')
  const { error } = await supabase.from('modules').update({ enabled, updated_by: profileId }).eq('key', key)
  if (error) throw error
}

export async function getModuleRoleVisibility() {
  const { data } = await supabase.from('module_role_visibility').select('*')
  return data || []
}

export async function setModuleRoleVisibility(moduleKey, role, visible) {
  const { error } = await supabase.from('module_role_visibility')
    .upsert({ module_key: moduleKey, role, visible }, { onConflict: 'module_key,role' })
  if (error) throw error
}

// Self-healing: inserts any module.js key missing from the DB table
// (enabled by default) so adding a new page later doesn't require a
// manual seed step. Safe to call repeatedly — INSERT ... ON CONFLICT
// DO NOTHING via a pre-filter against what's already there.
export async function syncModulesFromConfig() {
  const existing = await getModules()
  const existingKeys = new Set(existing.map(m => m.key))
  const missing = MODULES.filter(m => !existingKeys.has(m.key)).map(m => ({ key: m.key, label: m.label }))
  if (missing.length) await supabase.from('modules').insert(missing)
  return missing.length
}
