// Alert-rule emails (STEP231): check-in reminder, check-in list (manager's
// team or organisation-wide summary), overdue work (a person's own list),
// overdue summary (manager's team or organisation-wide). Every rule can
// override the subject and add its own message. Same design system as the
// scheduled reports (reportDesign.ts).

import type { Org, Rendered } from './emailTemplates.ts'
import { esc, link, fmtDate, shortDate, shell, previewBanner, section, para, bold, table, chip, button, plural, BAD, WARN, MUTED, FAINT, INK, type Theme } from './reportDesign.ts'

const ATTEND: Theme = { key: 'checkin', label: 'Attendance', band: '#92400e', ink: '#fde68a', soft: '#fffbeb', accent: '#d97706' }
const OVERDUE: Theme = { key: 'overdue', label: 'Overdue work', band: '#991b1b', ink: '#fecaca', soft: '#fef2f2', accent: '#dc2626' }
const REASON = "You're receiving this automatic alert because of an alert rule set up by your organisation."

const time12 = (hhmm: string) => { const [h, m] = String(hhmm || '10:30').split(':').map(Number); return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString('en-IN', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }) }
const first = (n?: string | null) => (n || '').trim().split(/\s+/)[0] || 'there'
// A rule's own message, shown above the standard content (plain text, line breaks kept).
const customMessage = (d: any, t: Theme) => d.message
  ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;border-radius:10px;border-left:4px solid ${t.accent};background:${t.soft}"><tr><td style="padding:12px 14px;font-size:13.5px;line-height:1.6;color:#334155">${esc(d.message).replace(/\n/g, '<br>')}</td></tr></table>` : ''
const previewNote = (d: any, who?: string) => previewBanner(d, who ? `This is the version ${who} would get.` : '')
const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] != null ? String(vars[k]) : `{${k}}`)

/* ── To the person who hasn't checked in ── */
export function checkinReminderEmail(org: Org, d: any, toName: string | null): Rendered {
  const name = d.for_name || toName
  const day = fmtDate(d.date, org.timezone, { weekday: 'long', day: '2-digit', month: 'short' })
  const vars = { name: first(name), date: shortDate(d.date, org.timezone), time: time12(d.cutoff) }
  const body = `${previewNote(d, d.preview ? name : '')}
    ${para(`Hi ${esc(first(name))},`)}
    ${customMessage(d, ATTEND)}
    ${para(`We haven't seen a check-in from you today (${esc(day)}). The check-in time is <b>${esc(time12(d.cutoff))}</b>.`)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;border-radius:10px;background:${ATTEND.soft}"><tr><td style="padding:14px 16px;font-size:13.5px;line-height:1.65;color:#78350f">
      <b>Working today?</b> Check in now so your hours are recorded.<br>
      <b>On leave or working elsewhere?</b> Apply for leave or let your manager know. Approved leave stops these reminders.
    </td></tr></table>
    ${button(ATTEND, 'Check in now', link(org, '/resources'))}`
  return {
    subject: d.subject ? fill(d.subject, vars) : `Reminder: you haven't checked in today (${vars.date})`,
    html: shell(org, ATTEND, { eyebrow: 'Attendance reminder', title: "You haven't checked in yet", subtitle: `${day} · check-in by ${vars.time}`, preheader: 'No check-in recorded today. Check in now so your hours are counted.', body, reason: REASON }),
    text: `Hi ${first(name)},\n\n${d.message ? d.message + '\n\n' : ''}We haven't seen a check-in from you today (${day}). Check-in time is ${vars.time}.\nCheck in now: ${link(org, '/resources')}\n`,
  }
}

/* ── Check-in list: a manager's team, or an organisation-wide summary ── */
export function checkinManagerEmail(org: Org, d: any, toName: string | null): Rendered {
  const people: { name: string; email?: string; manager?: string }[] = d.people || []
  const org_ = d.scope === 'organisation'
  const day = fmtDate(d.date, org.timezone, { weekday: 'long', day: '2-digit', month: 'short' })
  const vars = { name: first(toName), date: shortDate(d.date, org.timezone), time: time12(d.cutoff), count: people.length }
  const who = org_ ? 'across the organisation' : 'in your team'
  const body = `${previewNote(d, d.preview && !org_ ? d.for_name : '')}
    ${para(`Hi ${esc(first(org_ ? toName : d.for_name || toName))},`)}
    ${customMessage(d, ATTEND)}
    ${para(people.length
      ? `${bold(plural(people.length, 'person', 'people'))} ${who} ${people.length === 1 ? "hasn't" : "haven't"} checked in by ${esc(vars.time)} today.`
      : `Everyone ${who} has checked in or is on leave.`)}
    ${section(ATTEND, 'Not checked in', day)}
    ${table(org_ ? [['Person', 'left'], ['Manager', 'left'], ['Email', 'left']] : [['Person', 'left'], ['Email', 'left'], ['Status', 'left']],
      people.map(p => org_
        ? [bold(p.name), esc(p.manager || '—'), `<span style="color:${MUTED}">${esc(p.email || '')}</span>`]
        : [bold(p.name), `<span style="color:${MUTED}">${esc(p.email || '')}</span>`, chip('No check-in', WARN)]), 'Everyone has checked in.')}
    <div style="font-size:11.5px;color:${FAINT};margin-top:8px">People on approved leave, on a later shift, or on a holiday aren't included.</div>
    ${button(ATTEND, 'Open check-in report', link(org, '/resources'))}`
  return {
    subject: d.subject ? fill(d.subject, vars) : `${plural(people.length, 'person', 'people')} not checked in by ${vars.time} (${vars.date})`,
    html: shell(org, ATTEND, { eyebrow: org_ ? 'Attendance · organisation' : 'Attendance · your team', title: people.length ? `${plural(people.length, 'person', 'people')} not checked in` : 'Everyone has checked in', subtitle: `${day} · cut-off ${vars.time}`, preheader: people.map(p => p.name).join(', ') || 'Everyone checked in', body, reason: REASON }),
    text: `Not checked in by ${vars.time} on ${day}:\n` + (people.map(p => `- ${p.name}${p.manager ? ` (manager: ${p.manager})` : ''}`).join('\n') || '- nobody') + '\n',
  }
}

/* ── A person's own overdue work ── */
const kindChip = (k: string) => chip(k, k === 'Task' ? '#2563eb' : '#7c3aed')
const prio = (p: string) => p && /critical|urgent|high/i.test(p) ? `<b style="color:${BAD};text-transform:capitalize">${esc(p)}</b>` : `<span style="color:${MUTED};text-transform:capitalize">${esc(p || '—')}</span>`
const lateCell = (days: any) => `<b style="color:${(Number(days) || 0) > 7 ? BAD : WARN}">${plural(Number(days) || 0, 'day')}</b>`
const itemCell = (x: any) => `${x.code ? `<span style="font-family:Consolas,Menlo,monospace;font-size:11px;color:${FAINT}">${esc(x.code)}</span> ` : ''}<b style="color:${INK};font-weight:600">${esc(x.title)}</b><div style="font-size:11.5px;color:${FAINT}">${[x.project, String(x.status || '').replace(/_/g, ' ')].filter(Boolean).map(esc).join(' · ')}</div>`

export function overdueDigestEmail(org: Org, d: any, toName: string | null): Rendered {
  const name = d.for_name || toName
  const items: any[] = d.items || []
  const n = d.count ?? items.length
  const worst = items.reduce((m, x) => Math.max(m, Number(x.days) || 0), 0)
  const vars = { name: first(name), count: n, oldest: worst, date: shortDate(d.date, org.timezone) }
  const body = `${previewNote(d, d.preview ? name : '')}
    ${para(`Hi ${esc(first(name))},`)}
    ${customMessage(d, OVERDUE)}
    ${para(`You have ${bold(plural(n, 'overdue item'))}${worst ? `, the oldest ${bold(plural(worst, 'day'))} late` : ''}. Please update or close them, or agree a new date with your manager.`)}
    ${section(OVERDUE, 'Overdue', d.min_days > 1 ? `${d.min_days}+ days overdue · most overdue first` : 'Most overdue first')}
    ${table([['Item', 'left'], ['Type', 'left'], ['Priority', 'left'], ['Was due'], ['Late']],
      items.map(x => [itemCell(x), kindChip(x.kind), prio(x.priority), x.due ? shortDate(x.due, org.timezone) : '—', lateCell(x.days)]), 'Nothing overdue.')}
    ${n > items.length ? `<div style="font-size:12px;color:${FAINT};margin-top:6px">Showing ${items.length} of ${n}.</div>` : ''}
    ${button(OVERDUE, 'Open my work', link(org, '/my-work'))}`
  return {
    subject: d.subject ? fill(d.subject, vars) : `You have ${plural(n, 'overdue item')}${worst ? ` (oldest ${plural(worst, 'day')})` : ''}`,
    html: shell(org, OVERDUE, { eyebrow: d.rule_name || 'Overdue work', title: plural(n, 'overdue item'), subtitle: fmtDate(d.date, org.timezone, { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' }), preheader: items.slice(0, 3).map(x => x.title).join(' · '), body, reason: REASON }),
    text: `You have ${plural(n, 'overdue item')}:\n` + items.map(x => `- [${x.kind}] ${x.code ? x.code + ' ' : ''}${x.title} — due ${x.due}, ${x.days} days late`).join('\n') + `\n\nOpen: ${link(org, '/my-work')}\n`,
  }
}

/* ── Overdue summary: a manager's team, or organisation-wide ── */
export function overdueManagerEmail(org: Org, d: any, toName: string | null): Rendered {
  const people: any[] = d.people || []
  const org_ = d.scope === 'organisation'
  const total = people.reduce((s, p) => s + (Number(p.count) || 0), 0)
  const vars = { name: first(toName), count: total, people: people.length, date: shortDate(d.date, org.timezone) }
  const detail = people.map(p => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;border:1px solid #e2e8f0;border-radius:10px"><tr><td style="padding:12px 14px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td><b style="font-size:14px;color:${INK}">${esc(p.name)}</b>${org_ && p.manager ? ` <span style="font-size:12px;color:${FAINT}">· manager ${esc(p.manager)}</span>` : ''}</td>
        <td align="right" style="font-size:12.5px;color:${MUTED}">${plural(p.count, 'item')} · oldest ${lateCell(p.oldest)}</td></tr></table>
      <ul style="margin:6px 0 0;padding-left:18px">${(p.items || []).map((x: any) => `<li style="font-size:12.5px;line-height:1.7;color:#334155">${esc(x.title)} <span style="color:${FAINT}">· ${esc(x.kind)} · ${plural(Number(x.days) || 0, 'day')} late</span></li>`).join('')}
        ${p.count > (p.items || []).length ? `<li style="list-style:none;font-size:12px;color:${FAINT}">+${p.count - p.items.length} more</li>` : ''}</ul>
    </td></tr></table>`).join('')
  const body = `${previewNote(d, d.preview && !org_ ? d.for_name : '')}
    ${para(`Hi ${esc(first(org_ ? toName : d.for_name || toName))},`)}
    ${customMessage(d, OVERDUE)}
    ${para(people.length ? `${bold(plural(people.length, 'person', 'people'))} ${org_ ? 'across the organisation' : 'in your team'} ${people.length === 1 ? 'has' : 'have'} ${bold(plural(total, 'overdue item'))}.` : 'Nobody has overdue work.')}
    ${section(OVERDUE, 'By person', 'Most overdue items first')}
    ${detail || '<div style="font-size:13px;color:#94a3b8">Nothing overdue.</div>'}
    ${button(OVERDUE, 'Open tasks', link(org, '/tasks'))}`
  return {
    subject: d.subject ? fill(d.subject, vars) : `${org_ ? 'Overdue work' : 'Your team'}: ${plural(total, 'overdue item')} across ${plural(people.length, 'person', 'people')}`,
    html: shell(org, OVERDUE, { eyebrow: org_ ? 'Overdue work · organisation' : 'Overdue work · your team', title: `${plural(total, 'overdue item')}`, subtitle: `${fmtDate(d.date, org.timezone, { weekday: 'long', day: '2-digit', month: 'short' })} · ${plural(people.length, 'person', 'people')}`, preheader: people.slice(0, 4).map(p => `${p.name} (${p.count})`).join(', '), body, reason: REASON }),
    text: `Overdue work — ${vars.date}\n` + people.map(p => `- ${p.name}: ${p.count} items, oldest ${p.oldest} days`).join('\n') + '\n',
  }
}
