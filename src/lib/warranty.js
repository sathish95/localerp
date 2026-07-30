import { supabase, nextNum } from './supabase'
import * as warrantyApproval from './warrantyApproval'

/**
 * WARRANTY MANAGEMENT — core engine.
 *
 * Mirrors procurementApproval.js's shape (a cost-threshold-branched
 * approval, not submitter-role-indexed) but simplified to match this
 * module's spec: claims below claim_auto_approve_threshold are
 * auto-approved, claims at/above it need a single Finance manual review
 * step (no multi-role chain — the spec only calls for Finance sign-off
 * on high-cost claims).
 *
 * All tables here use soft FK columns (plain UUID, no REFERENCES), so
 * relational queries are done as separate round-trips + client-side joins
 * rather than PostgREST embedding, matching spendAnalyzer.js/capacity.js.
 */

// ── Warranty window math — the client-side stand-in for the spec's
// "computed column"; this codebase never uses DB generated columns or
// triggers for derived values (see actualCost.js, capacity.js). ──
export function computeWarrantyWindow(startDate, durationMonths) {
  const start = new Date(startDate)
  const end = new Date(start)
  end.setMonth(end.getMonth() + (Number(durationMonths) || 12))
  const iso = d => d.toISOString().slice(0, 10)
  return { warrantyStart: iso(start), warrantyEnd: iso(end) }
}

export function isDeviceUnderWarranty(deviceWarrantyRow, asOfDate = new Date()) {
  if (!deviceWarrantyRow?.warranty_end_date) return false
  return new Date(deviceWarrantyRow.warranty_end_date) >= asOfDate
}

// ── Settings (singleton) ──
export async function getWarrantySettings() {
  const { data } = await supabase.from('warranty_settings').select('*').eq('id', 1).maybeSingle()
  return {
    claimAutoApproveThreshold: data?.claim_auto_approve_threshold ?? 25000,
    nearExpiryAlertDays: data?.near_expiry_alert_days ?? 30,
    defaultFreshWarrantyOnReplacement: data?.default_fresh_warranty_on_replacement ?? true,
  }
}

export async function upsertWarrantySettings(patch, profileId) {
  const { error } = await supabase.from('warranty_settings').update({
    ...patch, updated_by: profileId, updated_at: new Date().toISOString(),
  }).eq('id', 1)
  if (error) throw error
}

// ── Policies ──
export async function listWarrantyPolicies({ partNumber, activeOnly } = {}) {
  let q = supabase.from('warranty_policies').select('*').order('policy_name')
  if (partNumber) q = q.eq('part_number', partNumber)
  if (activeOnly) q = q.eq('is_active', true)
  const { data } = await q
  return data || []
}

export async function createWarrantyPolicy(policy, profileId) {
  const { data, error } = await supabase.from('warranty_policies').insert({ ...policy, created_by: profileId }).select().single()
  if (error) throw error
  return data
}

export async function updateWarrantyPolicy(id, patch) {
  const { error } = await supabase.from('warranty_policies').update(patch).eq('id', id)
  if (error) throw error
}

// ── Budgets (the "planned" side) — restrictive RLS, admin/ceo/finance only ──
function scopeKeyFor({ scope_type, part_number, project_id }) {
  return scope_type === 'project' ? `PROJECT:${project_id}` : part_number
}

export async function listWarrantyBudgets() {
  const { data } = await supabase.from('warranty_budgets').select('*').order('period_key', { ascending: false })
  return data || []
}

export async function createWarrantyBudget(budget, profileId) {
  const payload = { ...budget, scope_key: scopeKeyFor(budget), created_by: profileId }
  const { data, error } = await supabase.from('warranty_budgets').insert(payload).select().single()
  if (error) throw error
  return data
}

export async function updateWarrantyBudget(id, patch) {
  const payload = { ...patch }
  if (patch.scope_type) payload.scope_key = scopeKeyFor(patch)
  const { error } = await supabase.from('warranty_budgets').update(payload).eq('id', id)
  if (error) throw error
}

export async function deleteWarrantyBudget(id) {
  const { error } = await supabase.from('warranty_budgets').delete().eq('id', id)
  if (error) throw error
}

// Falls back to products.warranty_months (default 12mo) when no policy row
// exists for a part number, so warranty tracking never blocks on Policies
// being configured first. Exported (not just internal) so the Product/Device
// register can show which policy — and therefore which depreciation
// schedule — applies to a given part number before any claim is ever raised.
export async function getPolicyForPartNumber(partNumber) {
  if (partNumber) {
    const { data: policy } = await supabase.from('warranty_policies').select('*')
      .eq('part_number', partNumber).eq('is_active', true).maybeSingle()
    if (policy) return policy
  }
  const fallback = { id: null, warranty_duration_months: 12, fresh_warranty_on_replacement: true }
  if (partNumber) {
    const { data: product } = await supabase.from('products').select('warranty_months').eq('part_number', partNumber).maybeSingle()
    if (product?.warranty_months) fallback.warranty_duration_months = product.warranty_months
  }
  return fallback
}

// ── Age-based claim depreciation ──
// A device's claim value is not always its full standard cost — the older
// the unit is when it fails, the less of its warranty life is left, so the
// payable claim % shrinks per a configurable tiered schedule attached to
// the policy (e.g. 0-3mo -> 100%, 3-6mo -> 75%, 6-9mo -> 50%, 9-12mo -> 25%).
export function computeDeviceAgeMonths(startDate, asOfDate = new Date()) {
  if (!startDate) return 0
  const start = new Date(startDate)
  const asOf = new Date(asOfDate)
  const months = (asOf.getFullYear() - start.getFullYear()) * 12 + (asOf.getMonth() - start.getMonth()) + (asOf.getDate() - start.getDate()) / 30.44
  return Math.max(0, Math.round(months * 100) / 100)
}

export async function listDepreciationTiers(policyId) {
  if (!policyId) return []
  const { data } = await supabase.from('warranty_depreciation_tiers').select('*').eq('warranty_policy_id', policyId).order('min_age_months')
  return data || []
}

// Bulk load for list views (e.g. the Policies table showing a tier count per
// row, or DevicesPage.jsx pricing every device's claim value at once) —
// avoids an N+1 query per policy.
export async function listAllDepreciationTiers() {
  const { data } = await supabase.from('warranty_depreciation_tiers').select('*').order('min_age_months')
  return data || []
}

// Replace-all — simplest way to keep a policy's tier list consistent
// (delete then insert wholesale), matching spendAnalyzer.js's
// replaceFindings() idiom rather than diffing individual rows.
export async function saveDepreciationTiers(policyId, tiers) {
  await supabase.from('warranty_depreciation_tiers').delete().eq('warranty_policy_id', policyId)
  const rows = (tiers || []).filter(t => t.claim_percentage !== '' && t.claim_percentage != null).map(t => ({
    warranty_policy_id: policyId, min_age_months: Number(t.min_age_months) || 0,
    max_age_months: t.max_age_months === '' || t.max_age_months == null ? null : Number(t.max_age_months),
    claim_percentage: Number(t.claim_percentage),
  }))
  if (rows.length) {
    const { error } = await supabase.from('warranty_depreciation_tiers').insert(rows)
    if (error) throw error
  }
}

// No policy or no tiers configured -> 100% (the original flat-standard-cost
// behaviour), so existing policies keep working unchanged until someone
// opts into a depreciation schedule.
export async function getClaimPercentageForAge(policyId, ageMonths) {
  if (!policyId) return 100
  const tiers = await listDepreciationTiers(policyId)
  if (!tiers.length) return 100
  const match = tiers.find(t => ageMonths >= Number(t.min_age_months) && (t.max_age_months == null || ageMonths < Number(t.max_age_months)))
  if (match) return Number(match.claim_percentage)
  // Older than every configured tier's upper bound — fully depreciated.
  return 0
}

// Combines age + tier lookup into the claim value a Replace should default
// to: the unit's standard cost, discounted by how much of its warranty
// life has already elapsed.
export async function computeAgeBasedClaimValue({ standardCost, policyId, deploymentDate, asOfDate = new Date() }) {
  const ageMonths = computeDeviceAgeMonths(deploymentDate, asOfDate)
  const claimPercentage = await getClaimPercentageForAge(policyId, ageMonths)
  const claimValue = Math.round(Number(standardCost || 0) * (claimPercentage / 100) * 100) / 100
  return { ageMonths, claimPercentage, claimValue }
}

// ── Device warranty lifecycle ──
// Workflow A: called whenever a device gets an installation/deployment date
// — either at registration time (DevicesPage.jsx's Create form, when
// installed_date is set) or when a device's status flips to 'deployed' (the
// Move/Redeploy flow) — so warranty tracking is never forgotten. Also used
// for replacement units, where remainingDaysOverride carries the original
// device's leftover time when its policy has fresh_warranty_on_replacement=false.
// `policyId`, when given, overrides the automatic part_number-based policy
// resolution — lets the UI's Policy dropdown pick a specific policy (e.g.
// when more than one applies to a part number) instead of always taking
// whichever one getPolicyForPartNumber() would auto-select.
export async function createDeviceWarranty({ deviceId, deploymentDate, projectId, replacedFromWarrantyId = null, remainingDaysOverride = null, policyId = null, profileId }) {
  const { data: device } = await supabase.from('device_instances').select('id,part_number').eq('id', deviceId).maybeSingle()
  let policy
  if (policyId) {
    const { data } = await supabase.from('warranty_policies').select('*').eq('id', policyId).maybeSingle()
    policy = data || await getPolicyForPartNumber(device?.part_number)
  } else {
    policy = await getPolicyForPartNumber(device?.part_number)
  }
  const depDate = deploymentDate || new Date().toISOString().slice(0, 10)

  let warrantyEnd
  if (remainingDaysOverride != null) {
    const end = new Date(depDate)
    end.setDate(end.getDate() + remainingDaysOverride)
    warrantyEnd = end.toISOString().slice(0, 10)
  } else {
    warrantyEnd = computeWarrantyWindow(depDate, policy.warranty_duration_months).warrantyEnd
  }

  const { data: row, error } = await supabase.from('device_warranties').insert({
    device_id: deviceId, warranty_policy_id: policy.id || null, deployment_date: depDate,
    warranty_start_date: depDate, warranty_end_date: warrantyEnd, project_id: projectId || null,
    status: 'Active', replaced_from_warranty_id: replacedFromWarrantyId, created_by: profileId,
  }).select().single()
  if (error) throw error

  // Keep device_instances.warranty_start/warranty_end in sync — DevicesPage.jsx's
  // existing near-expiry badge reads these columns directly and is not modified.
  await supabase.from('device_instances').update({
    warranty_start: depDate, warranty_end: warrantyEnd, current_device_warranty_id: row.id,
  }).eq('id', deviceId)

  return row
}

export async function getDeviceWarrantyById(id) {
  if (!id) return null
  const { data } = await supabase.from('device_warranties').select('*').eq('id', id).maybeSingle()
  return data
}

export async function getActiveWarrantyForDevice(deviceId) {
  const { data } = await supabase.from('device_warranties').select('*')
    .eq('device_id', deviceId).eq('status', 'Active').order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data
}

// device_instances.part_number -> products.part_number is a soft ref (no
// REFERENCES constraint, by STEP25's own design), so PostgREST embedding
// (`product:products(...)`) can never resolve it — fetch products
// separately and join client-side, matching spendAnalyzer.js/capacity.js.
export async function searchDeviceBySerial(fragment) {
  if (!fragment) return []
  const { data: devices } = await supabase.from('device_instances')
    .select('id,device_code,serial_number,part_number,status,warranty_end,project_id,customer_id')
    .ilike('serial_number', `%${fragment}%`).limit(20)
  if (!devices?.length) return []
  const partNumbers = [...new Set(devices.map(d => d.part_number).filter(Boolean))]
  const { data: products } = partNumbers.length
    ? await supabase.from('products').select('part_number,name,standard_cost').in('part_number', partNumbers)
    : { data: [] }
  const productByPart = Object.fromEntries((products || []).map(p => [p.part_number, p]))
  return devices.map(d => ({ ...d, product: productByPart[d.part_number] || null }))
}

// Per-device trace: this device's own warranty/claim history, plus (if a
// claim resolved as Replace) the forward chain into the replacement
// device's own record — a support agent can trace the full life+cost story.
export async function getWarrantyTrace(deviceId) {
  const chain = []
  let currentDeviceId = deviceId
  const visited = new Set()
  while (currentDeviceId && !visited.has(currentDeviceId)) {
    visited.add(currentDeviceId)
    const [{ data: device }, { data: warranties }, { data: claims }] = await Promise.all([
      supabase.from('device_instances').select('*').eq('id', currentDeviceId).maybeSingle(),
      supabase.from('device_warranties').select('*').eq('device_id', currentDeviceId).order('created_at', { ascending: true }),
      supabase.from('warranty_claims').select('*').eq('device_id', currentDeviceId).order('claim_date', { ascending: true }),
    ])
    // Soft ref — no embedding, fetch the product separately (see
    // searchDeviceBySerial's comment for why).
    if (device?.part_number) {
      const { data: product } = await supabase.from('products').select('name,part_number').eq('part_number', device.part_number).maybeSingle()
      device.product = product || null
    }
    const claimIds = (claims || []).map(c => c.id)
    let costEntries = []
    if (claimIds.length) {
      // warranty_cost_entries is RLS-restricted to admin/ceo/finance — other
      // roles simply get an empty array back here, not an error.
      const { data } = await supabase.from('warranty_cost_entries').select('*').in('warranty_claim_id', claimIds)
      costEntries = data || []
    }
    chain.push({
      device, warranties: warranties || [],
      claims: (claims || []).map(c => ({ ...c, costEntries: costEntries.filter(e => e.warranty_claim_id === c.id) })),
    })
    const replaceClaim = (claims || []).find(c => c.resolution_type === 'Replace' && c.replacement_device_id)
    currentDeviceId = replaceClaim?.replacement_device_id || null
  }
  return chain
}

// ── Claim intake & approval ──
export function resolveClaimChainType(estimatedCost, autoApproveThreshold) {
  return (Number(estimatedCost) || 0) >= Number(autoApproveThreshold) ? 'full' : 'short'
}

export function claimStatusLabel(status) { return warrantyApproval.statusLabel(status) }

// Workflow B: auto-checks warranty_end_date, blocks/flags out-of-warranty
// devices — still logged as 'Rejected-Out of Warranty' for record-keeping,
// never silently dropped.
//
// Claims below the auto-approve threshold ('short' chain) skip straight to
// 'Approved'. Claims at/above it ('full' chain) enter the fixed approval
// chain — Field Technician submits -> PM -> CEO -> Finance — starting at
// warrantyApproval.firstReviewStatus() ('PM Review').
export async function createWarrantyClaim({ deviceId, issueDescription, issueType, estimatedCost = 0, raisedBy }) {
  const activeWarranty = await getActiveWarrantyForDevice(deviceId)
  const settings = await getWarrantySettings()
  const claimNumber = await nextNum('warranty')
  const todayISO = new Date().toISOString().slice(0, 10)
  const underWarranty = activeWarranty && isDeviceUnderWarranty(activeWarranty)

  if (!underWarranty) {
    const { data, error } = await supabase.from('warranty_claims').insert({
      claim_number: claimNumber, device_warranty_id: activeWarranty?.id || null, device_id: deviceId,
      claim_date: todayISO, issue_description: issueDescription, issue_type: issueType,
      resolution_type: 'Rejected-Out of Warranty', status: 'Rejected', raised_by: raisedBy,
      resolved_date: todayISO, estimated_cost: 0,
    }).select().single()
    if (error) throw error
    return data
  }

  const chainType = resolveClaimChainType(estimatedCost, settings.claimAutoApproveThreshold)
  const status = chainType === 'short' ? 'Approved' : await warrantyApproval.firstReviewStatus()
  const { data, error } = await supabase.from('warranty_claims').insert({
    claim_number: claimNumber, device_warranty_id: activeWarranty.id, device_id: deviceId,
    claim_date: todayISO, issue_description: issueDescription, issue_type: issueType,
    status, raised_by: raisedBy, estimated_cost: estimatedCost, chain_type: chainType,
  }).select().single()
  if (error) throw error
  return data
}

// Sync, cache-only — safe for render-time use (table rows, buttons). Reflects
// the DB-configured chain once warrantyApproval.getChain() has warmed the
// cache (this module's own calls above, e.g. createWarrantyClaim, do that).
export function canActOnClaim(role, claim) {
  if (!claim) return false
  return warrantyApproval.canActOnSync(role, claim.status)
}

export async function approveClaimStep(claimId, role, profileId, { approve, rejectionReason } = {}) {
  const { data: claim, error: fetchErr } = await supabase.from('warranty_claims').select('status').eq('id', claimId).single()
  if (fetchErr) throw fetchErr
  if (!approve) {
    const update = await warrantyApproval.buildApprovalUpdate('reject', claim.status, profileId, rejectionReason)
    const { error } = await supabase.from('warranty_claims').update(update).eq('id', claimId)
    if (error) throw error
    return
  }
  if (!(await warrantyApproval.canActOn(role, claim.status))) throw new Error(`${role} cannot approve a claim at status "${claim.status}"`)
  const update = await warrantyApproval.buildApprovalUpdate('approve', claim.status, profileId)
  const { error } = await supabase.from('warranty_claims').update(update).eq('id', claimId)
  if (error) throw error
}

// ── Resolution & cost logging (Workflow C) ──

// Replace: assigns an in_storage replacement unit (reusing DevicesPage.jsx's
// exact deployment_history-insert + device_instances-update deploy pattern),
// deducts it from storage, starts a NEW device_warranties row for it
// (fresh vs. inherited-remaining-time per the original policy's
// fresh_warranty_on_replacement), and books a Hardware cost entry defaulted
// from the replacement product's standard_cost, frozen at time of replacement.
// `amountOverride`, when given, is what actually gets booked as the cost
// entry's amount (the user-edited figure from the Resolve modal's preview);
// omitted, the freshly computed age-based claimValue is used as-is. Either
// way the system-calculated reference (age/%/standard cost) is preserved
// in cost_breakdown for audit.
export async function resolveClaimReplace({ claimId, replacementDeviceId, movedBy, reason, amountOverride = null }) {
  const { data: claim, error: claimErr } = await supabase.from('warranty_claims').select('*').eq('id', claimId).single()
  if (claimErr) throw claimErr

  const [{ data: original }, { data: replacement }, { data: deviceWarranty }] = await Promise.all([
    supabase.from('device_instances').select('*').eq('id', claim.device_id).maybeSingle(),
    supabase.from('device_instances').select('*').eq('id', replacementDeviceId).maybeSingle(),
    claim.device_warranty_id ? supabase.from('device_warranties').select('*').eq('id', claim.device_warranty_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  if (!replacement) throw new Error('Replacement device not found')
  if (replacement.status !== 'in_storage') throw new Error('Replacement device must be in storage')
  // Soft ref — no embedding, fetch the product separately.
  if (replacement.part_number) {
    const { data: product } = await supabase.from('products').select('part_number,standard_cost').eq('part_number', replacement.part_number).maybeSingle()
    replacement.product = product || null
  }

  await supabase.from('deployment_history').insert({
    device_id: replacementDeviceId, from_project_id: replacement.project_id || null, to_project_id: original?.project_id || null,
    from_customer_id: replacement.customer_id || null, to_customer_id: original?.customer_id || null,
    from_status: replacement.status, to_status: 'deployed', moved_by: movedBy,
    reason: reason || `Warranty replacement for claim ${claim.claim_number}`,
  })
  await supabase.from('device_instances').update({
    project_id: original?.project_id || null, customer_id: original?.customer_id || null, status: 'deployed',
  }).eq('id', replacementDeviceId)
  await supabase.from('device_instances').update({ status: 'replaced' }).eq('id', claim.device_id)

  const policy = deviceWarranty?.warranty_policy_id
    ? (await supabase.from('warranty_policies').select('*').eq('id', deviceWarranty.warranty_policy_id).maybeSingle()).data
    : null
  const freshWarranty = policy ? policy.fresh_warranty_on_replacement : true
  let remainingDaysOverride = null
  if (!freshWarranty && deviceWarranty?.warranty_end_date) {
    remainingDaysOverride = Math.max(0, Math.round((new Date(deviceWarranty.warranty_end_date) - new Date()) / 86400000))
  }

  const newWarranty = await createDeviceWarranty({
    deviceId: replacementDeviceId, deploymentDate: new Date().toISOString().slice(0, 10), projectId: original?.project_id,
    replacedFromWarrantyId: claim.device_warranty_id, remainingDaysOverride, profileId: movedBy,
  })

  const standardCost = Number(replacement.product?.standard_cost || 0)
  const { ageMonths, claimPercentage, claimValue } = await computeAgeBasedClaimValue({
    standardCost, policyId: policy?.id || null, deploymentDate: deviceWarranty?.deployment_date,
  })
  const bookedAmount = amountOverride != null ? Number(amountOverride) : claimValue
  const editedNote = amountOverride != null && Math.round(amountOverride * 100) !== Math.round(claimValue * 100)
    ? ` (edited from system-calculated ${claimValue})` : ''
  await supabase.from('warranty_cost_entries').insert({
    warranty_claim_id: claimId, cost_type: 'Hardware', amount: bookedAmount, currency: 'INR',
    cost_breakdown: `Replacement unit cost (${replacement.part_number || replacement.product?.part_number || ''}) — device age ${ageMonths}mo, claim ${claimPercentage}% of ${standardCost}${editedNote}`,
    source_standard_cost_snapshot: standardCost, created_by: movedBy,
  })

  const { error } = await supabase.from('warranty_claims').update({
    resolution_type: 'Replace', replacement_device_id: replacementDeviceId, status: 'Resolved',
    resolved_date: new Date().toISOString().slice(0, 10),
  }).eq('id', claimId)
  if (error) throw error

  return newWarranty
}

// Repair: logs technician time/parts cost as Hardware — the device's
// warranty clock continues UNCHANGED (original end date, never reset).
export async function resolveClaimRepair({ claimId, amount, currency = 'INR', costBreakdown, profileId }) {
  const { error: costErr } = await supabase.from('warranty_cost_entries').insert({
    warranty_claim_id: claimId, cost_type: 'Hardware', amount: Number(amount) || 0, currency, cost_breakdown: costBreakdown, created_by: profileId,
  })
  if (costErr) throw costErr
  const { error } = await supabase.from('warranty_claims').update({
    resolution_type: 'Repair', status: 'Resolved', resolved_date: new Date().toISOString().slice(0, 10),
  }).eq('id', claimId)
  if (error) throw error
}

// Remote Fix: software/firmware issue resolved without a truck roll — logged
// as Software cost even if the direct figure is just support-engineer time
// (may be 0 or a nominal estimate; aggregated hours are still a real cost).
export async function resolveClaimRemoteFix({ claimId, amount = 0, currency = 'INR', costBreakdown, profileId }) {
  const { error: costErr } = await supabase.from('warranty_cost_entries').insert({
    warranty_claim_id: claimId, cost_type: 'Software', amount: Number(amount) || 0, currency, cost_breakdown: costBreakdown, created_by: profileId,
  })
  if (costErr) throw costErr
  const { error } = await supabase.from('warranty_claims').update({
    resolution_type: 'Remote Fix-No Cost', status: 'Resolved', resolved_date: new Date().toISOString().slice(0, 10),
  }).eq('id', claimId)
  if (error) throw error
}

// Rejected: no cost entry, claim record retained for pattern analysis
// (e.g. customers repeatedly claiming just past expiry).
export async function rejectClaim({ claimId, rejectionReason }) {
  const { error } = await supabase.from('warranty_claims').update({
    resolution_type: 'Rejected-Out of Warranty', status: 'Rejected', rejection_reason: rejectionReason || null,
    resolved_date: new Date().toISOString().slice(0, 10),
  }).eq('id', claimId)
  if (error) throw error
}

export async function listClaims({ status, deviceId } = {}) {
  let q = supabase.from('warranty_claims').select('*').order('claim_date', { ascending: false })
  if (status) q = q.eq('status', status)
  if (deviceId) q = q.eq('device_id', deviceId)
  const { data } = await q
  return data || []
}
