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

export const QUESTIONS = [
  {
    id: 'pending-expenses',
    label: 'How many expense approvals are pending?',
    keywords: ['expense', 'expenses', 'pending', 'approval', 'approvals'],
    run: () => safeRun('pending-expenses', async () => {
      const { data, error } = await supabase.from('expense_requests').select('status')
      if (error) throw error
      return pendingSummary(data || [], EXP_TRV_TERMINAL, 'expense request')
    }),
  },
  {
    id: 'pending-pr',
    label: 'How many purchase requisitions are pending?',
    keywords: ['purchase', 'requisition', 'requisitions', 'pr', 'procurement', 'pending'],
    run: () => safeRun('pending-pr', async () => {
      const { data, error } = await supabase.from('purchase_requisitions').select('status')
      if (error) throw error
      return pendingSummary(data || [], PR_TERMINAL, 'purchase requisition')
    }),
  },
  {
    id: 'pending-leave',
    label: 'How many leave requests are pending?',
    keywords: ['leave', 'leaves', 'pending', 'time off'],
    run: () => safeRun('pending-leave', async () => {
      const { data, error } = await supabase.from('leave_requests').select('status')
      if (error) throw error
      return pendingSummary(data || [], LEAVE_TERMINAL, 'leave request')
    }),
  },
  {
    id: 'pending-travel',
    label: 'How many travel requests are pending?',
    keywords: ['travel', 'trip', 'pending', 'approval'],
    run: () => safeRun('pending-travel', async () => {
      const { data, error } = await supabase.from('travel_requests').select('status')
      if (error) throw error
      return pendingSummary(data || [], EXP_TRV_TERMINAL, 'travel request')
    }),
  },
  {
    id: 'over-budget-projects',
    label: 'Which projects are over budget?',
    keywords: ['project', 'projects', 'over budget', 'overrun', 'over-budget'],
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
    keywords: ['budget', 'spent', 'total', 'utilization', 'projects'],
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
    keywords: ['spend', 'spent', 'this month', 'month', 'expenses', 'invoices'],
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
    keywords: ['invoice', 'invoices', 'pending', 'unpaid', 'amount'],
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
    keywords: ['department', 'departments', 'budget', 'health', 'over budget'],
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
    keywords: ['employee', 'employees', 'headcount', 'active', 'staff'],
    run: () => safeRun('active-employees', async () => {
      const { count, error } = await supabase.from('profiles').select('id', { count: 'exact' }).neq('is_active', false)
      if (error) throw error
      return `There are ${count || 0} active employees.`
    }),
  },
]

const STOPWORDS = new Set(['the', 'a', 'an', 'is', 'are', 'do', 'does', 'we', 'have', 'has', 'many', 'how', 'much', 'what', 'which', 'of', 'in', 'for', 'to', 'all'])

function tokenize(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w && !STOPWORDS.has(w))
}

export function matchQuestion(text) {
  const words = tokenize(text)
  if (!words.length) return null
  const joined = words.join(' ')
  let best = null
  let bestScore = 0
  for (const q of QUESTIONS) {
    const score = q.keywords.reduce((s, kw) => {
      // Multi-word phrases ("over budget", "this month") still match as a
      // substring of the whole sentence. Single-word keywords must match a
      // whole token — a raw substring check let short keywords like 'pr'
      // false-match anything containing those letters (e.g. "project").
      const hit = kw.includes(' ') ? joined.includes(kw) : words.includes(kw)
      return s + (hit ? 1 : 0)
    }, 0)
    if (score > bestScore) { bestScore = score; best = q }
  }
  return bestScore > 0 ? best : null
}
