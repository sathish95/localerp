// Go-Live Support hours reconciliation (STEP237) — pure helpers, no
// Supabase import, unit-tested in goLiveHoursRules.test.mjs.
//
// The authoritative MATCH / MISMATCH status per equipment-day comes from
// the golive_hours_compare view (tolerance applied in SQL). These helpers
// only parse uploads and roll the view rows up for screens and reports.

import { excelToUtcIso } from './goLiveRules.js'

export const HOURS_STATUSES = {
  MATCH: { label: 'Match', badge: 'success' },
  MISMATCH: { label: 'Mismatch', badge: 'danger' },
  MISSING_MANUAL: { label: 'No manual report', badge: 'warning' },
  MISSING_IOT: { label: 'No IoT data', badge: 'warning' },
}
export const ACTION_STATUSES = {
  OPEN: { label: 'Action open', badge: 'warning' },
  RESOLVED: { label: 'Resolved', badge: 'success' },
  ACCEPTED: { label: 'Variance accepted', badge: 'gray' },
}
export const DEFAULT_HOURS_TOLERANCE = { default_pct: 2, abs_hours: 0.25, by_category: {} }

const norm = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const round = (n, d = 1) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d)

/* ═══ Match rule (mirror of golive_hours_compare in STEP237) ═══ */

// Tolerance for a category from engagement.config.hours_tolerance.
export function toleranceFor(tolerance, category) {
  const t = { ...DEFAULT_HOURS_TOLERANCE, ...(tolerance || {}) }
  const over = category ? t.by_category?.[category] : undefined
  return { pct: Number(over ?? t.default_pct ?? 2), abs: Number(t.abs_hours ?? 0.25) }
}

// MATCH when |IoT − manual| ≤ abs hours OR ≤ pct % of manual hours.
export function hoursStatus(manual, iot, { pct, abs }) {
  const m = manual === '' || manual == null ? null : Number(manual)
  const i = iot === '' || iot == null ? null : Number(iot)
  if (m == null && i == null) return { status: null, diffHours: null, diffPct: null }
  if (m == null) return { status: 'MISSING_MANUAL', diffHours: null, diffPct: null }
  if (i == null) return { status: 'MISSING_IOT', diffHours: null, diffPct: null }
  const diffHours = Math.round((i - m) * 100) / 100
  const diffPct = m > 0 ? Math.round(((i - m) / m) * 10000) / 100 : null
  const ok = Math.abs(i - m) <= abs + 1e-9 || (m > 0 && (Math.abs(i - m) / m) * 100 <= pct + 1e-9)
  return { status: ok ? 'MATCH' : 'MISMATCH', diffHours, diffPct }
}

/* ═══ Upload parsing ═══ */

// Header keywords for the manual report / IoT export (first match wins).
const COLS = {
  equipment: ['equipmentid', 'equipment', 'assetid', 'asset', 'machine', 'deviceid', 'device', 'tag'],
  category: ['category', 'equipmenttype', 'type', 'class'],
  date: ['date', 'day', 'reportdate'],
  running: ['runninghrs', 'runninghours', 'running', 'runhrs', 'runhours', 'onlinehrs', 'onlinehours', 'online', 'uptime', 'operatinghours', 'hours'],
  offline: ['offlinehrs', 'offlinehours', 'offline', 'downtime', 'idle', 'stopped'],
  fuel: ['fuelconsumption', 'fuelconsumed', 'fuellitres', 'fuelliters', 'fuel', 'diesel', 'litres', 'liters', 'ltrs', 'ltr'],
}

// Finds the header row (first row with an equipment + date + hours column)
// and maps each field to a column index.
export function detectColumns(rows, maxScan = 30) {
  for (let r = 0; r < Math.min(rows.length, maxScan); r++) {
    const cells = (rows[r] || []).map(norm)
    const pick = (keys, taken) => {
      for (const k of keys) {
        const i = cells.findIndex((c, idx) => c && !taken.includes(idx) && (c === k || c.startsWith(k)))
        if (i >= 0) return i
      }
      return -1
    }
    const taken = []
    const map = {}
    // offline and fuel before running so they aren't taken as the running column
    for (const f of ['equipment', 'date', 'offline', 'fuel', 'category', 'running']) {
      map[f] = pick(COLS[f], taken)
      if (map[f] >= 0) taken.push(map[f])
    }
    if (map.equipment >= 0 && map.date >= 0 && map.running >= 0) return { headerRow: r, map }
  }
  return null
}

const num = v => {
  if (v == null || v === '') return null
  if (typeof v === 'number') return v
  const s = String(v).trim()
  const hm = s.match(/^(\d{1,2}):(\d{2})$/) // "18:30" → 18.5 h
  if (hm) return Number(hm[1]) + Number(hm[2]) / 60
  const n = Number(s.replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) && s.replace(/[^\d.-]/g, '') !== '' ? n : NaN
}

// Client "Daily Logsheet" layout: one row per equipment, a block of
// Open Hrs · Closing Hrs · Total Hrs · B/D Hrs per day, with the day's date
// in the (merged) row above the block. Returns null when it isn't that layout.
const WIDE_OPEN = ['openhrs', 'openinghrs', 'openinghours', 'open', 'opening']
const WIDE_CLOSE = ['closinghrs', 'closehrs', 'closinghours', 'closing', 'close']
const WIDE_TOTAL = ['totalhrs', 'totalhours', 'total', 'runninghrs', 'runninghours']
const WIDE_BD = ['bdhrs', 'bdhours', 'breakdownhrs', 'breakdownhours', 'breakdown', 'bd', 'downtime']
const WIDE_EQUIP = ['equipmentnumber', 'equipmentno', 'equipmentid', 'equipment', 'assetid', 'assetno', 'asset']

export function detectWideLayout(rows, maxScan = 30) {
  const is = (c, keys) => keys.some(k => c === k || c.startsWith(k))
  for (let r = 1; r < Math.min(rows.length, maxScan); r++) {
    const cells = (rows[r] || []).map(norm)
    let equipment = -1
    for (const k of WIDE_EQUIP) { equipment = cells.findIndex(c => c === k || c.startsWith(k)); if (equipment >= 0) break }
    if (equipment < 0) continue
    const above = rows[r - 1] || []
    const blocks = []
    let cur = null
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]
      if (!c || i === equipment) continue
      const kind = is(c, WIDE_OPEN) ? 'open' : is(c, WIDE_CLOSE) ? 'close' : is(c, WIDE_BD) ? 'bd' : is(c, WIDE_TOTAL) ? 'total' : null
      if (!kind) continue
      // a new block starts at an Open column, or when a field repeats
      if (!cur || kind === 'open' || cur[kind] != null) { cur = { open: null, close: null, total: null, bd: null, start: i }; blocks.push(cur) }
      cur[kind] = i
      cur.end = i
    }
    const dated = blocks.map(b => {
      let raw = null
      for (let i = b.start; i <= b.end && raw == null; i++) if (above[i] != null && above[i] !== '') raw = above[i]
      return { ...b, rawDate: raw, date: excelToUtcIso(raw, { dateOnly: true }) || null }
    }).filter(b => b.total != null || (b.open != null && b.close != null))
    if (dated.length && dated.some(b => b.date)) {
      const name = cells.findIndex((c, i) => i !== equipment && (c.startsWith('plantdescription') || c.startsWith('description') || c.startsWith('equipmentname')))
      return { headerRow: r, equipment, name, blocks: dated }
    }
  }
  return null
}

function parseWide(rows, det) {
  const out = []
  for (let r = det.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || []
    const ref = String(row[det.equipment] ?? '').trim()
    if (!ref) continue
    const name = det.name >= 0 ? String(row[det.name] ?? '').trim() || null : null
    for (const b of det.blocks) {
      const g = i => (i == null ? null : row[i])
      // "34955/3841" = odometer km / hour meter (tippers): the hour meter counts
      const meter = v => (typeof v === 'string' && /^\s*[\d.]+\s*\/\s*[\d.]+\s*$/.test(v) ? num(v.split('/')[1]) : num(v))
      // Excel error cells (#VALUE!, #REF!…) count as blank so Closing − Open can stand in
      const cell = v => (typeof v === 'string' && /^#[A-Z/0!?]+[!?]?$/i.test(v.trim()) ? null : v)
      const open = meter(cell(g(b.open))), close = meter(cell(g(b.close))), total = num(cell(g(b.total))), bd = num(cell(g(b.bd)))
      // nothing entered for this day → not reported, skip quietly
      if (total == null && open == null && close == null && bd == null) continue
      const issues = []
      let running = total
      if ((running == null || Number.isNaN(running)) && Number.isFinite(open) && Number.isFinite(close)) running = close - open
      if (!b.date) issues.push(`Date "${b.rawDate ?? ''}" above the hours columns not recognised`)
      if (running == null || Number.isNaN(running)) issues.push('Total hours missing or not a number')
      else if (running < 0) issues.push(`Total hours ${round(running, 2)} cannot be negative${total == null ? ' (closing below opening)' : ''}`)
      if (bd != null && (Number.isNaN(bd) || bd < 0)) issues.push(`B/D hours "${g(b.bd)}" is not valid`)
      out.push({
        rowNo: r + 1, key: `${r + 1}|${b.date || b.start}`, equipment_ref: ref, equipment_name: name, category: null, date: b.date,
        running_hours: Number.isFinite(running) ? round(running, 2) : null,
        offline_hours: Number.isFinite(bd) ? round(bd, 2) : null,
        open_hours: Number.isFinite(open) ? open : null, closing_hours: Number.isFinite(close) ? close : null,
        fuel_litres: null, issues,
      })
    }
  }
  return { rows: out, columns: null, headerRow: det.headerRow + 1, layout: 'logsheet', dates: det.blocks.map(b => b.date).filter(Boolean) }
}

// rows: array-of-arrays from SheetJS. Returns { rows: [{rowNo, equipment_ref,
// category, date, running_hours, offline_hours, issues}], columns } or throws.
// Accepts one row per equipment per day, or the client's daily logsheet
// (one row per equipment, Open/Closing/Total/B-D hours per date block).
export function parseHoursSheet(rows) {
  const det = detectColumns(rows)
  if (!det) {
    const wide = detectWideLayout(rows)
    if (wide) return parseWide(rows, wide)
  }
  if (!det) throw new Error('Could not find the header row — the sheet needs Equipment, Date and Running hours columns, or the daily logsheet layout (Equipment Number + Open / Closing / Total / B/D Hrs under each date)')
  const { headerRow, map } = det
  const out = []
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || []
    const g = i => (i >= 0 ? row[i] : null)
    const ref = String(g(map.equipment) ?? '').trim()
    const rawDate = g(map.date)
    if (!ref && (rawDate == null || rawDate === '')) continue
    const issues = []
    const date = excelToUtcIso(rawDate, { dateOnly: true })
    const running = num(g(map.running))
    const offline = num(g(map.offline))
    const fuel = num(g(map.fuel))
    if (!ref) issues.push('Equipment ID is blank')
    if (!date) issues.push(`Date "${rawDate ?? ''}" not recognised`)
    if (running == null || Number.isNaN(running)) issues.push('Running hours missing or not a number')
    else if (running < 0) issues.push(`Running hours ${running} cannot be negative`)
    if (offline != null && (Number.isNaN(offline) || offline < 0)) issues.push(`Offline hours "${g(map.offline)}" is not valid`)
    if (fuel != null && (Number.isNaN(fuel) || fuel < 0)) issues.push(`Fuel "${g(map.fuel)}" is not valid`)
    out.push({
      rowNo: r + 1, equipment_ref: ref, category: String(g(map.category) ?? '').trim() || null,
      date: date || null, running_hours: Number.isFinite(running) ? round(running, 2) : null,
      offline_hours: Number.isFinite(offline) ? round(offline, 2) : null,
      fuel_litres: Number.isFinite(fuel) ? round(fuel, 2) : null, issues,
    })
  }
  return { rows: out, columns: map, headerRow: headerRow + 1 }
}

// Upload preview edits: patch = { running_hours?, offline_hours?, fuel_litres?,
// open_hours?, closing_hours? } (strings from inputs; '' = blank). Changing
// Open / Closing recomputes running as Closing − Open. Hour issues are
// re-checked; date / equipment issues from the file are kept.
const HOUR_ISSUE = /^(Running hours|Total hours|Offline hours|B\/D hours|Fuel )/
export function applyHoursEdit(row, patch) {
  if (!patch || !Object.keys(patch).length) return row
  const val = k => (k in patch ? (patch[k] === '' || patch[k] == null ? null : num(patch[k])) : row[k])
  const open = val('open_hours'), close = val('closing_hours')
  let running = val('running_hours')
  if (!('running_hours' in patch) && ('open_hours' in patch || 'closing_hours' in patch) && Number.isFinite(open) && Number.isFinite(close)) running = close - open
  const offline = val('offline_hours'), fuel = val('fuel_litres')
  const issues = row.issues.filter(i => !HOUR_ISSUE.test(i))
  if (running == null || Number.isNaN(running)) issues.push('Running hours missing or not a number')
  else if (running < 0) issues.push(`Running hours ${round(running, 2)} cannot be negative`)
  if (offline != null && (Number.isNaN(offline) || offline < 0)) issues.push('Offline hours is not valid')
  if (fuel != null && (Number.isNaN(fuel) || fuel < 0)) issues.push('Fuel is not valid')
  const fin = n => (Number.isFinite(n) ? round(n, 2) : null)
  return {
    ...row, running_hours: fin(running), offline_hours: fin(offline), fuel_litres: fin(fuel),
    open_hours: Number.isFinite(open) ? open : row.open_hours ?? null, closing_hours: Number.isFinite(close) ? close : row.closing_hours ?? null,
    issues, edited: true,
  }
}

// Client-side preview of which enrollment a reported equipment ref maps to
// (the server does the same match in golive_ingest_hours).
export function matchEquipment(ref, enrollments) {
  const k = norm(ref)
  if (!k) return null
  const keys = e => [e.equipment_id, e.equipment_name, e.device?.device_code, e.device?.serial_number].map(norm)
  const live = enrollments.filter(e => !e.deleted_at)
  return live.find(e => norm(e.equipment_id) === k) || live.find(e => keys(e).includes(k)) || null
}

// Duplicate equipment+date rows inside one file (the last one would win on the server).
export function findDuplicateRows(rows) {
  const seen = {}
  const dup = new Set()
  for (const r of rows) {
    if (!r.equipment_ref || !r.date) continue
    const k = `${norm(r.equipment_ref)}|${r.date}`
    const id = r.key ?? r.rowNo // logsheet rows share a row number across dates
    if (seen[k]) { dup.add(seen[k]); dup.add(id) } else seen[k] = id
  }
  return dup
}

/* ═══ Roll-ups over golive_hours_compare rows ═══ */

// Fuel (application side): total litres and average L/h over the days that
// have both fuel and IoT running hours.
export function fuelLph(fuel, hours) {
  const f = fuel === '' || fuel == null ? null : Number(fuel)
  const h = hours === '' || hours == null ? null : Number(hours)
  return f != null && h > 0 ? round(f / h, 2) : null
}
function fuelStats(rows) {
  const withFuel = rows.filter(r => r.iot_fuel_litres != null && r.iot_fuel_litres !== '')
  const litres = withFuel.reduce((s, r) => s + Number(r.iot_fuel_litres), 0)
  const hours = withFuel.reduce((s, r) => s + Number(r.iot_hours || 0), 0)
  return { fuelDays: withFuel.length, fuelLitres: withFuel.length ? round(litres, 1) : null, avgFuelLph: hours > 0 ? round(litres / hours, 2) : null }
}

function aggregate(rows) {
  const both = rows.filter(r => r.manual_hours != null && r.iot_hours != null)
  const manual = both.reduce((s, r) => s + Number(r.manual_hours), 0)
  const iot = both.reduce((s, r) => s + Number(r.iot_hours), 0)
  const count = s => rows.filter(r => r.status === s).length
  const compared = count('MATCH') + count('MISMATCH')
  return {
    days: rows.length,
    compared,
    match: count('MATCH'),
    mismatch: count('MISMATCH'),
    missingManual: count('MISSING_MANUAL'),
    missingIot: count('MISSING_IOT'),
    manualHours: round(manual, 2),
    iotHours: round(iot, 2),
    diffHours: round(iot - manual, 2),
    diffPct: manual > 0 ? round(((iot - manual) / manual) * 100, 2) : null,
    matchRate: compared ? round((count('MATCH') / compared) * 100, 1) : null,
    // share of the day each source says the equipment was running
    manualUptimePct: both.length ? round((manual / (both.length * 24)) * 100, 1) : null,
    iotUptimePct: both.length ? round((iot / (both.length * 24)) * 100, 1) : null,
    ...fuelStats(rows),
    openActions: rows.filter(r => r.action_status === 'OPEN').length,
    unactionedMismatches: rows.filter(r => r.status === 'MISMATCH' && !r.action_status).length,
  }
}

export function summarizeHours(rows) {
  const byCat = {}
  const byEquip = {}
  for (const r of rows) {
    const cat = r.equipment_category || 'Uncategorised'
    ;(byCat[cat] ||= []).push(r)
    const key = r.enrollment_id || r.equipment || r.equipment_id
    ;(byEquip[key] ||= []).push(r)
  }
  const categories = Object.entries(byCat)
    .map(([category, rs]) => ({ category, equipment: new Set(rs.map(r => r.enrollment_id || r.equipment)).size, ...aggregate(rs) }))
    .sort((a, b) => a.category.localeCompare(b.category))
  const equipment = Object.values(byEquip).map(rs => ({
    enrollment_id: rs[0].enrollment_id, equipment: rs[0].equipment_name || rs[0].equipment || rs[0].equipment_id,
    equipment_id: rs[0].equipment_id, category: rs[0].equipment_category || 'Uncategorised', ...aggregate(rs),
  })).sort((a, b) => a.category.localeCompare(b.category) || String(a.equipment).localeCompare(String(b.equipment)))
  return { total: aggregate(rows), categories, equipment }
}

/* ═══ Improvement insights (report) ═══ */

// Plain-language findings from the report payload — shown under
// "Improvement actions" alongside the open action items.
export function buildInsights(report) {
  const out = []
  const hours = report.hours || []
  const { categories, equipment, total } = summarizeHours(hours.map(h => ({
    ...h, equipment_category: h.category, manual_hours: h.manual, iot_hours: h.iot, iot_fuel_litres: h.fuel, enrollment_id: h.equipment,
  })))
  for (const c of categories) {
    if (c.compared >= 3 && c.matchRate != null && c.matchRate < 90) {
      out.push({ tone: 'red', text: `${c.category}: only ${c.matchRate}% of equipment-days match the manual report — review logger configuration and manual recording for this category.` })
    }
    if (c.diffPct != null && Math.abs(c.diffPct) >= 2 && c.compared >= 3) {
      out.push({ tone: 'amber', text: `${c.category}: IoT ${c.diffPct > 0 ? 'records more' : 'records less'} running time than the manual report on average (${c.diffPct > 0 ? '+' : ''}${c.diffPct}%) — a consistent bias usually points to a threshold or clock setting.` })
    }
  }
  // fuel: a machine burning noticeably more per running hour than its category
  for (const e of equipment) {
    const cat = categories.find(c => c.category === e.category)
    if (e.fuelDays >= 3 && cat?.avgFuelLph && e.avgFuelLph && e.avgFuelLph > cat.avgFuelLph * 1.2 && cat.equipment > 1) {
      out.push({ tone: 'amber', text: `${e.equipment}: average fuel ${e.avgFuelLph} L/h is ${round(((e.avgFuelLph - cat.avgFuelLph) / cat.avgFuelLph) * 100, 0)}% above the ${e.category} average (${cat.avgFuelLph} L/h) — check load, idling and maintenance.` })
    }
  }
  const worst = equipment.filter(e => e.mismatch >= 2).sort((a, b) => b.mismatch - a.mismatch).slice(0, 3)
  for (const e of worst) out.push({ tone: 'amber', text: `${e.equipment}: ${e.mismatch} mismatched day(s) in the period — prioritise a site visit.` })
  if (total.missingManual > 0) out.push({ tone: 'amber', text: `${total.missingManual} equipment-day(s) have IoT data but no manual entry — ask the site to complete the manual log.` })
  if (total.missingIot > 0) out.push({ tone: 'amber', text: `${total.missingIot} equipment-day(s) have a manual entry but no IoT data — check connectivity and data upload for those devices.` })

  const health = report.health || []
  const logged = health.reduce((s, d) => s + (d.logged || 0), 0)
  const expected = health.reduce((s, d) => s + (d.expected || 0), 0)
  if (expected > 0 && logged / expected < 0.9) out.push({ tone: 'amber', text: `Daily check coverage is ${round((logged / expected) * 100, 0)}% — daily onsite checks are being missed.` })
  const offline = (report.equipment || []).filter(e => ['OFFLINE', 'INTERMITTENT', 'NOT_RUNNING'].includes(e.status ?? e.connectivity))
  if (offline.length) out.push({ tone: 'red', text: `${offline.length} device(s) were offline, intermittent or not running at their latest reading: ${offline.slice(0, 5).map(e => e.equipment || e.device).join(', ')}${offline.length > 5 ? '…' : ''}.` })
  const noData = (report.equipment || []).filter(e => e.status === 'NO_DATA')
  if (noData.length) out.push({ tone: 'amber', text: `${noData.length} device(s) have no check and no IoT hours in this period: ${noData.slice(0, 5).map(e => e.equipment || e.device).join(', ')}${noData.length > 5 ? '…' : ''}.` })
  const high = (report.actions || []).filter(a => a.kind === 'device_issue' && a.severity === 'HIGH')
  if (high.length) out.push({ tone: 'red', text: `${high.length} high-severity device issue(s) are still open.` })
  if (!out.length) out.push({ tone: 'green', text: 'No significant deviations in this period — manual and IoT hours agree within tolerance and checks are on track.' })
  return out
}
