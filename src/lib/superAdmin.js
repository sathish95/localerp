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

// Billing (STEP107) — plan/status/trial/seat-override changes all go
// through this one SECURITY DEFINER RPC (never a plain table update)
// because it can also resolve the upgrade_request that prompted the
// change in the same call.
export async function setOrgBilling(orgId, { planKey, billingStatus, trialEndsAt, seatLimitOverride, requestId }) {
  const { error } = await supabase.rpc('super_admin_set_org_billing', {
    p_org_id: orgId,
    p_plan_key: planKey,
    p_billing_status: billingStatus,
    p_trial_ends_at: trialEndsAt || null,
    p_seat_limit_override: seatLimitOverride ?? null,
    p_request_id: requestId || null,
  })
  if (error) throw error
}

export async function listBillingRequests() {
  const { data, error } = await supabase.rpc('super_admin_list_billing_requests')
  if (error) throw error
  return data || []
}

export async function dismissBillingRequest(requestId) {
  const { error } = await supabase.rpc('super_admin_dismiss_billing_request', { p_request_id: requestId })
  if (error) throw error
}
