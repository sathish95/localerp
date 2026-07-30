import { useState, useEffect } from 'react'
import { supabase, rupee } from '../../lib/supabase'
import { Stat, StatRow, BarRow, EmptyState, Loading } from './widgetUi'

export function BudgetHealthWidget({ projectId }) {
  const [loading, setLoading] = useState(true)
  const [budgets, setBudgets] = useState([])

  useEffect(() => {
    let cancelled = false
    supabase.from('budgets').select('allocated,committed_amount,spent').eq('project_id', projectId)
      .then(({ data }) => { if (!cancelled) { setBudgets(data || []); setLoading(false) } })
    return () => { cancelled = true }
  }, [projectId])

  if (loading) return <Loading />
  if (budgets.length === 0) return <EmptyState icon="💳" text="No budget line set for this project" />

  const allocated = budgets.reduce((s, b) => s + (b.allocated || 0), 0)
  const committed = budgets.reduce((s, b) => s + (b.committed_amount || 0), 0)
  const spent = budgets.reduce((s, b) => s + (b.spent || 0), 0)
  const available = Math.max(0, allocated - committed)

  return (
    <div>
      <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 10 }}>Current snapshot — not filtered by dashboard period</div>
      <StatRow>
        <Stat label="Allocated" value={rupee(allocated)} color="#3b82f6" />
        <Stat label="Committed" value={rupee(committed)} color="#8b5cf6" />
        <Stat label="Spent" value={rupee(spent)} color="#f59e0b" />
        <Stat label="Available" value={rupee(available)} color={available > 0 ? '#10b981' : '#ef4444'} />
      </StatRow>
      <div style={{ display: 'flex', height: 8, borderRadius: 99, overflow: 'hidden', background: '#f1f5f9', gap: 2 }}>
        {allocated > 0 && <>
          <div style={{ width: `${Math.min(100, (spent / allocated) * 100)}%`, background: '#f59e0b' }} />
          <div style={{ width: `${Math.min(100, Math.max(0, ((committed - spent) / allocated) * 100))}%`, background: '#8b5cf6' }} />
        </>}
      </div>
    </div>
  )
}

export function SpendInPeriodWidget({ projectId, periodStart, periodEnd }) {
  const [loading, setLoading] = useState(true)
  const [expenses, setExpenses] = useState([])

  useEffect(() => {
    let cancelled = false
    supabase.from('expense_requests').select('category,total_amount,amount,expense_date').eq('project_id', projectId)
      .gte('expense_date', periodStart).lte('expense_date', periodEnd)
      .then(({ data }) => { if (!cancelled) { setExpenses(data || []); setLoading(false) } })
    return () => { cancelled = true }
  }, [projectId, periodStart, periodEnd])

  if (loading) return <Loading />
  if (expenses.length === 0) return <EmptyState icon="🧾" text="No expenses recorded in this period" />

  const total = expenses.reduce((s, e) => s + (e.total_amount || e.amount || 0), 0)
  const byCat = {}
  expenses.forEach(e => { const c = e.category || 'other'; byCat[c] = (byCat[c] || 0) + (e.total_amount || e.amount || 0) })
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1])
  const max = cats[0]?.[1] || 1

  return (
    <div>
      <StatRow>
        <Stat label="Total Spend" value={rupee(total)} color="#e11d48" />
        <Stat label="Expenses" value={expenses.length} color="#6366f1" />
      </StatRow>
      {cats.map(([cat, amt]) => <BarRow key={cat} label={cat} value={amt} max={max} color="#e11d48" fmt={rupee} />)}
    </div>
  )
}
