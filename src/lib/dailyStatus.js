import { supabase } from './supabase'
import { listFlows, makeStatusHelpers } from './departmentStatusFlows'

// Same pre-STEP198 fallback shape TasksPage.jsx uses (STATUSES/SL/SC) —
// duplicated as data (not imported, TasksPage doesn't export these) so a
// department with no configured flow yet still resolves is_closed sanely.
const LEGACY_STEPS = [
  { status_key: 'backlog', label: 'Backlog', color: '#64748b', is_closed: false },
  { status_key: 'todo', label: 'To Do', color: '#3b82f6', is_closed: false },
  { status_key: 'in_progress', label: 'In Progress', color: '#f59e0b', is_closed: false },
  { status_key: 'delayed', label: 'Delayed', color: '#e11d48', is_closed: false },
  { status_key: 'qa', label: 'QA Testing', color: '#8b5cf6', is_closed: false },
  { status_key: 'ready_for_demo', label: 'Ready for Demo', color: '#10b981', is_closed: false },
  { status_key: 'closed', label: 'Closed', color: '#94a3b8', is_closed: true },
]

// isTaskDone() (departmentStatusFlows.js) only recognizes a status as
// closed when it exactly matches a status_key configured in that task's
// department flow. A stale/renamed flow, a typo, or a status that fell
// outside the configured list makes that lookup silently fail (defaults
// to "not done"). Falling back to the literal status text for anything
// the flow lookup doesn't recognize closes that gap without needing every
// org's flow config to be perfectly in sync with what's actually stored.
const CLOSED_STATUS_WORDS = ['closed', 'done', 'complete', 'completed', 'resolved']

// Flow-aware "is this task closed" check with the literal-status fallback
// above — exported so other reports (resourcePlanning.js) agree with this one.
export function makeIsTaskDone(flows) {
  const flowIsTaskDone = makeStatusHelpers(flows, LEGACY_STEPS).isTaskDone
  return task => flowIsTaskDone(task) || CLOSED_STATUS_WORDS.includes(String(task?.status || '').trim().toLowerCase())
}

const TICKET_CLOSED_STATUSES = ['resolved', 'closed']
const isTicketOpen = t => !TICKET_CLOSED_STATUSES.includes(t.status)
const ticketCompletedAt = t => t.closed_at || t.resolved_at || null
// Must handle both a Date instance (today/period start/end) and a string
// (a DATE or TIMESTAMPTZ column value from Supabase) — String(new Date())
// produces a locale string like "Wed Sep 15 2026 18:47:00 GMT+0530…", NOT
// an ISO date, so slicing that gave "Wed Sep 15" while a DB date column
// gives "2026-09-15": never equal, silently breaking every date comparison
// below (today, planned/overdue due-date matching) for anything due today.
// A Date instance is formatted using LOCAL calendar fields, not
// toISOString()'s UTC date — for IST (UTC+5:30) the UTC date is still
// "yesterday" for the first ~5.5 hours after local midnight, which would
// make "today" resolve to the wrong day right when a manager is most
// likely checking the report first thing in the morning.
function localDateOnly(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
const dateOnly = d => (d ? (d instanceof Date ? localDateOnly(d) : String(d)).slice(0, 10) : null)

// Daily = today only. Weekly = rolling 7-day window ending today (not a
// calendar Mon–Sun week — sidesteps locale/week-start ambiguity). Monthly =
// 1st of this month through today. Overdue is deliberately NOT scoped by
// this range — it's always "as of today" regardless of which period tab
// is selected, since "overdue" is a snapshot concept, not a rollup.
export function periodRange(period, refDate = new Date()) {
  const end = new Date(refDate); end.setHours(23, 59, 59, 999)
  const start = new Date(refDate); start.setHours(0, 0, 0, 0)
  if (period === 'weekly') start.setDate(start.getDate() - 6)
  if (period === 'monthly') start.setDate(1)
  return { start, end }
}

/**
 * Pure aggregation over already-fetched raw rows — no network calls. Shared
 * by the internal report (getDailyStatusReport, full data: resource names,
 * both hour sources, tickets, department names) and the external/public
 * report (getPublicDailyStatusReport, a deliberately reduced/anonymized
 * raw payload) so the Moved/Planned/Completed/Overdue logic lives in
 * exactly one place — the public RPC only ever needs to hand back a
 * smaller set of raw rows, never a second copy of this algorithm in SQL.
 *
 *  - "Moved": project_tasks status changes come from task_change_log
 *    (STEP197) — an exact audit trail, not inferred from any updated_at.
 *    Tickets have no equivalent per-field audit log, so their "moved" entry
 *    is approximated from `updated_at` falling in the period (best-effort,
 *    old status not known).
 *  - "Planned"/"Overdue" use project_tasks.planned_end_date and each
 *    ticket table's resolution_due_at as the due-date field.
 *  - "Completed" uses task_change_log rows whose new status is a closed
 *    step in THAT TASK'S OWN department flow (per-department flows,
 *    STEP198 — never a hardcoded status==='closed' check), and each
 *    ticket table's resolved_at/closed_at for tickets.
 *  - Two hour figures per resource: `hoursLogged` (work_logs, STEP182 —
 *    task-linked work sessions, answers "hours logged against task"
 *    exactly) and `totalHoursLogged` (time_logs — the coarser but always-
 *    populated check-in/checkout total, since not everyone uses the
 *    granular Start/Pause/Resume/Complete task flow that produces work_logs).
 */
export function computeDailyStatus(raw, period, refDate) {
  const {
    tasks = [], changeLog = [], flows = [], workLogs = [], timeLogs = [],
    itTickets = [], supportTickets = [], profiles = [], departments = [],
  } = raw
  const { start, end } = periodRange(period, refDate)
  const startIso = start.toISOString(), endIso = end.toISOString()
  const today = dateOnly(new Date())

  const isTaskDone = makeIsTaskDone(flows)
  const nameById = Object.fromEntries(profiles.map(p => [p.id, p.full_name]))
  const deptNameById = Object.fromEntries(departments.map(d => [d.id, d.name]))
  const taskById = Object.fromEntries(tasks.map(t => [t.id, t]))
  const nameOf = id => (id ? (nameById[id] || 'Unknown') : 'Unassigned')
  const deptNameOf = id => (id ? (deptNameById[id] || 'Unknown Department') : 'Unassigned')

  const byResource = {}
  function bump(resourceId, field, amount = 1) {
    const key = resourceId || '__unassigned'
    if (!byResource[key]) byResource[key] = { profileId: resourceId || null, name: nameOf(resourceId), inProgress: 0, completed: 0, hoursLogged: 0, totalHoursLogged: 0 }
    byResource[key][field] += amount
  }

  // Department Efficiency — Tasks only (STEP160/STEP153 tickets carry no
  // department_id, so a department rollup can't meaningfully include
  // them). onTime tracks, of what got completed THIS period, how much was
  // finished on or before its own due date — the actual "is this team
  // keeping pace" signal, as distinct from raw completion volume.
  const byDept = {}
  function bumpDept(deptId, field, amount = 1) {
    const key = deptId || '__none'
    if (!byDept[key]) byDept[key] = { departmentId: deptId || null, name: deptNameOf(deptId), open: 0, completed: 0, overdue: 0, onTime: 0, dueDated: 0, hoursLogged: 0 }
    byDept[key][field] += amount
  }

  /* ── Moved (status changes) within the period ── */
  const movedTasks = changeLog.map(c => ({
    id: `task-log-${c.id}`, source: 'Task', title: taskById[c.task_id]?.task_name || taskById[c.task_id]?.task_id || '—',
    from: c.old_value, to: c.new_value, resource: nameOf(c.changed_by), changedAt: c.created_at,
  }))
  const movedTickets = (table, idField, resourceField) => table
    .filter(t => t.updated_at >= startIso && t.updated_at <= endIso)
    .map(t => ({ id: `${idField}-${t.id}`, source: idField === 'it' ? 'IT Helpdesk' : 'Support Desk', title: t.subject, from: null, to: t.status, resource: nameOf(t[resourceField]), changedAt: t.updated_at }))
  const moved = [...movedTasks, ...movedTickets(itTickets, 'it', 'assigned_to'), ...movedTickets(supportTickets, 'sup', 'assigned_agent_id')]
    .sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt))

  /* ── Planned: due within the period, still open ── */
  const dueWithin = d => d && dateOnly(d) >= dateOnly(start) && dateOnly(d) <= dateOnly(end)
  const planned = [
    ...tasks.filter(t => dueWithin(t.planned_end_date) && !isTaskDone(t))
      .map(t => ({ id: `task-${t.id}`, source: 'Task', title: t.task_name, dueDate: t.planned_end_date, resource: nameOf(t.assigned_to), status: t.status })),
    ...itTickets.filter(t => dueWithin(t.resolution_due_at) && isTicketOpen(t))
      .map(t => ({ id: `it-${t.id}`, source: 'IT Helpdesk', title: t.subject, dueDate: t.resolution_due_at, resource: nameOf(t.assigned_to), status: t.status })),
    ...supportTickets.filter(t => dueWithin(t.resolution_due_at) && isTicketOpen(t))
      .map(t => ({ id: `sup-${t.id}`, source: 'Support Desk', title: t.subject, dueDate: t.resolution_due_at, resource: nameOf(t.assigned_agent_id), status: t.status })),
  ]

  /* ── Completed within the period ── */
  const completedTaskIds = new Set()
  const completedTasks = []
  changeLog.forEach(c => {
    const task = taskById[c.task_id]
    if (!task || completedTaskIds.has(task.id)) return
    if (isTaskDone({ status: c.new_value, department_id: task.department_id })) {
      completedTaskIds.add(task.id)
      completedTasks.push({ id: `task-${task.id}`, source: 'Task', title: task.task_name, resource: nameOf(task.assigned_to), completedAt: c.created_at })
      bump(task.assigned_to, 'completed')
      bumpDept(task.department_id, 'completed')
      if (task.planned_end_date) {
        bumpDept(task.department_id, 'dueDated')
        if (dateOnly(c.created_at) <= dateOnly(task.planned_end_date)) bumpDept(task.department_id, 'onTime')
      }
    }
  })
  const completedTickets = (table, idField, resourceField) => table
    .filter(t => !isTicketOpen(t) && ticketCompletedAt(t) && ticketCompletedAt(t) >= startIso && ticketCompletedAt(t) <= endIso)
    .map(t => {
      bump(t[resourceField], 'completed')
      return { id: `${idField}-${t.id}`, source: idField === 'it' ? 'IT Helpdesk' : 'Support Desk', title: t.subject, resource: nameOf(t[resourceField]), completedAt: ticketCompletedAt(t) }
    })
  const completed = [...completedTasks, ...completedTickets(itTickets, 'it', 'assigned_to'), ...completedTickets(supportTickets, 'sup', 'assigned_agent_id')]

  /* ── In Progress: current open snapshot, as actual items (not just a
     count) — same shape as planned/completed/overdue so it can be grouped
     per resource below. ── */
  const inProgress = [
    ...tasks.filter(t => !isTaskDone(t))
      .map(t => ({ id: `task-${t.id}`, source: 'Task', title: t.task_name, resource: nameOf(t.assigned_to), status: t.status })),
    ...itTickets.filter(isTicketOpen)
      .map(t => ({ id: `it-${t.id}`, source: 'IT Helpdesk', title: t.subject, resource: nameOf(t.assigned_to), status: t.status })),
    ...supportTickets.filter(isTicketOpen)
      .map(t => ({ id: `sup-${t.id}`, source: 'Support Desk', title: t.subject, resource: nameOf(t.assigned_agent_id), status: t.status })),
  ]

  /* ── Overdue — always as-of-today. Due date <= today (not strictly
     before) — a task due TODAY that hasn't reached a closed status yet is
     already at risk today, not just from tomorrow onward. Closed/done
     items are never included, regardless of date (isTaskDone/isTicketOpen
     below), so completing something on its due date drops it out
     immediately — it never lingers in Overdue after being finished. ── */
  const isDueByToday = d => d && dateOnly(d) <= today
  const overdue = [
    ...tasks.filter(t => isDueByToday(t.planned_end_date) && !isTaskDone(t))
      .map(t => ({ id: `task-${t.id}`, source: 'Task', title: t.task_name, dueDate: t.planned_end_date, resource: nameOf(t.assigned_to), status: t.status })),
    ...itTickets.filter(t => isDueByToday(t.resolution_due_at) && isTicketOpen(t))
      .map(t => ({ id: `it-${t.id}`, source: 'IT Helpdesk', title: t.subject, dueDate: t.resolution_due_at, resource: nameOf(t.assigned_to), status: t.status })),
    ...supportTickets.filter(t => isDueByToday(t.resolution_due_at) && isTicketOpen(t))
      .map(t => ({ id: `sup-${t.id}`, source: 'Support Desk', title: t.subject, dueDate: t.resolution_due_at, resource: nameOf(t.assigned_agent_id), status: t.status })),
  ]

  /* ── By resource: current open-item count (snapshot), completed count
     and both hour figures (period-scoped) ── */
  tasks.filter(t => !isTaskDone(t)).forEach(t => { bump(t.assigned_to, 'inProgress'); bumpDept(t.department_id, 'open') })
  itTickets.filter(isTicketOpen).forEach(t => bump(t.assigned_to, 'inProgress'))
  supportTickets.filter(isTicketOpen).forEach(t => bump(t.assigned_agent_id, 'inProgress'))
  workLogs.forEach(w => {
    bump(w.employee_id, 'hoursLogged', (Number(w.duration_minutes) || 0) / 60)
    const t = taskById[w.task_id]
    if (t) bumpDept(t.department_id, 'hoursLogged', (Number(w.duration_minutes) || 0) / 60)
  })
  timeLogs.forEach(tl => bump(tl.employee_id, 'totalHoursLogged', Number(tl.hours_worked) || 0))
  tasks.filter(t => isDueByToday(t.planned_end_date) && !isTaskDone(t)).forEach(t => bumpDept(t.department_id, 'overdue'))

  // Group the already-built item lists by resource name so "By Resource"
  // can show the actual planned/in-progress/completed items per person,
  // not just counts — exactly what was asked for ("need proper list").
  function groupByResourceName(items) {
    const map = {}
    items.forEach(it => { (map[it.resource] = map[it.resource] || []).push(it) })
    return map
  }
  const plannedByName = groupByResourceName(planned)
  const completedByName = groupByResourceName(completed)
  const inProgressByName = groupByResourceName(inProgress)

  const resourceRows = Object.values(byResource)
    .map(r => ({
      ...r, hoursLogged: Math.round(r.hoursLogged * 10) / 10, totalHoursLogged: Math.round(r.totalHoursLogged * 10) / 10,
      plannedItems: plannedByName[r.name] || [], completedItems: completedByName[r.name] || [], inProgressItems: inProgressByName[r.name] || [],
    }))
    .sort((a, b) => (b.inProgress + b.completed) - (a.inProgress + a.completed))

  const departmentRows = Object.values(byDept)
    .map(d => ({
      ...d,
      hoursLogged: Math.round(d.hoursLogged * 10) / 10,
      completionRate: (d.open + d.completed) > 0 ? Math.round((d.completed / (d.open + d.completed)) * 1000) / 10 : null,
      onTimeRate: d.dueDated > 0 ? Math.round((d.onTime / d.dueDated) * 1000) / 10 : null,
    }))
    .sort((a, b) => (b.open + b.completed) - (a.open + a.completed))

  const totalHoursLogged = Math.round(resourceRows.reduce((s, r) => s + r.hoursLogged, 0) * 10) / 10
  const totalHoursLoggedAll = Math.round(resourceRows.reduce((s, r) => s + r.totalHoursLogged, 0) * 10) / 10
  const deptOpenTotal = departmentRows.reduce((s, d) => s + d.open, 0)
  const deptCompletedTotal = departmentRows.reduce((s, d) => s + d.completed, 0)
  const deptDueDatedTotal = departmentRows.reduce((s, d) => s + d.dueDated, 0)
  const deptOnTimeTotal = departmentRows.reduce((s, d) => s + d.onTime, 0)

  return {
    period, start, end,
    moved, planned, completed, overdue,
    byResource: resourceRows,
    byDepartment: departmentRows,
    totals: {
      moved: moved.length, planned: planned.length, completed: completed.length, overdue: overdue.length,
      hoursLogged: totalHoursLogged, totalHoursLogged: totalHoursLoggedAll,
      completionRate: (deptOpenTotal + deptCompletedTotal) > 0 ? Math.round((deptCompletedTotal / (deptOpenTotal + deptCompletedTotal)) * 1000) / 10 : null,
      onTimeRate: deptDueDatedTotal > 0 ? Math.round((deptOnTimeTotal / deptDueDatedTotal) * 1000) / 10 : null,
    },
  }
}

export async function getDailyStatusReport(organizationId, period = 'daily', refDate = new Date()) {
  const { start, end } = periodRange(period, refDate)
  const startIso = start.toISOString(), endIso = end.toISOString()

  const [flows, tasksRes, changeLogRes, workLogsRes, timeLogsRes, itTicketsRes, supportTicketsRes, profilesRes, deptsRes] = await Promise.all([
    listFlows(organizationId).catch(() => []),
    supabase.from('project_tasks').select('id, task_id, task_name, status, department_id, assigned_to, planned_end_date, project_id'),
    supabase.from('task_change_log').select('id, task_id, changed_by, old_value, new_value, created_at')
      .eq('field_name', 'status').gte('created_at', startIso).lte('created_at', endIso),
    supabase.from('work_logs').select('employee_id, task_id, duration_minutes, started_at')
      .gte('started_at', startIso).lte('started_at', endIso),
    supabase.from('time_logs').select('employee_id, work_date, hours_worked')
      .gte('work_date', dateOnly(start)).lte('work_date', dateOnly(end)),
    supabase.from('it_helpdesk_tickets').select('id, ticket_number, subject, status, assigned_to, resolution_due_at, resolved_at, closed_at, updated_at'),
    supabase.from('support_tickets').select('id, ticket_number, subject, status, assigned_agent_id, resolution_due_at, resolved_at, closed_at, updated_at'),
    supabase.from('profiles').select('id, full_name'),
    supabase.from('departments').select('id, name'),
  ])
  for (const r of [tasksRes, changeLogRes, workLogsRes, timeLogsRes, itTicketsRes, supportTicketsRes, profilesRes, deptsRes]) if (r.error) throw r.error

  return computeDailyStatus({
    tasks: tasksRes.data || [], changeLog: changeLogRes.data || [], flows,
    workLogs: workLogsRes.data || [], timeLogs: timeLogsRes.data || [],
    itTickets: itTicketsRes.data || [], supportTickets: supportTicketsRes.data || [],
    profiles: profilesRes.data || [], departments: deptsRes.data || [],
  }, period, refDate)
}

/**
 * External report for a tokenized share link (dailyStatusShare.js /
 * PublicDailyStatusPage.jsx) — the underlying tables aren't (and
 * shouldn't normally be) readable without a session, so this goes through
 * a SECURITY DEFINER RPC that validates the token and hands back the raw
 * rows. Per explicit confirmation, this is the FULL dataset (employee
 * names, hours, department names, tickets) — the external link is meant
 * to render byte-for-byte the same as the internal report via the shared
 * DailyStatusReportView component, not a reduced/anonymized view. If that
 * changes again later, prefer reducing what get_daily_status_public_raw
 * SELECTs server-side over filtering client-side — this function should
 * never receive data it isn't supposed to hand to the page.
 */
export async function getPublicDailyStatusReport(token, period = 'daily', refDate = new Date()) {
  const { start, end } = periodRange(period, refDate)
  const { data, error } = await supabase.rpc('get_daily_status_public_raw', {
    p_token: token, p_start: start.toISOString(), p_end: end.toISOString(),
  })
  if (error) throw error
  if (!data) return null
  return computeDailyStatus({
    tasks: data.tasks || [], changeLog: data.change_log || [], flows: data.flows || [],
    workLogs: data.work_logs || [], timeLogs: data.time_logs || [],
    itTickets: data.it_tickets || [], supportTickets: data.support_tickets || [],
    profiles: data.profiles || [], departments: data.departments || [],
  }, period, refDate)
}
