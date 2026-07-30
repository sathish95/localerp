import { supabase, nextNum } from './supabase'
import { getRateForDesignation } from './roleRates'
import { getInventoryList } from './inventory'

// Categories that feed a resource plan (App/Firmware/Hardware-Design) vs a
// direct line-item category — mirrors the 7 fixed categories from
// proposal_cost_sections' CHECK constraint.
export const PROPOSAL_CATEGORIES = [
  'Application Development', 'Firmware Development', 'Hardware Design & Production',
  'ERP Integration', 'Hardware', 'Software/SaaS/Third-Party', 'Miscellaneous',
]
// Categories priced by labor (headcount × weeks × role_rates snapshot).
export const RESOURCE_PLAN_CATEGORIES = ['Application Development', 'Firmware Development', 'Hardware Design & Production', 'ERP Integration']
// Categories that, on top of (or instead of) a resource plan, also carry
// direct cost lines — Hardware Design & Production's installation/assembly
// costs and ERP Integration's "which system" line sit outside the raw
// device cost (that's Hardware's job) or outside labor, so they need a
// place to live alongside the resource plan in the same category.
export const MISC_CAPABLE_CATEGORIES = ['Hardware Design & Production', 'ERP Integration', 'Miscellaneous']
// Curated list for the ERP Integration category's "which system" line —
// free text is still allowed (no CHECK constraint on item_name), this is
// just the fetch-friendly common set.
export const ERP_SYSTEM_OPTIONS = ['SAP', 'Oracle NetSuite', 'Microsoft Dynamics 365', 'Zoho One', 'Odoo', 'Custom / In-house', 'Other']
export const MISC_LINE_TYPES = ['Travel', 'Field Visit', 'Other']

// Standard work-week used to turn a resource plan's headcount × duration
// into an hours figure — matches this app's existing default weekly
// capacity convention (see ExcelImport.jsx employees template).
export const HOURS_PER_WEEK = 40

/* ═══ Prefetch helpers — every add-line form pulls from real master data
 * instead of free text, so a proposal line always ties back to something
 * that actually exists (a real designation, a real product, a name
 * someone's already used before). ═══════════════════════════════ */

// Every designation with a rate on file, plus that rate — drives the
// Resource Plan designation picker's "rate card" preview. Only rows
// effective today are returned, matching the exact snapshot logic
// getRateForDesignation() applies when a plan is actually saved, so the
// preview never shows a number the save wouldn't also produce.
export async function listDesignationOptions() {
  const iso = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase.from('role_rates').select('designation, hourly_rate')
    .lte('effective_from', iso).or(`effective_to.is.null,effective_to.gte.${iso}`)
    .order('designation')
  if (error) throw error
  const byDesignation = new Map()
  ;(data || []).forEach(r => byDesignation.set(r.designation, Number(r.hourly_rate) || 0))
  return [...byDesignation.entries()].map(([designation, hourly_rate]) => ({ designation, hourly_rate }))
}

// Full product catalog with live on-hand/device counts — reuses
// getInventoryList() from lib/inventory.js (the exact same call the
// Inventory page and Spend Analyzer use) rather than re-deriving stock
// figures here, so "Prefetch the Product + device count" can never drift
// from what Inventory shows.
export async function listProductOptions() {
  return getInventoryList()
}

// Distinct item names already used on ANY proposal's software lines, each
// carrying the most recently used cost/type — autocomplete for the
// Software/SaaS/Third-Party form so a recurring tool (e.g. "AWS EC2",
// "Twilio") doesn't get re-typed slightly differently every time, and
// shows a "last known rate" preview instead of a bare name list.
export async function listSoftwareItemSuggestions() {
  const { data, error } = await supabase.from('proposal_software_lines')
    .select('item_name, cost_type, unit_cost, created_at').order('created_at', { ascending: false })
  if (error) throw error
  const byName = new Map()
  ;(data || []).forEach(r => { if (r.item_name && !byName.has(r.item_name)) byName.set(r.item_name, { item_name: r.item_name, cost_type: r.cost_type, unit_cost: Number(r.unit_cost) || 0 }) })
  return [...byName.values()].sort((a, b) => a.item_name.localeCompare(b.item_name))
}

/* ═══ Proposal header ═══════════════════════════════════════ */

export async function listProposals() {
  const { data, error } = await supabase.from('proposals')
    .select('*, creator:profiles!created_by(full_name)')
    .eq('is_current', true)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getProposal(id) {
  const { data, error } = await supabase.from('proposals')
    .select('*, creator:profiles!created_by(full_name), sales_lead_approver:profiles!sales_lead_approved_by(full_name), finance_approver:profiles!finance_approved_by(full_name), cto_approver:profiles!cto_approved_by(full_name)')
    .eq('id', id).single()
  if (error) throw error
  return data
}

// Every version ever saved for this proposal's group, newest first.
export async function getProposalVersions(proposalGroupId) {
  const { data, error } = await supabase.from('proposals')
    .select('id, version, is_current, status, revision_notes, created_at, creator:profiles!created_by(full_name)')
    .eq('proposal_group_id', proposalGroupId)
    .order('version', { ascending: false })
  if (error) throw error
  return data || []
}

// Creates the proposal header plus one empty proposal_cost_sections row per
// category — every proposal always has all 7 sections available to fill in,
// nothing to separately "add" first.
export async function createProposal({ proposal_name, customer_name, customer_contact, validity_until_date, overall_margin_percent, currency }, userId) {
  const proposal_number = await nextNum('proposal')
  const { data: proposal, error } = await supabase.from('proposals').insert({
    proposal_group_id: crypto.randomUUID(), proposal_number, proposal_name, customer_name,
    customer_contact: customer_contact || null, validity_until_date: validity_until_date || null,
    overall_margin_percent: overall_margin_percent ?? 20, currency: currency || 'INR', created_by: userId,
  }).select().single()
  if (error) throw error

  // proposal_group_id must equal id for a first version — fix it up now that
  // the row (and its real id) exists.
  await supabase.from('proposals').update({ proposal_group_id: proposal.id }).eq('id', proposal.id)

  const sections = PROPOSAL_CATEGORIES.map(category => ({ proposal_id: proposal.id, category }))
  const { error: secErr } = await supabase.from('proposal_cost_sections').insert(sections)
  if (secErr) throw secErr

  return { ...proposal, proposal_group_id: proposal.id }
}

export async function updateProposal(id, patch) {
  const { error } = await supabase.from('proposals').update(patch).eq('id', id)
  if (error) throw error
}

// Clone-forward revision — see save_proposal_version() in STEP62. Only
// meaningful once a proposal has left Draft (a Draft can just be edited
// directly); the caller decides when to offer this.
export async function createRevision(proposalId, userId, notes) {
  const { data, error } = await supabase.rpc('save_proposal_version', {
    p_proposal_id: proposalId, p_user_id: userId, p_notes: notes || null,
  })
  if (error) throw error
  return data
}

/* ═══ Cost sections + their lines ═══════════════════════════ */

export async function getCostSections(proposalId) {
  const { data: sections, error } = await supabase.from('proposal_cost_sections')
    .select('*').eq('proposal_id', proposalId).order('category')
  if (error) throw error
  if (!sections?.length) return []

  const ids = sections.map(s => s.id)
  const [{ data: resourcePlans }, { data: hardwareLines }, { data: softwareLines }, { data: miscLines }] = await Promise.all([
    supabase.from('proposal_resource_plans').select('*').in('proposal_cost_section_id', ids),
    supabase.from('proposal_hardware_lines').select('*').in('proposal_cost_section_id', ids),
    supabase.from('proposal_software_lines').select('*').in('proposal_cost_section_id', ids),
    supabase.from('proposal_misc_lines').select('*').in('proposal_cost_section_id', ids),
  ])

  return sections.map(s => ({
    ...s,
    resourcePlans: (resourcePlans || []).filter(r => r.proposal_cost_section_id === s.id),
    hardwareLines: (hardwareLines || []).filter(r => r.proposal_cost_section_id === s.id),
    softwareLines: (softwareLines || []).filter(r => r.proposal_cost_section_id === s.id),
    miscLines: (miscLines || []).filter(r => r.proposal_cost_section_id === s.id),
  }))
}

export async function updateCostSection(id, { margin_percent, notes }) {
  const { error } = await supabase.from('proposal_cost_sections').update({ margin_percent, notes }).eq('id', id)
  if (error) throw error
}

/* ── Resource plan lines (App/Firmware/Hardware-Design) ── */

export async function addResourcePlan({ proposalCostSectionId, designation, estimatedCount, estimatedDurationWeeks, notes }) {
  const rate = await getRateForDesignation(designation, new Date())
  const rateUsed = Number(rate?.hourly_rate) || 0
  const computedCost = Number(estimatedCount) * Number(estimatedDurationWeeks) * HOURS_PER_WEEK * rateUsed
  const { error } = await supabase.from('proposal_resource_plans').insert({
    proposal_cost_section_id: proposalCostSectionId, designation,
    estimated_count: estimatedCount, estimated_duration_weeks: estimatedDurationWeeks,
    rate_used: rateUsed, computed_cost: computedCost, notes: notes || null,
  })
  if (error) throw error
}

export async function updateResourcePlan(id, { designation, estimatedCount, estimatedDurationWeeks, notes, refreshRate }) {
  let rateUsed
  if (refreshRate) {
    const rate = await getRateForDesignation(designation, new Date())
    rateUsed = Number(rate?.hourly_rate) || 0
  } else {
    const { data } = await supabase.from('proposal_resource_plans').select('rate_used').eq('id', id).single()
    rateUsed = Number(data?.rate_used) || 0
  }
  const computedCost = Number(estimatedCount) * Number(estimatedDurationWeeks) * HOURS_PER_WEEK * rateUsed
  const { error } = await supabase.from('proposal_resource_plans').update({
    designation, estimated_count: estimatedCount, estimated_duration_weeks: estimatedDurationWeeks,
    rate_used: rateUsed, computed_cost: computedCost, notes: notes || null,
  }).eq('id', id)
  if (error) throw error
}

// Deleting a resource plan also strips it from any timeline phase that
// linked to it — "Project Resource + Timeline needs to always sync": a
// phase's linked_resource_plan_ids should never point at a plan that no
// longer exists, silently under-costing that phase forever.
export async function deleteResourcePlan(id) {
  const { data: section } = await supabase.from('proposal_resource_plans').select('proposal_cost_section_id').eq('id', id).single()
  const { error } = await supabase.from('proposal_resource_plans').delete().eq('id', id)
  if (error) throw error
  if (section) {
    const { data: costSection } = await supabase.from('proposal_cost_sections').select('proposal_id').eq('id', section.proposal_cost_section_id).single()
    if (costSection) await stripResourcePlanFromTimeline(costSection.proposal_id, id)
  }
}

async function stripResourcePlanFromTimeline(proposalId, resourcePlanId) {
  const { data: phases } = await supabase.from('proposal_timeline').select('id, linked_resource_plan_ids').eq('proposal_id', proposalId)
  for (const phase of phases || []) {
    if (!(phase.linked_resource_plan_ids || []).includes(resourcePlanId)) continue
    await supabase.from('proposal_timeline').update({
      linked_resource_plan_ids: phase.linked_resource_plan_ids.filter(id => id !== resourcePlanId),
    }).eq('id', phase.id)
  }
}

/* ── Hardware lines ── */

// manualUnitCost is only ever used when partNumber doesn't resolve to a real
// catalog product — a known product's price always wins, so a line tied to
// the catalog can never drift from it. Without this fallback a hardware
// line for something outside the catalog (a one-off, non-stocked purchase)
// had no way to carry a real price at all and silently priced at ₹0 forever.
export async function addHardwareLine({ proposalCostSectionId, partNumber, description, estimatedQuantity, manualUnitCost, notes }) {
  let unitCost = Number(manualUnitCost) || 0
  if (partNumber) {
    const { data: product } = await supabase.from('products').select('standard_cost').eq('part_number', partNumber).maybeSingle()
    if (product) unitCost = Number(product.standard_cost) || 0
  }
  const subtotal = Number(estimatedQuantity) * unitCost
  const { error } = await supabase.from('proposal_hardware_lines').insert({
    proposal_cost_section_id: proposalCostSectionId, part_number: partNumber || null, description,
    estimated_quantity: estimatedQuantity, unit_cost: unitCost, subtotal_internal_cost: subtotal, notes: notes || null,
  })
  if (error) throw error
}

export async function updateHardwareLine(id, { partNumber, description, estimatedQuantity, manualUnitCost, notes, refreshCost }) {
  let unitCost
  if (refreshCost) {
    unitCost = Number(manualUnitCost) || 0
    if (partNumber) {
      const { data: product } = await supabase.from('products').select('standard_cost').eq('part_number', partNumber).maybeSingle()
      if (product) unitCost = Number(product.standard_cost) || 0
    }
  } else {
    const { data } = await supabase.from('proposal_hardware_lines').select('unit_cost').eq('id', id).single()
    unitCost = Number(data?.unit_cost) || 0
  }
  const subtotal = Number(estimatedQuantity) * unitCost
  const { error } = await supabase.from('proposal_hardware_lines').update({
    part_number: partNumber || null, description, estimated_quantity: estimatedQuantity,
    unit_cost: unitCost, subtotal_internal_cost: subtotal, notes: notes || null,
  }).eq('id', id)
  if (error) throw error
}

export async function deleteHardwareLine(id) {
  const { error } = await supabase.from('proposal_hardware_lines').delete().eq('id', id)
  if (error) throw error
}

/* ── Software/SaaS/Third-Party lines ── */

function computeSoftwareLineCost(costType, unitCost, durationMonths) {
  const u = Number(unitCost) || 0
  const m = Number(durationMonths) || 1
  if (costType === 'Monthly') return u * m
  if (costType === 'Annual') return u * Math.ceil(m / 12)
  return u // One-time
}

export async function addSoftwareLine({ proposalCostSectionId, itemName, costType, unitCost, durationMonths, notes }) {
  const computedCost = computeSoftwareLineCost(costType, unitCost, durationMonths)
  const { error } = await supabase.from('proposal_software_lines').insert({
    proposal_cost_section_id: proposalCostSectionId, item_name: itemName, cost_type: costType || 'One-time',
    unit_cost: unitCost, duration_months: durationMonths || 1, computed_cost: computedCost, notes: notes || null,
  })
  if (error) throw error
}

export async function updateSoftwareLine(id, { itemName, costType, unitCost, durationMonths, notes }) {
  const computedCost = computeSoftwareLineCost(costType, unitCost, durationMonths)
  const { error } = await supabase.from('proposal_software_lines').update({
    item_name: itemName, cost_type: costType, unit_cost: unitCost, duration_months: durationMonths,
    computed_cost: computedCost, notes: notes || null,
  }).eq('id', id)
  if (error) throw error
}

export async function deleteSoftwareLine(id) {
  const { error } = await supabase.from('proposal_software_lines').delete().eq('id', id)
  if (error) throw error
}

/* ── Miscellaneous lines ── */

export async function addMiscLine({ proposalCostSectionId, itemName, cost, notes, lineType, linkedResourcePlanId }) {
  const { error } = await supabase.from('proposal_misc_lines').insert({
    proposal_cost_section_id: proposalCostSectionId, item_name: itemName, cost, notes: notes || null,
    line_type: lineType || 'Other', linked_resource_plan_id: linkedResourcePlanId || null,
  })
  if (error) throw error
}

export async function updateMiscLine(id, { itemName, cost, notes, lineType, linkedResourcePlanId }) {
  const { error } = await supabase.from('proposal_misc_lines').update({
    item_name: itemName, cost, notes: notes || null, line_type: lineType || 'Other', linked_resource_plan_id: linkedResourcePlanId || null,
  }).eq('id', id)
  if (error) throw error
}

export async function deleteMiscLine(id) {
  const { error } = await supabase.from('proposal_misc_lines').delete().eq('id', id)
  if (error) throw error
}

/* ═══ Vendor cost traceability ═══════════════════════════════ */

export async function listVendorCosts(proposalId) {
  const { data, error } = await supabase.from('proposal_vendor_costs')
    .select('*, vendor:vendors(id,name)').eq('proposal_id', proposalId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function addVendorCost({ proposalId, vendorId, linkedCategory, vendorQuoteAmount, quoteReference, linkedLineItemId, linkedLineItemType }) {
  const { error } = await supabase.from('proposal_vendor_costs').insert({
    proposal_id: proposalId, vendor_id: vendorId || null, linked_category: linkedCategory || null,
    vendor_quote_amount: vendorQuoteAmount, quote_reference: quoteReference || null,
    linked_line_item_id: linkedLineItemId || null, linked_line_item_type: linkedLineItemType || null,
  })
  if (error) throw error
}

export async function deleteVendorCost(id) {
  const { error } = await supabase.from('proposal_vendor_costs').delete().eq('id', id)
  if (error) throw error
}

/* ═══ Timeline ═══════════════════════════════════════════════ */

export async function listTimeline(proposalId) {
  const { data, error } = await supabase.from('proposal_timeline').select('*').eq('proposal_id', proposalId).order('sort_order').order('start_offset_weeks')
  if (error) throw error
  return data || []
}

export async function addTimelinePhase({ proposalId, phaseName, startOffsetWeeks, durationWeeks, linkedResourcePlanIds, sortOrder }) {
  const { error } = await supabase.from('proposal_timeline').insert({
    proposal_id: proposalId, phase_name: phaseName, start_offset_weeks: startOffsetWeeks || 0,
    duration_weeks: durationWeeks || 1, linked_resource_plan_ids: linkedResourcePlanIds || [], sort_order: sortOrder || 0,
  })
  if (error) throw error
}

export async function updateTimelinePhase(id, patch) {
  const { error } = await supabase.from('proposal_timeline').update({
    phase_name: patch.phaseName, start_offset_weeks: patch.startOffsetWeeks, duration_weeks: patch.durationWeeks,
    linked_resource_plan_ids: patch.linkedResourcePlanIds, sort_order: patch.sortOrder,
  }).eq('id', id)
  if (error) throw error
}

export async function deleteTimelinePhase(id) {
  const { error } = await supabase.from('proposal_timeline').delete().eq('id', id)
  if (error) throw error
}

/* ═══ Value summary — the one computed source of truth ═══════
 *
 * Section Internal Cost = sum(resource.computed_cost) + sum(hardware.subtotal_internal_cost)
 *                        + sum(software.computed_cost) + sum(misc.cost)
 * Section Customer Price = Section Internal Cost × (1 + margin% / 100)
 * (margin% = section.margin_percent, falling back to proposal.overall_margin_percent)
 *
 * Rounds ONLY at this final summary level — never per line item — so
 * category totals always sum exactly to the grand total shown elsewhere.
 */

const round2 = n => Math.round((Number(n) || 0) * 100) / 100

function sectionInternalCost(section) {
  const r = (section.resourcePlans || []).reduce((s, x) => s + (Number(x.computed_cost) || 0), 0)
  const h = (section.hardwareLines || []).reduce((s, x) => s + (Number(x.subtotal_internal_cost) || 0), 0)
  const sw = (section.softwareLines || []).reduce((s, x) => s + (Number(x.computed_cost) || 0), 0)
  const m = (section.miscLines || []).reduce((s, x) => s + (Number(x.cost) || 0), 0)
  return r + h + sw + m
}

export async function computeValueSummary(proposalId, { force = false } = {}) {
  const [proposal, sections, timeline, existing] = await Promise.all([
    getProposal(proposalId), getCostSections(proposalId), listTimeline(proposalId), getValueSummary(proposalId),
  ])

  // Frozen once Sent (status left Draft/In Negotiation) — a customer is
  // looking at a specific number; further edits create a new version
  // instead of silently recalculating this one.
  const isDraftLike = ['Draft', 'In Negotiation'].includes(proposal.status)
  if (existing?.is_frozen && !isDraftLike && !force) return existing

  const byCategory = sections.map(s => {
    const internalCost = sectionInternalCost(s)
    const marginPct = s.margin_percent ?? proposal.overall_margin_percent
    const customerPrice = internalCost * (1 + marginPct / 100)
    return { category: s.category, internalCost, marginPercent: marginPct, customerPrice }
  })

  const totalInternalCost = byCategory.reduce((s, c) => s + c.internalCost, 0)
  const totalCustomerPrice = byCategory.reduce((s, c) => s + c.customerPrice, 0)
  const projectedProfit = totalCustomerPrice - totalInternalCost
  const projectedMarginPercent = totalCustomerPrice > 0 ? (projectedProfit / totalCustomerPrice) * 100 : 0
  const blendedMarkupPercent = totalInternalCost > 0 ? (projectedProfit / totalInternalCost) * 100 : 0

  // Phase view: each phase's cost = its linked resource plans' computed_cost,
  // marked up by that plan's own section margin — a cash-flow-shaped view
  // ("customer pays X in Design, Y in Development") rather than one lump sum.
  const planById = {}
  sections.forEach(s => (s.resourcePlans || []).forEach(p => { planById[p.id] = { ...p, sectionMargin: s.margin_percent ?? proposal.overall_margin_percent } }))

  const byPhase = timeline.map(phase => {
    const plans = (phase.linked_resource_plan_ids || []).map(id => planById[id]).filter(Boolean)
    const internalCost = plans.reduce((s, p) => s + (Number(p.computed_cost) || 0), 0)
    const customerPrice = plans.reduce((s, p) => s + (Number(p.computed_cost) || 0) * (1 + p.sectionMargin / 100), 0)
    return { phase: phase.phase_name, startOffsetWeeks: phase.start_offset_weeks, durationWeeks: phase.duration_weeks, internalCost, customerPrice }
  })

  const summary = {
    proposal_id: proposalId,
    total_internal_cost: round2(totalInternalCost),
    total_customer_price: round2(totalCustomerPrice),
    projected_profit: round2(projectedProfit),
    projected_margin_percent: round2(projectedMarginPercent),
    blended_markup_percent: round2(blendedMarkupPercent),
    cost_by_category: byCategory.map(c => ({ ...c, internalCost: round2(c.internalCost), customerPrice: round2(c.customerPrice) })),
    cost_by_phase: byPhase.map(p => ({ ...p, internalCost: round2(p.internalCost), customerPrice: round2(p.customerPrice) })),
    is_frozen: !isDraftLike,
    computed_at: new Date().toISOString(),
  }

  const { error } = await supabase.from('proposal_value_summary').upsert(summary, { onConflict: 'proposal_id' })
  if (error) throw error
  return summary
}

export async function getValueSummary(proposalId) {
  const { data } = await supabase.from('proposal_value_summary').select('*').eq('proposal_id', proposalId).maybeSingle()
  return data || null
}

/* ═══ Status transitions ═══════════════════════════════════════ */

export async function markWon(proposalId) {
  await computeValueSummary(proposalId, { force: true })
  const { error } = await supabase.from('proposals').update({ status: 'Won' }).eq('id', proposalId)
  if (error) throw error
}

export async function markLost(proposalId, reason) {
  const { error } = await supabase.from('proposals').update({ status: 'Lost', rejection_reason: reason || null }).eq('id', proposalId)
  if (error) throw error
}

export async function markExpired(proposalId) {
  const { error } = await supabase.from('proposals').update({ status: 'Expired' }).eq('id', proposalId)
  if (error) throw error
}

/* ═══ Proposal → budget category mapping (configurable, not hardcoded) ═══ */

export async function getBudgetCategoryMap() {
  const { data, error } = await supabase.from('proposal_budget_category_map').select('*')
  if (error) throw error
  return Object.fromEntries((data || []).map(r => [r.proposal_category, r.budget_category]))
}
