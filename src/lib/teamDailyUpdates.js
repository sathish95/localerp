// Daily Status → "Daily updates": one day, resource-wise — for every active
// person, what they updated on each task (status moves, field edits, progress
// comments, work sessions, new tasks) plus their check-in / check-out.
// Pure — the loader (teamDailyUpdatesData.js) fetches the rows and passes in
// the department-flow helpers (labelFor / isTaskDone), so this is unit-tested
// in teamDailyUpdates.test.mjs without Supabase.

export const PERSON_STATUSES = {
  UPDATED: { label: 'Updated', tone: 'green' },
  PRESENT: { label: 'Checked in, no task update', tone: 'amber' },
  NO_UPDATE: { label: 'No update', tone: 'gray' },
}

const FIELD_LABELS = {
  task_name: 'Title', task_type: 'Type', status: 'Status', priority: 'Priority', assigned_to: 'Assignee', department_id: 'Department',
  module_name: 'Module', planned_start_date: 'Planned start', planned_end_date: 'Due date', estimated_hours: 'Estimate (h)',
  actual_hours: 'Actual (h)', sprint_id: 'Sprint', user_story_id: 'User story',
}
export const fieldLabel = f => FIELD_LABELS[f] || f.replace(/_/g, ' ')

const ms = t => (t ? new Date(t).getTime() : NaN)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayLabel = v => { const [y, m, d] = String(v).slice(0, 10).split('-'); return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}` }
const round1 = n => Math.round(n * 10) / 10
const inDay = (t, start, end) => { const x = ms(t); return x >= start && x < end }

// date: 'YYYY-MM-DD' (local day). dayStart/dayEnd: epoch ms bounds of that day.
export function buildTeamDailyUpdates({
  date, dayStart, dayEnd, now = Date.now(),
  profiles = [], departments = [], projects = [], tasks = [],
  changeLog = [], comments = [], workLogs = [], timeLogs = [], checkinTasks = [], createdTasks = [],
  labelFor = (t, k) => k || t?.status || '—', isTaskDone = () => false,
}) {
  const nameById = Object.fromEntries(profiles.map(p => [p.id, p.full_name]))
  const deptById = Object.fromEntries(departments.map(d => [d.id, d.name]))
  const projById = Object.fromEntries(projects.map(p => [p.id, p.name || p.project_name]))
  const taskById = Object.fromEntries([...tasks, ...createdTasks].map(t => [t.id, t]))
  const isToday = now >= dayStart && now < dayEnd

  const res = {}
  const get = id => (res[id] ||= { id, tasks: {}, attendance: [], timeline: [], planned: new Set() })
  const taskEntry = (r, taskId) => {
    const t = taskById[taskId] || { id: taskId }
    return (r.tasks[taskId] ||= {
      id: taskId, code: t.task_id || '', name: t.task_name || 'Task', project: projById[t.project_id] || '',
      status: t.status ? labelFor(t, t.status) : '', done: t.status ? isTaskDone(t) : false, due: t.planned_end_date || null,
      created: false, planned: false, moves: [], edits: [], comments: [], work: [], minutes: 0, completed: false, lastProgress: null,
    })
  }
  const fieldValue = (field, v, t) => {
    if (v == null || v === '') return '—'
    if (field === 'assigned_to') return nameById[v] || 'Someone'
    if (field === 'department_id') return deptById[v] || 'Department'
    if (field === 'status') return labelFor(t, v)
    if (field === 'sprint_id' || field === 'user_story_id') return 'changed'
    if (/_date$/.test(field) && /^\d{4}-\d{2}-\d{2}/.test(v)) return dayLabel(v)
    return String(v)
  }

  for (const c of changeLog) {
    if (!c.changed_by || !inDay(c.created_at, dayStart, dayEnd)) continue
    const r = get(c.changed_by)
    const t = taskById[c.task_id] || {}
    const e = taskEntry(r, c.task_id)
    if (c.field_name === 'status') {
      const done = isTaskDone({ ...t, status: c.new_value })
      e.moves.push({ from: fieldValue('status', c.old_value, t), to: fieldValue('status', c.new_value, t), at: c.created_at, done })
      if (done) e.completed = true
      r.timeline.push({ at: c.created_at, kind: done ? 'completed' : 'move', taskId: c.task_id, title: `${e.code ? `${e.code} · ` : ''}${e.name}`, detail: `${fieldValue('status', c.old_value, t)} → ${fieldValue('status', c.new_value, t)}`, tone: done ? 'green' : 'indigo' })
    } else {
      e.edits.push({ field: fieldLabel(c.field_name), from: fieldValue(c.field_name, c.old_value, t), to: fieldValue(c.field_name, c.new_value, t), at: c.created_at })
      r.timeline.push({ at: c.created_at, kind: 'edit', taskId: c.task_id, title: `${e.code ? `${e.code} · ` : ''}${e.name}`, detail: `${fieldLabel(c.field_name)}: ${fieldValue(c.field_name, c.old_value, t)} → ${fieldValue(c.field_name, c.new_value, t)}`, tone: 'gray' })
    }
  }
  for (const c of comments) {
    if (!c.user_id || !inDay(c.created_at, dayStart, dayEnd)) continue
    const r = get(c.user_id)
    const e = taskEntry(r, c.task_id)
    e.comments.push({ text: c.comment, pct: c.progress_pct, at: c.created_at })
    if (c.progress_pct != null) e.lastProgress = c.progress_pct
    r.timeline.push({ at: c.created_at, kind: 'comment', taskId: c.task_id, title: `${e.code ? `${e.code} · ` : ''}${e.name}${c.progress_pct != null ? ` · ${c.progress_pct}%` : ''}`, detail: stripHtml(c.comment), tone: 'gray' })
  }
  for (const w of workLogs) {
    if (!w.employee_id || !inDay(w.started_at, dayStart, dayEnd)) continue
    const r = get(w.employee_id)
    const open = !w.ended_at
    const mins = w.duration_minutes != null ? Number(w.duration_minutes) : open && isToday ? Math.max(0, Math.round((now - ms(w.started_at)) / 60000)) : 0
    if (w.task_id) {
      const e = taskEntry(r, w.task_id)
      e.work.push({ from: w.started_at, to: w.ended_at, minutes: mins, note: w.description, open })
      e.minutes += mins
    } else (r.otherMinutes = (r.otherMinutes || 0) + mins)
    const te = w.task_id ? r.tasks[w.task_id] : null
    r.timeline.push({ at: w.started_at, until: w.ended_at, open, kind: 'work', taskId: w.task_id, title: te ? `${te.code ? `${te.code} · ` : ''}${te.name}` : 'Work session', detail: [mins ? fmtMins(mins) : '', w.description].filter(Boolean).join(' — '), tone: 'indigo' })
  }
  for (const t of createdTasks) {
    if (!t.created_by || !inDay(t.created_at, dayStart, dayEnd)) continue
    const r = get(t.created_by)
    const e = taskEntry(r, t.id)
    e.created = true
    r.timeline.push({ at: t.created_at, kind: 'created', taskId: t.id, title: `${e.code ? `${e.code} · ` : ''}${e.name}`, detail: `New task${t.assigned_to && t.assigned_to !== t.created_by ? ` for ${nameById[t.assigned_to] || 'someone'}` : ''}`, tone: 'gray' })
  }
  for (const c of checkinTasks) {
    if (!c.employee_id || !c.task_id || c.work_date !== date) continue
    get(c.employee_id).planned.add(c.task_id)
  }
  for (const l of timeLogs) {
    if (!l.employee_id || l.work_date !== date) continue
    const r = get(l.employee_id)
    const open = !l.check_out
    r.attendance.push({ in: l.check_in, out: l.check_out, hours: l.hours_worked != null ? Number(l.hours_worked) : null, open, project: projById[l.project_id] || '', comment: l.comment, site: l.site, visit: l.visit_type === 'SUPPORT' })
    r.timeline.push({ at: l.check_in, kind: 'checkin', title: l.visit_type === 'SUPPORT' ? `Site visit check-in${l.site ? ` · ${l.site}` : ''}` : 'Checked in', detail: [projById[l.project_id], l.comment].filter(Boolean).join(' — '), tone: 'green' })
    if (l.check_out) r.timeline.push({ at: l.check_out, kind: 'checkout', title: 'Checked out', detail: l.hours_worked != null ? `${round1(Number(l.hours_worked))} h` : '', tone: 'gray' })
  }

  // everyone active is expected to report; inactive people only if they did something
  for (const p of profiles) if (p.is_active !== false) get(p.id)

  const people = Object.values(res).map(r => {
    const prof = profiles.find(p => p.id === r.id) || {}
    // planned-at-check-in tasks with no other update still show, marked planned
    for (const id of r.planned) taskEntry(r, id).planned = true
    const taskList = Object.values(r.tasks).map(e => ({ ...e, touched: e.moves.length + e.edits.length + e.comments.length + e.work.length + (e.created ? 1 : 0) > 0 }))
      .sort((a, b) => b.touched - a.touched || b.minutes - a.minutes || a.name.localeCompare(b.name))
    const touched = taskList.filter(t => t.touched)
    const timeline = r.timeline.filter(t => t.at).sort((a, b) => ms(a.at) - ms(b.at))
    const times = r.timeline.flatMap(t => [t.at, t.until]).map(ms).filter(Number.isFinite)
    const att = r.attendance.sort((a, b) => ms(a.in) - ms(b.in))
    const attHours = round1(att.reduce((s, a) => s + (a.hours ?? (a.open && isToday ? Math.max(0, (now - ms(a.in)) / 3600000) : 0)), 0))
    const taskMinutes = touched.reduce((s, t) => s + t.minutes, 0) + (r.otherMinutes || 0)
    return {
      id: r.id, name: prof.full_name || nameById[r.id] || 'Unknown user', role: prof.role || '', department: deptById[prof.department_id] || '',
      departmentId: prof.department_id || null, active: prof.is_active !== false,
      tasks: taskList, attendance: att, timeline,
      checkIn: att[0]?.in || null, checkOut: att.length && !att.some(a => a.open) ? att[att.length - 1].out : null,
      checkedIn: att.length > 0, workingNow: isToday && (att.some(a => a.open) || touched.some(t => t.work.some(w => w.open))),
      attendanceHours: attHours, taskHours: round1(taskMinutes / 60),
      tasksUpdated: touched.length,
      moves: touched.reduce((s, t) => s + t.moves.length, 0),
      completed: touched.filter(t => t.completed).length,
      comments: touched.reduce((s, t) => s + t.comments.length, 0),
      edits: touched.reduce((s, t) => s + t.edits.length, 0),
      created: touched.filter(t => t.created).length,
      plannedCount: r.planned.size,
      firstAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
      lastAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
      status: touched.length ? 'UPDATED' : att.length ? 'PRESENT' : 'NO_UPDATE',
    }
  }).sort((a, b) => order(a) - order(b) || b.tasksUpdated - a.tasksUpdated || a.name.localeCompare(b.name))

  const sum = k => people.reduce((s, p) => s + p[k], 0)
  return {
    date, isToday, people,
    totals: {
      people: people.length, updated: people.filter(p => p.status === 'UPDATED').length,
      checkedIn: people.filter(p => p.checkedIn).length, workingNow: people.filter(p => p.workingNow).length,
      present: people.filter(p => p.status === 'PRESENT').length, noUpdate: people.filter(p => p.status === 'NO_UPDATE').length,
      tasksUpdated: new Set(people.flatMap(p => p.tasks.filter(t => t.touched).map(t => t.id))).size,
      moves: sum('moves'), completed: sum('completed'), comments: sum('comments'), created: sum('created'),
      taskHours: round1(sum('taskHours')), attendanceHours: round1(sum('attendanceHours')),
    },
  }
}
const ORDER = { UPDATED: 0, PRESENT: 1, NO_UPDATE: 2 }
const order = p => ORDER[p.status]

export function fmtMins(m) {
  if (!m) return '0m'
  const h = Math.floor(m / 60), r = Math.round(m % 60)
  return h ? `${h}h${r ? ` ${r}m` : ''}` : `${r}m`
}

export function stripHtml(s) {
  return String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim()
}

// One line per person — Copy (WhatsApp / email).
export function personLine(p) {
  const head = `${p.name}${p.department ? ` (${p.department})` : ''}`
  if (p.status === 'NO_UPDATE') return `${head}: no update`
  const att = p.checkIn ? `in ${hhmm(p.checkIn)}${p.checkOut ? `–${hhmm(p.checkOut)}` : ''}${p.attendanceHours ? ` (${p.attendanceHours} h)` : ''}` : 'no check-in'
  if (p.status === 'PRESENT') return `${head}: ${att}, no task update`
  const tasks = p.tasks.filter(t => t.touched).map(t => {
    const bits = [
      t.created && 'created',
      t.moves.length && t.moves.map(m => m.to).join(' → '),
      t.lastProgress != null && `${t.lastProgress}%`,
      t.comments.length && `${t.comments.length} update${t.comments.length === 1 ? '' : 's'}`,
      t.minutes && fmtMins(t.minutes),
    ].filter(Boolean).join(', ')
    return `${t.code || t.name}${bits ? ` [${bits}]` : ''}`
  })
  return `${head}: ${att} · ${p.tasksUpdated} task(s)${p.completed ? `, ${p.completed} completed` : ''}${p.taskHours ? `, ${p.taskHours} h on tasks` : ''} — ${tasks.join('; ')}`
}
const hhmm = t => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

export function updatesText(s) {
  const t = s.totals
  return [`Daily updates — ${s.date}`, '',
    `Updated: ${t.updated}/${t.people} · Checked in: ${t.checkedIn} · Tasks updated: ${t.tasksUpdated} · Completed: ${t.completed} · Task hours: ${t.taskHours}`, '',
    ...s.people.map(p => `- ${personLine(p)}`)].join('\n')
}
