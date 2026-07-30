import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase, rupee, dateFmt, nextNum } from '../lib/supabase'
import { useProjects, ProjectSelect } from '../lib/useProjects.jsx'
import { recordPayment, getPaymentsFor } from '../lib/payments'
import { Modal, StatusBadge, SearchBox, Loader, Empty } from '../components/ui'
import { Plus, Edit2, FileCheck, Eye, DollarSign } from 'lucide-react'

const STATUSES = ['draft', 'sent', 'partially_paid', 'paid', 'cancelled']
const statusColors = { draft: '#94a3b8', sent: '#6366f1', partially_paid: '#f59e0b', paid: '#10b981', cancelled: '#ef4444' }

const initForm = () => ({
  invoice_number: '', project_id: '', milestone_id: '', customer_id: '',
  invoice_date: '', due_date: '', subtotal: '', gst_amount: '0', total_amount: '', status: 'draft', notes: '',
})
const initPayment = () => ({ amount: '', payment_date: new Date().toISOString().slice(0, 10), payment_method: 'bank_transfer', reference_number: '', notes: '' })

export default function CustomerInvoicesPage() {
  const { profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [invoices, setInvoices] = useState([])
  const [customers, setCustomers] = useState([])
  const [milestones, setMilestones] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [showDetail, setShowDetail] = useState(null)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(initForm())
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')
  const [payments, setPayments] = useState([])
  const [paymentForm, setPaymentForm] = useState(initPayment())
  const [recording, setRecording] = useState(false)

  const role = profile?.role || 'employee'
  const canEdit = ['admin', 'ceo', 'finance'].includes(role)
  const { projects } = useProjects()

  useEffect(() => { load() }, [])

  useEffect(() => {
    const pid = searchParams.get('project_id'), mid = searchParams.get('milestone_id')
    if (pid && canEdit) {
      setForm(f => ({ ...f, project_id: pid, milestone_id: mid || '' }))
      setShowModal(true)
      setSearchParams(prev => { const p = new URLSearchParams(prev); p.delete('project_id'); p.delete('milestone_id'); return p }, { replace: true })
    }
  }, [searchParams])

  useEffect(() => {
    if (form.project_id) loadMilestones(form.project_id)
    else setMilestones([])
  }, [form.project_id])

  async function load() {
    setLoading(true)
    const [inv, c] = await Promise.all([
      supabase.from('customer_invoices').select('*, customer:customers(name), project:projects(id,name), milestone:project_milestones(title)').order('created_at', { ascending: false }),
      supabase.from('customers').select('id,name').eq('status', 'active').order('name'),
    ])
    setInvoices(inv.data || [])
    setCustomers(c.data || [])
    setLoading(false)
  }

  async function loadMilestones(projectId) {
    const { data } = await supabase.from('project_milestones').select('id,title,invoice_amount').eq('project_id', projectId).order('due_date')
    setMilestones(data || [])
    // Pre-fill the amount when arriving via a milestone's "Bill" button (query param), not yet edited.
    setForm(f => {
      if (f.milestone_id && !f.total_amount) {
        const m = (data || []).find(x => x.id === f.milestone_id)
        if (m?.invoice_amount) return { ...f, total_amount: m.invoice_amount }
      }
      return f
    })
  }

  async function handleSubmit(e) {
    e.preventDefault(); setSubmitting(true); setErr('')
    try {
      if (!form.project_id) throw new Error('Project is required')
      const subtotal = parseFloat(form.subtotal) || 0
      const gst = parseFloat(form.gst_amount) || 0
      const total = parseFloat(form.total_amount) || (subtotal + gst)
      const payload = {
        invoice_number: form.invoice_number, project_id: form.project_id,
        milestone_id: form.milestone_id || null, customer_id: form.customer_id || null,
        invoice_date: form.invoice_date || null, due_date: form.due_date || null,
        subtotal: subtotal || null, gst_amount: gst, total_amount: total,
        status: form.status, notes: form.notes || null,
      }
      if (editing) {
        const { error } = await supabase.from('customer_invoices').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        if (!payload.invoice_number) payload.invoice_number = await nextNum('invoice')
        const { error } = await supabase.from('customer_invoices').insert({ ...payload, created_by: profile.id })
        if (error) throw error
        if (form.milestone_id) {
          await supabase.from('project_milestones').update({ billing_status: 'invoiced', invoiced_at: new Date().toISOString() }).eq('id', form.milestone_id)
        }
      }
      setShowModal(false); setEditing(null); setForm(initForm()); load()
    } catch (e) { setErr(e.message) } finally { setSubmitting(false) }
  }

  function openEdit(inv) {
    setEditing(inv)
    setForm({
      invoice_number: inv.invoice_number || '', project_id: inv.project_id || '', milestone_id: inv.milestone_id || '',
      customer_id: inv.customer_id || '', invoice_date: inv.invoice_date || '', due_date: inv.due_date || '',
      subtotal: inv.subtotal || '', gst_amount: inv.gst_amount || '0', total_amount: inv.total_amount || '',
      status: inv.status || 'draft', notes: inv.notes || '',
    })
    setErr(''); setShowModal(true)
  }

  async function openDetail(inv) {
    setShowDetail(inv)
    setPayments(await getPaymentsFor('customer', inv.id))
  }

  async function submitPayment() {
    if (!paymentForm.amount) return
    setRecording(true)
    try {
      await recordPayment({ invoice_type: 'customer', invoice_id: showDetail.id, ...paymentForm, recorded_by: profile.id })
      setPaymentForm(initPayment())
      const { data } = await supabase.from('customer_invoices').select('*, customer:customers(name), project:projects(id,name), milestone:project_milestones(title)').eq('id', showDetail.id).single()
      setShowDetail(data); setPayments(await getPaymentsFor('customer', showDetail.id)); load()
    } catch (e) { alert(e.message) } finally { setRecording(false) }
  }

  const filtered = invoices.filter(i => {
    const ms = !search || i.invoice_number?.toLowerCase().includes(search.toLowerCase()) || i.customer?.name?.toLowerCase().includes(search.toLowerCase()) || i.project?.name?.toLowerCase().includes(search.toLowerCase())
    const mf = statusFilter === 'all' || i.status === statusFilter
    return ms && mf
  })

  const totalAmount = invoices.reduce((s, i) => s + (i.total_amount || 0), 0)
  const paidAmount = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total_amount || 0), 0)
  const outstanding = invoices.filter(i => !['paid', 'cancelled'].includes(i.status)).reduce((s, i) => s + (i.total_amount || 0), 0)

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Customer Invoices</div>
          <div className="page-subtitle">Bill projects & milestones, track receivables</div>
        </div>
        {canEdit && <button className="btn btn-primary" onClick={() => { setEditing(null); setForm(initForm()); setErr(''); setShowModal(true) }}><Plus size={15} /> New Invoice</button>}
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {[
          { label: 'Total Invoices', value: invoices.length, color: '#6366f1' },
          { label: 'Total Value', value: rupee(totalAmount), color: '#3b82f6' },
          { label: 'Paid', value: rupee(paidAmount), color: '#10b981' },
          { label: 'Outstanding', value: rupee(outstanding), color: '#f59e0b' },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={() => setStatusFilter('all')} style={{ padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 12, background: statusFilter === 'all' ? '#1e293b' : 'var(--surface)', color: statusFilter === 'all' ? '#fff' : 'var(--ink-soft)' }}>
          All ({invoices.length})
        </button>
        {STATUSES.map(s => (
          <button key={s} onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)} style={{
            padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 12, textTransform: 'capitalize',
            background: statusFilter === s ? statusColors[s] : `${statusColors[s]}15`, color: statusFilter === s ? '#fff' : statusColors[s],
          }}>
            {s.replace('_', ' ')} ({invoices.filter(i => i.status === s).length})
          </button>
        ))}
      </div>

      <div className="table-wrap">
        <div className="table-toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Search invoices..." />
          <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--ink-muted)' }}>{filtered.length} records</span>
        </div>
        {filtered.length === 0 ? (
          <Empty icon={<FileCheck size={40} />} title="No customer invoices found" desc="Bill a project or milestone to get started" />
        ) : (
          <table>
            <thead><tr><th>Invoice #</th><th>Project</th><th>Milestone</th><th>Customer</th><th>Amount</th><th>Due Date</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.map(inv => (
                <tr key={inv.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: 'var(--c1)' }}>{inv.invoice_number}</td>
                  <td className="td-bold">{inv.project?.name || '—'}</td>
                  <td style={{ fontSize: 12, color: '#64748b' }}>{inv.milestone?.title || '—'}</td>
                  <td>{inv.customer?.name || '—'}</td>
                  <td style={{ fontWeight: 700 }}>{rupee(inv.total_amount)}</td>
                  <td style={{ color: inv.due_date && new Date(inv.due_date) < new Date() && !['paid', 'cancelled'].includes(inv.status) ? '#ef4444' : 'inherit' }}>{dateFmt(inv.due_date)}</td>
                  <td><StatusBadge status={inv.status} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openDetail(inv)} title="View"><Eye size={13} /></button>
                      {canEdit && <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openEdit(inv)} title="Edit"><Edit2 size={13} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create/Edit Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Invoice' : 'New Customer Invoice'} size="lg"
        footer={<><button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button><button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>{submitting ? 'Saving...' : editing ? 'Update' : 'Create Invoice'}</button></>}>
        {err && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{err}</div>}
        <div className="form-group">
          <label className="form-label">Project *</label>
          <ProjectSelect value={form.project_id} onChange={v => setForm(f => ({ ...f, project_id: v, milestone_id: '' }))} projects={projects} required />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Milestone (optional)</label>
            <select className="form-select" value={form.milestone_id} onChange={e => {
              const m = milestones.find(x => x.id === e.target.value)
              setForm(f => ({ ...f, milestone_id: e.target.value, total_amount: m?.invoice_amount || f.total_amount }))
            }} disabled={!form.project_id}>
              <option value="">No milestone</option>
              {milestones.map(m => <option key={m.id} value={m.id}>{m.title} ({rupee(m.invoice_amount || 0)})</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Customer</label>
            <select className="form-select" value={form.customer_id} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))}>
              <option value="">Select customer</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Invoice Number</label>
            <input className="form-input" value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))} placeholder="Auto-generated if blank" />
          </div>
          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="form-select" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {STATUSES.map(s => <option key={s} value={s} style={{ textTransform: 'capitalize' }}>{s.replace('_', ' ')}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Invoice Date</label><input className="form-input" type="date" value={form.invoice_date} onChange={e => setForm(f => ({ ...f, invoice_date: e.target.value }))} /></div>
          <div className="form-group"><label className="form-label">Due Date</label><input className="form-input" type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} /></div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Subtotal (₹)</label>
            <input className="form-input" type="number" value={form.subtotal} onChange={e => { const sub = parseFloat(e.target.value) || 0; const gst = parseFloat(form.gst_amount) || 0; setForm(f => ({ ...f, subtotal: e.target.value, total_amount: (sub + gst).toFixed(2) })) }} />
          </div>
          <div className="form-group">
            <label className="form-label">GST (₹)</label>
            <input className="form-input" type="number" value={form.gst_amount} onChange={e => { const gst = parseFloat(e.target.value) || 0; const sub = parseFloat(form.subtotal) || 0; setForm(f => ({ ...f, gst_amount: e.target.value, total_amount: (sub + gst).toFixed(2) })) }} />
          </div>
        </div>
        <div className="form-group"><label className="form-label">Total Amount (₹) *</label><input className="form-input" type="number" value={form.total_amount} onChange={e => setForm(f => ({ ...f, total_amount: e.target.value }))} required /></div>
        <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
      </Modal>

      {/* Detail Modal */}
      <Modal open={!!showDetail} onClose={() => setShowDetail(null)} title="Invoice Details" size="lg"
        footer={<><button className="btn btn-ghost" onClick={() => setShowDetail(null)}>Close</button></>}>
        {showDetail && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 800, color: 'var(--c1)' }}>{showDetail.invoice_number}</div>
              <StatusBadge status={showDetail.status} />
            </div>
            <div className="grid-2" style={{ marginBottom: 16 }}>
              {[
                ['Project', showDetail.project?.name], ['Milestone', showDetail.milestone?.title],
                ['Customer', showDetail.customer?.name], ['Due Date', dateFmt(showDetail.due_date)],
                ['Total Amount', rupee(showDetail.total_amount)],
              ].map(([k, v]) => (
                <div key={k} style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--surface)' }}>
                  <div style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 600, marginBottom: 2 }}>{k}</div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{v || '—'}</div>
                </div>
              ))}
            </div>

            <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Payments</div>
              {payments.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>No payments recorded yet</div> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                  {payments.map(p => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 10px', background: '#fff', borderRadius: 6 }}>
                      <span>{dateFmt(p.payment_date)} · {p.payment_method || '—'} {p.reference_number ? `(${p.reference_number})` : ''}</span>
                      <strong>{rupee(p.amount)}</strong>
                    </div>
                  ))}
                </div>
              )}
              {canEdit && showDetail.status !== 'paid' && showDetail.status !== 'cancelled' && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <input className="form-input" type="number" placeholder="Amount" value={paymentForm.amount} onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))} style={{ maxWidth: 110 }} />
                  <input className="form-input" type="date" value={paymentForm.payment_date} onChange={e => setPaymentForm(f => ({ ...f, payment_date: e.target.value }))} style={{ maxWidth: 140 }} />
                  <select className="form-select" value={paymentForm.payment_method} onChange={e => setPaymentForm(f => ({ ...f, payment_method: e.target.value }))} style={{ maxWidth: 140 }}>
                    {['bank_transfer', 'cheque', 'upi', 'cash', 'other'].map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
                  </select>
                  <input className="form-input" placeholder="Reference #" value={paymentForm.reference_number} onChange={e => setPaymentForm(f => ({ ...f, reference_number: e.target.value }))} style={{ maxWidth: 130 }} />
                  <button className="btn btn-primary btn-sm" disabled={!paymentForm.amount || recording} onClick={submitPayment}><DollarSign size={12} /> Record Payment</button>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
