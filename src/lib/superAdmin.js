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

// Console expansion (STEP108) — cross-org member management, usage
// visibility, and org soft-delete/restore. All SECURITY DEFINER RPCs:
// profiles RLS scopes a normal query to the caller's own org, and
// organizations has no per-row DELETE semantics for a soft delete.

export async function listMembers(orgId) {
  const { data, error } = await supabase.rpc('super_admin_list_members', { p_org_id: orgId })
  if (error) throw error
  return data || []
}

export async function setMemberRole(memberId, role) {
  const { error } = await supabase.rpc('super_admin_set_member_role', { p_member_id: memberId, p_role: role })
  if (error) throw error
}

export async function setMemberActive(memberId, isActive) {
  const { error } = await supabase.rpc('super_admin_set_member_active', { p_member_id: memberId, p_is_active: isActive })
  if (error) throw error
}

export async function orgActivity(orgId) {
  const { data, error } = await supabase.rpc('super_admin_org_activity', { p_org_id: orgId })
  if (error) throw error
  return data?.[0] || { events_30d: 0, active_users_30d: 0, last_event_at: null }
}

export async function deleteOrganization(orgId) {
  const { error } = await supabase.rpc('super_admin_delete_organization', { p_org_id: orgId })
  if (error) throw error
}

export async function restoreOrganization(orgId) {
  const { error } = await supabase.rpc('super_admin_restore_organization', { p_org_id: orgId })
  if (error) throw error
}

// Platform analytics (STEP127) — MRR/ARR computed from billing_plans +
// active à-la-carte bundles (STEP124), not a payment gateway (none is
// wired up yet, so this is what orgs are configured to owe, not
// confirmed-collected revenue).
export async function platformDashboardStats() {
  const { data, error } = await supabase.rpc('platform_dashboard_stats')
  if (error) throw error
  return data?.[0] || null
}

export async function platformPlanDistribution() {
  const { data, error } = await supabase.rpc('platform_plan_distribution')
  if (error) throw error
  return data || []
}

export async function orgUsage(orgId) {
  const { data, error } = await supabase.rpc('super_admin_org_usage', { p_org_id: orgId })
  if (error) throw error
  return data?.[0] || null
}

// Payment provider admin controls (STEP129). payment_providers_write
// and organizations_write are both already super-admin-only RLS, so
// these are plain table calls — same posture as setOrganizationActive().

export async function setPaymentProviderActive(key, isActive) {
  const { error } = await supabase.from('payment_providers').update({ is_active: isActive }).eq('key', key)
  if (error) throw error
}

// providers: array of provider keys to restrict the org to, or null for
// "no restriction — every platform-active gateway is available".
export async function setOrgPaymentProviders(orgId, providers) {
  const { error } = await supabase.from('organizations').update({ allowed_payment_providers: providers }).eq('id', orgId)
  if (error) throw error
}

// payment_orders_select (STEP128) already lets a platform super admin
// read every org's orders directly — no RPC needed.
export async function listOrgPaymentOrders(orgId) {
  const { data, error } = await supabase.from('payment_orders').select('*').eq('organization_id', orgId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function listRecentPaymentOrders(limit = 25) {
  const { data, error } = await supabase
    .from('payment_orders')
    .select('*, org:organizations(name)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}
