import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { canActOn, buildApprovalUpdate, statusLabel, getChain } from '../lib/approvalFlow.js'
import ApprovalChainViz from '../components/ui/ApprovalChainViz'
import { supabase, rupee, dateFmt } from '../lib/supabase'
import { Tabs, StatusBadge, Loader, Empty, Modal } from '../components/ui'
import { CheckCircle, XCircle, Eye, MinusCircle } from 'lucide-react'

export default function ApprovalsPage() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('pending')
  const [expenses, setExpenses] = useState([])
  const [travel, setTravel] = useState([])
  const [procurement, setProcurement] = useState([])
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [showDetail, setShowDetail] = useState(null)
  const [detailType, setDetailType] = useState('')
  const [reviewNote, setReviewNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const role = profile?.role || 'manager'

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [e, t, p, inv] = await Promise.all([
        supabase.from('expense_requests').select('*, requester:profiles!requested_by(full_name, role, department:departments(name))').order('created_at', { ascending: false }),
        supabase.from('travel_requests').select('*, requester:profiles!requested_by(full_name, role)').order('created_at', { ascending: false }),
        supabase.from('purchase_requisitions').select('*, requester:profiles!requested_by(full_name)').order('created_at', { ascending: false }),
        supabase.from('invoices').select('*, vendor:vendors(name)').order('created_at', { ascending: false }),
      ])
      setExpenses(e.data || [])
      setTravel(t.data || [])
      setProcurement(p.data || [])
      setInvoices(inv.data || [])
    } finally { setLoading(false) }
  }

  async function handleAction(item, type, action) {
    setSubmitting(true)
    try {
      const table = type === 'expense' ? 'expense_requests' : type === 'travel' ? 'travel_requests' : type === 'procurement' ? 'purchase_requisitions' : 'invoices'
      const submitterRole = item.requester?.role || item.employee?.role || 'employee'
      const update = (type === 'expense' || type === 'travel')
        ? buildApprovalUpdate(action, item.status, role, submitterRole, profile.id, reviewNote)
        : { status: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'closed',
            approved_by: profile.id, approved_at: new Date().toISOString() }
      await supabase.from(table).update(update).eq('id', item.id)
      if (type === 'expense' || type === 'travel' || type === 'procurement') {
        await supabase.from('approval_logs').insert({
          entity_type: type,
          entity_id: item.id,
          performed_by: profile.id,
          action,
          from_status: item.status,
          to_status: update.status,
          comments: reviewNote,
        })
      }
      setShowDetail(null); setReviewNote(''); load()
    } catch (err) { alert(err.message) }
    finally { setSubmitting(false) }
  }

  const pendingExp = expenses.filter(e => e.status === 'submitted')
  const pendingTravel = travel.filter(t => t.status === 'submitted')
  const pendingProcurement = procurement.filter(p => p.status === 'submitted')
  const pendingInvoices = role === 'finance' || role === 'admin' || role === 'ceo' ? invoices.filter(i => i.status === 'uploaded') : []

  const tabs = [
    { id: 'pending', label: 'Pending', count: pendingExp.length + pendingTravel.length + pendingProcurement.length + pendingInvoices.length },
    { id: 'expenses', label: 'Expenses', count: expenses.length },
    { id: 'travel', label: 'Travel', count: travel.length },
    { id: 'procurement', label: 'Purchase Req.', count: procurement.length },
    { id: 'invoices', label: 'Invoices', count: invoices.length },
  ]

  if (loading) return <Loader />

  function ReviewActions({ item, type }) {
    return (
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => { setShowDetail(item); setDetailType(type) }}><Eye size={13} /></button>
        {item.status === 'submitted' ? <>
          <button className="btn btn-danger btn-sm" onClick={async () => { setReviewNote(''); await handleAction(item, type, 'reject') }}><XCircle size={13} /> Reject</button>
          <button className="btn btn-success btn-sm" onClick={async () => { setReviewNote(''); await handleAction(item, type, 'approve') }}><CheckCircle size={13} /> Approve</button>
        </> : null}
      </div>
    )
  }

  function ExpenseTable({ data }) {
    return (
      <table>
        <thead><tr><th>Ref #</th><th>Requester</th><th>Title</th><th>Category</th><th>Amount</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {data.length === 0 ? <tr><td colSpan={8}><Empty icon="✅" title="All clear!" /></td></tr> : data.map(item => (
            <tr key={item.id}>
              <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--c1)', fontWeight: 700 }}>{item.expense_number || '—'}</td>
              <td>{item.requester?.full_name}</td>
              <td className="td-bold">{item.title}</td>
              <td><span className="badge badge-info">{item.category}</span></td>
              <td className="td-bold">{rupee(item.amount)}</td>
              <td>{dateFmt(item.expense_date)}</td>
              <td><StatusBadge status={item.status} /></td>
              <td><ReviewActions item={item} type="expense" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  function TravelTable({ data }) {
    return (
      <table>
        <thead><tr><th>Requester</th><th>From</th><th>To</th><th>Purpose</th><th>Dates</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {data.length === 0 ? <tr><td colSpan={7}><Empty icon="✅" title="All clear!" /></td></tr> : data.map(item => (
            <tr key={item.id}>
              <td>{item.requester?.full_name}</td>
              <td>{item.from_location}</td>
              <td>{item.to_location}</td>
              <td className="td-bold">{item.purpose}</td>
              <td>{dateFmt(item.travel_date)} → {dateFmt(item.return_date)}</td>
              <td><StatusBadge status={item.status} /></td>
              <td><ReviewActions item={item} type="travel" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  function ProcTable({ data }) {
    return (
      <table>
        <thead><tr><th>PR #</th><th>Requester</th><th>Title</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {data.length === 0 ? <tr><td colSpan={6}><Empty icon="✅" title="All clear!" /></td></tr> : data.map(item => (
            <tr key={item.id}>
              <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--c1)', fontWeight: 700 }}>{item.pr_number || '—'}</td>
              <td>{item.requester?.full_name}</td>
              <td className="td-bold">{item.title || item.description}</td>
              <td>{rupee(item.estimated_amount)}</td>
              <td><StatusBadge status={item.status} /></td>
              <td><ReviewActions item={item} type="procurement" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  function InvoiceTable({ data }) {
    return (
      <table>
        <thead><tr><th>Invoice #</th><th>Vendor</th><th>Amount</th><th>Due Date</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {data.length === 0 ? <tr><td colSpan={6}><Empty icon="✅" title="All clear!" /></td></tr> : data.map(item => (
            <tr key={item.id}>
              <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--c1)', fontWeight: 700 }}>{item.invoice_number}</td>
              <td>{item.vendor?.name}</td>
              <td className="td-bold">{rupee(item.amount)}</td>
              <td>{dateFmt(item.due_date)}</td>
              <td><StatusBadge status={item.status} /></td>
              <td><ReviewActions item={item} type="invoice" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Approvals</div>
          <div className="page-subtitle">Review and approve pending requests</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { label: 'Expenses', count: pendingExp.length, color: '#6366f1' },
            { label: 'Travel', count: pendingTravel.length, color: '#ec4899' },
            { label: 'Procurement', count: pendingProcurement.length, color: '#f59e0b' },
          ].map(s => (
            <div key={s.label} style={{ padding: '8px 14px', borderRadius: 10, background: `${s.color}10`, border: `1px solid ${s.color}25`, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.count}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 600 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="table-wrap">
        {tab === 'pending' && (
          <>
            {pendingExp.length > 0 && <>
              <div style={{ padding: '12px 16px', fontWeight: 700, fontSize: 13, background: '#f5f3ff', borderBottom: '1px solid var(--border)', color: '#7c3aed' }}>💰 Pending Expenses ({pendingExp.length})</div>
              <ExpenseTable data={pendingExp} />
            </>}
            {pendingTravel.length > 0 && <>
              <div style={{ padding: '12px 16px', fontWeight: 700, fontSize: 13, background: '#fdf2f8', borderBottom: '1px solid var(--border)', color: '#db2777' }}>✈️ Pending Travel ({pendingTravel.length})</div>
              <TravelTable data={pendingTravel} />
            </>}
            {pendingProcurement.length > 0 && <>
              <div style={{ padding: '12px 16px', fontWeight: 700, fontSize: 13, background: '#fffbeb', borderBottom: '1px solid var(--border)', color: '#d97706' }}>🛒 Pending Procurement ({pendingProcurement.length})</div>
              <ProcTable data={pendingProcurement} />
            </>}
            {(pendingExp.length + pendingTravel.length + pendingProcurement.length) === 0 && (
              <Empty icon="🎉" title="No pending approvals" desc="Everything is up to date!" />
            )}
          </>
        )}
        {tab === 'expenses' && <ExpenseTable data={expenses} />}
        {tab === 'travel' && <TravelTable data={travel} />}
        {tab === 'procurement' && <ProcTable data={procurement} />}
        {tab === 'invoices' && <InvoiceTable data={invoices} />}
      </div>

      {/* Detail Modal */}
      <Modal open={!!showDetail} onClose={() => setShowDetail(null)} title="Request Details" size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowDetail(null)}>Close</button>
          {(showDetail?.status === 'submitted') && <>
            <button className="btn btn-danger" onClick={() => handleAction(showDetail, detailType, 'reject')} disabled={submitting}><XCircle size={14}/> Reject</button>
            <button className="btn btn-success" onClick={() => handleAction(showDetail, detailType, 'approve')} disabled={submitting}><CheckCircle size={14}/> Approve</button>
          </>}
        </>}
      >
        {showDetail && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--c1)', fontWeight: 700 }}>{showDetail.expense_number || showDetail.pr_number || showDetail.invoice_number || '—'}</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{showDetail.title || showDetail.purpose || showDetail.description}</div>
              </div>
              <StatusBadge status={showDetail.status} />
            </div>
            <div className="grid-2" style={{ gap: 12, marginBottom: 16 }}>
              {[
                ['Amount', rupee(showDetail.amount || showDetail.estimated_amount)],
                ['Submitted', dateFmt(showDetail.created_at)],
                ['Requester', showDetail.requester?.full_name || '—'],
                ...(detailType === 'expense' ? [['Category', showDetail.category], ['Date', dateFmt(showDetail.expense_date)]] : []),
                ...(detailType === 'travel' ? [['From', showDetail.from_location], ['To', showDetail.to_location]] : []),
              ].map(([k, v]) => (
                <div key={k} style={{ padding: '10px 14px', background: 'var(--surface)', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-muted)', marginBottom: 2 }}>{k}</div>
                  <div style={{ fontWeight: 600 }}>{v}</div>
                </div>
              ))}
            </div>
            {(showDetail.description || showDetail.purpose) && (
              <div style={{ padding: '12px 14px', background: 'var(--surface)', borderRadius: 10, fontSize: 13, color: 'var(--ink-soft)' }}>{showDetail.description || showDetail.purpose}</div>
            )}
            <div className="form-group" style={{ marginTop: 16 }}>
              <label className="form-label">Your Comments</label>
              <textarea className="form-textarea" value={reviewNote} onChange={e => setReviewNote(e.target.value)} placeholder="Add reason or comments..." />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
