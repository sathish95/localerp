// Daily summary for the Go-Live Overview: pulls one IST day's daily-check
// observations, device notes / issues and incident activity into one digest.
// Pure — the caller loads the rows (goLive.loadDayActivity + listChecks).
import { failingFields, istDateOf, istDateTime, labelOf, INCIDENT_STATUSES, PRIORITIES, CATEGORIES } from './goLiveRules.js'

const OPEN = s => !['RESOLVED', 'CLOSED'].includes(s)
const PRIO_RANK = { P1_CRITICAL: 0, P2_HIGH: 1, P3_NORMAL: 2, P4_REQUEST: 3 }

export function buildDailySummary({ date, checks, enrollments, incidents, events, comments, notes, person, deviceLabel }) {
  const enrById = Object.fromEntries(enrollments.map(e => [e.id, e]))
  const dev = id => {
    const e = enrById[id]
    if (!e) return 'Unknown device'
    return [e.equipment_name, e.equipment_id].map(x => (x || '').trim()).filter((x, i, a) => x && a.indexOf(x) === i).join(' · ') || deviceLabel(e.device)
  }
  const live = enrollments.filter(e => !e.unenrolled_at && (!e.enrolled_at || istDateOf(e.enrolled_at) <= date))
  const day = checks.filter(c => c.check_date === date && c.daily_result !== 'DUPLICATE')
  const checkedIds = new Set(day.map(c => c.enrollment_id))
  const count = r => day.filter(c => c.daily_result === r).length

  const stats = {
    devices: live.length, checked: checkedIds.size, healthy: count('HEALTHY'), attention: count('ATTENTION'),
    incomplete: count('INCOMPLETE'), maintenance: day.filter(c => c.equipment_maintenance).length,
    missing: live.filter(e => !checkedIds.has(e.id)).length,
  }
  stats.coveragePct = stats.devices ? Math.round(stats.checked * 100 / stats.devices) : null

  // Daily-check observations + failing devices (attention first)
  const order = { ATTENTION: 0, INCOMPLETE: 1, HEALTHY: 2 }
  const observations = day
    .filter(c => (c.observation_action || '').trim() || c.daily_result === 'ATTENTION')
    .map(c => ({
      device: dev(c.enrollment_id), site: c.site_snapshot || enrById[c.enrollment_id]?.site || '', result: c.daily_result,
      severity: c.daily_result === 'ATTENTION' ? c.attention_severity : null, failing: failingFields(c), maintenance: !!c.equipment_maintenance,
      text: (c.observation_action || '').trim(),
    }))
    .sort((a, b) => (order[a.result] ?? 3) - (order[b.result] ?? 3))
  const missingDevices = live.filter(e => !checkedIds.has(e.id)).map(e => dev(e.id))

  // Device notes / issues logged that day, plus the open-issue backlog
  const notesToday = notes.filter(n => istDateOf(n.created_at) === date).map(n => ({
    device: dev(n.enrollment_id), body: n.body, isIssue: !!n.is_issue, category: n.issue_category, severity: n.severity,
    status: n.issue_status, by: person(n.created_by),
  }))
  const issuesResolvedToday = notes.filter(n => n.is_issue && n.issue_status === 'RESOLVED' && n.resolved_at && istDateOf(n.resolved_at) === date).length
  const openIssues = notes.filter(n => n.is_issue && n.issue_status === 'OPEN' && istDateOf(n.created_at) <= date).length

  // Incidents
  const inc = incidents.filter(i => !i.deleted_at)
  const incById = Object.fromEntries(inc.map(i => [i.id, i]))
  const brief = i => ({
    id: i.id, number: i.number, title: i.title, priority: i.priority, status: i.status, category: i.category,
    owner: person(i.assigned_owner_user_id) || i.assigned_owner_legacy || 'Unassigned', next_action: i.next_action,
    due: i.action_due_at, resolution: i.root_cause_resolution, reported_at: i.reported_at,
    devices: (i.device_enrollment_ids || []).map(dev), site: i.site, scope: i.scope_type,
  })
  const raised = inc.filter(i => istDateOf(i.reported_at) === date).map(brief)
  const resolved = inc.filter(i => (i.resolved_at && istDateOf(i.resolved_at) === date) || (i.closed_at && istDateOf(i.closed_at) === date)).map(brief)
  const endOfDay = new Date(new Date(`${date}T00:00:00+05:30`).getTime() + 86400000)
  const openNow = inc.filter(i => OPEN(i.status) && istDateOf(i.reported_at) <= date)
    .sort((a, b) => (PRIO_RANK[a.priority] ?? 9) - (PRIO_RANK[b.priority] ?? 9) || new Date(a.reported_at) - new Date(b.reported_at))
  const overdue = openNow.filter(i => i.action_due_at && new Date(i.action_due_at) < endOfDay).map(brief)
  const statusChanges = events
    .filter(e => e.entity === 'incident' && e.event_type === 'status_changed' && e.changes?.status && incById[e.entity_id])
    .map(e => ({
      number: incById[e.entity_id].number, title: incById[e.entity_id].title, at: e.created_at, by: person(e.actor_id),
      from: labelOf(INCIDENT_STATUSES, e.changes.status.from), to: labelOf(INCIDENT_STATUSES, e.changes.status.to),
    }))
  const updates = comments.filter(c => incById[c.incident_id]).map(c => ({
    number: incById[c.incident_id].number, body: c.body, by: person(c.created_by), at: c.created_at, hours: c.hours_spent,
  }))

  return {
    date, stats, observations, missingDevices, notesToday, issuesResolvedToday, openIssues,
    incidents: { raised, resolved, overdue, statusChanges, updates, open: openNow.map(brief),
      criticalOpen: openNow.filter(i => ['P1_CRITICAL', 'P2_HIGH'].includes(i.priority)).length },
  }
}

const short = p => PRIORITIES.find(x => x.key === p)?.short || p || ''

// Plain-text version — for Copy (WhatsApp / email) and as the AI prompt input.
export function summaryText(s, engagementName = '') {
  const L = []
  const st = s.stats
  L.push(`Go-Live daily summary${engagementName ? ` — ${engagementName}` : ''} — ${s.date}`)
  L.push('')
  L.push(`Checks: ${st.checked}/${st.devices} devices (${st.coveragePct ?? '—'}% coverage) · Healthy ${st.healthy} · Attention ${st.attention} · Incomplete ${st.incomplete}${st.maintenance ? ` · In maintenance ${st.maintenance}` : ''} · Missing ${st.missing}`)
  L.push(`Incidents: ${s.incidents.raised.length} raised · ${s.incidents.resolved.length} resolved/closed · ${s.incidents.open.length} open (${s.incidents.criticalOpen} P1/P2) · ${s.incidents.overdue.length} overdue`)
  L.push(`Device issues: ${s.notesToday.filter(n => n.isIssue).length} logged today · ${s.issuesResolvedToday} resolved · ${s.openIssues} open`)
  if (s.observations.length) {
    L.push('', 'Observations:')
    for (const o of s.observations) L.push(`- [${o.result}${o.severity ? ` ${o.severity}` : ''}] ${o.device}${o.site ? ` (${o.site})` : ''}${o.failing.length ? ` — ${o.failing.join(', ')}` : ''}${o.text ? `: ${o.text}` : ''}`)
  }
  if (s.notesToday.length) {
    L.push('', 'Device notes / issues:')
    for (const n of s.notesToday) L.push(`- ${n.isIssue ? `ISSUE${n.severity ? ` ${n.severity}` : ''}${n.category ? ` ${labelOf(CATEGORIES, n.category)}` : ''}` : 'Note'} · ${n.device}: ${n.body}`)
  }
  const list = (title, rows, f) => { if (rows.length) { L.push('', title); rows.forEach(r => L.push(`- ${f(r)}`)) } }
  list('Incidents raised:', s.incidents.raised, i => `${i.number} [${short(i.priority)}] ${i.title} — owner ${i.owner}`)
  list('Incidents resolved / closed:', s.incidents.resolved, i => `${i.number} ${i.title}${i.resolution ? ` — ${i.resolution}` : ''}`)
  list('Status changes:', s.incidents.statusChanges, c => `${c.number}: ${c.from} → ${c.to} (${c.by || 'System'})`)
  list('Incident updates:', s.incidents.updates, u => `${u.number} (${u.by || '—'}): ${u.body}`)
  list('Overdue actions:', s.incidents.overdue, i => `${i.number} [${short(i.priority)}] ${i.next_action || i.title} — due ${istDateTime(i.due)} · ${i.owner}`)
  if (s.missingDevices.length) L.push('', `No check logged: ${s.missingDevices.join(', ')}`)
  return L.join('\n')
}

// The SQL payload (golive_daily_summary_payload, STEP255 — used by the daily
// email and the shared report) → the same shape buildDailySummary() returns.
export function fromPayload(p) {
  if (!p) return null
  const st = p.stats || {}
  const inc = p.incidents || {}
  const brief = i => ({ ...i, devices: i.devices || [], owner: i.owner || null })
  return {
    date: p.date,
    stats: { ...st, coveragePct: st.devices ? Math.round((st.checked * 100) / st.devices) : null },
    observations: (p.observations || []).map(o => ({ ...o, failing: o.failing || [], text: o.text || '' })),
    missingDevices: p.missing || [],
    notesToday: (p.notes || []).map(n => ({ device: n.device, body: n.body, isIssue: !!n.is_issue, category: n.category, severity: n.severity, status: n.status, by: n.by })),
    issuesResolvedToday: p.issues_resolved || 0, openIssues: p.open_issues || 0,
    incidents: {
      raised: (inc.raised || []).map(brief), resolved: (inc.resolved || []).map(brief),
      overdue: (inc.overdue || []).map(brief), open: (inc.open || []).map(brief),
      statusChanges: (inc.changes || []).map(c => ({ ...c, from: labelOf(INCIDENT_STATUSES, c.from), to: labelOf(INCIDENT_STATUSES, c.to) })),
      updates: inc.updates || [], criticalOpen: inc.critical_open || 0,
    },
  }
}
