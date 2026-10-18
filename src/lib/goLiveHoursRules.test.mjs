// Run: node --test src/lib/goLiveHoursRules.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectColumns, parseHoursSheet, applyHoursEdit, matchEquipment, findDuplicateRows, summarizeHours, buildInsights, hoursStatus, toleranceFor, fuelLph } from './goLiveHoursRules.js'

test('detects the manual report layout (header not on row 1)', () => {
  const rows = [['Client daily log'], [], ['Equipment ID', 'Category', 'Date', 'Running hrs', 'Offline hrs']]
  assert.deepEqual(detectColumns(rows), { headerRow: 2, map: { equipment: 0, date: 2, offline: 4, fuel: -1, category: 1, running: 3 } })
})

test('offline column is not mistaken for running hours', () => {
  const d = detectColumns([['Asset', 'Day', 'Offline hours', 'Online hours']])
  assert.equal(d.map.running, 3)
  assert.equal(d.map.offline, 2)
})

test('parses values, Excel serials, hh:mm and flags bad rows', () => {
  const rows = [
    ['Equipment ID', 'Category', 'Date', 'Running hrs', 'Offline hrs'],
    ['COMP-01', 'Compressor', 46295, 18.5, 5.5],
    ['PUMP-02', 'Pump', '30/09/2026', '22:30', ''],
    ['PUMP-03', '', 'someday', 25, 1],
    [null, null, null, null, null],
    ['FAN-9', '', '2026-09-30', 20, 6],
  ]
  const { rows: out } = parseHoursSheet(rows)
  assert.equal(out.length, 4)
  assert.deepEqual(out[0], { rowNo: 2, equipment_ref: 'COMP-01', category: 'Compressor', date: '2026-09-30', running_hours: 18.5, offline_hours: 5.5, fuel_litres: null, issues: [] })
  assert.equal(out[1].running_hours, 22.5)
  assert.equal(out[1].date, '2026-09-30')
  // no 24 h cap (STEP253): engine hours can be any non-negative amount
  assert.deepEqual(out[2].issues, ['Date "someday" not recognised'])
  assert.deepEqual(out[3].issues, [])
})

test('rejects a sheet without the needed columns', () => {
  assert.throws(() => parseHoursSheet([['Name', 'Value']]), /header row/)
})

test('equipment matching prefers equipment id, then name / device code / serial', () => {
  const enr = [
    { id: 'a', equipment_id: 'COMP-01', device: { device_code: 'DEV-001', serial_number: 'SN1' } },
    { id: 'b', equipment_id: 'PUMP-02', equipment_name: 'Main Pump', device: { device_code: 'DEV-002', serial_number: 'SN2' } },
  ]
  assert.equal(matchEquipment('comp 01', enr).id, 'a')
  assert.equal(matchEquipment('Main Pump', enr).id, 'b')
  assert.equal(matchEquipment('SN2', enr).id, 'b')
  assert.equal(matchEquipment('DEV-9', enr), null)
})

test('duplicate equipment+date rows in one file', () => {
  const d = findDuplicateRows([{ rowNo: 2, equipment_ref: 'A', date: '2026-09-30' }, { rowNo: 3, equipment_ref: 'a', date: '2026-09-30' }, { rowNo: 4, equipment_ref: 'A', date: '2026-09-29' }])
  assert.deepEqual([...d].sort(), [2, 3])
})

const view = [
  { enrollment_id: 'a', equipment_id: 'COMP-01', equipment_category: 'Compressor', reading_date: '2026-09-28', manual_hours: 20, iot_hours: 20.3, status: 'MATCH' },
  { enrollment_id: 'a', equipment_id: 'COMP-01', equipment_category: 'Compressor', reading_date: '2026-09-29', manual_hours: 20, iot_hours: 21, status: 'MISMATCH', action_status: 'OPEN' },
  { enrollment_id: 'b', equipment_id: 'PUMP-02', equipment_category: 'Pump', reading_date: '2026-09-28', manual_hours: 12, iot_hours: 12, status: 'MATCH' },
  { enrollment_id: 'b', equipment_id: 'PUMP-02', equipment_category: 'Pump', reading_date: '2026-09-29', manual_hours: null, iot_hours: 9, status: 'MISSING_MANUAL' },
  { enrollment_id: 'b', equipment_id: 'PUMP-02', equipment_category: 'Pump', reading_date: '2026-09-30', manual_hours: 10, iot_hours: 12, status: 'MISMATCH' },
]

test('category and equipment roll-ups', () => {
  const s = summarizeHours(view)
  assert.equal(s.total.compared, 4)
  assert.equal(s.total.matchRate, 50)
  assert.equal(s.total.missingManual, 1)
  assert.equal(s.total.openActions, 1)
  assert.equal(s.total.unactionedMismatches, 1)
  const comp = s.categories.find(c => c.category === 'Compressor')
  assert.equal(comp.manualHours, 40)
  assert.equal(comp.iotHours, 41.3)
  assert.equal(comp.diffPct, 3.25)
  assert.equal(comp.manualUptimePct, 83.3)
  const pump = s.equipment.find(e => e.equipment_id === 'PUMP-02')
  assert.equal(pump.days, 3)
  assert.equal(pump.manualHours, 22) // missing-manual day excluded from totals
  assert.equal(pump.iotHours, 24)
})

test('insights flag low match rate, bias, missing data and offline devices', () => {
  const hours = []
  for (let d = 1; d <= 5; d++) hours.push({ date: `2026-09-0${d}`, equipment: 'Comp 1', category: 'Compressor', manual: 20, iot: 21, status: 'MISMATCH' })
  hours.push({ date: '2026-09-06', equipment: 'Comp 1', category: 'Compressor', manual: null, iot: 20, status: 'MISSING_MANUAL' })
  const text = buildInsights({ hours, health: [{ expected: 10, logged: 6 }], equipment: [{ equipment: 'Pump A', connectivity: 'OFFLINE' }], actions: [] }).map(i => i.text).join(' | ')
  assert.match(text, /Compressor: only 0% of equipment-days match/)
  assert.match(text, /IoT records more running time.*\+5%/)
  assert.match(text, /Comp 1: 5 mismatched day/)
  assert.match(text, /1 equipment-day\(s\) have IoT data but no manual entry/)
  assert.match(text, /coverage is 60%/)
  assert.match(text, /1 device\(s\) were offline, intermittent or not running.*Pump A/)
})

test('insights say all clear when nothing is off', () => {
  const r = buildInsights({ hours: [{ equipment: 'A', category: 'X', manual: 10, iot: 10, status: 'MATCH' }], health: [{ expected: 2, logged: 2 }], equipment: [], actions: [] })
  assert.equal(r.length, 1)
  assert.equal(r[0].tone, 'green')
})

test('match rule mirrors the SQL view (±% of manual OR abs floor)', () => {
  const t = toleranceFor({ default_pct: 2, abs_hours: 0.25, by_category: { Pump: 5 } }, 'Compressor')
  assert.deepEqual(t, { pct: 2, abs: 0.25 })
  assert.deepEqual(toleranceFor({ default_pct: 2, abs_hours: 0.25, by_category: { Pump: 5 } }, 'Pump'), { pct: 5, abs: 0.25 })
  assert.deepEqual(toleranceFor(undefined, null), { pct: 2, abs: 0.25 })
  assert.equal(hoursStatus(20, 20.3, t).status, 'MATCH')           // 1.5%
  assert.deepEqual(hoursStatus(20, 20.9, t), { status: 'MISMATCH', diffHours: 0.9, diffPct: 4.5 })
  assert.equal(hoursStatus(20, 20.4, t).status, 'MATCH')           // exactly 2%
  assert.equal(hoursStatus(0, 0.2, t).status, 'MATCH')             // abs floor
  assert.equal(hoursStatus(0, 0.3, t).status, 'MISMATCH')
  assert.equal(hoursStatus(18, 20.1, t).diffPct, 11.67)            // same rounding as SQL
  assert.equal(hoursStatus(null, 5, t).status, 'MISSING_MANUAL')
  assert.equal(hoursStatus(5, '', t).status, 'MISSING_IOT')
  assert.equal(hoursStatus(null, null, t).status, null)
})

test('fuel: column detected, parsed, rolled up and flagged', () => {
  const { rows } = parseHoursSheet([['Equipment ID', 'Date', 'Running hrs', 'Fuel consumption (L)'], ['DG-1', '2026-09-30', 20, 150], ['DG-2', '2026-09-30', 10, 'x']])
  assert.equal(rows[0].fuel_litres, 150)
  assert.equal(rows[0].running_hours, 20)
  assert.deepEqual(rows[1].issues, ['Fuel "x" is not valid'])
  assert.equal(fuelLph(150, 20), 7.5)
  assert.equal(fuelLph(150, 0), null)
  assert.equal(fuelLph(null, 20), null)
  const s = summarizeHours([
    { enrollment_id: 'a', equipment_category: 'DG', manual_hours: 20, iot_hours: 20, iot_fuel_litres: 150, status: 'MATCH' },
    { enrollment_id: 'a', equipment_category: 'DG', manual_hours: 10, iot_hours: 10, iot_fuel_litres: 80, status: 'MATCH' },
    { enrollment_id: 'b', equipment_category: 'DG', manual_hours: 5, iot_hours: 5, iot_fuel_litres: null, status: 'MATCH' },
  ])
  assert.equal(s.total.fuelLitres, 230)
  assert.equal(s.total.avgFuelLph, 7.67)   // 230 L / 30 h (day without fuel excluded)
  const hours = []
  for (let d = 1; d <= 3; d++) {
    hours.push({ date: `2026-09-0${d}`, equipment: 'DG-1', category: 'DG', manual: 10, iot: 10, fuel: 70, status: 'MATCH' })
    hours.push({ date: `2026-09-0${d}`, equipment: 'DG-2', category: 'DG', manual: 10, iot: 10, fuel: 120, status: 'MATCH' })
  }
  const text = buildInsights({ hours, health: [], equipment: [], actions: [] }).map(i => i.text).join(' | ')
  assert.match(text, /DG-2: average fuel 12 L\/h is 26% above the DG average \(9.5 L\/h\)/)
})

test('equipment status insight uses the combined status (check or IoT hours)', () => {
  const text = buildInsights({ hours: [], health: [], actions: [], equipment: [
    { equipment: 'DG-1', status: 'NOT_RUNNING' }, { equipment: 'DG-2', status: 'RUNNING' }, { equipment: 'DG-3', status: 'NO_DATA' },
  ] }).map(i => i.text).join(' | ')
  assert.match(text, /1 device\(s\) were offline, intermittent or not running.*DG-1/)
  assert.match(text, /1 device\(s\) have no check and no IoT hours in this period: DG-3/)
  assert.doesNotMatch(text, /DG-2/)
})

test('reads the client daily logsheet (date blocks of Open / Closing / Total / B/D Hrs)', () => {
  const rows = [
    [null, 'Daily Logsheet Entry'],
    [null, null, null, null, null, '26.09.2026', null, null, null, '28.09.2026'],
    ['Sr. No.', 'Plant Description', 'Plant CCl. No.', 'Group', 'Equipment Number', 'Open Hrs', 'Closing Hrs', 'Total Hrs', 'B/D Hrs ', 'Open Hrs', 'Closing Hrs', 'Total Hrs', 'B/D Hrs '],
    ['1', 'DG Set 125 kVA', '66333', 1045, '4100190', 4759, 4787, 28, null, 4787, 4798, 11, null],
    [2, 'DG Set 62.5 kVA', '66424', '1045', '4100003', 1705, 1705, 0, 24, 1705, 1710, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null],
    [3, 'Compressor', '1', '1048', 'C-9', null, null, null, null, 10, 8, null, null],
    [4, 'Tipper', '1', '1032', 'T-1', '34955/3841', '35060/3849', '#VALUE!', null, null, null, null, null],
  ]
  const p = parseHoursSheet(rows)
  assert.equal(p.layout, 'logsheet')
  assert.deepEqual(p.dates, ['2026-09-26', '2026-09-28'])
  const pick = r => [r.equipment_ref, r.date, r.running_hours, r.offline_hours, r.issues.length]
  assert.deepEqual(p.rows.map(pick), [
    ['4100190', '2026-09-26', 28, null, 0],
    ['4100190', '2026-09-28', 11, null, 0],
    ['4100003', '2026-09-26', 0, 24, 0],
    ['4100003', '2026-09-28', 5, null, 0], // Total blank → Closing − Open
    ['C-9', '2026-09-28', -2, null, 1], // closing below opening is flagged
    ['T-1', '2026-09-26', 8, null, 0], // km/hours readings: hour meter, #VALUE! total ignored
  ])
  assert.equal(p.rows[0].equipment_name, 'DG Set 125 kVA')
  assert.equal(findDuplicateRows(p.rows).size, 0)
})

test('preview edits re-check hours and keep file issues', () => {
  const row = { rowNo: 9, equipment_ref: 'T-2', date: '2026-09-28', running_hours: -995, offline_hours: null, open_hours: 5344, closing_hours: 4349, fuel_litres: null, issues: ['Total hours -995 cannot be negative (closing below opening)'] }
  const fixed = applyHoursEdit(row, { closing_hours: '5349' })
  assert.equal(fixed.running_hours, 5)
  assert.deepEqual(fixed.issues, [])
  assert.equal(fixed.edited, true)
  assert.equal(applyHoursEdit(row, { running_hours: '7.5', offline_hours: '' }).running_hours, 7.5)
  assert.deepEqual(applyHoursEdit(row, { running_hours: 'x' }).issues, ['Running hours missing or not a number'])
  const badDate = { ...row, running_hours: 3, issues: ['Date "x" not recognised'] }
  assert.deepEqual(applyHoursEdit(badDate, { running_hours: '4' }).issues, ['Date "x" not recognised'])
  assert.equal(applyHoursEdit(row, {}), row)
})
