import { supabase } from './supabase'
import { getFinanceSettings } from './actualCost'
import { generateWarrantyFindings } from './warrantyAnalytics'
import { getFundFlowStages, getVendorFundFlow, getProductFundFlow } from './fundFlow'
import { getResourceFlow, getResourceFlowSummary } from './resourceFlow'

// Enterprise Spend Analyzer — company-wide rollup on top of existing data
// (budgets, actual_cost_snapshots, invoices, customer_invoices, allocations,
// change_requests, project_hardware/software/support_costs). No table here
// duplicates raw transactional data — company_spend_rollup / vendor_spend_summary
// / spend_findings are all derived, recomputed on demand (STEP36).
//
// Data-availability note (why some cuts are lifetime-only): only
// actual_cost_snapshots carries true month-by-month granularity (people_cost +
// hardware_cost, both computed per calendar month by src/lib/actualCost.js).
// project_hardware_costs / project_software_costs / project_support_costs /
// change_requests have no month bucket at all — they're running lifetime
// totals. So the 5-category "where is spend happening" breakdown
// (Resource/Hardware/Software/Support/Change) is only ever computed for
// period_key='ALL' (lifetime-to-date); the 12-month trend line uses
// actual_cost_snapshots' month rows directly (total_actual_cost, already a
// people+hardware sum) rather than trying to force a monthly split across all
// 5 categories that the data can't actually support.

export const SPEND_CATEGORIES = ['Resource', 'Hardware', 'Software', 'Support', 'Change', 'Warranty']

// budgets.category is free TEXT (user-typed, placeholder "e.g. Software, Travel,
// Payroll") — not an enum, so a budget row is mapped onto the fixed category
// axis by keyword match. Anything that matches nothing lands in 'Misc' so the
// planned total always reconciles to SUM(budgets.allocated) for that scope.
const CATEGORY_KEYWORDS = {
  Resource: ['resource', 'payroll', 'people', 'labor', 'labour', 'hr', 'salary'],
  Hardware: ['hardware', 'component', 'device', 'equipment', 'logistics'],
  Software: ['software', 'license', 'licence', 'saas', 'subscription', 'server'],
  Support: ['support', 'maintenance', 'travel'],
  Change: ['change'],
  Warranty: ['warranty', 'claim', 'rma'],
}
function categorizeLabel(text) {
  const t = (text || '').toLowerCase()
  for (const cat of SPEND_CATEGORIES) { if (CATEGORY_KEYWORDS[cat].some(k => t.includes(k))) return cat }
  return 'Misc'
}

// Same 3-state (+ 'unknown') health formula already used independently in
// DashboardPage.jsx (project & department cards) — centralized here so the
// company-wide RAG counts agree with what a CFO already sees per-project.
export function projectHealth(spent, budget) {
  if (!budget || budget <= 0) return 'unknown'
  const pct = Math.round((spent / budget) * 100)
  return pct > 100 ? 'over' : pct >= 70 ? 'risk' : 'healthy'
}

const monthKeyOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

// ────────────────────────────────────────────────────────────
// RECOMPUTE — writes company_spend_rollup (period_key='ALL', one row per
// department x category). Triggered manually ("Recompute Now" on the page),
// matching this app's existing actualCost.js/capacity.js convention — there's
// no cron/serverless layer in this stack to run it nightly automatically.
//
// `role` gates the Warranty actual-side source: warranty_cost_entries carries
// restrictive RLS (admin/ceo/finance only, same as profit_margins), but
// canViewSpendAnalyzer also includes manager/department_head. A recompute
// triggered by one of those roles would silently read 0 rows back (RLS, not
// an error) and overwrite real Warranty actuals with zero — so non-finance
// callers instead carry forward the existing Warranty rollup values unchanged
// rather than recomputing them.
// ────────────────────────────────────────────────────────────
export async function recomputeCompanyRollup(role) {
  const canReadWarrantyCost = ['admin', 'ceo', 'finance'].includes(role)
  const [{ data: projects }, { data: budgets }, { data: snaps }, { data: hw }, { data: sw }, { data: sup }, { data: crs }, { data: warranties }, { data: wtyClaims }, { data: wtyCosts }, { data: existingWarrantyRollup }] = await Promise.all([
    supabase.from('projects').select('id,department_id'),
    supabase.from('budgets').select('department_id,project_id,category,allocated'),
    supabase.from('actual_cost_snapshots').select('project_id,people_cost').eq('period_type', 'to_date').eq('period_key', 'ALL'),
    supabase.from('project_hardware_costs').select('project_id,cost_company'),
    supabase.from('project_software_costs').select('project_id,cost_company'),
    supabase.from('project_support_costs').select('project_id,cost_company'),
    supabase.from('change_requests').select('project_id,actual_cost,estimated_cost,status'),
    canReadWarrantyCost ? supabase.from('device_warranties').select('id,project_id') : Promise.resolve({ data: [] }),
    canReadWarrantyCost ? supabase.from('warranty_claims').select('id,device_warranty_id') : Promise.resolve({ data: [] }),
    canReadWarrantyCost ? supabase.from('warranty_cost_entries').select('warranty_claim_id,amount') : Promise.resolve({ data: [] }),
    canReadWarrantyCost ? Promise.resolve({ data: [] }) : supabase.from('company_spend_rollup').select('department_id,actual_amount').eq('period_key', 'ALL').eq('category', 'Warranty'),
  ])

  const projDept = Object.fromEntries((projects || []).map(p => [p.id, p.department_id || null]))
  const cell = {} // `${deptKey}::${category}` -> { planned, actual }
  const deptKeyOf = id => id || '__unassigned__'
  function bump(deptId, category, field, amount) {
    const key = `${deptKeyOf(deptId)}::${category}`
    if (!cell[key]) cell[key] = { department_id: deptId, category, planned: 0, actual: 0 }
    cell[key][field] += Number(amount || 0)
  }

  // Planned side — every budget row lands somewhere: dept-scoped rows use their
  // own department_id directly; project-scoped rows resolve via projects.department_id.
  ;(budgets || []).forEach(b => {
    const deptId = b.department_id || projDept[b.project_id] || null
    bump(deptId, categorizeLabel(b.category), 'planned', b.allocated)
  })

  // Actual side — Resource from actual_cost_snapshots (allocations x role_rates,
  // see actualCost.js), Hardware/Software/Support from their dedicated cost
  // tables, Change from change_requests (only counted once a CR is
  // approved/implemented — a draft/rejected CR isn't real spend yet).
  ;(snaps || []).forEach(s => bump(projDept[s.project_id], 'Resource', 'actual', s.people_cost))
  ;(hw || []).forEach(r => bump(projDept[r.project_id], 'Hardware', 'actual', r.cost_company))
  ;(sw || []).forEach(r => bump(projDept[r.project_id], 'Software', 'actual', r.cost_company))
  ;(sup || []).forEach(r => bump(projDept[r.project_id], 'Support', 'actual', r.cost_company))
  ;(crs || []).forEach(r => {
    const amt = Number(r.actual_cost || 0) > 0 ? r.actual_cost : (['approved', 'implemented'].includes(r.status) ? r.estimated_cost : 0)
    bump(projDept[r.project_id], 'Change', 'actual', amt)
  })
  if (canReadWarrantyCost) {
    const projByWarranty = Object.fromEntries((warranties || []).map(w => [w.id, w.project_id]))
    const projByClaim = Object.fromEntries((wtyClaims || []).map(c => [c.id, projByWarranty[c.device_warranty_id]]))
    ;(wtyCosts || []).forEach(e => bump(projDept[projByClaim[e.warranty_claim_id]], 'Warranty', 'actual', e.amount))
  } else {
    (existingWarrantyRollup || []).forEach(r => bump(r.department_id, 'Warranty', 'actual', r.actual_amount))
  }

  const rows = Object.values(cell).map(c => {
    const variance = Math.round((c.actual - c.planned) * 100) / 100
    return {
      period_key: 'ALL', department_id: c.department_id, category: c.category,
      planned_amount: Math.round(c.planned * 100) / 100, actual_amount: Math.round(c.actual * 100) / 100,
      variance_amount: variance, variance_percent: c.planned > 0 ? Math.round((variance / c.planned) * 10000) / 100 : 0,
      computed_at: new Date().toISOString(),
    }
  })
  if (rows.length) await supabase.from('company_spend_rollup').upsert(rows, { onConflict: 'period_key,department_id,category' })
  return rows
}

// department_id is a soft ref (no real FK — see STEP36), so PostgREST can't
// resolve an embedded department:departments(name) select; fetch departments
// separately and merge client-side instead.
export async function getCompanyRollup() {
  const [{ data: rows }, { data: departments }] = await Promise.all([
    supabase.from('company_spend_rollup').select('*').eq('period_key', 'ALL'),
    supabase.from('departments').select('id,name'),
  ])
  const deptById = new Map((departments || []).map(d => [d.id, d]))
  return (rows || []).map(r => ({ ...r, department: r.department_id ? deptById.get(r.department_id) || null : null }))
}

// ────────────────────────────────────────────────────────────
// SECTION 1 — company-wide executive summary
// ────────────────────────────────────────────────────────────
export async function getCompanySummary() {
  const [{ data: projects }, rollup, { data: customerInvoices }] = await Promise.all([
    supabase.from('projects').select('id,name,budget,spent,status'),
    getCompanyRollup(),
    supabase.from('customer_invoices').select('total_amount,status').in('status', ['sent', 'partially_paid', 'paid']),
  ])
  const totalBudget = (projects || []).reduce((s, p) => s + Number(p.budget || 0), 0)
  const totalActual = rollup.reduce((s, r) => s + Number(r.actual_amount || 0), 0)
  const totalRevenue = (customerInvoices || []).reduce((s, i) => s + Number(i.total_amount || 0), 0)
  const totalProfit = totalRevenue - totalActual
  const marginPct = totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 10000) / 100 : 0

  const flags = { red: 0, amber: 0, green: 0 }
  ;(projects || []).filter(p => p.status === 'active').forEach(p => {
    const h = projectHealth(p.spent, p.budget)
    if (h === 'over') flags.red++
    else if (h === 'risk') flags.amber++
    else if (h === 'healthy') flags.green++
  })

  return { totalBudget, totalActual, totalRevenue, totalProfit, marginPct, flags, activeProjectCount: (projects || []).filter(p => p.status === 'active').length }
}

// 12-month planned-vs-actual trend. Actual = actual_cost_snapshots month rows
// (total_actual_cost already sums people+hardware, the only 2 categories with
// real monthly granularity). Planned = each fiscal year's total allocated
// budget spread evenly over 12 months — a deliberate v1 simplification (no
// monthly budget-allocation concept exists in this app beyond the nullable,
// rarely-used budgets.month column) so a "planned" reference line still
// renders; swap for a real monthly-allocation model later if one is added.
export async function getSpendTrend(months = 12) {
  const today = new Date()
  const keys = []
  for (let i = months - 1; i >= 0; i--) keys.push(monthKeyOf(new Date(today.getFullYear(), today.getMonth() - i, 1)))

  const [{ data: snaps }, { data: budgets }] = await Promise.all([
    supabase.from('actual_cost_snapshots').select('period_key,total_actual_cost').eq('period_type', 'month').in('period_key', keys),
    supabase.from('budgets').select('allocated,fiscal_year'),
  ])
  const actualByMonth = {}
  ;(snaps || []).forEach(s => { actualByMonth[s.period_key] = (actualByMonth[s.period_key] || 0) + Number(s.total_actual_cost || 0) })
  const annualByYear = {}
  ;(budgets || []).forEach(b => { annualByYear[b.fiscal_year] = (annualByYear[b.fiscal_year] || 0) + Number(b.allocated || 0) })

  return keys.map(k => {
    const year = Number(k.slice(0, 4))
    const monthlyPlanned = (annualByYear[year] || 0) / 12
    return { month: k, planned: Math.round(monthlyPlanned * 100) / 100, actual: Math.round((actualByMonth[k] || 0) * 100) / 100 }
  })
}

// ────────────────────────────────────────────────────────────
// SECTION 2 — where spend is happening (descriptive cuts)
// ────────────────────────────────────────────────────────────
export async function getSpendByCategory() {
  const rollup = await getCompanyRollup()
  const byCat = {}
  rollup.forEach(r => {
    if (!byCat[r.category]) byCat[r.category] = { category: r.category, planned: 0, actual: 0 }
    byCat[r.category].planned += Number(r.planned_amount || 0)
    byCat[r.category].actual += Number(r.actual_amount || 0)
  })
  return [...SPEND_CATEGORIES, 'Misc'].map(c => byCat[c] || { category: c, planned: 0, actual: 0 })
    .map(c => ({ ...c, variance_percent: c.planned > 0 ? Math.round(((c.actual - c.planned) / c.planned) * 10000) / 100 : 0 }))
}

export async function getSpendByDepartment() {
  const [rollup, { data: departments }] = await Promise.all([getCompanyRollup(), supabase.from('departments').select('id,name')])
  const deptMap = Object.fromEntries((departments || []).map(d => [d.id, d.name]))
  const byDept = {}
  rollup.forEach(r => {
    const key = r.department_id || '__unassigned__'
    if (!byDept[key]) byDept[key] = { department_id: r.department_id, name: r.department_id ? (deptMap[r.department_id] || 'Unknown') : 'Unassigned', planned: 0, actual: 0 }
    byDept[key].planned += Number(r.planned_amount || 0)
    byDept[key].actual += Number(r.actual_amount || 0)
  })
  return Object.values(byDept).map(d => ({ ...d, variance_percent: d.planned > 0 ? Math.round(((d.actual - d.planned) / d.planned) * 10000) / 100 : 0 }))
    .sort((a, b) => b.actual - a.actual)
}

// Defaults to top 20 by actual spend — never renders every project unfiltered.
export async function getSpendByProject({ sortBy = 'spend', limit = 20 } = {}) {
  const { data: projects } = await supabase.from('projects').select('id,name,budget,spent,status,department_id')
  const rows = (projects || []).map(p => {
    const overrun = Math.max(0, Number(p.spent || 0) - Number(p.budget || 0))
    const burnPct = Number(p.budget || 0) > 0 ? Math.round((Number(p.spent || 0) / Number(p.budget || 0)) * 100) : 0
    return { id: p.id, name: p.name, budget: Number(p.budget || 0), spent: Number(p.spent || 0), status: p.status, overrun, burnPct, health: projectHealth(p.spent, p.budget) }
  })
  const sorted = rows.sort((a, b) => sortBy === 'overrun' ? b.overrun - a.overrun : sortBy === 'burn' ? b.burnPct - a.burnPct : b.spent - a.spent)
  return sorted.slice(0, limit)
}

export async function getSpendByVendor({ limit = 20 } = {}) {
  const { data } = await supabase.from('vendor_spend_summary').select('*,vendor:vendors(name,category)').eq('period_key', 'ALL').order('total_spend', { ascending: false }).limit(limit)
  return data || []
}

// No precomputed summary table for products (unlike vendor_spend_summary) —
// this is a straightforward on-demand aggregation of purchase_requisition_items
// by part_number, same cost/shape as the Category tab's keyword-bucketing
// elsewhere in this file.
export async function getSpendByProduct({ limit = 20 } = {}) {
  const [{ data: items }, { data: products }, { data: devices }] = await Promise.all([
    supabase.from('purchase_requisition_items').select('part_number,quantity,line_total'),
    supabase.from('products').select('part_number,name,standard_cost,is_serialized'),
    supabase.from('device_instances').select('part_number,status'),
  ])
  const productByPart = Object.fromEntries((products || []).map(p => [p.part_number, p]))
  const deployedByPart = {}
  ;(devices || []).forEach(d => {
    if (!d.part_number || !['deployed', 'faulty', 'replaced'].includes(d.status)) return
    deployedByPart[d.part_number] = (deployedByPart[d.part_number] || 0) + 1
  })
  const bucket = {}
  ;(items || []).forEach(i => {
    if (!i.part_number) return
    const b = bucket[i.part_number] ||= { part_number: i.part_number, requisitionedTotal: 0, requisitionedQty: 0 }
    b.requisitionedTotal += Number(i.line_total || 0)
    b.requisitionedQty += Number(i.quantity || 0)
  })
  return Object.values(bucket)
    .map(b => ({
      ...b,
      requisitionedTotal: Math.round(b.requisitionedTotal * 100) / 100,
      name: productByPart[b.part_number]?.name || b.part_number,
      is_serialized: productByPart[b.part_number]?.is_serialized ?? true,
      deployedCount: deployedByPart[b.part_number] || 0,
    }))
    .sort((a, b) => b.requisitionedTotal - a.requisitionedTotal)
    .slice(0, limit)
}

// Per-part_number device fleet health — same status buckets and warranty
// window DashboardPage.jsx already computes (deployed/faulty/replaced counts
// as "deployed", ≤30 days as "warranty soon"), just grouped by part instead
// of company-wide, for Spend Analyzer's By Device view.
export async function getDeviceFleetStats() {
  const { data: devices, error } = await supabase.from('device_instances').select('part_number,status,warranty_end')
  if (error) throw error
  const warrantyDays = d => d ? (new Date(d) - new Date()) / 86400000 : null
  const byPart = {}
  ;(devices || []).forEach(d => {
    if (!d.part_number) return
    const b = byPart[d.part_number] ||= { deployedCount: 0, inStorageCount: 0, attentionCount: 0, decommissionedCount: 0, warrantySoonCount: 0 }
    if (['deployed', 'faulty', 'replaced'].includes(d.status)) b.deployedCount++
    if (d.status === 'in_storage') b.inStorageCount++
    if (['faulty', 'replaced'].includes(d.status)) b.attentionCount++
    if (d.status === 'decommissioned') b.decommissionedCount++
    const days = warrantyDays(d.warranty_end)
    if (days != null && days >= 0 && days <= 30) b.warrantySoonCount++
  })
  return byPart
}

export async function getSpendByTime(months = 12) { return getSpendTrend(months) }

// Total spend/vendor from the real invoices.vendor_id FK — this is the one
// vendor rollup source with a genuine foreign key (unlike project_hardware_costs'
// free-text vendor column, used separately for the consolidation finding below).
export async function recomputeVendorSpendSummary() {
  const [{ data: invoices }, { data: vendors }] = await Promise.all([
    supabase.from('invoices').select('vendor_id,total_amount,project_id').not('vendor_id', 'is', null),
    supabase.from('vendors').select('id,name'),
  ])
  const byVendor = {}
  ;(invoices || []).forEach(i => {
    if (!byVendor[i.vendor_id]) byVendor[i.vendor_id] = { total_spend: 0, invoice_count: 0, projects: new Set() }
    byVendor[i.vendor_id].total_spend += Number(i.total_amount || 0)
    byVendor[i.vendor_id].invoice_count += 1
    if (i.project_id) byVendor[i.vendor_id].projects.add(i.project_id)
  })
  const rows = Object.entries(byVendor).map(([vendor_id, v]) => ({
    vendor_id, period_key: 'ALL', total_spend: Math.round(v.total_spend * 100) / 100,
    invoice_count: v.invoice_count, project_count: v.projects.size, computed_at: new Date().toISOString(),
  }))
  if (rows.length) await supabase.from('vendor_spend_summary').upsert(rows, { onConflict: 'vendor_id,period_key' })
  return rows
}

// ────────────────────────────────────────────────────────────
// SECTION 3 — prescriptive findings
// ────────────────────────────────────────────────────────────
const OVERRUN_FINDING_PCT = 15       // variance% beyond which a dept/category counts as "recurring overrun"
const UNDERUTIL_SPEND_PCT = 40       // active project spending below this % of budget flags as underutilized
const VENDOR_PRICE_VARIANCE = 1.15   // max/min unit price ratio that flags a consolidation opportunity
const CHANGE_CREEP_PCT = 15          // cumulative CR cost as % of project budget that flags "change cost creep"
const LOW_UTILIZATION_PCT = 50       // department avg utilization below this flags allocation inefficiency

async function replaceFindings(findingType, rows) {
  // Only 'new' findings are replaced on recompute — once Finance/PMO has
  // acknowledged/actioned/dismissed one, it stays put instead of resurfacing.
  await supabase.from('spend_findings').delete().eq('finding_type', findingType).eq('status', 'new')
  if (rows.length) await supabase.from('spend_findings').insert(rows)
}

export async function generateFindings() {
  const [rollup, { data: projects }, { data: hw }, { data: crs }, { data: profiles }, { data: capSnaps }] = await Promise.all([
    getCompanyRollup(),
    supabase.from('projects').select('id,name,budget,spent,reserved_budget,status,department_id'),
    supabase.from('project_hardware_costs').select('project_id,name,vendor,unit_price').not('vendor', 'is', null),
    supabase.from('change_requests').select('project_id,actual_cost,estimated_cost,status'),
    supabase.from('profiles').select('id,department_id'),
    supabase.from('capacity_snapshots').select('employee_id,utilization_percent'),
  ])

  // 1. Recurring overrun — dept/category cells running materially over plan.
  const overrunRows = rollup.filter(r => r.planned_amount > 0 && r.variance_percent > OVERRUN_FINDING_PCT)
    .sort((a, b) => b.variance_percent - a.variance_percent).slice(0, 10)
    .map(r => ({
      finding_type: 'RecurringOverrun',
      title: `${r.category} spend running ${r.variance_percent}% over plan`,
      description: `${r.category} spend is ${rupeeStr(r.variance_amount)} over its ${rupeeStr(r.planned_amount)} planned budget (${r.variance_percent}% over) — review estimation for this category going forward.`,
      impact_amount: Math.round(r.variance_amount * 100) / 100,
      related_department_ids: r.department_id ? [r.department_id] : [],
      related_project_ids: [],
    }))

  // 2. Contingency usage — projects drawing into reserved_budget (contingency),
  // grouped by department, both over-use and near-zero-use are worth flagging.
  const contingencyByDept = {}
  ;(projects || []).forEach(p => {
    if (!p.reserved_budget || p.reserved_budget <= 0) return
    const usable = Math.max(0, Number(p.budget || 0) - Number(p.reserved_budget || 0))
    const overflow = Math.max(0, Number(p.spent || 0) - usable)
    const usedPct = Math.min(100, Math.round((overflow / p.reserved_budget) * 100))
    const key = p.department_id || '__unassigned__'
    if (!contingencyByDept[key]) contingencyByDept[key] = { department_id: p.department_id, total: 0, count: 0 }
    contingencyByDept[key].total += usedPct
    contingencyByDept[key].count += 1
  })
  const contingencyRows = Object.values(contingencyByDept).filter(c => c.count >= 2).map(c => ({ ...c, avgPct: Math.round(c.total / c.count) }))
    .filter(c => c.avgPct >= 40)
    .map(c => ({
      finding_type: 'ContingencyPattern',
      title: `Contingency consistently drawn down (avg ${c.avgPct}% used)`,
      description: `Projects in this department are using an average of ${c.avgPct}% of their contingency reserve — consider raising the default contingency % in the Budget Wizard for this department's project type.`,
      impact_amount: 0,
      related_department_ids: c.department_id ? [c.department_id] : [],
      related_project_ids: [],
    }))

  // 3. Underutilized budget — active projects spending well under plan; idle capital.
  const underutilRows = (projects || []).filter(p => p.status === 'active' && Number(p.budget || 0) > 0)
    .map(p => ({ p, pct: Math.round((Number(p.spent || 0) / Number(p.budget || 0)) * 100) }))
    .filter(x => x.pct < UNDERUTIL_SPEND_PCT)
    .sort((a, b) => a.pct - b.pct).slice(0, 10)
    .map(({ p, pct }) => ({
      finding_type: 'UnderutilizedBudget',
      title: `${p.name} — only ${pct}% of budget spent`,
      description: `${p.name} is active but has only spent ${pct}% of its ${rupeeStr(p.budget)} budget — the unspent ${rupeeStr(p.budget - p.spent)} could be reallocated if the remaining scope doesn't need it.`,
      impact_amount: Math.round((Number(p.budget || 0) - Number(p.spent || 0)) * 100) / 100,
      related_project_ids: [p.id],
      related_department_ids: p.department_id ? [p.department_id] : [],
    }))

  // 4. Vendor consolidation — same hardware item, multiple vendor names, materially
  // different unit price. Uses project_hardware_costs' free-text `vendor` column
  // (distinct from invoices.vendor_id's real FK) since that's where item-level
  // unit price + vendor name are both recorded together.
  const byItem = {}
  ;(hw || []).forEach(r => {
    const key = (r.name || '').trim().toLowerCase()
    if (!key) return
    if (!byItem[key]) byItem[key] = []
    byItem[key].push({ vendor: (r.vendor || '').trim(), price: Number(r.unit_price || 0) })
  })
  const vendorRows = Object.entries(byItem).filter(([, rows]) => {
    const vendors = new Set(rows.map(r => r.vendor).filter(Boolean))
    const prices = rows.map(r => r.price).filter(p => p > 0)
    return vendors.size >= 2 && prices.length >= 2 && Math.max(...prices) / Math.min(...prices) >= VENDOR_PRICE_VARIANCE
  }).map(([item, rows]) => {
    const prices = rows.map(r => r.price).filter(p => p > 0)
    const vendors = [...new Set(rows.map(r => r.vendor).filter(Boolean))]
    const min = Math.min(...prices), max = Math.max(...prices)
    return {
      finding_type: 'VendorConsolidation',
      title: `"${item}" bought from ${vendors.length} vendors at different prices`,
      description: `"${item}" has been purchased from ${vendors.length} vendors (${vendors.join(', ')}) ranging from ${rupeeStr(min)} to ${rupeeStr(max)} per unit — consolidating to the lowest-cost vendor could save up to ${Math.round(((max - min) / max) * 100)}% per unit.`,
      impact_amount: Math.round((max - min) * rows.length * 100) / 100,
      related_project_ids: [], related_department_ids: [],
    }
  }).slice(0, 10)

  // 5. Allocation inefficiency — departments with the lowest average utilization
  // (capacity_snapshots), the closest existing proxy for "resource planning
  // weakest" since this app has no metric literally named AllocationEffectiveness.
  const empDept = Object.fromEntries((profiles || []).map(p => [p.id, p.department_id]))
  const utilByDept = {}
  ;(capSnaps || []).forEach(s => {
    const dept = empDept[s.employee_id]
    if (!dept) return
    if (!utilByDept[dept]) utilByDept[dept] = { total: 0, count: 0 }
    utilByDept[dept].total += Number(s.utilization_percent || 0)
    utilByDept[dept].count += 1
  })
  const allocationRows = Object.entries(utilByDept).filter(([, v]) => v.count >= 3)
    .map(([dept, v]) => ({ dept, avg: Math.round(v.total / v.count) }))
    .filter(x => x.avg < LOW_UTILIZATION_PCT)
    .sort((a, b) => a.avg - b.avg).slice(0, 5)
    .map(x => ({
      finding_type: 'AllocationInefficiency',
      title: `Low resource utilization (avg ${x.avg}%)`,
      description: `This department's average weekly utilization is ${x.avg}% — a significant share of allocated capacity is going unused, suggesting allocations are being planned above actual project need.`,
      impact_amount: 0,
      related_department_ids: [x.dept], related_project_ids: [],
    }))

  // 6. Change cost creep — cumulative approved/implemented CR cost as % of project budget.
  const crByProject = {}
  ;(crs || []).filter(r => ['approved', 'implemented'].includes(r.status)).forEach(r => {
    const amt = Number(r.actual_cost || 0) > 0 ? r.actual_cost : Number(r.estimated_cost || 0)
    crByProject[r.project_id] = (crByProject[r.project_id] || 0) + amt
  })
  const changeRows = (projects || []).filter(p => crByProject[p.id] && Number(p.budget || 0) > 0)
    .map(p => ({ p, pct: Math.round((crByProject[p.id] / p.budget) * 100), amt: crByProject[p.id] }))
    .filter(x => x.pct >= CHANGE_CREEP_PCT)
    .sort((a, b) => b.pct - a.pct).slice(0, 10)
    .map(({ p, pct, amt }) => ({
      finding_type: 'ChangeCostCreep',
      title: `${p.name} — change requests adding ${pct}% to budget`,
      description: `Approved/implemented change requests on ${p.name} cumulatively total ${rupeeStr(amt)}, ${pct}% of the original ${rupeeStr(p.budget)} budget — scope estimation at project creation may be consistently too tight for this project type.`,
      impact_amount: Math.round(amt * 100) / 100,
      related_project_ids: [p.id], related_department_ids: p.department_id ? [p.department_id] : [],
    }))

  await Promise.all([
    replaceFindings('RecurringOverrun', overrunRows),
    replaceFindings('ContingencyPattern', contingencyRows),
    replaceFindings('UnderutilizedBudget', underutilRows),
    replaceFindings('VendorConsolidation', vendorRows),
    replaceFindings('AllocationInefficiency', allocationRows),
    replaceFindings('ChangeCostCreep', changeRows),
    generateWarrantyFindings(),
  ])
}

function rupeeStr(n) { return '₹' + Math.round(Number(n || 0)).toLocaleString('en-IN') }

export async function getFindings({ status, findingType } = {}) {
  let q = supabase.from('spend_findings').select('*').order('detected_date', { ascending: false })
  if (status) q = q.eq('status', status)
  if (findingType) q = q.eq('finding_type', findingType)
  const { data } = await q
  return data || []
}

export async function updateFindingStatus(id, status, profileId) {
  await supabase.from('spend_findings').update({ status, status_changed_by: profileId, status_changed_at: new Date().toISOString() }).eq('id', id)
}

// ────────────────────────────────────────────────────────────
// SECTION 4 — forecast (v1: simple linear projection from current burn pace,
// not a statistical model — swap for something smarter once there's enough
// historical burn data across full project lifecycles to fit one).
// ────────────────────────────────────────────────────────────
export async function getForecast() {
  const settings = await getFinanceSettings()
  const [{ data: projects }, { data: snaps }, { data: budgets }] = await Promise.all([
    supabase.from('projects').select('id,name,start_date,end_date,status').eq('status', 'active'),
    supabase.from('actual_cost_snapshots').select('project_id,total_actual_cost').eq('period_type', 'to_date').eq('period_key', 'ALL'),
    supabase.from('budgets').select('project_id,allocated').not('project_id', 'is', null),
  ])
  const spendMap = Object.fromEntries((snaps || []).map(s => [s.project_id, Number(s.total_actual_cost || 0)]))
  const budgetMap = {}
  ;(budgets || []).forEach(b => { budgetMap[b.project_id] = (budgetMap[b.project_id] || 0) + Number(b.allocated || 0) })

  const today = new Date()
  const rows = (projects || []).filter(p => p.start_date && p.end_date).map(p => {
    const start = new Date(p.start_date), end = new Date(p.end_date)
    const totalDays = Math.max(1, Math.round((end - start) / 86400000))
    const daysElapsed = Math.max(1, Math.min(totalDays, Math.round((today - start) / 86400000)))
    const daysRemaining = Math.max(0, totalDays - daysElapsed)
    const spendToDate = spendMap[p.id] || 0
    const budgetAllocated = budgetMap[p.id] || 0
    const dailyBurnRate = spendToDate / daysElapsed
    const projectedFinalSpend = Math.round((spendToDate + dailyBurnRate * daysRemaining) * 100) / 100
    const spendPct = budgetAllocated > 0 ? Math.round((spendToDate / budgetAllocated) * 100) : 0
    const elapsedPct = Math.round((daysElapsed / totalDays) * 100)
    const paceRatio = elapsedPct > 0 ? spendPct / elapsedPct : (spendPct > 0 ? Infinity : 0)
    const willExceedBudget = spendPct >= settings.burnRateWarningPct && paceRatio > 1
    return { project_id: p.id, name: p.name, spendToDate, budgetAllocated, projectedFinalSpend, spendPct, elapsedPct, willExceedBudget, overBy: Math.round(Math.max(0, projectedFinalSpend - budgetAllocated) * 100) / 100 }
  })

  const companyProjectedTotal = Math.round(rows.reduce((s, r) => s + r.projectedFinalSpend, 0) * 100) / 100
  const atRisk = rows.filter(r => r.willExceedBudget).sort((a, b) => b.overBy - a.overBy).slice(0, 20)
  return { companyProjectedTotal, atRiskCount: atRisk.length, atRisk }
}

// ────────────────────────────────────────────────────────────
// SECTION 5 — benchmarking. "Similar" = same project_type (falls back to same
// department when project_type isn't set) — matches this app's only two
// classification axes now available on `projects` (STEP36).
// ────────────────────────────────────────────────────────────
export async function getBenchmark(projectType) {
  let projQuery = supabase.from('projects').select('id,name,project_type,department_id,budget,spent,start_date,end_date')
  if (projectType) projQuery = projQuery.eq('project_type', projectType)
  const [{ data: allProjects }, { data: margins }] = await Promise.all([
    projQuery,
    supabase.from('profit_margins').select('project_id,margin_percent').eq('period_key', 'ALL'),
  ])
  const marginMap = Object.fromEntries((margins || []).map(m => [m.project_id, m.margin_percent]))
  const today = new Date()
  const rows = (allProjects || []).filter(p => p.project_type).map(p => {
    const pct = p.budget > 0 ? Math.round((p.spent / p.budget) * 100) : 0
    let paceRatio = null
    if (p.start_date && p.end_date) {
      const start = new Date(p.start_date), end = new Date(p.end_date)
      const totalDays = Math.max(1, Math.round((end - start) / 86400000))
      const daysElapsed = Math.max(1, Math.min(totalDays, Math.round((today - start) / 86400000)))
      const elapsedPct = Math.round((daysElapsed / totalDays) * 100)
      paceRatio = elapsedPct > 0 ? Math.round((pct / elapsedPct) * 100) / 100 : null
    }
    return { id: p.id, name: p.name, project_type: p.project_type, budgetUtilPct: pct, burnPaceRatio: paceRatio, marginPct: marginMap[p.id] ?? null }
  })

  const groups = {}
  rows.forEach(r => { (groups[r.project_type] ||= []).push(r) })
  return Object.entries(groups).map(([type, group]) => ({
    project_type: type, projectCount: group.length, projects: group,
    avgBudgetUtilPct: Math.round(group.reduce((s, r) => s + r.budgetUtilPct, 0) / group.length),
    avgMarginPct: (() => { const withMargin = group.filter(r => r.marginPct != null); return withMargin.length ? Math.round(withMargin.reduce((s, r) => s + r.marginPct, 0) / withMargin.length * 100) / 100 : null })(),
  }))
}

// ────────────────────────────────────────────────────────────
// DRILL-DOWNS — one per dimension, wired into SpendAnalyzerPage.jsx's
// click-to-expand row pattern (mirrors CapacityPage.jsx's Bench Report
// employee drill-down). Each pulls together data that already exists
// elsewhere in the app (fundFlow.js, resourceFlow.js, the per-project cost
// tables ProjectsPage.jsx's Full Cost Summary already reads) rather than
// computing anything new.
// ────────────────────────────────────────────────────────────

// A category's actual-side source table, mirrored from recomputeCompanyRollup()
// above — Resource/Change have their own shape (snapshot row / status-gated),
// Hardware/Software/Support share the same {project_id, cost_company} shape.
const CATEGORY_SOURCE_TABLE = {
  Hardware: { table: 'project_hardware_costs', amountCol: 'cost_company' },
  Software: { table: 'project_software_costs', amountCol: 'cost_company' },
  Support: { table: 'project_support_costs', amountCol: 'cost_company' },
}

async function projectNameMapFor(projectIds) {
  if (!projectIds.length) return {}
  const { data } = await supabase.from('projects').select('id,name').in('id', projectIds)
  return Object.fromEntries((data || []).map(p => [p.id, p.name]))
}

export async function getProjectDrilldown(projectId) {
  const [{ data: hw }, { data: sw }, { data: sup }, { data: snap }, fundFlow, resourceAllocations] = await Promise.all([
    supabase.from('project_hardware_costs').select('cost_company').eq('project_id', projectId),
    supabase.from('project_software_costs').select('cost_company').eq('project_id', projectId),
    supabase.from('project_support_costs').select('cost_company').eq('project_id', projectId),
    supabase.from('actual_cost_snapshots').select('people_cost,warranty_cost').eq('project_id', projectId).eq('period_type', 'to_date').eq('period_key', 'ALL').maybeSingle(),
    getFundFlowStages({ projectId }),
    getResourceFlow({ projectId }),
  ])
  const sum = (rows, col) => (rows || []).reduce((s, r) => s + Number(r[col] || 0), 0)
  return {
    categorySplit: [
      { category: 'Resource', amount: snap?.people_cost || 0 },
      { category: 'Hardware', amount: sum(hw, 'cost_company') },
      { category: 'Software', amount: sum(sw, 'cost_company') },
      { category: 'Support', amount: sum(sup, 'cost_company') },
      { category: 'Warranty', amount: snap?.warranty_cost || 0 },
    ],
    fundFlow,
    resourceAllocations,
  }
}

export async function getVendorDrilldown(vendorId) {
  return getVendorFundFlow(vendorId)
}

export async function getProductDrilldown(partNumber) {
  return getProductFundFlow(partNumber)
}

export async function getCategoryDrilldown(category) {
  const rollup = await getCompanyRollup()
  const byDepartment = rollup.filter(r => r.category === category).sort((a, b) => b.actual_amount - a.actual_amount).slice(0, 10)

  let byProject = []
  const src = CATEGORY_SOURCE_TABLE[category]
  if (src) {
    const { data } = await supabase.from(src.table).select(`project_id,${src.amountCol}`)
    const totals = {}
    ;(data || []).forEach(r => { totals[r.project_id] = (totals[r.project_id] || 0) + Number(r[src.amountCol] || 0) })
    const nameMap = await projectNameMapFor(Object.keys(totals))
    byProject = Object.entries(totals).map(([id, amount]) => ({ project_id: id, name: nameMap[id] || 'Unknown', amount: Math.round(amount * 100) / 100 }))
  } else if (category === 'Change') {
    const { data } = await supabase.from('change_requests').select('project_id,actual_cost,estimated_cost,status')
    const totals = {}
    ;(data || []).filter(r => ['approved', 'implemented'].includes(r.status)).forEach(r => {
      const amt = Number(r.actual_cost || 0) > 0 ? r.actual_cost : Number(r.estimated_cost || 0)
      totals[r.project_id] = (totals[r.project_id] || 0) + amt
    })
    const nameMap = await projectNameMapFor(Object.keys(totals))
    byProject = Object.entries(totals).map(([id, amount]) => ({ project_id: id, name: nameMap[id] || 'Unknown', amount: Math.round(amount * 100) / 100 }))
  }
  byProject.sort((a, b) => b.amount - a.amount)
  return { byDepartment, byProject: byProject.slice(0, 10) }
}

export async function getDepartmentDrilldown(departmentId) {
  const [{ data: projects }, resourceRows] = await Promise.all([
    supabase.from('projects').select('id,name,budget,spent,status').eq('department_id', departmentId),
    getResourceFlow({ departmentId }),
  ])
  const rollup = (await getCompanyRollup()).filter(r => r.department_id === departmentId)
  return {
    projects: (projects || []).map(p => ({ ...p, health: projectHealth(p.spent, p.budget) })).sort((a, b) => b.spent - a.spent),
    categoryMix: rollup.map(r => ({ category: r.category, planned: r.planned_amount, actual: r.actual_amount })),
    resourceSummary: getResourceFlowSummary(resourceRows),
  }
}
