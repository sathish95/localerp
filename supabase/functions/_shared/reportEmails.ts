// All scheduled report emails (STEP230 scorecard design). Each takes
// (org, payload, data) and returns { subject, html, text }. Data shapes come
// from teamPerformanceCore / reportsCore / audienceCore / planningCore; the
// worker (send-email) passes the current period plus the previous one so
// headline numbers can show ▲▼ trends.

import type { Org, Rendered } from './emailTemplates.ts'
import { delta } from './audienceCore.js'
import {
  THEMES, esc, link, fmtDate, shortDate, range, inr, inrShort, pc, hrs, plural, minutesToTime,
  shell, previewBanner, tiles, section, note, para, bold, bars, meter, table, healthPill, healthLabel, chip,
  bullets, twoCol, button, flagChips, PLAN_LABEL, GOOD, BAD, WARN, MUTED, FAINT, INK, type Tile,
} from './reportDesign.ts'

const periodWord = (p: string) => p === 'daily' ? 'Daily' : p === 'weekly' ? 'Weekly' : 'Monthly'
const up = (cur: any, prev: any, kind: 'abs' | 'pct' | 'pts' = 'abs', goodWhenUp = true) => delta(cur ?? null, prev ?? null, { kind, goodWhenUp })
const txt = (html: string) => html.replace(/<[^>]+>/g, '')
const dates = (a: string, b: string, tz: string) => a === b ? shortDate(a, tz) : `${shortDate(a, tz)} – ${shortDate(b, tz)}`

/* ═════════ Team performance ═════════ */
export function teamPerformanceReport(org: Org, d: any, { cur, prev }: any): Rendered {
  const t = THEMES.team_performance, k = cur.totals, p = prev?.totals || {}
  const people = [...cur.rows].sort((a: any, b: any) => b.flags.length - a.flags.length || a.name.localeCompare(b.name))
  const body = `${previewBanner(d)}
    ${tiles([
      { label: 'Attendance', value: pc(k.attendancePct), trend: up(k.attendancePct, p.attendancePct, 'pts'), sub: `${k.present} of ${k.people} checked in` },
      { label: 'Logged to tasks', value: pc(k.loggingPct), trend: up(k.loggingPct, p.loggingPct, 'pts'), sub: `${hrs(k.taskHours)} of ${hrs(k.attendance)}` },
      { label: 'Completed', value: String(k.completed), trend: up(k.completed, p.completed), sub: `On time ${pc(k.onTimePct)}` },
      { label: 'Capacity used', value: pc(k.utilizationPct), trend: up(k.utilizationPct, p.utilizationPct, 'pts'), sub: `of ${hrs(k.capacity)}` },
      { label: 'Estimate accuracy', value: pc(k.estimateAccuracy), sub: 'Estimated ÷ actual hours' },
      { label: 'Need attention', value: String(k.flagged), trend: up(k.flagged, p.flagged, 'abs', false), sub: plural(k.overdue, 'overdue task') },
    ], t)}
    ${section(t, 'Attendance by person', 'Checked-in hours as a share of capacity')}
    ${bars(people.map((r: any) => ({ label: r.name, value: r.attendancePct ?? 0, display: pc(r.attendancePct), color: (r.attendancePct ?? 0) < 75 ? '#f59e0b' : t.accent, sub: `${hrs(r.attendance)} · logged ${pc(r.loggingPct)}` })), t, 100)}
    ${section(t, 'Details')}
    ${table([['Person', 'left'], ['Task time'], ['Done'], ['Overdue'], ['Attention', 'left']],
      people.map((r: any) => [bold(r.name), hrs(r.taskHours), String(r.completed), r.overdue ? `<b style="color:${BAD}">${r.overdue}</b>` : '0', flagChips(r.flags)]))}
    ${button(t, 'Open Team performance', link(org, `/daily-status?period=${d.period}&date=${d.as_of}&tab=team`))}`
  const title = `${periodWord(d.period)} team performance${cur.departmentName ? ` — ${cur.departmentName}` : ''}`
  return {
    subject: `${d.name || title}: ${range(org, cur.from, cur.to)}`,
    html: shell(org, t, { title, subtitle: `${range(org, cur.from, cur.to)} · ${plural(cur.days.length, 'working day')}`, preheader: `Attendance ${pc(k.attendancePct)} · logged ${pc(k.loggingPct)} · ${k.completed} completed`, body }),
    text: `${title} — ${range(org, cur.from, cur.to)}\nAttendance ${pc(k.attendancePct)} | Logged ${pc(k.loggingPct)} | Completed ${k.completed} | Need attention ${k.flagged}\n\n`
      + people.map((r: any) => `${r.name}: attendance ${pc(r.attendancePct)}, task ${hrs(r.taskHours)}, done ${r.completed}, overdue ${r.overdue}`).join('\n') + '\n',
  }
}

/* ═════════ Project status ═════════ */
function projectCard(org: Org, t: any, r: any) {
  const tz = org.timezone
  const li = (items: any[], f: (x: any) => string, cap = 6) => items.length ? `<ul style="margin:4px 0 0;padding-left:18px">${items.slice(0, cap).map(x => `<li style="font-size:12.5px;line-height:1.7;color:#334155">${f(x)}</li>`).join('')}${items.length > cap ? `<li style="list-style:none;font-size:12px;color:${FAINT}">+${items.length - cap} more</li>` : ''}</ul>` : ''
  const who = (x: any) => x.who ? ` <span style="color:${FAINT}">· ${esc(x.who)}</span>` : ''
  const ms = [...r.milestonesOverdue.map((m: any) => `${esc(m.title)} <span style="color:${BAD}">overdue since ${shortDate(m.due, tz)}</span>`),
    ...r.milestonesCompleted.map((m: any) => `${esc(m.title)} <span style="color:${GOOD}">completed ${shortDate(m.on, tz)}</span>`),
    ...r.milestonesUpcoming.map((m: any) => `${esc(m.title)} <span style="color:${FAINT}">due ${shortDate(m.due, tz)}</span>`)]
  const stat = (label: string, value: string, sub: string, m = '') => `<td width="25%" valign="top" style="padding-right:10px"><div style="font-size:11px;font-weight:600;color:${MUTED};text-transform:uppercase;letter-spacing:.04em">${label}</div><div style="font-size:18px;font-weight:800;color:${INK};margin-top:2px">${value}</div>${m}<div style="font-size:11px;color:${FAINT};margin-top:2px">${esc(sub)}</div></td>`
  const heading = (s: string, c = MUTED) => `<div style="font-size:11px;font-weight:700;color:${c};text-transform:uppercase;letter-spacing:.04em;margin-top:12px">${s}</div>`
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;border:1px solid #e2e8f0;border-radius:10px;border-left:4px solid ${r.health === 'off_track' ? BAD : r.health === 'at_risk' ? '#f59e0b' : GOOD}"><tr><td style="padding:14px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><div style="font-size:15px;font-weight:700;color:${INK}">${esc(r.name)} ${r.code ? `<span style="font-size:11.5px;font-weight:500;color:${FAINT}">${esc(r.code)}</span>` : ''}</div>
        <div style="font-size:12px;color:${MUTED};margin-top:2px">${[r.client, r.manager ? `PM ${r.manager}` : null, r.end ? `ends ${shortDate(r.end, tz)}` : null].filter(Boolean).map(esc).join(' · ')}</div></td>
      <td align="right" valign="top">${healthPill(r.health)}</td></tr></table>
    ${r.reasons.length ? `<div style="font-size:12.5px;margin-top:8px;color:${r.health === 'off_track' ? BAD : '#92400e'}">${r.reasons.map(esc).join(' · ')}</div>` : ''}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px"><tr>
      ${stat('Progress', pc(r.progressPct), `${r.doneTasks}/${r.totalTasks} tasks`, meter(r.progressPct, t.accent))}
      ${stat('Budget', pc(r.budgetPct), r.budget ? `${inrShort(r.spent)} of ${inrShort(r.budget)}` : 'No budget', meter(r.budgetPct, '#0ea5e9'))}
      ${stat('Done', String(r.completedCount), `${hrs(r.hours)} logged`)}
      ${stat('Overdue', String(r.overdueCount), `${r.openTasks} open`)}
    </tr></table>
    ${ms.length ? heading('Milestones') + li(ms, x => x) : ''}
    ${r.overdue.length ? heading(`Overdue (${r.overdue.length})`, BAD) + li(r.overdue, x => `${esc(x.name)} <span style="color:${BAD}">· ${shortDate(x.due, tz)}</span>${who(x)}`) : ''}
    ${r.completed.length ? heading(`Completed (${r.completed.length})`, GOOD) + li(r.completed, x => `${esc(x.name)}${who(x)}`) : ''}
    ${r.dueSoon.length ? heading(`Next 7 days (${r.dueSoon.length})`) + li(r.dueSoon, x => `${esc(x.name)} <span style="color:${FAINT}">· ${shortDate(x.due, tz)}</span>${who(x)}`) : ''}
  </td></tr></table>`
}
export function projectStatusReport(org: Org, d: any, { cur, prev }: any): Rendered {
  const t = THEMES.project_status, k = cur.totals, p = prev?.totals || {}
  const single = cur.rows.length === 1 && !!d.project_id
  const title = single ? cur.rows[0].name : `${periodWord(d.period)} project status`
  const body = `${previewBanner(d)}
    ${tiles([
      { label: 'On track', value: `${k.onTrack}/${k.projects}`, sub: `${k.atRisk} at risk · ${k.offTrack} off track` },
      { label: 'Tasks completed', value: String(k.completed), trend: up(k.completed, p.completed), sub: `${hrs(k.hours)} logged` },
      { label: 'Overdue', value: String(k.overdue), sub: plural(k.milestonesOverdue, 'overdue milestone') },
    ], t)}
    ${single ? '' : section(t, 'Portfolio', 'Budget used across active projects') + bars(cur.rows.map((r: any) => ({
      label: r.name, value: r.budgetPct ?? 0, display: r.budgetPct == null ? 'no budget' : pc(r.budgetPct), sub: `${healthLabel(r.health)} · progress ${pc(r.progressPct)}`,
      color: r.health === 'off_track' ? BAD : r.health === 'at_risk' ? '#f59e0b' : t.accent })), t, Math.max(100, ...cur.rows.map((r: any) => r.budgetPct ?? 0)))}
    ${section(t, single ? 'Status' : 'By project', 'Off-track first')}
    ${cur.rows.map((r: any) => projectCard(org, t, r)).join('') || note('No active projects.')}
    <div style="font-size:11.5px;color:${FAINT};margin-top:6px">Off track: over budget, milestone overdue, past end date, or 30%+ of 5+ open tasks overdue. At risk: any overdue task, budget 15+ pts ahead of time elapsed, or progress 20+ pts behind.</div>
    ${button(t, 'Open projects', link(org, '/projects'))}`
  return {
    subject: `${d.name || title}: ${range(org, cur.from, cur.to)}`,
    html: shell(org, t, { eyebrow: single ? 'Project status' : undefined, title, subtitle: `${range(org, cur.from, cur.to)} · ${plural(k.projects, 'project')}`, preheader: `${k.onTrack}/${k.projects} on track · ${k.completed} done · ${k.overdue} overdue`, body }),
    text: `${title} — ${range(org, cur.from, cur.to)}\n\n` + cur.rows.map((r: any) => `${r.name}: ${healthLabel(r.health)}${r.reasons.length ? ` (${r.reasons.join('; ')})` : ''}, progress ${pc(r.progressPct)}, budget ${pc(r.budgetPct)}, done ${r.completedCount}, overdue ${r.overdueCount}`).join('\n') + '\n',
  }
}

/* ═════════ Financial ═════════ */
function financeBlocks(org: Org, t: any, f: any, prev: any, compact = false) {
  const k = f.totals, p = prev?.totals || {}, ag = f.receivableAging
  const head = tiles([
    { label: 'Received', value: inrShort(k.received), trend: up(k.received, p.received, 'pct'), sub: plural(k.receivedCount, 'payment') },
    { label: 'Invoiced', value: inrShort(k.invoiced), trend: up(k.invoiced, p.invoiced, 'pct'), sub: plural(k.invoicedCount, 'invoice') },
    { label: 'Spent', value: inrShort(k.moneyOut), trend: up(k.moneyOut, p.moneyOut, 'pct', false), sub: `Expenses ${inrShort(k.expenses)}` },
    { label: 'Outstanding', value: inrShort(k.outstanding), sub: `${inrShort(k.overdueReceivable)} overdue` },
    { label: 'Awaiting approval', value: inrShort(k.pendingApproval), sub: plural(k.pendingCount, 'claim') },
    { label: 'Not yet invoiced', value: inrShort(k.unbilled), sub: plural(k.unbilledCount, 'milestone') },
  ], t)
  const projects = section(t, 'Budget by project', 'Recorded spend ÷ budget · margin from the latest profit calculation') + table(
    [['Project', 'left'], ['Budget'], ['Spent'], ['Used'], ['Margin']],
    f.projects.map((r: any) => [bold(r.name), inrShort(r.budget || null), inrShort(r.spent),
      r.budgetPct == null ? '—' : `<b style="color:${r.budgetPct > 100 ? BAD : INK}">${r.budgetPct}%</b>${meter(r.budgetPct, t.accent)}`,
      r.marginPct == null ? '—' : `<b style="color:${r.marginPct < 0 ? BAD : GOOD}">${r.marginPct}%</b>`]), 'No active projects.')
  if (f.isEmpty) return head + note('No expenses, bills, purchase orders or customer invoices recorded yet — these figures fill in as they are.') + projects
  if (compact) return head + projects
  const agingRows = [['Not yet due', ag.current, '#94a3b8'], ['1–30 days', ag.d1_30, '#f59e0b'], ['31–60 days', ag.d31_60, '#f97316'], ['61–90 days', ag.d61_90, '#ef4444'], ['90+ days', ag.d90p, '#b91c1c']]
  return `${head}
    ${twoCol(
      section(t, 'Receivables ageing') + (k.outstandingCount ? bars(agingRows.map(([l, v, c]: any) => ({ label: l, value: v, display: inrShort(v), color: c })), t) : note('No unpaid customer invoices.')),
      section(t, 'Spend by category') + (f.expensesByCategory.length ? bars(f.expensesByCategory.slice(0, 6).map((c: any) => ({ label: c.category, value: c.amount, display: inrShort(c.amount) })), t) : note('No approved expenses in this period.')),
    )}
    ${f.overdueInvoices.length ? section(t, 'Overdue customer invoices') + table([['Invoice', 'left'], ['Customer', 'left'], ['Amount'], ['Days late']],
      f.overdueInvoices.slice(0, 8).map((x: any) => [esc(x.number), esc(x.customer), inr(x.amount), `<b style="color:${BAD}">${x.daysLate}</b>`])) : ''}
    ${f.pendingExpenses.length ? section(t, 'Waiting for approval', 'Largest first') + table([['Claim', 'left'], ['Stage', 'left'], ['Amount']],
      f.pendingExpenses.slice(0, 8).map((e: any) => [`${esc(e.number || '')} ${esc(e.title || '')}`, esc(String(e.status).replace(/_/g, ' ')), inr(e.amount)])) : ''}
    ${f.unbilled.length ? section(t, 'Completed, not yet invoiced') + table([['Project', 'left'], ['Milestone', 'left'], ['Amount']], f.unbilled.map((m: any) => [esc(m.project), esc(m.title), inr(m.amount)])) : ''}
    ${projects}`
}
export function financialReport(org: Org, d: any, { cur, prev }: any): Rendered {
  const t = THEMES.financial, k = cur.totals
  const body = `${previewBanner(d)}${financeBlocks(org, t, cur, prev)}${button(t, 'Open finance', link(org, '/invoices'))}`
  return {
    subject: `${d.name || 'Financial report'}: ${range(org, cur.from, cur.to)}`,
    html: shell(org, t, { title: `${periodWord(d.period)} financial report`, subtitle: range(org, cur.from, cur.to), preheader: `Received ${inrShort(k.received)} · spent ${inrShort(k.moneyOut)} · outstanding ${inrShort(k.outstanding)}`, body, confidential: 'Confidential: contains company financial figures. Please do not forward.' }),
    text: `Financial report — ${range(org, cur.from, cur.to)}\nReceived ${inr(k.received)} | Invoiced ${inr(k.invoiced)} | Spent ${inr(k.moneyOut)} | Outstanding ${inr(k.outstanding)} | Awaiting approval ${inr(k.pendingApproval)}\n`,
  }
}

/* ═════════ Monthly management ═════════ */
function risksAndWins(org: Org, projects: any, finance: any, team: any, sales?: any) {
  const pt = projects.totals, ft = finance.totals, tt = team.totals
  const risks = [
    ...projects.rows.filter((r: any) => r.health === 'off_track').map((r: any) => `${bold(r.name)} is off track — ${esc(r.reasons.join('; '))}`),
    ...(ft.overdueReceivable ? [`${bold(inrShort(ft.overdueReceivable))} of customer invoices overdue (${ft.overdueCount})`] : []),
    ...(ft.pendingApproval ? [`${bold(inrShort(ft.pendingApproval))} of expense claims waiting for approval`] : []),
    ...(tt.flagged ? [`${bold(plural(tt.flagged, 'person', 'people'))} flagged on attendance or task logging`] : []),
    ...(pt.overdue ? [`${bold(plural(pt.overdue, 'overdue task'))} across projects`] : []),
    ...(sales?.totals?.overdueCloses ? [`${bold(plural(sales.totals.overdueCloses, 'deal'))} past its expected close date`] : []),
  ]
  const wins = [
    ...projects.rows.flatMap((r: any) => r.milestonesCompleted.map((m: any) => `Milestone ${bold(m.title)} delivered on ${esc(r.name)}`)),
    ...(sales?.totals?.wonCount ? [`${bold(plural(sales.totals.wonCount, 'deal'))} won worth ${bold(inrShort(sales.totals.wonValue))}`] : []),
    ...(ft.received ? [`${bold(inrShort(ft.received))} received from customers`] : []),
    ...(pt.completed ? [`${bold(plural(pt.completed, 'project task'))} completed`] : []),
    ...(pt.onTrack && pt.projects ? [`${bold(`${pt.onTrack} of ${pt.projects}`)} projects on track`] : []),
  ]
  return { risks, wins }
}
export function monthlyReport(org: Org, d: any, m: any): Rendered {
  const t = THEMES.monthly_summary, tt = m.team.totals, pt = m.projects.totals, ft = m.finance.totals
  const p = m.prev || {}, ptp = p.projects?.totals || {}, ttp = p.team?.totals || {}, ftp = p.finance?.totals || {}
  const month = fmtDate(m.from, org.timezone, { month: 'long', year: 'numeric' })
  const { risks, wins } = risksAndWins(org, m.projects, m.finance, m.team)
  const people = [...m.team.rows].sort((a: any, b: any) => b.flags.length - a.flags.length || a.name.localeCompare(b.name))
  const body = `${previewBanner(d)}
    ${tiles([
      { label: 'Projects on track', value: `${pt.onTrack}/${pt.projects}`, sub: `${pt.offTrack} off track` },
      { label: 'Tasks completed', value: String(pt.completed), trend: up(pt.completed, ptp.completed), sub: `${pt.overdue} overdue` },
      { label: 'Attendance', value: pc(tt.attendancePct), trend: up(tt.attendancePct, ttp.attendancePct, 'pts'), sub: `logged ${pc(tt.loggingPct)}` },
      { label: 'Received', value: inrShort(ft.received), trend: up(ft.received, ftp.received, 'pct'), sub: `invoiced ${inrShort(ft.invoiced)}` },
      { label: 'Spent', value: inrShort(ft.moneyOut), trend: up(ft.moneyOut, ftp.moneyOut, 'pct', false), sub: `${inrShort(ft.pendingApproval)} awaiting approval` },
      { label: 'Outstanding', value: inrShort(ft.outstanding), sub: `${inrShort(ft.overdueReceivable)} overdue` },
    ], t)}
    ${twoCol(section(t, 'Highlights') + bullets(wins.slice(0, 5), 'Nothing recorded this month.', GOOD), section(t, 'Needs attention') + bullets(risks.slice(0, 5), 'Nothing flagged.', BAD))}
    ${section(t, 'Delivery by project')}
    ${table([['Project', 'left'], ['Health', 'left'], ['Progress'], ['Done'], ['Overdue'], ['Budget']],
      m.projects.rows.map((r: any) => [bold(r.name), healthPill(r.health), `${pc(r.progressPct)}${meter(r.progressPct, t.accent)}`, String(r.completedCount), r.overdueCount ? `<b style="color:${BAD}">${r.overdueCount}</b>` : '0', pc(r.budgetPct)]), 'No active projects.')}
    ${section(t, 'People', `${hrs(tt.attendance)} attended of ${hrs(tt.capacity)} capacity · ${hrs(tt.taskHours)} logged to tasks`)}
    ${table([['Person', 'left'], ['Attendance'], ['Logged'], ['Done'], ['Attention', 'left']], people.map((r: any) => [bold(r.name), pc(r.attendancePct), pc(r.loggingPct), String(r.completed), flagChips(r.flags)]))}
    ${section(t, 'Finance')}${financeBlocks(org, THEMES.financial, m.finance, p.finance, true)}
    ${button(t, 'Open dashboard', link(org, '/'))}`
  return {
    subject: `${d.name || 'Monthly management report'}: ${month}`,
    html: shell(org, t, { title: `Management report — ${month}`, subtitle: `${range(org, m.from, m.to)} · ${plural(m.team.days.length, 'working day')}`, preheader: `${pt.onTrack}/${pt.projects} projects on track · received ${inrShort(ft.received)} · ${risks.length} risks`, body, confidential: 'Confidential: contains company financial and staff figures. Please do not forward.' }),
    text: `Management report — ${month}\nProjects on track ${pt.onTrack}/${pt.projects} | Tasks ${pt.completed} | Attendance ${pc(tt.attendancePct)} | Received ${inr(ft.received)} | Spent ${inr(ft.moneyOut)}\n\nNeeds attention:\n${risks.map(r => '- ' + txt(r)).join('\n') || '- nothing'}\n`,
  }
}

/* ═════════ CEO executive briefing ═════════ */
export function ceoReport(org: Org, d: any, m: any): Rendered {
  const t = THEMES.ceo_briefing, tt = m.team.totals, pt = m.projects.totals, ft = m.finance.totals, st = m.sales.totals
  const p = m.prev || {}, ttp = p.team?.totals || {}, ptp = p.projects?.totals || {}, ftp = p.finance?.totals || {}, stp = p.sales?.totals || {}
  const { risks, wins } = risksAndWins(org, m.projects, m.finance, m.team, m.sales)
  const summary = [
    `${bold(`${pt.onTrack} of ${pt.projects}`)} projects on track${pt.offTrack ? `, ${bold(String(pt.offTrack))} off track` : ''}`,
    `${bold(inrShort(ft.received))} received, ${bold(inrShort(ft.moneyOut))} spent`,
    `team attendance ${bold(pc(tt.attendancePct))} with ${bold(pc(tt.loggingPct))} of time logged to tasks`,
  ].join('; ')
  const strip = m.projects.rows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${m.projects.rows.map((r: any) => `<td style="padding:0 6px 6px 0"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-radius:8px;border:1px solid #e2e8f0;border-top:4px solid ${r.health === 'off_track' ? BAD : r.health === 'at_risk' ? '#f59e0b' : GOOD}"><tr><td style="padding:8px 10px">
      <div style="font-size:12.5px;font-weight:700;color:${INK}">${esc(r.name)}</div><div style="font-size:11px;color:${MUTED}">${healthLabel(r.health)} · ${pc(r.progressPct)} done · budget ${pc(r.budgetPct)}</div></td></tr></table></td>`).join('')}</tr></table>` : note('No active projects.')
  const body = `${previewBanner(d)}
    ${para(`<span style="font-size:15px">${summary}.</span>`)}
    ${tiles([
      { label: 'Cash received', value: inrShort(ft.received), trend: up(ft.received, ftp.received, 'pct') },
      { label: 'Spend', value: inrShort(ft.moneyOut), trend: up(ft.moneyOut, ftp.moneyOut, 'pct', false) },
      { label: 'Receivables', value: inrShort(ft.outstanding), sub: `${inrShort(ft.overdueReceivable)} overdue` },
      { label: 'Pipeline', value: inrShort(st.pipeline), sub: `weighted ${inrShort(st.weighted)}` },
      { label: 'Deals won', value: inrShort(st.wonValue), trend: up(st.wonValue, stp.wonValue, 'pct'), sub: plural(st.wonCount, 'deal') },
      { label: 'Headcount', value: String(m.hr.headcount.active), sub: `${m.hr.headcount.joiners} joined this period` },
      { label: 'Attendance', value: pc(tt.attendancePct), trend: up(tt.attendancePct, ttp.attendancePct, 'pts') },
      { label: 'Tasks delivered', value: String(pt.completed), trend: up(pt.completed, ptp.completed) },
      { label: 'On-time', value: pc(tt.onTimePct), trend: up(tt.onTimePct, ttp.onTimePct, 'pts') },
    ], t)}
    ${section(t, 'Project health')}${strip}
    ${twoCol(section(t, 'Top risks') + bullets(risks.slice(0, 3), 'No material risks this period.', BAD), section(t, 'Wins') + bullets(wins.slice(0, 3), 'Nothing recorded this period.', GOOD))}
    ${button(t, 'Open dashboard', link(org, '/'))}`
  const title = `${periodWord(d.period)} executive briefing`
  return {
    subject: `${d.name || title}: ${range(org, m.from, m.to)}`,
    html: shell(org, t, { title, subtitle: range(org, m.from, m.to), preheader: txt(summary), body, confidential: 'Confidential: board-level figures. Please do not forward.' }),
    text: `${title} — ${range(org, m.from, m.to)}\n${txt(summary)}.\n\nTop risks:\n${risks.slice(0, 3).map(r => '- ' + txt(r)).join('\n') || '- none'}\n\nWins:\n${wins.slice(0, 3).map(r => '- ' + txt(r)).join('\n') || '- none'}\n`,
  }
}

/* ═════════ HR people ═════════ */
export function hrReport(org: Org, d: any, m: any): Rendered {
  const t = THEMES.hr_people, h = m.hr, a = h.attendance, tz = org.timezone
  const pa = m.prev?.hr?.attendance || {}, pl = m.prev?.hr?.leave || {}
  const body = `${previewBanner(d)}
    ${tiles([
      { label: 'Headcount', value: String(h.headcount.active), sub: `${h.headcount.joiners} joined this period` },
      { label: 'Attendance', value: pc(a.pct), trend: up(a.pct, pa.pct, 'pts'), sub: `${a.present} of ${a.people} checked in` },
      { label: 'Late arrivals', value: String(a.lateDays), trend: up(a.lateDays, pa.lateDays, 'abs', false), sub: `after ${a.lateAfter} · avg in ${minutesToTime(a.avgFirstIn)}` },
      { label: 'Leave taken', value: `${h.leave.days}d`, trend: up(h.leave.days, pl.days, 'abs', false), sub: `${h.leave.onLeaveToday.length} on leave today` },
      { label: 'Pending leave', value: String(h.leave.pending.length), sub: h.leave.pending.length ? `oldest ${h.leave.pending[0].waitingDays ?? 0}d waiting` : 'none waiting' },
      { label: 'Missed check-outs', value: String(a.missedCheckouts.reduce((s: number, x: any) => s + x.count, 0)), sub: plural(a.missedCheckouts.length, 'person', 'people') },
    ], t)}
    ${twoCol(
      section(t, 'Headcount by department') + bars(h.headcount.byDepartment.map((x: any) => ({ label: x.name, value: x.count })), t),
      section(t, 'Leave taken by type', 'Working days in this period') + (h.leave.byType.length ? bars(h.leave.byType.map((x: any) => ({ label: String(x.type).replace(/_/g, ' '), value: x.days, display: `${x.days}d` })), t) : note('No leave taken.')),
    )}
    ${section(t, 'Attendance watchlist', 'Below 75% of capacity, or frequently late')}
    ${table([['Person', 'left'], ['Attendance'], ['Late days'], ['Missed check-outs']],
      [...new Set([...a.low.map((x: any) => x.name), ...a.latecomers.map((x: any) => x.name), ...a.missedCheckouts.map((x: any) => x.name)])].slice(0, 12).map((name: any) => {
        const low = a.low.find((x: any) => x.name === name), late = a.latecomers.find((x: any) => x.name === name), miss = a.missedCheckouts.find((x: any) => x.name === name)
        const rowPct = low?.pct ?? m.team.rows.find((r: any) => r.name === name)?.attendancePct
        return [bold(name), rowPct == null ? '—' : `<b style="color:${rowPct < 75 ? BAD : INK}">${rowPct}%</b>`, late ? String(late.days) : '0', miss ? `<b style="color:${WARN}">${miss.count}</b>` : '0']
      }), 'Everyone is above 75% attendance, on time and checking out.')}
    ${section(t, 'Leave')}
    ${table([['Person', 'left'], ['Type', 'left'], ['Dates', 'left'], ['Status', 'left']], [
      ...h.leave.onLeaveToday.map((l: any) => [bold(l.name), esc(String(l.type).replace(/_/g, ' ')), `until ${shortDate(l.until, tz)}`, chip('On leave today', MUTED)]),
      ...h.leave.upcoming.map((l: any) => [bold(l.name), esc(String(l.type).replace(/_/g, ' ')), `${dates(l.from, l.to, tz)}`, chip('Upcoming', '#2563eb')]),
      ...h.leave.pending.map((l: any) => [bold(l.name), esc(String(l.type).replace(/_/g, ' ')), `${dates(l.from, l.to, tz)}`, chip(`Awaiting approval · ${l.waitingDays ?? 0}d`, WARN)]),
    ], 'No one on leave, upcoming or pending.')}
    ${h.timesheets.pending.length ? section(t, 'Timesheets awaiting approval') + table([['Person', 'left'], ['Month', 'left'], ['Hours'], ['Stage', 'left']],
      h.timesheets.pending.map((x: any) => [bold(x.name), `${x.month}/${x.year}`, hrs(x.hours), esc(String(x.status).replace(/_/g, ' '))])) : ''}
    ${h.joiners.length || h.anniversaries.length ? twoCol(
      section(t, 'New joiners') + (h.joiners.length ? bullets(h.joiners.map((j: any) => `${bold(j.name)} <span style="color:${FAINT}">${esc([j.designation, j.department].filter(Boolean).join(' · '))} · ${shortDate(j.date, tz)}</span>`), '') : note('None this period.')),
      section(t, 'Work anniversaries', 'Next 14 days') + (h.anniversaries.length ? bullets(h.anniversaries.map((x: any) => `${bold(x.name)} <span style="color:${FAINT}">${plural(x.years, 'year')} · ${shortDate(x.date, tz)}</span>`), '') : note('None coming up.')),
    ) : ''}
    ${button(t, 'Open people', link(org, '/users'))}`
  const title = `${periodWord(d.period)} people report`
  return {
    subject: `${d.name || title}: ${range(org, h.from, h.to)}`,
    html: shell(org, t, { title, subtitle: `${range(org, h.from, h.to)} · ${plural(h.headcount.active, 'person', 'people')}`, preheader: `Attendance ${pc(a.pct)} · ${a.lateDays} late arrivals · ${h.leave.pending.length} leave requests pending`, body, confidential: 'Confidential: contains personal attendance and leave information.' }),
    text: `${title} — ${range(org, h.from, h.to)}\nHeadcount ${h.headcount.active} | Attendance ${pc(a.pct)} | Late arrivals ${a.lateDays} | Leave ${h.leave.days}d | Pending leave ${h.leave.pending.length}\n`,
  }
}

/* ═════════ Manager team ═════════ */
export function managerReport(org: Org, d: any, { mgr, prev }: any): Rendered {
  const t = THEMES.manager_team, k = mgr.totals, p = prev?.totals || {}, tz = org.timezone
  const first = mgr.manager.split(' ')[0]
  const planOrder = ['none', 'carryover', 'under', 'leave', 'planned']
  const plan = [...mgr.plan].sort((a: any, b: any) => planOrder.indexOf(a.status) - planOrder.indexOf(b.status) || a.name.localeCompare(b.name))
  const approvals = mgr.approvals, nApprovals = approvals.leave.length + approvals.expenses.length + approvals.timesheets.length
  const rows = [...mgr.rows].sort((a: any, b: any) => b.flags.length - a.flags.length || a.name.localeCompare(b.name))
  const body = `${previewBanner(d, d.preview ? `Showing ${mgr.manager}'s team.` : '')}
    ${para(`Hi ${esc(first)}, here's how your ${plural(k.people, 'direct report')} did${k.needsPlanning ? `, and ${bold(plural(k.needsPlanning, 'person', 'people'))} ${k.needsPlanning === 1 ? 'needs' : 'need'} work planned for ${fmtDate(mgr.planDay, tz, { weekday: 'long' })}` : ''}.`)}
    ${tiles([
      { label: 'Attendance', value: pc(k.attendancePct), trend: up(k.attendancePct, p.attendancePct, 'pts'), sub: `${k.present} of ${k.people} present` },
      { label: 'Logged to tasks', value: pc(k.loggingPct), trend: up(k.loggingPct, p.loggingPct, 'pts') },
      { label: 'Completed', value: String(k.completed), trend: up(k.completed, p.completed), sub: `${k.overdue} overdue` },
      { label: `Plan for ${fmtDate(mgr.planDay, tz, { weekday: 'short' })}`, value: `${k.people - k.needsPlanning - k.onLeaveTomorrow}/${k.people}`, sub: k.needsPlanning ? `${k.needsPlanning} need planning` : 'everyone planned' },
      { label: 'Your approvals', value: String(nApprovals), sub: nApprovals ? 'waiting for you' : 'all clear' },
      { label: 'Need attention', value: String(k.flagged), trend: up(k.flagged, p.flagged, 'abs', false) },
    ], t)}
    ${section(t, `Plan for ${fmtDate(mgr.planDay, tz, { weekday: 'long', day: '2-digit', month: 'short' })}`, 'Assign work now to anyone not yet planned')}
    ${table([['Person', 'left'], ['Status', 'left'], ['Planned', 'left'], ['Load']],
      plan.map((r: any) => { const [l, c] = PLAN_LABEL[r.status]; return [bold(r.name), chip(l, c), r.planned.length ? esc(r.planned.slice(0, 2).map((x: any) => x.task_name).join(', ')) + (r.planned.length > 2 ? '…' : '') : `<span style="color:${FAINT}">${r.unscheduled.length ? plural(r.unscheduled.length, 'unscheduled task') + ' available' : '—'}</span>`, r.planned.length ? hrs(r.plannedHours) : '—'] }), 'No direct reports.')}
    ${section(t, 'Your team this period')}
    ${table([['Person', 'left'], ['Attendance'], ['Logged'], ['Done'], ['Overdue'], ['Attention', 'left']],
      rows.map((r: any) => [bold(r.name), `${pc(r.attendancePct)}${meter(r.attendancePct, t.accent)}`, pc(r.loggingPct), String(r.completed), r.overdue ? `<b style="color:${BAD}">${r.overdue}</b>` : '0', flagChips(r.flags)]))}
    ${nApprovals ? section(t, 'Waiting for your approval') + table([['Request', 'left'], ['From', 'left'], ['Detail', 'left']], [
      ...approvals.leave.map((l: any) => ['Leave', bold(l.name), `${esc(String(l.type).replace(/_/g, ' '))} · ${dates(l.from, l.to, tz)}`]),
      ...approvals.expenses.map((e: any) => ['Expense', bold(e.name), `${esc(e.number || '')} ${esc(e.title || '')} · ${inr(e.amount)}`]),
      ...approvals.timesheets.map((x: any) => ['Timesheet', bold(x.name), `${x.month}/${x.year} · ${hrs(x.hours)}`]),
    ]) : ''}
    ${button(t, 'Plan your team', link(org, '/tasks?view=kanban'))}`
  return {
    subject: `${d.name || 'Your team'}: ${k.needsPlanning ? `${k.needsPlanning} need work for ${fmtDate(mgr.planDay, tz, { weekday: 'short' })} · ` : ''}${range(org, mgr.from, mgr.to)}`,
    html: shell(org, t, { eyebrow: `${t.label} · ${mgr.manager}`, title: `${periodWord(d.period)} team report`, subtitle: `${range(org, mgr.from, mgr.to)} · ${plural(k.people, 'direct report')}`, preheader: `${k.needsPlanning} need planning · ${nApprovals} approvals waiting · attendance ${pc(k.attendancePct)}`, body }),
    text: `Your team — ${range(org, mgr.from, mgr.to)}\nAttendance ${pc(k.attendancePct)} | Completed ${k.completed} | Need planning for ${mgr.planDay}: ${k.needsPlanning} | Approvals waiting: ${nApprovals}\n\n`
      + plan.map((r: any) => `${r.name}: ${PLAN_LABEL[r.status][0]}`).join('\n') + '\n',
  }
}

/* ═════════ Sales pipeline ═════════ */
export function salesReport(org: Org, d: any, { cur, prev }: any): Rendered {
  const t = THEMES.sales_pipeline, k = cur.totals, p = prev?.totals || {}, tz = org.timezone
  const body = `${previewBanner(d)}
    ${cur.isEmpty ? `<div style="margin:0 0 16px;padding:12px 14px;border-radius:8px;background:${t.soft};font-size:13px;color:#9a3412">No leads or opportunities have been recorded in Sales yet. This report fills in automatically once the team starts using Leads and Opportunities.</div>` : ''}
    ${tiles([
      { label: 'Open pipeline', value: inrShort(k.pipeline), sub: `${plural(k.openCount, 'deal')} · weighted ${inrShort(k.weighted)}` },
      { label: 'Won', value: inrShort(k.wonValue), trend: up(k.wonValue, p.wonValue, 'pct'), sub: plural(k.wonCount, 'deal') },
      { label: 'Win rate', value: pc(k.winRate), trend: up(k.winRate, p.winRate, 'pts'), sub: `${k.wonCount} won · ${k.lostCount} lost` },
      { label: 'New leads', value: String(k.newLeads), trend: up(k.newLeads, p.newLeads), sub: `${pc(k.conversionPct)} converted` },
      { label: 'Closing in 30 days', value: String(k.closingSoon), sub: k.overdueCloses ? `${k.overdueCloses} past close date` : 'none overdue' },
      { label: 'Need an owner', value: String(k.needsCoverage), sub: 'unassigned leads' },
    ], t)}
    ${twoCol(
      section(t, 'Pipeline by stage', 'Open value') + (cur.stages.length ? bars(cur.stages.map((s: any) => ({ label: s.stage, value: s.value, display: inrShort(s.value), sub: `${plural(s.count, 'deal')} · weighted ${inrShort(Math.round(s.weighted))}` })), t) : note('No open deals.')),
      section(t, 'New leads by source') + (cur.bySource.length ? bars(cur.bySource.map((s: any) => ({ label: s.source, value: s.count })), t) : note('No new leads this period.')),
    )}
    ${section(t, 'Closing in the next 30 days')}
    ${table([['Deal', 'left'], ['Stage', 'left'], ['Owner', 'left'], ['Close'], ['Value']],
      cur.closingSoon.slice(0, 10).map((c: any) => [bold(c.number || '—'), esc(c.stage || ''), esc(c.rep), c.overdue ? `<b style="color:${BAD}">${shortDate(c.close, tz)}</b>` : shortDate(c.close, tz), `${inr(c.value)}<div style="font-size:11px;color:${FAINT}">${c.probability}%</div>`]), 'Nothing expected to close in the next 30 days.')}
    ${cur.reps.length ? section(t, 'By owner') + table([['Owner', 'left'], ['New leads'], ['Open'], ['Won']],
      cur.reps.map((r: any) => [bold(r.name), String(r.leads), `${r.open} · ${inrShort(r.openValue)}`, r.won ? `<b style="color:${GOOD}">${r.won} · ${inrShort(r.wonValue)}</b>` : '0'])) : ''}
    ${button(t, 'Open opportunities', link(org, '/sales/opportunities'))}`
  const title = `${periodWord(d.period)} sales pipeline`
  return {
    subject: `${d.name || title}: ${range(org, cur.from, cur.to)}`,
    html: shell(org, t, { title, subtitle: range(org, cur.from, cur.to), preheader: `Pipeline ${inrShort(k.pipeline)} · won ${inrShort(k.wonValue)} · ${k.newLeads} new leads`, body }),
    text: `${title} — ${range(org, cur.from, cur.to)}\nPipeline ${inr(k.pipeline)} (weighted ${inr(k.weighted)}) | Won ${inr(k.wonValue)} (${k.wonCount}) | Win rate ${pc(k.winRate)} | New leads ${k.newLeads}\n`,
  }
}
