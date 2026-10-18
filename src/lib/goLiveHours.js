import { supabase } from './supabase'
import { sendNotif } from './notifications'
import { ensureXLSX } from './xlsxLoader'
import { createIncident, updateEngagement, deviceLabel } from './goLive'
import { parseHoursSheet, DEFAULT_HOURS_TOLERANCE, HOURS_STATUSES, ACTION_STATUSES } from './goLiveHoursRules'
import { istDateOf } from './goLiveRules'

// Go-Live Support — manual vs IoT hours, mismatch actions and shareable
// reports (STEP237). Tolerance maths and matching live in SQL
// (golive_hours_compare / golive_ingest_hours); this file shapes requests.

/* ═══ Reading & uploading ═══ */

export async function listHoursCompare(engagementId, { from, to }) {
  const { data, error } = await supabase.from('golive_hours_compare').select('*')
    .eq('engagement_id', engagementId).gte('reading_date', from).lte('reading_date', to)
    .order('reading_date', { ascending: false })
  if (error) throw error
  // A database still on the first STEP237 has no fuel on the view: fuel is
  // stored but can't be read back, and the next save would blank it.
  if (data?.length && !('iot_fuel_litres' in data[0])) {
    throw new Error('The hours comparison in the database is missing fuel — re-run the latest sql/STEP237_golive_hours_and_reports.sql, then sql/STEP238_golive_check_hours.sql, and reload.')
  }
  return data || []
}

export async function listHoursUploads(engagementId, limit = 20) {
  const { data, error } = await supabase.from('golive_hours_uploads').select('*').eq('engagement_id', engagementId)
    .order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data || []
}

export async function readHoursFile(file) {
  await ensureXLSX()
  const XLSX = window.XLSX
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false })
  // first sheet that has a recognisable header
  let lastErr
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false })
    try { return { sheet: name, ...parseHoursSheet(rows) } } catch (e) { lastErr = e }
  }
  throw lastErr || new Error('The file has no sheets')
}

// rows: [{ equipment_ref, enrollment_id?, category, date, running_hours, offline_hours }]
export async function ingestHours(engagementId, source, rows, fileName) {
  const payload = rows.map(r => ({
    equipment_ref: r.equipment_ref, enrollment_id: r.enrollment_id || null, category: r.category || null,
    date: r.date, running_hours: r.running_hours, offline_hours: r.offline_hours, fuel_litres: r.fuel_litres ?? null,
  }))
  const { data, error } = await supabase.rpc('golive_ingest_hours', {
    p_eng: engagementId, p_source: source, p_rows: payload, p_file_name: fileName || null, p_channel: 'FILE',
  })
  if (error) throw error
  return data
}

// Hours entered inside the daily check: MANUAL (firmware section, manual
// log) or IOT (application section). running null clears the value.
export async function setCheckHours(enrollmentId, date, source, running, offline, fuel) {
  const n = v => (v === '' || v == null ? null : Number(v))
  const { error } = await supabase.rpc('golive_set_check_hours', {
    p_enrollment: enrollmentId, p_date: date, p_source: source, p_running: n(running), p_offline: n(offline), p_fuel: n(fuel),
  })
  if (error) throw error
}

/* ═══ Tolerance (engagement.config.hours_tolerance) ═══ */

export const toleranceOf = engagement => ({ ...DEFAULT_HOURS_TOLERANCE, ...(engagement?.config?.hours_tolerance || {}) })

export async function saveTolerance(engagement, tolerance) {
  const clean = {
    default_pct: Number(tolerance.default_pct),
    abs_hours: Number(tolerance.abs_hours),
    by_category: Object.fromEntries(Object.entries(tolerance.by_category || {})
      .filter(([k, v]) => k.trim() && v !== '' && v != null && Number.isFinite(Number(v))).map(([k, v]) => [k.trim(), Number(v)])),
  }
  if (!(clean.default_pct >= 0) || !(clean.abs_hours >= 0)) throw new Error('Tolerance must be zero or more')
  return updateEngagement({ ...engagement, config: { ...(engagement.config || {}), hours_tolerance: clean } })
}

/* ═══ Mismatch actions: task for the field user + linked incident ═══ */

// row: a golive_hours_compare row. Creates (1) a Task Management task
// assigned to the field user, (2) optionally a go-live incident, and
// (3) the golive_hours_actions record tying them to the equipment-day.
export async function createMismatchAction({ engagement, enrollment, row, assignedTo, dueDate, priority, note, withIncident }, profile) {
  const equip = row.equipment_name || row.equipment_id || deviceLabel(enrollment?.device)
  const diffText = row.diff_pct != null ? `${row.diff_pct > 0 ? '+' : ''}${row.diff_pct}%` : `${row.diff_hours ?? '—'} h`
  const summary = `Manual ${row.manual_hours ?? '—'} h vs IoT ${row.iot_hours ?? '—'} h on ${row.reading_date} (${diffText}, tolerance ±${row.tolerance_pct}%)`
  const title = `Hours mismatch — ${equip} (${row.reading_date})`

  let departmentId = null
  if (assignedTo) {
    const { data: p } = await supabase.from('profiles').select('department_id').eq('id', assignedTo).maybeSingle()
    departmentId = p?.department_id || null
  }
  const { data: task, error: taskErr } = await supabase.from('project_tasks').insert({
    task_name: title,
    task_type: 'task',
    description: `${summary}\n\n${note || 'Visit the site and check the equipment, the IoT logger and the manual log; update the task with the root cause.'}\n\nGo-Live engagement ${engagement.code}.`,
    priority: priority || 'medium',
    status: 'backlog',
    project_id: engagement.project_id,
    department_id: departmentId,
    assigned_to: assignedTo || null,
    planned_end_date: dueDate || null,
    organization_id: engagement.organization_id,
    created_by: profile.id,
    ...(enrollment?.device_id ? { device_id: enrollment.device_id } : {}),
  }).select('id,task_id').single()
  if (taskErr) throw taskErr

  let incident = null
  if (withIncident) {
    incident = await createIncident({
      engagement_id: engagement.id, title, scope_type: 'DEVICE', device_enrollment_ids: [row.enrollment_id], site: row.site || enrollment?.site || null,
      reported_at: new Date().toISOString(), priority: priority === 'high' || priority === 'critical' ? 'P2_HIGH' : 'P3_NORMAL', category: 'DATA_QUALITY',
      issue_business_impact: `${summary}. Field task ${task.task_id || ''} raised.`.trim(),
      assigned_owner_user_id: assignedTo || null, status: 'OPEN',
      next_action: note || 'Field visit to reconcile manual and IoT hours',
      action_due_at: dueDate ? new Date(`${dueDate}T18:00:00+05:30`).toISOString() : null,
    })
  }

  const { data: action, error } = await supabase.from('golive_hours_actions').insert({
    engagement_id: engagement.id, enrollment_id: row.enrollment_id, reading_date: row.reading_date, status: 'OPEN',
    manual_hours: row.manual_hours, iot_hours: row.iot_hours, diff_hours: row.diff_hours, diff_pct: row.diff_pct, tolerance_pct: row.tolerance_pct,
    note: note || null, task_id: task.id, incident_id: incident?.id || null, assigned_to: assignedTo || null, created_by: profile.id,
  }).select().single()
  if (error) throw error

  if (assignedTo && assignedTo !== profile.id) {
    sendNotif(assignedTo, {
      type: 'task_assigned', title: 'Field task: hours mismatch', body: `${equip} — ${summary}`,
      link: `/tasks?taskId=${task.id}`, senderId: profile.id,
    })
  }
  return { action, task, incident }
}

// Accept a variance without a task (reason required).
export async function acceptVariance({ row, reason }, profile) {
  if (!reason?.trim()) throw new Error('Give a reason for accepting the variance')
  if (row.action_id) {
    const { error } = await supabase.from('golive_hours_actions').update({ status: 'ACCEPTED', note: reason.trim() }).eq('id', row.action_id)
    if (error) throw error
    return
  }
  const { error } = await supabase.from('golive_hours_actions').insert({
    engagement_id: row.engagement_id, enrollment_id: row.enrollment_id, reading_date: row.reading_date, status: 'ACCEPTED',
    manual_hours: row.manual_hours, iot_hours: row.iot_hours, diff_hours: row.diff_hours, diff_pct: row.diff_pct, tolerance_pct: row.tolerance_pct,
    note: reason.trim(), created_by: profile.id,
  })
  if (error) throw error
}

export async function setActionStatus(actionId, status, note) {
  const patch = { status }
  if (note !== undefined) patch.note = note
  const { error } = await supabase.from('golive_hours_actions').update(patch).eq('id', actionId)
  if (error) throw error
}

export async function getTasksByIds(ids) {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return {}
  const { data } = await supabase.from('project_tasks').select('id,task_id,status,assigned_to').in('id', uniq)
  return Object.fromEntries((data || []).map(t => [t.id, t]))
}

/* ═══ Export ═══ */

export async function exportHoursXlsx(engagement, rows, people, { from, to }) {
  await ensureXLSX()
  const XLSX = window.XLSX
  const person = id => people.find(p => p.id === id)?.full_name || ''
  const aoa = [
    [`${engagement.code} — manual vs IoT hours`, '', `${from} to ${to}`], [],
    ['Date', 'Equipment ID', 'Equipment', 'Category', 'Manual running (h)', 'Manual offline (h)', 'IoT running (h)', 'IoT offline (h)',
      'Difference (h)', 'Difference %', 'Tolerance %', 'Status', 'Fuel (L)', 'Avg fuel (L/h)', 'Action', 'Assigned to'],
    ...rows.map(r => [r.reading_date, r.equipment_id || '', r.equipment_name || '', r.equipment_category, r.manual_hours, r.manual_offline_hours,
      r.iot_hours, r.iot_offline_hours, r.diff_hours, r.diff_pct, r.tolerance_pct, HOURS_STATUSES[r.status]?.label || r.status,
      r.iot_fuel_litres, r.iot_fuel_lph,
      r.action_status ? ACTION_STATUSES[r.action_status]?.label : '', person(r.action_assigned_to)]),
  ]
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [12, 14, 22, 16, 12, 12, 12, 12, 12, 12, 11, 16, 16, 18].map(w => ({ wch: w }))
  XLSX.utils.book_append_sheet(wb, ws, 'Hours reconciliation')
  XLSX.writeFile(wb, `${engagement.code}_hours_${from}_to_${to}.xlsx`)
}

/* ═══ Share links ═══ */

export const REPORT_SECTIONS = [
  { key: 'overview', label: 'Executive overview (health index, KPIs, sites)' },
  { key: 'daily', label: 'Daily summary (observations, incidents, issues)' },
  { key: 'fleet', label: 'Equipment overview (devices, sensors, maintenance)' },
  { key: 'summary', label: 'KPI summary & overall status' },
  { key: 'trends', label: 'Trends (week on week)' },
  { key: 'health', label: 'Daily health trend' },
  { key: 'devices', label: 'Device register (firmware, sensors)' },
  { key: 'hours', label: 'Manual vs IoT hours & fuel' },
  { key: 'equipment', label: 'Equipment status (online / offline)' },
  { key: 'sla', label: 'Incidents & SLA' },
  { key: 'incidents', label: 'Incidents' },
  { key: 'actions', label: 'Improvement actions' },
  { key: 'readiness', label: 'Exit readiness' },
]
export const DEFAULT_SECTIONS = {
  CUSTOMER: ['overview', 'daily', 'fleet', 'summary', 'trends', 'health', 'devices', 'hours', 'equipment', 'sla', 'actions'],
  MANAGEMENT: REPORT_SECTIONS.map(s => s.key),
}

export const reportUrl = token => `${window.location.origin}/golive-report/${token}`

export async function listReportLinks(engagementId) {
  const { data, error } = await supabase.from('golive_report_links').select('*').eq('engagement_id', engagementId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createReportLink(engagement, { audience, title, sections, periodDays, periodFrom, periodTo, expiresOn }, profile) {
  const fixed = !!(periodFrom && periodTo)
  const { data, error } = await supabase.from('golive_report_links').insert({
    engagement_id: engagement.id, audience, title: title?.trim() || null, sections,
    period_days: fixed ? null : Number(periodDays) || 30, period_from: fixed ? periodFrom : null, period_to: fixed ? periodTo : null,
    expires_at: expiresOn ? new Date(`${expiresOn}T23:59:59+05:30`).toISOString() : null, created_by: profile.id,
  }).select().single()
  if (error) throw error
  return data
}

export async function revokeReportLink(id) {
  const { error } = await supabase.from('golive_report_links').update({ revoked_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function getPublicReport(token) {
  const { data, error } = await supabase.rpc('get_golive_report', { p_token: token })
  if (error) throw error
  return data
}

export const todayIso = () => istDateOf(new Date())

// STEP255: executive overview + daily summary sections of the shared report.
export async function getPublicReportOverview(token, date = null) {
  const { data, error } = await supabase.rpc('get_golive_report_overview', { p_token: token, p_date: date })
  if (error) throw error
  return data
}
