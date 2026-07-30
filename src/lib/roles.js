import { supabase } from './supabase'

// Dynamic roles (STEP42) — role_key is immutable once created (it's the
// FK target from profiles.role), so only label/color are ever editable.
// is_system rows (the 11 original built-in roles) can't be deleted.

export async function listRoles() {
  const { data } = await supabase.from('roles').select('*').order('is_system', { ascending: false }).order('label')
  return data || []
}

export async function createRole({ role_key, label, color }, profileId) {
  const key = (role_key || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!key) throw new Error('Role key is required')
  if (!label?.trim()) throw new Error('Label is required')
  const { data, error } = await supabase.from('roles').insert({
    role_key: key, label: label.trim(), color: color || null, is_system: false, created_by: profileId,
  }).select().single()
  if (error) throw error
  return data
}

export async function updateRole(role_key, { label, color }) {
  const patch = {}
  if (label != null) patch.label = label.trim()
  if (color !== undefined) patch.color = color || null
  const { error } = await supabase.from('roles').update(patch).eq('role_key', role_key)
  if (error) throw error
}

export async function deleteRole(role_key) {
  const { data: role } = await supabase.from('roles').select('is_system').eq('role_key', role_key).maybeSingle()
  if (role?.is_system) throw new Error('Built-in roles cannot be deleted')
  const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', role_key)
  if (count > 0) throw new Error(`${count} user(s) still have this role — reassign them first`)
  const { error } = await supabase.from('roles').delete().eq('role_key', role_key)
  if (error) throw error
}

// Deterministic fallback color for a role with no explicit `color` set —
// hashes the key so the same role always gets the same color, without
// needing every custom role to pick one at creation time.
const FALLBACK_PALETTE = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6', '#84cc16', '#f43f5e']
export function colorForRole(roleKeyOrColor) {
  if (roleKeyOrColor && /^#[0-9a-f]{6}$/i.test(roleKeyOrColor)) return roleKeyOrColor
  const key = roleKeyOrColor || ''
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length]
}
