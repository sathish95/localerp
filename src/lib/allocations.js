import { supabase } from './supabase'
import { sendNotif } from './notifications'

// Shared between AllocationsPage.jsx (the dedicated request/approve flow)
// and ProjectsPage.jsx's Resourcing tab (create/edit an allocation without
// leaving the project) — both need the exact same overlap-conflict check
// and insert/notify shape, or they'd silently drift on what counts as
// "over-allocated." Creating from either place still goes through the
// same approval workflow (status starts 'requested') — a project owner
// never gets to skip the review a request from the Allocations page goes
// through just because they started it from a different screen.

export async function checkAllocationConflict(employeeId, newPercent, start, end, excludeId) {
  if (!employeeId || !start || !newPercent) return null
  const { data } = await supabase.from('allocations')
    .select('*,project:projects(name)')
    .eq('employee_id', employeeId).in('status', ['requested', 'approved', 'active'])
  const rows = (data || []).filter(a => a.id !== excludeId)
  const reqStart = new Date(start).getTime()
  const reqEnd = end ? new Date(end).getTime() : new Date('9999-12-31').getTime()
  const overlapping = rows.filter(a => {
    const exStart = new Date(a.start_date).getTime()
    const exEnd = a.end_date ? new Date(a.end_date).getTime() : new Date('9999-12-31').getTime()
    return exStart <= reqEnd && exEnd >= reqStart
  })
  const committedPct = overlapping.reduce((s, a) => s + Number(a.allocation_percent || 0), 0)
  const projectedTotal = committedPct + Number(newPercent || 0)
  if (projectedTotal > 100) return { overlapping, committedPct, projectedTotal }
  return null
}

export function computeAllocationHoursPerWeek(percent, weeklyCapacity) {
  return Math.round((Number(percent) / 100) * Number(weeklyCapacity || 40) * 100) / 100
}

export async function submitAllocationRequest({ employeeId, projectId, percent, roleOnProject, startDate, endDate, requestedBy, weeklyCapacity, conflict, overrideJustification, reportingManagerId, projectName, employeeName }) {
  const hours = computeAllocationHoursPerWeek(percent, weeklyCapacity)
  const { data, error } = await supabase.from('allocations').insert({
    employee_id: employeeId, project_id: projectId,
    allocation_percent: percent, allocation_hours_per_week: hours,
    role_on_project: roleOnProject || null,
    start_date: startDate, end_date: endDate || null,
    requested_by: requestedBy,
    override_flag: !!conflict, override_justification: conflict ? overrideJustification : null,
  }).select().single()
  if (error) throw error
  if (reportingManagerId) {
    const who = employeeName ? `${employeeName} → ` : '→ '
    sendNotif(reportingManagerId, { type: 'allocation_request', title: '📋 New allocation request', body: `${who}${projectName || 'project'} (${percent}%)`, link: '/allocations', senderId: requestedBy })
  }
  return data
}

// Direct edit of an existing allocation's own fields (%, role, dates) by
// someone with edit rights — an administrative correction, not a new
// request, so it never touches `status` or re-triggers approval; the
// allocation already went through that once.
export async function updateAllocation(id, { percent, roleOnProject, startDate, endDate, weeklyCapacity }) {
  const patch = {
    allocation_percent: percent,
    allocation_hours_per_week: computeAllocationHoursPerWeek(percent, weeklyCapacity),
    role_on_project: roleOnProject || null,
    start_date: startDate, end_date: endDate || null,
  }
  const { error } = await supabase.from('allocations').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteAllocation(id) {
  const { error } = await supabase.from('allocations').delete().eq('id', id)
  if (error) throw error
}

// How much capacity this employee has left, company-wide, across BOTH
// allocation systems (see ProjectsPage.jsx's Resourcing tab for the same
// definition — kept identical here so the number shown while REQUESTING a
// new allocation always matches what "Still Available" shows afterward;
// two slightly different availability numbers in different parts of the
// app would be worse than one, even if approximate). Only counts
// approved/active (not 'requested') — matches "Still Available" exactly.
// `excludeAllocationId` lets an edit-in-place exclude its OWN current row,
// so editing an allocation doesn't count it against itself.
export async function getRemainingCapacityPct(employeeId, excludeAllocationId) {
  if (!employeeId) return 100
  const now = new Date()
  const month = now.getMonth() + 1, year = now.getFullYear()
  const [{ data: allocs }, { data: emp }, { data: legacy }, { data: capDays }] = await Promise.all([
    supabase.from('allocations').select('id,allocation_percent').eq('employee_id', employeeId).in('status', ['approved', 'active']),
    supabase.from('profiles').select('default_weekly_capacity_hours').eq('id', employeeId).maybeSingle(),
    supabase.from('project_resource_alloc').select('allocated_hours').eq('employee_id', employeeId).eq('month', month).eq('year', year),
    // Capacity → Allocation Chart's per-employee Available Days for THIS
    // month (working days minus leave, editable there) — a more accurate
    // monthly capacity baseline than the generic weekly-hours estimate
    // below, once someone has actually filled that grid in for the month.
    supabase.from('capacity_employee_days').select('available_days').eq('employee_id', employeeId).eq('month', month).eq('year', year).maybeSingle(),
  ])
  const committedPct = (allocs || []).filter(a => a.id !== excludeAllocationId).reduce((s, a) => s + (Number(a.allocation_percent) || 0), 0)
  const weeklyCap = emp?.default_weekly_capacity_hours || 40
  const weeks = new Date(year, month, 0).getDate() / 7
  const legacyHours = (legacy || []).reduce((s, r) => s + (Number(r.allocated_hours) || 0), 0)
  const monthlyCapacityHours = capDays?.available_days != null ? Number(capDays.available_days) * 8 : weeklyCap * weeks
  const legacyPct = monthlyCapacityHours > 0 ? (legacyHours / monthlyCapacityHours) * 100 : 0
  return Math.round(100 - committedPct - legacyPct)
}
