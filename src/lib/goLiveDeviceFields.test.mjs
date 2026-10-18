// Run: node --test src/lib/goLiveDeviceFields.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFieldLines, fieldLines, matchDevice, goLiveCounts, coerceFieldValue, filterChoices, deviceFields } from './goLiveDeviceFields.js'
import { buildDeviceSheet, planDeviceUpload, sheetColumns, changesToPatch } from './goLiveDeviceSheet.js'

const fields = parseFieldLines('Zone | list | North, South\nContract ref | text\nCritical asset | yesno\n\nZone | text\nGo-live | text')

test('field lines parse, dedupe and round-trip', () => {
  assert.deepEqual(fields, [
    { key: 'zone', label: 'Zone', type: 'list', options: ['North', 'South'] },
    { key: 'contract_ref', label: 'Contract ref', type: 'text' },
    { key: 'critical_asset', label: 'Critical asset', type: 'yesno' },
  ])
  assert.deepEqual(parseFieldLines(fieldLines(fields)), fields)
  assert.equal(parseFieldLines('Area | | A, B')[0].type, 'list') // options imply a list
  assert.deepEqual(deviceFields({ device_fields: fields }), fields)
  assert.deepEqual(deviceFields(null), [])
})

const enr = [
  { id: 'a', is_golive: true, custom_fields: { zone: 'North', critical_asset: true } },
  { id: 'b', is_golive: false, custom_fields: { zone: 'South' } },
  { id: 'c', custom_fields: {} },
  { id: 'd', is_golive: true, unenrolled_at: '2026-10-01' },
]

test('device filter: go-live and custom fields', () => {
  const ids = df => enr.filter(e => matchDevice(e, df, fields)).map(e => e.id)
  assert.deepEqual(ids({ golive: '', fields: {} }), ['a', 'b', 'c', 'd'])
  assert.deepEqual(ids({ golive: 'YES', fields: {} }), ['a', 'd'])
  assert.deepEqual(ids({ golive: 'NO', fields: {} }), ['b', 'c'])
  assert.deepEqual(ids({ golive: '', fields: { zone: 'South' } }), ['b'])
  assert.deepEqual(ids({ golive: '', fields: { zone: '__blank' } }), ['c', 'd'])
  assert.deepEqual(ids({ golive: 'YES', fields: { critical_asset: 'Yes' } }), ['a'])
})

test('go-live counts ignore unenrolled devices', () => {
  assert.deepEqual(goLiveCounts(enr), { total: 3, live: 1, notLive: 2, pct: 33 })
  assert.deepEqual(goLiveCounts([]), { total: 0, live: 0, notLive: 0, pct: 0 })
})

test('values are coerced per field type', () => {
  assert.deepEqual(coerceFieldValue(fields[0], 'north'), { value: 'North' })
  assert.ok(coerceFieldValue(fields[0], 'West').error)
  assert.deepEqual(coerceFieldValue(fields[2], 'Y'), { value: true })
  assert.deepEqual(coerceFieldValue(fields[2], ''), { value: null })
  assert.ok(coerceFieldValue(fields[2], 'maybe').error)
  assert.deepEqual(coerceFieldValue(fields[1], '  '), { value: null })
  assert.deepEqual(filterChoices(fields[0], [{ custom_fields: { zone: 'East' } }]), ['East', 'North', 'South'])
})

test('sheet: go-live and custom columns round-trip', () => {
  const rows = [
    { id: 'e1', device: { device_code: 'DEV-1' }, support_status: 'ACTIVE', expected_reporting_interval_min: 15, is_golive: false, custom_fields: { zone: 'North' } },
    { id: 'e2', device: { device_code: 'DEV-2' }, support_status: 'ACTIVE', expected_reporting_interval_min: 15 }, // pre-STEP259 row
  ]
  const cols = sheetColumns(fields)
  const col = k => cols.findIndex(c => c.key === k)
  const sheet = buildDeviceSheet(rows, [], { fields })
  assert.equal(sheet[0][col('cf:zone')], 'Zone')
  assert.equal(sheet[1][col('is_golive')], 'No')
  assert.deepEqual(planDeviceUpload(sheet, rows, [], fields).updates, [])

  sheet[1][col('is_golive')] = 'Yes'
  sheet[1][col('cf:zone')] = 'south'
  sheet[1][col('cf:critical_asset')] = 'yes'
  sheet[2][col('cf:zone')] = 'Nowhere'
  const plan = planDeviceUpload(sheet, rows, [], fields)
  assert.equal(plan.updates.length, 1)
  assert.deepEqual(changesToPatch(rows[0], plan.updates[0].changes), { is_golive: true, custom_fields: { zone: 'South', critical_asset: true } })
  assert.equal(plan.errors.length, 1)
  assert.match(plan.errors[0].message, /Zone/)
})
