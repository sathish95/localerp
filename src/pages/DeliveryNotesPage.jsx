import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase, dateFmt } from '../lib/supabase'
import { useProjects, ProjectSelect } from '../lib/useProjects.jsx'
import {
  listDeliveryNotes, getDeliveryNoteItems, createDeliveryNote, updateDeliveryNote,
  setDeliveryNoteStatus, deleteDeliveryNote,
} from '../lib/deliveryNotes'
import { exportDeliveryNotePDF } from '../lib/deliveryNoteExport'
import { Modal, StatusBadge, SearchBox, Loader, Empty, Confirm } from '../components/ui'
import AIDockedPanel from '../components/AIDockedPanel'
import { DeliveryNoteAiTab } from '../components/AIActionTabs'
import { Plus, Edit2, Truck, Eye, Trash2, X, PackageCheck, Sparkles, Download } from 'lucide-react'

const STATUSES = ['draft', 'dispatched', 'delivered', 'cancelled']
const statusColors = { draft: '#94a3b8', dispatched: '#6366f1', delivered: '#10b981', cancelled: '#ef4444' }

const initHeader = () => ({
  delivery_note_number: '', project_id: '', customer_id: '', customer_invoice_id: '',
  delivery_date: '', delivery_address: '', carrier: '', tracking_number: '', status: 'draft', notes: '',
})
const initItem = () => ({ part_number: '', description: '', quantity: 1, unit: 'pcs', notes: '' })

export default function DeliveryNotesPage() {
  const { profile } = useAuth()
  const [searchParams] = useSearchParams()
  const { projects } = useProjects()
  const [notes, setNotes] = useState([])
  const [customers, setCustomers] = useState([])
  const [invoices, setInvoices] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [header, setHeader] = useState(initHeader())
  const [items, setItems] = useState([initItem()])
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  const [showDetail, setShowDetail] = useState(null)
  const [detailItems, setDetailItems] = useState([])
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [exportingId, setExportingId] = useState(null)

  const [showAiPanel, setShowAiPanel] = useState(searchParams.get('ai') === '1')

  const role = profile?.role || 'employee'
  const canEdit = ['admin', 'ceo', 'manager', 'department_head', 'finance'].includes(role)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [n, c, inv, p] = await Promise.all([
      listDeliveryNotes(),
      supabase.from('customers').select('id,name').eq('status', 'active').order('name'),
      supabase.from('customer_invoices').select('id,invoice_number,project_id'),
      supabase.from('products').select('part_number,name').order('name'),
    ])
    setNotes(n)
    setCustomers(c.data || [])
    setInvoices(inv.data || [])
    setProducts(p.data || [])
    setLoading(false)
  }

  function openCreate() {
    setEditing(null); setHeader(initHeader()); setItems([initItem()]); setErr(''); setShowModal(true)
  }

  async function openEdit(note) {
    setEditing(note)
    setHeader({
      delivery_note_number: note.delivery_note_number, project_id: note.project_id || '',
      customer_id: note.customer_id || '', customer_invoice_id: note.customer_invoice_id || '',
      delivery_date: note.delivery_date || '', delivery_address: note.delivery_address || '',
      carrier: note.carrier || '', tracking_number: note.tracking_number || '',
      status: note.status, notes: note.notes || '',
    })
    const its = await getDeliveryNoteItems(note.id)
    setItems(its.length ? its : [initItem()])
    setErr(''); setShowModal(true)
  }

  async function openDetail(note) {
    setShowDetail(note)
    setDetailItems(await getDeliveryNoteItems(note.id))
  }

  async function handleExport(note) {
    setExportingId(note.id)
    try { await exportDeliveryNotePDF(note.id, profile?.org?.name) }
    catch (e) { alert(e.message) }
    finally { setExportingId(null) }
  }

  function addItemRow() { setItems(it => [...it, initItem()]) }
  function removeItemRow(i) { setItems(it => it.filter((_, idx) => idx !== i)) }
  function setItemField(i, k, v) { setItems(it => it.map((row, idx) => idx === i ? { ...row, [k]: v } : row)) }

  function pickProductForItem(i, partNumber) {
    const p = products.find(x => x.part_number === partNumber)
    setItems(it => it.map((row, idx) => idx === i ? { ...row, part_number: partNumber, description: p?.name || row.description } : row))
  }

  async function handleSubmit(e) {
    e.preventDefault(); setSubmitting(true); setErr('')
    try {
      if (!header.project_id) throw new Error('Project is required')
      const validItems = items.filter(it => it.description?.trim())
      if (!validItems.length) throw new Error('At least one item with a description is required')
      const payload = {
        delivery_note_number: header.delivery_note_number || undefined,
        project_id: header.project_id, customer_id: header.customer_id || null,
        customer_invoice_id: header.customer_invoice_id || null,
        delivery_date: header.delivery_date || null, delivery_address: header.delivery_address || null,
        carrier: header.carrier || null, tracking_number: header.tracking_number || null,
        status: header.status, notes: header.notes || null,
      }
      if (editing) {
        await updateDeliveryNote(editing.id, payload, validItems)
      } else {
        await createDeliveryNote(payload, validItems, profile.id)
      }
      setShowModal(false); load()
    } catch (e) { setErr(e.message) } finally { setSubmitting(false) }
  }

  async function handleDelete(id) {
    await deleteDeliveryNote(id)
    setDeleteConfirm(null); setShowDetail(null); load()
  }

  async function quickStatus(note, status) {
    await setDeliveryNoteStatus(note.id, status)
    load()
    if (showDetail?.id === note.id) setShowDetail(d => ({ ...d, status }))
  }

  const filtered = notes.filter(n => {
    const ms = !search || n.delivery_note_number?.toLowerCase().includes(search.toLowerCase())
      || n.customer?.name?.toLowerCase().includes(search.toLowerCase()) || n.project?.name?.toLowerCase().includes(search.toLowerCase())
    const mf = statusFilter === 'all' || n.status === statusFilter
    return ms && mf
  })

  const invoicesForProject = invoices.filter(i => !header.project_id || i.project_id === header.project_id)

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <Truck size={19} />
            </span>
            Delivery Notes
          </div>
          <div className="page-subtitle">Outbound dispatch tracking — the customer-facing counterpart to GRN</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canEdit && <button className="btn btn-outline" onClick={() => setShowAiPanel(true)} style={{ background: 'linear-gradient(135deg,#8b5cf611,#22d3ee11)', borderColor: '#8b5cf644' }}><Sparkles size={15} /> Generate with AI</button>}
          {canEdit && <button className="btn btn-primary" onClick={openCreate}><Plus size={15} /> New Delivery Note</button>}
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {[
          { label: 'Total Notes', value: notes.length, color: '#6366f1' },
          { label: 'Dispatched', value: notes.filter(n => n.status === 'dispatched').length, color: '#3b82f6' },
          { label: 'Delivered', value: notes.filter(n => n.status === 'delivered').length, color: '#10b981' },
          { label: 'Draft', value: notes.filter(n => n.status === 'draft').length, color: '#94a3b8' },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={() => setStatusFilter('all')} style={{ padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 12, background: statusFilter === 'all' ? '#1e293b' : 'var(--surface)', color: statusFilter === 'all' ? '#fff' : 'var(--ink-soft)' }}>
          All ({notes.length})
        </button>
        {STATUSES.map(s => (
          <button key={s} onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)} style={{
            padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 12, textTransform: 'capitalize',
            background: statusFilter === s ? statusColors[s] : `${statusColors[s]}15`, color: statusFilter === s ? '#fff' : statusColors[s],
          }}>
            {s} ({notes.filter(n => n.status === s).length})
          </button>
        ))}
      </div>

      <div className="table-wrap">
        <div className="table-toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Search delivery notes..." />
          <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--ink-muted)' }}>{filtered.length} records</span>
        </div>
        {filtered.length === 0 ? (
          <Empty icon={<Truck size={40} />} title="No delivery notes found" desc="Create one to track an outbound shipment" />
        ) : (
          <table>
            <thead><tr><th>Note #</th><th>Project</th><th>Customer</th><th>Carrier</th><th>Delivery Date</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.map(n => (
                <tr key={n.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: 'var(--c1)' }}>{n.delivery_note_number}</td>
                  <td className="td-bold">{n.project?.name || '—'}</td>
                  <td>{n.customer?.name || '—'}</td>
                  <td style={{ fontSize: 12, color: '#64748b' }}>{n.carrier || '—'}{n.tracking_number ? ` (${n.tracking_number})` : ''}</td>
                  <td>{dateFmt(n.delivery_date)}</td>
                  <td><StatusBadge status={n.status} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openDetail(n)} title="View"><Eye size={13} /></button>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => handleExport(n)} disabled={exportingId === n.id} title="Download PDF"><Download size={13} /></button>
                      {canEdit && <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openEdit(n)} title="Edit"><Edit2 size={13} /></button>}
                      {canEdit && <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => setDeleteConfirm(n.id)} title="Delete"><Trash2 size={13} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <AIDockedPanel open={showAiPanel} onClose={() => setShowAiPanel(false)} title="Delivery Note AI" subtitle="Draft an outbound shipment">
        <DeliveryNoteAiTab profile={profile} onSaved={load} />
      </AIDockedPanel>

      {/* Create/Edit Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Delivery Note' : 'New Delivery Note'} size="lg"
        footer={<><button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button><button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>{submitting ? 'Saving...' : editing ? 'Update' : 'Create Delivery Note'}</button></>}>
        {err && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{err}</div>}
        <div className="form-group">
          <label className="form-label">Project *</label>
          <ProjectSelect value={header.project_id} onChange={v => setHeader(h => ({ ...h, project_id: v, customer_invoice_id: '' }))} projects={projects} required />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Customer</label>
            <select className="form-select" value={header.customer_id} onChange={e => setHeader(h => ({ ...h, customer_id: e.target.value }))}>
              <option value="">Select customer</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Linked Invoice (optional)</label>
            <select className="form-select" value={header.customer_invoice_id} onChange={e => setHeader(h => ({ ...h, customer_invoice_id: e.target.value }))}>
              <option value="">No invoice linked</option>
              {invoicesForProject.map(i => <option key={i.id} value={i.id}>{i.invoice_number}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Delivery Note #</label><input className="form-input" value={header.delivery_note_number} onChange={e => setHeader(h => ({ ...h, delivery_note_number: e.target.value }))} placeholder="Auto-generated if blank" /></div>
          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="form-select" value={header.status} onChange={e => setHeader(h => ({ ...h, status: e.target.value }))}>
              {STATUSES.map(s => <option key={s} value={s} style={{ textTransform: 'capitalize' }}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Delivery Date</label><input className="form-input" type="date" value={header.delivery_date} onChange={e => setHeader(h => ({ ...h, delivery_date: e.target.value }))} /></div>
          <div className="form-group"><label className="form-label">Carrier</label><input className="form-input" value={header.carrier} onChange={e => setHeader(h => ({ ...h, carrier: e.target.value }))} placeholder="e.g. Blue Dart" /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Tracking Number</label><input className="form-input" value={header.tracking_number} onChange={e => setHeader(h => ({ ...h, tracking_number: e.target.value }))} /></div>
          <div className="form-group"><label className="form-label">Delivery Address</label><input className="form-input" value={header.delivery_address} onChange={e => setHeader(h => ({ ...h, delivery_address: e.target.value }))} /></div>
        </div>
        <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={header.notes} onChange={e => setHeader(h => ({ ...h, notes: e.target.value }))} /></div>

        <div style={{ marginTop: 18, marginBottom: 8, fontWeight: 700, fontSize: 13 }}>Items</div>
        <div className="table-wrap" style={{ marginBottom: 10 }}>
          <table>
            <thead><tr><th>Product (optional)</th><th>Description *</th><th>Qty</th><th>Unit</th><th></th></tr></thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td>
                    <select className="form-select" value={it.part_number} onChange={e => pickProductForItem(i, e.target.value)}>
                      <option value="">—</option>
                      {products.map(p => <option key={p.part_number} value={p.part_number}>{p.name}</option>)}
                    </select>
                  </td>
                  <td><input className="form-input" value={it.description} onChange={e => setItemField(i, 'description', e.target.value)} placeholder="What's being shipped" /></td>
                  <td><input className="form-input" style={{ width: 70 }} type="number" min="0" step="0.01" value={it.quantity} onChange={e => setItemField(i, 'quantity', e.target.value)} /></td>
                  <td><input className="form-input" style={{ width: 70 }} value={it.unit} onChange={e => setItemField(i, 'unit', e.target.value)} /></td>
                  <td>{items.length > 1 && <button type="button" className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => removeItemRow(i)}><X size={12} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={addItemRow}><Plus size={13} /> Add Item</button>
      </Modal>

      {/* Detail Modal */}
      <Modal open={!!showDetail} onClose={() => setShowDetail(null)} title="Delivery Note Details" size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowDetail(null)}>Close</button>
          <button className="btn btn-primary" onClick={() => handleExport(showDetail)} disabled={exportingId === showDetail?.id}><Download size={14} /> {exportingId === showDetail?.id ? 'Preparing…' : 'Download PDF'}</button>
        </>}>
        {showDetail && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 800, color: 'var(--c1)' }}>{showDetail.delivery_note_number}</div>
              <StatusBadge status={showDetail.status} />
            </div>
            <div className="grid-2" style={{ marginBottom: 16 }}>
              {[
                ['Project', showDetail.project?.name], ['Customer', showDetail.customer?.name],
                ['Carrier', showDetail.carrier], ['Tracking #', showDetail.tracking_number],
                ['Delivery Date', dateFmt(showDetail.delivery_date)], ['Linked Invoice', showDetail.invoice?.invoice_number],
              ].map(([k, v]) => (
                <div key={k} style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--surface)' }}>
                  <div style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 600, marginBottom: 2 }}>{k}</div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{v || '—'}</div>
                </div>
              ))}
            </div>

            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Items</div>
            <div className="table-wrap" style={{ marginBottom: 16 }}>
              <table>
                <thead><tr><th>Part #</th><th>Description</th><th>Qty</th><th>Unit</th></tr></thead>
                <tbody>
                  {detailItems.map(it => (
                    <tr key={it.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{it.part_number || '—'}</td>
                      <td className="td-bold">{it.description}</td>
                      <td>{it.quantity}</td>
                      <td>{it.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {canEdit && showDetail.status !== 'cancelled' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {showDetail.status === 'draft' && <button className="btn btn-primary btn-sm" onClick={() => quickStatus(showDetail, 'dispatched')}><Truck size={13} /> Mark Dispatched</button>}
                {showDetail.status === 'dispatched' && <button className="btn btn-primary btn-sm" onClick={() => quickStatus(showDetail, 'delivered')}><PackageCheck size={13} /> Mark Delivered</button>}
                {showDetail.status !== 'delivered' && <button className="btn btn-ghost btn-sm" style={{ color: '#ef4444' }} onClick={() => quickStatus(showDetail, 'cancelled')}>Cancel</button>}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Confirm open={!!deleteConfirm} message="Delete this delivery note? This cannot be undone." danger onConfirm={() => handleDelete(deleteConfirm)} onCancel={() => setDeleteConfirm(null)} />
    </div>
  )
}
