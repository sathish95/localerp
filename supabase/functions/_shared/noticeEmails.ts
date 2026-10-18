// Announcement emails (maintenance / new update / general notice) and
// event-rule emails (STEP233). Same design system as the reports and alerts
// (reportDesign.ts). Platform-wide notices carry payload.platform and are sent
// under the platform's name rather than the recipient organisation's.

import type { Org, Rendered } from './emailTemplates.ts'
import { esc, link, fmtDate, shell, previewBanner, section, para, bold, table, button, plural, INK, MUTED, FAINT, BODY, type Theme } from './reportDesign.ts'

const THEME: Record<string, Theme> = {
  maintenance: { key: 'maintenance', label: 'Scheduled maintenance', band: '#78350f', ink: '#fde68a', soft: '#fffbeb', accent: '#d97706' },
  update:      { key: 'update', label: 'Product update', band: '#0c4a6e', ink: '#bae6fd', soft: '#f0f9ff', accent: '#0284c7' },
  general:     { key: 'general', label: 'Announcement', band: '#1f2937', ink: '#c7d2fe', soft: '#f5f7ff', accent: '#4f46e5' },
}
const EVENT: Theme = { key: 'event', label: 'Update', band: '#312e81', ink: '#c7d2fe', soft: '#eef2ff', accent: '#4f46e5' }

const first = (n?: string | null) => (n || '').trim().split(/\s+/)[0] || 'there'
const human = (s: unknown) => String(s ?? '').replace(/_/g, ' ').trim()
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const multiline = (s: string) => esc(s).replace(/\n/g, '<br>')
const when = (iso: string, tz: string) => fmtDate(iso, tz, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
function duration(a: string, b: string) {
  const m = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)
  if (!(m > 0)) return ''
  const h = Math.floor(m / 60), r = m % 60
  return [h && plural(h, 'hour'), r && plural(r, 'minute')].filter(Boolean).join(' ')
}
function untilText(iso: string) {
  const m = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000))
  return m >= 90 ? `in about ${plural(Math.round(m / 60), 'hour')}` : m > 1 ? `in ${m} minutes` : 'shortly'
}
const card = (t: Theme, html: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 14px;border-radius:10px;background:${t.soft}"><tr><td style="padding:14px 16px">${html}</td></tr></table>`
const kv = (rows: [string, string][]) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows.map(([k, v]) => `<tr>
  <td width="32%" valign="top" style="padding:5px 10px 5px 0;font-size:12.5px;color:${MUTED};white-space:nowrap">${esc(k)}</td>
  <td style="padding:5px 0;font-size:13.5px;color:${INK};font-weight:600">${v}</td></tr>`).join('')}</table>`

/* ── Announcement: maintenance / update / general ── */
export function announcementEmail(org: Org, d: any, toName: string | null): Rendered {
  const kind = THEME[d.kind] ? d.kind : 'general'
  const t = THEME[kind]
  const tz = org.timezone
  const sender = d.platform ? 'ThingsAlive NeoX' : org.orgName
  const reason = d.platform
    ? "You're receiving this service notice because you have an account on ThingsAlive NeoX."
    : `You're receiving this because ${org.orgName} sent an announcement to its team.`
  const parts: string[] = [previewBanner(d, 'Only you received this copy.'), para(`Hi ${esc(first(toName))},`)]
  let title = d.title, subtitle = '', subject = d.title, preheader = d.message || d.title

  if (kind === 'maintenance') {
    const dur = d.starts_at && d.ends_at ? duration(d.starts_at, d.ends_at) : ''
    if (d.reminder && d.starts_at) {
      title = `Maintenance starts ${untilText(d.starts_at)}`
      subject = `Reminder: ${d.title} starts ${untilText(d.starts_at)}`
      parts.push(para(`A reminder that ${bold(d.title)} starts ${esc(untilText(d.starts_at))}. Please save your work before then.`))
    } else {
      subject = `Scheduled maintenance: ${d.title}${d.starts_at ? ` · ${fmtDate(d.starts_at, tz, { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}`
    }
    subtitle = d.starts_at ? `${when(d.starts_at, tz)}${dur ? ` · ${dur}` : ''}` : 'Scheduled maintenance'
    if (d.message) parts.push(para(multiline(d.message)))
    parts.push(section(t, 'Maintenance window', `Times shown in ${tz}`))
    parts.push(card(t, kv([
      ...(d.starts_at ? [['Starts', esc(when(d.starts_at, tz))] as [string, string]] : []),
      ...(d.ends_at ? [['Expected to end', esc(when(d.ends_at, tz))] as [string, string]] : []),
      ...(dur ? [['Duration', esc(dur)] as [string, string]] : []),
      ['What to expect', esc(d.impact || 'The app may be unavailable for part of this time.')],
    ])))
    parts.push(`<div style="font-size:12.5px;line-height:1.6;color:${MUTED}">Save any open forms before the window starts. Anything you submit during maintenance may need to be entered again.</div>`)
    preheader = `${d.impact || 'Maintenance'} · ${subtitle}`
  } else if (kind === 'update') {
    const items: { title?: string; description?: string }[] = (d.items || []).filter((x: any) => x && (x.title || x.description))
    subject = `What's new${d.version ? ` in ${d.version}` : ''}: ${d.title}`
    subtitle = d.version ? `Version ${d.version}` : (d.platform ? 'ThingsAlive NeoX' : org.orgName)
    if (d.message) parts.push(para(multiline(d.message)))
    if (items.length) {
      parts.push(section(t, "What's new", plural(items.length, 'change')))
      parts.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items.map(x => `<tr>
        <td width="22" valign="top" style="padding:8px 0;font-size:14px;color:${t.accent};font-weight:700">•</td>
        <td style="padding:8px 0;border-bottom:1px solid #eef2f6">
          ${x.title ? `<div style="font-size:14px;font-weight:700;color:${INK}">${esc(x.title)}</div>` : ''}
          ${x.description ? `<div style="font-size:13px;line-height:1.55;color:${BODY};margin-top:2px">${multiline(x.description)}</div>` : ''}
        </td></tr>`).join('')}</table>`)
    }
    preheader = items.map(x => x.title).filter(Boolean).slice(0, 3).join(' · ') || d.message || d.title
  } else {
    subtitle = d.platform ? 'ThingsAlive NeoX' : org.orgName
    if (d.message) parts.push(card(t, `<div style="font-size:14px;line-height:1.7;color:${BODY}">${multiline(d.message)}</div>`))
  }
  if (d.cta_url) parts.push(button(t, d.cta_label || 'Learn more', link(org, d.cta_url)))
  parts.push(`<div style="font-size:12.5px;color:${FAINT};margin-top:18px">— ${esc(sender)}</div>`)

  const text = [
    `Hi ${first(toName)},`, '',
    title, subtitle, '',
    d.message || '',
    d.starts_at ? `Starts: ${when(d.starts_at, tz)}` : '', d.ends_at ? `Ends: ${when(d.ends_at, tz)}` : '', d.impact ? `Impact: ${d.impact}` : '',
    ...((d.items || []).map((x: any) => x?.title || x?.description ? `- ${x.title || ''}${x.description ? `: ${x.description}` : ''}` : '')),
    d.cta_url ? `\n${d.cta_label || 'Learn more'}: ${link(org, d.cta_url)}` : '', '', `— ${sender}`,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n')

  return {
    subject: (d.preview ? '[Preview] ' : '') + subject,
    html: shell(org, t, { eyebrow: d.reminder ? 'Maintenance reminder' : t.label, title, subtitle, preheader: String(preheader).slice(0, 140), body: parts.join('\n'), reason }),
    text,
  }
}

/* ── Event rule ("When a task is created, email the assignee") ── */
function eventVars(d: any, toName: string | null): Record<string, string> {
  const rec = d.record || {}
  const v: Record<string, string> = {}
  for (const [k, x] of Object.entries(rec)) if (x != null && typeof x !== 'object') v[k] = String(x)
  return Object.assign(v, {
    name: first(toName), recipient: toName || '', record: d.label || 'Record', rule: d.rule_name || '',
    title: d.title || '', code: d.code || '', status: human(d.status), old_status: human(d.old_status),
    amount: d.amount != null && d.amount !== '' ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(d.amount)) : '',
    due: d.due ? String(d.due).slice(0, 10) : '', actor: d.actor || 'Someone',
  })
}
export const fillEvent = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')

export function eventEmail(org: Org, d: any, toName: string | null): Rendered {
  const vars = eventVars(d, toName)
  const label = d.label || 'Record'
  const ref = [d.code, d.title].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' · ') || label
  const what = d.event === 'status_changed' ? `moved to ${human(d.status) || 'a new status'}` : d.op === 'INSERT' ? 'was created' : 'was updated'
  const defaultSubject = `${label} ${what}: ${ref}`
  const subject = (d.preview ? '[Test] ' : '') + (d.subject ? fillEvent(d.subject, vars) : cap(defaultSubject))
  const statusCell = d.event === 'status_changed' && d.old_status
    ? `<span style="color:${FAINT};text-decoration:line-through;font-weight:500">${esc(human(d.old_status))}</span> &rarr; ${esc(human(d.status))}`
    : esc(human(d.status) || '—')
  const rows: [string, string][] = [
    [label, esc(ref)],
    ['Status', statusCell],
    ...(vars.amount ? [['Amount', esc(vars.amount)] as [string, string]] : []),
    ...(vars.due ? [['Due', esc(fmtDate(vars.due, org.timezone))] as [string, string]] : []),
    ...(d.actor ? [[d.op === 'INSERT' ? 'Created by' : 'Changed by', esc(d.actor)] as [string, string]] : []),
  ]
  const body = `${previewBanner(d, 'This is a test using your most recent record. Only you received it.')}
    ${para(`Hi ${esc(vars.name)},`)}
    ${d.message
      ? para(multiline(fillEvent(d.message, vars)))
      : para(`${esc(label)} ${bold(ref)} ${esc(what)}${d.actor ? ` by ${esc(d.actor)}` : ''}.`)}
    ${card(EVENT, kv(rows))}
    ${button(EVENT, `Open ${label.toLowerCase()}`, link(org, d.link))}`
  return {
    subject,
    html: shell(org, { ...EVENT, label }, { eyebrow: d.rule_name || label, title: cap(`${label} ${what}`), subtitle: ref, preheader: `${ref} · ${human(d.status)}`, body,
      reason: `You're receiving this because of the "${d.rule_name || 'email'}" event rule set up by ${org.orgName}.` }),
    text: `Hi ${vars.name},\n\n${d.message ? fillEvent(d.message, vars) : `${label} ${ref} ${what}.`}\n\n` + rows.map(([k, v]) => `${k}: ${v.replace(/<[^>]+>/g, '').replace(/&rarr;/g, '→')}`).join('\n') + `\n\nOpen: ${link(org, d.link)}\n`,
  }
}
