import { supabase, rupee } from './supabase'

// Deny-list (terminal statuses) rather than an allow-list of review-stage
// names — an allow-list silently undercounts (or, sent server-side, 400s)
// the moment a table uses a status name we didn't guess. "Pending" = not
// yet in one of these end states, whatever the in-between stage is called.
// purchase_requisitions.status is a real Postgres enum verified (via direct
// REST probing, since no SQL access was available) to contain ONLY
// draft/submitted/approved/rejected — NOT the multi-stage review names
// (manager_review, procurement_lead_review, pm_review, cto_review,
// finance_review, ceo_review, cancelled) that a stale comment in
// STEP26_procurement_request_workflow.sql and several pages (DashboardPage,
// approvalFlow.js) assume exist. Those extra stages were never actually
// added to the enum, so 'submitted' is the only real pending state.
const EXP_TRV_TERMINAL = ['approved', 'rejected']
const PR_TERMINAL = ['draft', 'approved', 'rejected']
const LEAVE_TERMINAL = ['approved', 'rejected']

function pendingSummary(rows, terminal, noun) {
  const pending = rows.filter(r => !terminal.includes(r.status))
  const byStatus = {}
  pending.forEach(r => { const k = r.status || 'unknown'; byStatus[k] = (byStatus[k] || 0) + 1 })
  const breakdown = Object.entries(byStatus).map(([k, v]) => `${k}: ${v}`).join(', ')
  const count = pending.length
  return `There ${count === 1 ? 'is' : 'are'} ${count} ${noun}${count === 1 ? '' : 's'} pending${breakdown ? ` (${breakdown})` : ''}.`
}

function monthBounds() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()
  return { start, end }
}

async function safeRun(id, fn) {
  try {
    return await fn()
  } catch (err) {
    console.error(`[quickAnswers:${id}]`, err)
    const detail = err?.message || err?.details || err?.hint || err?.code || 'unknown error'
    return `Sorry, I couldn't fetch that right now (${detail}). Check the browser console for details.`
  }
}

// ── Personal — every role, scoped to the signed-in user (profile.id) ──
// Native counterpart of mobile/src/lib/quickAnswers.ts's PERSONAL_QUESTIONS
// — the web bubble never had a personal set before (org-wide only); this
// closes that gap so "Non-LLM mode" (STEP: LLM/DB toggle) has real
// per-person coverage, not just company-wide aggregates.
const PERSONAL_TERMINAL = ['approved', 'rejected', 'closed', 'cancelled']

export const PERSONAL_QUESTIONS = [
  {
    id: 'my-open-tasks',
    label: 'How many open tasks do I have?',
    keywords: ['my', 'tasks', 'task', 'open', 'assigned', 'overdue', 'incomplete', 'unfinished', 'pending', 'to do', 'todo', 'in progress', 'work'],
    run: (profile) => safeRun('my-open-tasks', async () => {
      const [{ data: tasks, error: tErr }, { data: flows, error: fErr }] = await Promise.all([
        supabase.from('project_tasks').select('status,department_id,planned_end_date').eq('assigned_to', profile.id),
        supabase.from('department_status_flows').select('department_id,steps:department_status_steps(status_key,is_closed)').eq('organization_id', profile.organization_id),
      ])
      if (tErr) throw tErr
      if (fErr) throw fErr
      // "Open" = not on that task's OWN department's closed step — a
      // literal status==='closed' check silently misses any custom flow
      // whose done step is named something else (e.g. 'done').
      const closedByDept = {}
      ;(flows || []).forEach(f => { closedByDept[f.department_id || '__none'] = new Set((f.steps || []).filter(s => s.is_closed).map(s => s.status_key)) })
      const open = (tasks || []).filter(t => !closedByDept[t.department_id || '__none']?.has(t.status))
      if (!open.length) return "You're all caught up — no open tasks assigned to you."
      const overdue = open.filter(t => t.planned_end_date && new Date(t.planned_end_date) < new Date())
      return `You have ${open.length} open task${open.length === 1 ? '' : 's'}${overdue.length ? `, ${overdue.length} overdue` : ''}.`
    }),
  },
  {
    id: 'my-hours-this-month',
    label: 'How many hours have I logged this month?',
    keywords: ['my', 'hours', 'logged', 'timesheet', 'month', 'worked', 'clocked', 'time', 'checkin', 'check in'],
    run: (profile) => safeRun('my-hours-this-month', async () => {
      const { start, end } = monthBounds()
      const { data, error } = await supabase.from('time_logs').select('hours_worked')
        .eq('employee_id', profile.id).gte('work_date', start.slice(0, 10)).lt('work_date', end.slice(0, 10))
      if (error) throw error
      const total = (data || []).reduce((s, l) => s + (Number(l.hours_worked) || 0), 0)
      return `You've logged ${total.toFixed(1)}h this month across ${data?.length || 0} session${data?.length === 1 ? '' : 's'}.`
    }),
  },
  {
    id: 'my-pending-expenses',
    label: 'Do I have any pending expense requests?',
    keywords: ['my', 'expense', 'expenses', 'pending', 'outstanding', 'waiting', 'reimbursement', 'reimbursements', 'claim', 'claims'],
    run: (profile) => safeRun('my-pending-expenses', async () => {
      const { data, error } = await supabase.from('expense_requests').select('status,total_amount,amount').eq('requested_by', profile.id)
      if (error) throw error
      const pending = (data || []).filter(e => !PERSONAL_TERMINAL.includes(e.status))
      if (!pending.length) return "No pending expense requests — you're all clear."
      const total = pending.reduce((s, e) => s + (e.total_amount || e.amount || 0), 0)
      return `You have ${pending.length} pending expense request${pending.length === 1 ? '' : 's'} totalling ${rupee(total)}.`
    }),
  },
  {
    id: 'my-pending-travel',
    label: 'Do I have any pending travel requests?',
    keywords: ['my', 'travel', 'trip', 'trips', 'pending', 'outstanding', 'waiting', 'business travel'],
    run: (profile) => safeRun('my-pending-travel', async () => {
      const { data, error } = await supabase.from('travel_requests').select('status').eq('requested_by', profile.id)
      if (error) throw error
      const pending = (data || []).filter(t => !PERSONAL_TERMINAL.includes(t.status))
      if (!pending.length) return 'No pending travel requests.'
      return `You have ${pending.length} pending travel request${pending.length === 1 ? '' : 's'}.`
    }),
  },
]

// ── Org-wide — managers, finance, HR (kept as `QUESTIONS` too, unchanged
// name, so every existing caller — AskBubble, DataAssistantPage — keeps
// working without touching them). ──
export const ORG_QUESTIONS = [
  {
    id: 'pending-expenses',
    label: 'How many expense approvals are pending?',
    keywords: ['expense', 'expenses', 'pending', 'approval', 'approvals', 'outstanding', 'waiting', 'unapproved', 'submitted', 'reimbursement', 'reimbursements'],
    run: () => safeRun('pending-expenses', async () => {
      const { data, error } = await supabase.from('expense_requests').select('status')
      if (error) throw error
      return pendingSummary(data || [], EXP_TRV_TERMINAL, 'expense request')
    }),
  },
  {
    id: 'pending-pr',
    label: 'How many purchase requisitions are pending?',
    keywords: ['purchase', 'requisition', 'requisitions', 'pr', 'procurement', 'pending', 'material request', 'purchase request', 'outstanding', 'waiting'],
    run: () => safeRun('pending-pr', async () => {
      const { data, error } = await supabase.from('purchase_requisitions').select('status')
      if (error) throw error
      return pendingSummary(data || [], PR_TERMINAL, 'purchase requisition')
    }),
  },
  {
    id: 'pending-leave',
    label: 'How many leave requests are pending?',
    keywords: ['leave', 'leaves', 'pending', 'time off', 'off', 'vacation', 'pto', 'holiday', 'outstanding', 'waiting'],
    run: () => safeRun('pending-leave', async () => {
      const { data, error } = await supabase.from('leave_requests').select('status')
      if (error) throw error
      return pendingSummary(data || [], LEAVE_TERMINAL, 'leave request')
    }),
  },
  {
    id: 'pending-travel',
    label: 'How many travel requests are pending?',
    keywords: ['travel', 'trip', 'trips', 'pending', 'approval', 'outstanding', 'waiting', 'business travel'],
    run: () => safeRun('pending-travel', async () => {
      const { data, error } = await supabase.from('travel_requests').select('status')
      if (error) throw error
      return pendingSummary(data || [], EXP_TRV_TERMINAL, 'travel request')
    }),
  },
  {
    id: 'over-budget-projects',
    label: 'Which projects are over budget?',
    keywords: ['project', 'projects', 'over budget', 'overrun', 'over-budget', 'exceeding', 'exceeded', 'overspend', 'overspending', 'blown'],
    run: () => safeRun('over-budget-projects', async () => {
      const { data, error } = await supabase.from('projects').select('id,name,budget,spent')
      if (error) throw error
      const over = (data || []).filter(p => (p.spent || 0) > (p.budget || 0)).sort((a, b) => (b.spent - b.budget) - (a.spent - a.budget))
      if (!over.length) return 'No projects are currently over budget. 🎉'
      const top = over.slice(0, 5).map(p => `• ${p.name} — over by ${rupee(p.spent - p.budget)}`).join('\n')
      return `${over.length} project${over.length === 1 ? ' is' : 's are'} over budget:\n${top}${over.length > 5 ? `\n…and ${over.length - 5} more` : ''}`
    }),
  },
  {
    id: 'budget-vs-spent',
    label: "What's the total budget vs spent across all projects?",
    keywords: ['budget', 'spent', 'total', 'utilization', 'utilized', 'projects', 'overall budget'],
    run: () => safeRun('budget-vs-spent', async () => {
      const { data, error } = await supabase.from('projects').select('budget,spent')
      if (error) throw error
      const budget = (data || []).reduce((s, p) => s + (p.budget || 0), 0)
      const spent = (data || []).reduce((s, p) => s + (p.spent || 0), 0)
      const pct = budget > 0 ? Math.round((spent / budget) * 100) : 0
      return `Total project budget is ${rupee(budget)}, with ${rupee(spent)} spent so far (${pct}% utilized).`
    }),
  },
  {
    id: 'spend-this-month',
    label: 'How much have we spent this month?',
    keywords: ['spend', 'spent', 'this month', 'month', 'expenses', 'invoices', 'spending', 'expenditure', 'monthly spend'],
    run: () => safeRun('spend-this-month', async () => {
      const { start, end } = monthBounds()
      const [expR, invR] = await Promise.all([
        supabase.from('expense_requests').select('total_amount,amount').gte('created_at', start).lt('created_at', end),
        supabase.from('invoices').select('total_amount').gte('created_at', start).lt('created_at', end),
      ])
      if (expR.error) throw expR.error
      if (invR.error) throw invR.error
      const expTotal = (expR.data || []).reduce((s, e) => s + (e.total_amount || e.amount || 0), 0)
      const invTotal = (invR.data || []).reduce((s, i) => s + (i.total_amount || 0), 0)
      return `This month's spend so far: ${rupee(expTotal + invTotal)} (${rupee(expTotal)} expenses + ${rupee(invTotal)} invoices).`
    }),
  },
  {
    id: 'pending-invoices',
    label: 'How much is pending in invoices?',
    keywords: ['invoice', 'invoices', 'pending', 'unpaid', 'amount', 'outstanding', 'owe', 'owed', 'payable', 'vendor invoices', 'bills'],
    run: () => safeRun('pending-invoices', async () => {
      const { data, error } = await supabase.from('invoices').select('total_amount,status')
      if (error) throw error
      const pending = (data || []).filter(i => !['paid', 'rejected'].includes(i.status)).reduce((s, i) => s + (i.total_amount || 0), 0)
      return `${rupee(pending)} is currently pending across unpaid invoices.`
    }),
  },
  {
    id: 'department-budget-health',
    label: 'Which department is most over budget?',
    keywords: ['department', 'departments', 'budget', 'health', 'over budget', 'worst', 'highest utilization', 'overspending department'],
    run: () => safeRun('department-budget-health', async () => {
      const [deptR, budR] = await Promise.all([
        supabase.from('departments').select('id,name'),
        supabase.from('budgets').select('allocated,spent,department_id'),
      ])
      if (deptR.error) throw deptR.error
      if (budR.error) throw budR.error
      const depts = deptR.data || []
      const budgets = budR.data || []
      if (!depts.length) return 'No departments are configured yet.'
      const rows = depts.map(dep => {
        const deptBudgets = budgets.filter(b => b.department_id === dep.id)
        const allocated = deptBudgets.reduce((s, b) => s + (b.allocated || 0), 0)
        const spent = deptBudgets.reduce((s, b) => s + (b.spent || 0), 0)
        const pct = allocated > 0 ? Math.round((spent / allocated) * 100) : null
        return { name: dep.name, pct }
      }).filter(r => r.pct != null).sort((a, b) => b.pct - a.pct)
      if (!rows.length) return 'No department has a budget allocated yet.'
      const worst = rows[0]
      return `${worst.name} is the most utilized department budget at ${worst.pct}%.${rows.length > 1 ? ` Next: ${rows.slice(1, 4).map(r => `${r.name} (${r.pct}%)`).join(', ')}.` : ''}`
    }),
  },
  {
    id: 'active-employees',
    label: 'How many active employees do we have?',
    keywords: ['employee', 'employees', 'headcount', 'active', 'staff', 'workforce', 'people', 'team size'],
    run: () => safeRun('active-employees', async () => {
      const { count, error } = await supabase.from('profiles').select('id', { count: 'exact' }).neq('is_active', false)
      if (error) throw error
      return `There are ${count || 0} active employees.`
    }),
  },
  // ── Everything below is non-budget/finance — operations, procurement,
  // assets, tasks, sales/CRM, mirroring the domains dataIndex.js already
  // covers for LLM mode, so Non-LLM mode isn't just a finance narrow-cast.
  {
    id: 'pending-po',
    label: 'How many purchase orders are pending?',
    keywords: ['purchase', 'order', 'orders', 'po', 'pending', 'outstanding', 'waiting', 'open orders'],
    run: () => safeRun('pending-po', async () => {
      const { data, error } = await supabase.from('purchase_orders').select('status')
      if (error) throw error
      return pendingSummary(data || [], ['closed', 'cancelled'], 'purchase order')
    }),
  },
  {
    id: 'pending-grn',
    label: 'How many GRNs are pending?',
    keywords: ['grn', 'goods', 'receipt', 'received', 'pending', 'goods receipt note', 'delivery', 'deliveries', 'outstanding'],
    run: () => safeRun('pending-grn', async () => {
      const { data, error } = await supabase.from('grn').select('status')
      if (error) throw error
      return pendingSummary(data || [], ['received', 'closed'], 'GRN')
    }),
  },
  {
    id: 'total-payments',
    label: 'How much have we paid out in total?',
    keywords: ['payment', 'payments', 'paid', 'total', 'disbursed', 'outgoing', 'money paid', 'how much paid'],
    run: () => safeRun('total-payments', async () => {
      const { data, error } = await supabase.from('payments').select('amount')
      if (error) throw error
      const total = (data || []).reduce((s, p) => s + (p.amount || 0), 0)
      return `${rupee(total)} paid out across ${data?.length || 0} payment${data?.length === 1 ? '' : 's'}.`
    }),
  },
  {
    id: 'active-vendors',
    label: 'How many active vendors do we have?',
    keywords: ['vendor', 'vendors', 'active', 'supplier', 'suppliers', 'how many suppliers'],
    run: () => safeRun('active-vendors', async () => {
      const { data, error } = await supabase.from('vendors').select('status')
      if (error) throw error
      const active = (data || []).filter(v => v.status === 'active').length
      return `${active} of ${data?.length || 0} vendors are active.`
    }),
  },
  {
    id: 'assets-summary',
    label: "What's our total asset count and value?",
    keywords: ['asset', 'assets', 'equipment', 'value', 'count', 'inventory value', 'fixed assets', 'how many assets'],
    run: () => safeRun('assets-summary', async () => {
      const { data, error } = await supabase.from('assets').select('purchase_value')
      if (error) throw error
      const total = (data || []).reduce((s, a) => s + (a.purchase_value || 0), 0)
      return `${data?.length || 0} assets tracked, worth ${rupee(total)} in total.`
    }),
  },
  {
    id: 'pending-warranty',
    label: 'How many warranty claims are pending?',
    keywords: ['warranty', 'claim', 'claims', 'pending', 'outstanding', 'open claims', 'unresolved'],
    run: () => safeRun('pending-warranty', async () => {
      const { data, error } = await supabase.from('warranty_claims').select('status')
      if (error) throw error
      return pendingSummary(data || [], ['Approved', 'Resolved', 'Rejected'], 'warranty claim')
    }),
  },
  {
    id: 'open-tasks-org',
    label: 'How many open tasks are there across the company?',
    keywords: ['task', 'tasks', 'open', 'company', 'team', 'incomplete', 'unfinished', 'in progress', 'outstanding tasks', 'everyone'],
    run: (profile) => safeRun('open-tasks-org', async () => {
      const [{ data: tasks, error: tErr }, { data: flows, error: fErr }] = await Promise.all([
        supabase.from('project_tasks').select('status,department_id'),
        supabase.from('department_status_flows').select('department_id,steps:department_status_steps(status_key,is_closed)').eq('organization_id', profile.organization_id),
      ])
      if (tErr) throw tErr
      if (fErr) throw fErr
      const closedByDept = {}
      ;(flows || []).forEach(f => { closedByDept[f.department_id || '__none'] = new Set((f.steps || []).filter(s => s.is_closed).map(s => s.status_key)) })
      const open = (tasks || []).filter(t => !closedByDept[t.department_id || '__none']?.has(t.status))
      return `${open.length} of ${tasks?.length || 0} tasks are still open across the company.`
    }),
  },
  {
    id: 'pending-customer-invoices',
    label: 'How much is pending in customer invoices?',
    keywords: ['customer', 'invoice', 'invoices', 'pending', 'receivable', 'receivables', 'unpaid', 'owed to us', 'outstanding'],
    run: () => safeRun('pending-customer-invoices', async () => {
      const { data, error } = await supabase.from('customer_invoices').select('status,total_amount')
      if (error) throw error
      const pending = (data || []).filter(i => !['paid', 'cancelled'].includes(i.status))
      const total = pending.reduce((s, i) => s + (i.total_amount || 0), 0)
      return `${rupee(total)} pending across ${pending.length} unpaid customer invoice${pending.length === 1 ? '' : 's'}.`
    }),
  },
  {
    id: 'products-customers-devices',
    label: 'How many products, active customers and devices do we have?',
    keywords: ['product', 'products', 'customer', 'customers', 'device', 'devices', 'catalog', 'how many clients', 'clients'],
    run: () => safeRun('products-customers-devices', async () => {
      const [prodR, custR, devR] = await Promise.all([
        supabase.from('products').select('id', { count: 'exact', head: true }),
        supabase.from('customers').select('status'),
        supabase.from('device_instances').select('id', { count: 'exact', head: true }),
      ])
      if (prodR.error) throw prodR.error
      if (custR.error) throw custR.error
      if (devR.error) throw devR.error
      const activeCustomers = (custR.data || []).filter(c => c.status === 'active').length
      return `${prodR.count || 0} products, ${activeCustomers} active customers, and ${devR.count || 0} devices tracked.`
    }),
  },
]

// Unchanged name/shape — every existing caller keeps working as-is.
export const QUESTIONS = ORG_QUESTIONS

// The question set this profile's role gets for the starter chips —
// personal for everyone, org-wide financial/ops questions added on top
// for leadership roles. Same role gate as App.jsx's isManager/isFinance/isHR.
export function questionsForRole(role) {
  const canSeeOrgInsights = ['admin', 'ceo', 'manager', 'department_head'].includes(role)
    || ['admin', 'ceo', 'finance'].includes(role) || ['admin', 'ceo', 'hr'].includes(role)
  return canSeeOrgInsights ? [...PERSONAL_QUESTIONS, ...ORG_QUESTIONS] : PERSONAL_QUESTIONS
}

// Broad enough to catch real conversational phrasing ("can you tell me how
// many..."), not just textbook question grammar — freestyle typed
// questions in Non-LLM mode go through exactly this same matcher, so the
// more filler this strips, the more of the actual signal words survive to
// be compared against a question's keywords.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'do', 'does', 'we', 'have', 'has', 'many', 'how', 'much', 'what', 'which', 'of', 'in', 'for', 'to', 'all',
  'please', 'can', 'you', 'tell', 'show', 'give', 'let', 'know', 'currently', 'right', 'now', 'us', 'about', 'there', 'any',
  'i', 'get', 'need', 'want', 'on', 'my', 'our', 'did', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these', 'those',
])

// Deliberately crude (no real linguistic stemmer, just the handful of
// endings that matter for this app's vocabulary) — good enough to make
// "task/tasks", "invoice/invoices", "requisition/requisitions" etc. match
// each other without hand-listing every singular/plural pair as a separate
// keyword, and cheap enough to run on every keystroke's worth of matching.
function stem(word) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

function tokenize(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w && !STOPWORDS.has(w)).map(stem)
}

// `pool` defaults to the org-wide set (unchanged behavior for any existing
// caller) but Non-LLM mode passes questionsForRole(role) so typed text can
// also match a personal question.
export function matchQuestion(text, pool = QUESTIONS) {
  const words = tokenize(text)
  if (!words.length) return null
  const joined = words.join(' ')
  let best = null
  let bestScore = 0
  for (const q of pool) {
    const score = q.keywords.reduce((s, kw) => {
      const kwWords = kw.split(' ').map(stem)
      const isPhrase = kwWords.length > 1
      // Multi-word phrases ("over budget", "this month") still match as a
      // substring of the whole (stemmed) sentence, and count for more —
      // they're far more distinctive than any single shared word (e.g.
      // "pending" alone appears in nearly every question here). Single-word
      // keywords must match a whole stemmed token — a raw substring check
      // let short keywords like 'pr' false-match anything containing those
      // letters (e.g. "project").
      const hit = isPhrase ? joined.includes(kwWords.join(' ')) : words.includes(kwWords[0])
      return s + (hit ? (isPhrase ? 2 : 1) : 0)
    }, 0)
    if (score > bestScore) { bestScore = score; best = q }
  }
  return bestScore > 0 ? best : null
}
