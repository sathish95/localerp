import { supabase } from './supabase'

// Fine-grained permission matrix (STEP125) — a global catalog (not
// org-scoped, matching `roles` itself) of atomic permissions, and which
// roles have which. Additive on top of this app's existing hardcoded
// role-array checks — see STEP125's header comment for the deliberate
// scope decision behind that.

export async function listPermissions() {
  const { data, error } = await supabase.from('permissions').select('*').order('sort_order')
  if (error) throw error
  return data || []
}

export async function listRolePermissions() {
  const { data, error } = await supabase.from('role_permissions').select('*')
  if (error) throw error
  return data || []
}

export async function setRolePermission(roleKey, permissionKey, granted) {
  if (granted) {
    const { error } = await supabase.from('role_permissions').insert({ role_key: roleKey, permission_key: permissionKey })
    if (error && error.code !== '23505') throw error // 23505 = already granted, not a real failure
  } else {
    const { error } = await supabase.from('role_permissions').delete().eq('role_key', roleKey).eq('permission_key', permissionKey)
    if (error) throw error
  }
}
