// Run: node --test src/lib/teamDailyUpdates.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTeamDailyUpdates, updatesText, stripHtml, fmtMins } from './teamDailyUpdates.js'

const D = '2026-10-14'
const dayStart = Date.parse('2026-10-14T00:00:00+05:30')
const dayEnd = dayStart + 86400000
const at = hm => new Date(`${D}T${hm}:00+05:30`).toISOString()
const labels = { todo: 'To Do', in_progress: 'In Progress', qa: 'QA', closed: 'Closed' }
const base = {
  date: D, dayStart, dayEnd, now: dayEnd + 3600000, // viewing after the day
  profiles: [
    { id: 'u1', full_name: 'Asha', department_id: 'd1', role: 'employee' },
    { id: 'u2', full_name: 'Ravi', department_id: 'd1' },
    { id: 'u3', full_name: 'Kiran', department_id: 'd2' },
    { id: 'u4', full_name: 'Old Timer', is_active: false },
  ],
  departments: [{ id: 'd1', name: 'Engineering' }, { id: 'd2', name: 'Support' }],
  projects: [{ id: 'p1', name: 'Quarry IoT' }],
  tasks: [
    { id: 't1', task_id: 'TSK-1', task_name: 'Wire gateway', status: 'qa', project_id: 'p1' },
    { id: 't2', task_id: 'TSK-2', task_name: 'Fix login', status: 'closed' },
    { id: 't3', task_id: 'TSK-3', task_name: 'Docs', status: 'todo' },
  ],
  createdTasks: [{ id: 't9', task_id: 'TSK-9', task_name: 'New sensor', status: 'todo', created_by: 'u1', created_at: at('17:00'), assigned_to: 'u2' }],
  changeLog: [
    { task_id: 't1', changed_by: 'u1', field_name: 'status', old_value: 'in_progress', new_value: 'qa', created_at: at('15:00') },
    { task_id: 't2', changed_by: 'u1', field_name: 'status', old_value: 'qa', new_value: 'closed', created_at: at('16:00') },
    { task_id: 't1', changed_by: 'u1', field_name: 'assigned_to', old_value: 'u2', new_value: 'u1', created_at: at('10:30') },
    { task_id: 't1', changed_by: 'u2', field_name: 'status', old_value: 'todo', new_value: 'in_progress', created_at: '2026-10-13T10:00:00Z' }, // previous day
  ],
  comments: [{ task_id: 't1', user_id: 'u1', comment: '<p>Gateway wired, <b>testing</b></p>', progress_pct: 80, created_at: at('14:50') }],
  workLogs: [{ task_id: 't1', employee_id: 'u1', started_at: at('11:00'), ended_at: at('12:30'), duration_minutes: 90, description: 'Crimping' }],
  timeLogs: [
    { employee_id: 'u1', work_date: D, check_in: at('09:05'), check_out: at('18:10'), hours_worked: 9.08 },
    { employee_id: 'u2', work_date: D, check_in: at('09:30'), check_out: null, hours_worked: null },
  ],
  checkinTasks: [{ employee_id: 'u2', task_id: 't3', work_date: D }],
  labelFor: (t, k) => labels[k] || k, isTaskDone: t => t.status === 'closed',
}

test('per person: tasks touched with moves, comments, work and edits', () => {
  const s = buildTeamDailyUpdates(base)
  const a = s.people.find(p => p.id === 'u1')
  assert.equal(a.status, 'UPDATED')
  assert.equal(a.tasksUpdated, 3) // t1, t2, t9
  assert.equal(a.moves, 2)
  assert.equal(a.completed, 1)
  assert.equal(a.comments, 1)
  assert.equal(a.created, 1)
  assert.equal(a.taskHours, 1.5)
  assert.equal(a.department, 'Engineering')
  const t1 = a.tasks.find(t => t.id === 't1')
  assert.deepEqual(t1.moves.map(m => [m.from, m.to]), [['In Progress', 'QA']])
  assert.deepEqual(t1.edits.map(e => [e.field, e.from, e.to]), [['Assignee', 'Ravi', 'Asha']])
  assert.equal(t1.lastProgress, 80)
  assert.equal(t1.project, 'Quarry IoT')
  assert.equal(a.tasks.find(t => t.id === 't2').completed, true)
  assert.deepEqual(a.timeline.map(e => e.kind), ['checkin', 'edit', 'work', 'comment', 'move', 'completed', 'created', 'checkout'])
})

test('checked in without a task update; absent; inactive left out', () => {
  const s = buildTeamDailyUpdates(base)
  const by = Object.fromEntries(s.people.map(p => [p.id, p]))
  assert.equal(by.u2.status, 'PRESENT') // yesterday's move doesn't count
  assert.equal(by.u2.tasks.find(t => t.id === 't3').planned, true)
  assert.equal(by.u2.checkOut, null)
  assert.equal(by.u3.status, 'NO_UPDATE')
  assert.equal(by.u4, undefined)
  assert.deepEqual(s.people.map(p => p.status), ['UPDATED', 'PRESENT', 'NO_UPDATE'])
  assert.equal(s.totals.updated, 1)
  assert.equal(s.totals.checkedIn, 2)
  assert.equal(s.totals.tasksUpdated, 3)
})

test('today: open check-in and running work session count as working now', () => {
  const now = Date.parse(at('13:00'))
  const s = buildTeamDailyUpdates({ ...base, now, workLogs: [{ task_id: 't1', employee_id: 'u1', started_at: at('12:00'), ended_at: null }] })
  const a = s.people.find(p => p.id === 'u1')
  assert.equal(a.workingNow, true)
  assert.equal(a.taskHours, 1)
  assert.equal(s.people.find(p => p.id === 'u2').workingNow, true)
})

test('text helpers', () => {
  assert.equal(stripHtml('<p>Hi&nbsp;<b>there</b></p><p>x</p>'), 'Hi there\nx')
  assert.equal(fmtMins(90), '1h 30m')
  const txt = updatesText(buildTeamDailyUpdates(base))
  assert.match(txt, /Asha \(Engineering\): in \d\d:\d\d–\d\d:\d\d \(9\.1 h\) · 3 task\(s\), 1 completed, 1\.5 h on tasks/)
  assert.match(txt, /Ravi \(Engineering\): in \d\d:\d\d, no task update/)
  assert.match(txt, /Kiran \(Support\): no update/)
})
