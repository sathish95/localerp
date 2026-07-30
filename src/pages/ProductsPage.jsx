import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase, rupee } from '../lib/supabase'
import { getActiveBomEdges } from '../lib/bom'
import { Modal, SearchBox, Loader, Empty, Confirm } from '../components/ui'
import { Plus, Edit2, Trash2, Layers, Boxes, Warehouse, Cpu } from 'lucide-react'

const DEVICE_TYPES = [
  'IoT Logger', 'Temperature Sensor', 'Humidity Sensor', 'Pressure Sensor', 'Gateway',
  'Flow Meter', 'GPS Tracker', 'Vibration Sensor', 'Camera Module', 'Power Meter', 'Other',
]

const initForm = () => ({
  part_number: '', name: '', device_type: DEVICE_TYPES[0], spec_sheet: '',
  warranty_months: 12, reorder_level: 0, reorder_qty: 0, standard_cost: '',
  status: 'active',
})

export default function ProductsPage() {
  const { profile } = useAuth()
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(initForm())
  const [submitting, setSubmitting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [err, setErr] = useState('')
  const [deviceCountByPart, setDeviceCountByPart] = useState({})
  const [componentCountByPart, setComponentCountByPart] = useState({})

  const role = profile?.role || 'employee'
  const canEdit = ['admin', 'ceo', 'manager', 'department_head', 'finance', 'procurement_lead'].includes(role)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data }, { data: devices }, edges] = await Promise.all([
      supabase.from('products').select('*').eq('is_serialized', true).order('name'),
      supabase.from('device_instances').select('part_number'),
      getActiveBomEdges(),
    ])
    setProducts(data || [])
    const deviceCounts = {}
    ;(devices || []).forEach(d => { if (d.part_number) deviceCounts[d.part_number] = (deviceCounts[d.part_number] || 0) + 1 })
    setDeviceCountByPart(deviceCounts)
    const componentCounts = {}
    edges.forEach(e => { componentCounts[e.parent_part_number] = (componentCounts[e.parent_part_number] || 0) + 1 })
    setComponentCountByPart(componentCounts)
    setLoading(false)
  }

  function openCreate() { setEditing(null); setForm(initForm()); setErr(''); setShowModal(true) }
  function openEdit(p) { setEditing(p); setForm({ ...initForm(), ...p }); setErr(''); setShowModal(true) }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true); setErr('')
    try {
      const { name, device_type, spec_sheet, warranty_months, reorder_level, reorder_qty, standard_cost, status } = form
      const part_number = form.part_number?.trim() || ('PRD-' + Date.now().toString().slice(-6))
      const payload = {
        part_number, name, device_type: device_type || null, spec_sheet: spec_sheet || null,
        warranty_months: parseInt(warranty_months) || 12, reorder_level: parseFloat(reorder_level) || 0,
        reorder_qty: parseFloat(reorder_qty) || 0, standard_cost: parseFloat(standard_cost) || 0,
        is_serialized: true, status: status || 'active',
      }
      if (editing) {
        const { error } = await supabase.from('products').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('products').insert({ ...payload, created_by: profile.id })
        if (error) throw error
      }
      setShowModal(false); load()
    } catch (e) { setErr(e.message) }
    finally { setSubmitting(false) }
  }

  async function handleDelete(id) {
    await supabase.from('products').delete().eq('id', id)
    setDeleteConfirm(null); load()
  }

  const filtered = products.filter(p =>
    (!search || p.name?.toLowerCase().includes(search.toLowerCase()) || p.part_number?.toLowerCase().includes(search.toLowerCase())) &&
    (!typeFilter || p.device_type === typeFilter)
  )

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Products</div>
          <div className="page-subtitle">Finished-good catalog only — warranty terms, reorder thresholds, standard cost. Components live under Inventory → Component.</div>
        </div>
        <div className="page-actions">
          {canEdit && <button className="btn btn-primary" onClick={openCreate}><Plus size={15} /> Add Product</button>}
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {[
          { label: 'Total Products', value: products.length, color: '#6366f1' },
          { label: 'Active', value: products.filter(p => p.status === 'active').length, color: '#10b981' },
          { label: 'Devices Registered', value: Object.values(deviceCountByPart).reduce((s, n) => s + n, 0), color: '#8b5cf6' },
          { label: 'Device Types', value: [...new Set(products.map(p => p.device_type))].filter(Boolean).length, color: '#f59e0b' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ '--accent': s.color }}>
            <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 200 }}><SearchBox value={search} onChange={setSearch} placeholder="Search products..." /></div>
        <select className="form-select" style={{ width: 'auto' }} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All Device Types</option>
          {DEVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? <Empty icon="📦" title="No products found" desc="Add a device to the catalog to get started" /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Part #</th><th>Name</th><th>Device Type</th><th>Warranty</th><th>Reorder Lvl / Qty</th><th>Standard Cost</th><th>Devices</th><th>Components</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--c1)' }}>{p.part_number}</td>
                  <td className="td-bold">{p.name}</td>
                  <td>{p.device_type ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 }}><Layers size={12} style={{ color: 'var(--c1)' }} />{p.device_type}</span> : '—'}</td>
                  <td>{p.warranty_months} mo</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.reorder_level} / {p.reorder_qty}</td>
                  <td style={{ fontFamily: 'monospace' }}>{rupee(p.standard_cost)}</td>
                  <td style={{ fontWeight: 700 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Cpu size={12} style={{ color: '#6366f1' }} />{deviceCountByPart[p.part_number] || 0}</span>
                  </td>
                  <td style={{ fontWeight: 700 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Boxes size={12} style={{ color: '#8b5cf6' }} />{componentCountByPart[p.part_number] || 0}</span>
                  </td>
                  <td>{p.status === 'active' ? <span className="badge badge-success">Active</span> : <span className="badge badge-danger">Discontinued</span>}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Link className="btn btn-ghost btn-sm btn-icon" title="Bill of Materials" to={`/bom?product=${encodeURIComponent(p.part_number)}`}><Boxes size={12} /></Link>
                      <Link className="btn btn-ghost btn-sm btn-icon" title="Inventory" to={`/inventory?product=${encodeURIComponent(p.part_number)}`}><Warehouse size={12} /></Link>
                      {canEdit && <>
                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openEdit(p)}><Edit2 size={12} /></button>
                        <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => setDeleteConfirm(p.id)}><Trash2 size={12} /></button>
                      </>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Product' : 'Add New Product'} size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>{submitting ? 'Saving...' : editing ? 'Update Product' : 'Add Product'}</button>
        </>}
      >
        <form onSubmit={handleSubmit}>
          {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
          <div className="form-row">
            <div className="form-group"><label className="form-label">Part Number</label><input className="form-input" value={form.part_number} onChange={e => setForm(f => ({ ...f, part_number: e.target.value }))} placeholder="Auto-generated if left blank" /></div>
            <div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Device Type</label>
              <select className="form-select" value={form.device_type} onChange={e => setForm(f => ({ ...f, device_type: e.target.value }))}>
                {DEVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Standard Cost (₹)</label><input className="form-input" type="number" step="0.01" value={form.standard_cost} onChange={e => setForm(f => ({ ...f, standard_cost: e.target.value }))} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Warranty (months)</label><input className="form-input" type="number" value={form.warranty_months} onChange={e => setForm(f => ({ ...f, warranty_months: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Status</label>
              <select className="form-select" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                <option value="active">Active</option>
                <option value="discontinued">Discontinued</option>
              </select></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Reorder Level</label><input className="form-input" type="number" value={form.reorder_level} onChange={e => setForm(f => ({ ...f, reorder_level: e.target.value }))} /><div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>Trigger point for low-stock alerts</div></div>
            <div className="form-group"><label className="form-label">Reorder Quantity</label><input className="form-input" type="number" value={form.reorder_qty} onChange={e => setForm(f => ({ ...f, reorder_qty: e.target.value }))} /><div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>Suggested quantity to re-order</div></div>
          </div>
          <div className="form-group"><label className="form-label">Spec Sheet</label><textarea className="form-textarea" style={{ minHeight: 60 }} value={form.spec_sheet} onChange={e => setForm(f => ({ ...f, spec_sheet: e.target.value }))} placeholder="URL or free-text specification" /></div>
        </form>
      </Modal>

      <Confirm open={!!deleteConfirm} message="Delete this product? This cannot be undone." danger onConfirm={() => handleDelete(deleteConfirm)} onCancel={() => setDeleteConfirm(null)} />
    </div>
  )
}
