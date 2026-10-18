// Per-resource KPIs for Resource Management → Check-In Report.
// Pure computation over time_logs + approved leave_requests already fetched
// by the report tab — shared by the on-screen KPI table and the Excel export
// so both always agree.

const toDateStr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const minutesOfDay = ts => { const d = new Date(ts); return d.getHours() * 60 + d.getMinutes() }

export const fmtMinutes = m => {
  if (m == null) return '—'
  const h = Math.floor(m / 60), mm = Math.round(m % 60)
  const d = new Date(2000, 0, 1, h, mm)
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

// Mon–Fri dates in [from, to], capped at today (future days aren't "expected").
export function workingDaysInRange(from, to) {
  const today = toDateStr(new Date())
  const end = to > today ? today : to
  const days = []
  for (let d = parseDate(from); toDateStr(d) <= end; d.setDate(d.getDate() + 1)) {
    const wd = d.getDay()
    if (wd !== 0 && wd !== 6) days.push(toDateStr(d))
  }
  return days
}

// Working days in range covered by an approved full/half-day leave
// (permission-hour leaves don't remove the day from expected attendance).
function leaveDaysFor(empLeaves, workingDays) {
  const set = new Set()
  for (const l of empLeaves) {
    if (l.leave_type === 'permission') continue
    const from = l.from_date, to = l.to_date || l.from_date
    for (const wd of workingDays) if (wd >= from && wd <= to) set.add(wd)
  }
  return set
}

/**
 * @param {object} p
 * @param {Array} p.logs        time_logs rows (with employee_id, work_date, check_in, check_out, hours_worked, project_id)
 * @param {Array} p.employees   resources to report on (id, full_name, role, department_id)
 * @param {Array} p.leaves      approved leave_requests overlapping the range
 * @param {string} p.fromDate   'YYYY-MM-DD'
 * @param {string} p.toDate     'YYYY-MM-DD'
 * @param {string} p.lateAfter  'HH:MM' — first check-in after this is a late day
 * @param {number} p.targetHours hours per day below which a present day counts as short
 */
export function computeCheckinKpis({ logs, employees, leaves, fromDate, toDate, lateAfter = '10:00', targetHours = 8 }) {
  const workingDays = workingDaysInRange(fromDate, toDate)
  const workingSet = new Set(workingDays)
  const [lh, lm] = lateAfter.split(':').map(Number)
  const lateMin = lh * 60 + (lm || 0)
  const today = toDateStr(new Date())

  const rows = employees.map(emp => {
    const empLogs = logs.filter(l => l.employee_id === emp.id)
    const leaveSet = leaveDaysFor(leaves.filter(l => l.employee_id === emp.id), workingDays)

    // Collapse multiple sessions on the same day into one day record.
    const byDay = {}
    for (const l of empLogs) {
      const day = byDay[l.work_date] ||= { first: null, last: null, hours: 0, open: false }
      if (l.check_in && (day.first == null || l.check_in < day.first)) day.first = l.check_in
      if (l.check_out && (day.last == null || l.check_out > day.last)) day.last = l.check_out
      day.hours += Number(l.hours_worked) || 0
      if (!l.check_out) day.open = true
    }
    const days = Object.entries(byDay)
    const presentDays = days.length
    const presentWorkingDays = days.filter(([d]) => workingSet.has(d)).length
    const expectedDays = Math.max(0, workingDays.length - leaveSet.size)
    const absentDays = workingDays.filter(d => !byDay[d] && !leaveSet.has(d)).length

    const totalHours = empLogs.reduce((s, l) => s + (Number(l.hours_worked) || 0), 0)
    const projectHours = empLogs.filter(l => l.project_id).reduce((s, l) => s + (Number(l.hours_worked) || 0), 0)
    const closedDays = days.filter(([, d]) => !d.open)

    const firstMins = days.filter(([, d]) => d.first).map(([, d]) => minutesOfDay(d.first))
    const lastMins = days.filter(([, d]) => d.last).map(([, d]) => minutesOfDay(d.last))
    const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null

    return {
      id: emp.id,
      name: emp.full_name,
      role: emp.role,
      department_id: emp.department_id,
      presentDays,
      expectedDays,
      leaveDays: leaveSet.size,
      absentDays,
      attendancePct: expectedDays ? Math.min(100, (presentWorkingDays / expectedDays) * 100) : null,
      totalHours,
      closedDays: closedDays.length,
      closedHours: closedDays.reduce((s, [, d]) => s + d.hours, 0),
      avgHoursPerDay: closedDays.length ? closedDays.reduce((s, [, d]) => s + d.hours, 0) / closedDays.length : null,
      avgFirstIn: avg(firstMins),
      avgLastOut: avg(lastMins),
      lateDays: firstMins.filter(m => m > lateMin).length,
      shortDays: closedDays.filter(([, d]) => d.hours < targetHours).length,
      // Open sessions on a past date = forgot to check out. Today's open session is just "live".
      missedCheckouts: empLogs.filter(l => !l.check_out && l.work_date < today).length,
      liveNow: empLogs.some(l => !l.check_out && l.work_date === today),
      projectPct: totalHours ? (projectHours / totalHours) * 100 : null,
    }
  })

  const withExpected = rows.filter(r => r.attendancePct != null)
  const totalHours = rows.reduce((s, r) => s + r.totalHours, 0)
  const closedDays = rows.reduce((s, r) => s + r.closedDays, 0)
  const summary = {
    resources: rows.length,
    activeResources: rows.filter(r => r.presentDays > 0).length,
    workingDays: workingDays.length,
    totalHours,
    // Only fully checked-out days, so an open session doesn't drag the average down.
    avgHoursPerDay: closedDays ? rows.reduce((s, r) => s + r.closedHours, 0) / closedDays : null,
    attendancePct: withExpected.length ? withExpected.reduce((s, r) => s + r.attendancePct, 0) / withExpected.length : null,
    lateDays: rows.reduce((s, r) => s + r.lateDays, 0),
    missedCheckouts: rows.reduce((s, r) => s + r.missedCheckouts, 0),
    liveNow: rows.filter(r => r.liveNow).length,
  }
  return { rows, summary }
}
