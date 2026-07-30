import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, rupee, dateFmt, nextNum } from '../lib/supabase'
import { useProjects, ProjectSelect } from '../lib/useProjects.jsx'
import {
  COST_THRESHOLD, resolveChainType, getChainSync, firstReviewStatus,
  canActOnSync, buildApprovalUpdate, validateFinanceStep, statusLabel, warmChains,
} from '../lib/procurementApproval'
import { commitBudget, releaseBudget, availableBudget } from '../lib/budgetSync'
import { createPOFromPR } from '../lib/purchaseOrders'
import ProcurementChainViz from '../components/ui/ProcurementChainViz'
import { Modal, StatusBadge, SearchBox, Loader, Empty, Confirm } from '../components/ui'
import { Plus, Eye, CheckCircle, XCircle, Ban, Trash2, AlertTriangle, ShoppingCart } from 'lucide-react'

const PRIORITIES = ['low', 'medium', 'high', 'urgent']
const PRIORITY_COLORS = { low: '#10b981', medium: '#f59e0b', high: '#ef4444', urgent: '#7c3aed' }
const CATEGORIES = ['IT Equipment', 'Office Supplies', 'Software', 'Furniture', 'Services', 'Marketing', 'Field Hardware', 'Other']
const REQUEST_TYPES = [
  { id: 'production', label: 'Production' },
  { id: 'post_production', label: 'Post-Production' },
  { id: 'on_demand', label: 'On-Demand' },
]

const initForm = () => ({
  title: '', request_type: 'on_demand', category: '', justification: '',
  priority: 'medium', required_by: '', project_id: '', vendor_id: '', budget_id: '', demand_reference: '',
})
const blankLine = () => ({ part_number: '', description: '', quantity: 1, unit_cost: 0 })

export default function ProcurementPage() {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const isApproverRole = ['procurement_lead', 'pm', 'cto', 'finance', 'ceo', 'admin'].includes(role)
  const canCancel = ['admin', 'ceo', 'finance', 'procurement_lead'].includes(role)
  const canCreatePO = ['admin', 'ceo', 'manager', 'department_head', 'finance', 'procurement_lead'].includes(role)

  const { projects } = useProjects()
  const [items, setItems] = useState([])
  const [vendors, setVendors] = useState([])
  const [products, setProducts] = useState([])
  const [budgets, setBudgets] = useState([])
  const [posByPr, setPosByPr] = useState({})
  const [showCreatePO, setShowCreatePO] = useState(null)
  const [poForm, setPoForm] = useState({ vendor_id: '', delivery_date: '', gst_percent: 18, terms: '' })
  const [poSubmitting, setPoSubmitting] = useState(false)
  const [poErr, setPoErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [showDetail, setShowDetail] = useState(null)
  const [showReview, setShowReview] = useState(null)
  const [detailItems, setDetailItems] = useState([])
  const [cancelConfirm, setCancelConfirm] = useState(null)
  const [form, setForm] = useState(initForm())
  const [lineItems, setLineItems] = useState([blankLine()])
  const [note, setNote] = useState('')
  const [overrideFlag, setOverrideFlag] = useState(false)
  const [overrideJustification, setOverrideJustification] = useState('')
  const [submitting, setSub] = useState(false)
  const [err, setErr] = useState('')
  const [formErr, setFormErr] = useState({})
  const [, setChainVer] = useState(0)

  useEffect(() => { load(); warmChains().then(() => setChainVer(v => v + 1)) }, [])

  async function load() {
    setLoading(true)
    // budget_id is a soft ref (no real FK to budgets — see STEP36's own
    // vendor_id-vs-department_id precedent), so embedding budget:budgets(...)
    // here made PostgREST reject the WHOLE query (schema-relationship
    // resolution happens before RLS row-filtering, so this failed for every
    // request regardless of status) — every procurement request looked
    // like it "wasn't showing" because the list silently came back empty.
    // Fetch budgets separately (already needed for the form anyway) and
    // merge client-side instead.
    const [pr, v, p, b, po] = await Promise.all([
      supabase.from('purchase_requisitions')
        .select('*, requester:profiles!requested_by(full_name,role), project:projects(id,name,code)')
        .order('created_at', { ascending: false }),
      supabase.from('vendors').select('id,name,supplier_type').eq('status', 'active').order('name'),
      supabase.from('products').select('part_number,name,standard_cost').eq('status', 'active').order('name'),
      supabase.from('budgets').select('*, dept:departments(id,name), proj:projects(id,name)').order('fiscal_year', { ascending: false }),
      supabase.from('purchase_orders').select('id,po_number,pr_id'),
    ])
    const budgetsData = b.data || []
    const budgetById = new Map(budgetsData.map(bud => [bud.id, bud]))
    setItems((pr.data || []).map(item => ({ ...item, budget: item.budget_id ? budgetById.get(item.budget_id) || null : null })))
    setVendors(v.data || []); setProducts(p.data || []); setBudgets(budgetsData)
    setPosByPr(Object.fromEntries((po.data || []).filter(x => x.pr_id).map(x => [x.pr_id, x])))
    setLoading(false)
  }

  function openCreatePO(item) {
    setShowCreatePO(item); setPoErr('')
    setPoForm({ vendor_id: item.vendor_id || '', delivery_date: '', gst_percent: 18, terms: '' })
  }

  async function handleCreatePO() {
    if (!poForm.vendor_id) { setPoErr('Select a vendor'); return }
    setPoSubmitting(true); setPoErr('')
    try {
      await createPOFromPR(showCreatePO.id, poForm.vendor_id, poForm.delivery_date || null, poForm.gst_percent, poForm.terms, profile.id, showCreatePO.budget_id)
      setShowCreatePO(null); load()
    } catch (e) { setPoErr(e.message) }
    finally { setPoSubmitting(false) }
  }

  // Auto-resolve budget line when a project is picked and exactly one budget matches it
  useEffect(() => {
    if (!form.project_id) return
    const matches = budgets.filter(b => b.project_id === form.project_id)
    if (matches.length === 1) setForm(f => ({ ...f, budget_id: matches[0].id }))
  }, [form.project_id, budgets])

  const estimatedTotal = useMemo(() =>
    lineItems.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0)
  , [lineItems])

  const chainTypePreview = resolveChainType(form.request_type, estimatedTotal)
  const reviewFinanceCheck = useMemo(() => {
    if (!showReview || showReview.status !== 'finance_review' || !showReview.budget) return null
    return validateFinanceStep({
      allocated: showReview.budget.allocated, committedAmount: showReview.budget.committed_amount,
      estimatedTotal: showReview.estimated_total || showReview.estimated_amount, overrideFlag,
    })
  }, [showReview, overrideFlag])
  const reviewApproveBlocked = !!reviewFinanceCheck && (!reviewFinanceCheck.ok || (overrideFlag && !overrideJustification.trim()))
  const projectBudgets = useMemo(() => budgets.filter(b => b.project_id === form.project_id), [budgets, form.project_id])
  const selectedBudget = budgets.find(b => b.id === form.budget_id)
  const selectedAvailable = selectedBudget ? availableBudget(selectedBudget) : null
  const overBudget = selectedAvailable != null && estimatedTotal > selectedAvailable

  function updateLine(i, patch) { setLineItems(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l)) }
  function addLine() { setLineItems(prev => [...prev, blankLine()]) }
  function removeLine(i) { setLineItems(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev) }
  function pickProduct(i, partNumber) {
    const prod = products.find(p => p.part_number === partNumber)
    updateLine(i, { part_number: partNumber, description: prod ? prod.name : '', unit_cost: prod ? (prod.standard_cost || 0) : lineItems[i].unit_cost })
  }

  function validate() {
    const e = {}
    if (!form.title.trim()) e.title = 'Title is required'
    if (!form.project_id) e.project_id = 'Project is required'
    if (!form.budget_id) e.budget_id = 'Budget line is required — create one on the Budget page for this project first'
    const validLines = lineItems.filter(l => l.description && Number(l.quantity) > 0)
    if (validLines.length === 0 || estimatedTotal <= 0) e.lineItems = 'At least one line item with a description, quantity and unit cost is required'
    setFormErr(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!validate()) return
    setSub(true); setErr('')
    try {
      const num = await nextNum('pr')
      const chainType = resolveChainType(form.request_type, estimatedTotal)
      const firstStatus = await firstReviewStatus(chainType)
      const { data: pr, error } = await supabase.from('purchase_requisitions').insert({
        pr_number: num, title: form.title, category: form.category || null, justification: form.justification || null,
        priority: form.priority, required_by: form.required_by || null, project_id: form.project_id,
        vendor_id: form.vendor_id || null, budget_id: form.budget_id, demand_reference: form.demand_reference || null,
        request_type: form.request_type, chain_type: chainType,
        estimated_amount: estimatedTotal, estimated_total: estimatedTotal,
        requested_by: profile.id, status: firstStatus,
      }).select().single()
      if (error) throw error

      const rows = lineItems.filter(l => l.description).map((l, i) => ({
        pr_id: pr.id, part_number: l.part_number || null, description: l.description,
        quantity: Number(l.quantity) || 1, unit_cost: Number(l.unit_cost) || 0,
        line_total: (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0),
        preferred_supplier_id: form.vendor_id || null, sort_order: i,
      }))
      if (rows.length > 0) {
        const { error: itemErr } = await supabase.from('purchase_requisition_items').insert(rows)
        if (itemErr) throw itemErr
      }
      // NOTE: no projects.spent bump here — budget commitment happens on approval instead.
      setShowModal(false); setForm(initForm()); setLineItems([blankLine()]); setFormErr({}); load()
    } catch (e) { setErr(e.message) }
    finally { setSub(false) }
  }

  async function openDetail(item) {
    setShowDetail(item)
    const { data } = await supabase.from('purchase_requisition_items').select('*').eq('pr_id', item.id).order('sort_order')
    setDetailItems(data || [])
  }
  async function openReview(item) {
    setShowReview(item); setNote(''); setOverrideFlag(false); setOverrideJustification(''); setErr('')
    const { data } = await supabase.from('purchase_requisition_items').select('*').eq('pr_id', item.id).order('sort_order')
    setDetailItems(data || [])
  }

  async function handleApprove(item, action) {
    setSub(true); setErr('')
    try {
      const total = item.estimated_total || item.estimated_amount || 0
      if (action === 'approve' && item.status === 'finance_review') {
        const check = validateFinanceStep({
          allocated: item.budget?.allocated, committedAmount: item.budget?.committed_amount,
          estimatedTotal: total, overrideFlag,
        })
        if (!check.ok) {
          setErr(`Budget overrun by ${rupee(check.shortfall)}. Check "Override" and provide a justification to proceed.`)
          setSub(false); return
        }
      }
      const update = await buildApprovalUpdate(action, item.status, item.chain_type, profile.id, note)
      if (action === 'approve' && item.status === 'finance_review' && overrideFlag) {
        update.override_flag = true
        update.override_justification = overrideJustification
      }
      const { error } = await supabase.from('purchase_requisitions').update(update).eq('id', item.id)
      if (error) throw error
      await supabase.from('approval_logs').insert({
        entity_type: 'procurement_request', entity_id: item.id, performed_by: profile.id,
        action, from_status: item.status, to_status: update.status, comments: note || overrideJustification || null,
      })
      if (update.status === 'approved') await commitBudget(item.budget_id, total)
      setShowReview(null); setShowDetail(null); setNote(''); setOverrideFlag(false); setOverrideJustification(''); load()
    } catch (e) { alert(e.message) }
    finally { setSub(false) }
  }

  async function handleCancel(item) {
    setSub(true)
    try {
      await supabase.from('purchase_requisitions').update({ status: 'cancelled' }).eq('id', item.id)
      await releaseBudget(item.budget_id, item.estimated_total || item.estimated_amount)
      await supabase.from('approval_logs').insert({
        entity_type: 'procurement_request', entity_id: item.id, performed_by: profile.id,
        action: 'cancel', from_status: 'approved', to_status: 'cancelled', comments: null,
      })
      setCancelConfirm(null); setShowDetail(null); load()
    } catch (e) { alert(e.message) }
    finally { setSub(false) }
  }

  const filtered = items.filter(i => !search ||
    i.title?.toLowerCase().includes(search.toLowerCase()) ||
    i.pr_number?.toLowerCase().includes(search.toLowerCase())
  )

  const PENDING_STATUSES = ['procurement_lead_review', 'pm_review', 'cto_review', 'finance_review', 'ceo_review']

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Procurement Requests</div>
          <div className="page-subtitle">Every purchase traces back to a Department → Project → Budget line</div>
        </div>
        <button className="btn btn-primary" onClick={() => { setErr(''); setFormErr({}); setForm(initForm()); setLineItems([blankLine()]); setShowModal(true) }}>
          <Plus size={15} /> New Request
        </button>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {[
          { l: 'Total', v: items.length, c: '#6366f1' },
          { l: 'Pending', v: items.filter(i => PENDING_STATUSES.includes(i.status)).length, c: '#f59e0b' },
          { l: 'Approved', v: items.filter(i => i.status === 'approved').length, c: '#10b981' },
          { l: 'Cancelled', v: items.filter(i => i.status === 'cancelled').length, c: '#94a3b8' },
          { l: 'Total Value', v: rupee(items.reduce((s, i) => s + (i.estimated_total || i.estimated_amount || 0), 0)), c: '#3b82f6' },
        ].map(s => (
          <div key={s.l} className="stat-card" style={{ borderTopColor: s.c }}>
            <div className="stat-value" style={{ color: s.c }}>{s.v}</div>
            <div className="stat-label">{s.l}</div>
          </div>
        ))}
      </div>

      <div className="table-wrap">
        <div className="table-toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Search requests…" />
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{filtered.length} records</span>
        </div>
        <table>
          <thead><tr>
            <th>PR #</th><th>Title</th><th>Type</th><th>Project</th><th>Budget Line</th>
            <th>Amount</th><th>Priority</th>{isApproverRole && <th>Requester</th>}
            <th>Status</th><th>Chain</th><th>Actions</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0
              ? <tr><td colSpan={11}><Empty icon="🛒" title="No procurement requests" desc="Create a new request to get started" /></td></tr>
              : filtered.map(item => {
                const canReview = canActOnSync(role, item.status, item.chain_type)
                const pc = PRIORITY_COLORS[item.priority] || '#6366f1'
                const total = item.estimated_total || item.estimated_amount || 0
                return (
                  <tr key={item.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#6366f1' }}>{item.pr_number}</td>
                    <td className="td-bold">{item.title}</td>
                    <td><span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#f1f5f9', color: '#475569', textTransform: 'capitalize' }}>{item.request_type?.replace(/_/g, ' ') || '—'}</span></td>
                    <td>{item.project ? <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#ede9fe', color: '#6d28d9' }}>{item.project.name}</span> : <span style={{ color: '#ef4444', fontSize: 11 }}>No project</span>}</td>
                    <td style={{ fontSize: 11, color: '#64748b' }}>{item.budget ? `${item.budget.category || 'Budget'} · ${item.budget.fiscal_year || ''}` : '—'}</td>
                    <td style={{ fontWeight: 700 }}>{rupee(total)}</td>
                    <td><span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: `${pc}15`, color: pc }}>{item.priority?.toUpperCase()}</span></td>
                    {isApproverRole && <td style={{ fontSize: 12, color: '#64748b' }}>{item.requester?.full_name}</td>}
                    <td><StatusBadge status={item.status} /></td>
                    <td><ProcurementChainViz chainType={item.chain_type} currentStatus={item.status} compact /></td>
                    <td>
                      <div style={{ display: 'flex', gap: 5 }}>
                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openDetail(item)}><Eye size={13} /></button>
                        {canReview && <button className="btn btn-primary btn-sm" onClick={() => openReview(item)}>Review</button>}
                        {item.status === 'approved' && (posByPr[item.id]
                          ? <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#6366f1', background: '#6366f110', padding: '3px 8px', borderRadius: 6 }} title="Purchase Order raised">{posByPr[item.id].po_number}</span>
                          : canCreatePO && <button className="btn btn-outline btn-sm" onClick={() => openCreatePO(item)}><ShoppingCart size={12} /> Create PO</button>
                        )}
                        {item.status === 'approved' && canCancel && <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} title="Cancel" onClick={() => setCancelConfirm(item)}><Ban size={13} /></button>}
                      </div>
                    </td>
                  </tr>
                )
              })
            }
          </tbody>
        </table>
      </div>

      {/* Create Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="New Procurement Request" size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>{submitting ? 'Submitting…' : 'Submit Request'}</button>
        </>}>
        {err && <div className="alert alert-danger" style={{ marginBottom: 14 }}>{err}</div>}

        <div className="form-group">
          <label className="form-label">Request Type</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {REQUEST_TYPES.map(t => (
              <button key={t.id} type="button" onClick={() => setForm(f => ({ ...f, request_type: t.id }))}
                style={{ flex: 1, padding: '10px', borderRadius: 10, border: `2px solid ${form.request_type === t.id ? '#6366f1' : '#e2e8f0'}`, background: form.request_type === t.id ? '#ede9fe' : '#fff', color: form.request_type === t.id ? '#6366f1' : '#475569', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Title *</label>
          <input className="form-input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="What do you need to purchase?" required style={{ borderColor: formErr.title ? '#ef4444' : undefined }} />
          {formErr.title && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 3 }}>{formErr.title}</div>}
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Project *</label>
            <ProjectSelect value={form.project_id} onChange={v => setForm(f => ({ ...f, project_id: v, budget_id: '' }))} projects={projects} required />
            {formErr.project_id && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 3 }}>{formErr.project_id}</div>}
          </div>
          <div className="form-group">
            <label className="form-label">Budget Line *</label>
            <select className="form-select" value={form.budget_id} onChange={e => setForm(f => ({ ...f, budget_id: e.target.value }))} style={{ borderColor: formErr.budget_id ? '#ef4444' : undefined }}>
              <option value="">Select…</option>
              {projectBudgets.map(b => <option key={b.id} value={b.id}>{b.category || 'Budget'} · {b.fiscal_year}{b.month ? `/${b.month}` : ''}</option>)}
            </select>
            {formErr.budget_id && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 3 }}>{formErr.budget_id}</div>}
            {form.project_id && projectBudgets.length === 0 && <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 3 }}>No budget line found for this project — create one on the Budget page first.</div>}
          </div>
        </div>

        {selectedBudget && (
          <div style={{ display: 'flex', gap: 10, padding: '10px 14px', borderRadius: 10, background: overBudget ? '#fef2f2' : '#f0fdf4', border: `1px solid ${overBudget ? '#fecaca' : '#bbf7d0'}`, marginBottom: 14, flexWrap: 'wrap' }}>
            <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>ALLOCATED</div><div style={{ fontWeight: 700 }}>{rupee(selectedBudget.allocated)}</div></div>
            <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>COMMITTED</div><div style={{ fontWeight: 700 }}>{rupee(selectedBudget.committed_amount)}</div></div>
            <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>AVAILABLE</div><div style={{ fontWeight: 700, color: overBudget ? '#dc2626' : '#15803d' }}>{rupee(selectedAvailable)}</div></div>
          </div>
        )}

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Category</label>
            <select className="form-select" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              <option value="">Select category</option>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Priority</label>
            <select className="form-select" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Preferred Vendor / Supplier</label>
            <select className="form-select" value={form.vendor_id} onChange={e => setForm(f => ({ ...f, vendor_id: e.target.value }))}>
              <option value="">No preference</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name} {v.supplier_type === 'local_shop' ? '(Local Shop)' : ''}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Required By</label>
            <input className="form-input" type="date" value={form.required_by} onChange={e => setForm(f => ({ ...f, required_by: e.target.value }))} />
          </div>
        </div>

        {form.request_type === 'on_demand' && (
          <div className="form-group">
            <label className="form-label">Demand Reference</label>
            <input className="form-input" value={form.demand_reference} onChange={e => setForm(f => ({ ...f, demand_reference: e.target.value }))} placeholder="Job / ticket that triggered this purchase" />
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Justification / Description</label>
          <textarea className="form-textarea" value={form.justification} onChange={e => setForm(f => ({ ...f, justification: e.target.value }))} placeholder="Why is this purchase needed?" />
        </div>

        {/* Line items */}
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, marginTop: 4 }}>Line Items</div>
        {formErr.lineItems && <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 8 }}>{formErr.lineItems}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
          {lineItems.map((l, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 70px 100px 100px 30px', gap: 6, alignItems: 'center' }}>
              <select className="form-select" value={l.part_number} onChange={e => pickProduct(i, e.target.value)} style={{ fontSize: 12 }}>
                <option value="">Free text…</option>
                {products.map(p => <option key={p.part_number} value={p.part_number}>{p.name}</option>)}
              </select>
              <input className="form-input" style={{ fontSize: 12 }} value={l.description} onChange={e => updateLine(i, { description: e.target.value })} placeholder="Description" />
              <input className="form-input" style={{ fontSize: 12 }} type="number" min="1" value={l.quantity} onChange={e => updateLine(i, { quantity: e.target.value })} />
              <input className="form-input" style={{ fontSize: 12 }} type="number" step="0.01" value={l.unit_cost} onChange={e => updateLine(i, { unit_cost: e.target.value })} />
              <div style={{ fontSize: 12, fontWeight: 700, textAlign: 'right' }}>{rupee((Number(l.quantity) || 0) * (Number(l.unit_cost) || 0))}</div>
              <button type="button" className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => removeLine(i)} disabled={lineItems.length === 1}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={addLine} style={{ marginBottom: 16 }}><Plus size={12} /> Add Line</button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 10, background: '#f8fafc', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Estimated Total</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: '#6366f1' }}>{rupee(estimatedTotal)}</span>
        </div>

        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#f0f9ff', border: '1px solid #bae6fd' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#0369a1', marginBottom: 8 }}>
            APPROVAL CHAIN — {chainTypePreview === 'full' ? 'Full chain (Production/Post-Production ≥ ' + rupee(COST_THRESHOLD) + ')' : 'Short chain (On-Demand or below threshold)'}
          </div>
          <ProcurementChainViz chainType={chainTypePreview} currentStatus={getChainSync(chainTypePreview)[0].status} />
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal open={!!showDetail} onClose={() => setShowDetail(null)} title="Request Details" size="lg"
        footer={<>
          {showDetail && canActOnSync(role, showDetail.status, showDetail.chain_type) && (
            <button className="btn btn-primary btn-sm" onClick={() => { openReview(showDetail); setShowDetail(null) }}>Review</button>
          )}
          {showDetail?.status === 'approved' && canCancel && (
            <button className="btn btn-ghost btn-sm" style={{ color: '#ef4444' }} onClick={() => setCancelConfirm(showDetail)}><Ban size={12} /> Cancel Request</button>
          )}
          <button className="btn btn-ghost" onClick={() => setShowDetail(null)}>Close</button>
        </>}>
        {showDetail && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontFamily: 'monospace', color: '#6366f1', fontWeight: 700, fontSize: 12 }}>{showDetail.pr_number}</div>
                <div style={{ fontWeight: 800, fontSize: 20 }}>{showDetail.title}</div>
                {showDetail.requester && <div style={{ fontSize: 13, color: '#64748b' }}>by {showDetail.requester.full_name} ({showDetail.requester.role})</div>}
              </div>
              <StatusBadge status={showDetail.status} />
            </div>
            {showDetail.status === 'draft' && showDetail.rejection_reason && (
              <div className="alert alert-danger" style={{ marginBottom: 14 }}><AlertTriangle size={13} style={{ marginRight: 6 }} />Rejected: {showDetail.rejection_reason}</div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              {[
                ['Amount', rupee(showDetail.estimated_total || showDetail.estimated_amount)],
                ['Request Type', showDetail.request_type?.replace(/_/g, ' ')],
                ['Project', showDetail.project?.name || '—'],
                ['Budget Line', showDetail.budget ? `${showDetail.budget.category || 'Budget'} · ${showDetail.budget.fiscal_year || ''}` : '—'],
                ['Category', showDetail.category || '—'],
                ['Priority', showDetail.priority?.toUpperCase()],
                ['Required By', dateFmt(showDetail.required_by)],
                ['Submitted', dateFmt(showDetail.created_at)],
              ].map(([k, v]) => (
                <div key={k} style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>{k}</div>
                  <div style={{ fontWeight: 600, marginTop: 2, fontSize: 14, textTransform: k === 'Request Type' ? 'capitalize' : 'none' }}>{v}</div>
                </div>
              ))}
            </div>
            {showDetail.demand_reference && <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Demand reference: <strong>{showDetail.demand_reference}</strong></div>}
            {showDetail.justification && <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 10, marginBottom: 12, fontSize: 13 }}>{showDetail.justification}</div>}

            {showDetail.budget && (
              <div style={{ display: 'flex', gap: 10, padding: '10px 14px', borderRadius: 10, background: '#f8fafc', marginBottom: 12, flexWrap: 'wrap' }}>
                <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>ALLOCATED</div><div style={{ fontWeight: 700 }}>{rupee(showDetail.budget.allocated)}</div></div>
                <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>COMMITTED</div><div style={{ fontWeight: 700 }}>{rupee(showDetail.budget.committed_amount)}</div></div>
                <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>AVAILABLE</div><div style={{ fontWeight: 700 }}>{rupee(availableBudget(showDetail.budget))}</div></div>
              </div>
            )}

            {detailItems.length > 0 && (
              <div className="table-wrap" style={{ marginBottom: 16 }}>
                <table>
                  <thead><tr><th>Description</th><th>Qty</th><th>Unit Cost</th><th>Line Total</th></tr></thead>
                  <tbody>{detailItems.map(li => (
                    <tr key={li.id}><td>{li.description}</td><td>{li.quantity}</td><td>{rupee(li.unit_cost)}</td><td style={{ fontWeight: 700 }}>{rupee(li.line_total)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 8 }}>Approval Chain</div>
              <ProcurementChainViz chainType={showDetail.chain_type} currentStatus={showDetail.status} />
            </div>
          </div>
        )}
      </Modal>

      {/* Review Modal */}
      <Modal open={!!showReview} onClose={() => setShowReview(null)} title="Review Request"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowReview(null)}>Cancel</button>
          <button className="btn btn-danger" onClick={() => handleApprove(showReview, 'reject')} disabled={submitting}><XCircle size={13} /> Reject</button>
          <button className="btn btn-success" onClick={() => handleApprove(showReview, 'approve')}
            disabled={submitting || reviewApproveBlocked}>
            <CheckCircle size={13} /> Approve
          </button>
        </>}>
        {showReview && (
          <div>
            {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
            <div style={{ padding: '12px 14px', background: '#f8fafc', borderRadius: 10, marginBottom: 12 }}>
              <div style={{ fontWeight: 700 }}>{showReview.title}</div>
              <div style={{ fontSize: 13, color: '#64748b', marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span>{rupee(showReview.estimated_total || showReview.estimated_amount)}</span>
                {showReview.project?.name && <span>📁 {showReview.project.name}</span>}
                {showReview.requester?.full_name && <span>👤 {showReview.requester.full_name}</span>}
              </div>
            </div>

            {detailItems.length > 0 && (
              <div className="table-wrap" style={{ marginBottom: 12 }}>
                <table>
                  <thead><tr><th>Description</th><th>Qty</th><th>Unit Cost</th><th>Line Total</th></tr></thead>
                  <tbody>{detailItems.map(li => (
                    <tr key={li.id}><td>{li.description}</td><td>{li.quantity}</td><td>{rupee(li.unit_cost)}</td><td style={{ fontWeight: 700 }}>{rupee(li.line_total)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}

            <div style={{ marginBottom: 12 }}><ProcurementChainViz chainType={showReview.chain_type} currentStatus={showReview.status} /></div>

            {reviewFinanceCheck && (reviewFinanceCheck.ok && !overrideFlag ? (
              <div className="alert" style={{ background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', marginBottom: 12 }}>Within budget — {rupee(reviewFinanceCheck.available)} available.</div>
            ) : (
              <div style={{ marginBottom: 12 }}>
                <div className="alert alert-danger" style={{ marginBottom: 8 }}><AlertTriangle size={13} style={{ marginRight: 6 }} />This request overruns the budget by {rupee(reviewFinanceCheck.shortfall)}.</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8 }}>
                  <input type="checkbox" checked={overrideFlag} onChange={e => setOverrideFlag(e.target.checked)} />
                  Override budget check
                </label>
                {overrideFlag && (
                  <textarea className="form-textarea" value={overrideJustification} onChange={e => setOverrideJustification(e.target.value)} placeholder="Justification for the override (required)" required />
                )}
              </div>
            ))}

            <div className="form-group">
              <label className="form-label">Comments</label>
              <textarea className="form-textarea" value={note} onChange={e => setNote(e.target.value)} placeholder="Reason for approval or rejection…" />
            </div>
          </div>
        )}
      </Modal>

      <Confirm open={!!cancelConfirm} message="Cancel this approved request? Its committed budget will be released." danger
        onConfirm={() => handleCancel(cancelConfirm)} onCancel={() => setCancelConfirm(null)} />

      {/* Create PO Modal */}
      <Modal open={!!showCreatePO} onClose={() => setShowCreatePO(null)} title="Create Purchase Order"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowCreatePO(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreatePO} disabled={poSubmitting}>{poSubmitting ? 'Creating…' : 'Create PO'}</button>
        </>}>
        {showCreatePO && (
          <div>
            {poErr && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{poErr}</div>}
            <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 10, marginBottom: 14 }}>
              <div style={{ fontWeight: 700 }}>{showCreatePO.title}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{showCreatePO.pr_number} · Line items total {rupee(showCreatePO.estimated_total || showCreatePO.estimated_amount)}</div>
            </div>
            <div className="form-group">
              <label className="form-label">Vendor *</label>
              <select className="form-select" value={poForm.vendor_id} onChange={e => setPoForm(f => ({ ...f, vendor_id: e.target.value }))}>
                <option value="">Select vendor…</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Delivery Date</label>
                <input className="form-input" type="date" value={poForm.delivery_date} onChange={e => setPoForm(f => ({ ...f, delivery_date: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">GST %</label>
                <input className="form-input" type="number" step="0.01" value={poForm.gst_percent} onChange={e => setPoForm(f => ({ ...f, gst_percent: e.target.value }))} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Terms</label>
              <textarea className="form-textarea" value={poForm.terms} onChange={e => setPoForm(f => ({ ...f, terms: e.target.value }))} placeholder="Payment terms, delivery conditions…" />
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>Line items are copied over exactly from this request's line items.</div>
          </div>
        )}
      </Modal>
    </div>
  )
}

