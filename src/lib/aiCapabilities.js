import { supabase } from './supabase'

// Registry of real, shipped AI capabilities (STEP107-109) that an org
// admin can individually enable/disable (STEP110) — e.g. an org without
// LLM keys configured, or one that wants to control AI usage/cost, can
// turn off BOM AI without touching the underlying BOM module itself.
// Deliberately NOT the same list as src/config/modules.js — these are
// AI sub-features *within* a module (Neo Task AI is part of Projects,
// BOM AI part of Procurement, ...), not modules in their own right, so
// they get their own toggle layer rather than piggybacking on
// module_role_visibility.
export const AI_CAPABILITY_REGISTRY = [
  { key:'neo-task-ai', label:'Neo Task AI', module:'Projects, Tasks & AI' },
  { key:'bom-ai', label:'BOM AI', module:'Procurement & Inventory' },
  { key:'product-ai', label:'Product Catalog AI', module:'Procurement & Inventory' },
  { key:'task-actions', label:'Prompt-Based Task Actions', module:'Projects, Tasks & AI' },
  { key:'customer-invoice-ai', label:'Customer Invoice AI', module:'Finance & Expenses' },
  { key:'vendor-invoice-ai', label:'Vendor Invoice AI', module:'Finance & Expenses' },
  { key:'delivery-note-ai', label:'Delivery Note AI', module:'Finance & Expenses' },
  { key:'scenario-ai', label:'Scenario AI', module:'Scenario Planning' },
]

// Absence of a row means enabled (STEP110's header) — only fetch the
// exceptions and merge them over the "everything on" default, so a
// freshly-created org needs zero setup rows to have every capability on.
export async function getEnabledCapabilities() {
  const { data, error } = await supabase.from('ai_capability_settings').select('capability_key,enabled')
  if (error) throw error
  const overrides = Object.fromEntries((data || []).map(r => [r.capability_key, r.enabled]))
  return Object.fromEntries(AI_CAPABILITY_REGISTRY.map(c => [c.key, overrides[c.key] !== false]))
}

export async function setCapabilityEnabled(capabilityKey, enabled, userId) {
  const { error } = await supabase.from('ai_capability_settings')
    .upsert({ capability_key: capabilityKey, enabled, updated_by: userId }, { onConflict: 'organization_id,capability_key' })
  if (error) throw error
}
