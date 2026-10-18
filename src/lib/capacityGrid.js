import { supabase } from './supabase'
import { resolveHourlyRate } from './actualCost'
import { countWorkingDays } from './capacity'

// Days ⇄ hours convention used everywhere in this grid (matches the
// existing 22-working-days × 8-hours assumption baked into
// actualCost.js's resolveHourlyRate monthly_salary fallback).
export const HOURS_PER_DAY = 8

export async function getWorkingDays(year, month) {
  const { data } = await supabase.from('capacity_working_days').select('working_days').eq('year', year).eq('month', month).maybeSingle()
  return data ? Number(data.working_days) : 22
}

export async function saveWorkingDays(year, month, workingDays, userId) {
  await supabase.from('capacity_working_days').upsert({
    year, month, working_days: workingDays, updated_by: userId, updated_at: new Date().toISOString(),
  }, { onConflict: 'year,month' })
}

// Keyed by employee_id -> { leave_taken, available_days }
export async function getEmployeeDaysMap(year, month) {
  const { data } = await supabase.from('capacity_employee_days').select('*').eq('year', year).eq('month', month)
  return Object.fromEntries((data || []).map(r => [r.employee_id, r]))
}

export async function saveEmployeeDays(employeeId, year, month, { leaveTaken, availableDays }, userId) {
  await supabase.from('capacity_employee_days').upsert({
    employee_id: employeeId, year, month, leave_taken: leaveTaken, available_days: availableDays,
    updated_by: userId, updated_at: new Date().toISOString(),
  }, { onConflict: 'employee_id,year,month' })
}

// Best-effort starting value for Leave Taken, from approved leave already on
// record — only used to seed the grid the FIRST time a month is opened for an
// employee (see CapacityPage.jsx); once a row exists in capacity_employee_days
// this is never consulted again, so a manual edit always sticks.
export async function suggestLeaveTaken(employeeId, year, month) {
  const monthStart = new Date(year, month - 1, 1)
  const monthEnd = new Date(year, month, 0)
  const startISO = monthStart.toISOString().slice(0, 10)
  const endISO = monthEnd.toISOString().slice(0, 10)
  const [{ data: reqs }, { data: holidays }] = await Promise.all([
    supabase.from('leave_requests').select('from_date,to_date,leave_type,status')
      .eq('employee_id', employeeId).eq('status', 'approved').neq('leave_type', 'permission')
      .not('from_date', 'is', null).lte('from_date', endISO).gte('to_date', startISO),
    supabase.from('holidays').select('holiday_date').gte('holiday_date', startISO).lte('holiday_date', endISO),
  ])
  const holidaysSet = new Set((holidays || []).map(h => h.holiday_date))
  let days = 0
  for (const r of reqs || []) {
    const from = new Date(r.from_date) < monthStart ? monthStart : new Date(r.from_date)
    const to = new Date(r.to_date) > monthEnd ? monthEnd : new Date(r.to_date)
    days += countWorkingDays(from, to, holidaysSet)
  }
  return days
}

// Keyed by `${employee_id}:${project_id}` -> { id, days }
export async function getProjectAllocDaysMap(year, month, employeeIds) {
  if (!employeeIds.length) return {}
  const { data } = await supabase.from('project_resource_alloc').select('id,employee_id,project_id,allocated_hours')
    .eq('year', year).eq('month', month).in('employee_id', employeeIds)
  const map = {}
  for (const r of data || []) {
    map[`${r.employee_id}:${r.project_id}`] = { id: r.id, days: Number(r.allocated_hours || 0) / HOURS_PER_DAY }
  }
  return map
}

// `existingRowId` comes from getProjectAllocDaysMap — pass null the first time
// a cell goes from empty to a value. Zeroing a cell out deletes the row rather
// than leaving a 0-hour row behind, so it drops back out of the auto-filled set.
// `note` is only ever passed for an over-allocation override (see
// CapacityPage.jsx's override modal) — stored in project_resource_alloc's own
// `notes` column, the same one ProjectsPage.jsx's Resourcing tab already
// edits, so the justification is visible from either screen.
export async function saveProjectAllocDays({ existingRowId, employeeId, projectId, year, month, days, userId, note }) {
  const hours = Math.max(0, Number(days) || 0) * HOURS_PER_DAY
  if (hours <= 0) {
    if (existingRowId) await supabase.from('project_resource_alloc').delete().eq('id', existingRowId)
    return null
  }
  if (existingRowId) {
    const patch = { allocated_hours: hours }
    if (note) patch.notes = note
    await supabase.from('project_resource_alloc').update(patch).eq('id', existingRowId)
    return existingRowId
  }
  const { data } = await supabase.from('project_resource_alloc').insert({
    employee_id: employeeId, project_id: projectId, year, month, allocated_hours: hours, created_by: userId,
    ...(note ? { notes: note } : {}),
  }).select('id').single()
  return data?.id || null
}

export async function getRatesData(employeeIds, designations) {
  const [{ data: roleRates }, { data: resourceRates }] = await Promise.all([
    designations.length ? supabase.from('role_rates').select('*').in('designation', designations) : Promise.resolve({ data: [] }),
    employeeIds.length ? supabase.from('resource_rates').select('employee_id,hourly_rate,monthly_salary').in('employee_id', employeeIds) : Promise.resolve({ data: [] }),
  ])
  return { roleRates: roleRates || [], resourceRates: resourceRates || [] }
}

export function dailyRateFor(employee, roleRates, resourceRates) {
  return resolveHourlyRate({ designation: employee?.designation, employeeId: employee?.id, roleRates, resourceRates }) * HOURS_PER_DAY
}

// Project budgets (from the SAME `budgets` table actualCost.js's burn-rate
// view reads) — used to show a PMO-level "% of budget used this month" on
// the Allocation Chart's Project Summary, without introducing a second,
// competing notion of "project budget".
export async function getBudgetsByProject(projectIds) {
  if (!projectIds.length) return {}
  const { data } = await supabase.from('budgets').select('project_id,allocated').in('project_id', projectIds)
  const map = {}
  for (const b of data || []) map[b.project_id] = (map[b.project_id] || 0) + Number(b.allocated || 0)
  return map
}
