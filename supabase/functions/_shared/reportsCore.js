// Project status + financial report calculations for scheduled report
// emails (STEP229). Pure JS, no imports, no clock — dates and the
// flow-aware isTaskDone are passed in — so it runs unchanged in Deno (the
// send-email worker) and the browser. Same rules as teamPerformanceCore.js.

const DAY = 86400000
const d2n = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))
const n2d = n => new Date(n).toISOString().slice(0, 10)
export const addDays = (s, k) => n2d(d2n(s) + k * DAY)
const num = v => Number(v) || 0
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null)
const round1 = n => Math.round(n * 10) / 10
const inRange = (d, from, to) => !!d && d >= from && d <= to

/**
 * Date window a report covers.
 *  coverage 'to_date'  : daily = asOf; weekly = rolling 7 days ending asOf;
 *                        monthly = 1st of asOf's month → asOf   (STEP228 rules)
 *  coverage 'previous' : daily = the day before; weekly = previous Mon–Sun;
 *                        monthly = previous calendar month
 */
export function reportWindow(period, coverage, asOf) {
  if (coverage === 'previous') {
    if (period === 'weekly') {
      const dow = new Date(d2n(asOf)).getUTCDay() // 0 = Sun
      const thisMon = addDays(asOf, -((dow + 6) % 7))
      return { from: addDays(thisMon, -7), to: addDays(thisMon, -1) }
    }
    if (period === 'monthly') {
      const first = asOf.slice(0, 8) + '01'
      const lastPrev = addDays(first, -1)
      return { from: lastPrev.slice(0, 8) + '01', to: lastPrev }
    }
    const y = addDays(asOf, -1)
    return { from: y, to: y }
  }
  if (period === 'weekly') return { from: addDays(asOf, -6), to: asOf }
  if (period === 'monthly') return { from: asOf.slice(0, 8) + '01', to: asOf }
  return { from: asOf, to: asOf }
}

/* ═════════════ Project status ═════════════ */

export const HEALTH = {
  off_track: { label: 'Off track', rank: 0 },
  at_risk: { label: 'At risk', rank: 1 },
  on_track: { label: 'On track', rank: 2 },
}

/**
 * raw: { projects, tasks, changeLog, milestones, workLogs, profiles }
 * opts: { from, to, today, isTaskDone, dateOfTs, projectId? }
 */
export function computeProjectStatusCore(raw, { from, to, today, isTaskDone, dateOfTs, projectId = null }) {
  const { projects = [], tasks = [], changeLog = [], milestones = [], workLogs = [], profiles = [] } = raw
  const nameOf = id => profiles.find(p => p.id === id)?.full_name || null
  const taskById = new Map(tasks.map(t => [t.id, t]))

  // First closing transition per task within the window.
  const closedAt = new Map()
  for (const c of [...changeLog].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    const t = taskById.get(c.task_id)
    if (!t || closedAt.has(t.id) || !inRange(dateOfTs(c.created_at), from, to)) continue
    if (isTaskDone({ status: c.new_value, department_id: t.department_id })) closedAt.set(t.id, c.created_at)
  }
  const nextWeek = addDays(today, 7), twoWeeks = addDays(today, 14)
  const scope = projects.filter(p => projectId ? p.id === projectId : (p.status || 'active') === 'active')

  const rows = scope.map(p => {
    const pt = tasks.filter(t => t.project_id === p.id)
    const done = pt.filter(t => isTaskDone(t))
    const open = pt.filter(t => !isTaskDone(t))
    const overdue = open.filter(t => t.planned_end_date && t.planned_end_date < today)
    const dueSoon = open.filter(t => t.planned_end_date && t.planned_end_date >= today && t.planned_end_date <= nextWeek)
    const completed = pt.filter(t => closedAt.has(t.id))
    const hours = workLogs.filter(w => (w.project_id || taskById.get(w.task_id)?.project_id) === p.id)
      .reduce((s, w) => s + num(w.duration_minutes) / 60, 0)

    const ms = milestones.filter(m => m.project_id === p.id)
    const msDone = m => /complet|done|closed/i.test(m.status || '') || !!m.actual_end
    const msOverdue = ms.filter(m => !msDone(m) && m.due_date && m.due_date < today)
    const msUpcoming = ms.filter(m => !msDone(m) && m.due_date && m.due_date >= today && m.due_date <= twoWeeks)
    const msCompleted = ms.filter(m => m.actual_end ? inRange(m.actual_end, from, to) : false)

    const budget = num(p.budget), spent = num(p.spent)
    const budgetPct = pct(spent, budget)
    let timePct = null
    if (p.start_date && p.end_date && p.end_date > p.start_date) {
      timePct = Math.max(0, Math.min(100, Math.round(((d2n(today) - d2n(p.start_date)) / (d2n(p.end_date) - d2n(p.start_date))) * 100)))
    }
    const progressPct = pt.length ? Math.round((done.length / pt.length) * 100) : null

    // Health — every rule is stated in the email so it can be challenged.
    const red = [], amber = []
    if (budgetPct != null && budgetPct > 100) red.push(`Over budget (${budgetPct}% spent)`)
    if (msOverdue.length) red.push(`${msOverdue.length} milestone${msOverdue.length > 1 ? 's' : ''} overdue`)
    if (p.end_date && p.end_date < today && progressPct != null && progressPct < 100) red.push('Past end date with work still open')
    if (open.length >= 5 && overdue.length / open.length >= 0.3) red.push(`${Math.round((overdue.length / open.length) * 100)}% of open tasks overdue`)
    if (!red.length) {
      if (overdue.length) amber.push(`${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}`)
      if (budgetPct != null && timePct != null && budgetPct > timePct + 15) amber.push(`Budget ${budgetPct}% used vs ${timePct}% of time elapsed`)
      if (progressPct != null && timePct != null && progressPct < timePct - 20) amber.push(`Progress ${progressPct}% vs ${timePct}% of time elapsed`)
    }
    const health = red.length ? 'off_track' : amber.length ? 'at_risk' : 'on_track'

    const tItem = t => ({ id: t.id, code: t.task_id, name: t.task_name, due: t.planned_end_date, who: nameOf(t.assigned_to) })
    return {
      id: p.id, code: p.code, name: p.name, client: p.client_name, manager: nameOf(p.manager_id),
      start: p.start_date, end: p.end_date,
      health, reasons: red.length ? red : amber,
      progressPct, timePct, totalTasks: pt.length, doneTasks: done.length, openTasks: open.length,
      completedCount: completed.length, overdueCount: overdue.length, dueSoonCount: dueSoon.length,
      hours: round1(hours), budget, spent, budgetPct,
      completed: completed.sort((a, b) => String(closedAt.get(b.id)).localeCompare(String(closedAt.get(a.id)))).map(t => ({ ...tItem(t), at: dateOfTs(closedAt.get(t.id)) })),
      overdue: overdue.sort((a, b) => a.planned_end_date.localeCompare(b.planned_end_date)).map(tItem),
      dueSoon: dueSoon.sort((a, b) => a.planned_end_date.localeCompare(b.planned_end_date)).map(tItem),
      milestonesOverdue: msOverdue.map(m => ({ title: m.title, due: m.due_date, status: m.status })),
      milestonesUpcoming: msUpcoming.sort((a, b) => a.due_date.localeCompare(b.due_date)).map(m => ({ title: m.title, due: m.due_date, status: m.status })),
      milestonesCompleted: msCompleted.map(m => ({ title: m.title, on: m.actual_end, due: m.due_date })),
    }
  }).sort((a, b) => HEALTH[a.health].rank - HEALTH[b.health].rank || a.name.localeCompare(b.name))

  const sum = k => rows.reduce((s, r) => s + (r[k] || 0), 0)
  return {
    from, to, rows,
    totals: {
      projects: rows.length,
      onTrack: rows.filter(r => r.health === 'on_track').length,
      atRisk: rows.filter(r => r.health === 'at_risk').length,
      offTrack: rows.filter(r => r.health === 'off_track').length,
      completed: sum('completedCount'), overdue: sum('overdueCount'), hours: round1(sum('hours')),
      budget: sum('budget'), spent: sum('spent'), budgetPct: pct(sum('spent'), sum('budget')),
      milestonesCompleted: rows.reduce((s, r) => s + r.milestonesCompleted.length, 0),
      milestonesOverdue: rows.reduce((s, r) => s + r.milestonesOverdue.length, 0),
    },
  }
}

/* ═════════════ Financial ═════════════ */

const EXPENSE_APPROVED = ['approved', 'paid', 'closed']
const EXPENSE_PENDING = ['submitted', 'manager_review', 'dept_review', 'finance_review', 'ceo_review']
const DEAD = s => /cancel|void|draft|reject/i.test(s || '')
const isPaid = r => /paid/i.test(r.status || '') || /paid/i.test(r.payment_status || '') || !!r.paid_at

/**
 * raw: { expenses, vendorInvoices, purchaseOrders, travel, customerInvoices,
 *        customers, milestones, projects, margins, costSnapshots }
 * opts: { from, to, today, dateOfTs }
 */
export function computeFinanceCore(raw, { from, to, today, dateOfTs }) {
  const {
    expenses = [], vendorInvoices = [], purchaseOrders = [], travel = [], customerInvoices = [],
    customers = [], milestones = [], projects = [], margins = [], costSnapshots = [],
  } = raw
  const projName = id => projects.find(p => p.id === id)?.name || 'No project'
  const custName = id => customers.find(c => c.id === id)?.name || '—'
  const amt = e => num(e.total_amount) || num(e.amount)

  /* Money out (period) */
  const expApproved = expenses.filter(e => EXPENSE_APPROVED.includes(e.status) && inRange(e.expense_date, from, to))
  const byCat = {}
  expApproved.forEach(e => { const k = e.category || 'Uncategorised'; byCat[k] = (byCat[k] || 0) + amt(e) })
  const expensesByCategory = Object.entries(byCat).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount)
  const expPending = expenses.filter(e => EXPENSE_PENDING.includes(e.status))

  const billsIn = vendorInvoices.filter(v => !DEAD(v.status) && inRange(v.invoice_date, from, to))
  const payables = vendorInvoices.filter(v => !DEAD(v.status) && !isPaid(v))
  const posIssued = purchaseOrders.filter(p => !DEAD(p.status) && inRange(p.order_date, from, to))
  const travelCost = t => num(t.actual_cost) || num(t.claim_amount) || num(t.estimated_cost)
  const travelIn = travel.filter(t => EXPENSE_APPROVED.includes(t.status) && inRange(t.travel_date, from, to))

  /* Money in */
  const live = customerInvoices.filter(c => !DEAD(c.status))
  const invoiced = live.filter(c => inRange(c.invoice_date, from, to))
  const received = live.filter(c => isPaid(c) && c.paid_at && inRange(dateOfTs(c.paid_at), from, to))
  const outstanding = live.filter(c => !isPaid(c))
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90p: 0 }
  outstanding.forEach(c => {
    const late = c.due_date ? Math.floor((d2n(today) - d2n(c.due_date)) / DAY) : 0
    const k = late <= 0 ? 'current' : late <= 30 ? 'd1_30' : late <= 60 ? 'd31_60' : late <= 90 ? 'd61_90' : 'd90p'
    buckets[k] += amt(c)
  })
  const overdueInvoices = outstanding.filter(c => c.due_date && c.due_date < today)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .map(c => ({ number: c.invoice_number, customer: custName(c.customer_id), amount: amt(c), due: c.due_date, daysLate: Math.floor((d2n(today) - d2n(c.due_date)) / DAY) }))
  const unbilled = milestones.filter(m => (/complet|done/i.test(m.status || '') || m.actual_end) && /not_invoiced|pending|unbilled/i.test(m.billing_status || 'not_invoiced'))
    .map(m => ({ project: projName(m.project_id), title: m.title, amount: num(m.invoice_amount) || num(m.budget) }))

  /* Project P&L — latest margin / cost snapshot per project */
  const latest = (list, key) => {
    const m = new Map()
    list.forEach(x => { const cur = m.get(x.project_id); if (!cur || String(x[key]) > String(cur[key])) m.set(x.project_id, x) })
    return m
  }
  const marginBy = latest(margins, 'computed_at'), costBy = latest(costSnapshots, 'computed_at')
  const projectRows = projects.filter(p => (p.status || 'active') === 'active' || marginBy.has(p.id)).map(p => {
    const mg = marginBy.get(p.id), cs = costBy.get(p.id)
    return {
      name: p.name, code: p.code, budget: num(p.budget), spent: num(p.spent), budgetPct: pct(num(p.spent), num(p.budget)),
      actualCost: cs ? num(cs.total_actual_cost) : null,
      revenue: mg ? num(mg.revenue_recognized) : null, margin: mg ? num(mg.gross_margin) : null,
      marginPct: mg && mg.margin_percent != null ? Math.round(num(mg.margin_percent)) : null,
    }
  }).sort((a, b) => (b.budgetPct ?? -1) - (a.budgetPct ?? -1))

  const s = (list, f = amt) => list.reduce((t, x) => t + f(x), 0)
  const moneyOut = s(expApproved) + s(billsIn) + s(travelIn, travelCost)
  return {
    from, to,
    totals: {
      invoiced: s(invoiced), invoicedCount: invoiced.length,
      received: s(received), receivedCount: received.length,
      outstanding: s(outstanding), outstandingCount: outstanding.length,
      overdueReceivable: s(overdueInvoices, x => x.amount), overdueCount: overdueInvoices.length,
      unbilled: s(unbilled, x => x.amount), unbilledCount: unbilled.length,
      expenses: s(expApproved), expenseCount: expApproved.length,
      bills: s(billsIn), billCount: billsIn.length,
      payables: s(payables), payableCount: payables.length,
      poValue: s(posIssued), poCount: posIssued.length,
      travel: s(travelIn, travelCost), travelCount: travelIn.length,
      pendingApproval: s(expPending), pendingCount: expPending.length,
      moneyOut, net: s(received) - moneyOut,
    },
    expensesByCategory, receivableAging: buckets, overdueInvoices, unbilled, projects: projectRows,
    pendingExpenses: expPending.sort((a, b) => amt(b) - amt(a)).slice(0, 10)
      .map(e => ({ number: e.expense_number, title: e.title, amount: amt(e), status: e.status, date: e.expense_date })),
    isEmpty: !expenses.length && !vendorInvoices.length && !purchaseOrders.length && !customerInvoices.length && !travel.length,
  }
}
