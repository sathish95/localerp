import { supabase, nextNum } from './supabase'
import { getInventoryList } from './inventory'
import { resolveHourlyRate } from './actualCost'

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
// resolveResourceRate() applies when a plan is actually saved, so the
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

// Active employees a Resource Plan line can be pinned to instead of a
// generic designation slot — see resolveResourceRate() below for how a
// named employee's rate is then resolved.
export async function listEmployeeOptions() {
  const { data, error } = await supabase.from('profiles').select('id, full_name, designation').eq('is_active', true).order('full_name')
  if (error) throw error
  return data || []
}

// Reuses actualCost.js's resolveHourlyRate() exactly (role_rates by
// designation first, falling back to that employee's own resource_rates
// row) instead of a second, easily-drifting copy of that fallback chain —
// this file previously only ever looked up role_rates (getRateForDesignation),
// silently pricing an employee with no role_rates entry at Rs 0.
async function resolveResourceRate(designation, employeeId, onDate) {
  const [{ data: roleRates }, { data: resourceRates }] = await Promise.all([
    designation ? supabase.from('role_rates').select('*').eq('designation', designation) : Promise.resolve({ data: [] }),
    employeeId ? supabase.from('resource_rates').select('employee_id,hourly_rate,monthly_salary').eq('employee_id', employeeId) : Promise.resolve({ data: [] }),
  ])
  return resolveHourlyRate({ designation, employeeId, roleRates: roleRates || [], resourceRates: resourceRates || [], onDate })
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

/**
 * Full standalone copy of a proposal — a brand new proposal_group_id/id,
 * version 1, Draft, no approval history, no linked_project_id — as opposed
 * to createRevision() which stays inside the SAME group/version chain for
 * an already-sent proposal. Every section/line/timeline phase is recreated
 * through the same add*() functions the editor UI uses (never a raw bulk
 * insert), so resource-plan rates get re-resolved against CURRENT role_rates
 * (a duplicate is a fresh quote, not a frozen historical snapshot) and every
 * other invariant (computed_cost, subtotal_internal_cost, misc percent-of-base)
 * is derived exactly as if a person had re-typed it all in by hand.
 *
 * Ordering matters: resource plans are copied for every section FIRST (so
 * every id has a new counterpart for timeline/misc remapping), THEN hardware/
 * software lines, THEN misc lines LAST — a percent_of_base misc line recomputes
 * against the new proposal's live resource-plan-category total, so that total
 * must already be fully seeded before any misc line reads it.
 */
export async function duplicateProposal(proposalId, userId) {
  const [source, sections, timeline, budgetMap] = await Promise.all([
    getProposal(proposalId), getCostSections(proposalId), listTimeline(proposalId), getBudgetCategoryMap(),
  ])

  const newProposal = await createProposal({
    proposal_name: `${source.proposal_name} (Copy)`, customer_name: source.customer_name,
    customer_contact: source.customer_contact, validity_until_date: source.validity_until_date,
    overall_margin_percent: source.overall_margin_percent, currency: source.currency,
  }, userId)

  const newSections = await getCostSections(newProposal.id) // the 7 standard categories, freshly empty
  const sectionIdByCategory = Object.fromEntries(newSections.map(s => [s.category, s.id]))

  for (const s of sections) {
    if (!sectionIdByCategory[s.category]) {
      const created = await addCostSection(newProposal.id, s.category, budgetMap[s.category])
      sectionIdByCategory[s.category] = created.id
    }
    if (s.margin_percent != null || s.notes) {
      await updateCostSection(sectionIdByCategory[s.category], { margin_percent: s.margin_percent, notes: s.notes })
    }
  }

  const planIdMap = {}
  for (const s of sections) {
    const newSectionId = sectionIdByCategory[s.category]
    for (const r of s.resourcePlans || []) {
      const created = await addResourcePlan({
        proposalCostSectionId: newSectionId, designation: r.designation, employeeId: r.employee_id,
        estimatedCount: r.estimated_count, estimatedDurationWeeks: r.estimated_duration_weeks, notes: r.notes,
      })
      planIdMap[r.id] = created.id
    }
  }

  for (const s of sections) {
    const newSectionId = sectionIdByCategory[s.category]
    for (const h of s.hardwareLines || []) {
      await addHardwareLine({
        proposalCostSectionId: newSectionId, partNumber: h.part_number, description: h.description,
        estimatedQuantity: h.estimated_quantity, manualUnitCost: h.part_number ? undefined : h.unit_cost, notes: h.notes,
      })
    }
    for (const sw of s.softwareLines || []) {
      await addSoftwareLine({
        proposalCostSectionId: newSectionId, itemName: sw.item_name, costType: sw.cost_type,
        unitCost: sw.unit_cost, qty: sw.qty, durationMonths: sw.duration_months, notes: sw.notes,
      })
    }
  }

  for (const s of sections) {
    const newSectionId = sectionIdByCategory[s.category]
    for (const m of s.miscLines || []) {
      await addMiscLine({
        proposalCostSectionId: newSectionId, itemName: m.item_name, cost: m.cost, notes: m.notes,
        lineType: m.line_type, linkedResourcePlanId: m.linked_resource_plan_id ? planIdMap[m.linked_resource_plan_id] : null,
        percentOfBase: m.percent_of_base,
      })
    }
  }

  for (const t of timeline) {
    await addTimelinePhase({
      proposalId: newProposal.id, phaseName: t.phase_name, startOffsetWeeks: t.start_offset_weeks,
      durationWeeks: t.duration_weeks, linkedResourcePlanIds: (t.linked_resource_plan_ids || []).map(id => planIdMap[id]).filter(Boolean),
      sortOrder: t.sort_order,
    })
  }

  await computeValueSummary(newProposal.id)
  return newProposal.id
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

/**
 * Adds a custom cost section beyond the fixed 7 (STEP215) — computeValueSummary()
 * already treats every section generically (its own margin_percent, falling
 * back to the proposal's overall margin), so a custom section needs no
 * changes there. `budgetCategory`, if given, upserts a proposal_budget_category_map
 * row so this category also rolls up into a real planned-budget bucket on
 * "Convert to Project" — proposalConvert.js already skips any category
 * without a mapping row rather than guessing, so this is purely additive.
 */
export async function addCostSection(proposalId, category, budgetCategory) {
  const { data, error } = await supabase.from('proposal_cost_sections')
    .insert({ proposal_id: proposalId, category, is_custom: true })
    .select().single()
  if (error) throw error
  if (budgetCategory) {
    await supabase.from('proposal_budget_category_map')
      .upsert({ proposal_category: category, budget_category: budgetCategory }, { onConflict: 'proposal_category' })
  }
  return data
}

/** Only ever removes a custom section — the original 7 are structural, not deletable. */
export async function deleteCostSection(id) {
  const { error } = await supabase.from('proposal_cost_sections').delete().eq('id', id).eq('is_custom', true)
  if (error) throw error
}

/* ── Resource plan lines (App/Firmware/Hardware-Design) ── */

export async function addResourcePlan({ proposalCostSectionId, designation, employeeId, estimatedCount, estimatedDurationWeeks, notes }) {
  // A named employee is one specific person, not an abstract headcount slot.
  const count = employeeId ? 1 : Number(estimatedCount)
  const rateUsed = await resolveResourceRate(designation, employeeId, new Date())
  const computedCost = count * Number(estimatedDurationWeeks) * HOURS_PER_WEEK * rateUsed
  const { data, error } = await supabase.from('proposal_resource_plans').insert({
    proposal_cost_section_id: proposalCostSectionId, designation, employee_id: employeeId || null,
    estimated_count: count, estimated_duration_weeks: estimatedDurationWeeks,
    rate_used: rateUsed, computed_cost: computedCost, notes: notes || null,
  }).select().single()
  if (error) throw error
  return data // duplicateProposal() needs the new id to remap timeline links
}

export async function updateResourcePlan(id, { designation, employeeId, estimatedCount, estimatedDurationWeeks, notes, refreshRate }) {
  const count = employeeId ? 1 : Number(estimatedCount)
  let rateUsed
  if (refreshRate) {
    rateUsed = await resolveResourceRate(designation, employeeId, new Date())
  } else {
    const { data } = await supabase.from('proposal_resource_plans').select('rate_used').eq('id', id).single()
    rateUsed = Number(data?.rate_used) || 0
  }
  const computedCost = count * Number(estimatedDurationWeeks) * HOURS_PER_WEEK * rateUsed
  const { error } = await supabase.from('proposal_resource_plans').update({
    designation, employee_id: employeeId || null, estimated_count: count, estimated_duration_weeks: estimatedDurationWeeks,
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

function computeSoftwareLineCost(costType, unitCost, durationMonths, qty) {
  const u = Number(unitCost) || 0
  const m = Number(durationMonths) || 1
  const q = Number(qty) || 1
  if (costType === 'Monthly') return u * q * m
  if (costType === 'Annual') return u * q * Math.ceil(m / 12)
  return u * q // One-time
}

export async function addSoftwareLine({ proposalCostSectionId, itemName, costType, unitCost, qty, durationMonths, notes }) {
  const computedCost = computeSoftwareLineCost(costType, unitCost, durationMonths, qty)
  const { error } = await supabase.from('proposal_software_lines').insert({
    proposal_cost_section_id: proposalCostSectionId, item_name: itemName, cost_type: costType || 'One-time',
    unit_cost: unitCost, qty: qty || 1, duration_months: durationMonths || 1, computed_cost: computedCost, notes: notes || null,
  })
  if (error) throw error
}

export async function updateSoftwareLine(id, { itemName, costType, unitCost, qty, durationMonths, notes }) {
  const computedCost = computeSoftwareLineCost(costType, unitCost, durationMonths, qty)
  const { error } = await supabase.from('proposal_software_lines').update({
    item_name: itemName, cost_type: costType, unit_cost: unitCost, qty: qty || 1, duration_months: durationMonths,
    computed_cost: computedCost, notes: notes || null,
  }).eq('id', id)
  if (error) throw error
}

export async function deleteSoftwareLine(id) {
  const { error } = await supabase.from('proposal_software_lines').delete().eq('id', id)
  if (error) throw error
}

/* ── Miscellaneous lines ── */

/**
 * Sum of internal cost across every resource-plan-priced category
 * (Application Development, Firmware Development, Hardware Design &
 * Production, ERP Integration) on this proposal — the "base" a
 * percent_of_base misc line (STEP218) is calculated against, e.g.
 * "Contingency = 10% of total engineering cost".
 */
export async function getResourcePlanCategoryCost(proposalId) {
  const sections = await getCostSections(proposalId)
  return sections
    .filter(s => RESOURCE_PLAN_CATEGORIES.includes(s.category))
    .reduce((sum, s) => sum + sectionInternalCost(s), 0)
}

async function resolveProposalIdForSection(proposalCostSectionId) {
  const { data, error } = await supabase.from('proposal_cost_sections').select('proposal_id').eq('id', proposalCostSectionId).single()
  if (error) throw error
  return data.proposal_id
}

/** percentOfBase, if given, recomputes `cost` live against the current resource-plan-category total — never trusts a stale percentage. */
async function resolveMiscCost({ proposalCostSectionId, cost, percentOfBase }) {
  if (percentOfBase == null || percentOfBase === '') return { cost: Number(cost) || 0, percent_of_base: null, base_cost_snapshot: null }
  const proposalId = await resolveProposalIdForSection(proposalCostSectionId)
  const baseCost = await getResourcePlanCategoryCost(proposalId)
  return { cost: round2((Number(percentOfBase) / 100) * baseCost), percent_of_base: Number(percentOfBase), base_cost_snapshot: round2(baseCost) }
}

export async function addMiscLine({ proposalCostSectionId, itemName, cost, notes, lineType, linkedResourcePlanId, percentOfBase }) {
  const resolved = await resolveMiscCost({ proposalCostSectionId, cost, percentOfBase })
  const { error } = await supabase.from('proposal_misc_lines').insert({
    proposal_cost_section_id: proposalCostSectionId, item_name: itemName, ...resolved, notes: notes || null,
    line_type: lineType || 'Other', linked_resource_plan_id: linkedResourcePlanId || null,
  })
  if (error) throw error
}

export async function updateMiscLine(id, { proposalCostSectionId, itemName, cost, notes, lineType, linkedResourcePlanId, percentOfBase }) {
  const resolved = await resolveMiscCost({ proposalCostSectionId, cost, percentOfBase })
  const { error } = await supabase.from('proposal_misc_lines').update({
    item_name: itemName, ...resolved, notes: notes || null, line_type: lineType || 'Other', linked_resource_plan_id: linkedResourcePlanId || null,
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

// Hardcoded fallback only — used if budget_category_catalog (STEP217) is
// unreachable or not yet seeded for this org. listBudgetCategories() below
// is the live, admin-extensible source of truth.
export const BUDGET_CATEGORIES = [
  { value: 'planned_resource_cost', label: 'Resource / Labor' },
  { value: 'planned_hardware_cost', label: 'Hardware' },
  { value: 'planned_software_cost', label: 'Software' },
  { value: 'planned_erp_cost', label: 'ERP Integration' },
  { value: 'planned_misc_cost', label: 'Miscellaneous' },
  { value: 'planned_contingency_cost', label: 'Contingency' },
]

/** Every budget category this org has — the original 6 plus any custom ones an admin added (STEP217). */
export async function listBudgetCategories() {
  const { data, error } = await supabase.from('budget_category_catalog').select('*').order('is_custom').order('label')
  if (error) throw error
  return (data && data.length) ? data.map(r => ({ value: r.key, label: r.label, is_custom: r.is_custom })) : BUDGET_CATEGORIES
}

function slugifyBudgetCategoryKey(label) {
  const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return `planned_${slug}_cost`
}

/** Admin-created budget category (STEP217) — auto-derives a stable key from the label (e.g. "IoT Hardware" -> planned_iot_hardware_cost). */
export async function addBudgetCategory(label) {
  const trimmed = label.trim()
  if (!trimmed) throw new Error('Label is required')
  const key = slugifyBudgetCategoryKey(trimmed)
  const { data, error } = await supabase.from('budget_category_catalog')
    .insert({ key, label: trimmed, is_custom: true }).select().single()
  if (error) throw error
  return { value: data.key, label: data.label, is_custom: true }
}

/**
 * Every proposal category this org currently has, whether or not it's
 * mapped yet — the 7 standard categories, plus any custom section name
 * (STEP215) used on ANY proposal, unioned with whatever's already in
 * proposal_budget_category_map (a mapping can exist for a category no
 * live proposal currently uses, e.g. one that was later renamed/removed).
 * Drives the admin config UI (Settings -> Proposal Budget Mapping) so
 * nothing needs re-deriving from a proposal itself to be configurable.
 */
export async function listAllProposalCategories() {
  const [{ data: sectionRows, error: e1 }, { data: mapRows, error: e2 }] = await Promise.all([
    supabase.from('proposal_cost_sections').select('category').order('category'),
    supabase.from('proposal_budget_category_map').select('proposal_category'),
  ])
  if (e1) throw e1
  if (e2) throw e2
  const all = new Set([
    ...PROPOSAL_CATEGORIES,
    ...(sectionRows || []).map(r => r.category),
    ...(mapRows || []).map(r => r.proposal_category),
  ])
  return [...all].sort((a, b) => {
    const ai = PROPOSAL_CATEGORIES.indexOf(a), bi = PROPOSAL_CATEGORIES.indexOf(b)
    if (ai !== -1 && bi !== -1) return ai - bi   // standard 7 keep their canonical order
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.localeCompare(b)                    // custom ones alphabetically after
  })
}

/** Admin config: set (or change) a category's budget-category mapping. */
export async function upsertBudgetCategoryMapping(proposalCategory, budgetCategory) {
  const { error } = await supabase.from('proposal_budget_category_map')
    .upsert({ proposal_category: proposalCategory, budget_category: budgetCategory }, { onConflict: 'proposal_category' })
  if (error) throw error
}

/** Admin config: unmap a category — its cost simply won't seed a planned-budget line on "Convert to Project" anymore. */
export async function deleteBudgetCategoryMapping(proposalCategory) {
  const { error } = await supabase.from('proposal_budget_category_map').delete().eq('proposal_category', proposalCategory)
  if (error) throw error
}
