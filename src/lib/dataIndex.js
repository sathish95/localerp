import { supabase, rupee } from './supabase'

const CACHE_MS = 5 * 60 * 1000
let cached = null
let cachedAt = 0

function monthStart() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

function bucketBy(rows, key) {
  const out = {}
  rows.forEach(r => { const k = r[key] || 'unknown'; out[k] = (out[k] || 0) + 1 })
  return out
}

// Generic status summary: byStatus is always accurate (plain JS bucketing, never
// sent to Postgres, so it can't hit the "invalid input value for enum" class of
// bug a server-side .in('status',[...]) filter can). `terminal` is only a rough
// heuristic for pendingCount — worst case it's mislabeled, never wrong/crashing.
function summarizeStatus(rows, { terminal = [], amountKeys = null } = {}) {
  const byStatus = bucketBy(rows, 'status')
  const pending = rows.filter(r => !terminal.includes(r.status))
  const amountOf = r => amountKeys ? (amountKeys.reduce((v, k) => v ?? r[k], null) || 0) : 0
  const out = { totalCount: rows.length, byStatus, pendingCount: pending.length }
  if (amountKeys) {
    out.totalAmount = rupee(rows.reduce((s, r) => s + amountOf(r), 0))
    out.pendingAmount = rupee(pending.reduce((s, r) => s + amountOf(r), 0))
  }
  return out
}

async function safeDomain(errors, id, fn) {
  try {
    return await fn()
  } catch (err) {
    errors[id] = err?.message || String(err)
    return null
  }
}

export async function buildDataIndex({ force = false } = {}) {
  if (!force && cached && Date.now() - cachedAt < CACHE_MS) return cached

  const errors = {}
  const index = { generatedAt: new Date().toISOString() }

  index.expenses = await safeDomain(errors, 'expenses', async () => {
    const { data, error } = await supabase.from('expense_requests').select('title,category,status,total_amount,amount,created_at').order('created_at', { ascending: false })
    if (error) throw error
    const rows = data || []
    const start = monthStart()
    const thisMonth = rows.filter(r => r.created_at && new Date(r.created_at) >= start)
    return {
      ...summarizeStatus(rows, { terminal: ['approved', 'rejected'], amountKeys: ['total_amount', 'amount'] }),
      thisMonthAmount: rupee(thisMonth.reduce((s, r) => s + (r.total_amount || r.amount || 0), 0)),
      // Bounded so this stays cheap regardless of company size — enough for
      // "what are my recent expenses"-style questions without a full dump.
      recent: rows.slice(0, 15).map(r => ({ title: r.title, category: r.category, amount: rupee(r.total_amount || r.amount), status: r.status })),
    }
  })

  index.travel = await safeDomain(errors, 'travel', async () => {
    const { data, error } = await supabase.from('travel_requests').select('from_location,to_location,status,estimated_cost,created_at').order('created_at', { ascending: false })
    if (error) throw error
    const rows = data || []
    return {
      ...summarizeStatus(rows, { terminal: ['approved', 'rejected'], amountKeys: ['estimated_cost'] }),
      recent: rows.slice(0, 15).map(r => ({ from: r.from_location, to: r.to_location, cost: rupee(r.estimated_cost), status: r.status })),
    }
  })

  index.purchaseRequisitions = await safeDomain(errors, 'purchaseRequisitions', async () => {
    const { data, error } = await supabase.from('purchase_requisitions').select('title,status,estimated_amount,estimated_total,created_at').order('created_at', { ascending: false })
    if (error) throw error
    const rows = data || []
    // Real pr_status enum (verified via REST probing) is only draft/submitted/approved/rejected.
    return {
      ...summarizeStatus(rows, { terminal: ['draft', 'approved', 'rejected'], amountKeys: ['estimated_total', 'estimated_amount'] }),
      list: rows.slice(0, 20).map(r => ({ title: r.title, amount: rupee(r.estimated_total || r.estimated_amount), status: r.status })),
    }
  })

  index.purchaseOrders = await safeDomain(errors, 'purchaseOrders', async () => {
    const { data, error } = await supabase.from('purchase_orders').select('status,total_amount')
    if (error) throw error
    return summarizeStatus(data || [], { terminal: ['closed', 'cancelled'], amountKeys: ['total_amount'] })
  })

  index.grn = await safeDomain(errors, 'grn', async () => {
    const { data, error } = await supabase.from('grn').select('status,received_amount')
    if (error) throw error
    // Real grn.status values (GRNPage.jsx): pending, partial, received, closed.
    return summarizeStatus(data || [], { terminal: ['received', 'closed'], amountKeys: ['received_amount'] })
  })

  index.invoices = await safeDomain(errors, 'invoices', async () => {
    const { data, error } = await supabase.from('invoices').select('vendor_name,status,total_amount,due_date,created_at').order('created_at', { ascending: false })
    if (error) throw error
    const rows = data || []
    return {
      ...summarizeStatus(rows, { terminal: ['paid', 'rejected'], amountKeys: ['total_amount'] }),
      list: rows.slice(0, 20).map(r => ({ vendor: r.vendor_name, amount: rupee(r.total_amount), status: r.status, dueDate: r.due_date })),
    }
  })

  index.payments = await safeDomain(errors, 'payments', async () => {
    const { data, error } = await supabase.from('payments').select('amount,invoice_type')
    if (error) throw error
    const rows = data || []
    return {
      totalCount: rows.length,
      totalAmount: rupee(rows.reduce((s, r) => s + (r.amount || 0), 0)),
      byType: bucketBy(rows, 'invoice_type'),
    }
  })

  index.leave = await safeDomain(errors, 'leave', async () => {
    const { data, error } = await supabase.from('leave_requests').select('status,leave_type')
    if (error) throw error
    const rows = data || []
    return { ...summarizeStatus(rows, { terminal: ['approved', 'rejected'] }), byType: bucketBy(rows, 'leave_type') }
  })

  index.timesheets = await safeDomain(errors, 'timesheets', async () => {
    const [logsR, usersR] = await Promise.all([
      supabase.from('time_logs').select('hours_worked,work_date,employee_id'),
      supabase.from('profiles').select('id,full_name'),
    ])
    if (logsR.error) throw logsR.error
    if (usersR.error) throw usersR.error
    const rows = logsR.data || []
    const users = usersR.data || []
    const start = monthStart()
    const thisMonth = rows.filter(r => r.work_date && new Date(r.work_date) >= start)
    const hrsByEmp = {}
    thisMonth.forEach(r => { hrsByEmp[r.employee_id] = (hrsByEmp[r.employee_id] || 0) + (r.hours_worked || 0) })
    const top = Object.entries(hrsByEmp)
      .map(([id, hrs]) => ({ name: users.find(u => u.id === id)?.full_name || 'Unknown', hours: Math.round(hrs) }))
      .sort((a, b) => b.hours - a.hours).slice(0, 5)
    return {
      totalHoursThisMonth: Math.round(thisMonth.reduce((s, r) => s + (r.hours_worked || 0), 0)),
      topContributors: top,
    }
  })

  index.projects = await safeDomain(errors, 'projects', async () => {
    const { data, error } = await supabase.from('projects').select('id,name,status,budget,spent')
    if (error) throw error
    const rows = data || []
    const totalBudget = rows.reduce((s, p) => s + (p.budget || 0), 0)
    const totalSpent = rows.reduce((s, p) => s + (p.spent || 0), 0)
    const overBudget = rows.filter(p => (p.spent || 0) > (p.budget || 0))
      .sort((a, b) => (b.spent - b.budget) - (a.spent - a.budget))
      .slice(0, 8)
      .map(p => ({ name: p.name, budget: rupee(p.budget), spent: rupee(p.spent), over: rupee(p.spent - p.budget) }))
    return {
      totalCount: rows.length,
      activeCount: rows.filter(p => p.status === 'active').length,
      totalBudget: rupee(totalBudget),
      totalSpent: rupee(totalSpent),
      overBudget,
      // Full roster (not just over-budget) so "list all projects"-style
      // questions can be answered, not just budget-health questions.
      list: rows.map(p => ({ name: p.name, status: p.status, budget: rupee(p.budget), spent: rupee(p.spent) })),
    }
  })

  index.departments = await safeDomain(errors, 'departments', async () => {
    const [deptR, userR, budR] = await Promise.all([
      supabase.from('departments').select('id,name'),
      supabase.from('profiles').select('id,department_id'),
      supabase.from('budgets').select('allocated,spent,department_id'),
    ])
    if (deptR.error) throw deptR.error
    if (userR.error) throw userR.error
    if (budR.error) throw budR.error
    const depts = deptR.data || []
    const users = userR.data || []
    const budgets = budR.data || []
    const list = depts.map(dep => {
      const deptBudgets = budgets.filter(b => b.department_id === dep.id)
      const allocated = deptBudgets.reduce((s, b) => s + (b.allocated || 0), 0)
      const spent = deptBudgets.reduce((s, b) => s + (b.spent || 0), 0)
      return {
        name: dep.name,
        headcount: users.filter(u => u.department_id === dep.id).length,
        budgetPct: allocated > 0 ? Math.round((spent / allocated) * 100) : null,
      }
    })
    return { totalCount: depts.length, list }
  })

  index.budgets = await safeDomain(errors, 'budgets', async () => {
    const { data, error } = await supabase.from('budgets').select('allocated,committed_amount,spent')
    if (error) throw error
    const rows = data || []
    return {
      totalAllocated: rupee(rows.reduce((s, b) => s + (b.allocated || 0), 0)),
      totalCommitted: rupee(rows.reduce((s, b) => s + (b.committed_amount || 0), 0)),
      totalSpent: rupee(rows.reduce((s, b) => s + (b.spent || 0), 0)),
    }
  })

  index.vendors = await safeDomain(errors, 'vendors', async () => {
    const { data, error } = await supabase.from('vendors').select('id,status')
    if (error) throw error
    const rows = data || []
    return { totalCount: rows.length, activeCount: rows.filter(v => v.status === 'active').length }
  })

  index.assets = await safeDomain(errors, 'assets', async () => {
    const { data, error } = await supabase.from('assets').select('status,purchase_value')
    if (error) throw error
    const rows = data || []
    return { totalCount: rows.length, totalValue: rupee(rows.reduce((s, a) => s + (a.purchase_value || 0), 0)), byStatus: bucketBy(rows, 'status') }
  })

  index.employees = await safeDomain(errors, 'employees', async () => {
    const { data, error } = await supabase.from('profiles').select('role,is_active')
    if (error) throw error
    const rows = data || []
    return {
      totalCount: rows.length,
      activeCount: rows.filter(u => u.is_active !== false).length,
      byRole: bucketBy(rows, 'role'),
    }
  })

  index.warranty = await safeDomain(errors, 'warranty', async () => {
    const { data, error } = await supabase.from('warranty_claims').select('status,estimated_cost')
    if (error) throw error
    return summarizeStatus(data || [], { terminal: ['Approved', 'Resolved', 'Rejected'], amountKeys: ['estimated_cost'] })
  })

  index.tasks = await safeDomain(errors, 'tasks', async () => {
    const { data, error } = await supabase.from('project_tasks').select('status')
    if (error) throw error
    return summarizeStatus(data || [], { terminal: ['closed'] })
  })

  index.allocations = await safeDomain(errors, 'allocations', async () => {
    const { data, error } = await supabase.from('allocations').select('status')
    if (error) throw error
    return summarizeStatus(data || [], { terminal: ['rejected', 'cancelled'] })
  })

  index.customerInvoices = await safeDomain(errors, 'customerInvoices', async () => {
    const { data, error } = await supabase.from('customer_invoices').select('status,total_amount')
    if (error) throw error
    return summarizeStatus(data || [], { terminal: ['paid', 'cancelled'], amountKeys: ['total_amount'] })
  })

  index.skillMatrix = await safeDomain(errors, 'skillMatrix', async () => {
    const { data, error } = await supabase.from('employee_skills').select('endorsed_by')
    if (error) throw error
    const rows = data || []
    return { totalTracked: rows.length, endorsed: rows.filter(r => r.endorsed_by).length, pendingEndorsement: rows.filter(r => !r.endorsed_by).length }
  })

  index.misc = await safeDomain(errors, 'misc', async () => {
    const [prodR, custR, devR] = await Promise.all([
      supabase.from('products').select('id,status'),
      supabase.from('customers').select('id,status'),
      supabase.from('device_instances').select('id,status'),
    ])
    if (prodR.error) throw prodR.error
    if (custR.error) throw custR.error
    if (devR.error) throw devR.error
    return {
      productsCount: (prodR.data || []).length,
      customersActive: (custR.data || []).filter(c => c.status === 'active').length,
      devicesTotal: (devR.data || []).length,
      devicesByStatus: bucketBy(devR.data || [], 'status'),
    }
  })

  index._errors = errors
  cached = index
  cachedAt = Date.now()
  return index
}

export function getCachedIndex() {
  return cached
}

export function indexAgeMs() {
  return cached ? Date.now() - cachedAt : null
}
