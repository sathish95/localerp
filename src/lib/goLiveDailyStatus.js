// Go-Live Daily Status — one IST day, resource-wise: every person on the
// roster (and the PM), plus anyone else who logged something, with what they
// updated: daily-check sections, observations, device notes / issues,
// incidents, incident updates and support visits.
// Pure — the caller loads the rows (goLive.loadDayActivity + listChecks).
import { istDateOf, labelOf, INCIDENT_STATUSES, ROSTER_ROLES } from './goLiveRules.js'

export const SECTIONS = [
  { key: 'onsite', label: 'Onsite' },
  { key: 'firmware', label: 'Firmware' },
  { key: 'application', label: 'Application' },
]
export const PERSON_STATUSES = {
  ON_SITE: { label: 'On site now', tone: 'indigo' },
  UPDATED: { label: 'Updated', tone: 'green' },
  NO_UPDATE: { label: 'No update', tone: 'amber' },
}

const ms = t => (t ? new Date(t).getTime() : NaN)

export function buildDailyStatus({ date, today, checks, enrollments, incidents, events, comments, notes, visits = [], roster = [], pmUserId = null, person, deviceLabel }) {
  const enrById = Object.fromEntries(enrollments.map(e => [e.id, e]))
  const dev = id => {
    const e = enrById[id]
    if (!e) return 'Unknown device'
    return [e.equipment_name, e.equipment_id].map(x => (x || '').trim()).filter((x, i, a) => x && a.indexOf(x) === i).join(' · ') || deviceLabel(e.device)
  }
  const enrByDevice = Object.fromEntries(enrollments.filter(e => e.device_id).map(e => [e.device_id, e.id]))
  const day = checks.filter(c => c.check_date === date && c.daily_result !== 'DUPLICATE')
  const inc = incidents.filter(i => !i.deleted_at)
  const incById = Object.fromEntries(inc.map(i => [i.id, i]))

  const res = {}
  const get = id => (res[id] ||= {
    id, name: person(id) || 'Unknown user', roles: [],
    sections: { onsite: 0, firmware: 0, application: 0 }, devices: {}, observations: [], notes: [],
    raised: [], statusChanges: [], updates: [], visits: [], timeline: [],
  })
  const log = (r, entry) => r.timeline.push(entry)

  // roster in effect on the date (primary + backup per role)
  const roles = []
  for (const role of ROSTER_ROLES) {
    const rows = roster.filter(x => x.role === role.key && !x.deleted_at && x.effective_from <= date && (!x.effective_to || x.effective_to >= date))
    const row = rows.sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0]
    roles.push({ key: role.key, label: role.label, primary: row?.primary_user_id || null, backup: row?.backup_user_id || null })
    if (row?.primary_user_id) get(row.primary_user_id).roles.push({ key: role.key, label: role.label, backup: false })
    if (row?.backup_user_id) get(row.backup_user_id).roles.push({ key: role.key, label: role.label, backup: true })
  }
  if (pmUserId) get(pmUserId).roles.unshift({ key: 'PM', label: 'Project manager', backup: false })

  // daily-check sections, grouped into one timeline entry per person + section
  const secRuns = {}
  for (const c of day) {
    for (const { key } of SECTIONS) {
      const by = c[`${key}_submitted_by`]
      if (!by) continue
      const r = get(by)
      r.sections[key]++
      const d = (r.devices[c.enrollment_id] ||= { id: c.enrollment_id, device: dev(c.enrollment_id), site: c.site_snapshot || enrById[c.enrollment_id]?.site || '', result: c.daily_result, sections: [] })
      d.sections.push(key)
      const run = (secRuns[`${by}|${key}`] ||= { r, key, n: 0, first: null, last: null, attention: 0 })
      run.n++
      if (c.daily_result === 'ATTENTION') run.attention++
      const at = c[`${key}_submitted_at`]
      if (at && (!run.first || ms(at) < ms(run.first))) run.first = at
      if (at && (!run.last || ms(at) > ms(run.last))) run.last = at
    }
    // the observation belongs to whoever last saved the check
    const text = (c.observation_action || '').trim()
    const author = c.updated_by || SECTIONS.map(s => c[`${s.key}_submitted_by`]).find(Boolean) || c.created_by
    if (text && author) {
      const r = get(author)
      const o = { device: dev(c.enrollment_id), text, result: c.daily_result, severity: c.attention_severity, at: c.updated_at || c.created_at }
      r.observations.push(o)
      log(r, { at: o.at, kind: 'observation', title: `Observation · ${o.device}`, detail: text, tone: c.daily_result === 'ATTENTION' ? 'red' : 'gray' })
    }
  }
  for (const run of Object.values(secRuns)) {
    const label = SECTIONS.find(s => s.key === run.key).label
    log(run.r, {
      at: run.first, until: run.last !== run.first ? run.last : null, kind: 'check',
      title: `${label} checks · ${run.n} device${run.n === 1 ? '' : 's'}`,
      detail: run.attention ? `${run.attention} need attention` : 'No attention flags', tone: run.attention ? 'red' : 'green',
    })
  }

  for (const n of notes) {
    if (!n.created_by || istDateOf(n.created_at) !== date) continue
    const r = get(n.created_by)
    const x = { device: dev(n.enrollment_id), body: n.body, isIssue: !!n.is_issue, severity: n.severity, status: n.issue_status, at: n.created_at }
    r.notes.push(x)
    log(r, { at: x.at, kind: x.isIssue ? 'issue' : 'note', title: `${x.isIssue ? `Issue${x.severity ? ` (${x.severity.toLowerCase()})` : ''}` : 'Note'} · ${x.device}`, detail: x.body, tone: x.isIssue ? (x.severity === 'HIGH' ? 'red' : 'amber') : 'gray' })
  }
  for (const i of inc) {
    if (!i.created_by || istDateOf(i.reported_at) !== date) continue
    const r = get(i.created_by)
    r.raised.push({ id: i.id, number: i.number, title: i.title, priority: i.priority })
    log(r, { at: i.created_at || i.reported_at, kind: 'incident', title: `Raised ${i.number}`, detail: i.title, tone: ['P1_CRITICAL', 'P2_HIGH'].includes(i.priority) ? 'red' : 'amber', incidentId: i.id, priority: i.priority })
  }
  for (const e of events) {
    if (!e.actor_id || e.entity !== 'incident' || e.event_type !== 'status_changed' || !e.changes?.status || !incById[e.entity_id]) continue
    const r = get(e.actor_id)
    const x = { number: incById[e.entity_id].number, from: labelOf(INCIDENT_STATUSES, e.changes.status.from), to: labelOf(INCIDENT_STATUSES, e.changes.status.to), at: e.created_at }
    r.statusChanges.push(x)
    log(r, { at: x.at, kind: 'status', title: `${x.number} · ${x.from} → ${x.to}`, detail: incById[e.entity_id].title, tone: ['Resolved', 'Closed'].includes(x.to) ? 'green' : 'gray', incidentId: e.entity_id })
  }
  for (const c of comments) {
    if (!c.created_by || !incById[c.incident_id]) continue
    const r = get(c.created_by)
    r.updates.push({ number: incById[c.incident_id].number, body: c.body, hours: c.hours_spent, at: c.created_at })
    log(r, { at: c.created_at, kind: 'update', title: `${incById[c.incident_id].number} update${c.hours_spent ? ` · ${c.hours_spent} h` : ''}`, detail: c.body, tone: 'gray', incidentId: c.incident_id })
  }
  for (const v of visits) {
    if (!v.employee_id || v.work_date !== date) continue
    const r = get(v.employee_id)
    const x = {
      site: v.site, from: v.check_in, to: v.check_out, hours: v.hours_worked != null ? Number(v.hours_worked) : null, comment: v.comment,
      devices: (v.devices || []).map(d => ({ device: enrByDevice[d.device_id] ? dev(enrByDevice[d.device_id]) : 'Device', activity: d.activity_type, minutes: d.minutes, note: d.note })),
    }
    r.visits.push(x)
    log(r, { at: x.from, until: x.to, open: !x.to, kind: 'visit', title: `Site visit${x.site ? ` · ${x.site}` : ''}${x.hours ? ` · ${x.hours} h` : ''}`, detail: x.comment || '', tone: 'indigo', devices: x.devices })
  }

  const people = Object.values(res).map(r => {
    const devices = Object.values(r.devices)
    const attention = devices.filter(d => d.result === 'ATTENTION').length
    const incidentCount = r.raised.length + r.statusChanges.length + r.updates.length
    const total = devices.length + r.observations.length + r.notes.length + incidentCount + r.visits.length
    const timeline = r.timeline.filter(t => t.at).sort((a, b) => ms(a.at) - ms(b.at))
    const times = r.timeline.flatMap(t => [t.at, t.until]).map(ms).filter(Number.isFinite)
    const onSite = date === today && r.visits.some(v => !v.to)
    return {
      ...r, devices, timeline,
      checked: devices.length, attention, incidentCount, total,
      issues: r.notes.filter(n => n.isIssue).length,
      visitHours: round2(r.visits.reduce((s, v) => s + (v.hours || 0), 0)),
      incidentHours: round2(r.updates.reduce((s, u) => s + (Number(u.hours) || 0), 0)),
      firstAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
      lastAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
      status: onSite ? 'ON_SITE' : total ? 'UPDATED' : 'NO_UPDATE',
      onRoster: r.roles.length > 0,
    }
  }).sort((a, b) => ((a.status === 'NO_UPDATE') - (b.status === 'NO_UPDATE')) || b.total - a.total || a.name.localeCompare(b.name))

  const byId = Object.fromEntries(people.map(p => [p.id, p]))
  const live = enrollments.filter(e => !e.unenrolled_at && (!e.enrolled_at || istDateOf(e.enrolled_at) <= date))
  const team = people.filter(p => p.onRoster)
  return {
    date, people,
    roles: roles.map(r => ({ ...r, primaryPerson: r.primary ? byId[r.primary] : null, backupPerson: r.backup ? byId[r.backup] : null })),
    totals: {
      team: team.length, teamUpdated: team.filter(p => p.status !== 'NO_UPDATE').length,
      contributors: people.filter(p => p.status !== 'NO_UPDATE').length,
      onSite: people.filter(p => p.status === 'ON_SITE').length,
      noUpdate: people.filter(p => p.status === 'NO_UPDATE').length,
      devices: live.length, checked: new Set(day.map(c => c.enrollment_id)).size,
      attention: day.filter(c => c.daily_result === 'ATTENTION').length,
      visits: people.reduce((s, p) => s + p.visits.length, 0), visitHours: round2(people.reduce((s, p) => s + p.visitHours, 0)),
      incidentActions: people.reduce((s, p) => s + p.incidentCount, 0), incidentHours: round2(people.reduce((s, p) => s + p.incidentHours, 0)),
      notes: people.reduce((s, p) => s + p.notes.length, 0), issues: people.reduce((s, p) => s + p.issues, 0),
    },
  }
}

const round2 = n => Math.round(n * 100) / 100

// One line per person — Copy (WhatsApp / email) and the Excel sheet.
export function personLine(p) {
  const roles = p.roles.map(r => `${r.label}${r.backup ? ' (backup)' : ''}`).join(', ')
  const head = `${p.name}${roles ? ` (${roles})` : ''}`
  if (p.status === 'NO_UPDATE') return `${head}: no update logged`
  const secs = SECTIONS.filter(s => p.sections[s.key]).map(s => `${s.label.toLowerCase()} ${p.sections[s.key]}`).join(', ')
  return `${head}: ${[
    p.checked && `${p.checked} device check(s) (${secs})${p.attention ? `, ${p.attention} need attention` : ''}`,
    p.observations.length && `${p.observations.length} observation(s)`,
    p.notes.length && `${p.notes.length} note(s)/issue(s)`,
    p.raised.length && `raised ${p.raised.map(i => i.number).join(', ')}`,
    p.statusChanges.length && `${p.statusChanges.length} status change(s)`,
    p.updates.length && `${p.updates.length} incident update(s)${p.incidentHours ? ` (${p.incidentHours} h)` : ''}`,
    p.visits.length && `${p.visits.length} site visit(s)${p.visitHours ? ` (${p.visitHours} h)` : ''}`,
  ].filter(Boolean).join(' · ')}`
}

export function statusText(s, engagementName = '') {
  const t = s.totals
  const L = [`Go-Live daily status${engagementName ? ` — ${engagementName}` : ''} — ${s.date}`, '',
    `Team updated: ${t.teamUpdated}/${t.team} · Devices checked: ${t.checked}/${t.devices} · Site visits: ${t.visits}${t.visitHours ? ` (${t.visitHours} h)` : ''} · Incident actions: ${t.incidentActions}`, '']
  for (const p of s.people) L.push(`- ${personLine(p)}`)
  return L.join('\n')
}
