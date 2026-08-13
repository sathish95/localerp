import { supabase } from './supabase'

// À-la-carte module billing (STEP124) — extends billing.js's seat-tier
// plans with per-bundle add-ons. Mirrors billing.js's request/approval
// shape exactly: an org admin/ceo requests a change, a platform super
// admin actions it from /super-admin. No self-serve checkout — same
// reasoning as the seat-tier flow (no payment gateway wired up yet).

export async function listBundles() {
  const { data, error } = await supabase.from('billing_bundles').select('*').eq('is_active', true).order('sort_order')
  if (error) throw error
  return data || []
}

export async function myBundleSubscriptions(organizationId) {
  const { data, error } = await supabase.from('organization_bundle_subscriptions')
    .select('*').eq('organization_id', organizationId).eq('status', 'active')
  if (error) throw error
  return data || []
}

export async function myBundleRequests() {
  const { data, error } = await supabase.from('billing_bundle_requests').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function requestBundleChange(bundleKey, action, note) {
  const { data, error } = await supabase.rpc('request_bundle_change', { p_bundle_key: bundleKey, p_action: action, p_note: note || null })
  if (error) throw error
  return data
}

export async function orgBundleMonthlyTotal(organizationId) {
  const { data, error } = await supabase.rpc('org_bundle_monthly_total', { p_org_id: organizationId })
  if (error) throw error
  return Number(data) || 0
}

// {moduleKey: bundleKey} — used by TabVisibilityContext to know which
// bundle (if any) a nav module belongs to.
export function buildModuleBundleMap(bundles) {
  const map = {}
  bundles.forEach(b => (b.module_keys || []).forEach(moduleKey => { map[moduleKey] = b.key }))
  return map
}

/* ═══ Super admin ═══ */

export async function superAdminListBundleRequests() {
  const { data, error } = await supabase.rpc('super_admin_list_bundle_requests')
  if (error) throw error
  return data || []
}

export async function superAdminSetOrgBundle(orgId, bundleKey, active, requestId) {
  const { error } = await supabase.rpc('super_admin_set_org_bundle', {
    p_org_id: orgId, p_bundle_key: bundleKey, p_active: active, p_request_id: requestId || null,
  })
  if (error) throw error
}

export async function superAdminDismissBundleRequest(requestId) {
  const { error } = await supabase.rpc('super_admin_dismiss_bundle_request', { p_request_id: requestId })
  if (error) throw error
}

export async function superAdminListOrgBundles(organizationId) {
  const { data, error } = await supabase.from('organization_bundle_subscriptions')
    .select('*').eq('organization_id', organizationId).eq('status', 'active')
  if (error) throw error
  return data || []
}

// Pricing admin (STEP131) — listBundles() above filters to is_active
// for the org-facing "what can I buy" picker; the pricing console needs
// every bundle including retired ones, so it's a separate query.
export async function superAdminListAllBundles() {
  const { data, error } = await supabase.from('billing_bundles').select('*').order('sort_order')
  if (error) throw error
  return data || []
}

export async function updateBundlePricing(key, { pricePerSeatMonthly, pricePerSeatYearly, isActive }) {
  const { error } = await supabase.from('billing_bundles').update({
    price_per_seat_monthly: pricePerSeatMonthly, price_per_seat_yearly: pricePerSeatYearly, is_active: isActive,
  }).eq('key', key)
  if (error) throw error
}

// Per-user module allocation (STEP131) — informational utilization
// tracking, layered on top of the existing org-wide bundle activation.
// Does not change org_bundle_monthly_total() or any real charge.
export async function listModuleAllocations(organizationId, bundleKey) {
  const { data, error } = await supabase.from('organization_module_allocations')
    .select('*').eq('organization_id', organizationId).eq('bundle_key', bundleKey)
  if (error) throw error
  return data || []
}

export async function setModuleAllocation(organizationId, bundleKey, userId, allocated, allocatedBy) {
  if (allocated) {
    const { error } = await supabase.from('organization_module_allocations')
      .insert({ organization_id: organizationId, bundle_key: bundleKey, user_id: userId, allocated_by: allocatedBy || null })
    if (error) throw error
  } else {
    const { error } = await supabase.from('organization_module_allocations')
      .delete().eq('organization_id', organizationId).eq('bundle_key', bundleKey).eq('user_id', userId)
    if (error) throw error
  }
}

export async function orgBundleUtilizationEstimate(organizationId) {
  const { data, error } = await supabase.rpc('org_bundle_utilization_estimate', { p_org_id: organizationId })
  if (error) throw error
  return data || []
}
