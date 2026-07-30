import { supabase } from './supabase'

// Warranty analytics — claim rate / cost-per-claim / time-to-failure /
// profit impact. Materialized into warranty_analytics_rollup like
// company_spend_rollup (spendAnalyzer.js), recomputed manually via a
// "Recompute Now" button — no cron/serverless layer in this stack.
//
// Note: replaceFindings() below is a small local duplicate of
// spendAnalyzer.js's identically-named helper (not imported from there) so
// that spendAnalyzer.js can safely import generateWarrantyFindings() from
// this file without creating a circular module dependency.

const CHUNK = 500
const OVERRUN_FINDING_PCT = 15 // matches spendAnalyzer.js's own RecurringOverrun threshold

async function upsertRollupRows(rows) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await supabase.from('warranty_analytics_rollup').upsert(rows.slice(i, i + CHUNK), { onConflict: 'period_key,part_number,issue_type' })
  }
}

async function replaceFindings(findingType, rows) {
  await supabase.from('spend_findings').delete().eq('finding_type', findingType).eq('status', 'new')
  if (rows.length) await supabase.from('spend_findings').insert(rows)
}

// ────────────────────────────────────────────────────────────
// RECOMPUTE — one row per part_number x issue_type, plus an 'ALL'/'ALL'
// company-wide row, all at period_key='ALL' (lifetime-to-date, matching
// this app's dominant recompute-on-demand convention).
// ────────────────────────────────────────────────────────────
export async function recomputeWarrantyAnalyticsRollup() {
  const [{ data: devices }, { data: warranties }, { data: claims }, { data: costEntries }, { data: budgets }] = await Promise.all([
    supabase.from('device_instances').select('id,part_number,status'),
    supabase.from('device_warranties').select('id,device_id,deployment_date'),
    supabase.from('warranty_claims').select('id,device_id,device_warranty_id,claim_date,issue_type,status'),
    supabase.from('warranty_cost_entries').select('warranty_claim_id,cost_type,amount'),
    supabase.from('warranty_budgets').select('part_number,planned_warranty_reserve').eq('scope_type', 'product_type'),
  ])

  const partByDevice = Object.fromEntries((devices || []).map(d => [d.id, d.part_number || 'Unassigned']))
  const deploymentByWarranty = Object.fromEntries((warranties || []).map(w => [w.id, w.deployment_date]))
  const deployedCountByPart = {}
  ;(devices || []).filter(d => ['deployed', 'faulty', 'replaced'].includes(d.status)).forEach(d => {
    const part = d.part_number || 'Unassigned'
    deployedCountByPart[part] = (deployedCountByPart[part] || 0) + 1
  })

  const costByClaimHw = {}, costByClaimSw = {}
  ;(costEntries || []).forEach(e => {
    const bucket = e.cost_type === 'Hardware' ? costByClaimHw : costByClaimSw
    bucket[e.warranty_claim_id] = (bucket[e.warranty_claim_id] || 0) + Number(e.amount || 0)
  })

  const plannedByPart = {}
  ;(budgets || []).forEach(b => { plannedByPart[b.part_number] = (plannedByPart[b.part_number] || 0) + Number(b.planned_warranty_reserve || 0) })

  // cell key = `${part}::${issueType}` — issueType 'ALL' aggregates every issue type for that part
  const cell = {}
  function bump(part, issueType, claim) {
    const key = `${part}::${issueType}`
    if (!cell[key]) cell[key] = { part, issueType, claimIds: new Set(), hardwareCost: 0, softwareCost: 0, ttfDaysSum: 0, ttfCount: 0 }
    const c = cell[key]
    if (!c.claimIds.has(claim.id)) {
      c.claimIds.add(claim.id)
      c.hardwareCost += costByClaimHw[claim.id] || 0
      c.softwareCost += costByClaimSw[claim.id] || 0
      const depDate = deploymentByWarranty[claim.device_warranty_id]
      if (depDate && claim.claim_date) {
        const days = Math.round((new Date(claim.claim_date) - new Date(depDate)) / 86400000)
        if (days >= 0) { c.ttfDaysSum += days; c.ttfCount += 1 }
      }
    }
  }

  ;(claims || []).forEach(claim => {
    const part = partByDevice[claim.device_id] || 'Unassigned'
    bump(part, claim.issue_type || 'Other', claim)
    bump(part, 'ALL', claim)
    bump('ALL', 'ALL', claim)
  })

  const rows = Object.values(cell).map(c => {
    const claimsCount = c.claimIds.size
    const unitsDeployed = c.part === 'ALL'
      ? Object.values(deployedCountByPart).reduce((s, n) => s + n, 0)
      : (deployedCountByPart[c.part] || 0)
    const actualCostTotal = Math.round((c.hardwareCost + c.softwareCost) * 100) / 100
    const plannedReserveTotal = c.part === 'ALL'
      ? Object.values(plannedByPart).reduce((s, n) => s + n, 0)
      : (plannedByPart[c.part] || 0)
    return {
      period_key: 'ALL', part_number: c.part, issue_type: c.issueType,
      units_deployed: unitsDeployed, claims_count: claimsCount,
      claim_rate_per_100: unitsDeployed > 0 ? Math.round((claimsCount / unitsDeployed) * 10000) / 100 : 0,
      avg_cost_per_claim: claimsCount > 0 ? Math.round((actualCostTotal / claimsCount) * 100) / 100 : 0,
      avg_time_to_failure_days: c.ttfCount > 0 ? Math.round((c.ttfDaysSum / c.ttfCount) * 100) / 100 : 0,
      hardware_cost_total: Math.round(c.hardwareCost * 100) / 100,
      software_cost_total: Math.round(c.softwareCost * 100) / 100,
      planned_reserve_total: Math.round(plannedReserveTotal * 100) / 100,
      actual_cost_total: actualCostTotal,
      variance_amount: Math.round((actualCostTotal - plannedReserveTotal) * 100) / 100,
      computed_at: new Date().toISOString(),
    }
  })

  if (rows.length) await upsertRollupRows(rows)
  return rows
}

export async function getWarrantyAnalyticsRollup() {
  const { data } = await supabase.from('warranty_analytics_rollup').select('*').eq('period_key', 'ALL')
  return data || []
}

// ────────────────────────────────────────────────────────────
// FINDINGS — RecurringWarrantyOverrun: product types where actual warranty
// spend is running materially over the planned reserve, same shape/pattern
// as spendAnalyzer.js's other findings.
// ────────────────────────────────────────────────────────────
export async function generateWarrantyFindings() {
  const rollup = await getWarrantyAnalyticsRollup()
  const rows = rollup.filter(r => r.part_number !== 'ALL' && r.issue_type === 'ALL' && r.planned_reserve_total > 0
    && r.actual_cost_total > 0 && ((r.variance_amount / r.planned_reserve_total) * 100) > OVERRUN_FINDING_PCT)
    .sort((a, b) => b.variance_amount - a.variance_amount).slice(0, 10)
    .map(r => {
      const pct = Math.round((r.variance_amount / r.planned_reserve_total) * 100)
      return {
        finding_type: 'RecurringWarrantyOverrun',
        title: `${r.part_number} warranty spend running ${pct}% over reserve`,
        description: `${r.part_number} has ${r.claims_count} claim(s) totaling ${rupeeStr(r.actual_cost_total)} against a planned reserve of ${rupeeStr(r.planned_reserve_total)} (${pct}% over) — a claim rate of ${r.claim_rate_per_100}% suggests reviewing product quality or revising the reserve for this product type.`,
        impact_amount: r.variance_amount, related_project_ids: [], related_department_ids: [],
      }
    })
  await replaceFindings('RecurringWarrantyOverrun', rows)
  return rows
}

function rupeeStr(n) { return '₹' + Math.round(Number(n || 0)).toLocaleString('en-IN') }

// ────────────────────────────────────────────────────────────
// PROFIT IMPACT — Revenue − UnitCost − WarrantyCost, shown alongside the
// pre-warranty number so the erosion from warranty risk is visible.
// ────────────────────────────────────────────────────────────
export async function computeProfitImpact({ partNumber, periodKey = 'ALL' } = {}) {
  const [{ data: rollupRow }, { data: devices }] = await Promise.all([
    supabase.from('warranty_analytics_rollup').select('*').eq('period_key', periodKey).eq('part_number', partNumber).eq('issue_type', 'ALL').maybeSingle(),
    supabase.from('device_instances').select('id,project_id').eq('part_number', partNumber),
  ])
  const { data: product } = await supabase.from('products').select('standard_cost').eq('part_number', partNumber).maybeSingle()
  const unitCost = Number(product?.standard_cost || 0)
  const unitsDeployed = rollupRow?.units_deployed || 0
  const warrantyCost = rollupRow?.actual_cost_total || 0

  // Revenue isn't tracked per-product elsewhere in this app (customer_invoices
  // is project-scoped, not product-scoped) — approximate using unit cost x
  // units as the cost baseline and surface warranty cost as a direct
  // deduction against that, which is the comparison the spec actually asks
  // for ("before vs after warranty cost"), not a full P&L reconstruction.
  const totalUnitCost = Math.round(unitCost * unitsDeployed * 100) / 100
  return {
    partNumber, unitsDeployed, unitCost, totalUnitCost, warrantyCost,
    profitErosionPct: totalUnitCost > 0 ? Math.round((warrantyCost / totalUnitCost) * 10000) / 100 : 0,
  }
}
