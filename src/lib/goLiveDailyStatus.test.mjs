// Run: node --test src/lib/goLiveDailyStatus.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDailyStatus, statusText } from './goLiveDailyStatus.js'

const D = '2026-10-14'
const names = { u1: 'Asha', u2: 'Ravi', u3: 'Kiran', u4: 'Meena', u5: 'Suresh' }
const base = {
  date: D, today: D,
  enrollments: [{ id: 'e1', equipment_id: '4100190', equipment_name: 'DG 125', device_id: 'd1' }, { id: 'e2', equipment_id: '4100561' }, { id: 'e3', equipment_id: 'X3' }],
  checks: [
    { enrollment_id: 'e1', check_date: D, daily_result: 'ATTENTION', onsite_submitted_by: 'u1', onsite_submitted_at: '2026-10-14T04:00:00Z', firmware_submitted_by: 'u2', firmware_submitted_at: '2026-10-14T06:00:00Z', observation_action: 'Cable loose', updated_by: 'u1', updated_at: '2026-10-14T06:30:00Z' },
    { enrollment_id: 'e2', check_date: D, daily_result: 'HEALTHY', onsite_submitted_by: 'u1', onsite_submitted_at: '2026-10-14T05:00:00Z' },
    { enrollment_id: 'e3', check_date: '2026-10-13', daily_result: 'HEALTHY', onsite_submitted_by: 'u3' }, // other day
  ],
  incidents: [{ id: 'i1', number: 'GLI-1', title: 'No data', priority: 'P2_HIGH', status: 'OPEN', reported_at: '2026-10-14T07:00:00Z', created_by: 'u2' }],
  events: [{ entity: 'incident', event_type: 'status_changed', entity_id: 'i1', actor_id: 'u5', created_at: '2026-10-14T09:00:00Z', changes: { status: { from: 'OPEN', to: 'IN_PROGRESS' } } }],
  comments: [{ incident_id: 'i1', body: 'Rebooted', created_by: 'u2', created_at: '2026-10-14T08:00:00Z', hours_spent: 1.5 }],
  notes: [{ enrollment_id: 'e2', body: 'Hinge broken', is_issue: true, severity: 'MEDIUM', created_by: 'u1', created_at: '2026-10-14T05:30:00Z' }],
  visits: [{ employee_id: 'u1', work_date: D, site: 'Plant A', check_in: '2026-10-14T03:30:00Z', check_out: null, devices: [{ device_id: 'd1', activity_type: 'REPAIR', minutes: 30 }] }],
  roster: [
    { role: 'ONSITE_COORDINATOR', primary_user_id: 'u1', backup_user_id: 'u3', effective_from: '2026-09-01' },
    { role: 'FIRMWARE_ENGINEER', primary_user_id: 'u2', effective_from: '2026-09-01' },
    { role: 'APPLICATION_ENGINEER', primary_user_id: 'u3', effective_from: '2026-09-01', effective_to: '2026-10-01' }, // ended
    { role: 'ESCALATION_OWNER', primary_user_id: 'u4', effective_from: '2026-09-01' },
  ],
  pmUserId: 'u4', person: id => names[id] || '', deviceLabel: () => 'dev',
}

test('groups the day per person with status, sections and timeline', () => {
  const s = buildDailyStatus(base)
  const by = Object.fromEntries(s.people.map(p => [p.id, p]))
  assert.equal(by.u1.status, 'ON_SITE') // open visit today
  assert.deepEqual(by.u1.sections, { onsite: 2, firmware: 0, application: 0 })
  assert.equal(by.u1.checked, 2)
  assert.equal(by.u1.attention, 1)
  assert.equal(by.u1.observations.length, 1)
  assert.equal(by.u1.issues, 1)
  assert.deepEqual(by.u1.timeline.map(t => t.kind), ['visit', 'check', 'issue', 'observation'])
  assert.equal(by.u1.visits[0].devices[0].device, 'DG 125 · 4100190')
  assert.equal(by.u2.status, 'UPDATED')
  assert.equal(by.u2.incidentCount, 2) // raised + update
  assert.equal(by.u2.incidentHours, 1.5)
  assert.equal(by.u5.onRoster, false)
  assert.equal(by.u3.status, 'NO_UPDATE') // yesterday's check doesn't count
  assert.deepEqual(by.u3.roles.map(r => [r.key, r.backup]), [['ONSITE_COORDINATOR', true]]) // ended role dropped
  assert.deepEqual(by.u4.roles.map(r => r.key), ['PM', 'ESCALATION_OWNER'])
  // people with updates first, idle last
  assert.deepEqual(s.people.map(p => p.status === 'NO_UPDATE'), [false, false, false, true, true])
})

test('totals and role coverage', () => {
  const s = buildDailyStatus(base)
  assert.equal(s.totals.team, 4) // u1, u2, u3 (backup), u4
  assert.equal(s.totals.teamUpdated, 2)
  assert.equal(s.totals.contributors, 3)
  assert.equal(s.totals.onSite, 1)
  assert.equal(s.totals.checked, 2)
  assert.equal(s.totals.devices, 3)
  assert.equal(s.roles.find(r => r.key === 'APPLICATION_ENGINEER').primary, null)
  assert.equal(s.roles.find(r => r.key === 'ONSITE_COORDINATOR').backupPerson.name, 'Kiran')
})

test('past date: an open visit is not "on site now"', () => {
  const s = buildDailyStatus({ ...base, today: '2026-10-15' })
  assert.equal(s.people.find(p => p.id === 'u1').status, 'UPDATED')
})

test('plain-text digest', () => {
  const txt = statusText(buildDailyStatus(base), 'Quarry')
  assert.match(txt, /Asha \(Onsite Coordinator\): 2 device check\(s\) \(onsite 2\), 1 need attention/)
  assert.match(txt, /Meena \(Project manager, Escalation Owner\): no update logged/)
})
