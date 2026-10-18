// Audience reports (STEP230): HR people, Manager team, Sales pipeline, plus
// the "previous period" rule behind every ▲▼ trend. Pure JS, no imports, no
// clock — dates, isTaskDone and timestamp helpers are passed in — so it runs
// in Deno (send-email) and the browser. Team/project/finance numbers come
// from teamPerformanceCore.js / reportsCore.js; this file only adds the
// extra per-audience views on top.

const DAY = 86400000
const d2n = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))
const n2d = n => new Date(n).toISOString().slice(0, 10)
const addDays = (s, k) => n2d(d2n(s) + k * DAY)
const num = v => Number(v) || 0
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null)
const inRange = (d, from, to) => !!d && d >= from && d <= to
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate() // m = 1..12

/**
 * The window to compare against:
 *  - a calendar month (or month-to-date) → the same days of the previous month
 *  - anything else → the same number of days immediately before
 */
export function previousWindow(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  if (fd === 1 && fy === ty && fm === tm) {
    const py = fm === 1 ? fy - 1 : fy, pm = fm === 1 ? 12 : fm - 1
    const lastDay = td === daysInMonth(ty, tm) ? daysInMonth(py, pm) : Math.min(td, daysInMonth(py, pm))
    const mm = String(pm).padStart(2, '0')
    return { from: `${py}-${mm}-01`, to: `${py}-${mm}-${String(lastDay).padStart(2, '0')}` }
  }
  const len = Math.round((d2n(to) - d2n(from)) / DAY) + 1
  return { from: addDays(from, -len), to: addDays(from, -1) }
}

/** Change between two numbers, for ▲▼ badges. kind 'pct' = percentage points. */
export function delta(cur, prev, { kind = 'abs', goodWhenUp = true } = {}) {
  if (cur == null || prev == null) return null
  const diff = cur - prev
  if (diff === 0) return { dir: 'flat', text: 'no change', good: null }
  const dir = diff > 0 ? 'up' : 'down'
  let text
  if (kind === 'pts') text = `${Math.abs(Math.round(diff))} pt${Math.abs(Math.round(diff)) === 1 ? '' : 's'}`
  else if (kind === 'pct') {
    if (!prev) return { dir, text: 'new', good: (diff > 0) === goodWhenUp } // nothing to compare against
    text = `${Math.abs(Math.round((diff / Math.abs(prev)) * 100))}%`
  }
  else text = String(Math.abs(Math.round(diff * 10) / 10))
  return { dir, text, good: (diff > 0) === goodWhenUp }
}

/* ═════════════ HR people ═════════════ */

const LEAVE_PENDING = s => /pending|submitted|review/i.test(s || '')
const weekdaysIn = (from, to) => { const out = []; for (let n = d2n(from); n <= d2n(to); n += DAY) { const d = new Date(n).getUTCDay(); if (d && d !== 6) out.push(n2d(n)) } return out }

/**
 * raw:  { profiles, departments, timeLogs, leaves, timesheets }
 *       timeLogs must carry check_in; leaves = everything overlapping
 *       [from, today+14] plus all pending; timesheets = pending ones.
 * team: teamPerformanceCore result for the same window (attendance rows).
 * opts: { from, to, today, minutesOfTs(ts) → minutes after local midnight, lateAfter 'HH:MM' }
 */
export function computeHrCore(raw, team, { from, to, today, minutesOfTs, dateOfTs, lateAfter = '10:00' }) {
  const { profiles = [], departments = [], timeLogs = [], leaves = [], timesheets = [] } = raw
  const active = profiles.filter(p => p.is_active !== false)
  const deptName = id => departments.find(d => d.id === id)?.name || 'No department'
  const nameOf = id => profiles.find(p => p.id === id)?.full_name || 'Unknown'

  const byDept = {}
  active.forEach(p => { const k = deptName(p.department_id); byDept[k] = (byDept[k] || 0) + 1 })
  const byType = {}
  active.forEach(p => { const k = (p.employment_type || 'full_time').replace(/_/g, ' '); byType[k] = (byType[k] || 0) + 1 })
  const joiners = active.filter(p => inRange(p.date_joined, from, to))
    .map(p => ({ name: p.full_name, designation: p.designation, department: deptName(p.department_id), date: p.date_joined }))

  // Work anniversaries in the next 14 days (1+ years).
  const soon = addDays(today, 14)
  const anniversaries = active.filter(p => p.date_joined).map(p => {
    const [y, m, d] = p.date_joined.split('-').map(Number)
    let year = +today.slice(0, 4), date = `${year}-${String(m).padStart(2, '0')}-${String(Math.min(d, daysInMonth(year, m))).padStart(2, '0')}`
    if (date < today) { year += 1; date = `${year}-${String(m).padStart(2, '0')}-${String(Math.min(d, daysInMonth(year, m))).padStart(2, '0')}` }
    return { name: p.full_name, date, years: year - y }
  }).filter(a => a.years >= 1 && a.date <= soon).sort((a, b) => a.date.localeCompare(b.date))

  // Late arrivals: first check-in of each person-day after lateAfter.
  const [lh, lm] = lateAfter.split(':').map(Number), lateMin = lh * 60 + (lm || 0)
  const firstIn = new Map()
  timeLogs.forEach(l => {
    if (!l.check_in) return
    const k = l.employee_id + '|' + l.work_date, m = minutesOfTs(l.check_in)
    if (!firstIn.has(k) || m < firstIn.get(k)) firstIn.set(k, m)
  })
  const lateBy = {}
  let lateDays = 0, inSum = 0, inCount = 0
  firstIn.forEach((m, k) => { inSum += m; inCount++; if (m > lateMin) { lateDays++; const id = k.split('|')[0]; lateBy[id] = (lateBy[id] || 0) + 1 } })
  const latecomers = Object.entries(lateBy).map(([id, days]) => ({ name: nameOf(id), days })).sort((a, b) => b.days - a.days)

  // Leave
  const wd = weekdaysIn(from, to)
  const approved = leaves.filter(l => l.status === 'approved' && l.leave_type !== 'permission')
  const takenByType = {}
  let leaveDays = 0
  approved.forEach(l => {
    const lt = l.to_date || l.from_date
    const n = wd.filter(d => d >= l.from_date && d <= lt).length
    if (n) { takenByType[l.leave_type || 'other'] = (takenByType[l.leave_type || 'other'] || 0) + n; leaveDays += n }
  })
  const onLeaveToday = approved.filter(l => l.from_date <= today && today <= (l.to_date || l.from_date)).map(l => ({ name: nameOf(l.employee_id), type: l.leave_type, until: l.to_date || l.from_date }))
  const upcoming = approved.filter(l => l.from_date > today && l.from_date <= soon).sort((a, b) => a.from_date.localeCompare(b.from_date))
    .map(l => ({ name: nameOf(l.employee_id), type: l.leave_type, from: l.from_date, to: l.to_date || l.from_date }))
  const pendingLeave = leaves.filter(l => LEAVE_PENDING(l.status)).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map(l => ({ name: nameOf(l.employee_id), type: l.leave_type, from: l.from_date, to: l.to_date || l.from_date, waitingDays: l.created_at ? Math.max(0, Math.floor((d2n(today) - d2n(dateOfTs(l.created_at))) / DAY)) : null }))
  const pendingTimesheets = timesheets.filter(t => /^pending/.test(t.status || '')).map(t => ({ name: nameOf(t.employee_id), status: t.status, month: t.period_month, year: t.period_year, hours: num(t.total_hours) }))

  const rows = team.rows
  return {
    from, to,
    headcount: {
      active: active.length, joiners: joiners.length,
      byDepartment: Object.entries(byDept).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      byType: Object.entries(byType).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    },
    joiners, anniversaries,
    attendance: {
      pct: team.totals.attendancePct, loggingPct: team.totals.loggingPct, present: team.totals.present, people: team.totals.people,
      lateDays, lateAfter, avgFirstIn: inCount ? Math.round(inSum / inCount) : null, latecomers,
      missedCheckouts: rows.filter(r => r.missedCheckouts).map(r => ({ name: r.name, count: r.missedCheckouts })),
      low: rows.filter(r => r.attendancePct != null && r.attendancePct < 75 && r.capacity > 0).map(r => ({ name: r.name, pct: r.attendancePct, leaveDays: r.leaveDays })).sort((a, b) => a.pct - b.pct),
      absent: rows.filter(r => r.flags.includes('absent')).map(r => r.name),
    },
    leave: { days: leaveDays, byType: Object.entries(takenByType).map(([type, days]) => ({ type, days })).sort((a, b) => b.days - a.days), onLeaveToday, upcoming, pending: pendingLeave },
    timesheets: { pending: pendingTimesheets },
  }
}

/* ═════════════ Manager team ═════════════ */

export const managerOf = p => p.reporting_manager_id || p.manager_id || null

/** Active people who have at least one active direct report. */
export function listManagers(profiles) {
  const active = profiles.filter(p => p.is_active !== false)
  const ids = new Set(active.map(managerOf).filter(Boolean))
  return active.filter(p => ids.has(p.id))
}

/**
 * team: teamPerformanceCore result (whole org, same window)
 * plan: planningCore result for the next working day (whole org)
 * raw:  { profiles, leaves (pending), expenses (pending), timesheets (pending) }
 */
export function computeManagerCore(managerId, team, plan, raw) {
  const { profiles = [], leaves = [], expenses = [], timesheets = [] } = raw
  const reportIds = new Set(profiles.filter(p => p.is_active !== false && managerOf(p) === managerId).map(p => p.id))
  const rows = team.rows.filter(r => reportIds.has(r.id))
  const planRows = plan.rows.filter(r => reportIds.has(r.id))
  const nameOf = id => profiles.find(p => p.id === id)?.full_name || 'Unknown'
  const sum = k => rows.reduce((s, r) => s + (r[k] || 0), 0)
  const amt = e => num(e.total_amount) || num(e.amount)
  return {
    manager: profiles.find(p => p.id === managerId)?.full_name || 'Manager',
    from: team.from, to: team.to, days: team.days, rows, planDay: plan.day, plan: planRows,
    totals: {
      people: rows.length, present: rows.filter(r => r.daysPresent > 0).length,
      attendancePct: pct(sum('attendance'), sum('capacity')), loggingPct: pct(sum('taskHours'), sum('attendance')),
      completed: sum('completed'), overdue: sum('overdue'), openTasks: sum('openTasks'),
      flagged: rows.filter(r => r.flags.some(f => f !== 'over_logged')).length,
      needsPlanning: planRows.filter(r => ['none', 'carryover', 'under'].includes(r.status)).length,
      onLeaveTomorrow: planRows.filter(r => r.status === 'leave').length,
    },
    approvals: {
      leave: leaves.filter(l => reportIds.has(l.employee_id) && LEAVE_PENDING(l.status)).map(l => ({ name: nameOf(l.employee_id), type: l.leave_type, from: l.from_date, to: l.to_date || l.from_date })),
      expenses: expenses.filter(e => e.current_approver === managerId).map(e => ({ number: e.expense_number, title: e.title, amount: amt(e), name: nameOf(e.requested_by) })),
      timesheets: timesheets.filter(t => t.manager_id === managerId && t.status === 'pending_manager').map(t => ({ name: nameOf(t.employee_id), month: t.period_month, year: t.period_year, hours: num(t.total_hours) })),
    },
  }
}

/* ═════════════ Sales pipeline ═════════════ */

/**
 * raw: { leads, opportunities, stages, profiles }
 * opts: { from, to, today, dateOfTs }
 */
export function computeSalesCore(raw, { from, to, today, dateOfTs }) {
  const { leads = [], opportunities = [], stages = [], profiles = [] } = raw
  const nameOf = id => profiles.find(p => p.id === id)?.full_name || 'Unassigned'
  const inPeriod = ts => ts && inRange(dateOfTs(ts), from, to)
  const val = o => num(o.expected_value)
  const weighted = o => val(o) * num(o.probability_percent) / 100

  const newLeads = leads.filter(l => inPeriod(l.created_at))
  const bySource = {}
  newLeads.forEach(l => { const k = l.source || 'Unknown'; bySource[k] = (bySource[k] || 0) + 1 })
  const converted = leads.filter(l => l.status === 'Converted to Opportunity' && inPeriod(l.updated_at)).length
  const needsCoverage = leads.filter(l => /Unassigned/.test(l.status || '') || (!l.assigned_rep_id && !/Converted|Disqualified/.test(l.status || ''))).length

  const open = opportunities.filter(o => o.status === 'Open')
  const order = name => { const s = stages.find(x => x.stage_name === name); return s ? num(s.sort_order) : 999 }
  const stageMap = {}
  open.forEach(o => {
    const k = o.pipeline_stage || 'Unstaged'
    stageMap[k] ||= { stage: k, count: 0, value: 0, weighted: 0, order: order(k) }
    stageMap[k].count++; stageMap[k].value += val(o); stageMap[k].weighted += weighted(o)
  })
  const won = opportunities.filter(o => o.status === 'Won' && inPeriod(o.updated_at))
  const lost = opportunities.filter(o => o.status === 'Lost' && inPeriod(o.updated_at))
  const closingSoon = open.filter(o => o.expected_close_date && o.expected_close_date <= addDays(today, 30))
    .sort((a, b) => a.expected_close_date.localeCompare(b.expected_close_date))
    .map(o => ({ number: o.opportunity_number, value: val(o), probability: num(o.probability_percent), stage: o.pipeline_stage, close: o.expected_close_date, overdue: o.expected_close_date < today, rep: nameOf(o.assigned_rep_id) }))

  const reps = {}
  const rep = id => (reps[id || '_'] ||= { name: nameOf(id), open: 0, openValue: 0, won: 0, wonValue: 0, leads: 0 })
  open.forEach(o => { const r = rep(o.assigned_rep_id); r.open++; r.openValue += val(o) })
  won.forEach(o => { const r = rep(o.assigned_rep_id); r.won++; r.wonValue += val(o) })
  newLeads.forEach(l => { rep(l.assigned_rep_id).leads++ })

  const s = (list, f) => list.reduce((t, x) => t + f(x), 0)
  return {
    from, to,
    totals: {
      newLeads: newLeads.length, converted, conversionPct: pct(converted, newLeads.length), needsCoverage,
      openCount: open.length, pipeline: s(open, val), weighted: Math.round(s(open, weighted)),
      wonCount: won.length, wonValue: s(won, val), lostCount: lost.length, lostValue: s(lost, val),
      winRate: pct(won.length, won.length + lost.length),
      closingSoon: closingSoon.length, overdueCloses: closingSoon.filter(c => c.overdue).length,
    },
    bySource: Object.entries(bySource).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    stages: Object.values(stageMap).sort((a, b) => a.order - b.order || a.stage.localeCompare(b.stage)),
    closingSoon, reps: Object.values(reps).sort((a, b) => b.wonValue - a.wonValue || b.openValue - a.openValue),
    won: won.map(o => ({ number: o.opportunity_number, value: val(o), rep: nameOf(o.assigned_rep_id) })),
    isEmpty: !leads.length && !opportunities.length,
  }
}
