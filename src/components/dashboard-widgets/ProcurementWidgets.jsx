import { useState, useEffect } from 'react'
import { supabase, rupee } from '../../lib/supabase'
import { Stat, StatRow, BarRow, EmptyState, Loading } from './widgetUi'

const PR_STATUS_LABELS = {
  draft: 'Draft', procurement_lead_review: 'Proc. Lead Review', pm_review: 'PM Review',
  cto_review: 'CTO Review', finance_review: 'Finance Review', ceo_review: 'CEO Review',
  approved: 'Approved', cancelled: 'Cancelled',
}
const IN_REVIEW = ['procurement_lead_review', 'pm_review', 'cto_review', 'finance_review', 'ceo_review']

export function ProcurementPipelineWidget({ projectId }) {
  const [loading, setLoading] = useState(true)
  const [prs, setPrs] = useState([])

  useEffect(() => {
    let cancelled = false
    supabase.from('purchase_requisitions').select('status,estimated_total,estimated_amount').eq('project_id', projectId)
      .then(({ data }) => { if (!cancelled) { setPrs(data || []); setLoading(false) } })
    return () => { cancelled = true }
  }, [projectId])

  if (loading) return <Loading />
  if (prs.length === 0) return <EmptyState icon="🛒" text="No procurement requests for this project" />

  const inReview = prs.filter(p => IN_REVIEW.includes(p.status)).length
  const approved = prs.filter(p => p.status === 'approved').length
  const draft = prs.filter(p => p.status === 'draft').length
  const cancelled = prs.filter(p => p.status === 'cancelled').length
  const value = prs.filter(p => p.status === 'approved').reduce((s, p) => s + (p.estimated_total || p.estimated_amount || 0), 0)

  return (
    <div>
      <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 10 }}>Current snapshot — not filtered by dashboard period</div>
      <StatRow>
        <Stat label="Total" value={prs.length} color="#6366f1" />
        <Stat label="In Review" value={inReview} color="#f59e0b" />
        <Stat label="Approved" value={approved} color="#10b981" />
        <Stat label="Approved Value" value={rupee(value)} color="#3b82f6" />
      </StatRow>
      {[['draft', draft], ['in_review_group', inReview], ['approved', approved], ['cancelled', cancelled]].filter(([, n]) => n > 0).map(([k, n]) => (
        <BarRow key={k} label={k === 'in_review_group' ? 'In Review' : PR_STATUS_LABELS[k] || k} value={n} max={prs.length}
          color={k === 'approved' ? '#10b981' : k === 'cancelled' ? '#64748b' : k === 'draft' ? '#94a3b8' : '#f59e0b'} />
      ))}
    </div>
  )
}

export function RequestsInPeriodWidget({ projectId, periodStart, periodEnd }) {
  const [loading, setLoading] = useState(true)
  const [prs, setPrs] = useState([])

  useEffect(() => {
    let cancelled = false
    supabase.from('purchase_requisitions').select('status,estimated_total,estimated_amount,created_at').eq('project_id', projectId)
      .gte('created_at', periodStart).lte('created_at', periodEnd + 'T23:59:59')
      .then(({ data }) => { if (!cancelled) { setPrs(data || []); setLoading(false) } })
    return () => { cancelled = true }
  }, [projectId, periodStart, periodEnd])

  if (loading) return <Loading />
  if (prs.length === 0) return <EmptyState icon="🛒" text="No requests raised in this period" />

  const approved = prs.filter(p => p.status === 'approved').length
  const rejectedOrCancelled = prs.filter(p => p.status === 'cancelled').length
  const value = prs.reduce((s, p) => s + (p.estimated_total || p.estimated_amount || 0), 0)

  return (
    <div>
      <StatRow>
        <Stat label="Requests Raised" value={prs.length} color="#6366f1" />
        <Stat label="Approved" value={approved} color="#10b981" />
        <Stat label="Cancelled" value={rejectedOrCancelled} color="#ef4444" />
        <Stat label="Total Value" value={rupee(value)} color="#3b82f6" />
      </StatRow>
    </div>
  )
}
