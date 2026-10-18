// Run: node --test src/lib/portfolio.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPortfolio, elapsedPct, bandFor, attentionItems } from './portfolio.js'

const today = '2026-10-15'
const isTaskDone = t => t.status === 'closed'

const raw = {
  projects: [
    { id: 'p1', name: 'Alpha', status: 'active', budget: 100000, start_date: '2026-01-01', end_date: '2026-12-31', customer_id: 'c1' },
    { id: 'p2', name: 'Beta', status: 'active', budget: 0, start_date: null, end_date: null },
  ],
  tasks: [
    { project_id: 'p1', status: 'closed' }, { project_id: 'p1', status: 'closed' },
    { project_id: 'p1', status: 'in_progress', planned_end_date: '2026-10-01' }, { project_id: 'p1', status: 'todo', planned_end_date: '2026-11-30' },
  ],
  milestones: [
    { project_id: 'p1', title: 'M1', status: 'completed', due_date: '2026-03-01' },
    { project_id: 'p1', title: 'M2', status: 'in_progress', due_date: '2026-09-30' },
    { project_id: 'p1', title: 'M3', status: 'planned', due_date: '2026-11-01' },
  ],
  timelogs: [
    { project_id: 'p1', employee_id: 'u1', hours_worked: 100, work_date: '2026-10-10' },
    { project_id: 'p1', employee_id: 'u1', hours_worked: 10, work_date: '2026-10-11', visit_type: 'SUPPORT' },
  ],
  rates: [{ employee_id: 'u1', hourly_rate: 500 }],
  sw: [{ project_id: 'p1', cost_company: 10000, created_at: '2026-09-02' }],
  hw: [], sup: [],
  expenses: [{ project_id: 'p1', status: 'approved', total_amount: 5000, expense_date: '2026-10-01' }, { project_id: 'p1', status: 'submitted', total_amount: 9999 }],
  invoices: [{ id: 'i1', project_id: 'p1', status: 'partially_paid', total_amount: 80000, due_date: '2026-10-01' }, { id: 'i2', project_id: 'p1', status: 'draft', total_amount: 50000 }],
  payments: [{ invoice_id: 'i1', amount: 30000 }],
  changeRequests: [{ project_id: 'p1', status: 'submitted' }],
  incidents: [{ project_id: 'p1', status: 'OPEN', priority: 'P1_CRITICAL' }, { project_id: 'p1', status: 'CLOSED', priority: 'P2_HIGH' }],
  customers: [{ id: 'c1', name: 'Acme' }], departments: [],
}

test('elapsedPct clamps and needs both dates', () => {
  assert.equal(elapsedPct('2026-01-01', '2026-12-31', '2027-03-01'), 100)
  assert.equal(elapsedPct('2026-01-01', null, today), null)
  assert.equal(elapsedPct('2026-01-01', '2026-01-01', today), null)
})

test('per-project cost, revenue and progress', () => {
  const { rows } = buildPortfolio(raw, { today, isTaskDone })
  const a = rows.find(r => r.id === 'p1')
  // 100 h × 500 (support hours excluded) + 10000 sw + 5000 approved expense
  assert.equal(a.cost, 65000)
  assert.equal(a.spendPct, 65)
  assert.equal(a.invoiced, 80000)          // draft excluded
  assert.equal(a.collected, 30000)
  assert.equal(a.outstanding, 50000)
  assert.equal(a.overdueInvoices, 1)
  assert.equal(a.marginPct, 18.8)
  assert.equal(a.progress, 50)
  assert.equal(a.overdueTasks, 1)
  assert.equal(a.overdueMilestones, 1)
  assert.equal(a.p1Incidents, 1)
  assert.equal(a.openIncidents, 1)
  assert.equal(a.customer, 'Acme')
  assert.equal(a.upcomingMilestones.length, 1)
  assert.ok(a.health > 0 && a.health < 100)
})

test('projects with no budget, dates or tasks are not graded', () => {
  const { rows, totals } = buildPortfolio(raw, { today, isTaskDone })
  const b = rows.find(r => r.id === 'p2')
  assert.equal(b.health, null)
  assert.equal(b.band.key, 'no_data')
  assert.equal(totals.noData, 1)
  assert.equal(totals.active, 2)
})

test('attention list ranks critical items first and flags data gaps', () => {
  const { attention } = buildPortfolio(raw, { today, isTaskDone })
  assert.equal(attention[0].sev, 3)
  assert.ok(attention.some(x => x.project === 'Beta' && /No budget/.test(x.text)))
  assert.ok(attention.some(x => x.project === 'Alpha' && /P1/.test(x.text)))
})

test('inactive projects are left out of attention', () => {
  const rows = [{ id: 'x', name: 'Old', status: 'completed', spendPct: 150, budget: 1 }]
  assert.equal(attentionItems(rows).length, 0)
})

test('bands', () => {
  assert.equal(bandFor(80).key, 'on_track')
  assert.equal(bandFor(60).key, 'at_risk')
  assert.equal(bandFor(10).key, 'critical')
  assert.equal(bandFor(null).key, 'no_data')
})

test('monthly series is 12 months with a running total', () => {
  const { monthly } = buildPortfolio(raw, { today, isTaskDone })
  assert.equal(monthly.length, 12)
  assert.equal(monthly.at(-1).month, '2026-10')
  assert.equal(monthly.at(-1).people, 50000)
  assert.equal(monthly.at(-1).expenses, 5000)
  assert.equal(monthly.at(-2).other, 10000)
  assert.equal(monthly.at(-1).cumulative, 65000)
})
