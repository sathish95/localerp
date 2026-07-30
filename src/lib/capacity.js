import { supabase } from './supabase'

const DAY_MS = 86400000
const PAST_WEEKS = 4
const FUTURE_WEEKS = 12

// Monday of the ISO week containing `date`
export function weekStartOf(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

// Local-calendar-date ISO string — deliberately NOT toISOString(), which converts
// to UTC and rolls a local midnight back a day for any positive UTC-offset timezone
// (e.g. IST, +5:30) — exactly this app's timezone.
function toISODate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r }
function clamp(d, lo, hi) { return d < lo ? lo : d > hi ? hi : d }

// Count working days (Mon-Fri, excluding holidays) between two dates, inclusive.
export function countWorkingDays(from, to, holidaysSet = new Set()) {
  const start = new Date(from); start.setHours(0, 0, 0, 0)
  const end = new Date(to); end.setHours(0, 0, 0, 0)
  if (end < start) return 0
  let count = 0
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay()
    if (day === 0 || day === 6) continue
    if (holidaysSet.has(toISODate(d))) continue
    count++
  }
  return count
}

function windowBounds() {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const start = weekStartOf(addDays(today, -7 * PAST_WEEKS))
  const end = weekStartOf(addDays(today, 7 * FUTURE_WEEKS))
  return { start, end }
}

function enumerateWeeks(rangeStart, rangeEnd) {
  const { start: winStart, end: winEnd } = windowBounds()
  const s = clamp(weekStartOf(rangeStart), winStart, winEnd)
  const e = clamp(weekStartOf(rangeEnd || winEnd), winStart, winEnd)
  const weeks = []
  for (let w = new Date(s); w <= e; w = addDays(w, 7)) weeks.push(new Date(w))
  return weeks
}

async function loadHolidaysSet() {
  const { data } = await supabase.from('holidays').select('holiday_date')
  return new Set((data || []).map(h => h.holiday_date))
}

async function computeWeekForEmployee(employee, weekStart, allocations, leaves, holidaysSet) {
  const wEnd = addDays(weekStart, 6)
  const wStartISO = toISODate(weekStart), wEndISO = toISODate(wEnd)
  const available = Number(employee.default_weekly_capacity_hours) || 40

  const allocated = allocations
    .filter(a => a.employee_id === employee.id && ['approved', 'active'].includes(a.status))
    .filter(a => a.start_date <= wEndISO && (!a.end_date || a.end_date >= wStartISO))
    .reduce((s, a) => s + Number(a.allocation_hours_per_week || 0), 0)

  let leaveHours = 0
  leaves.filter(l => l.employee_id === employee.id && l.status === 'approved').forEach(l => {
    if (l.leave_type === 'permission') {
      if (l.permission_date && l.permission_date >= wStartISO && l.permission_date <= wEndISO) {
        leaveHours += Number(l.permission_hours || 0)
      }
    } else if (l.from_date) {
      const to = l.to_date || l.from_date
      if (l.from_date <= wEndISO && to >= wStartISO) {
        const overlapStart = clamp(new Date(l.from_date), weekStart, wEnd)
        const overlapEnd = clamp(new Date(to), weekStart, wEnd)
        const days = countWorkingDays(overlapStart, overlapEnd, holidaysSet)
        leaveHours += days * (available / 5)
      }
    }
  })

  const denom = Math.max(available - leaveHours, 0)
  const utilization = denom > 0 ? Math.round((allocated / denom) * 100) : (allocated > 0 ? 999 : 0)

  return {
    employee_id: employee.id,
    week_start_date: wStartISO,
    available_hours: Math.round(available * 100) / 100,
    allocated_hours: Math.round(allocated * 100) / 100,
    leave_hours: Math.round(leaveHours * 100) / 100,
    utilization_percent: utilization,
  }
}

async function upsertSnapshots(rows) {
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    await supabase.from('capacity_snapshots').upsert(rows.slice(i, i + CHUNK), { onConflict: 'employee_id,week_start_date' })
  }
}

async function recomputeForEmployees(employeeIds, weeks) {
  if (employeeIds.length === 0 || weeks.length === 0) return
  const [empR, allocR, leaveR, holidaysSet] = await Promise.all([
    supabase.from('profiles').select('id,default_weekly_capacity_hours').in('id', employeeIds),
    supabase.from('allocations').select('employee_id,status,start_date,end_date,allocation_hours_per_week').in('employee_id', employeeIds),
    supabase.from('leave_requests').select('employee_id,status,leave_type,from_date,to_date,permission_date,permission_hours').in('employee_id', employeeIds),
    loadHolidaysSet(),
  ])
  const employees = empR.data || []
  const allocations = allocR.data || []
  const leaves = leaveR.data || []
  const rows = []
  for (const emp of employees) {
    for (const week of weeks) {
      rows.push(await computeWeekForEmployee(emp, week, allocations, leaves, holidaysSet))
    }
  }
  await upsertSnapshots(rows)
}

export async function recomputeForEmployeeRange(employeeId, start, end) {
  if (!employeeId || !start) return
  const weeks = enumerateWeeks(new Date(start), end ? new Date(end) : null)
  await recomputeForEmployees([employeeId], weeks)
}

export async function recomputeFullWindowForEmployee(employeeId) {
  const { start, end } = windowBounds()
  const weeks = enumerateWeeks(start, end)
  await recomputeForEmployees([employeeId], weeks)
}

export async function recomputeForWeek(weekStartDate) {
  const { data } = await supabase.from('profiles').select('id').eq('is_active', true)
  const ids = (data || []).map(p => p.id)
  await recomputeForEmployees(ids, [weekStartOf(weekStartDate)])
}

export async function recomputeAllActive() {
  const { start, end } = windowBounds()
  const weeks = enumerateWeeks(start, end)
  const { data } = await supabase.from('profiles').select('id').eq('is_active', true)
  const ids = (data || []).map(p => p.id)
  await recomputeForEmployees(ids, weeks)
}

export async function getBenchBurnoutThresholds() {
  const { data } = await supabase.from('capacity_settings').select('*').eq('id', 1).maybeSingle()
  return {
    benchPct: data?.bench_risk_threshold_pct ?? 30,
    burnoutPct: data?.burnout_risk_threshold_pct ?? 100,
  }
}

export async function saveBenchBurnoutThresholds(benchPct, burnoutPct, updatedBy) {
  await supabase.from('capacity_settings').update({
    bench_risk_threshold_pct: benchPct, burnout_risk_threshold_pct: burnoutPct, updated_by: updatedBy,
  }).eq('id', 1)
}

export async function getSnapshotsForEmployee(employeeId, weeks = PAST_WEEKS + FUTURE_WEEKS) {
  const { data } = await supabase.from('capacity_snapshots').select('*').eq('employee_id', employeeId).order('week_start_date').limit(weeks)
  return data || []
}

export async function getSnapshotsForWeek(weekStartDate) {
  const { data } = await supabase.from('capacity_snapshots').select('*').eq('week_start_date', toISODate(weekStartOf(weekStartDate)))
  return data || []
}
