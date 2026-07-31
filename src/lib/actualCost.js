import { supabase } from './supabase'
import { computeWarrantyCostForProject } from './warrantyCost'

async function getFinanceSettings() {
  const { data } = await supabase.from('finance_settings').select('*').maybeSingle()
  return {
    burnRateWarningPct: data?.burn_rate_warning_pct ?? 80,
    matchTolerancePct: data?.match_variance_tolerance_pct ?? 5,
    agingBucketDays: data?.aging_bucket_days ?? [30, 60, 90],
  }
}

// People cost: allocation_hours_per_week amortized across the overlap window
// (hours/week ÷ 7 × calendar days overlapping), priced at the role_rates rate
// for that designation at the overlap's start date, falling back to the
// existing per-employee resource_rates formula when no role_rates entry exists
// — preserving every existing call site's behavior for un-rated designations.
export async function computePeopleCostForProject(projectId, periodStart, periodEnd) {
  const { data: allocs } = await supabase.from('allocations')
    .select('*,employee:profiles!employee_id(designation)')
    .eq('project_id', projectId).in('status', ['approved', 'active'])
  const rows = allocs || []
  if (rows.length === 0) return 0

  const designations = [...new Set(rows.map(a => a.employee?.designation).filter(Boolean))]
  const employeeIds = [...new Set(rows.map(a => a.employee_id))]
  const [{ data: roleRates }, { data: empRates }] = await Promise.all([
    designations.length ? supabase.from('role_rates').select('*').in('designation', designations) : Promise.resolve({ data: [] }),
    supabase.from('resource_rates').select('employee_id,hourly_rate,monthly_salary').in('employee_id', employeeIds),
  ])
  const empRateMap = Object.fromEntries((empRates || []).map(r => [r.employee_id, r]))

  function rateOnDate(designation, employeeId, onDate) {
    const iso = onDate.toISOString().slice(0, 10)
    const candidates = (roleRates || []).filter(r => r.designation === designation && r.effective_from <= iso && (!r.effective_to || r.effective_to >= iso))
    const match = candidates.sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]
    if (match) return Number(match.hourly_rate)
    const er = empRateMap[employeeId]
    return Number(er?.hourly_rate || (er?.monthly_salary ? er.monthly_salary / (22 * 8) : 0))
  }

  let total = 0
  for (const a of rows) {
    const aStart = new Date(a.start_date)
    const aEnd = a.end_date ? new Date(a.end_date) : periodEnd
    const overlapStart = aStart > periodStart ? aStart : periodStart
    const overlapEnd = aEnd < periodEnd ? aEnd : periodEnd
    if (overlapEnd < overlapStart) continue
    const days = Math.round((overlapEnd - overlapStart) / 86400000) + 1
    const hourlyRate = rateOnDate(a.employee?.designation, a.employee_id, overlapStart)
    total += (Number(a.allocation_hours_per_week || 0) / 7) * days * hourlyRate
  }
  return Math.round(total * 100) / 100
}

// Hardware cost: recognized vendor spend (verified/matched/paid invoices) — NOT
// PO/GRN committed spend, which already lives in budgets.committed_amount via
// src/lib/budgetSync.js on PR approval. Mixing the two would double-count.
export async function computeHardwareCostForProject(projectId, periodStart, periodEnd) {
  const startISO = periodStart.toISOString().slice(0, 10)
  const endISO = periodEnd.toISOString().slice(0, 10)
  const { data } = await supabase.from('invoices').select('total_amount,invoice_date,status')
    .eq('project_id', projectId).in('status', ['verified', 'matched', 'paid'])
    .gte('invoice_date', startISO).lte('invoice_date', endISO)
  return Math.round((data || []).reduce((s, i) => s + Number(i.total_amount || 0), 0) * 100) / 100
}

async function upsertSnapshot(projectId, periodType, periodKey, peopleCost, hardwareCost, warrantyCost) {
  await supabase.from('actual_cost_snapshots').upsert({
    project_id: projectId, period_type: periodType, period_key: periodKey,
    people_cost: peopleCost, hardware_cost: hardwareCost, warranty_cost: warrantyCost,
    total_actual_cost: Math.round((peopleCost + hardwareCost + warrantyCost) * 100) / 100,
    computed_at: new Date().toISOString(),
  }, { onConflict: 'project_id,period_type,period_key' })
}

// Computes the current month's snapshot and a lifetime 'to_date' rollup.
export async function recomputeForProject(projectId) {
  const { data: proj } = await supabase.from('projects').select('start_date,end_date').eq('id', projectId).maybeSingle()
  const today = new Date()

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0)
  const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const [monthPeople, monthHw, monthWty] = await Promise.all([
    computePeopleCostForProject(projectId, monthStart, monthEnd),
    computeHardwareCostForProject(projectId, monthStart, monthEnd),
    computeWarrantyCostForProject(projectId, monthStart, monthEnd).then(w => w.totalWarrantyCost),
  ])
  await upsertSnapshot(projectId, 'month', monthKey, monthPeople, monthHw, monthWty)

  const lifeStart = proj?.start_date ? new Date(proj.start_date) : monthStart
  const [allPeople, allHw, allWty] = await Promise.all([
    computePeopleCostForProject(projectId, lifeStart, today),
    computeHardwareCostForProject(projectId, lifeStart, today),
    computeWarrantyCostForProject(projectId, lifeStart, today).then(w => w.totalWarrantyCost),
  ])
  await upsertSnapshot(projectId, 'to_date', 'ALL', allPeople, allHw, allWty)
}

export async function getActualCostSnapshot(projectId) {
  const { data } = await supabase.from('actual_cost_snapshots').select('*')
    .eq('project_id', projectId).eq('period_type', 'to_date').eq('period_key', 'ALL').maybeSingle()
  return data
}

// Burn rate: spend pace vs. time elapsed, with a simple linear exhaustion projection.
// willExceedBudget and willExceedTimeline are reported separately — they're
// different risks (spending too much of the budget vs. running out before the
// project is scheduled to finish).
export async function getBurnRate(projectId) {
  const [snap, { data: proj }, { data: budgets }, settings] = await Promise.all([
    getActualCostSnapshot(projectId),
    supabase.from('projects').select('start_date,end_date').eq('id', projectId).maybeSingle(),
    supabase.from('budgets').select('allocated').eq('project_id', projectId),
    getFinanceSettings(),
  ])
  const spendToDate = snap?.total_actual_cost || 0
  const budgetAllocated = (budgets || []).reduce((s, b) => s + Number(b.allocated || 0), 0)
  const spendPct = budgetAllocated > 0 ? Math.round((spendToDate / budgetAllocated) * 100) : 0

  if (!proj?.start_date || !proj?.end_date) {
    return { spendToDate, budgetAllocated, spendPct, elapsedPct: null, dailyBurnRate: 0, projectedExhaustionDate: null, willExceedBudget: false, willExceedTimeline: false }
  }

  const start = new Date(proj.start_date), end = new Date(proj.end_date), today = new Date()
  const totalDays = Math.max(1, Math.round((end - start) / 86400000))
  const daysElapsed = Math.max(1, Math.min(totalDays, Math.round((today - start) / 86400000)))
  const elapsedPct = Math.round((daysElapsed / totalDays) * 100)
  const dailyBurnRate = spendToDate / daysElapsed
  const remainingBudget = Math.max(0, budgetAllocated - spendToDate)
  const projectedExhaustionDate = dailyBurnRate > 0 ? new Date(today.getTime() + (remainingBudget / dailyBurnRate) * 86400000) : null

  const paceRatio = elapsedPct > 0 ? spendPct / elapsedPct : (spendPct > 0 ? Infinity : 0)
  const willExceedBudget = spendPct >= settings.burnRateWarningPct && paceRatio > 1
  const willExceedTimeline = !!projectedExhaustionDate && projectedExhaustionDate < end

  return { spendToDate, budgetAllocated, spendPct, elapsedPct, dailyBurnRate: Math.round(dailyBurnRate * 100) / 100, projectedExhaustionDate, willExceedBudget, willExceedTimeline }
}

// Lightweight, bulk-query version of getBurnRate for a dashboard watchlist —
// avoids N separate round-trips per project (unlike calling getBurnRate in a loop).
export async function listBurnRateWatchlist(limit = 5) {
  const settings = await getFinanceSettings()
  const [{ data: projects }, { data: snaps }, { data: budgets }] = await Promise.all([
    supabase.from('projects').select('id,name,start_date,end_date').eq('status', 'active'),
    supabase.from('actual_cost_snapshots').select('project_id,total_actual_cost').eq('period_type', 'to_date').eq('period_key', 'ALL'),
    supabase.from('budgets').select('project_id,allocated').not('project_id', 'is', null),
  ])
  const spendMap = Object.fromEntries((snaps || []).map(s => [s.project_id, s.total_actual_cost]))
  const budgetMap = {}
  ;(budgets || []).forEach(b => { budgetMap[b.project_id] = (budgetMap[b.project_id] || 0) + Number(b.allocated || 0) })

  const today = new Date()
  const rows = (projects || []).filter(p => p.start_date && p.end_date).map(p => {
    const start = new Date(p.start_date), end = new Date(p.end_date)
    const totalDays = Math.max(1, Math.round((end - start) / 86400000))
    const daysElapsed = Math.max(1, Math.min(totalDays, Math.round((today - start) / 86400000)))
    const elapsedPct = Math.round((daysElapsed / totalDays) * 100)
    const budgetAllocated = budgetMap[p.id] || 0
    const spendToDate = spendMap[p.id] || 0
    const spendPct = budgetAllocated > 0 ? Math.round((spendToDate / budgetAllocated) * 100) : 0
    const paceRatio = elapsedPct > 0 ? spendPct / elapsedPct : (spendPct > 0 ? Infinity : 0)
    const willExceedBudget = spendPct >= settings.burnRateWarningPct && paceRatio > 1
    return { project_id: p.id, name: p.name, elapsedPct, spendPct, willExceedBudget, paceRatio }
  }).filter(r => r.willExceedBudget)
    .sort((a, b) => b.paceRatio - a.paceRatio)
    .slice(0, limit)

  return rows
}

export { getFinanceSettings }
