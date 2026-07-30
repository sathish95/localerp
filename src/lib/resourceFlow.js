import { supabase } from './supabase'

/**
 * RESOURCE FLOW — joins allocation/utilization (capacity.js, hours-only)
 * with people cost (actualCost.js, ₹-only) at the per-employee level, which
 * neither module exposes today: actualCost.js's computePeopleCostForProject
 * sums cost across every allocation and discards the per-employee/per-
 * designation breakdown; capacity.js never touches rates or cost at all.
 * No new schema — reads allocations, profiles, role_rates, resource_rates,
 * capacity_snapshots, projects, same tables those two modules already read.
 */

// Mirrors actualCost.js's rateOnDate (role_rates by designation, falling
// back to resource_rates per-employee) but simplified to "current rate"
// rather than "rate as of a given date", since this is a live cross-project
// snapshot, not a historical per-period cost computation.
function currentRateFor(designation, employeeId, roleRates, empRateMap) {
  const todayISO = new Date().toISOString().slice(0, 10)
  const candidates = (roleRates || []).filter(r => r.designation === designation && r.effective_from <= todayISO && (!r.effective_to || r.effective_to >= todayISO))
  const match = candidates.sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]
  if (match) return Number(match.hourly_rate)
  const er = empRateMap[employeeId]
  return Number(er?.hourly_rate || (er?.monthly_salary ? er.monthly_salary / (22 * 8) : 0))
}

// Per-employee rows: allocated hours, latest utilization%, resolved hourly
// rate, computed weekly cost, and which projects that cost splits across.
export async function getResourceFlow({ departmentId, projectId } = {}) {
  let allocQ = supabase.from('allocations').select('employee_id,project_id,allocation_hours_per_week,role_on_project,employee:profiles!employee_id(id,full_name,designation,department_id)').in('status', ['approved', 'active'])
  if (projectId) allocQ = allocQ.eq('project_id', projectId)
  const { data: allocs } = await allocQ
  let rows = allocs || []
  if (departmentId) rows = rows.filter(a => a.employee?.department_id === departmentId)
  if (!rows.length) return []

  const employeeIds = [...new Set(rows.map(a => a.employee_id))]
  const designations = [...new Set(rows.map(a => a.employee?.designation).filter(Boolean))]
  const projectIds = [...new Set(rows.map(a => a.project_id).filter(Boolean))]

  const [{ data: roleRates }, { data: empRates }, { data: snaps }, { data: projects }] = await Promise.all([
    designations.length ? supabase.from('role_rates').select('*').in('designation', designations) : Promise.resolve({ data: [] }),
    supabase.from('resource_rates').select('employee_id,hourly_rate,monthly_salary').in('employee_id', employeeIds),
    supabase.from('capacity_snapshots').select('employee_id,week_start_date,utilization_percent').in('employee_id', employeeIds).order('week_start_date', { ascending: false }),
    projectIds.length ? supabase.from('projects').select('id,name').in('id', projectIds) : Promise.resolve({ data: [] }),
  ])
  const empRateMap = Object.fromEntries((empRates || []).map(r => [r.employee_id, r]))
  const projectNameMap = Object.fromEntries((projects || []).map(p => [p.id, p.name]))
  const latestUtilByEmployee = {}
  ;(snaps || []).forEach(s => { if (latestUtilByEmployee[s.employee_id] === undefined) latestUtilByEmployee[s.employee_id] = s.utilization_percent })

  const byEmployee = {}
  rows.forEach(a => {
    const empId = a.employee_id
    if (!byEmployee[empId]) {
      byEmployee[empId] = {
        employeeId: empId, name: a.employee?.full_name || 'Unknown', designation: a.employee?.designation || '—',
        departmentId: a.employee?.department_id || null, allocatedHoursPerWeek: 0,
        utilizationPercent: latestUtilByEmployee[empId] ?? null,
        hourlyRate: currentRateFor(a.employee?.designation, empId, roleRates, empRateMap),
        computedWeeklyCost: 0, projectBreakdown: [],
      }
    }
    const emp = byEmployee[empId]
    const hrs = Number(a.allocation_hours_per_week || 0)
    const cost = Math.round(hrs * emp.hourlyRate * 100) / 100
    emp.allocatedHoursPerWeek = Math.round((emp.allocatedHoursPerWeek + hrs) * 100) / 100
    emp.computedWeeklyCost = Math.round((emp.computedWeeklyCost + cost) * 100) / 100
    emp.projectBreakdown.push({ projectId: a.project_id, projectName: projectNameMap[a.project_id] || 'Unassigned', roleOnProject: a.role_on_project, hours: hrs, cost })
  })

  return Object.values(byEmployee).sort((a, b) => b.computedWeeklyCost - a.computedWeeklyCost)
}

// Client-side rollups for the Resource Flow tab's charts/KPIs — same
// group-and-reduce pattern as spendAnalyzer.js's getSpendByDepartment.
export function getResourceFlowSummary(rows) {
  const byDesignation = {}, byDepartment = {}
  rows.forEach(r => {
    if (!byDesignation[r.designation]) byDesignation[r.designation] = { designation: r.designation, hours: 0, cost: 0, headcount: 0 }
    byDesignation[r.designation].hours += r.allocatedHoursPerWeek
    byDesignation[r.designation].cost += r.computedWeeklyCost
    byDesignation[r.designation].headcount += 1

    const deptKey = r.departmentId || '__unassigned__'
    if (!byDepartment[deptKey]) byDepartment[deptKey] = { departmentId: r.departmentId, hours: 0, cost: 0, headcount: 0 }
    byDepartment[deptKey].hours += r.allocatedHoursPerWeek
    byDepartment[deptKey].cost += r.computedWeeklyCost
    byDepartment[deptKey].headcount += 1
  })

  const withUtil = rows.filter(r => r.utilizationPercent != null)
  return {
    byDesignation: Object.values(byDesignation).sort((a, b) => b.cost - a.cost),
    byDepartment: Object.values(byDepartment).sort((a, b) => b.cost - a.cost),
    totalHours: Math.round(rows.reduce((s, r) => s + r.allocatedHoursPerWeek, 0) * 100) / 100,
    totalWeeklyCost: Math.round(rows.reduce((s, r) => s + r.computedWeeklyCost, 0) * 100) / 100,
    headcount: rows.length,
    avgUtilizationPercent: withUtil.length ? Math.round(withUtil.reduce((s, r) => s + Number(r.utilizationPercent), 0) / withUtil.length) : null,
  }
}
