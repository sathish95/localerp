// Project Portfolio dashboard — pure roll-ups over rows already fetched by
// portfolioData.js. No Supabase import, so it runs under `node --test`
// (src/lib/portfolio.test.mjs).
//
// Cost per project mirrors ProjectsPage.jsx's computeKPIs(): people cost
// (non-support time_logs hours × resource_rates) + software + hardware +
// support lines (cost_company) + approved expenses. Revenue = customer
// invoices sent / partially_paid / paid (same set profitMargin.js uses);
// collected = customer payments against them.

export const HEALTH_WEIGHTS = { schedule: 0.3, budget: 0.3, delivery: 0.2, quality: 0.2 }
export const BANDS = [
  { key: 'on_track', label: 'On track', min: 75, color: '#059669' },
  { key: 'at_risk', label: 'At risk', min: 50, color: '#d97706' },
  { key: 'critical', label: 'Critical', min: -Infinity, color: '#dc2626' },
]
const BILLED = ['sent', 'partially_paid', 'paid']
const OPEN_CR = ['draft', 'submitted', 'under_review']
const OPEN_INCIDENT = ['OPEN', 'IN_PROGRESS', 'AWAITING_SITE', 'AWAITING_VENDOR']
const DAY = 86400000

const num = v => Number(v) || 0
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))
const round = (v, d = 0) => (v == null || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d)
const groupBy = (rows, key) => {
  const m = {}
  for (const r of rows || []) { const k = r[key]; if (k) (m[k] ||= []).push(r) }
  return m
}
const monthKey = d => (d ? String(d).slice(0, 7) : null)

export function bandFor(score) {
  if (score == null) return { key: 'no_data', label: 'No data', color: '#94a3b8' }
  return BANDS.find(b => score >= b.min)
}

// Share of the planned timeline that has passed (0–100), null without dates.
export function elapsedPct(start, end, today) {
  if (!start || !end) return null
  const s = Date.parse(start), e = Date.parse(end), t = Date.parse(today)
  if (!(e > s)) return null
  return round(clamp(((t - s) / (e - s)) * 100))
}

// isTaskDone: (task) => boolean — the department status flow's is_closed step
export function projectMetrics(p, d, { today, isTaskDone }) {
  const tasks = d.tasks || [], ms = d.milestones || [], logs = d.timelogs || []
  const workLogs = logs.filter(l => l.visit_type !== 'SUPPORT')
  const hours = workLogs.reduce((s, l) => s + num(l.hours_worked), 0)

  // ── cost ──
  const people = workLogs.reduce((s, l) => s + num(l.hours_worked) * (d.rateFor(l.employee_id) || 0), 0)
  const software = (d.sw || []).reduce((s, r) => s + num(r.cost_company), 0)
  const hardware = (d.hw || []).reduce((s, r) => s + num(r.cost_company), 0)
  const support = (d.sup || []).reduce((s, r) => s + num(r.cost_company), 0)
  const expenses = (d.expenses || []).filter(e => e.status === 'approved').reduce((s, e) => s + num(e.total_amount || e.amount), 0)
  const cost = people + software + hardware + support + expenses

  // ── revenue ──
  const invoices = (d.invoices || []).filter(i => BILLED.includes(i.status))
  const invoiced = invoices.reduce((s, i) => s + num(i.total_amount), 0)
  const collected = invoices.reduce((s, i) => s + (i.status === 'paid' ? num(i.total_amount) : Math.min(num(i.total_amount), d.paidFor(i.id))), 0)
  const overdueInvoices = invoices.filter(i => i.status !== 'paid' && i.due_date && i.due_date < today)
  const margin = invoiced > 0 ? invoiced - cost : null
  const marginPct = invoiced > 0 ? round(((invoiced - cost) / invoiced) * 100, 1) : null

  // ── progress & schedule ──
  const doneTasks = tasks.filter(isTaskDone).length
  const msDone = ms.filter(m => m.status === 'completed').length
  const progress = tasks.length ? round((doneTasks / tasks.length) * 100)
    : ms.length ? round((msDone / ms.length) * 100) : null
  const elapsed = elapsedPct(p.start_date, p.end_date, today)
  const overdueMs = ms.filter(m => m.status !== 'completed' && m.due_date && m.due_date < today)
  const openTasks = tasks.filter(t => !isTaskDone(t))
  const overdueTasks = openTasks.filter(t => (t.planned_end_date && t.planned_end_date < today) || t.status === 'delayed')
  const upcomingMs = ms.filter(m => m.status !== 'completed' && m.due_date && m.due_date >= today &&
    Date.parse(m.due_date) - Date.parse(today) <= 30 * DAY)

  // ── quality ──
  const openCRs = (d.changeRequests || []).filter(c => OPEN_CR.includes(c.status))
  const openIncidents = (d.incidents || []).filter(i => OPEN_INCIDENT.includes(i.status))
  const p1 = openIncidents.filter(i => i.priority === 'P1_CRITICAL').length

  // ── budget ──
  const budget = num(p.budget)
  const spendPct = budget > 0 ? round((cost / budget) * 100) : null

  // ── health components (null = not enough data, dropped from the weighting) ──
  const scores = {
    schedule: progress == null && elapsed == null && !ms.length ? null
      : clamp(100 + Math.min(0, (progress ?? elapsed ?? 0) - (elapsed ?? 0)) * 2 - 15 * overdueMs.length),
    budget: spendPct == null ? null
      : clamp(100 - Math.max(0, spendPct - (elapsed ?? spendPct)) * 2 - Math.max(0, spendPct - 100) * 2),
    delivery: !openTasks.length ? (tasks.length ? 100 : null)
      : clamp(100 - (overdueTasks.length / openTasks.length) * 150),
    quality: clamp(100 - 25 * p1 - 10 * (openIncidents.length - p1) - 5 * openCRs.length),
  }
  let wSum = 0, sSum = 0
  for (const [k, w] of Object.entries(HEALTH_WEIGHTS)) if (scores[k] != null) { wSum += w; sSum += w * scores[k] }
  // quality alone (no dates, budget or tasks) is not enough to grade a project
  const health = wSum > HEALTH_WEIGHTS.quality ? round(sSum / wSum) : null

  const lastLog = logs.reduce((m, l) => (l.work_date && l.work_date > m ? l.work_date : m), '')
  const daysSinceLog = lastLog ? Math.round((Date.parse(today) - Date.parse(lastLog)) / DAY) : null
  const team = new Set(logs.filter(l => l.work_date && Date.parse(today) - Date.parse(l.work_date) <= 30 * DAY).map(l => l.employee_id)).size

  return {
    id: p.id, name: p.name, code: p.code, status: p.status || 'active',
    customer: d.customerName, department: d.departmentName,
    start_date: p.start_date, end_date: p.end_date,
    budget, cost: round(cost), spendPct, costSplit: { people: round(people), software: round(software), hardware: round(hardware), support: round(support), expenses: round(expenses) },
    invoiced: round(invoiced), collected: round(collected), outstanding: round(invoiced - collected), overdueInvoices: overdueInvoices.length,
    margin: round(margin), marginPct,
    progress, elapsed, hours: round(hours, 1), team, daysSinceLog,
    tasksTotal: tasks.length, tasksDone: doneTasks, overdueTasks: overdueTasks.length,
    milestonesTotal: ms.length, milestonesDone: msDone, overdueMilestones: overdueMs.length,
    upcomingMilestones: upcomingMs.map(m => ({ project: p.name, project_id: p.id, title: m.title, due_date: m.due_date, status: m.status })),
    openCRs: openCRs.length, openIncidents: openIncidents.length, p1Incidents: p1,
    scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, round(v)])),
    health, band: bandFor(health),
  }
}

// Ranked "needs attention" items across the portfolio (active projects only).
export function attentionItems(rows) {
  const out = []
  const add = (r, sev, text) => out.push({ project_id: r.id, project: r.name, sev, text })
  for (const r of rows) {
    if (r.status !== 'active') continue
    if (r.spendPct != null && r.spendPct > 100) add(r, 3, `${r.spendPct - 100}% over budget`)
    else if (r.spendPct != null && r.elapsed != null && r.spendPct - r.elapsed >= 15) add(r, 2, `Spending ahead of schedule — ${r.spendPct}% of budget used at ${r.elapsed}% of the timeline`)
    if (r.p1Incidents) add(r, 3, `${r.p1Incidents} critical (P1) incident${r.p1Incidents > 1 ? 's' : ''} open`)
    if (r.overdueMilestones) add(r, 2, `${r.overdueMilestones} milestone${r.overdueMilestones > 1 ? 's' : ''} overdue`)
    if (r.progress != null && r.elapsed != null && r.elapsed - r.progress >= 20) add(r, 2, `Behind schedule — ${r.progress}% done at ${r.elapsed}% of the timeline`)
    if (r.overdueTasks >= 3) add(r, 1, `${r.overdueTasks} overdue tasks`)
    if (r.overdueInvoices) add(r, 1, `${r.overdueInvoices} customer invoice${r.overdueInvoices > 1 ? 's' : ''} past due`)
    if (r.marginPct != null && r.marginPct < 0) add(r, 2, `Negative margin (${r.marginPct}%)`)
    if (r.daysSinceLog == null || r.daysSinceLog >= 14) add(r, 1, r.daysSinceLog == null ? 'No time logged yet' : `No time logged for ${r.daysSinceLog} days`)
    if (!r.budget) add(r, 0, 'No budget set — budget health can\'t be measured')
    if (!r.start_date || !r.end_date) add(r, 0, 'Start / end date missing — schedule health can\'t be measured')
  }
  return out.sort((a, b) => b.sev - a.sev)
}

// Portfolio-wide monthly spend (last `months` months, oldest first) plus the
// cumulative line against total budget. Lines without their own date use created_at.
export function monthlySpend(byProject, { today, months = 12 }) {
  const end = new Date(today), keys = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth() - i, 1)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const acc = Object.fromEntries(keys.map(k => [k, { month: k, people: 0, other: 0, expenses: 0 }]))
  const put = (k, field, v) => { if (acc[k]) acc[k][field] += v }
  for (const d of byProject) {
    for (const l of d.timelogs || []) if (l.visit_type !== 'SUPPORT') put(monthKey(l.work_date), 'people', num(l.hours_worked) * (d.rateFor(l.employee_id) || 0))
    for (const r of [...(d.sw || []), ...(d.hw || []), ...(d.sup || [])]) put(monthKey(r.billing_month || r.created_at), 'other', num(r.cost_company))
    for (const e of d.expenses || []) if (e.status === 'approved') put(monthKey(e.expense_date || e.created_at), 'expenses', num(e.total_amount || e.amount))
  }
  let cum = 0
  return keys.map(k => {
    const a = acc[k], total = a.people + a.other + a.expenses
    cum += total
    return { month: k, people: round(a.people), other: round(a.other), expenses: round(a.expenses), total: round(total), cumulative: round(cum) }
  })
}

export function portfolioTotals(rows) {
  const active = rows.filter(r => r.status === 'active')
  const sum = k => rows.reduce((s, r) => s + num(r[k]), 0)
  const budget = sum('budget'), cost = sum('cost'), invoiced = sum('invoiced'), collected = sum('collected')
  const graded = active.filter(r => r.health != null)
  const byBand = key => active.filter(r => r.band.key === key).length
  return {
    projects: rows.length, active: active.length,
    onTrack: byBand('on_track'), atRisk: byBand('at_risk'), critical: byBand('critical'), noData: byBand('no_data'),
    avgHealth: graded.length ? round(graded.reduce((s, r) => s + r.health, 0) / graded.length) : null,
    budget: round(budget), cost: round(cost), spendPct: budget > 0 ? round((cost / budget) * 100) : null,
    invoiced: round(invoiced), collected: round(collected), outstanding: round(invoiced - collected),
    marginPct: invoiced > 0 ? round(((invoiced - cost) / invoiced) * 100, 1) : null,
    overdueTasks: sum('overdueTasks'), overdueMilestones: sum('overdueMilestones'),
    openIncidents: sum('openIncidents'), openCRs: sum('openCRs'), hours: round(sum('hours'), 1),
  }
}

// Builds the whole dashboard from the raw rows (see portfolioData.js).
export function buildPortfolio(raw, { today, isTaskDone }) {
  const by = {
    tasks: groupBy(raw.tasks, 'project_id'), milestones: groupBy(raw.milestones, 'project_id'),
    timelogs: groupBy(raw.timelogs, 'project_id'), expenses: groupBy(raw.expenses, 'project_id'),
    sw: groupBy(raw.sw, 'project_id'), hw: groupBy(raw.hw, 'project_id'), sup: groupBy(raw.sup, 'project_id'),
    invoices: groupBy(raw.invoices, 'project_id'), changeRequests: groupBy(raw.changeRequests, 'project_id'),
    incidents: groupBy(raw.incidents, 'project_id'),
  }
  const rate = {}
  for (const r of raw.rates || []) if (r.employee_id) rate[r.employee_id] = num(r.hourly_rate) || num(r.monthly_salary) / (22 * 8)
  const paid = {}
  for (const p of raw.payments || []) paid[p.invoice_id] = (paid[p.invoice_id] || 0) + num(p.amount)
  const names = rows => Object.fromEntries((rows || []).map(r => [r.id, r.name]))
  const cust = names(raw.customers), dept = names(raw.departments)

  const perProject = (raw.projects || []).map(p => ({
    p,
    d: {
      tasks: by.tasks[p.id], milestones: by.milestones[p.id], timelogs: by.timelogs[p.id], expenses: by.expenses[p.id],
      sw: by.sw[p.id], hw: by.hw[p.id], sup: by.sup[p.id], invoices: by.invoices[p.id],
      changeRequests: by.changeRequests[p.id], incidents: by.incidents[p.id],
      rateFor: id => rate[id] || 0, paidFor: id => paid[id] || 0,
      customerName: cust[p.customer_id] || null, departmentName: dept[p.department_id] || null,
    },
  }))
  const rows = perProject.map(({ p, d }) => projectMetrics(p, d, { today, isTaskDone }))
  return {
    rows,
    totals: portfolioTotals(rows),
    attention: attentionItems(rows),
    monthly: monthlySpend(perProject.map(x => x.d), { today }),
    upcoming: rows.flatMap(r => r.upcomingMilestones).sort((a, b) => a.due_date.localeCompare(b.due_date)),
  }
}
