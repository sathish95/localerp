import { supabase, adminCreateUser } from './supabase'

// Vendor/reseller referral program (STEP134). A vendor is a platform-
// level account type, orthogonal to organization membership — same
// relationship is_super_admin has to role. Two audiences:
//   - the vendor's own dashboard (their referred orgs + commission)
//   - the super-admin console (create vendors, manage rates, mark paid)

/* ═══ Vendor's own view ═══ */

export async function getMyVendorInfo() {
  const { data, error } = await supabase.from('referral_vendors').select('*').maybeSingle()
  if (error) throw error
  return data
}

export async function listMyReferredOrganizations() {
  const { data, error } = await supabase.rpc('vendor_list_my_organizations')
  if (error) throw error
  return data || []
}

export async function listMyCommissions() {
  const { data, error } = await supabase.from('vendor_commissions').select('*, org:organizations(name)').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Real payout batches (STEP139) — one row per actual payment made to
// this vendor (method, reference, amount), distinct from the
// individual commission line items it settled.
export async function listMyPayouts() {
  const { data, error } = await supabase.from('vendor_payouts').select('*').order('paid_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Promoter seat pool (STEP135) — shared discount pool across every org
// this vendor referred, consumed by those orgs' live headcounts.
export async function getMySeatPoolStatus() {
  const { data, error } = await supabase.rpc('vendor_my_seat_pool_status')
  if (error) throw error
  return data?.[0] || null
}

// Anonymous, pre-signup preview for the landing page estimator
// (STEP137) — never exposes the vendor's identity, only the discount.
export async function checkPromoCode(code) {
  const { data, error } = await supabase.rpc('check_promo_code', { p_code: code })
  if (error) throw error
  return data?.[0] || { valid: false, reason: 'Could not check this code' }
}

// Public "Become a Promoter" application (STEP138) — plain insert,
// no auth required. WITH CHECK on the table pins status/reviewed_by/
// vendor_id to their defaults regardless of what's sent here.
export async function submitPromoterApplication({ fullName, email, phone, companyName, message }) {
  const { error } = await supabase.from('promoter_applications').insert({
    full_name: fullName, email, phone: phone || null, company_name: companyName || null, message: message || null,
  })
  if (error) throw error
}

/* ═══ Super admin ═══ */

export async function listVendors() {
  const { data, error } = await supabase.rpc('super_admin_list_vendors')
  if (error) throw error
  return data || []
}

// Creates the vendor row AND its login in one call. The auth account is
// created client-side via adminCreateUser() (no service-role key exists
// in this app, same constraint every other bulk/admin account-creation
// flow already works within) — org_mode is deliberately left unset, so
// it lands in 'default-org' via handle_new_user()'s existing fallback;
// that's fine, a vendor account's organization_id is never read by the
// vendor dashboard, which is gated on profiles.vendor_id instead.
export async function createVendorWithLogin({ name, code, commissionType, commissionRate, email, tempPassword, fullName }) {
  const { data: vendor, error: vErr } = await supabase.from('referral_vendors').insert({
    name, code: code.trim().toUpperCase(), commission_type: commissionType, commission_rate: Number(commissionRate) || 0,
  }).select().single()
  if (vErr) throw vErr

  const authData = await adminCreateUser(email, tempPassword, { full_name: fullName })
  const { error: pErr } = await supabase.from('profiles').update({ vendor_id: vendor.id, full_name: fullName }).eq('id', authData.user.id)
  if (pErr) throw pErr

  return vendor
}

export async function setVendorActive(id, isActive) {
  const { error } = await supabase.from('referral_vendors').update({ is_active: isActive }).eq('id', id)
  if (error) throw error
}

export async function updateVendorCommission(id, { commissionType, commissionRate }) {
  const { error } = await supabase.from('referral_vendors').update({ commission_type: commissionType, commission_rate: Number(commissionRate) || 0 }).eq('id', id)
  if (error) throw error
}

export async function setPromoterSettings(vendorId, { isPromoter, seatAllocation, discountPercent }) {
  const { error } = await supabase.rpc('super_admin_set_promoter', {
    p_vendor_id: vendorId, p_is_promoter: isPromoter,
    p_seat_allocation: seatAllocation === '' || seatAllocation == null ? null : Number(seatAllocation),
    p_discount_percent: Number(discountPercent) || 0,
  })
  if (error) throw error
}

export async function listVendorCommissions(vendorId) {
  const { data, error } = await supabase.from('vendor_commissions').select('*, org:organizations(name)').eq('vendor_id', vendorId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Real payout batches (STEP139) — replaces the old one-row-at-a-time
// "mark paid" with a single transactional operation: pick some or all
// of a vendor's pending commissions, record HOW they were actually
// paid, and settle all of them against one payout record.
export async function listVendorPayouts(vendorId) {
  const { data, error } = await supabase.from('vendor_payouts').select('*').eq('vendor_id', vendorId).order('paid_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function processPayout(vendorId, commissionIds, { method, reference, notes }) {
  const { data, error } = await supabase.rpc('super_admin_process_payout', {
    p_vendor_id: vendorId, p_commission_ids: commissionIds,
    p_method: method, p_reference: reference || null, p_notes: notes || null,
  })
  if (error) throw error
  return data
}

export async function listPromoterApplications() {
  const { data, error } = await supabase.from('promoter_applications').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function approvePromoterApplication(id, { code, tempPassword, seatAllocation, discountPercent, commissionType, commissionRate }) {
  const { data, error } = await supabase.rpc('super_admin_approve_promoter_application', {
    p_application_id: id, p_code: code, p_temp_password: tempPassword,
    p_seat_allocation: seatAllocation === '' || seatAllocation == null ? null : Number(seatAllocation),
    p_discount_percent: Number(discountPercent) || 0,
    p_commission_type: commissionType || 'percent', p_commission_rate: Number(commissionRate) || 0,
  })
  if (error) throw error
  return data
}

export async function rejectPromoterApplication(id) {
  const { error } = await supabase.rpc('super_admin_reject_promoter_application', { p_application_id: id })
  if (error) throw error
}
