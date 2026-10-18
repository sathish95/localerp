// Go-Live Support (STEP235) — pure business rules, no Supabase import so
// they can be unit-tested with plain node (goLiveRules.test.mjs).
//
// computeDailyResult / computeFollowUpFlag are ports of the Excel tracker's
// column P / column R formulas and are mirrored server-side by
// golive_compute_daily_result / golive_compute_follow_up_flag in
// sql/STEP235_golive_support.sql, which is what actually persists the
// value. Change both together.

/* ═══ Enums + labels ═══ */

export const ROSTER_ROLES = [
  { key: 'ONSITE_COORDINATOR', label: 'Onsite Coordinator', note: 'Physical checks and onsite evidence' },
  { key: 'FIRMWARE_ENGINEER', label: 'Firmware Engineer', note: 'Device health and authorised firmware updates' },
  { key: 'APPLICATION_ENGINEER', label: 'Application Engineer', note: 'Ingestion, dashboard, alerts and data quality' },
  { key: 'ESCALATION_OWNER', label: 'Escalation Owner', note: 'Escalations, verification and closure' },
]
export const ENGAGEMENT_STATUSES = [
  { key: 'DRAFT', label: 'Draft', badge: 'gray' },
  { key: 'ACTIVE', label: 'Active', badge: 'success' },
  { key: 'EXIT_REVIEW', label: 'Exit Review', badge: 'warning' },
  { key: 'CLOSED', label: 'Closed', badge: 'info' },
  { key: 'CANCELLED', label: 'Cancelled', badge: 'danger' },
]
export const SUPPORT_STATUSES = [
  { key: 'ACTIVE', label: 'Active' },
  { key: 'MAINTENANCE', label: 'Maintenance' },
  { key: 'DECOMMISSIONED', label: 'Decommissioned' },
]
export const CHECK_STATUSES = [
  { key: 'PASS', label: 'Pass' },
  { key: 'FAIL', label: 'Fail' },
  { key: 'NOT_CHECKED', label: 'Not checked' },
  { key: 'NOT_APPLICABLE', label: 'Not applicable' },
]
// The onsite "Operation" check (column `connectivity`): Yes / No. Stored as
// ONLINE / OFFLINE so the result rules, trigger, imports and reports are
// unchanged; INTERMITTENT is kept only for older checks that have it.
export const CONNECTIVITY_STATUSES = [
  { key: 'ONLINE', label: 'Yes' },
  { key: 'OFFLINE', label: 'No' },
  { key: 'INTERMITTENT', label: 'Intermittent' },
  { key: 'NOT_CHECKED', label: 'Not checked' },
  { key: 'NOT_APPLICABLE', label: 'Not applicable' },
]
export const OPERATION_OPTIONS = CONNECTIVITY_STATUSES.filter(s => s.key !== 'INTERMITTENT')
export const OPERATION_LABEL = 'Operation'
export const PRIORITIES = [
  { key: 'P1_CRITICAL', label: 'P1 - Critical', short: 'P1' },
  { key: 'P2_HIGH', label: 'P2 - High', short: 'P2' },
  { key: 'P3_NORMAL', label: 'P3 - Normal', short: 'P3' },
  { key: 'P4_REQUEST', label: 'P4 - Request', short: 'P4' },
]
export const CATEGORIES = [
  { key: 'HARDWARE', label: 'Hardware' },
  { key: 'FIRMWARE', label: 'Firmware' },
  { key: 'CONNECTIVITY', label: 'Connectivity' },
  { key: 'APPLICATION', label: 'Application' },
  { key: 'DATA_QUALITY', label: 'Data quality' },
  { key: 'REQUEST', label: 'Request' },
]
export const INCIDENT_STATUSES = [
  { key: 'OPEN', label: 'Open' },
  { key: 'IN_PROGRESS', label: 'In progress' },
  { key: 'AWAITING_SITE', label: 'Awaiting site' },
  { key: 'AWAITING_VENDOR', label: 'Awaiting vendor' },
  { key: 'RESOLVED', label: 'Resolved' },
  { key: 'CLOSED', label: 'Closed' },
]
export const SCOPE_TYPES = [
  { key: 'DEVICE', label: 'Single device' },
  { key: 'MULTI_DEVICE', label: 'Multiple devices' },
  { key: 'SITE', label: 'Whole site' },
  { key: 'PLATFORM', label: 'Platform' },
]

// Colour semantics carried over from the Excel (always shown with a label).
export const DAILY_RESULTS = {
  HEALTHY: { label: 'Healthy', badge: 'success', color: '#059669' },
  ATTENTION: { label: 'Attention', badge: 'danger', color: '#dc2626' },
  INCOMPLETE: { label: 'Incomplete', badge: 'warning', color: '#d97706' },
  DUPLICATE: { label: 'Duplicate', badge: 'purple', color: '#7c3aed' },
  CHECK_DEVICE_ID: { label: 'Check device ID', badge: 'purple', color: '#7c3aed' },
}
export const FOLLOW_UP_FLAGS = {
  OVERDUE: { label: 'Overdue', badge: 'danger' },
  CLOSURE_INCOMPLETE: { label: 'Closure incomplete', badge: 'warning' },
  COMPLETE_TICKET: { label: 'Complete ticket', badge: 'warning' },
  ON_TRACK: { label: 'On track', badge: 'success' },
  CLOSED: { label: 'Closed', badge: 'gray' },
}

export const labelOf = (list, key) => list.find(x => x.key === key)?.label || key || ''

export const DEFAULT_EXIT_CRITERIA = {
  consecutive_days: 7, coverage_pct: 100, healthy_pct: 95,
  max_open_p1: 0, max_open_p2: 0, max_overdue: 0, require_customer_signoff: true,
}
export const DEFAULT_CONFIG = {
  stale_multiplier: 2, back_date_days: 1, verifier_must_differ: true,
  require_incident_on_attention: true, stale_data_warning: true,
  ack_minutes: { P1_CRITICAL: 30, P2_HIGH: 120, P3_NORMAL: 480, P4_REQUEST: 1440 },
}

/* ═══ Application review: telemetry parameter checklist (STEP239) ═══ */

// The reviewer ticks each parameter the application shows correctly.
// Ticked = working, unticked = not working, N/A = the device doesn't report it.
// Stored on the check as parameter_checks { key: 'WORKING' | 'NOT_WORKING' | 'NA' };
// NULL means the checklist was never reviewed.
export const PARAM_STATUSES = [
  { key: 'WORKING', label: 'Working' },
  { key: 'NOT_WORKING', label: 'Not working' },
  { key: 'NA', label: 'N/A' },
]

export const paramKey = label => String(label ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

export const DEFAULT_CHECK_PARAMETERS = [
  ['Fuel Level', 'ltr'], ['Engine Coolant Temperature', '°C'], ['Engine Oil Pressure', 'kPa'], ['Engine Oil Temperature', '°C'],
  ['Throttle Position', '%'], ['Engine Load', '%'], ['Engine Running Status', 'ON / OFF'], ['Device Engine Runtime', 'hours'],
  ['Pre Running Hours', 'hours'], ['Engine Runtime', 'hours'], ['Hydraulic Oil Temperature', '°C'], ['Serial Number', ''],
].map(([label, unit]) => ({ key: paramKey(label), label, unit }))

// Engagement config.parameters overrides the default list.
export const checkParameters = config => (Array.isArray(config?.parameters) && config.parameters.length ? config.parameters : DEFAULT_CHECK_PARAMETERS)

// One parameter per line, "Label | unit" (unit optional). Duplicate labels collapse.
export function parseParameterLines(text) {
  const out = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const [label, unit = ''] = line.split('|').map(s => s.trim())
    const key = paramKey(label)
    if (key && !out.some(p => p.key === key)) out.push({ key, label, unit })
  }
  return out
}
export const parameterLines = params => params.map(p => (p.unit ? `${p.label} | ${p.unit}` : p.label)).join('\n')

// Every listed parameter gets a status; anything not ticked or N/A is not working.
export function fillParameterChecks(map, params) {
  return Object.fromEntries(params.map(p => [p.key, ['WORKING', 'NA'].includes(map?.[p.key]) ? map[p.key] : 'NOT_WORKING']))
}

// Counts against the current list (keys no longer listed are ignored).
export function parameterSummary(map, params) {
  const s = { reviewed: !!map, working: 0, notWorking: 0, na: 0, notWorkingLabels: [] }
  if (!map) return s
  for (const p of params) {
    const v = map[p.key]
    if (v === 'WORKING') s.working++
    else if (v === 'NA') s.na++
    else if (v === 'NOT_WORKING') { s.notWorking++; s.notWorkingLabels.push(p.label) }
  }
  return s
}

/* ═══ Consolidated fleet summary (STEP250) ═══ */

// rows: one per enrolled equipment — { category, support_status, last_result,
// connectivity, last_maintenance, sensors_total, sensors_working,
// sensors_down, sensors_missing }. Same numbers on the Overview tab and in
// the shared report.
export function fleetSummary(rows) {
  const blankTotals = () => ({ devices: 0, sensorsInstalled: 0, workingDevices: 0, notWorkingDevices: 0, noCheck: 0, workingSensors: 0, notWorkingSensors: 0, sensorsNotInstalled: 0, sensorsUnreviewed: 0, maintenance: 0, noOperation: 0 })
  const add = (t, r) => {
    const maint = !!r.last_maintenance || r.support_status === 'MAINTENANCE'
    t.devices++
    t.sensorsInstalled += Number(r.sensors_total || 0)
    t.workingSensors += Number(r.sensors_working || 0)
    t.notWorkingSensors += Number(r.sensors_down || 0)
    t.sensorsNotInstalled += Number(r.sensors_missing || 0)
    t.sensorsUnreviewed += Math.max(0, Number(r.sensors_total || 0) - Number(r.sensors_working || 0) - Number(r.sensors_down || 0))
    if (r.last_result === 'HEALTHY') t.workingDevices++
    else if (r.last_result === 'ATTENTION') t.notWorkingDevices++
    else if (!r.last_result) t.noCheck++
    if (maint) t.maintenance++
    else if (r.connectivity === 'OFFLINE') t.noOperation++
  }
  const total = blankTotals()
  const byCat = {}
  for (const r of rows) { add(total, r); add(byCat[r.category || 'Uncategorised'] ||= blankTotals(), r) }
  return { total, categories: Object.entries(byCat).sort(([a], [b]) => a.localeCompare(b)).map(([category, t]) => ({ category, ...t })) }
}

/* ═══ §5.1 Daily result ═══ */

const blank = v => v == null || (typeof v === 'string' && v.trim() === '')
const hasPerson = (id, legacy) => !blank(id) || !blank(legacy)

// Attention severity (STEP249): required when the result is ATTENTION; HIGH
// can't be waived — it needs an incident.
export const SEVERITIES = [
  { key: 'HIGH', label: 'High', priority: 'P2_HIGH' },
  { key: 'MEDIUM', label: 'Medium', priority: 'P3_NORMAL' },
  { key: 'LOW', label: 'Low', priority: 'P4_REQUEST' },
]
const paramsDown = check => Object.values(check?.parameter_checks || {}).filter(v => v === 'NOT_WORKING').length

// context.duplicate / context.deviceUnmatched are only ever set by import
// staging — live entry can't produce them (unique index + enrollment FK).
// context.faultySensors: sensors on the device marked FAULTY (STEP249).
// context.imported: import staging (kept for callers; the checklist is optional since STEP254).
// Returns null when there's no device at all (row ignored, as in Excel).
// Mirrors golive_compute_daily_result() (STEP254) — change both together.
export function computeDailyResult(check, context = {}) {
  if (!check || (blank(check.enrollment_id) && blank(check.device_ref))) return null
  if (blank(check.check_date)) return 'INCOMPLETE'
  if (context.duplicate) return 'DUPLICATE'
  if (context.deviceUnmatched) return 'CHECK_DEVICE_ID'

  const statuses = [check.power_check, check.cable_indicator_check, check.connectivity, check.firmware_health, check.application_health, check.data_quality]
  if (check.power_check === 'FAIL' || check.cable_indicator_check === 'FAIL'
    || ((check.connectivity === 'OFFLINE' || check.connectivity === 'INTERMITTENT') && !check.equipment_maintenance)
    || check.firmware_health === 'FAIL' || check.application_health === 'FAIL' || check.data_quality === 'FAIL'
    || paramsDown(check) > 0 || (context.faultySensors || 0) > 0) {
    return 'ATTENTION'
  }
  if (blank(check.site_snapshot)
    || !hasPerson(check.onsite_coordinator_user_id, check.onsite_coordinator_legacy)
    || statuses.some(blank)
    || blank(check.last_data_received_at)
    || !hasPerson(check.firmware_reviewer_user_id, check.firmware_reviewer_legacy)
    || !hasPerson(check.application_reviewer_user_id, check.application_reviewer_legacy)
    || statuses.includes('NOT_CHECKED')) {
    return 'INCOMPLETE'
  }
  return 'HEALTHY'
}

// R-A1: category inferred from the first failing field.
export function inferIncidentCategory(check) {
  if (check.power_check === 'FAIL' || check.cable_indicator_check === 'FAIL') return 'HARDWARE'
  if (check.connectivity === 'OFFLINE' || check.connectivity === 'INTERMITTENT') return 'CONNECTIVITY'
  if (check.firmware_health === 'FAIL') return 'FIRMWARE'
  if (check.application_health === 'FAIL') return 'APPLICATION'
  if (check.data_quality === 'FAIL' || paramsDown(check)) return 'DATA_QUALITY'
  return 'HARDWARE'
}

export function failingFields(check) {
  const out = []
  if (check.power_check === 'FAIL') out.push('Power')
  if (check.cable_indicator_check === 'FAIL') out.push('Cable / indicator')
  if ((check.connectivity === 'OFFLINE' || check.connectivity === 'INTERMITTENT') && !check.equipment_maintenance) out.push(check.connectivity === 'OFFLINE' ? 'Operation: No' : 'Operation intermittent')
  if (check.firmware_health === 'FAIL') out.push('Firmware')
  if (check.application_health === 'FAIL') out.push('Application')
  if (check.data_quality === 'FAIL') out.push('Data quality')
  if (paramsDown(check)) out.push(`${paramsDown(check)} parameter${paramsDown(check) === 1 ? '' : 's'} not working`)
  if (check.faulty_sensors) out.push(`${check.faulty_sensors} sensor${check.faulty_sensors === 1 ? '' : 's'} faulty`)
  return out
}

// Minutes between last data and the check (A3 stale threshold = multiplier × interval).
export function dataGapMinutes(lastDataAt, at = new Date()) {
  if (blank(lastDataAt)) return null
  return Math.max(0, Math.floor((new Date(at) - new Date(lastDataAt)) / 60000))
}

// R-A2: Online but data is stale.
export function isStaleWhileOnline(check, intervalMin, multiplier = 2, at = new Date()) {
  if (check.connectivity !== 'ONLINE') return false
  const gap = dataGapMinutes(check.last_data_received_at, at)
  return gap != null && intervalMin > 0 && gap > multiplier * intervalMin
}

/* ═══ §5.2 Follow-up flag ═══ */

export function computeFollowUpFlag(incident, now = new Date()) {
  const i = incident || {}
  if (i.status === 'CLOSED') {
    const complete = !blank(i.resolved_at) && !blank(i.root_cause_resolution)
      && hasPerson(i.verified_by_user_id, i.verified_by_legacy) && !blank(i.closed_at)
    return complete ? 'CLOSED' : 'CLOSURE_INCOMPLETE'
  }
  if (blank(i.reported_at) || blank(i.priority) || !hasPerson(i.assigned_owner_user_id, i.assigned_owner_legacy)
    || blank(i.status) || blank(i.next_action) || blank(i.action_due_at)) {
    return 'COMPLETE_TICKET'
  }
  if (new Date(i.action_due_at) < new Date(now)) return 'OVERDUE'
  return 'ON_TRACK'
}

/* ═══ §7.3 Incident transition guards (client-side preview; DB enforces) ═══ */

export function transitionErrors(incident, toStatus, { verifierMustDiffer = true } = {}) {
  const i = { ...incident, status: toStatus }
  const errs = []
  const from = incident.status
  if (from === 'CLOSED' && !['OPEN', 'IN_PROGRESS', 'AWAITING_SITE', 'AWAITING_VENDOR'].includes(toStatus)) errs.push('A closed incident can only be reopened')
  const reopening = ['RESOLVED', 'CLOSED'].includes(from) && ['OPEN', 'IN_PROGRESS', 'AWAITING_SITE', 'AWAITING_VENDOR'].includes(toStatus)
  if (reopening && blank(i.reopen_reason)) errs.push('Reason to reopen')
  if (toStatus !== 'OPEN' && blank(i.assigned_owner_user_id)) errs.push('Assigned owner')
  if (['IN_PROGRESS', 'AWAITING_SITE', 'AWAITING_VENDOR'].includes(toStatus)) {
    if (blank(i.next_action)) errs.push('Next action')
    if (blank(i.action_due_at)) errs.push('Action due')
  }
  if (toStatus === 'AWAITING_VENDOR' && blank(i.vendor_ref)) errs.push('Vendor reference')
  if (toStatus === 'RESOLVED' && blank(i.root_cause_resolution)) errs.push('Root cause / resolution')
  if (toStatus === 'CLOSED') {
    if (from !== 'RESOLVED') errs.push('Must be RESOLVED before closing')
    if (blank(i.verified_by_user_id)) errs.push('Verified by')
    else if (verifierMustDiffer && i.verified_by_user_id === i.assigned_owner_user_id) errs.push('Verifier must differ from the owner')
  }
  return errs
}

/* ═══ IST helpers (store UTC, show IST) ═══ */

export const IST_TZ = 'Asia/Kolkata'

// Today's IST calendar day as YYYY-MM-DD.
export function istToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
export function istDateOf(ts) {
  if (!ts) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts))
}
export function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000)
}
// UTC ISO → value for <input type="datetime-local"> in IST.
export function toIstInput(ts) {
  if (!ts) return ''
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(ts)).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`
}
// <input type="datetime-local"> value, read as IST → UTC ISO.
export function fromIstInput(v) {
  if (!v) return null
  return new Date(`${v}:00+05:30`).toISOString()
}
export function istDateTime(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-IN', { timeZone: IST_TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

/* ═══ §9 KPIs for a review date ═══ */

// enrollments: engagement enrollments (not deleted); checks: rows for the
// review date; incidents: all engagement incidents; recentChecks: last 7
// days (for repeat failures).
export function computeKpis({ enrollments = [], checks = [], incidents = [], recentChecks = [], now = new Date() }) {
  const live = enrollments.filter(e => !e.deleted_at && !e.unenrolled_at)
  const active = live.filter(e => e.support_status === 'ACTIVE')
  const activeIds = new Set(active.map(e => e.id))
  const dayChecks = checks.filter(c => !c.deleted_at)
  const loggedActive = new Set(dayChecks.filter(c => activeIds.has(c.enrollment_id)).map(c => c.enrollment_id))
  const byResult = r => dayChecks.filter(c => c.daily_result === r).length
  const liveIncidents = incidents.filter(i => !i.deleted_at)
  const open = liveIncidents.filter(i => i.status !== 'CLOSED')
  const flagOf = i => computeFollowUpFlag(i, now)

  const mins = (a, b) => (a && b ? (new Date(b) - new Date(a)) / 60000 : null)
  const avg = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
  const byPriority = {}
  for (const p of PRIORITIES) {
    const rows = liveIncidents.filter(i => i.priority === p.key)
    byPriority[p.key] = {
      mtta: avg(rows.map(i => mins(i.reported_at, i.acknowledged_at)).filter(x => x != null)),
      mttr: avg(rows.map(i => mins(i.reported_at, i.resolved_at)).filter(x => x != null)),
      count: rows.length,
    }
  }

  const attentionCount = {}
  for (const c of recentChecks) if (!c.deleted_at && c.daily_result === 'ATTENTION') attentionCount[c.enrollment_id] = (attentionCount[c.enrollment_id] || 0) + 1
  const repeatFailures = Object.entries(attentionCount).filter(([, n]) => n >= 3).map(([id, n]) => ({ enrollment_id: id, count: n }))

  const byCategory = CATEGORIES.map(c => ({ key: c.key, label: c.label, count: liveIncidents.filter(i => i.category === c.key).length }))

  const logged = dayChecks.length
  const healthy = byResult('HEALTHY')
  return {
    activeDevices: active.length,
    checksLogged: logged,
    healthy,
    attention: byResult('ATTENTION'),
    incomplete: byResult('INCOMPLETE'),
    duplicates: byResult('DUPLICATE'),
    openTickets: open.length,
    overdue: liveIncidents.filter(i => flagOf(i) === 'OVERDUE').length,
    criticalOpen: open.filter(i => i.priority === 'P1_CRITICAL').length,
    missing: active.filter(e => !loggedActive.has(e.id)),
    missingCount: active.length - loggedActive.size,
    pendingReviews: dayChecks.filter(c => !c.reviewed_complete_at).length,
    coveragePct: active.length ? Math.round((loggedActive.size / active.length) * 1000) / 10 : null,
    healthyPct: logged ? Math.round((healthy / logged) * 1000) / 10 : null,
    byPriority,
    repeatFailures,
    byCategory,
  }
}

/* ═══ Import value mapping (Excel dropdown text → enums) ═══ */

const norm = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

const ALIASES = {
  check: { pass: 'PASS', ok: 'PASS', yes: 'PASS', fail: 'FAIL', failed: 'FAIL', no: 'FAIL', notchecked: 'NOT_CHECKED', pending: 'NOT_CHECKED', na: 'NOT_APPLICABLE', notapplicable: 'NOT_APPLICABLE' },
  connectivity: { yes: 'ONLINE', y: 'ONLINE', operating: 'ONLINE', online: 'ONLINE', no: 'OFFLINE', n: 'OFFLINE', notoperating: 'OFFLINE', offline: 'OFFLINE', intermittent: 'INTERMITTENT', notchecked: 'NOT_CHECKED', na: 'NOT_APPLICABLE', notapplicable: 'NOT_APPLICABLE' },
  priority: { p1: 'P1_CRITICAL', p1critical: 'P1_CRITICAL', critical: 'P1_CRITICAL', p2: 'P2_HIGH', p2high: 'P2_HIGH', high: 'P2_HIGH', p3: 'P3_NORMAL', p3normal: 'P3_NORMAL', normal: 'P3_NORMAL', medium: 'P3_NORMAL', p4: 'P4_REQUEST', p4request: 'P4_REQUEST', request: 'P4_REQUEST', low: 'P4_REQUEST' },
  category: { hardware: 'HARDWARE', firmware: 'FIRMWARE', connectivity: 'CONNECTIVITY', network: 'CONNECTIVITY', application: 'APPLICATION', app: 'APPLICATION', software: 'APPLICATION', dataquality: 'DATA_QUALITY', data: 'DATA_QUALITY', request: 'REQUEST' },
  incidentStatus: { open: 'OPEN', new: 'OPEN', inprogress: 'IN_PROGRESS', wip: 'IN_PROGRESS', awaitingsite: 'AWAITING_SITE', awaitingvendor: 'AWAITING_VENDOR', resolved: 'RESOLVED', closed: 'CLOSED' },
  supportStatus: { active: 'ACTIVE', maintenance: 'MAINTENANCE', undermaintenance: 'MAINTENANCE', decommissioned: 'DECOMMISSIONED', inactive: 'DECOMMISSIONED' },
  role: { onsitecoordinator: 'ONSITE_COORDINATOR', onsite: 'ONSITE_COORDINATOR', firmwareengineer: 'FIRMWARE_ENGINEER', firmware: 'FIRMWARE_ENGINEER', applicationengineer: 'APPLICATION_ENGINEER', application: 'APPLICATION_ENGINEER', escalationowner: 'ESCALATION_OWNER', escalation: 'ESCALATION_OWNER' },
}

// Returns the enum key, null for blank, or undefined for an unrecognised value.
export function mapEnum(kind, value) {
  const n = norm(value)
  if (!n) return null
  const table = ALIASES[kind] || {}
  if (table[n]) return table[n]
  const direct = Object.values(table).find(v => norm(v) === n)
  if (direct) return direct
  // "P1 - Critical" → "p1critical"; also accept a leading match like "p1-urgent"
  if (kind === 'priority') { const m = n.match(/^p([1-4])/); if (m) return PRIORITIES[Number(m[1]) - 1].key }
  return undefined
}

// Excel date serial / text / Date (all IST wall-clock) → UTC ISO string.
export function excelToUtcIso(v, { dateOnly = false } = {}) {
  if (v == null || v === '') return null
  let y, mo, d, h = 0, mi = 0, s = 0
  if (typeof v === 'number') {
    const ms = Math.round((v - 25569) * 86400000) // serial days since 1899-12-30, read as wall-clock
    const t = new Date(ms)
    y = t.getUTCFullYear(); mo = t.getUTCMonth() + 1; d = t.getUTCDate(); h = t.getUTCHours(); mi = t.getUTCMinutes(); s = t.getUTCSeconds()
  } else if (v instanceof Date) {
    y = v.getFullYear(); mo = v.getMonth() + 1; d = v.getDate(); h = v.getHours(); mi = v.getMinutes(); s = v.getSeconds()
  } else {
    const str = String(v).trim()
    let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
    if (m) { [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4] || 0, m[5] || 0, m[6] || 0].map(Number) }
    else if ((m = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i))) {
      // Indian convention: DD/MM/YYYY
      ;[d, mo, y, h, mi, s] = [m[1], m[2], m[3], m[4] || 0, m[5] || 0, m[6] || 0].map(Number)
      if (y < 100) y += 2000
      if (m[7]) { const pm = m[7].toLowerCase() === 'pm'; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0 }
    } else if ((m = str.match(/^(\d{1,2})[ -]([A-Za-z]{3,})[ -](\d{2,4})(?:[ ,]+(\d{1,2}):(\d{2}))?/))) {
      const mon = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].slice(0, 3).toLowerCase())
      if (mon < 0) return undefined
      ;[d, mo, y, h, mi] = [Number(m[1]), mon + 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0)]
      if (y < 100) y += 2000
    } else return undefined
  }
  if (!y || !mo || !d) return undefined
  const p = n => String(n).padStart(2, '0')
  if (dateOnly) return `${y}-${p(mo)}-${p(d)}`
  return new Date(`${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(s)}+05:30`).toISOString()
}

// Loose person-name match: exact (normalised) full name, then unique
// first-name / contains match. Returns { id, confidence } or null.
export function matchPerson(name, people) {
  const n = norm(name)
  if (!n) return null
  const exact = people.filter(p => norm(p.full_name) === n || (p.employee_code && norm(p.employee_code) === n) || (p.email && norm(p.email.split('@')[0]) === n))
  if (exact.length === 1) return { id: exact[0].id, confidence: 'exact' }
  const partial = people.filter(p => {
    const pn = norm(p.full_name)
    return pn && (pn.startsWith(n) || n.startsWith(pn) || pn.includes(n))
  })
  if (partial.length === 1) return { id: partial[0].id, confidence: 'fuzzy' }
  const first = people.filter(p => norm((p.full_name || '').split(/\s+/)[0]) === norm(String(name).split(/\s+/)[0]))
  if (first.length === 1) return { id: first[0].id, confidence: 'fuzzy' }
  return null
}
