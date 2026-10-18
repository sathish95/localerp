import { supabase } from './supabase'
import { ensureXLSX } from './xlsxLoader'
import {
  ROSTER_ROLES, CHECK_STATUSES, CONNECTIVITY_STATUSES, PRIORITIES, CATEGORIES, INCIDENT_STATUSES, SUPPORT_STATUSES,
  DAILY_RESULTS, FOLLOW_UP_FLAGS, labelOf, computeDailyResult, computeFollowUpFlag, computeKpis,
  mapEnum, excelToUtcIso, matchPerson, istDateOf, istToday, checkParameters, parameterSummary,
} from './goLiveRules'
import { deviceLabel, equipmentLabel, assignRole, currentRoster, listRoster, listEnrollments, linkChecks } from './goLive'
import { buildDeviceSheet, planDeviceUpload, sheetColumns } from './goLiveDeviceSheet'

// Excel import (migration of IoT_Daily_Support_Tracker.xlsx) and export in
// the same three-sheet layout. Import is parse → stage → resolve → commit;
// formula columns (Daily Checks P, Incidents R) are ignored and recomputed
// server-side by the STEP235 triggers.

const norm = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

/* ═══ Export ═══ */

const istCell = ts => {
  if (!ts) return ''
  return new Date(ts).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '')
}
const dateCell = d => (d ? d.split('-').reverse().join('/') : '')

export async function exportTracker({ engagement, lookups, from, to, reviewDate = istToday() }) {
  await ensureXLSX()
  const XLSX = window.XLSX
  const person = id => lookups.people.find(p => p.id === id)
  const nameOf = (id, legacy) => person(id)?.full_name || legacy || ''
  const [roster, enrollments, checksRes, incidentsRes] = await Promise.all([
    listRoster(engagement.id),
    listEnrollments(engagement.id),
    supabase.from('golive_daily_checks').select('*').eq('engagement_id', engagement.id).is('deleted_at', null).gte('check_date', from).lte('check_date', to).order('check_date'),
    supabase.from('golive_incidents').select('*').eq('engagement_id', engagement.id).is('deleted_at', null).order('reported_at'),
  ])
  const checks = checksRes.data || []
  const incidents = incidentsRes.data || []
  const enrById = Object.fromEntries(enrollments.map(e => [e.id, e]))
  const incById = Object.fromEntries(incidents.map(i => [i.id, i]))
  const { data: links } = checks.length
    ? await supabase.from('golive_check_incident_links').select('check_id,incident_id').in('check_id', checks.map(c => c.id).slice(0, 1000))
    : { data: [] }
  const linksOf = id => (links || []).filter(l => l.check_id === id).map(l => incById[l.incident_id]?.legacy_ref || incById[l.incident_id]?.number).filter(Boolean).join(', ')
  const cur = currentRoster(roster)
  const header = `${engagement.code} — ${engagement.name}`
  const checkParams = checkParameters(engagement.config)

  // Device Register: roster block rows 4–8, device table header row 11, data from row 12.
  const reg = [
    [header], ['Device Register and Support Owners'], [],
    ['Role', 'Primary name', 'Backup name', 'Contact'],
    ...ROSTER_ROLES.map(r => {
      const row = cur[r.key]
      const p = person(row?.primary_user_id)
      return [r.label.charAt(0) + r.label.slice(1).toLowerCase(), p?.full_name || '', person(row?.backup_user_id)?.full_name || '', p?.email || '']
    }),
    [], [],
    ['Device ID', 'Serial number', 'Site', 'Equipment ID', 'Installation date', 'Firmware version', 'Reporting interval (min)',
      'SIM / network reference', 'Warranty end date', 'Lifecycle status', 'Onsite coordinator', 'Firmware engineer', 'Application engineer', 'Notes'],
    ...enrollments.map(e => [
      e.device?.device_code || '', e.device?.serial_number || '', e.site || '', e.equipment_id || '', dateCell(e.device?.installed_date),
      e.firmware_version || '', e.expected_reporting_interval_min, e.connectivity_ref || '', dateCell(e.device?.warranty_end),
      labelOf(SUPPORT_STATUSES, e.support_status), nameOf(e.onsite_coordinator_user_id), nameOf(e.firmware_engineer_user_id), nameOf(e.application_engineer_user_id), e.notes || '',
    ]),
  ]

  // Daily Checks: review date B4, counters rows 6–10, header row 13, data from row 14.
  const k = computeKpis({ enrollments, checks: checks.filter(c => c.check_date === reviewDate), incidents })
  const daily = [
    [header], ['IoT Daily Support Tracker'], [],
    ['Review date', dateCell(reviewDate)], [],
    ['Registered active devices', k.activeDevices],
    ['Checks logged on review date', k.checksLogged],
    ['Healthy check records', k.healthy],
    ['Check records needing attention', k.attention],
    ['Duplicate device/date records', k.duplicates],
    ['Counts are check records, not uptime.'], [],
    ['Check date', 'Device ID', 'Site / equipment', 'Onsite coordinator', 'Power check', 'Cable / indicator check', 'Operation',
      'Last data received (IST)', 'Firmware health', 'Firmware reviewer', 'Application health', 'Application reviewer', 'Data quality',
      'Incident ID', 'Observation / action', 'Daily result', 'Parameters not working'],
    ...checks.map(c => [
      dateCell(c.check_date), equipmentLabel(enrById[c.enrollment_id]),
      [c.site_snapshot, c.equipment_snapshot].filter(Boolean).join(' / '),
      nameOf(c.onsite_coordinator_user_id, c.onsite_coordinator_legacy),
      labelOf(CHECK_STATUSES, c.power_check), labelOf(CHECK_STATUSES, c.cable_indicator_check), labelOf(CONNECTIVITY_STATUSES, c.connectivity),
      istCell(c.last_data_received_at), labelOf(CHECK_STATUSES, c.firmware_health), nameOf(c.firmware_reviewer_user_id, c.firmware_reviewer_legacy),
      labelOf(CHECK_STATUSES, c.application_health), nameOf(c.application_reviewer_user_id, c.application_reviewer_legacy),
      labelOf(CHECK_STATUSES, c.data_quality), linksOf(c.id), c.observation_action || '', DAILY_RESULTS[c.daily_result]?.label || '',
      parameterSummary(c.parameter_checks, checkParams).notWorkingLabels.join(', '),
    ]),
  ]

  // Incidents: counters rows 4–6, header row 8, data from row 9.
  const scopeText = i => {
    if (i.scope_type === 'SITE') return 'Site-wide'
    if (i.scope_type === 'PLATFORM') return 'Platform'
    return (i.device_enrollment_ids || []).map(id => equipmentLabel(enrById[id])).join(', ')
  }
  const inc = [
    [header], ['Incident and Action Tracker'], [],
    ['Open tickets', k.openTickets],
    ['Overdue open actions', k.overdue],
    ['Critical open tickets', k.criticalOpen],
    [],
    ['Incident ID', 'Reported at (IST)', 'Device ID / scope', 'Site', 'Priority', 'Category', 'Issue / business impact', 'Assigned owner', 'Status',
      'Acknowledged at (IST)', 'Next action', 'Action due (IST)', 'Last update (IST)', 'Resolved at (IST)', 'Root cause / resolution', 'Verified by', 'Closed at (IST)', 'Follow-up flag'],
    ...incidents.map(i => [
      i.legacy_ref || i.number, istCell(i.reported_at), scopeText(i), i.site || '', labelOf(PRIORITIES, i.priority), labelOf(CATEGORIES, i.category),
      i.issue_business_impact || i.title, nameOf(i.assigned_owner_user_id, i.assigned_owner_legacy), labelOf(INCIDENT_STATUSES, i.status),
      istCell(i.acknowledged_at), i.next_action || '', istCell(i.action_due_at), istCell(i.last_update_at), istCell(i.resolved_at),
      i.root_cause_resolution || '', nameOf(i.verified_by_user_id, i.verified_by_legacy), istCell(i.closed_at),
      FOLLOW_UP_FLAGS[computeFollowUpFlag(i)]?.label || '',
    ]),
  ]

  const wb = XLSX.utils.book_new()
  const add = (rows, name, widths) => {
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = widths.map(w => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws, name)
  }
  add(reg, 'Device Register', [22, 20, 18, 16, 14, 14, 12, 18, 14, 14, 20, 20, 20, 30])
  add(daily, 'Daily Checks', [30, 16, 22, 20, 12, 14, 13, 18, 13, 18, 13, 18, 12, 14, 36, 16])
  add(inc, 'Incidents', [14, 18, 18, 16, 14, 14, 40, 20, 16, 18, 30, 18, 18, 18, 36, 18, 18, 18])

  // Extra trailing sheet (the three original sheets keep their structure):
  // the handover summary used as the hypercare exit report.
  const summary = [
    ['Hypercare handover report'], [header], [],
    ['Go-live date', dateCell(engagement.go_live_date)],
    ['Hypercare window', `${dateCell(engagement.hypercare_start)} – ${dateCell(engagement.hypercare_actual_end || engagement.hypercare_planned_end)}`],
    ['Status', engagement.status], ['Handover to', engagement.handover_to || ''],
    ['Customer sign-off', [engagement.customer_signoff_name, dateCell(engagement.customer_signoff_date), engagement.customer_signoff_ref].filter(Boolean).join(' · ')],
    [], ['Devices enrolled', enrollments.length], ['Checks in export range', checks.length],
    ['Healthy records', checks.filter(c => c.daily_result === 'HEALTHY').length],
    ['Attention records', checks.filter(c => c.daily_result === 'ATTENTION').length],
    ['Incidents total', incidents.length], ['Incidents open', incidents.filter(i => i.status !== 'CLOSED').length],
    ['Handed over (open P3/P4)', incidents.filter(i => i.handed_over_at).length],
    [], ['Open incidents carried over'], ['Ticket', 'Priority', 'Status', 'Title', 'Owner'],
    ...incidents.filter(i => !['RESOLVED', 'CLOSED'].includes(i.status)).map(i => [i.number, labelOf(PRIORITIES, i.priority), labelOf(INCIDENT_STATUSES, i.status), i.title, nameOf(i.assigned_owner_user_id, i.assigned_owner_legacy)]),
  ]
  add(summary, 'Handover Summary', [28, 22, 16, 40, 20])

  XLSX.writeFile(wb, `${engagement.code}_Support_Tracker_${from}_to_${to}.xlsx`)
}

/* ═══ Import: parse ═══ */

function findHeaderRow(rows, required, maxScan = 40) {
  for (let r = 0; r < Math.min(rows.length, maxScan); r++) {
    const cells = (rows[r] || []).map(norm)
    if (required.every(req => cells.some(c => c.includes(req)))) return r
  }
  return -1
}

// Column index for each field: header keyword match, else positional fallback.
function columnMap(headerRow, spec) {
  const cells = (headerRow || []).map(norm)
  const out = {}
  for (const [field, { keys, pos }] of Object.entries(spec)) {
    const idx = cells.findIndex((c, i) => keys.some(k => c.includes(k)) && !Object.values(out).includes(i))
    out[field] = idx >= 0 ? idx : pos
  }
  return out
}

const DEVICE_SPEC = {
  deviceRef: { keys: ['deviceid'], pos: 0 }, serial: { keys: ['serial'], pos: 1 }, site: { keys: ['site'], pos: 2 },
  equipment: { keys: ['equipment'], pos: 3 }, installed: { keys: ['install'], pos: 4 }, firmware: { keys: ['firmwarever', 'firmware'], pos: 5 },
  interval: { keys: ['interval', 'reporting'], pos: 6 }, sim: { keys: ['sim', 'network'], pos: 7 }, warrantyEnd: { keys: ['warranty'], pos: 8 },
  status: { keys: ['lifecycle', 'status'], pos: 9 }, coordinator: { keys: ['onsite', 'coordinator'], pos: 10 },
  firmwareEng: { keys: ['firmwareeng'], pos: 11 }, appEng: { keys: ['applicationeng', 'appeng'], pos: 12 }, notes: { keys: ['note'], pos: 13 },
}
const CHECK_SPEC = {
  date: { keys: ['date'], pos: 0 }, deviceRef: { keys: ['deviceid', 'device'], pos: 1 }, site: { keys: ['site', 'equipment'], pos: 2 },
  coordinator: { keys: ['coordinator', 'onsite'], pos: 3 }, power: { keys: ['power'], pos: 4 }, cable: { keys: ['cable', 'indicator'], pos: 5 },
  connectivity: { keys: ['connectivity', 'operation'], pos: 6 }, lastData: { keys: ['lastdata', 'datareceived'], pos: 7 },
  firmware: { keys: ['firmwarehealth', 'firmware'], pos: 8 }, firmwareReviewer: { keys: ['firmwarereview'], pos: 9 },
  application: { keys: ['applicationhealth', 'application'], pos: 10 }, appReviewer: { keys: ['applicationreview', 'appreview'], pos: 11 },
  dataQuality: { keys: ['dataquality', 'quality'], pos: 12 }, incident: { keys: ['incident', 'ticket'], pos: 13 },
  observation: { keys: ['observation', 'action'], pos: 14 },
}
const INCIDENT_SPEC = {
  ref: { keys: ['ticketid', 'incidentid', 'ticket'], pos: 0 }, reported: { keys: ['reported'], pos: 1 }, scope: { keys: ['device', 'scope'], pos: 2 },
  site: { keys: ['site'], pos: 3 }, priority: { keys: ['priority'], pos: 4 }, category: { keys: ['category'], pos: 5 },
  impact: { keys: ['issue', 'impact'], pos: 6 }, owner: { keys: ['owner', 'assigned'], pos: 7 }, status: { keys: ['status'], pos: 8 },
  acknowledged: { keys: ['acknowledged'], pos: 9 }, nextAction: { keys: ['nextaction'], pos: 10 }, due: { keys: ['due'], pos: 11 },
  lastUpdate: { keys: ['lastupdate'], pos: 12 }, resolved: { keys: ['resolvedat', 'resolved'], pos: 13 }, rootCause: { keys: ['rootcause', 'resolution'], pos: 14 },
  verifiedBy: { keys: ['verified'], pos: 15 }, closed: { keys: ['closedat', 'closed'], pos: 16 },
}

const cellStr = v => (v == null ? '' : String(v).trim())
const emptyRow = (row, map) => Object.values(map).every(i => cellStr(row?.[i]) === '')

export async function parseTrackerFile(file) {
  await ensureXLSX()
  const XLSX = window.XLSX
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false })
  const sheet = name => {
    const key = wb.SheetNames.find(n => norm(n) === norm(name)) || wb.SheetNames.find(n => norm(n).includes(norm(name).slice(0, 6)))
    return key ? XLSX.utils.sheet_to_json(wb.Sheets[key], { header: 1, raw: true, defval: null, blankrows: true }) : null
  }
  const reg = sheet('Device Register')
  const daily = sheet('Daily Checks')
  const inc = sheet('Incidents')
  if (!reg && !daily && !inc) throw new Error('No "Device Register", "Daily Checks" or "Incidents" sheet found')

  const out = { roster: [], devices: [], checks: [], incidents: [] }

  if (reg) {
    // Spec layout: device header row 11 (index 10) — detected by header text when it moved.
    let h = findHeaderRow(reg, ['deviceid', 'serial'])
    if (h < 0) h = 10
    for (let r = 0; r < h; r++) {
      const role = mapEnum('role', reg[r]?.[0])
      if (role) out.roster.push({ rowNo: r + 1, role, primaryName: cellStr(reg[r][1]), backupName: cellStr(reg[r][2]) })
    }
    const m = columnMap(reg[h], DEVICE_SPEC)
    for (let r = h + 1; r < reg.length; r++) {
      const row = reg[r]
      if (emptyRow(row, m)) continue
      const g = f => row?.[m[f]]
      out.devices.push({
        rowNo: r + 1, deviceRef: cellStr(g('deviceRef')), serial: cellStr(g('serial')), site: cellStr(g('site')), equipment: cellStr(g('equipment')),
        firmware: cellStr(g('firmware')), interval: Number(g('interval')) || null, sim: cellStr(g('sim')),
        statusRaw: cellStr(g('status')), status: mapEnum('supportStatus', g('status')),
        coordinatorName: cellStr(g('coordinator')), firmwareEngName: cellStr(g('firmwareEng')), appEngName: cellStr(g('appEng')), notes: cellStr(g('notes')),
      })
    }
  }

  if (daily) {
    let h = findHeaderRow(daily, ['date', 'device', 'power'])
    if (h < 0) h = 12
    const m = columnMap(daily[h], CHECK_SPEC)
    for (let r = h + 1; r < daily.length; r++) {
      const row = daily[r]
      if (emptyRow(row, m)) continue
      const g = f => row?.[m[f]]
      const bad = []
      const en = (kind, f, label) => { const v = mapEnum(kind, g(f)); if (v === undefined) { bad.push(`${label}: "${cellStr(g(f))}"`); return null } return v }
      const date = excelToUtcIso(g('date'), { dateOnly: true })
      const lastData = excelToUtcIso(g('lastData'))
      if (date === undefined) bad.push(`Date: "${cellStr(g('date'))}"`)
      if (lastData === undefined) bad.push(`Last data: "${cellStr(g('lastData'))}"`)
      out.checks.push({
        rowNo: r + 1, deviceRef: cellStr(g('deviceRef')), check_date: date || null, siteText: cellStr(g('site')),
        coordinatorName: cellStr(g('coordinator')),
        power_check: en('check', 'power', 'Power'), cable_indicator_check: en('check', 'cable', 'Cable'),
        connectivity: en('connectivity', 'connectivity', 'Operation'), last_data_received_at: lastData || null,
        firmware_health: en('check', 'firmware', 'Firmware'), firmwareReviewerName: cellStr(g('firmwareReviewer')),
        application_health: en('check', 'application', 'Application'), appReviewerName: cellStr(g('appReviewer')),
        data_quality: en('check', 'dataQuality', 'Data quality'), incidentRefs: cellStr(g('incident')).split(/[,;/\s]+/).filter(Boolean),
        observation_action: cellStr(g('observation')), valueIssues: bad,
      })
    }
  }

  if (inc) {
    let h = findHeaderRow(inc, ['priority', 'status'])
    if (h < 0) h = 7
    const m = columnMap(inc[h], INCIDENT_SPEC)
    for (let r = h + 1; r < inc.length; r++) {
      const row = inc[r]
      if (emptyRow(row, m)) continue
      const g = f => row?.[m[f]]
      const bad = []
      const en = (kind, f, label) => { const v = mapEnum(kind, g(f)); if (v === undefined) { bad.push(`${label}: "${cellStr(g(f))}"`); return null } return v }
      const ts = (f, label) => { const v = excelToUtcIso(g(f)); if (v === undefined) { bad.push(`${label}: "${cellStr(g(f))}"`); return null } return v }
      out.incidents.push({
        rowNo: r + 1, legacy_ref: cellStr(g('ref')), reported_at: ts('reported', 'Reported at'), scopeText: cellStr(g('scope')), site: cellStr(g('site')),
        priority: en('priority', 'priority', 'Priority'), category: en('category', 'category', 'Category'), issue_business_impact: cellStr(g('impact')),
        ownerName: cellStr(g('owner')), status: en('incidentStatus', 'status', 'Status') || 'OPEN', acknowledged_at: ts('acknowledged', 'Acknowledged'),
        next_action: cellStr(g('nextAction')), action_due_at: ts('due', 'Action due'), last_update_at: ts('lastUpdate', 'Last update'),
        resolved_at: ts('resolved', 'Resolved at'), root_cause_resolution: cellStr(g('rootCause')), verifiedByName: cellStr(g('verifiedBy')),
        closed_at: ts('closed', 'Closed at'), valueIssues: bad,
      })
    }
  }
  return out
}

/* ═══ Import: stage + resolve ═══ */

// Matches device refs against the org's device master (by device code,
// then serial) and against the engagement's current enrollments.
export async function resolveDevices(parsed, enrollments) {
  const refs = [...new Set([
    ...parsed.devices.flatMap(d => [d.deviceRef, d.serial]),
    ...parsed.checks.map(c => c.deviceRef),
    ...parsed.incidents.flatMap(i => i.scopeText.split(/[,;]+/).map(s => s.trim())),
  ].filter(Boolean))]
  const found = []
  for (let i = 0; i < refs.length; i += 100) {
    const chunk = refs.slice(i, i + 100)
    const [byCode, bySerial] = await Promise.all([
      supabase.from('device_instances').select('id,device_code,serial_number,project_id,current_location').in('device_code', chunk),
      supabase.from('device_instances').select('id,device_code,serial_number,project_id,current_location').in('serial_number', chunk),
    ])
    found.push(...(byCode.data || []), ...(bySerial.data || []))
  }
  const byRef = {}
  const dup = new Set()
  for (const d of found) {
    for (const key of [d.device_code, d.serial_number].filter(Boolean)) {
      const k = norm(key)
      if (byRef[k] && byRef[k].id !== d.id) dup.add(k)
      byRef[k] = d
    }
  }
  for (const k of dup) delete byRef[k] // not uniquely matched
  const enrByDevice = Object.fromEntries(enrollments.map(e => [e.device_id, e]))
  // Register rows can also resolve a check's device id via their serial.
  const serialOfRef = Object.fromEntries(parsed.devices.filter(d => d.deviceRef && d.serial).map(d => [norm(d.deviceRef), norm(d.serial)]))
  const lookup = ref => {
    const k = norm(ref)
    return byRef[k] || (serialOfRef[k] && byRef[serialOfRef[k]]) || null
  }
  return { lookup, enrByDevice }
}

// Builds the preview: per-row status, issues and what will be written.
// `maps` holds the user's manual resolutions: { devices: {ref: deviceId}, people: {name: userId|'__legacy'}, keep: {checkRowNo: true} }.
export function stageImport(parsed, { lookup, enrByDevice }, people, maps = { devices: {}, people: {}, keep: {} }, existingChecks = []) {
  const personFor = name => {
    if (!name) return { id: null, legacy: null, status: 'blank' }
    const manual = maps.people[norm(name)]
    if (manual === '__legacy') return { id: null, legacy: name, status: 'legacy' }
    if (manual) return { id: manual, legacy: null, status: 'mapped' }
    const m = matchPerson(name, people)
    return m ? { id: m.id, legacy: null, status: m.confidence } : { id: null, legacy: name, status: 'unresolved' }
  }
  const deviceFor = ref => {
    if (!ref) return null
    const manual = maps.devices[norm(ref)]
    return manual ? { id: manual, manual: true } : lookup(ref)
  }
  const unresolvedNames = new Set()
  const unresolvedDevices = new Set()
  const noteName = (p, name) => { if (p.status === 'unresolved') unresolvedNames.add(name) }

  const roster = parsed.roster.map(r => {
    const primary = personFor(r.primaryName), backup = personFor(r.backupName)
    noteName(primary, r.primaryName); noteName(backup, r.backupName)
    const issues = []
    if (!primary.id) issues.push(r.primaryName ? `Primary "${r.primaryName}" not matched to a user` : 'No primary')
    return { ...r, primary, backup, issues, ok: !!primary.id }
  })

  const devices = parsed.devices.map(d => {
    const dev = deviceFor(d.deviceRef) || deviceFor(d.serial)
    const issues = []
    if (!dev) { issues.push('Not in the device master — register it in Devices, or map it'); unresolvedDevices.add(d.deviceRef || d.serial) }
    if (d.statusRaw && !d.status) issues.push(`Unknown lifecycle status "${d.statusRaw}"`)
    if (!d.statusRaw) issues.push('Lifecycle status blank — imported as Active (the Excel did not count it as active)')
    const coord = personFor(d.coordinatorName), fw = personFor(d.firmwareEngName), app = personFor(d.appEngName)
    noteName(coord, d.coordinatorName); noteName(fw, d.firmwareEngName); noteName(app, d.appEngName)
    const enrolled = dev ? enrByDevice[dev.id] : null
    return { ...d, device: dev, enrolled, coord, fw, app, issues, action: !dev ? 'blocked' : enrolled ? 'already enrolled' : 'enroll' }
  })
  const plannedDeviceIds = new Set(devices.filter(d => d.device).map(d => d.device.id))

  // Duplicate device+date groups (Excel column P "Duplicate").
  const keyOf = c => { const dev = deviceFor(c.deviceRef); return dev && c.check_date ? `${dev.id}|${c.check_date}` : null }
  const groups = {}
  parsed.checks.forEach(c => { const k = keyOf(c); if (k) (groups[k] ||= []).push(c.rowNo) })
  const existingKeys = new Set(existingChecks.map(c => `${c.device_id}|${c.check_date}`))

  const checks = parsed.checks.map(c => {
    const dev = deviceFor(c.deviceRef)
    const enrolled = dev && (enrByDevice[dev.id] || plannedDeviceIds.has(dev.id))
    const coord = personFor(c.coordinatorName), fw = personFor(c.firmwareReviewerName), app = personFor(c.appReviewerName)
    noteName(coord, c.coordinatorName); noteName(fw, c.firmwareReviewerName); noteName(app, c.appReviewerName)
    const k = keyOf(c)
    const dupRows = k ? groups[k] : []
    const isDup = dupRows.length > 1
    const inNeoX = k && existingKeys.has(k)
    const deviceUnmatched = !!c.deviceRef && !enrolled
    if (deviceUnmatched) unresolvedDevices.add(c.deviceRef)
    const row = {
      ...c, enrollment_id: enrolled ? 'staged' : null, device_ref: c.deviceRef, site_snapshot: c.siteText.split('/')[0].trim(),
      onsite_coordinator_user_id: coord.id, onsite_coordinator_legacy: coord.legacy,
      firmware_reviewer_user_id: fw.id, firmware_reviewer_legacy: fw.legacy,
      application_reviewer_user_id: app.id, application_reviewer_legacy: app.legacy,
    }
    const kept = isDup ? !!maps.keep[c.rowNo] : true
    const result = computeDailyResult(row, { duplicate: isDup && !kept, deviceUnmatched, imported: true })
    const issues = [...c.valueIssues]
    if (deviceUnmatched) issues.push(`Device "${c.deviceRef}" not matched`)
    if (isDup) issues.push(kept ? `Kept — duplicates rows ${dupRows.filter(n => n !== c.rowNo).join(', ')}` : `Duplicate of row(s) ${dupRows.filter(n => n !== c.rowNo).join(', ')} — pick one to keep`)
    if (inNeoX) issues.push('A check for this device and date already exists in NeoX — skipped')
    const blocked = result === 'CHECK_DEVICE_ID' || result === 'DUPLICATE' || inNeoX || !c.check_date || !dev
    return { ...row, device: dev, result, dupGroup: isDup ? k : null, kept, issues, blocked }
  })

  const incidents = parsed.incidents.map(i => {
    const owner = personFor(i.ownerName), verifier = personFor(i.verifiedByName)
    noteName(owner, i.ownerName); noteName(verifier, i.verifiedByName)
    const s = norm(i.scopeText)
    const parts = i.scopeText.split(/[,;]+/).map(x => x.trim()).filter(Boolean)
    const devs = parts.map(deviceFor).filter(Boolean)
    const scope_type = s.includes('platform') || s === 'all' ? 'PLATFORM' : s.includes('site') ? 'SITE' : devs.length > 1 ? 'MULTI_DEVICE' : 'DEVICE'
    const issues = [...i.valueIssues]
    if ((scope_type === 'DEVICE' || scope_type === 'MULTI_DEVICE') && parts.length && devs.length < parts.length) issues.push('Some devices in scope not matched')
    const row = {
      ...i, scope_type, deviceIds: devs.map(d => d.id),
      assigned_owner_user_id: owner.id, assigned_owner_legacy: owner.legacy, verified_by_user_id: verifier.id, verified_by_legacy: verifier.legacy,
    }
    return { ...row, flag: computeFollowUpFlag(row), issues }
  })

  return {
    roster, devices, checks, incidents,
    unresolvedNames: [...unresolvedNames].sort(),
    unresolvedDevices: [...unresolvedDevices].filter(Boolean).sort(),
    summary: {
      devicesToEnroll: devices.filter(d => d.action === 'enroll').length,
      devicesBlocked: devices.filter(d => d.action === 'blocked').length,
      checksReady: checks.filter(c => !c.blocked).length,
      checksBlocked: checks.filter(c => c.blocked).length,
      duplicateGroups: new Set(checks.filter(c => c.dupGroup).map(c => c.dupGroup)).size,
      incidents: incidents.length,
    },
  }
}

/* ═══ Import: commit ═══ */

const chunked = async (rows, fn, size = 200) => { const out = []; for (let i = 0; i < rows.length; i += size) out.push(...(await fn(rows.slice(i, i + size)))); return out }

export async function commitImport(engagement, staged) {
  const batch = crypto.randomUUID()
  const report = []

  // 1. Roster — only rows with a matched primary (roster needs a real user).
  const cur = currentRoster(await listRoster(engagement.id))
  for (const r of staged.roster) {
    if (!r.ok) { report.push(['Roster', r.rowNo, 'skipped', r.issues.join('; ')]); continue }
    const c = cur[r.role]
    if (c && c.primary_user_id === r.primary.id && (c.backup_user_id || null) === (r.backup.id || null)) { report.push(['Roster', r.rowNo, 'unchanged', '']); continue }
    await assignRole(engagement.id, r.role, { primary_user_id: r.primary.id, backup_user_id: r.backup.id }, c)
    report.push(['Roster', r.rowNo, 'saved', ''])
  }

  // 2. Enrollments (import skips the deployed-to-project guard; the device must still exist).
  const toEnroll = staged.devices.filter(d => d.action === 'enroll')
  const seen = new Set()
  const enrollRows = toEnroll.filter(d => !seen.has(d.device.id) && seen.add(d.device.id)).map(d => ({
    engagement_id: engagement.id, device_id: d.device.id, import_batch_id: batch,
    site: d.site || null, equipment_id: d.equipment || null, firmware_version: d.firmware || null, connectivity_ref: d.sim || null,
    expected_reporting_interval_min: d.interval || 15, support_status: d.status || 'ACTIVE',
    status_reason: d.status && d.status !== 'ACTIVE' ? 'Imported from Excel' : null,
    onsite_coordinator_user_id: d.coord.id, firmware_engineer_user_id: d.fw.id, application_engineer_user_id: d.app.id, notes: d.notes || null,
  }))
  await chunked(enrollRows, async rows => {
    const { data, error } = await supabase.from('golive_enrollments').insert(rows).select('id')
    if (error) throw new Error(`Enrollment import failed: ${error.message}`)
    return data
  })
  for (const d of staged.devices) report.push(['Device', d.rowNo, d.action === 'enroll' ? 'enrolled' : d.action, d.issues.join('; ')])
  const enrByDevice = Object.fromEntries((await listEnrollments(engagement.id)).map(e => [e.device_id, e]))

  // 3. Incidents first, so check "Incident ID" cells can link to them.
  const incRows = staged.incidents.map(i => ({
    engagement_id: engagement.id, import_batch_id: batch, legacy_ref: i.legacy_ref || null,
    title: (i.issue_business_impact || i.legacy_ref || 'Imported incident').slice(0, 120),
    scope_type: i.scope_type, device_enrollment_ids: i.deviceIds.map(id => enrByDevice[id]?.id).filter(Boolean), site: i.site || null,
    reported_at: i.reported_at, priority: i.priority, category: i.category, issue_business_impact: i.issue_business_impact || null,
    assigned_owner_user_id: i.assigned_owner_user_id, assigned_owner_legacy: i.assigned_owner_legacy, status: i.status,
    acknowledged_at: i.acknowledged_at, next_action: i.next_action || null, action_due_at: i.action_due_at,
    last_update_at: i.last_update_at || i.reported_at, resolved_at: i.resolved_at, root_cause_resolution: i.root_cause_resolution || null,
    verified_by_user_id: i.verified_by_user_id, verified_by_legacy: i.verified_by_legacy, closed_at: i.closed_at,
  }))
  const createdInc = await chunked(incRows, async rows => {
    const { data, error } = await supabase.from('golive_incidents').insert(rows).select('id,legacy_ref,number')
    if (error) throw new Error(`Incident import failed: ${error.message}`)
    return data
  })
  const incByRef = Object.fromEntries(createdInc.filter(i => i.legacy_ref).map(i => [norm(i.legacy_ref), i.id]))
  staged.incidents.forEach((i, n) => report.push(['Incident', i.rowNo, `imported as ${createdInc[n]?.number || '?'}`, i.issues.join('; ')]))

  // 4. Checks.
  const ready = staged.checks.filter(c => !c.blocked && enrByDevice[c.device.id])
  const checkRows = ready.map(c => ({
    engagement_id: engagement.id, enrollment_id: enrByDevice[c.device.id].id, import_batch_id: batch, check_date: c.check_date,
    site_snapshot: c.site_snapshot || enrByDevice[c.device.id].site || null,
    equipment_snapshot: c.siteText.includes('/') ? c.siteText.split('/').slice(1).join('/').trim() : null,
    onsite_coordinator_user_id: c.onsite_coordinator_user_id, onsite_coordinator_legacy: c.onsite_coordinator_legacy,
    power_check: c.power_check, cable_indicator_check: c.cable_indicator_check, connectivity: c.connectivity,
    last_data_received_at: c.last_data_received_at, firmware_health: c.firmware_health,
    firmware_reviewer_user_id: c.firmware_reviewer_user_id, firmware_reviewer_legacy: c.firmware_reviewer_legacy,
    application_health: c.application_health, application_reviewer_user_id: c.application_reviewer_user_id,
    application_reviewer_legacy: c.application_reviewer_legacy, data_quality: c.data_quality, observation_action: c.observation_action || null,
  }))
  const createdChecks = await chunked(checkRows, async rows => {
    const { data, error } = await supabase.from('golive_daily_checks').insert(rows).select('id')
    if (error) throw new Error(`Check import failed: ${error.message}`)
    return data
  })
  for (let n = 0; n < ready.length; n++) {
    const ids = ready[n].incidentRefs.map(r => incByRef[norm(r)]).filter(Boolean)
    for (const incId of ids) await linkChecks(incId, [createdChecks[n].id])
  }
  for (const c of staged.checks) report.push(['Daily check', c.rowNo, c.blocked || !enrByDevice[c.device?.id] ? 'skipped' : 'imported', c.issues.join('; ')])

  return {
    batch, report,
    counts: { enrolled: enrollRows.length, incidents: createdInc.length, checks: createdChecks.length, skippedChecks: staged.checks.length - createdChecks.length },
  }
}

export async function downloadImportReport(engagement, report) {
  await ensureXLSX()
  const XLSX = window.XLSX
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([['Sheet', 'Excel row', 'Outcome', 'Notes'], ...report])
  ws['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 22 }, { wch: 80 }]
  XLSX.utils.book_append_sheet(wb, ws, 'Import report')
  XLSX.writeFile(wb, `${engagement.code}_import_report_${istDateOf(new Date())}.xlsx`)
}

// Devices round trip — export the enrolled devices, edit in Excel, upload
// back. Matching and change planning live in goLiveDeviceSheet.js (pure).
export async function exportDevicesSheet(engagement, enrollments, people, extras) {
  await ensureXLSX()
  const XLSX = window.XLSX
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(buildDeviceSheet(enrollments, people, extras))
  ws['!cols'] = sheetColumns(extras?.fields).map(c => ({ wch: c.key === 'ref' ? 38 : c.key === 'notes' ? 40 : Math.max(12, c.header.length + 2) }))
  XLSX.utils.book_append_sheet(wb, ws, 'Devices')
  XLSX.writeFile(wb, `${engagement.code}_devices_${istToday()}.xlsx`)
}

export async function readDevicesSheet(file, enrollments, people, fields = []) {
  await ensureXLSX()
  const XLSX = window.XLSX
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false })
  const name = wb.SheetNames.includes('Devices') ? 'Devices' : wb.SheetNames[0]
  if (!name) throw new Error('The file has no sheets')
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false })
  return planDeviceUpload(rows, enrollments, people, fields)
}
