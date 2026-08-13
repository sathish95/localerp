import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase, rupee, dateFmt } from '../lib/supabase'
import { Modal, StatusBadge, SearchBox, Loader, Empty } from '../components/ui'
import { useProjects, ProjectSelect } from '../lib/useProjects.jsx'
import { runMatchAndSave, applyOverride, getMatchTolerance } from '../lib/threeWayMatch'
import { recordPayment, getPaymentsFor } from '../lib/payments'
import AIDockedPanel from '../components/AIDockedPanel'
import { VendorInvoiceAiTab } from '../components/AIActionTabs'
import { Plus, Edit2, FileText, Eye, DollarSign, Upload, ExternalLink, Paperclip, ShieldCheck, AlertTriangle, Sparkles } from 'lucide-react'

const STATUSES = ['uploaded', 'processing', 'verified', 'matched', 'rejected', 'paid']
// 'matched' stays in STATUSES only for backward-compatible display of old rows —
// the automated 3-way-match verdict now lives exclusively in match_status.
const EDITABLE_STATUSES = STATUSES.filter(s => s !== 'matched')
const statusColors = {
  uploaded: '#6366f1', processing: '#f59e0b', verified: '#3b82f6',
  matched: '#8b5cf6', rejected: '#ef4444', paid: '#10b981'
}
const MATCH_COLORS = {
  unmatched: { bg: '#f1f5f9', color: '#64748b', label: 'Unmatched' },
  matched: { bg: '#dcfce7', color: '#15803d', label: 'Matched' },
  variance: { bg: '#fef3c7', color: '#b45309', label: 'Variance' },
  override_approved: { bg: '#ede9fe', color: '#6d28d9', label: 'Override Approved' },
}

const initForm = () => ({
  invoice_number: '', vendor_id: '', vendor_name: '',
  invoice_date: '', due_date: '', subtotal: '',
  gst_amount: '0', total_amount: '', status: 'uploaded', notes: '', project_id: '', po_id: ''
})

export default function InvoicesPage() {
  const { profile } = useAuth()
  const [searchParams] = useSearchParams()
  const [invoices, setInvoices] = useState([])
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [showDetail, setShowDetail] = useState(null)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(initForm())
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')
  const [uploadFile, setUploadFile] = useState(null)
  const [purchaseOrders, setPurchaseOrders] = useState([])
  const [tolerance, setTolerance] = useState(5)
  const [matching, setMatching] = useState(false)
  const [overrideNote, setOverrideNote] = useState('')
  const [payments, setPayments] = useState([])
  const [paymentForm, setPaymentForm] = useState({ amount: '', payment_date: new Date().toISOString().slice(0, 10), payment_method: 'bank_transfer', reference_number: '' })
  const [recording, setRecording] = useState(false)

  const [showAiPanel, setShowAiPanel] = useState(searchParams.get('ai') === '1')

  const role = profile?.role || 'employee'
  const canEdit = ['admin', 'ceo', 'finance'].includes(role)
  const { projects } = useProjects()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [inv, v, po, tol] = await Promise.all([
      supabase.from('invoices').select('*, vendor:vendors(name, gst_number), project:projects(id,name), po:purchase_orders(po_number,total_amount)').order('created_at', { ascending: false }),
      supabase.from('vendors').select('id, name').eq('status', 'active'),
      supabase.from('purchase_orders').select('id, po_number, vendor_id, total_amount'),
      getMatchTolerance(),
    ])
    setInvoices(inv.data || [])
    setVendors(v.data || [])
    setPurchaseOrders(po.data || [])
    setTolerance(tol)
    setLoading(false)
  }

  async function openDetail(inv) {
    setShowDetail(inv)
    setPayments(await getPaymentsFor('vendor', inv.id))
  }

  async function submitPayment() {
    if (!paymentForm.amount) return
    setRecording(true)
    try {
      await recordPayment({ invoice_type: 'vendor', invoice_id: showDetail.id, ...paymentForm, recorded_by: profile.id })
      setPaymentForm({ amount: '', payment_date: new Date().toISOString().slice(0, 10), payment_method: 'bank_transfer', reference_number: '' })
      await load(); await refreshDetail(showDetail.id)
      setPayments(await getPaymentsFor('vendor', showDetail.id))
    } catch (e) { alert(e.message) } finally { setRecording(false) }
  }

  async function refreshDetail(invoiceId) {
    const { data } = await supabase.from('invoices').select('*, vendor:vendors(name, gst_number), project:projects(id,name), po:purchase_orders(po_number,total_amount)').eq('id', invoiceId).single()
    if (data) setShowDetail(data)
  }

  async function runMatch(invoiceId, poId) {
    if (!poId) { alert('Select a PO on this invoice first.'); return }
    setMatching(true)
    try {
      await runMatchAndSave(invoiceId, poId, tolerance)
      await load(); await refreshDetail(invoiceId)
    } catch (e) { alert(e.message) } finally { setMatching(false) }
  }

  async function override(invoiceId) {
    await applyOverride(invoiceId, profile.id, overrideNote)
    setOverrideNote('')
    await load(); await refreshDetail(invoiceId)
  }

  async function handleSubmit(e) {
    e.preventDefault(); setSubmitting(true); setErr('')
    try {
      const subtotal = parseFloat(form.subtotal) || 0
      const gst = parseFloat(form.gst_amount) || 0
      const total = parseFloat(form.total_amount) || (subtotal + gst)
      const selectedVendor = vendors.find(v => v.id === form.vendor_id)
      const payload = {
        invoice_number: form.invoice_number,
        vendor_id: form.vendor_id || null,
        vendor_name: selectedVendor?.name || form.vendor_name || null,
        invoice_date: form.invoice_date || null,
        due_date: form.due_date || null,
        subtotal: subtotal || null,
        gst_amount: gst,
        total_amount: total,
        status: form.status,
        project_id: form.project_id || null,
        po_id: form.po_id || null,
      }

      // Upload document to Supabase Storage
      if (uploadFile) {
        const ext = uploadFile.name.split('.').pop()
        const path = `invoices/${Date.now()}-${uploadFile.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`
        const { error: upErr } = await supabase.storage.from('invoices').upload(path, uploadFile, { upsert: true })
        if (!upErr) {
          const { data: urlData } = supabase.storage.from('invoices').getPublicUrl(path)
          payload.document_url = urlData?.publicUrl
        }
      }

      if (editing) {
        const { error } = await supabase.from('invoices').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('invoices').insert({ ...payload, created_by: profile.id })
        if (error) throw error
      }
      setShowModal(false); setUploadFile(null); load()
    } catch (e) { setErr(e.message) }
    finally { setSubmitting(false) }
  }

  async function updateStatus(id, status) {
    const { error } = await supabase.from('invoices').update({
      status,
      paid_at: status === 'paid' ? new Date().toISOString() : null
    }).eq('id', id)
    if (error) alert(error.message)
    else load()
  }

  function openEdit(inv) {
    setEditing(inv)
    setForm({
      invoice_number: inv.invoice_number || '',
      vendor_id: inv.vendor_id || '',
      vendor_name: inv.vendor_name || '',
      invoice_date: inv.invoice_date || '',
      due_date: inv.due_date || '',
      subtotal: inv.subtotal || '',
      gst_amount: inv.gst_amount || '0',
      total_amount: inv.total_amount || '',
      status: inv.status || 'uploaded',
      notes: inv.notes || '',
      po_id: inv.po_id || '',
    })
    setErr(''); setShowModal(true)
  }

  const filtered = invoices.filter(i => {
    const ms = !search || i.invoice_number?.toLowerCase().includes(search.toLowerCase()) || i.vendor?.name?.toLowerCase().includes(search.toLowerCase()) || i.vendor_name?.toLowerCase().includes(search.toLowerCase())
    const mf = statusFilter === 'all' || i.status === statusFilter
    return ms && mf
  })

  const totalAmount = invoices.reduce((s, i) => s + (i.total_amount || 0), 0)
  const paidAmount = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total_amount || 0), 0)
  const pendingAmount = invoices.filter(i => i.status !== 'paid' && i.status !== 'rejected').reduce((s, i) => s + (i.total_amount || 0), 0)

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Invoice Management</div>
          <div className="page-subtitle">Track and process vendor invoices</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canEdit && <button className="btn btn-outline" onClick={() => setShowAiPanel(true)} style={{ background: 'linear-gradient(135deg,#8b5cf611,#22d3ee11)', borderColor: '#8b5cf644' }}><Sparkles size={15} /> Generate with AI</button>}
          {canEdit && <button className="btn btn-primary" onClick={() => { setEditing(null); setForm(initForm()); setErr(''); setShowModal(true) }}><Plus size={15} /> Add Invoice</button>}
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {[
          { label: 'Total Invoices', value: invoices.length, color: '#6366f1' },
          { label: 'Total Value', value: rupee(totalAmount), color: '#3b82f6' },
          { label: 'Paid', value: rupee(paidAmount), color: '#10b981' },
          { label: 'Pending', value: rupee(pendingAmount), color: '#f59e0b' },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div className="stat-value" style={{ color: s.color, fontSize: typeof s.value === 'string' && s.value.length > 8 ? 18 : 26 }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Status filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={() => setStatusFilter('all')} style={{ padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 12, background: statusFilter === 'all' ? '#1e293b' : 'var(--surface)', color: statusFilter === 'all' ? '#fff' : 'var(--ink-soft)' }}>
          All ({invoices.length})
        </button>
        {STATUSES.map(s => (
          <button key={s} onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)} style={{
            padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 12, textTransform: 'capitalize',
            background: statusFilter === s ? statusColors[s] : `${statusColors[s]}15`,
            color: statusFilter === s ? '#fff' : statusColors[s],
          }}>
            {s} ({invoices.filter(i => i.status === s).length})
          </button>
        ))}
      </div>

      <div className="table-wrap">
        <div className="table-toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Search invoices..." />
          <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--ink-muted)' }}>{filtered.length} records</span>
        </div>
        {filtered.length === 0 ? (
          <Empty icon={<FileText size={40} />} title="No invoices found" desc="Add an invoice to get started" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Invoice #</th><th>Vendor</th><th>Project</th><th>Amount</th>
                <th>Due Date</th><th>Status</th><th>Match</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => (
                <tr key={inv.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: 'var(--c1)' }}>{inv.invoice_number}</td>
                  <td className="td-bold">{inv.vendor?.name || inv.vendor_name || '—'}</td>
                  <td>{inv.project ? <span style={{padding:'2px 8px',borderRadius:999,fontSize:11,fontWeight:700,background:'#ede9fe',color:'#6d28d9'}}>{inv.project.name}</span> : <span style={{color:'#ef4444',fontSize:11}}>No project</span>}</td>
                  <td style={{ fontWeight: 700 }}>{rupee(inv.total_amount)}</td>
                  <td style={{ color: inv.due_date && new Date(inv.due_date) < new Date() && inv.status !== 'paid' ? '#ef4444' : 'inherit' }}>
                    {dateFmt(inv.due_date)}
                  </td>
                  <td>
                    {canEdit ? (
                      <select value={inv.status} onChange={e => updateStatus(inv.id, e.target.value)}
                        style={{ padding: '4px 8px', borderRadius: 8, border: `1.5px solid ${statusColors[inv.status] || '#e2e8f0'}`, background: `${statusColors[inv.status] || '#6366f1'}15`, color: statusColors[inv.status] || '#6366f1', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                        {EDITABLE_STATUSES.map(s => <option key={s} value={s} style={{ textTransform: 'capitalize' }}>{s}</option>)}
                      </select>
                    ) : (
                      <StatusBadge status={inv.status} />
                    )}
                  </td>
                  <td>
                    {(() => { const mc = MATCH_COLORS[inv.match_status] || MATCH_COLORS.unmatched; return (
                      <span style={{ padding: '3px 9px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: mc.bg, color: mc.color, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {inv.match_status === 'variance' && <AlertTriangle size={11} />}{inv.match_status === 'override_approved' && <ShieldCheck size={11} />}{mc.label}
                      </span>
                    )})()}
                  </td>
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

      <AIDockedPanel open={showAiPanel} onClose={() => setShowAiPanel(false)} title="Vendor Invoice AI" subtitle="Draft a vendor invoice">
        <VendorInvoiceAiTab profile={profile} onSaved={load} />
      </AIDockedPanel>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Invoice' : 'Add Invoice'} size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>{submitting ? 'Saving...' : editing ? 'Update' : 'Add Invoice'}</button>
        </>}
      >
        {err && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{err}</div>}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Invoice Number *</label>
            <input className="form-input" value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))} placeholder="INV-001" required />
          </div>
          <div className="form-group">
            <label className="form-label">Vendor</label>
            <select className="form-select" value={form.vendor_id} onChange={e => setForm(f => ({ ...f, vendor_id: e.target.value, po_id: '' }))}>
              <option value="">Select vendor</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Purchase Order (for 3-way match)</label>
          <select className="form-select" value={form.po_id} onChange={e => setForm(f => ({ ...f, po_id: e.target.value }))} disabled={!form.vendor_id}>
            <option value="">{form.vendor_id ? 'No PO linked' : 'Select a vendor first'}</option>
            {purchaseOrders.filter(po => po.vendor_id === form.vendor_id).map(po => <option key={po.id} value={po.id}>{po.po_number} — {rupee(po.total_amount)}</option>)}
          </select>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Invoice Date</label>
            <input className="form-input" type="date" value={form.invoice_date} onChange={e => setForm(f => ({ ...f, invoice_date: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Due Date</label>
            <input className="form-input" type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Subtotal (₹)</label>
            <input className="form-input" type="number" value={form.subtotal} onChange={e => {
              const sub = parseFloat(e.target.value) || 0
              const gst = parseFloat(form.gst_amount) || 0
              setForm(f => ({ ...f, subtotal: e.target.value, total_amount: (sub + gst).toFixed(2) }))
            }} placeholder="0" />
          </div>
          <div className="form-group">
            <label className="form-label">GST Amount (₹)</label>
            <input className="form-input" type="number" value={form.gst_amount} onChange={e => {
              const gst = parseFloat(e.target.value) || 0
              const sub = parseFloat(form.subtotal) || 0
              setForm(f => ({ ...f, gst_amount: e.target.value, total_amount: (sub + gst).toFixed(2) }))
            }} placeholder="0" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Total Amount (₹) *</label>
            <input className="form-input" type="number" value={form.total_amount} onChange={e => setForm(f => ({ ...f, total_amount: e.target.value }))} placeholder="0" required />
          </div>
          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="form-select" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {EDITABLE_STATUSES.map(s => <option key={s} value={s} style={{ textTransform: 'capitalize' }}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* File upload */}
        <div className="form-group" style={{ marginTop: 4 }}>
          <label className="form-label">Invoice Document (PDF / Word / Image)</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: '2px dashed #e2e8f0', borderRadius: 10, cursor: 'pointer', background: '#f8fafc', transition: 'border-color .15s' }}>
            <Upload size={16} style={{ color: '#6366f1', flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: uploadFile ? '#1e293b' : '#94a3b8', fontWeight: uploadFile ? 600 : 400 }}>
              {uploadFile ? `📎 ${uploadFile.name}` : 'Click to attach invoice PDF, Word or image'}
            </span>
            <input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" style={{ display: 'none' }}
              onChange={e => setUploadFile(e.target.files[0])} />
          </label>
          {uploadFile && <div style={{ fontSize: 11, color: '#10b981', marginTop: 4 }}>✓ {(uploadFile.size / 1024).toFixed(0)} KB — will upload on save</div>}
        </div>
        <div className="form-group">
          <label className="form-label">Project * <span style={{ color:'#ef4444' }}>— required</span></label>
          <ProjectSelect value={form.project_id} onChange={v => setForm(f=>({...f,project_id:v}))} projects={projects} required />
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal open={!!showDetail} onClose={() => setShowDetail(null)} title="Invoice Details" size="lg"
        footer={<>
          {canEdit && <button className="btn btn-primary btn-sm" onClick={() => { setShowDetail(null); openEdit(showDetail) }}>Edit</button>}
          <button className="btn btn-ghost" onClick={() => setShowDetail(null)}>Close</button>
        </>}>
        {showDetail && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 800, color: 'var(--c1)' }}>{showDetail.invoice_number}</div>
              <StatusBadge status={showDetail.status} />
            </div>
            <div className="grid-2" style={{ marginBottom: 16 }}>
              {[
                ['Vendor', showDetail.vendor?.name || showDetail.vendor_name],
                ['Project', showDetail.project?.name],
                ['Invoice Date', dateFmt(showDetail.invoice_date)],
                ['Due Date', dateFmt(showDetail.due_date)],
                ['Subtotal', rupee(showDetail.subtotal)],
                ['GST', rupee(showDetail.gst_amount)],
                ['Total Amount', rupee(showDetail.total_amount)],
              ].map(([k, v]) => (
                <div key={k} style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--surface)' }}>
                  <div style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 600, marginBottom: 2 }}>{k}</div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{v || '—'}</div>
                </div>
              ))}
            </div>
            {showDetail?.document_url && (
              <div style={{ marginTop: 16 }}>
                <a href={showDetail.document_url} target="_blank" rel="noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 10, background: '#ede9fe', color: '#6d28d9', fontWeight: 700, fontSize: 13, textDecoration: 'none', border: '1px solid #ddd6fe' }}>
                  <Paperclip size={14} /> View Invoice Document <ExternalLink size={12} />
                </a>
              </div>
            )}

            {/* 3-Way Match */}
            <div style={{ marginTop: 20, padding: '14px 16px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>3-Way Match</div>
                {(() => { const mc = MATCH_COLORS[showDetail.match_status] || MATCH_COLORS.unmatched; return (
                  <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: mc.bg, color: mc.color }}>{mc.label}</span>
                )})()}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                PO: {showDetail.po?.po_number || 'Not linked'}{showDetail.po?.total_amount != null && ` (${rupee(showDetail.po.total_amount)})`}
                {showDetail.variance_percent != null && <> · Variance: <strong style={{ color: Math.abs(showDetail.variance_percent) > tolerance ? '#ef4444' : '#10b981' }}>{showDetail.variance_percent}%</strong> (tolerance ±{tolerance}%)</>}
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button className="btn btn-outline btn-sm" disabled={!showDetail.po_id || matching} onClick={() => runMatch(showDetail.id, showDetail.po_id)}>{matching ? 'Matching…' : 'Run Match'}</button>
                  {showDetail.match_status === 'variance' && (
                    <>
                      <input className="form-input" style={{ fontSize: 12, maxWidth: 220 }} placeholder="Override justification…" value={overrideNote} onChange={e => setOverrideNote(e.target.value)} />
                      <button className="btn btn-primary btn-sm" disabled={!overrideNote.trim()} onClick={() => override(showDetail.id)}>Override</button>
                    </>
                  )}
                </div>
              )}
              {!showDetail.po_id && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>Link a Purchase Order via Edit to enable matching.</div>}
            </div>

            {/* Payments */}
            <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
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
              {canEdit && showDetail.status !== 'paid' && showDetail.status !== 'rejected' && (
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
