// Go-Live report email (STEP255–257). The payload is built entirely in SQL by
// golive_overview_payload() — executive overview + the day's summary under
// .summary (golive_daily_summary_payload); this only renders it. Three designs,
// picked per engagement (config.report_email.template → payload.template):
//   brief    clean one-screen brief: status, 4 numbers, what needs attention, today's changes
//   detailed the full report (overview tables + every daily section that has content)
//   plain    text-style memo, no colours or tables — forwards well, Outlook-safe
// The web app imports this file too, for the live preview in Share Report →
// Daily report email, so keep it free of Deno-only APIs.

import type { Org, Rendered } from './emailTemplates.ts'
import { esc, link, fmtDate, chip, plural, INK, MUTED, FAINT, BODY, GOOD, BAD, WARN, LINE, HAIR, BG, type Theme } from './reportDesign.ts'

const T: Theme = { key: 'golive_daily', label: 'Go-live daily report', band: '#0f3d3e', ink: '#99f6e4', soft: '#f0fdfa', accent: '#0d9488' }
const ACCENT = '#4f46e5'

export const GOLIVE_EMAIL_TEMPLATES = [
  { key: 'brief', label: 'Clean brief', desc: 'One screen: status, key numbers, what needs attention and what changed today.' },
  { key: 'detailed', label: 'Detailed report', desc: 'The clean look with everything in it: 8 key numbers, hypercare progress, every observation, incident, open action, device note, the last 7 days and sites.' },
  { key: 'plain', label: 'Plain memo', desc: 'Text-style, no colours or tables. Forwards cleanly and looks the same in Outlook.' },
]

const PRIO: Record<string, [string, string]> = {
  P1_CRITICAL: ['P1', BAD], P2_HIGH: ['P2', WARN], P3_NORMAL: ['P3', '#2563eb'], P4_REQUEST: ['P4', MUTED],
}
const RESULT: Record<string, [string, string]> = {
  ATTENTION: ['Attention', BAD], INCOMPLETE: ['Incomplete', WARN], HEALTHY: ['Healthy', GOOD],
}
const human = (s: unknown) => { const t = String(s ?? '').replace(/_/g, ' ').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1) }
const first = (n?: string | null) => (n || '').trim().split(/\s+/)[0] || 'there'
const multiline = (s: string) => esc(s).replace(/\n/g, '<br>')
const prio = (p: string) => { const [l, c] = PRIO[p] || [p || '—', MUTED]; return chip(l, c) }
const res = (r: string) => { const [l, c] = RESULT[r] || [human(r), MUTED]; return chip(l, c) }
const REASON = "You're receiving this because you're on this go-live engagement's report email list."

/* ── Everything the three designs share ── */
function model(org: Org, payload: any) {
  const tz = org.timezone || 'Asia/Kolkata'
  const ov = payload.summary ? payload : null          // executive overview (STEP255 golive_overview_payload)
  const d = payload.summary || payload                 // the day's summary
  const g = { ...(d.engagement || {}), ...(ov?.engagement || {}) }
  const appLink = ov?.link || g.link || '/golive'
  const internal = !ov?.customer_view                  // external readers can't sign in, so no in-app links
  const s = d.stats || {}, inc = d.incidents || {}
  const obs: any[] = d.observations || [], notes: any[] = d.notes || [], missing: string[] = d.missing || []
  const raised: any[] = inc.raised || [], resolved: any[] = inc.resolved || [], changes: any[] = inc.changes || []
  const updates: any[] = inc.updates || [], overdue: any[] = inc.overdue || [], open: any[] = inc.open || []
  const day = fmtDate(`${d.date}T12:00:00+05:30`, tz, { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })
  const shortDay = fmtDate(`${d.date}T12:00:00+05:30`, tz, { day: '2-digit', month: 'short' })
  const time = (iso: string) => fmtDate(iso, tz, { hour: '2-digit', minute: '2-digit', hour12: false })
  const when = (iso: string) => iso ? fmtDate(iso, tz, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'
  const cov = s.devices ? Math.round((s.checked * 100) / s.devices) : null
  const issues = notes.filter(n => n.is_issue)
  const activity = [...changes.map(c => ({ ...c, kind: 'status' })), ...updates.map(u => ({ ...u, kind: 'update' }))]
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))

  const flags: string[] = []
  if (s.attention) flags.push(plural(s.attention, 'device') + (s.attention === 1 ? ' needs' : ' need') + ' attention')
  if (s.missing) flags.push(plural(s.missing, 'device') + ' not checked')
  if (inc.critical_open) flags.push(`${inc.critical_open} P1/P2 incident${inc.critical_open === 1 ? '' : 's'} open`)
  if (overdue.length) flags.push(plural(overdue.length, 'overdue action'))
  const verdict = flags.length ? flags.join(' · ') : 'All checked devices healthy, no open critical incidents.'
  const x = ov ? overviewNumbers(ov) : null
  const subject = `Go-live daily report · ${g.code || g.name} · ${shortDay}${flags.length ? ` · ${flags[0]}` : ''}`
  const openUrl = link(org, `${appLink}?tab=overview`)
  const incUrl = (id: string) => link(org, `${appLink}?tab=incidents&incident=${id}`)

  // Ranked "needs attention" items, shared by brief + plain
  const seen = new Set<string>()
  const attention: { sev: number; title: string; meta: string; url?: string }[] = []
  for (const i of [...overdue, ...open]) {
    if (seen.has(i.id)) continue
    const isOver = overdue.some(o => o.id === i.id)
    if (!isOver && !['P1_CRITICAL', 'P2_HIGH'].includes(i.priority)) continue
    seen.add(i.id)
    attention.push({
      sev: i.priority === 'P1_CRITICAL' ? 0 : isOver ? 1 : 2, title: `${i.number} · ${i.title}`, url: internal ? incUrl(i.id) : undefined,
      meta: [PRIO[i.priority]?.[0], human(i.status), isOver && i.due ? `action overdue since ${when(i.due)}` : null, i.next_action ? `next: ${i.next_action}` : null, i.owner].filter(Boolean).join(' · '),
    })
  }
  for (const o of obs.filter(o => o.result === 'ATTENTION')) {
    attention.push({ sev: o.severity === 'HIGH' ? 1 : 2, title: o.device, meta: [(o.failing || []).join(', '), o.text].filter(Boolean).join(' — ') || 'Failing check' })
  }
  if (missing.length) attention.push({ sev: 3, title: `${plural(missing.length, 'device')} without a check`, meta: missing.slice(0, 5).join(', ') + (missing.length > 5 ? ` +${missing.length - 5} more` : '') })
  attention.sort((a, b) => a.sev - b.sev)

  return { tz, ov, d, g, appLink, internal, s, inc, obs, notes, missing, raised, resolved, overdue, open, day, shortDay, time, when, cov, issues, activity, flags, verdict, x, subject, openUrl, incUrl, attention }
}
type M = ReturnType<typeof model>

/* ── Picker ── */
export function goLiveDailyEmail(org: Org, payload: any, toName: string | null, template?: string): Rendered {
  const key = template || payload?.template || 'brief'
  const m = model(org, payload)
  if (key === 'detailed') return detailedEmail(org, m, payload, toName)
  if (key === 'plain') return plainEmail(org, m, payload, toName)
  return briefEmail(org, m, payload, toName)
}

/* ── Plain-text part (all designs) ── */
function textBody(org: Org, m: M, toName: string | null) {
  const { s, inc, g, x } = m
  const L: string[] = [`Hi ${first(toName)},`, '', `Go-live report — ${g.name || g.code} — ${m.day}`, m.verdict, '']
  if (m.ov) L.push(...overviewText(m.ov, g))
  L.push(
    `Checks: ${s.checked ?? 0}/${s.devices ?? 0}${m.cov == null ? '' : ` (${m.cov}%)`} · Healthy ${s.healthy ?? 0} · Attention ${s.attention ?? 0} · Incomplete ${s.incomplete ?? 0} · Missing ${s.missing ?? 0}`,
    `Incidents: ${m.raised.length} raised · ${m.resolved.length} resolved/closed · ${inc.open_count ?? m.open.length} open (${inc.critical_open ?? 0} P1/P2) · ${m.overdue.length} overdue`,
    `Device issues: ${m.issues.length} logged · ${m.d.issues_resolved ?? 0} resolved · ${m.d.open_issues ?? 0} open`)
  const list = (title: string, rows: any[], f: (x: any) => string) => { if (rows.length) L.push('', title, ...rows.map(r => `- ${f(r)}`)) }
  list('Observations:', m.obs, o => `[${human(o.result)}] ${o.device}${(o.failing || []).length ? ` — ${o.failing.join(', ')}` : ''}${o.text ? `: ${o.text}` : ''}`)
  list('Device notes / issues:', m.notes, n => `${n.is_issue ? 'Issue' : 'Note'} · ${n.device}: ${n.body}`)
  list('Incidents raised:', m.raised, i => `${i.number} [${PRIO[i.priority]?.[0] || ''}] ${i.title}${i.owner ? ` — ${i.owner}` : ''}`)
  list('Resolved / closed:', m.resolved, i => `${i.number} ${i.title}${i.resolution ? ` — ${i.resolution}` : ''}`)
  list('Status changes & updates:', m.activity, a => `${m.time(a.at)} ${a.number}: ${a.kind === 'status' ? `${human(a.from)} → ${human(a.to)}` : a.body}${a.by ? ` (${a.by})` : ''}`)
  list('Overdue actions:', m.overdue, i => `${i.number} ${i.next_action || i.title} — due ${m.when(i.due)}${i.owner ? ` · ${i.owner}` : ''}`)
  list('Open incidents:', m.open, i => `${i.number} [${PRIO[i.priority]?.[0] || ''}] ${i.title} — ${human(i.status)}${i.owner ? ` · ${i.owner}` : ''}`)
  if (m.missing.length) L.push('', `No check logged: ${m.missing.join(', ')}`)
  if (m.internal) L.push('', `Open: ${m.openUrl}`)
  return L.join('\n')
}

const manualNote = (payload: any, color = MUTED) => payload.manual
  ? `<div style="margin:0 0 14px;font-size:12px;color:${color}">Sent on request${payload.sent_by ? ` by ${esc(payload.sent_by)}` : ''}.</div>` : ''

/* ══ 1. Clean brief ══ */
function briefEmail(org: Org, m: M, payload: any, toName: string | null): Rendered {
  const { s, inc, g, x } = m
  const statusColor = !m.flags.length ? GOOD : (inc.critical_open || m.overdue.length) ? BAD : WARN
  const num = (label: string, value: string, sub: string, color = INK) => `<td width="25%" valign="top" style="padding:14px 12px;border-left:1px solid ${HAIR}">
      <div style="font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${MUTED}">${esc(label)}</div>
      <div style="font-size:24px;font-weight:700;color:${color};margin-top:4px;line-height:1.1">${value}</div>
      <div style="font-size:12px;color:${FAINT};margin-top:3px">${sub}</div></td>`
  const health = x?.score != null ? num('Health', `${x.score}`, esc(x.label), x.color) : num('Coverage', m.cov == null ? '—' : `${m.cov}%`, 'of devices checked')
  const numbers = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:10px;border-collapse:separate;margin:0 0 22px"><tr>
      ${health.replace(`border-left:1px solid ${HAIR}`, 'border-left:0')}
      ${num('Checked', `${s.checked ?? 0}<span style="font-size:15px;color:${FAINT}">/${s.devices ?? 0}</span>`, m.cov == null ? '' : `${m.cov}% coverage`)}
      ${num('Attention', String(s.attention ?? 0), `${s.healthy ?? 0} healthy`, s.attention ? BAD : INK)}
      ${num('Open incidents', String(inc.open_count ?? m.open.length), inc.critical_open ? `${inc.critical_open} P1/P2` : 'none critical', inc.critical_open ? BAD : INK)}
    </tr></table>`
  const h2 = (t: string, sub = '') => `<div style="font-size:13px;font-weight:700;color:${INK};margin:0 0 8px">${esc(t)}${sub ? ` <span style="font-weight:400;color:${FAINT}">· ${esc(sub)}</span>` : ''}</div>`
  const row = (dot: string, title: string, meta: string, url?: string) => `<tr>
      <td width="14" valign="top" style="padding:11px 0 0"><div style="width:7px;height:7px;border-radius:7px;background:${dot}"></div></td>
      <td style="padding:7px 0 7px 4px;border-bottom:1px solid ${HAIR}">
        <div style="font-size:14px;font-weight:600;color:${INK}">${url ? `<a href="${esc(url)}" style="color:${INK};text-decoration:none">${esc(title)}</a>` : esc(title)}</div>
        ${meta ? `<div style="font-size:12.5px;line-height:1.5;color:${MUTED};margin-top:1px">${esc(meta)}</div>` : ''}
      </td></tr>`
  const list = (rows: string[]) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px">${rows.join('')}</table>`
  const sevDot = [BAD, BAD, WARN, FAINT]

  const parts: string[] = [manualNote(payload)]
  parts.push(`<div style="font-size:15px;line-height:1.55;color:${BODY};margin:0 0 18px">Hi ${esc(first(toName))}, here's how <b style="color:${INK}">${esc(g.name || g.code || 'the go-live')}</b> stood on ${esc(m.day)}.</div>`)
  parts.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px"><tr>
      <td width="4" style="background:${statusColor};border-radius:2px">&nbsp;</td>
      <td style="padding:2px 0 2px 12px;font-size:15px;font-weight:600;line-height:1.5;color:${INK}">${esc(m.verdict)}</td></tr></table>`)
  parts.push(numbers)

  const top = m.attention.slice(0, 8)
  if (top.length) {
    parts.push(h2('Needs attention', m.attention.length > top.length ? `top ${top.length} of ${m.attention.length}` : ''))
    parts.push(list(top.map(a => row(sevDot[a.sev], a.title, a.meta, a.url))))
  }

  const changed: string[] = []
  for (const i of m.raised) changed.push(row(ACCENT, `New: ${i.number} · ${i.title}`, [PRIO[i.priority]?.[0], human(i.category), (i.devices || []).join(', ')].filter(Boolean).join(' · '), m.internal ? m.incUrl(i.id) : undefined))
  for (const i of m.resolved) changed.push(row(GOOD, `${human(i.status)}: ${i.number} · ${i.title}`, i.resolution || '', m.internal ? m.incUrl(i.id) : undefined))
  for (const n of m.issues) changed.push(row(n.severity === 'HIGH' ? BAD : WARN, `Device issue: ${n.device}`, n.body))
  if (changed.length) { parts.push(h2('What changed today')); parts.push(list(changed)) }

  if (!top.length && !changed.length) parts.push(`<div style="font-size:14px;color:${GOOD};font-weight:600;margin:0 0 20px">All clear — nothing needs attention.</div>`)

  if (x) {
    const t = dayOf(g, m.ov.date)
    const crit: any[] = m.ov.readiness?.criteria || []
    const bits = [t ? `Hypercare day ${t.n}${t.total ? ` of ${t.total}` : ''}` : '', crit.length ? `${crit.filter(c => c.met).length}/${crit.length} exit criteria met` : '',
      x.k.mttr != null ? `MTTR ${mins(x.k.mttr)}` : ''].filter(Boolean)
    if (bits.length) parts.push(`<div style="font-size:12.5px;color:${MUTED};margin:0 0 4px">${esc(bits.join(' · '))}</div>`)
  }
  if (m.internal) parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 0"><tr><td style="border-radius:8px;background:${ACCENT}">
      <a href="${esc(m.openUrl)}" style="display:inline-block;padding:10px 18px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">Open full report</a></td></tr></table>`)

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(m.subject)}</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(m.verdict)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
  <tr><td style="padding:0 4px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="font-size:13px;font-weight:700;color:${INK}">${esc(org.fromName || org.orgName)}</td>
    <td align="right" style="font-size:12px;color:${FAINT}">Go-live daily report</td></tr></table></td></tr>
  <tr><td style="background:#ffffff;border:1px solid ${LINE};border-radius:12px;padding:26px 28px 26px">
    <div style="font-size:21px;font-weight:700;line-height:1.3;color:${INK}">${esc(g.name || g.code || 'Go-live')}</div>
    <div style="font-size:13px;color:${MUTED};margin:3px 0 20px">${esc(m.day)}${(g.sites || []).length ? ` · ${esc(g.sites.join(', '))}` : ''}</div>
    ${parts.join('\n')}
  </td></tr>
  <tr><td style="padding:14px 4px 0;font-size:11.5px;line-height:1.6;color:${FAINT}">${esc(REASON)}${org.footer ? `<br>${esc(org.footer)}` : ''}</td></tr>
</table></td></tr></table></body></html>`
  return { subject: m.subject, html, text: textBody(org, m, toName) }
}

/* ══ 3. Plain memo ══ */
function plainEmail(org: Org, m: M, payload: any, toName: string | null): Rendered {
  const { s, inc, g, x } = m
  const P = (h: string) => `<p style="margin:0 0 10px">${h}</p>`
  const H = (t: string) => `<p style="margin:20px 0 6px;font-weight:700;color:#111">${esc(t)}</p>`
  const UL = (items: string[]) => `<ul style="margin:0 0 10px;padding-left:20px">${items.map(i => `<li style="margin:0 0 5px">${i}</li>`).join('')}</ul>`
  const b: string[] = []
  if (payload.manual) b.push(P(`<i>Sent on request${payload.sent_by ? ` by ${esc(payload.sent_by)}` : ''}.</i>`))
  b.push(P(`Hi ${esc(first(toName))},`))
  b.push(P(`Go-live report for <b>${esc(g.name || g.code || 'the engagement')}</b> — ${esc(m.day)}.`))
  b.push(P(`<b>${esc(m.verdict)}</b>`))
  const summary = [
    x?.score != null ? `Health index: <b>${x.score}</b> (${esc(x.label)})` : '',
    `Devices checked: <b>${s.checked ?? 0} of ${s.devices ?? 0}</b>${m.cov == null ? '' : ` (${m.cov}%)`} — ${s.healthy ?? 0} healthy, ${s.attention ?? 0} attention, ${s.missing ?? 0} not checked`,
    `Incidents: ${m.raised.length} raised, ${m.resolved.length} resolved/closed, <b>${inc.open_count ?? m.open.length} open</b>${inc.critical_open ? ` (${inc.critical_open} P1/P2)` : ''}, ${m.overdue.length} overdue`,
    `Device issues: ${m.issues.length} logged today, ${m.d.open_issues ?? 0} open`,
  ].filter(Boolean)
  b.push(H('Summary')); b.push(UL(summary))
  if (m.attention.length) { b.push(H('Needs attention')); b.push(UL(m.attention.map(a => `<b>${esc(a.title)}</b>${a.meta ? ` — ${esc(a.meta)}` : ''}`))) }
  const obsRest = m.obs.filter(o => o.result !== 'ATTENTION' && o.text)
  if (obsRest.length) { b.push(H('Other observations')); b.push(UL(obsRest.map(o => `${esc(o.device)}: ${esc(o.text)}`))) }
  if (m.raised.length) { b.push(H('Incidents raised')); b.push(UL(m.raised.map(i => `<b>${esc(i.number)}</b> [${PRIO[i.priority]?.[0] || ''}] ${esc(i.title)}${(i.devices || []).length ? ` — ${esc(i.devices.join(', '))}` : ''}`))) }
  if (m.resolved.length) { b.push(H('Resolved / closed')); b.push(UL(m.resolved.map(i => `<b>${esc(i.number)}</b> ${esc(i.title)}${i.resolution ? ` — ${esc(i.resolution)}` : ''}`))) }
  if (m.activity.length) { b.push(H('Incident activity')); b.push(UL(m.activity.map(a => `${esc(m.time(a.at))} <b>${esc(a.number)}</b>: ${a.kind === 'status' ? `${esc(human(a.from))} → ${esc(human(a.to))}` : esc(a.body || '')}${a.by ? ` (${esc(a.by)})` : ''}`))) }
  if (m.notes.length) { b.push(H('Device notes & issues')); b.push(UL(m.notes.map(n => `${n.is_issue ? 'Issue' : 'Note'} · ${esc(n.device)}: ${esc(n.body)}`))) }
  if (m.open.length) { b.push(H('All open incidents')); b.push(UL(m.open.map(i => `<b>${esc(i.number)}</b> [${PRIO[i.priority]?.[0] || ''}] ${esc(i.title)} — ${esc(human(i.status))}${i.owner ? `, ${esc(i.owner)}` : ''}`))) }
  if (m.ov?.sites?.length) { b.push(H('Sites')); b.push(UL(m.ov.sites.map((r: any) => `${esc(r.site)}: ${r.checked}/${r.devices} checked, ${r.healthy} healthy, ${r.attention} attention, ${r.open} open incidents`))) }
  if (m.internal) b.push(P(`<br><a href="${esc(m.openUrl)}" style="color:${ACCENT}">Open the full report</a>`))
  b.push(P(`<br>— ${esc(org.fromName || org.orgName)}`))
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(m.subject)}</title></head>
<body style="margin:0;padding:24px 16px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#222">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(m.verdict)}</div>
<div style="max-width:640px">${b.join('\n')}
<p style="margin:24px 0 0;font-size:11.5px;color:#888">${esc(REASON)}${org.footer ? `<br>${esc(org.footer)}` : ''}</p></div></body></html>`
  return { subject: m.subject, html, text: textBody(org, m, toName) }
}

/* ══ 2. Detailed report — the clean layout of the brief, with every section ══ */

// Shared clean building blocks (brief look: white card, hairlines, one accent)
const cH2 = (t: string, sub = '') => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 10px"><tr>
    <td style="font-size:15px;font-weight:700;color:${INK}">${esc(t)}${sub ? `<span style="font-size:12.5px;font-weight:400;color:${FAINT}"> · ${esc(sub)}</span>` : ''}</td></tr>
    <tr><td style="padding-top:8px;border-bottom:2px solid ${INK};font-size:0;line-height:0">&nbsp;</td></tr></table>`
function cTable(head: [string, ('left' | 'right')?, number?][], rows: string[][]) {
  const th = head.map(([h, al, w]) => `<th align="${al || 'left'}"${w ? ` width="${w}"` : ''} style="padding:0 8px 7px 0;font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${FAINT};border-bottom:1px solid ${LINE};white-space:nowrap">${esc(h)}</th>`).join('')
  const tr = rows.map(r => `<tr>${r.map((c, j) => `<td align="${head[j]?.[1] || 'left'}" valign="top" style="padding:9px 8px 9px 0;font-size:13px;line-height:1.5;color:${BODY};border-bottom:1px solid ${HAIR}">${c}</td>`).join('')}</tr>`).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${th}</tr>${tr}</table>`
}
const cDot = (color: string, label: string) => `<span style="white-space:nowrap;color:${color};font-weight:600"><span style="display:inline-block;width:7px;height:7px;border-radius:7px;background:${color};margin-right:5px;vertical-align:1px"></span>${esc(label)}</span>`
const cSub = (t: string) => t ? `<div style="font-size:12px;color:${FAINT};margin-top:2px">${t}</div>` : ''
const cStrong = (t: string) => `<span style="font-weight:600;color:${INK}">${esc(t)}</span>`
const cBar = (pctVal: number | null, color: string) => pctVal == null ? '' : `<table role="presentation" width="70" cellpadding="0" cellspacing="0" style="display:inline-table;vertical-align:middle;margin-left:6px"><tr>
    ${pctVal > 0 ? `<td width="${Math.min(100, pctVal)}%" style="background:${color};height:5px;font-size:0;line-height:0">&nbsp;</td>` : ''}${pctVal < 100 ? `<td style="background:${HAIR};height:5px;font-size:0;line-height:0">&nbsp;</td>` : ''}</tr></table>`
function cPage(org: Org, m: M, inner: string, toName: string | null) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(m.subject)}</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(m.verdict)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px">
  <tr><td style="padding:0 4px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="font-size:13px;font-weight:700;color:${INK}">${esc(org.fromName || org.orgName)}</td>
    <td align="right" style="font-size:12px;color:${FAINT}">Go-live daily report · detailed</td></tr></table></td></tr>
  <tr><td style="background:#ffffff;border:1px solid ${LINE};border-radius:12px;padding:28px 30px 30px">
    <div style="font-size:22px;font-weight:700;line-height:1.3;color:${INK}">${esc(m.g.name || m.g.code || 'Go-live')}</div>
    <div style="font-size:13px;color:${MUTED};margin:3px 0 20px">${esc(m.day)}${(m.g.sites || []).length ? ` · ${esc(m.g.sites.join(', '))}` : ''}${m.g.code ? ` · ${esc(m.g.code)}` : ''}</div>
    ${inner}
  </td></tr>
  <tr><td style="padding:14px 4px 0;font-size:11.5px;line-height:1.6;color:${FAINT}">${esc(REASON)}${org.footer ? `<br>${esc(org.footer)}` : ''}</td></tr>
</table></td></tr></table></body></html>`
}

function detailedEmail(org: Org, m: M, payload: any, toName: string | null): Rendered {
  const { s, inc, g, d, x, obs, notes, missing, raised, resolved, overdue, open, internal, activity } = m
  const statusColor = !m.flags.length ? GOOD : (inc.critical_open || overdue.length) ? BAD : WARN
  const quiet: string[] = []
  const b: string[] = [manualNote(payload)]
  const incLink = (i: any) => internal ? `<a href="${esc(m.incUrl(i.id))}" style="color:${ACCENT};font-weight:700;text-decoration:none">${esc(i.number)}</a>` : `<span style="font-weight:700;color:${INK}">${esc(i.number)}</span>`
  const pri = (p: string) => { const [l, c] = PRIO[p] || [p || '—', MUTED]; return cDot(c, l) }

  b.push(`<div style="font-size:15px;line-height:1.55;color:${BODY};margin:0 0 18px">Hi ${esc(first(toName))}, here is the full go-live report for <b style="color:${INK}">${esc(g.name || g.code || 'the engagement')}</b>.</div>`)
  b.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr>
      <td width="4" style="background:${statusColor};border-radius:2px">&nbsp;</td>
      <td style="padding:2px 0 2px 12px;font-size:15px;font-weight:600;line-height:1.5;color:${INK}">${esc(m.verdict)}</td></tr></table>`)

  // ── Key numbers (2 rows × 4) ──
  const cell = (label: string, value: string, sub: string, color = INK, first = false) => `<td width="25%" valign="top" style="padding:13px 12px;${first ? '' : `border-left:1px solid ${HAIR};`}">
      <div style="font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${MUTED}">${esc(label)}</div>
      <div style="font-size:22px;font-weight:700;color:${color};margin-top:4px;line-height:1.1">${value}</div>
      <div style="font-size:11.5px;color:${FAINT};margin-top:3px">${sub}</div></td>`
  const k = x?.k || {}
  const healthyPct = x?.healthyPct ?? (s.checked ? Math.round(((s.healthy || 0) * 1000) / s.checked) / 10 : null)
  b.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:10px;border-collapse:separate;margin:0 0 8px">
    <tr>
      ${cell('Health index', x?.score != null ? String(x.score) : '—', x ? esc(x.label) : 'no overview data', x?.color || INK, true)}
      ${cell('Checked', `${s.checked ?? 0}<span style="font-size:14px;color:${FAINT}">/${s.devices ?? 0}</span>`, m.cov == null ? '' : `${m.cov}% coverage`)}
      ${cell('Healthy rate', healthyPct == null ? '—' : `${healthyPct}%`, `${s.healthy ?? 0} healthy checks`, GOOD)}
      ${cell('Attention', String(s.attention ?? 0), `${s.missing ?? 0} not checked · ${s.incomplete ?? 0} incomplete`, s.attention ? BAD : INK)}
    </tr>
    <tr><td colspan="4" style="border-top:1px solid ${HAIR};font-size:0;line-height:0">&nbsp;</td></tr>
    <tr>
      ${cell('Open incidents', String(inc.open_count ?? open.length), inc.critical_open ? `${inc.critical_open} P1/P2` : 'none critical', inc.critical_open ? BAD : INK, true)}
      ${cell('Raised / resolved', `${raised.length}<span style="font-size:14px;color:${FAINT}"> / ${resolved.length}</span>`, 'incidents on this day')}
      ${cell('Overdue actions', String(overdue.length), 'incident next actions', overdue.length ? BAD : INK)}
      ${cell('Device issues', String(m.issues.length), `${d.open_issues ?? 0} open overall`, m.issues.length ? WARN : INK)}
    </tr></table>`)

  // ── Hypercare progress ──
  if (m.ov) {
    const t = dayOf(g, m.ov.date)
    const crit: any[] = m.ov.readiness?.criteria || []
    const stable = crit.find(c => c.key === 'stable_days')
    const bits = [
      t ? `Hypercare day <b style="color:${INK}">${t.n}${t.total ? ` of ${t.total}` : ''}</b>${t.left != null ? ` (${t.left >= 0 ? `${t.left} days left` : `<span style="color:${BAD}">${-t.left} days over plan</span>`})` : ''}` : '',
      crit.length ? `Exit criteria <b style="color:${INK}">${crit.filter(c => c.met).length}/${crit.length}</b> met` : '',
      stable ? `${stable.value} of ${stable.target} stable days` : '',
      `MTTA ${mins(k.mtta)} · MTTR ${mins(k.mttr)}`,
      ov_repeat(m.ov),
    ].filter(Boolean)
    b.push(`<div style="font-size:12.5px;line-height:1.7;color:${MUTED};margin:8px 0 0">${bits.join(' &nbsp;·&nbsp; ')}</div>`)
  }

  // ── Needs attention ──
  if (m.attention.length) {
    b.push(cH2('Needs attention', plural(m.attention.length, 'item')))
    const sev = [BAD, BAD, WARN, FAINT]
    b.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${m.attention.map(a => `<tr>
      <td width="14" valign="top" style="padding:12px 0 0"><div style="width:7px;height:7px;border-radius:7px;background:${sev[a.sev]}"></div></td>
      <td style="padding:8px 0 8px 4px;border-bottom:1px solid ${HAIR}"><div style="font-size:13.5px;font-weight:600;color:${INK}">${a.url ? `<a href="${esc(a.url)}" style="color:${INK};text-decoration:none">${esc(a.title)}</a>` : esc(a.title)}</div>
      ${a.meta ? `<div style="font-size:12.5px;line-height:1.5;color:${MUTED};margin-top:1px">${esc(a.meta)}</div>` : ''}</td></tr>`).join('')}</table>`)
  }

  // ── Observations ──
  if (obs.length) {
    b.push(cH2('Daily check observations', plural(obs.length, 'device')))
    b.push(cTable([['Equipment / device'], ['Result', 'left', 110], ['Failing'], ['Observation / action']], obs.map(o => [
      `${cStrong(o.device)}${cSub(esc(o.site || ''))}`,
      cDot(RESULT[o.result]?.[1] || MUTED, RESULT[o.result]?.[0] || human(o.result)) + (o.severity && o.result === 'ATTENTION' ? cSub(esc(human(o.severity)) + ' severity') : '') + (o.maintenance ? cSub('In maintenance') : ''),
      (o.failing || []).length ? `<span style="color:${BAD}">${esc(o.failing.join(', '))}</span>` : `<span style="color:${FAINT}">—</span>`,
      o.text ? multiline(o.text) : `<span style="color:${FAINT}">—</span>`,
    ])))
  } else quiet.push('no observations')

  // ── Incidents on the day ──
  const dayInc = [...raised.map(i => ({ ...i, what: 'Raised' })), ...resolved.map(i => ({ ...i, what: human(i.status) }))]
  if (dayInc.length) {
    b.push(cH2('Incidents raised & resolved', `${raised.length} raised · ${resolved.length} resolved / closed`))
    b.push(cTable([['Incident', 'left', 80], ['Priority', 'left', 70], ['Details'], ['Event', 'left', 90]], dayInc.map(i => [
      incLink(i), pri(i.priority),
      `${cStrong(i.title)}${cSub(esc([(i.devices || []).join(', ') || i.site, human(i.category)].filter(Boolean).join(' · ')))}${i.what !== 'Raised' && i.resolution ? `<div style="font-size:12.5px;color:${BODY};margin-top:3px">Resolution: ${multiline(i.resolution)}</div>` : ''}`,
      i.what === 'Raised' ? cDot(ACCENT, 'Raised') : cDot(GOOD, i.what),
    ])))
  } else quiet.push('no incidents raised or resolved')

  if (activity.length) {
    b.push(cH2('Incident activity', plural(activity.length, 'entry', 'entries')))
    const by = activity.some(a => a.by)
    b.push(cTable([['Time', 'left', 50], ['Incident', 'left', 80], ['What happened'], ...(by ? [['By', 'left', 120] as [string, 'left', number]] : [])], activity.map(a => [
      `<span style="color:${MUTED}">${esc(m.time(a.at))}</span>`, `<span style="font-weight:600;color:${INK}">${esc(a.number)}</span>`,
      a.kind === 'status' ? `<span style="color:${FAINT};text-decoration:line-through">${esc(human(a.from))}</span> &rarr; <b style="color:${INK}">${esc(human(a.to))}</b>`
        : `${multiline(a.body || '')}${a.hours ? ` <span style="color:${FAINT}">(${esc(a.hours)}h)</span>` : ''}`,
      ...(by ? [esc(a.by || 'System')] : []),
    ])))
  } else quiet.push('no incident activity')

  if (open.length) {
    b.push(cH2('All open incidents', `${open.length} open${inc.critical_open ? ` · ${inc.critical_open} P1/P2` : ''}${overdue.length ? ` · ${overdue.length} overdue` : ''}`))
    const owners = open.some(i => i.owner)
    b.push(cTable([['Incident', 'left', 80], ['Priority', 'left', 70], ['Details'], ['Next action / due'], ...(owners ? [['Owner', 'left', 110] as [string, 'left', number]] : [])], open.map(i => {
      const late = overdue.some(o => o.id === i.id)
      return [incLink(i), pri(i.priority),
        `${cStrong(i.title)}${cSub(esc([human(i.status), (i.devices || []).join(', ') || i.site].filter(Boolean).join(' · ')))}`,
        `${esc(i.next_action || '—')}${i.due ? `<div style="font-size:12px;margin-top:2px;color:${late ? BAD : FAINT}">${late ? 'Overdue · ' : 'Due '}${esc(m.when(i.due))}</div>` : ''}`,
        ...(owners ? [esc(i.owner || 'Unassigned')] : [])]
    })))
  } else quiet.push('no open incidents')

  // ── Device notes / issues ──
  if (notes.length) {
    b.push(cH2('Device notes & issues', `${m.issues.length} issue${m.issues.length === 1 ? '' : 's'} logged · ${d.issues_resolved ?? 0} resolved · ${d.open_issues ?? 0} open overall`))
    const named = notes.some(n => n.by)
    b.push(cTable([['Equipment / device'], ['Type', 'left', 120], ['Note'], ...(named ? [['By', 'left', 110] as [string, 'left', number]] : [])], notes.map(n => [
      cStrong(n.device),
      n.is_issue ? cDot(n.status === 'RESOLVED' ? GOOD : n.severity === 'HIGH' ? BAD : WARN, `Issue${n.severity ? ' · ' + human(n.severity) : ''}`) + cSub(esc([n.category && human(n.category), n.status === 'RESOLVED' && 'resolved'].filter(Boolean).join(' · '))) : cDot(MUTED, 'Note'),
      multiline(n.body || ''),
      ...(named ? [`${esc(n.by || '—')}${cSub(esc(m.time(n.at)))}`] : []),
    ])))
  } else quiet.push('no device notes')

  // ── Last 7 days + sites ──
  if (x && x.series.length > 1) {
    b.push(cH2('Last 7 days', 'daily check results'))
    b.push(cTable([['Date'], ['Checked', 'right'], ['Healthy rate', 'left', 150], ['Attention', 'right'], ['Open incidents', 'right']], [...x.series.slice(-7)].reverse().map(r => {
      const hp = r.records ? Math.round((r.healthy * 1000) / r.records) / 10 : null
      return [esc(fmtDate(`${r.date}T12:00:00+05:30`, m.tz, { weekday: 'short', day: '2-digit', month: 'short' })),
        `${r.checked}/${r.devices}`, `${hp == null ? '—' : `${hp}%`}${cBar(hp, GOOD)}`,
        r.attention ? `<b style="color:${BAD}">${r.attention}</b>` : '0', String(r.open_incidents ?? 0)]
    })))
  }
  const sites: any[] = m.ov?.sites || []
  if (sites.length) {
    b.push(cH2('Site performance', plural(sites.length, 'site')))
    b.push(cTable([['Site'], ['Status', 'left', 80], ['Checked', 'right'], ['Healthy', 'right'], ['Attention', 'right'], ['Open incidents', 'right']], sites.map(r => {
      const [lab, col] = r.critical || (r.attention > 0 && r.attention >= r.healthy) ? ['At risk', BAD] : r.attention || r.open || r.checked < r.devices ? ['Watch', WARN] : ['Stable', GOOD]
      return [cStrong(r.site), cDot(col, lab), `${r.checked}/${r.devices}`, String(r.healthy), r.attention ? `<b style="color:${BAD}">${r.attention}</b>` : '0',
        `${r.open}${r.critical ? ` <span style="color:${BAD}">(${r.critical} P1/P2)</span>` : ''}`]
    })))
  }

  if (missing.length) {
    b.push(cH2('Not checked', plural(missing.length, 'device')))
    b.push(`<div style="font-size:13px;line-height:1.8;color:${BODY}">${missing.map(v => esc(v)).join(' &nbsp;·&nbsp; ')}</div>`)
  }
  if (quiet.length) b.push(`<div style="margin-top:22px;font-size:12.5px;color:${FAINT}">Nothing to report: ${esc(quiet.join(' · '))}.</div>`)
  if (internal) b.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0"><tr><td style="border-radius:8px;background:${ACCENT}">
      <a href="${esc(m.openUrl)}" style="display:inline-block;padding:10px 18px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">Open in the app</a></td></tr></table>`)

  return { subject: m.subject, html: cPage(org, m, b.join('\n'), toName), text: textBody(org, m, toName) }
}
const ov_repeat = (ov: any) => ov?.repeat_failures ? `${plural(ov.repeat_failures, 'repeat-failure device')}` : ''

/* ── Executive overview (same figures as the Overview tab's header + tiles) ── */
const pctOf = (a: number, b: number) => (b ? Math.round((a * 1000) / b) / 10 : null)
function overviewNumbers(ov: any) {
  const series: any[] = ov.series || []
  const cur = series[series.length - 1] || {}, prev = series[series.length - 2] || null
  const k = ov.incident_kpis || {}
  const coverage = pctOf(cur.checked || 0, cur.devices || 0)
  const healthyPct = pctOf(cur.healthy || 0, cur.records || 0)
  const incLoad = Math.max(0, 100 - (k.critical_open || 0) * 25 - (k.overdue || 0) * 10 - Math.max(0, (k.open || 0) - (k.critical_open || 0)) * 3)
  const score = coverage == null && healthyPct == null ? null : Math.round((coverage ?? 0) * 0.3 + (healthyPct ?? 0) * 0.4 + incLoad * 0.3)
  const label = score == null ? 'No data' : score >= 85 ? 'Stable' : score >= 65 ? 'Watch' : 'At risk'
  const color = score == null ? MUTED : score >= 85 ? GOOD : score >= 65 ? WARN : BAD
  return { series, cur, prev, k, coverage, healthyPct, score, label, color }
}
const mins = (m: number | null | undefined) => m == null ? '—' : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} d`
function dayOf(g: any, date: string) {
  const start = g.hypercare_start || g.go_live_date, end = g.hypercare_planned_end
  if (!start) return null
  const n = Math.round((new Date(date).getTime() - new Date(start).getTime()) / 86400000) + 1
  const total = end ? Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1 : null
  return { n, total, left: total != null ? total - n : null, start, end }
}

function overviewText(ov: any, g: any): string[] {
  const x = overviewNumbers(ov)
  const t = dayOf(g, ov.date)
  const crit: any[] = ov.readiness?.criteria || []
  const L = [
    `Health index: ${x.score ?? '—'} (${x.label})${t ? ` · Hypercare day ${t.n}${t.total ? ` of ${t.total}` : ''}` : ''}${crit.length ? ` · Exit criteria ${crit.filter(c => c.met).length}/${crit.length} met` : ''}`,
    `Coverage ${x.coverage ?? '—'}% · Healthy ${x.healthyPct ?? '—'}% · Open incidents ${x.k.open ?? 0} (${x.k.high_open ?? 0} P1/P2) · Overdue ${x.k.overdue ?? 0} · MTTA ${mins(x.k.mtta)} · MTTR ${mins(x.k.mttr)}`,
  ]
  for (const r of ov.sites || []) L.push(`Site ${r.site}: ${r.checked}/${r.devices} checked · ${r.healthy} healthy · ${r.attention} attention · ${r.open} open incidents`)
  L.push('')
  return L
}
