// Team Performance — the pure calculation, shared by:
//   • the web app      src/lib/teamPerformance.js  (Daily Status → Team performance)
//   • the email worker supabase/functions/send-email (scheduled report emails)
// Lives under supabase/functions/_shared so the Edge Function bundler picks
// it up; Vite imports it by relative path. Plain JS, no imports — keep it
// that way so it runs unchanged in both the browser and Deno.
//
// Sources (all existing tables, no schema change):
//   attendance   time_logs.hours_worked       (check-in / check-out)
//   task time    work_logs.duration_minutes   (task Start/Pause/Complete)
//   delivery     task_change_log status → a closed step of the task's own
//                department flow (isTaskDone is injected by the caller)
//   capacity     weekdays in period (up to today) × target hours,
//                minus approved leave days
//
// Deliberately NOT a single blended score: every number is a plain,
// explainable ratio plus explicit flags.

const localDate = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
const dOnly = v => (v ? (v instanceof Date ? localDate(v) : String(v).slice(0, 10)) : null)
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const round1 = n => Math.round(n * 10) / 10
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null)
const minutesOf = w => (w.duration_minutes != null ? Number(w.duration_minutes)
  : w.ended_at ? Math.max(0, Math.round((new Date(w.ended_at) - new Date(w.started_at)) / 60000)) : 0)

export function weekdaysBetween(from, to) {
  const out = []
  for (let d = parse(from); localDate(d) <= to; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0 && d.getDay() !== 6) out.push(localDate(d))
  }
  return out
}

export const FLAG_META = {
  absent:          { label: 'Absent',                    tone: 'danger', hint: 'Expected to work but no check-in in this period' },
  no_task_time:    { label: 'Checked in, no task time',  tone: 'danger', hint: 'Attendance recorded but nothing logged against any task' },
  low_logging:     { label: 'Low logging',               tone: 'warn',   hint: 'Less than half of attendance time is logged against tasks' },
  missed_checkout: { label: 'Missed check-out',          tone: 'warn',   hint: 'A past check-in was never checked out, so its hours are missing' },
  over_estimate:   { label: 'Over estimate',             tone: 'warn',   hint: 'Completed tasks took well over their estimated hours' },
  overdue:         { label: 'Overdue work',              tone: 'warn',   hint: 'Has open tasks past their due date' },
  over_logged:     { label: 'Task time > attendance',    tone: 'info',   hint: 'More task time than check-in time — check-in may be missing' },
}

/**
 * Pure aggregation — no network, no clock, no imports. Dates are passed in
 * (org-local "today", period from/to, timestamp→date) so the browser and the
 * email worker (UTC) produce identical numbers for the same org timezone.
 * Returns { days, rows[], totals } where rows are one per active profile.
 */
export function computeTeamPerformanceCore(raw, { from, to, today, isTaskDone, dateOfTs = ts => localDate(new Date(ts)), targetHours = 8 }) {
  const { profiles = [], timeLogs = [], workLogs = [], tasks = [], changeLog = [], leaves = [], itTickets = [], supportTickets = [] } = raw
  const days = weekdaysBetween(from, to < today ? to : today)
  const taskById = Object.fromEntries(tasks.map(t => [t.id, t]))

  // Completion events in the period, first closing transition per task.
  const completedTasks = []
  const seen = new Set()
  for (const c of [...changeLog].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))) {
    const t = taskById[c.task_id]
    if (!t || seen.has(t.id)) continue
    if (isTaskDone({ status: c.new_value, department_id: t.department_id })) {
      seen.add(t.id)
      completedTasks.push({ task: t, at: c.created_at })
    }
  }
  const ticketDone = (t, who) => ({ who: t[who], at: t.resolved_at || t.closed_at })
  const resolvedTickets = [
    ...itTickets.map(t => ticketDone(t, 'assigned_to')),
    ...supportTickets.map(t => ticketDone(t, 'assigned_agent_id')),
  ].filter(x => x.who && x.at && dateOfTs(x.at) >= from && dateOfTs(x.at) <= to)

  const rows = profiles.filter(p => p.is_active !== false).map(p => {
    const tl = timeLogs.filter(l => l.employee_id === p.id)
    const wl = workLogs.filter(w => w.employee_id === p.id)

    const leaveDays = new Set()
    leaves.filter(l => l.employee_id === p.id && l.leave_type !== 'permission').forEach(l => {
      const lt = l.to_date || l.from_date
      days.forEach(d => { if (d >= l.from_date && d <= lt) leaveDays.add(d) })
    })
    const capacity = Math.max(0, days.length - leaveDays.size) * targetHours

    // Per-day breakdown (weekdays in range + any weekend day with activity).
    const byDay = {}
    const dayRec = d => (byDay[d] ||= { date: d, attendance: 0, task: 0, completed: 0, leave: leaveDays.has(d), open: false })
    days.forEach(dayRec)
    tl.forEach(l => { const r = dayRec(l.work_date); r.attendance += Number(l.hours_worked) || 0; if (!l.check_out) r.open = true })
    wl.forEach(w => { dayRec(dateOfTs(w.started_at)).task += minutesOf(w) / 60 })

    const mine = completedTasks.filter(c => c.task.assigned_to === p.id)
    mine.forEach(c => { dayRec(dateOfTs(c.at)).completed += 1 })
    const tickets = resolvedTickets.filter(x => x.who === p.id)
    tickets.forEach(x => { dayRec(dateOfTs(x.at)).completed += 1 })

    const attendance = tl.reduce((s, l) => s + (Number(l.hours_worked) || 0), 0)
    const taskHours = wl.reduce((s, w) => s + minutesOf(w) / 60, 0)
    const daysPresent = new Set(tl.map(l => l.work_date)).size
    const missedCheckouts = tl.filter(l => !l.check_out && l.work_date < today).length
    const liveNow = tl.some(l => !l.check_out && l.work_date === today) || wl.some(w => !w.ended_at)
    const noTaskDays = Object.values(byDay).filter(d => d.attendance > 0 && d.task === 0).length

    const dueDated = mine.filter(c => c.task.planned_end_date)
    const onTime = dueDated.filter(c => dateOfTs(c.at) <= dOnly(c.task.planned_end_date)).length
    const withBoth = mine.filter(c => Number(c.task.estimated_hours) > 0 && Number(c.task.actual_hours) > 0)
    const estSum = withBoth.reduce((s, c) => s + Number(c.task.estimated_hours), 0)
    const actSum = withBoth.reduce((s, c) => s + Number(c.task.actual_hours), 0)

    const openTasks = tasks.filter(t => t.assigned_to === p.id && !isTaskDone(t))
    const overdue = openTasks.filter(t => t.planned_end_date && dOnly(t.planned_end_date) < today).length

    const attendancePct = pct(attendance, capacity)
    const loggingPct = pct(taskHours, attendance)
    const estimateAccuracy = pct(estSum, actSum)

    const flags = []
    if (capacity > 0 && daysPresent === 0) flags.push('absent')
    if (attendance >= 1 && taskHours === 0) flags.push('no_task_time')
    else if (loggingPct != null && loggingPct < 50 && attendance >= 4) flags.push('low_logging')
    if (taskHours > attendance + 0.5 && attendance > 0) flags.push('over_logged')
    if (missedCheckouts > 0) flags.push('missed_checkout')
    if (estimateAccuracy != null && estimateAccuracy < 70) flags.push('over_estimate')
    if (overdue > 0) flags.push('overdue')

    return {
      id: p.id, name: p.full_name || 'Unknown', role: p.role, department_id: p.department_id,
      capacity, attendance: round1(attendance), taskHours: round1(taskHours),
      attendancePct, loggingPct, daysPresent, leaveDays: leaveDays.size, workingDays: days.length,
      missedCheckouts, noTaskDays, liveNow,
      completed: mine.length + tickets.length, completedTasks: mine.length, resolvedTickets: tickets.length,
      onTimePct: pct(onTime, dueDated.length), estimateAccuracy, estHours: round1(estSum), actHours: round1(actSum),
      openTasks: openTasks.length, overdue,
      tasksWorked: new Set(wl.map(w => w.task_id).filter(Boolean)).size,
      flags,
      daily: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)).map(d => ({ ...d, attendance: round1(d.attendance), task: round1(d.task) })),
      completedList: mine.map(c => ({ id: c.task.id, code: c.task.task_id, name: c.task.task_name, at: c.at, due: c.task.planned_end_date, est: Number(c.task.estimated_hours) || null, act: Number(c.task.actual_hours) || null })),
    }
  })

  const sum = k => rows.reduce((s, r) => s + (r[k] || 0), 0)
  const dueAll = rows.reduce((s, r) => s + r.completedList.filter(c => c.due).length, 0)
  const onTimeAll = rows.reduce((s, r) => s + r.completedList.filter(c => c.due && dateOfTs(c.at) <= dOnly(c.due)).length, 0)
  const totals = {
    people: rows.length,
    present: rows.filter(r => r.daysPresent > 0).length,
    capacity: sum('capacity'), attendance: round1(sum('attendance')), taskHours: round1(sum('taskHours')),
    attendancePct: pct(sum('attendance'), sum('capacity')),
    loggingPct: pct(sum('taskHours'), sum('attendance')),
    utilizationPct: pct(sum('taskHours'), sum('capacity')),
    completed: sum('completed'), onTimePct: pct(onTimeAll, dueAll),
    estimateAccuracy: pct(sum('estHours'), sum('actHours')),
    overdue: sum('overdue'),
    flagged: rows.filter(r => r.flags.some(f => FLAG_META[f].tone !== 'info')).length,
  }
  return { from, to, days, rows, totals, targetHours }
}
