import { supabase } from './supabase'
import { sendNotifToMany } from './notifications'
import { createWarrantyClaim } from './warranty'
import { istToday, addDays, computeDailyResult } from './goLiveRules'
import { listVisits } from './supportVisits'

// Go-Live Support (STEP235) — thin wrappers over the golive_* tables.
// Validation, section permissions, snapshots, the daily result and the
// follow-up flag are all enforced by triggers in STEP235; this file only
// shapes requests. Mutations send the row's `version` and match on it
// (optimistic locking): zero rows updated means someone else saved first.

export class ConflictError extends Error {
  constructor(message, existingId) { super(message); this.name = 'ConflictError'; this.existingId = existingId }
}

async function updateVersioned(table, id, version, patch) {
  let q = supabase.from(table).update(patch).eq('id', id)
  if (version != null) q = q.eq('version', version)
  const { data, error } = await q.select()
  if (error) throw error
  if (!data?.length) throw new ConflictError('This record was changed by someone else — reload and try again')
  return data[0]
}

/* ═══ Lookups ═══ */

export async function loadLookups() {
  const [projects, departments, budgets, customers, people] = await Promise.all([
    supabase.from('projects').select('id,name,code,status,department_id,customer_id').order('name'),
    supabase.from('departments').select('id,name,code').order('name'),
    supabase.from('budgets').select('id,project_id,department_id,category,fiscal_year,month,allocated').order('fiscal_year', { ascending: false }),
    supabase.from('customers').select('id,name').order('name'),
    supabase.from('profiles').select('id,full_name,role,email,employee_id,is_active').order('full_name'),
  ])
  return {
    projects: projects.data || [],
    departments: departments.data || [],
    budgets: budgets.data || [],
    customers: customers.data || [],
    people: (people.data || []).filter(p => p.is_active !== false),
  }
}

export const budgetLabel = b => b ? [b.category || 'Budget', b.fiscal_year ? `FY${b.fiscal_year}` : '', b.month ? `M${b.month}` : ''].filter(Boolean).join(' · ') : ''

/* ═══ Engagements ═══ */

export async function listEngagements() {
  const { data, error } = await supabase.from('golive_engagements').select('*').is('deleted_at', null).order('go_live_date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getEngagement(id) {
  const { data, error } = await supabase.from('golive_engagements').select('*').eq('id', id).is('deleted_at', null).maybeSingle()
  if (error) throw error
  return data
}

// Soft delete (engagement + its incidents); PM or admin, reason required.
export async function deleteEngagement(id, reason) {
  const { error } = await supabase.rpc('golive_delete_engagement', { p_eng: id, p_reason: reason })
  if (error) throw error
}

// CLOSED / CANCELLED → ACTIVE hypercare again.
export async function reopenEngagement(id, reason, plannedEnd) {
  const { error } = await supabase.rpc('golive_reopen_engagement', { p_eng: id, p_reason: reason, p_planned_end: plannedEnd || null })
  if (error) throw error
}

// Re-send today's reminders (missing checks, pending reviews, stuck incidents); returns how many went out.
export async function resendReminders(id) {
  const { data, error } = await supabase.rpc('golive_resend_reminders', { p_eng: id })
  if (error) throw error
  return data || 0
}

// Chip counts for the engagement list, in two queries rather than per row.
export async function engagementChips(ids) {
  if (!ids.length) return {}
  const today = istToday()
  const [enr, chk, inc] = await Promise.all([
    supabase.from('golive_enrollments').select('engagement_id,support_status').in('engagement_id', ids).is('deleted_at', null).is('unenrolled_at', null),
    supabase.from('golive_daily_checks').select('engagement_id,daily_result').in('engagement_id', ids).eq('check_date', today).is('deleted_at', null),
    supabase.from('golive_incidents').select('engagement_id,status,priority,follow_up_flag').in('engagement_id', ids).is('deleted_at', null).neq('status', 'CLOSED'),
  ])
  const out = Object.fromEntries(ids.map(id => [id, { devices: 0, checked: 0, attention: 0, open: 0, p1: 0, overdue: 0 }]))
  for (const e of enr.data || []) if (e.support_status === 'ACTIVE') out[e.engagement_id].devices++
  for (const c of chk.data || []) { out[c.engagement_id].checked++; if (c.daily_result === 'ATTENTION') out[c.engagement_id].attention++ }
  for (const i of inc.data || []) {
    const o = out[i.engagement_id]; o.open++
    if (i.priority === 'P1_CRITICAL') o.p1++
    if (i.follow_up_flag === 'OVERDUE') o.overdue++
  }
  return out
}

const ENGAGEMENT_FIELDS = ['name', 'department_ids', 'project_id', 'budget_line_id', 'customer_id', 'sites', 'pm_user_id', 'go_live_date',
  'hypercare_start', 'hypercare_planned_end', 'handover_to', 'exit_criteria', 'config',
  'customer_signoff_name', 'customer_signoff_date', 'customer_signoff_ref']

function pickEngagement(e) {
  const row = {}
  for (const k of ENGAGEMENT_FIELDS) if (e[k] !== undefined) row[k] = e[k] === '' ? null : e[k]
  if (row.sites) row.sites = row.sites.map(s => s.trim()).filter(Boolean)
  // first department picked is the primary (department_id) — see STEP235
  if (row.department_ids) { row.department_ids = [...new Set(row.department_ids.filter(Boolean))]; row.department_id = row.department_ids[0] || null }
  return row
}

export async function createEngagement(e) {
  const { data, error } = await supabase.from('golive_engagements').insert(pickEngagement(e)).select().single()
  if (error) throw error
  return data
}

export async function updateEngagement(e) {
  return updateVersioned('golive_engagements', e.id, e.version, pickEngagement(e))
}

export async function setEngagementStatus(e, status, reason) {
  return updateVersioned('golive_engagements', e.id, e.version, { status, status_reason: reason || null })
}

export async function getExitReadiness(id) {
  const { data, error } = await supabase.rpc('golive_exit_readiness', { p_eng: id })
  if (error) throw error
  return data
}

export async function submitExit(id, overrideComment) {
  const { error } = await supabase.rpc('golive_submit_exit', { p_eng: id, p_override_comment: overrideComment || null })
  if (error) throw error
}

export async function decideExit(id, approve, comment) {
  const { error } = await supabase.rpc('golive_decide_exit', { p_eng: id, p_approve: approve, p_comment: comment || null })
  if (error) throw error
}

export async function listEvents(engagementId, limit = 100) {
  const { data, error } = await supabase.from('golive_events').select('*').eq('engagement_id', engagementId)
    .order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data || []
}

// Audit trail (golive_audit trigger) for one record — e.g. an incident's history.
export async function listEntityEvents(entityId) {
  const { data, error } = await supabase.from('golive_events').select('*').eq('entity_id', entityId).order('created_at')
  if (error) throw error
  return data || []
}

// Everything that happened in one IST day — feeds the Overview daily summary.
export async function loadDayActivity(engagementId, incidentIds, date) {
  const from = `${date}T00:00:00+05:30`
  const to = new Date(new Date(from).getTime() + 86400000).toISOString()
  const [ev, cm, notes] = await Promise.all([
    supabase.from('golive_events').select('*').eq('engagement_id', engagementId).gte('created_at', from).lt('created_at', to).order('created_at'),
    incidentIds.length
      ? supabase.from('golive_incident_comments').select('*').in('incident_id', incidentIds).gte('created_at', from).lt('created_at', to).order('created_at')
      : Promise.resolve({ data: [] }),
    supabase.from('golive_device_notes').select('*').eq('engagement_id', engagementId).is('deleted_at', null).order('created_at'),
  ])
  for (const r of [ev, cm, notes]) if (r.error) throw r.error
  // support visits (STEP248) — optional, the summary works without them
  const visits = await listVisits({ engagementId, from: date, to: date }).catch(() => [])
  return { events: ev.data || [], comments: cm.data || [], notes: notes.data || [], visits }
}

/* ═══ Report email (STEP256) — settings in config.report_email ═══ */

export const REPORT_EMAIL_DEFAULTS = {
  enabled: false, send_time: '19:00', report_day: 'TODAY', to_pm: true, to_roster: true, user_ids: [], emails: [], external_view: 'CUSTOMER',
  template: 'brief',   // STEP257: brief | detailed | plain
}
export const reportEmailSettings = engagement => ({ ...REPORT_EMAIL_DEFAULTS, ...(engagement?.config?.report_email || {}) })

export async function saveReportEmailSettings(engagement, settings) {
  return updateEngagement({ ...engagement, config: { ...(engagement.config || {}), report_email: settings } })
}

// Queue the complete report now. mode: 'ME' | 'ALL' (saved list) | 'LIST' (just `emails`).
// template (STEP257) sends that design instead of the saved one.
export async function sendReportEmail(engagementId, date, mode = 'ME', emails = null, template = null) {
  const args = { p_eng: engagementId, p_date: date, p_mode: mode, p_emails: emails }
  if (template) args.p_template = template
  const { data, error } = await supabase.rpc('send_golive_report_email', args)
  if (error) throw error
  return data
}

// Who the saved list resolves to right now (PM + roster + people + addresses; id null = external).
export async function previewReportRecipients(engagementId) {
  const { data, error } = await supabase.rpc('golive_report_recipient_preview', { p_eng: engagementId })
  if (error) throw error
  return data || []
}

// STEP257: the exact data the email gets, for the in-app preview.
export async function previewReportPayload(engagementId, date, customer = false) {
  const { data, error } = await supabase.rpc('golive_report_email_preview', { p_eng: engagementId, p_date: date, p_customer: customer })
  if (error) throw error
  return data
}

export async function listReportEmailLog(engagementId, limit = 20) {
  const { data, error } = await supabase.from('golive_report_email_log').select('*').eq('engagement_id', engagementId)
    .order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data || []
}

/* ═══ Roster ═══ */

export async function listRoster(engagementId) {
  const { data, error } = await supabase.from('golive_roster').select('*').eq('engagement_id', engagementId).is('deleted_at', null)
    .order('effective_from', { ascending: false })
  if (error) throw error
  return data || []
}

// Current row per role (effective today).
export function currentRoster(rows, today = istToday()) {
  const out = {}
  for (const r of rows) {
    if (r.effective_from > today || (r.effective_to && r.effective_to < today)) continue
    if (!out[r.role] || r.effective_from > out[r.role].effective_from) out[r.role] = r
  }
  return out
}

// Roster changes keep history: close the current row, open a new one.
export async function assignRole(engagementId, role, { primary_user_id, backup_user_id, responsibility_note }, current) {
  if (!primary_user_id) throw new Error('Pick a primary')
  if (backup_user_id && backup_user_id === primary_user_id) throw new Error('Backup must differ from the primary')
  const today = istToday()
  if (current) {
    if (current.effective_from === today) {
      // same-day correction — edit in place instead of a zero-length history row
      return updateVersioned('golive_roster', current.id, current.version, {
        primary_user_id, backup_user_id: backup_user_id || null, responsibility_note: responsibility_note || null, primary_unavailable: false,
      })
    }
    await updateVersioned('golive_roster', current.id, current.version, { effective_to: addDays(today, -1) })
  }
  const { data, error } = await supabase.from('golive_roster').insert({
    engagement_id: engagementId, role, primary_user_id, backup_user_id: backup_user_id || null,
    responsibility_note: responsibility_note || null, effective_from: today,
  }).select().single()
  if (error) throw error
  return data
}

export async function setPrimaryUnavailable(row, unavailable) {
  return updateVersioned('golive_roster', row.id, row.version, { primary_unavailable: unavailable })
}

/* ═══ Devices / enrollments ═══ */

const DEVICE_COLS = 'id,device_code,serial_number,part_number,project_id,customer_id,installed_date,warranty_start,warranty_end,status,current_location,notes'

export async function listEnrollments(engagementId) {
  const { data, error } = await supabase.from('golive_enrollments').select('*').eq('engagement_id', engagementId).is('deleted_at', null).order('enrolled_at')
  if (error) throw error
  const rows = data || []
  const devices = await devicesById(rows.map(r => r.device_id))
  return rows.map(r => ({ ...r, device: devices[r.device_id] || null }))
}

async function devicesById(ids) {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return {}
  const { data } = await supabase.from('device_instances').select(DEVICE_COLS).in('id', uniq)
  return Object.fromEntries((data || []).map(d => [d.id, d]))
}

// The auto-generated device code (DEV-xxxxxx-n) is never shown — serial number, the code only as a last resort.
export const deviceLabel = d => d ? (d.serial_number || d.device_code || 'Unknown device') : 'Unknown device'
// Equipment name · Equipment ID — e.g. "Rock Body Tipper - 35 MT · RBT-07"; the serial number when both are blank.
export const equipmentLabel = e => !e ? 'Unknown device'
  : [e.equipment_name, e.equipment_id].map(x => (x || '').trim()).filter((x, i, a) => x && a.indexOf(x) === i).join(' · ')
    || (e.device ? deviceLabel(e.device) : 'Unknown device')

// Devices deployed to the engagement's project and not yet enrolled.
export async function listDeployableDevices(projectId, enrolledDeviceIds = []) {
  const { data, error } = await supabase.from('device_instances').select(DEVICE_COLS).eq('project_id', projectId).neq('status', 'decommissioned').order('device_code')
  if (error) throw error
  const taken = new Set(enrolledDeviceIds)
  return (data || []).filter(d => !taken.has(d.id))
}

// Search the device master by device code or serial (enroll by scan/search).
export async function searchDevices(term) {
  const t = term.trim().replace(/[%,()]/g, '')
  if (!t) return []
  const { data, error } = await supabase.from('device_instances').select(DEVICE_COLS)
    .or(`device_code.ilike.%${t}%,serial_number.ilike.%${t}%`).limit(20)
  if (error) throw error
  return data || []
}

export async function enrollDevices(engagementId, devices, defaults = {}) {
  if (!devices.length) return []
  // equipment ID / name / category come from the device master (STEP240); select('*')
  // so a database without those columns yet still enrolls
  const { data: master } = await supabase.from('device_instances').select('*').in('id', devices.map(d => d.id))
  const eq = Object.fromEntries((master || []).map(m => [m.id, m]))
  const rows = devices.map(d => ({
    engagement_id: engagementId, device_id: d.id,
    site: defaults.site || d.current_location || null,
    equipment_id: eq[d.id]?.equipment_id || null,
    equipment_name: eq[d.id]?.equipment_name || null,
    equipment_category: eq[d.id]?.equipment_category || null,
    expected_reporting_interval_min: Number(defaults.expected_reporting_interval_min) || 15,
    firmware_version: defaults.firmware_version || null,
    deployment_override_reason: defaults.deployment_override_reason || null,
    // STEP259 columns only when used, so enrolling works before the step runs
    ...(defaults.is_golive ? { is_golive: true } : {}),
    ...(defaults.custom_fields && Object.keys(defaults.custom_fields).length ? { custom_fields: defaults.custom_fields } : {}),
  }))
  const { data, error } = await supabase.from('golive_enrollments').insert(rows).select()
  if (error) throw error
  return data
}

const ENROLLMENT_FIELDS = ['site', 'equipment_id', 'equipment_name', 'equipment_category', 'firmware_version', 'connectivity_ref', 'expected_reporting_interval_min', 'support_status', 'status_reason',
  'onsite_coordinator_user_id', 'firmware_engineer_user_id', 'application_engineer_user_id', 'notes', 'is_golive', 'golive_since', 'custom_fields']

export async function updateEnrollment(e, patch) {
  const row = {}
  for (const k of ENROLLMENT_FIELDS) if (patch[k] !== undefined) row[k] = patch[k] === '' ? null : patch[k]
  return updateVersioned('golive_enrollments', e.id, e.version, row)
}

// Bulk go-live flag (STEP259); golive_since is stamped by the DB trigger.
export async function bulkSetGoLive(enrollments, is_golive) {
  for (const e of enrollments) if (!!e.is_golive !== is_golive) await updateVersioned('golive_enrollments', e.id, e.version, { is_golive })
}

// Bulk status change (e.g. several devices into MAINTENANCE).
export async function bulkSetSupportStatus(enrollments, support_status, status_reason) {
  for (const e of enrollments) await updateVersioned('golive_enrollments', e.id, e.version, { support_status, status_reason: status_reason || null })
}

// §6.1 swap: new enrollment for the replacement, old one ended with a
// reason; open incidents optionally carried to the new device.
export async function replaceDevice(oldEnrollment, newDevice, { carryIncidents = true } = {}) {
  const [created] = await enrollDevices(oldEnrollment.engagement_id, [newDevice], {
    site: oldEnrollment.site, expected_reporting_interval_min: oldEnrollment.expected_reporting_interval_min,
  })
  await updateVersioned('golive_enrollments', created.id, created.version, {
    equipment_id: oldEnrollment.equipment_id, connectivity_ref: oldEnrollment.connectivity_ref,
    // same machine, new device
    equipment_name: oldEnrollment.equipment_name, equipment_category: oldEnrollment.equipment_category,
    onsite_coordinator_user_id: oldEnrollment.onsite_coordinator_user_id,
    firmware_engineer_user_id: oldEnrollment.firmware_engineer_user_id,
    application_engineer_user_id: oldEnrollment.application_engineer_user_id,
  })
  await updateVersioned('golive_enrollments', oldEnrollment.id, oldEnrollment.version, {
    support_status: 'DECOMMISSIONED', status_reason: `REPLACED_BY ${deviceLabel(newDevice)}`,
    unenroll_reason: `REPLACED_BY ${deviceLabel(newDevice)}`, replaced_by_enrollment_id: created.id,
  })
  if (carryIncidents) {
    const { data: open } = await supabase.from('golive_incidents').select('id,version,device_enrollment_ids')
      .eq('engagement_id', oldEnrollment.engagement_id).contains('device_enrollment_ids', [oldEnrollment.id]).not('status', 'in', '(RESOLVED,CLOSED)')
    for (const i of open || []) {
      const ids = [...new Set([...(i.device_enrollment_ids || []), created.id])]
      await updateVersioned('golive_incidents', i.id, i.version, { device_enrollment_ids: ids })
    }
  }
  return created
}

// §6.1: master gaps captured at enrollment go to the device-master owners
// as a correction request — never written into device_instances from here.
export async function requestMasterCorrection(device, fields, senderId) {
  const { data } = await supabase.from('profiles').select('id').in('role', ['admin', 'ceo', 'procurement', 'procurement_lead'])
  const lines = Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ')
  await sendNotifToMany((data || []).map(p => p.id).filter(id => id !== senderId), {
    type: 'golive_master_correction', title: `Device master update requested: ${deviceLabel(device)}`,
    body: lines, link: '/devices', senderId, metadata: { device_id: device.id, fields },
  })
}

/* ═══ Device 360 ═══ */

export async function getDevice360(enrollment) {
  const deviceId = enrollment.device_id
  const since = addDays(istToday(), -13)
  const [dev, warranty, checks, incidents] = await Promise.all([
    supabase.from('device_instances').select('*').eq('id', deviceId).maybeSingle(),
    supabase.from('device_warranties').select('*').eq('device_id', deviceId).order('warranty_end_date', { ascending: false }).limit(1),
    supabase.from('golive_daily_checks').select('check_date,daily_result,last_data_received_at').eq('enrollment_id', enrollment.id).is('deleted_at', null).gte('check_date', since).order('check_date'),
    supabase.from('golive_incidents').select('id,number,title,status,priority,follow_up_flag').contains('device_enrollment_ids', [enrollment.id]).is('deleted_at', null).order('reported_at', { ascending: false }),
  ])
  const device = dev.data
  let product = null
  if (device?.part_number) {
    const { data } = await supabase.from('products').select('name,part_number,device_type').eq('part_number', device.part_number).maybeSingle()
    product = data
  }
  const w = warranty.data?.[0] || null
  const warrantyEnd = w?.warranty_end_date || device?.warranty_end || null
  return {
    device, product, warranty: w, warrantyEnd,
    underWarranty: !!warrantyEnd && warrantyEnd >= istToday() && (!w || w.status === 'Active'),
    checks: checks.data || [],
    incidents: incidents.data || [],
    lastDataAt: (checks.data || []).map(c => c.last_data_received_at).filter(Boolean).sort().pop() || null,
  }
}

/* ═══ Daily checks ═══ */

export async function listChecks(engagementId, { from, to }) {
  const { data, error } = await supabase.from('golive_daily_checks').select('*').eq('engagement_id', engagementId).is('deleted_at', null)
    .gte('check_date', from).lte('check_date', to).order('check_date')
  if (error) throw error
  return data || []
}

export async function getChecksByIds(ids) {
  if (!ids.length) return []
  const { data, error } = await supabase.from('golive_daily_checks').select('id,check_date,enrollment_id,daily_result').in('id', ids.slice(0, 300))
  if (error) throw error
  return data || []
}

export const SECTION_FIELDS = {
  onsite: ['onsite_coordinator_user_id', 'site_snapshot', 'equipment_snapshot', 'power_check', 'cable_indicator_check', 'connectivity', 'last_data_received_at', 'evidence'],
  firmware: ['firmware_health', 'firmware_reviewer_user_id'],
  application: ['application_health', 'application_reviewer_user_id', 'data_quality', 'parameter_checks'],
  shared: ['observation_action', 'attention_waiver_reason', 'customer_visible', 'edit_reason', 'attention_severity', 'equipment_maintenance'],
}

// Saves one section of a check (onsite / firmware / application — each is
// separately saveable, §4.4). Only that section's fields (plus the shared
// observation fields) are sent, so a reviewer never overwrites onsite data.
export async function saveCheckSection({ existing, engagementId, enrollmentId, checkDate }, section, values) {
  const row = {}
  for (const k of [...(SECTION_FIELDS[section] || []), ...SECTION_FIELDS.shared]) {
    if (values[k] !== undefined) row[k] = values[k] === '' ? null : values[k]
  }
  if (existing) {
    if (existing.edit_reason && row.edit_reason === existing.edit_reason) delete row.edit_reason
    return updateVersioned('golive_daily_checks', existing.id, existing.version, row)
  }
  const { data, error } = await supabase.from('golive_daily_checks')
    .insert({ ...row, engagement_id: engagementId, enrollment_id: enrollmentId, check_date: checkDate }).select().single()
  if (error) {
    if (error.code === '23505') {
      const { data: dup } = await supabase.from('golive_daily_checks').select('id').eq('enrollment_id', enrollmentId).eq('check_date', checkDate).is('deleted_at', null).maybeSingle()
      throw new ConflictError('A check already exists for this device and date', dup?.id)
    }
    throw error
  }
  return data
}

// Preview the result the DB will persist (same rules as the trigger).
export const previewResult = check => computeDailyResult({ ...check, enrollment_id: check.enrollment_id || 'x' })

export async function uploadEvidence(file, { organizationId, engagementId }) {
  const safe = file.name.replace(/[^\w.-]+/g, '_')
  const path = `${organizationId}/${engagementId}/${Date.now()}_${safe}`
  const { error } = await supabase.storage.from('golive-evidence').upload(path, file, { upsert: false })
  if (error) throw error
  return { path, name: file.name, size: file.size, uploaded_at: new Date().toISOString() }
}

export async function evidenceUrl(path) {
  const { data, error } = await supabase.storage.from('golive-evidence').createSignedUrl(path, 3600)
  if (error) throw error
  return data.signedUrl
}

/* ═══ Incidents ═══ */

export async function listIncidents(engagementId) {
  const { data, error } = await supabase.from('golive_incidents').select('*').eq('engagement_id', engagementId).is('deleted_at', null).order('reported_at', { ascending: false })
  if (error) throw error
  return data || []
}

const INCIDENT_FIELDS = ['title', 'scope_type', 'device_enrollment_ids', 'site', 'reported_at', 'priority', 'category', 'issue_business_impact',
  'assigned_owner_user_id', 'status', 'next_action', 'action_due_at', 'root_cause_resolution', 'verified_by_user_id', 'reopen_reason',
  'warranty_claim_id', 'vendor_ref', 'origin_check_id', 'customer_visible']

function pickIncident(i) {
  const row = {}
  for (const k of INCIDENT_FIELDS) if (i[k] !== undefined) row[k] = i[k] === '' ? null : i[k]
  return row
}

export async function createIncident(i, { linkCheckIds = [] } = {}) {
  const { data, error } = await supabase.from('golive_incidents').insert({ ...pickIncident(i), engagement_id: i.engagement_id }).select().single()
  if (error) throw error
  if (linkCheckIds.length) await linkChecks(data.id, linkCheckIds)
  return data
}

export async function updateIncident(i, patch) {
  return updateVersioned('golive_incidents', i.id, i.version, pickIncident(patch))
}

export async function listComments(incidentId) {
  const { data, error } = await supabase.from('golive_incident_comments').select('*').eq('incident_id', incidentId).order('created_at')
  if (error) throw error
  return data || []
}

export async function addComment(incidentId, body, hoursSpent, userId) {
  const { error } = await supabase.from('golive_incident_comments').insert({
    incident_id: incidentId, body: body.trim(), hours_spent: hoursSpent ? Number(hoursSpent) : null, created_by: userId,
  })
  if (error) throw error
}

export async function listLinks(engagementId) {
  const { data: checks } = await supabase.from('golive_daily_checks').select('id').eq('engagement_id', engagementId)
  const ids = (checks || []).map(c => c.id)
  if (!ids.length) return []
  const out = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('golive_check_incident_links').select('check_id,incident_id').in('check_id', ids.slice(i, i + 200))
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}

export async function linkChecks(incidentId, checkIds) {
  if (!checkIds.length) return
  const { error } = await supabase.from('golive_check_incident_links')
    .upsert(checkIds.map(check_id => ({ check_id, incident_id: incidentId })), { onConflict: 'check_id,incident_id', ignoreDuplicates: true })
  if (error) throw error
}

export async function unlinkCheck(checkId, incidentId) {
  const { error } = await supabase.from('golive_check_incident_links').delete().eq('check_id', checkId).eq('incident_id', incidentId)
  if (error) throw error
}

// §6.4 hardware incident on an in-warranty device → warranty claim, linked back.
export async function raiseWarrantyClaim(incident, enrollment, userId) {
  const claim = await createWarrantyClaim({
    deviceId: enrollment.device_id,
    issueDescription: `${incident.number}: ${incident.title}\n${incident.issue_business_impact || ''}`.trim(),
    issueType: 'Hardware Failure', raisedBy: userId,
  })
  await updateIncident(incident, { warranty_claim_id: claim.id })
  return claim
}

/* ═══ Device notes & issues ═══ */

export const NOTE_SEVERITIES = [
  { key: 'LOW', label: 'Low', badge: 'gray' },
  { key: 'MEDIUM', label: 'Medium', badge: 'warning' },
  { key: 'HIGH', label: 'High', badge: 'danger' },
]

export async function listDeviceNotes(engagementId) {
  const { data, error } = await supabase.from('golive_device_notes').select('*').eq('engagement_id', engagementId)
    .is('deleted_at', null).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function addDeviceNote({ engagementId, enrollmentId, body, isIssue, category, severity }, userId) {
  const { data, error } = await supabase.from('golive_device_notes').insert({
    engagement_id: engagementId, enrollment_id: enrollmentId, body: body.trim(), created_by: userId,
    is_issue: !!isIssue, issue_category: isIssue ? category || null : null, severity: isIssue ? severity || 'MEDIUM' : null,
    issue_status: isIssue ? 'OPEN' : null,
  }).select().single()
  if (error) throw error
  return data
}

const NOTE_FIELDS = ['body', 'is_issue', 'issue_category', 'severity', 'issue_status', 'resolution', 'incident_id']

export async function updateDeviceNote(note, patch) {
  const row = {}
  for (const k of NOTE_FIELDS) if (patch[k] !== undefined) row[k] = patch[k] === '' ? null : patch[k]
  if (row.is_issue === true && !note.issue_status && !row.issue_status) row.issue_status = 'OPEN'
  return updateVersioned('golive_device_notes', note.id, note.version, row)
}

export async function deleteDeviceNote(note) {
  return updateVersioned('golive_device_notes', note.id, note.version, { deleted_at: new Date().toISOString() })
}

/* ═══ My Work (cross-engagement) ═══ */

export async function loadMyWork(userId) {
  const today = istToday()
  const [roster, overrides, incidents] = await Promise.all([
    supabase.from('golive_roster').select('engagement_id,role,primary_user_id,backup_user_id,primary_unavailable,effective_to').is('deleted_at', null)
      .or(`primary_user_id.eq.${userId},backup_user_id.eq.${userId}`),
    supabase.from('golive_enrollments').select('engagement_id').is('deleted_at', null)
      .or(`onsite_coordinator_user_id.eq.${userId},firmware_engineer_user_id.eq.${userId},application_engineer_user_id.eq.${userId}`),
    supabase.from('golive_incidents').select('*').eq('assigned_owner_user_id', userId).is('deleted_at', null).neq('status', 'CLOSED').order('action_due_at'),
  ])
  const current = (roster.data || []).filter(r => !r.effective_to || r.effective_to >= today)
  const engIds = [...new Set([...current.map(r => r.engagement_id), ...(overrides.data || []).map(r => r.engagement_id), ...(incidents.data || []).map(i => i.engagement_id)])]
  if (!engIds.length) return { engagements: [], pendingChecks: [], pendingReviews: [], incidents: [], toVerify: [] }

  const { data: engs } = await supabase.from('golive_engagements').select('*').in('id', engIds).in('status', ['ACTIVE', 'EXIT_REVIEW']).is('deleted_at', null)
  const activeIds = (engs || []).map(e => e.id)
  if (!activeIds.length) return { engagements: [], pendingChecks: [], pendingReviews: [], incidents: incidents.data || [], toVerify: [] }

  const [enr, checks, resolved] = await Promise.all([
    supabase.from('golive_enrollments').select('*').in('engagement_id', activeIds).is('deleted_at', null).is('unenrolled_at', null),
    supabase.from('golive_daily_checks').select('*').in('engagement_id', activeIds).eq('check_date', today).is('deleted_at', null),
    supabase.from('golive_incidents').select('*').in('engagement_id', activeIds).eq('status', 'RESOLVED').is('deleted_at', null),
  ])
  const devices = await devicesById((enr.data || []).map(e => e.device_id))
  const rolesIn = engId => {
    const out = new Set()
    for (const r of current.filter(x => x.engagement_id === engId)) {
      // a primary who's marked unavailable hands the work to the backup
      if (r.primary_user_id === userId && !r.primary_unavailable) out.add(r.role)
      if (r.backup_user_id === userId && r.primary_unavailable) out.add(r.role)
    }
    return out
  }
  const holds = (e, role, col) => e[col] ? e[col] === userId : rolesIn(e.engagement_id).has(role)
  const checkOf = Object.fromEntries((checks.data || []).map(c => [c.enrollment_id, c]))

  const pendingChecks = [], pendingReviews = []
  for (const e of enr.data || []) {
    const row = { ...e, device: devices[e.device_id], engagement: engs.find(g => g.id === e.engagement_id) }
    const c = checkOf[e.id]
    if (e.support_status === 'ACTIVE' && !c && holds(e, 'ONSITE_COORDINATOR', 'onsite_coordinator_user_id')) pendingChecks.push(row)
    if (c && !c.firmware_health && holds(e, 'FIRMWARE_ENGINEER', 'firmware_engineer_user_id')) pendingReviews.push({ ...row, check: c, section: 'firmware' })
    if (c && !c.application_health && holds(e, 'APPLICATION_ENGINEER', 'application_engineer_user_id')) pendingReviews.push({ ...row, check: c, section: 'application' })
  }
  const managerOf = new Set((engs || []).filter(g => g.pm_user_id === userId || rolesIn(g.id).has('ESCALATION_OWNER')).map(g => g.id))
  return {
    engagements: engs || [],
    pendingChecks, pendingReviews,
    incidents: incidents.data || [],
    toVerify: (resolved.data || []).filter(i => managerOf.has(i.engagement_id)),
  }
}
