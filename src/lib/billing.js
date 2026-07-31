import { supabase } from './supabase'

// Org-level billing/subscription helpers (STEP107). Plan catalog is
// permissive-SELECT for every signed-in user; an org's own plan/status
// comes off profile.org (AuthContext already joins organizations, which
// carries plan_key/billing_status/trial_ends_at/seat_limit_override —
// no RPC needed to read your own org's billing state, same as its
// name/slug today). Only requesting a change is a write, and that goes
// through request_billing_upgrade() since it also has to notify every
// platform super admin across orgs.

export async function listPlans() {
  const { data, error } = await supabase.from('billing_plans').select('*').eq('is_active', true).order('sort_order')
  if (error) throw error
  return data || []
}

export async function seatUsage(organizationId) {
  const { count, error } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
  if (error) throw error
  return count || 0
}

export async function myUpgradeRequests() {
  const { data, error } = await supabase.from('billing_upgrade_requests').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function requestUpgrade(planKey, note) {
  const { data, error } = await supabase.rpc('request_billing_upgrade', { p_plan_key: planKey, p_note: note || null })
  if (error) throw error
  return data
}
