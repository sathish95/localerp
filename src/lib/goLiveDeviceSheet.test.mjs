// Run: node --test src/lib/goLiveDeviceSheet.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDeviceSheet, planDeviceUpload, DEVICE_COLUMNS } from './goLiveDeviceSheet.js'

const people = [
  { id: 'u1', full_name: 'Cody Coord', email: 'cody@x.io' },
  { id: 'u2', full_name: 'Fern FW', email: 'fern@x.io' },
]
const enr = () => [
  { id: 'e1', device: { device_code: 'DEV-001', serial_number: 'SN1', part_number: 'DG-500' }, site: 'Plant A', equipment_id: 'COMP-01', equipment_name: 'Compressor 1',
    equipment_category: 'Compressor', firmware_version: '1.2.0', connectivity_ref: null, expected_reporting_interval_min: 15, support_status: 'ACTIVE', status_reason: null,
    onsite_coordinator_user_id: 'u1', firmware_engineer_user_id: null, application_engineer_user_id: null, notes: null, version: 3 },
  { id: 'e2', device: { device_code: 'DEV-002', serial_number: 'SN2' }, site: 'Plant B', equipment_id: 'PUMP-02', support_status: 'ACTIVE', expected_reporting_interval_min: 15, version: 1 },
]
const col = k => DEVICE_COLUMNS.findIndex(c => c.key === k)

test('export → re-upload unchanged is a no-op', () => {
  const sheet = buildDeviceSheet(enr(), people)
  assert.equal(sheet[0][0], 'Ref (do not edit)')
  assert.equal(sheet[1][col('onsite_coordinator_user_id')], 'cody@x.io')
  assert.equal(sheet[1][col('support_status')], 'Active')
  const plan = planDeviceUpload(sheet, enr(), people)
  assert.deepEqual(plan, { updates: [], unchanged: 2, notEnrolled: [], errors: [] })
})

test('edited cells become field-level changes', () => {
  const sheet = buildDeviceSheet(enr(), people)
  sheet[1][col('firmware_version')] = '1.3.0'
  sheet[1][col('equipment_category')] = 'Air compressor'
  sheet[1][col('firmware_engineer_user_id')] = 'Fern FW'          // by name also works
  sheet[1][col('onsite_coordinator_user_id')] = ''                // blank = inherit roster
  sheet[1][col('warranty_end')] = '2099-01-01'                     // read-only, ignored
  sheet[2][col('expected_reporting_interval_min')] = '30'
  const plan = planDeviceUpload(sheet, enr(), people)
  assert.equal(plan.updates.length, 2)
  assert.deepEqual(plan.updates[0].changes, {
    equipment_category: { from: 'Compressor', to: 'Air compressor' },
    firmware_version: { from: '1.2.0', to: '1.3.0' },
    onsite_coordinator_user_id: { from: 'u1', to: null },
    firmware_engineer_user_id: { from: null, to: 'u2' },
  })
  assert.deepEqual(plan.updates[1].changes, { expected_reporting_interval_min: { from: 15, to: 30 } })
})

test('matches by device id when the ref column was deleted or re-ordered', () => {
  const sheet = buildDeviceSheet(enr(), people).map(r => r.slice(1).reverse())
  sheet[1][sheet[0].indexOf('Site')] = 'Plant C'
  const plan = planDeviceUpload(sheet, enr(), people)
  assert.equal(plan.updates.length, 1)
  assert.deepEqual(plan.updates[0].changes, { site: { from: 'Plant A', to: 'Plant C' } })
})

test('validation: status needs a reason, bad interval, unknown user, unknown device, duplicate', () => {
  const sheet = buildDeviceSheet(enr(), people)
  sheet[1][col('support_status')] = 'Maintenance'
  sheet[1][col('expected_reporting_interval_min')] = '-5'
  sheet[2][col('application_engineer_user_id')] = 'nobody@x.io'
  sheet.push(['', 'DEV-999', 'SN999'])
  sheet.push([...sheet[2]])
  const plan = planDeviceUpload(sheet, enr(), people)
  assert.equal(plan.updates.length, 0)
  assert.deepEqual(plan.notEnrolled, [{ rowNo: 4, ref: 'DEV-999' }])
  const msgs = plan.errors.map(e => e.message).join(' | ')
  assert.match(msgs, /Maintenance needs a status reason/)
  assert.match(msgs, /must be a positive number/)
  assert.match(msgs, /nobody@x.io” is not a known user/)
  assert.match(msgs, /appears more than once/)
})

test('status change with a reason goes through; decommission warns', () => {
  const sheet = buildDeviceSheet(enr(), people)
  sheet[1][col('support_status')] = 'Decommissioned'
  sheet[1][col('status_reason')] = 'Replaced by DEV-010'
  const plan = planDeviceUpload(sheet, enr(), people)
  assert.equal(plan.updates[0].changes.support_status.to, 'DECOMMISSIONED')
  assert.match(plan.updates[0].issues[0], /stops new checks/)
})

test('rejects a file that is not a device export', () => {
  assert.throws(() => planDeviceUpload([['Name', 'Value']], enr(), people), /Device ID/)
})
