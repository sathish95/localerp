// Go-Live Support — Devices export / re-upload (round trip). Pure helpers,
// no Supabase import; unit-tested in goLiveDeviceSheet.test.mjs.
//
// Export writes one row per enrolled device. The user edits it in Excel and
// uploads it back; each row is matched to its enrollment (by the Ref column,
// else Device ID / serial) and only the fields that actually changed are
// applied. Read-only columns are ignored on upload.

import { mapEnum, matchPerson, SUPPORT_STATUSES, labelOf } from './goLiveRules.js'
import { coerceFieldValue, fieldDisplay, parseYesNo, yesNo } from './goLiveDeviceFields.js'

const norm = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

// key → header, and how the value is read back
export const DEVICE_COLUMNS = [
  { key: 'ref', header: 'Ref (do not edit)', readOnly: true },
  { key: 'device_code', header: 'Device ID', readOnly: true },
  { key: 'serial_number', header: 'Serial number', readOnly: true },
  { key: 'is_golive', header: 'Go-live (Yes/No)', type: 'golive' },
  { key: 'site', header: 'Site', type: 'text' },
  { key: 'equipment_id', header: 'Equipment ID', type: 'text' },
  { key: 'equipment_name', header: 'Equipment name', type: 'text' },
  { key: 'equipment_category', header: 'Equipment category', type: 'text' },
  { key: 'firmware_version', header: 'Firmware version', type: 'text' },
  { key: 'connectivity_ref', header: 'SIM / network ref', type: 'text' },
  { key: 'expected_reporting_interval_min', header: 'Reporting interval (min)', type: 'interval' },
  { key: 'support_status', header: 'Support status', type: 'status' },
  { key: 'status_reason', header: 'Status reason', type: 'text' },
  { key: 'onsite_coordinator_user_id', header: 'Onsite coordinator (email)', type: 'person' },
  { key: 'firmware_engineer_user_id', header: 'Firmware engineer (email)', type: 'person' },
  { key: 'application_engineer_user_id', header: 'Application engineer (email)', type: 'person' },
  { key: 'notes', header: 'Notes', type: 'text' },
  { key: 'part_number', header: 'Part number (read only)', readOnly: true },
  { key: 'warranty_end', header: 'Warranty end (read only)', readOnly: true },
  { key: 'today', header: "Today's result (read only)", readOnly: true },
  { key: 'open_issues', header: 'Open issues (read only)', readOnly: true },
]
export const EDITABLE = DEVICE_COLUMNS.filter(c => !c.readOnly)

// The engagement's custom device fields (STEP259) become extra columns, keyed `cf:<key>`.
export const customColumns = (fields = []) => fields.map(f => ({ key: `cf:${f.key}`, header: f.label, type: 'custom', field: f }))
export const sheetColumns = (fields = []) => {
  const cols = [...DEVICE_COLUMNS]
  cols.splice(cols.findIndex(c => c.key === 'notes'), 0, ...customColumns(fields))
  return cols
}

// Planned changes → the patch updateEnrollment takes (custom fields merged into custom_fields).
export function changesToPatch(enrollment, changes) {
  const patch = {}
  for (const [k, c] of Object.entries(changes)) {
    if (k.startsWith('cf:')) patch.custom_fields = { ...(patch.custom_fields || enrollment.custom_fields || {}), [k.slice(3)]: c.to }
    else patch[k] = c.to
  }
  return patch
}

const personCell = (people, id) => {
  if (!id) return ''
  const p = people.find(x => x.id === id)
  return p ? p.email || p.full_name : ''
}

// Rows (array-of-arrays) for the export sheet, header first.
export function buildDeviceSheet(enrollments, people, { todayOf = {}, issuesOf = {}, fields = [] } = {}) {
  const cols = sheetColumns(fields)
  const rows = enrollments.filter(e => !e.deleted_at && !e.unenrolled_at).map(e => cols.map(c => {
    if (c.type === 'custom') return fieldDisplay(e, c.field)
    switch (c.key) {
      case 'is_golive': return yesNo(!!e.is_golive)
      case 'ref': return e.id
      case 'device_code': return e.device?.device_code || ''
      case 'serial_number': return e.device?.serial_number || ''
      case 'part_number': return e.device?.part_number || ''
      case 'warranty_end': return e.device?.warranty_end || ''
      case 'today': return todayOf[e.id] || ''
      case 'open_issues': return issuesOf[e.id] || 0
      case 'support_status': return labelOf(SUPPORT_STATUSES, e.support_status)
      default: return c.type === 'person' ? personCell(people, e[c.key]) : (e[c.key] ?? '')
    }
  }))
  return [cols.map(c => c.header), ...rows]
}

function findPerson(value, people) {
  const s = String(value ?? '').trim()
  if (!s) return { id: null }
  const byEmail = people.find(p => p.email && p.email.toLowerCase() === s.toLowerCase())
  if (byEmail) return { id: byEmail.id }
  const m = matchPerson(s, people)
  return m ? { id: m.id } : { error: `“${s}” is not a known user` }
}

// Maps header text back to column keys (tolerates re-ordered / extra columns).
function headerMap(header, cols) {
  const cells = (header || []).map(norm)
  const map = {}
  for (const c of cols) {
    const h = norm(c.header)
    const idx = cells.findIndex(x => x === h || (x && h.startsWith(x) && x.length > 4))
    if (idx >= 0) map[c.key] = idx
  }
  return map
}

// rows: array-of-arrays from the uploaded sheet. Returns the planned
// changes against the current enrollments.
//   updates:  [{ rowNo, enrollment, changes: { key: { from, to } }, issues }]
//   unchanged: count of matched rows with nothing to change
//   notEnrolled: [{ rowNo, ref }]  device not in this engagement
//   errors:   [{ rowNo, message }]
export function planDeviceUpload(rows, enrollments, people, fields = []) {
  const h = rows.findIndex(r => (r || []).some(c => norm(c) === 'deviceid'))
  if (h < 0) throw new Error('This file has no “Device ID” header — export the devices first and edit that file')
  const cols = sheetColumns(fields)
  const map = headerMap(rows[h], cols)
  const live = enrollments.filter(e => !e.deleted_at)
  const byId = Object.fromEntries(live.map(e => [e.id, e]))
  const out = { updates: [], unchanged: 0, notEnrolled: [], errors: [] }
  const seen = new Set()

  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r] || []
    const get = k => (map[k] != null ? row[map[k]] : undefined)
    const ref = String(get('ref') ?? '').trim()
    const code = String(get('device_code') ?? '').trim()
    const serial = String(get('serial_number') ?? '').trim()
    if (!ref && !code && !serial) continue
    const rowNo = r + 1
    const enr = byId[ref]
      || live.find(e => code && norm(e.device?.device_code) === norm(code))
      || live.find(e => serial && norm(e.device?.serial_number) === norm(serial))
    if (!enr) { out.notEnrolled.push({ rowNo, ref: code || serial || ref }); continue }
    if (seen.has(enr.id)) { out.errors.push({ rowNo, message: `${code || serial} appears more than once — only the first row is used` }); continue }
    seen.add(enr.id)

    const changes = {}
    const issues = []
    for (const c of cols.filter(x => !x.readOnly)) {
      if (map[c.key] == null) continue // column removed from the sheet → leave as is
      const raw = get(c.key)
      let to
      if (c.type === 'custom') {
        const r = coerceFieldValue(c.field, raw)
        if (r.error) { issues.push(r.error); continue }
        const from = enr.custom_fields?.[c.field.key] ?? null
        if (String(from ?? '') !== String(r.value ?? '')) changes[c.key] = { from: c.field.type === 'yesno' ? yesNo(from) || null : from, to: r.value, label: c.header, display: c.field.type === 'yesno' ? yesNo(r.value) || null : r.value }
        continue
      } else if (c.type === 'golive') {
        const b = parseYesNo(raw)
        if (b === undefined) { issues.push(`Go-live “${raw}” is not Yes / No`); continue }
        if (b === null) continue // blank → leave as is
        if (b !== !!enr.is_golive) changes.is_golive = { from: !!enr.is_golive, to: b }
        continue
      } else if (c.type === 'person') {
        const p = findPerson(raw, people)
        if (p.error) { issues.push(`${c.header.replace(' (email)', '')}: ${p.error}`); continue }
        to = p.id
      } else if (c.type === 'status') {
        const s = mapEnum('supportStatus', raw)
        if (s === undefined) { issues.push(`Support status “${raw}” is not Active / Maintenance / Decommissioned`); continue }
        to = s || 'ACTIVE'
      } else if (c.type === 'interval') {
        const n = Number(raw)
        if (raw === '' || raw == null) { issues.push('Reporting interval is blank — kept the current value'); continue }
        if (!Number.isFinite(n) || n <= 0) { issues.push(`Reporting interval “${raw}” must be a positive number of minutes`); continue }
        to = Math.round(n)
      } else {
        const s = String(raw ?? '').trim()
        to = s === '' ? null : s
      }
      const from = enr[c.key] ?? null
      if (String(from ?? '') !== String(to ?? '')) changes[c.key] = { from, to }
    }
    const status = changes.support_status?.to ?? enr.support_status
    const reason = 'status_reason' in changes ? changes.status_reason.to : enr.status_reason
    if (status !== 'ACTIVE' && !reason) {
      issues.push(`${labelOf(SUPPORT_STATUSES, status)} needs a status reason — status change skipped`)
      delete changes.support_status
    }
    if (status === 'DECOMMISSIONED' && enr.support_status !== 'DECOMMISSIONED' && changes.support_status) {
      issues.push('Decommissioning stops new checks for this device in this engagement')
    }
    if (Object.keys(changes).length) out.updates.push({ rowNo, enrollment: enr, changes, issues })
    else if (issues.length) out.errors.push({ rowNo, message: `${code || serial}: ${issues.join('; ')}` })
    else out.unchanged++
  }
  return out
}

export const columnHeader = key => DEVICE_COLUMNS.find(c => c.key === key)?.header.replace(' (email)', '').replace(' (Yes/No)', '') || key
