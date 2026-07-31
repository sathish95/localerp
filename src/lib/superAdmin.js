import { supabase } from './supabase'

// Platform-level operations, gated by profile.is_super_admin — never
// module- or org-scoped. listOrganizations() goes through a SECURITY
// DEFINER RPC (STEP105) because RLS itself can't give a super admin
// visibility into other orgs' profiles (current_org_id() only ever
// resolves their own); create/suspend work as plain table calls since
// organizations_write (STEP89) already grants a super admin direct
// INSERT/UPDATE via RLS.

export async function listOrganizations() {
  const { data, error } = await supabase.rpc('super_admin_list_organizations')
  if (error) throw error
  return data || []
}

export async function createOrganization(name, slug) {
  const { data, error } = await supabase.from('organizations').insert({ name, slug }).select().single()
  if (error) throw error
  return data
}

export async function setOrganizationActive(id, isActive) {
  const { error } = await supabase.from('organizations').update({ is_active: isActive }).eq('id', id)
  if (error) throw error
}
