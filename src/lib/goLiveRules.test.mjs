// Unit tests for the Go-Live Support rules (acceptance criteria 1 & 2).
// Run: node --test src/lib/goLiveRules.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeDailyResult, computeFollowUpFlag, inferIncidentCategory, transitionErrors,
  isStaleWhileOnline, mapEnum, excelToUtcIso, istToday, computeKpis, matchPerson,
} from './goLiveRules.js'

const healthy = () => ({
  enrollment_id: 'e1', check_date: '2026-09-30', site_snapshot: 'Plant A',
  onsite_coordinator_user_id: 'u1', power_check: 'PASS', cable_indicator_check: 'PASS', connectivity: 'ONLINE',
  last_data_received_at: '2026-09-30T04:00:00Z', firmware_health: 'PASS', firmware_reviewer_user_id: 'u2',
  application_health: 'PASS', application_reviewer_user_id: 'u3', data_quality: 'PASS',
  parameter_checks: { fuel_level: 'WORKING', engine_load: 'NA' },
})

/* ── §5.1 daily result ── */

test('1. no device → no result', () => {
  assert.equal(computeDailyResult({ ...healthy(), enrollment_id: null }), null)
  assert.equal(computeDailyResult(null), null)
})

test('2. missing date → INCOMPLETE (even with a FAIL)', () => {
  assert.equal(computeDailyResult({ ...healthy(), check_date: '' }), 'INCOMPLETE')
  assert.equal(computeDailyResult({ ...healthy(), check_date: null, power_check: 'FAIL' }), 'INCOMPLETE')
})

test('3. duplicate (import) outranks attention and device check', () => {
  assert.equal(computeDailyResult({ ...healthy(), power_check: 'FAIL' }, { duplicate: true }), 'DUPLICATE')
  assert.equal(computeDailyResult(healthy(), { duplicate: true, deviceUnmatched: true }), 'DUPLICATE')
})

test('4. unmatched device (import) → CHECK_DEVICE_ID', () => {
  assert.equal(computeDailyResult({ enrollment_id: null, device_ref: 'D-9', check_date: '2026-09-30' }, { deviceUnmatched: true }), 'CHECK_DEVICE_ID')
})

test('5. each failing field → ATTENTION', () => {
  for (const f of ['power_check', 'cable_indicator_check', 'firmware_health', 'application_health', 'data_quality']) {
    assert.equal(computeDailyResult({ ...healthy(), [f]: 'FAIL' }), 'ATTENTION', f)
  }
  assert.equal(computeDailyResult({ ...healthy(), connectivity: 'OFFLINE' }), 'ATTENTION')
  assert.equal(computeDailyResult({ ...healthy(), connectivity: 'INTERMITTENT' }), 'ATTENTION')
})

test('5b. ATTENTION outranks INCOMPLETE (fail with reviews still blank)', () => {
  const c = { ...healthy(), power_check: 'FAIL', firmware_health: null, firmware_reviewer_user_id: null, application_health: null, application_reviewer_user_id: null, data_quality: null }
  assert.equal(computeDailyResult(c), 'ATTENTION')
  assert.equal(computeDailyResult({ ...healthy(), connectivity: 'OFFLINE', site_snapshot: '' }), 'ATTENTION')
})

test('6. every blank required field → INCOMPLETE', () => {
  for (const f of ['site_snapshot', 'onsite_coordinator_user_id', 'power_check', 'cable_indicator_check', 'connectivity',
    'last_data_received_at', 'firmware_health', 'firmware_reviewer_user_id', 'application_health', 'application_reviewer_user_id', 'data_quality']) {
    assert.equal(computeDailyResult({ ...healthy(), [f]: null }), 'INCOMPLETE', f)
    assert.equal(computeDailyResult({ ...healthy(), [f]: '  ' }), 'INCOMPLETE', `${f} whitespace`)
  }
})

test('6b. any NOT_CHECKED → INCOMPLETE', () => {
  for (const f of ['power_check', 'cable_indicator_check', 'connectivity', 'firmware_health', 'application_health', 'data_quality']) {
    assert.equal(computeDailyResult({ ...healthy(), [f]: 'NOT_CHECKED' }), 'INCOMPLETE', f)
  }
})

test('6c. legacy (unmatched Excel) names count as filled', () => {
  const c = { ...healthy(), onsite_coordinator_user_id: null, onsite_coordinator_legacy: 'Ravi', firmware_reviewer_user_id: null, firmware_reviewer_legacy: 'Anu' }
  assert.equal(computeDailyResult(c), 'HEALTHY')
})

test('7. NOT_APPLICABLE counts as satisfied → HEALTHY', () => {
  const c = { ...healthy(), power_check: 'NOT_APPLICABLE', cable_indicator_check: 'NOT_APPLICABLE', connectivity: 'NOT_APPLICABLE', data_quality: 'NOT_APPLICABLE' }
  assert.equal(computeDailyResult(c), 'HEALTHY')
  assert.equal(computeDailyResult(healthy()), 'HEALTHY')
})

test('R-A1 category inference', () => {
  assert.equal(inferIncidentCategory({ power_check: 'FAIL' }), 'HARDWARE')
  assert.equal(inferIncidentCategory({ cable_indicator_check: 'FAIL' }), 'HARDWARE')
  assert.equal(inferIncidentCategory({ connectivity: 'INTERMITTENT' }), 'CONNECTIVITY')
  assert.equal(inferIncidentCategory({ firmware_health: 'FAIL' }), 'FIRMWARE')
  assert.equal(inferIncidentCategory({ application_health: 'FAIL' }), 'APPLICATION')
  assert.equal(inferIncidentCategory({ data_quality: 'FAIL' }), 'DATA_QUALITY')
})

test('R-A2 stale data while online', () => {
  const at = new Date('2026-09-30T05:00:00Z')
  assert.equal(isStaleWhileOnline({ connectivity: 'ONLINE', last_data_received_at: '2026-09-30T04:29:00Z' }, 15, 2, at), true)  // 31 > 30
  assert.equal(isStaleWhileOnline({ connectivity: 'ONLINE', last_data_received_at: '2026-09-30T04:30:00Z' }, 15, 2, at), false) // 30 = 30
  assert.equal(isStaleWhileOnline({ connectivity: 'OFFLINE', last_data_received_at: '2026-09-29T00:00:00Z' }, 15, 2, at), false)
})

/* ── §5.2 follow-up flag ── */

const now = new Date('2026-09-30T06:00:00Z')
const openInc = () => ({
  status: 'IN_PROGRESS', reported_at: '2026-09-29T06:00:00Z', priority: 'P2_HIGH', assigned_owner_user_id: 'u1',
  next_action: 'Replace SIM', action_due_at: '2026-09-30T10:00:00Z',
})

test('CLOSED with full closure → CLOSED', () => {
  const i = { ...openInc(), status: 'CLOSED', resolved_at: 'x', root_cause_resolution: 'SIM', verified_by_user_id: 'u9', closed_at: 'y', next_action: '' }
  assert.equal(computeFollowUpFlag(i, now), 'CLOSED')
})

test('CLOSED missing any closure field → CLOSURE_INCOMPLETE', () => {
  const base = { ...openInc(), status: 'CLOSED', resolved_at: 'x', root_cause_resolution: 'SIM', verified_by_user_id: 'u9', closed_at: 'y' }
  for (const f of ['resolved_at', 'root_cause_resolution', 'verified_by_user_id', 'closed_at']) {
    assert.equal(computeFollowUpFlag({ ...base, [f]: null }, now), 'CLOSURE_INCOMPLETE', f)
  }
  assert.equal(computeFollowUpFlag({ ...base, verified_by_user_id: null, verified_by_legacy: 'Kumar' }, now), 'CLOSED')
})

test('closed check wins even when overdue', () => {
  assert.equal(computeFollowUpFlag({ status: 'CLOSED', action_due_at: '2020-01-01T00:00:00Z' }, now), 'CLOSURE_INCOMPLETE')
})

test('any blank ticket field → COMPLETE_TICKET', () => {
  for (const f of ['reported_at', 'priority', 'assigned_owner_user_id', 'status', 'next_action', 'action_due_at']) {
    assert.equal(computeFollowUpFlag({ ...openInc(), [f]: null }, now), 'COMPLETE_TICKET', f)
  }
})

test('COMPLETE_TICKET outranks OVERDUE', () => {
  assert.equal(computeFollowUpFlag({ ...openInc(), next_action: '', action_due_at: '2020-01-01T00:00:00Z' }, now), 'COMPLETE_TICKET')
})

test('due in the past → OVERDUE; due exactly now → ON_TRACK; future → ON_TRACK', () => {
  assert.equal(computeFollowUpFlag({ ...openInc(), action_due_at: '2026-09-30T05:59:59Z' }, now), 'OVERDUE')
  assert.equal(computeFollowUpFlag({ ...openInc(), action_due_at: '2026-09-30T06:00:00Z' }, now), 'ON_TRACK')
  assert.equal(computeFollowUpFlag(openInc(), now), 'ON_TRACK')
})

test('RESOLVED past due still OVERDUE (Excel is literal)', () => {
  assert.equal(computeFollowUpFlag({ ...openInc(), status: 'RESOLVED', action_due_at: '2026-09-29T00:00:00Z' }, now), 'OVERDUE')
})

/* ── §7.3 guards ── */

test('transition guards', () => {
  assert.deepEqual(transitionErrors({ status: 'OPEN' }, 'IN_PROGRESS'), ['Assigned owner', 'Next action', 'Action due'])
  assert.deepEqual(transitionErrors({ ...openInc() }, 'AWAITING_VENDOR'), ['Vendor reference'])
  assert.deepEqual(transitionErrors({ ...openInc() }, 'RESOLVED'), ['Root cause / resolution'])
  assert.deepEqual(transitionErrors({ ...openInc() }, 'CLOSED'), ['Must be RESOLVED before closing', 'Verified by'])
  assert.deepEqual(transitionErrors({ ...openInc(), status: 'RESOLVED', verified_by_user_id: 'u1' }, 'CLOSED'), ['Verifier must differ from the owner'])
  assert.deepEqual(transitionErrors({ ...openInc(), status: 'RESOLVED', verified_by_user_id: 'u2' }, 'CLOSED'), [])
  assert.deepEqual(transitionErrors({ ...openInc(), status: 'CLOSED' }, 'IN_PROGRESS'), ['Reason to reopen'])
})

/* ── import mapping ── */

test('enum mapping from Excel dropdowns', () => {
  assert.equal(mapEnum('priority', 'P1 - Critical'), 'P1_CRITICAL')
  assert.equal(mapEnum('priority', 'P3-Normal'), 'P3_NORMAL')
  assert.equal(mapEnum('check', 'Not checked'), 'NOT_CHECKED')
  assert.equal(mapEnum('check', 'N/A'), 'NOT_APPLICABLE')
  assert.equal(mapEnum('connectivity', 'Intermittent'), 'INTERMITTENT')
  assert.equal(mapEnum('incidentStatus', 'Awaiting vendor'), 'AWAITING_VENDOR')
  assert.equal(mapEnum('category', 'Data quality'), 'DATA_QUALITY')
  assert.equal(mapEnum('check', ''), null)
  assert.equal(mapEnum('check', 'maybe'), undefined)
})

test('Excel IST values → UTC', () => {
  // 46295 = 2026-09-30; .5 = 12:00 IST → 06:30Z
  assert.equal(excelToUtcIso(46295.5), '2026-09-30T06:30:00.000Z')
  assert.equal(excelToUtcIso(46295, { dateOnly: true }), '2026-09-30')
  assert.equal(excelToUtcIso('30/09/2026 09:15'), '2026-09-30T03:45:00.000Z')
  assert.equal(excelToUtcIso('2026-09-30 00:10'), '2026-09-29T18:40:00.000Z')
  assert.equal(excelToUtcIso('30-Sep-2026', { dateOnly: true }), '2026-09-30')
  assert.equal(excelToUtcIso('rubbish'), undefined)
})

test('IST today rolls over at 18:30Z', () => {
  assert.equal(istToday(new Date('2026-09-30T18:29:00Z')), '2026-09-30')
  assert.equal(istToday(new Date('2026-09-30T18:30:00Z')), '2026-10-01')
})

test('person matching', () => {
  const people = [{ id: 'a', full_name: 'Ravi Kumar' }, { id: 'b', full_name: 'Anu Priya' }, { id: 'c', full_name: 'Ravi Shankar' }]
  assert.deepEqual(matchPerson('ravi kumar', people), { id: 'a', confidence: 'exact' })
  assert.deepEqual(matchPerson('Anu', people), { id: 'b', confidence: 'fuzzy' })
  assert.equal(matchPerson('Ravi', people), null) // ambiguous
  assert.equal(matchPerson('', people), null)
})

/* ── §9 KPIs (MAINTENANCE excluded from missing) ── */

test('KPIs: coverage and missing exclude MAINTENANCE', () => {
  const enrollments = [
    { id: 'e1', support_status: 'ACTIVE' }, { id: 'e2', support_status: 'ACTIVE' },
    { id: 'e3', support_status: 'MAINTENANCE' }, { id: 'e4', support_status: 'DECOMMISSIONED', unenrolled_at: 'x' },
  ]
  const checks = [
    { enrollment_id: 'e1', daily_result: 'HEALTHY', reviewed_complete_at: 'x' },
    { enrollment_id: 'e3', daily_result: 'ATTENTION' },
  ]
  const incidents = [
    { status: 'OPEN', priority: 'P1_CRITICAL' },
    { ...openInc(), action_due_at: '2026-09-30T01:00:00Z' },
    { status: 'CLOSED', priority: 'P1_CRITICAL' },
  ]
  const k = computeKpis({ enrollments, checks, incidents, now })
  assert.equal(k.activeDevices, 2)
  assert.equal(k.checksLogged, 2)
  assert.equal(k.healthy, 1)
  assert.equal(k.attention, 1)
  assert.equal(k.missingCount, 1)
  assert.equal(k.missing[0].id, 'e2')
  assert.equal(k.coveragePct, 50)
  assert.equal(k.healthyPct, 50)
  assert.equal(k.pendingReviews, 1)
  assert.equal(k.openTickets, 2)
  assert.equal(k.criticalOpen, 1)
  assert.equal(k.overdue, 1)
})

test('application parameter checklist: tick = working, untick = not working, N/A', async () => {
  const { DEFAULT_CHECK_PARAMETERS, checkParameters, fillParameterChecks, parameterSummary, parseParameterLines, parameterLines } = await import('./goLiveRules.js')
  assert.equal(DEFAULT_CHECK_PARAMETERS.length, 12)
  assert.equal(DEFAULT_CHECK_PARAMETERS[0].key, 'fuel_level')
  assert.equal(new Set(DEFAULT_CHECK_PARAMETERS.map(p => p.key)).size, 12)
  assert.equal(checkParameters({}), DEFAULT_CHECK_PARAMETERS)
  const params = parseParameterLines('Fuel Level | ltr\n\n Engine Load|% \nfuel level\nSerial Number')
  assert.deepEqual(params, [
    { key: 'fuel_level', label: 'Fuel Level', unit: 'ltr' },
    { key: 'engine_load', label: 'Engine Load', unit: '%' },
    { key: 'serial_number', label: 'Serial Number', unit: '' },
  ])
  assert.deepEqual(parseParameterLines(parameterLines(params)), params)
  assert.deepEqual(checkParameters({ parameters: params }), params)
  const filled = fillParameterChecks({ fuel_level: 'WORKING', serial_number: 'NA', engine_load: 'bogus', gone: 'WORKING' }, params)
  assert.deepEqual(filled, { fuel_level: 'WORKING', engine_load: 'NOT_WORKING', serial_number: 'NA' })
  const s = parameterSummary({ ...filled, gone: 'NOT_WORKING' }, params)
  assert.deepEqual(s, { reviewed: true, working: 1, notWorking: 1, na: 1, notWorkingLabels: ['Engine Load'] })
  assert.equal(parameterSummary(null, params).reviewed, false)
})

test('Operation (connectivity) accepts Yes / No and the old wording', async () => {
  const { mapEnum: m, failingFields } = await import('./goLiveRules.js')
  assert.equal(m('connectivity', 'Yes'), 'ONLINE')
  assert.equal(m('connectivity', 'no'), 'OFFLINE')
  assert.equal(m('connectivity', 'Online'), 'ONLINE')
  assert.equal(m('connectivity', 'Offline'), 'OFFLINE')
  assert.deepEqual(failingFields({ connectivity: 'OFFLINE' }), ['Operation: No'])
})

test('STEP249: parameters, sensors and the mandatory checklist change the result', async () => {
  const { SEVERITIES, failingFields } = await import('./goLiveRules.js')
  assert.equal(computeDailyResult({ ...healthy(), parameter_checks: { fuel_level: 'NOT_WORKING' } }), 'ATTENTION')
  assert.equal(computeDailyResult(healthy(), { faultySensors: 1 }), 'ATTENTION')
  assert.equal(computeDailyResult(healthy(), { faultySensors: 0 }), 'HEALTHY')
  assert.equal(computeDailyResult({ ...healthy(), connectivity: 'OFFLINE' }), 'ATTENTION')   // Operation = No
  // checklist is optional (STEP254): not reviewed doesn't make the day incomplete
  assert.equal(computeDailyResult({ ...healthy(), parameter_checks: null }), 'HEALTHY')
  assert.equal(computeDailyResult({ ...healthy(), parameter_checks: null }, { imported: true }), 'HEALTHY')
  assert.equal(computeDailyResult({ ...healthy(), parameter_checks: null, import_batch_id: 'b1' }), 'HEALTHY')
  // all N/A is a saved checklist
  assert.equal(computeDailyResult({ ...healthy(), parameter_checks: { fuel_level: 'NA' } }), 'HEALTHY')
  assert.deepEqual(failingFields({ ...healthy(), parameter_checks: { a: 'NOT_WORKING', b: 'NOT_WORKING' }, faulty_sensors: 1 }), ['2 parameters not working', '1 sensor faulty'])
  assert.equal(inferIncidentCategory({ parameter_checks: { a: 'NOT_WORKING' } }), 'DATA_QUALITY')
  assert.deepEqual(SEVERITIES.map(s => s.priority), ['P2_HIGH', 'P3_NORMAL', 'P4_REQUEST'])
})

test('STEP250: maintenance excuses Operation = No; fleet summary', async () => {
  const { fleetSummary } = await import('./goLiveRules.js')
  assert.equal(computeDailyResult({ ...healthy(), connectivity: 'OFFLINE', equipment_maintenance: true }), 'HEALTHY')
  assert.equal(computeDailyResult({ ...healthy(), connectivity: 'OFFLINE', equipment_maintenance: false }), 'ATTENTION')
  assert.equal(computeDailyResult({ ...healthy(), power_check: 'FAIL', equipment_maintenance: true }), 'ATTENTION')   // only Operation is excused
  const f = fleetSummary([
    { category: 'Dumper', last_result: 'HEALTHY', connectivity: 'ONLINE', sensors_total: 4, sensors_working: 4, sensors_down: 0, sensors_missing: 0 },
    { category: 'Dumper', last_result: 'ATTENTION', connectivity: 'OFFLINE', sensors_total: 4, sensors_working: 2, sensors_down: 1, sensors_missing: 1 },
    { category: 'Pump', last_result: 'HEALTHY', connectivity: 'OFFLINE', last_maintenance: true, sensors_total: 2, sensors_working: 2 },
    { category: 'Pump', support_status: 'MAINTENANCE', sensors_total: 0, sensors_missing: 2 },
  ])
  assert.deepEqual(f.total, { devices: 4, sensorsInstalled: 10, workingDevices: 2, notWorkingDevices: 1, noCheck: 1, workingSensors: 8, notWorkingSensors: 1, sensorsNotInstalled: 3, sensorsUnreviewed: 1, maintenance: 2, noOperation: 1 })
  assert.deepEqual(f.categories.map(c => [c.category, c.devices, c.maintenance]), [['Dumper', 2, 0], ['Pump', 2, 2]])
})
