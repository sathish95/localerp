import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, rupee, dateFmt, nextNum } from '../lib/supabase'
import { Modal, StatusBadge, SearchBox, Loader, Empty, Confirm } from '../components/ui'
import { Plus, Edit2, Trash2, Box, Eye } from 'lucide-react'

const CATEGORIES = ['Laptop', 'Desktop', 'Mobile', 'Tablet', 'Printer', 'Server', 'Vehicle', 'Furniture', 'Equipment', 'Other']
const STATUSES = ['purchased', 'assigned', 'returned', 'scrap']
const statusColors = { purchased: '#6366f1', assigned: '#10b981', returned: '#f59e0b', scrap: '#ef4444' }

const initForm = () => ({
  name: '', category: '', make: '', model: '', serial_number: '',
  purchase_date: '', purchase_value: '', assigned_to: '',
  location: '', warranty_expiry: '', notes: '', status: 'purchased', project_id: ''
})

export default function AssetsPage() {
  const { profile } = useAuth()
  const [assets, setAssets] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [showDetail, setShowDetail] = useState(null)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(initForm())
  const [submitting, setSubmitting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [err, setErr] = useState('')
  const [projects, setProjects] = useState([])

  const role = profile?.role || 'employee'
  const canEdit = ['admin', 'ceo', 'finance', 'manager'].includes(role)

  useEffect(() => { load(); loadProjects() }, [])

  async function loadProjects() {
    const { data } = await supabase.from('projects').select('id,name,code,budget,spent').order('name')
    setProjects(data || [])
  }

  async function load() {
    setLoading(true)
    const [a, u] = await Promise.all([
      supabase.from('assets').select('*, assignee:profiles!assigned_to(full_name), project:projects(id,name,code)').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name').order('full_name')
    ])
    setAssets(a.data || [])
    setUsers(u.data || [])
    setLoading(false)
  }

  async function handleSubmit(e) {
    e.preventDefault(); setSubmitting(true); setErr('')
    try {
      const payload = {
        name: form.name,
        category: form.category,
        make: form.make || null,
        model: form.model || null,
        serial_number: form.serial_number || null,
        purchase_date: form.purchase_date || null,
        purchase_value: parseFloat(form.purchase_value) || null,
        assigned_to: form.assigned_to || null,
        location: form.location || null,
        warranty_expiry: form.warranty_expiry || null,
        notes: form.notes || null,
        status: form.status,
        project_id: form.project_id || null,
      }
      if (editing) {
        const { error } = await supabase.from('assets').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const code = await nextNum('asset')
        const { error } = await supabase.from('assets').insert({ ...payload, asset_code: code })
        if (error) throw error
      }
      setShowModal(false); load()
    } catch (e) { setErr(e.message) }
    finally { setSubmitting(false) }
  }

  async function handleDelete(id) {
    await supabase.from('assets').delete().eq('id', id)
    setDeleteConfirm(null); load()
  }

  function openEdit(asset) {
    setEditing(asset)
    setForm({
      name: asset.name || '', category: asset.category || '',
      make: asset.make || '', model: asset.model || '',
      serial_number: asset.serial_number || '',
      purchase_date: asset.purchase_date || '',
      purchase_value: asset.purchase_value || '',
      assigned_to: asset.assigned_to || '',
      location: asset.location || '',
      warranty_expiry: asset.warranty_expiry || '',
      notes: asset.notes || '',
      status: asset.status || 'purchased',
      project_id: asset.project_id || ''
    })
    setErr(''); setShowModal(true)
  }

  const filtered = assets.filter(a => {
    const ms = !search || a.name?.toLowerCase().includes(search.toLowerCase()) || a.serial_number?.toLowerCase().includes(search.toLowerCase()) || a.asset_code?.toLowerCase().includes(search.toLowerCase())
    const mf = statusFilter === 'all' || a.status === statusFilter
    return ms && mf
  })

  const counts = STATUSES.reduce((acc, s) => ({ ...acc, [s]: assets.filter(a => a.status === s).length }), {})

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Asset Management</div>
          <div className="page-subtitle">Track company assets — ThingsaliveWork</div>
        </div>
        {canEdit && <button className="btn btn-primary" onClick={() => { setEditing(null); setForm(initForm()); setErr(''); setShowModal(true) }}><Plus size={15} /> Add Asset</button>}
      </div>

      {/* Status filter pills */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <button onClick={() => setStatusFilter('all')} style={{ padding: '8px 16px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, background: statusFilter === 'all' ? '#1e293b' : 'var(--surface)', color: statusFilter === 'all' ? '#fff' : 'var(--ink-soft)' }}>
          All ({assets.length})
        </button>
        {STATUSES.map(s => (
          <button key={s} onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)} style={{
            padding: '8px 16px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, textTransform: 'capitalize',
            background: statusFilter === s ? statusColors[s] : `${statusColors[s]}15`,
            color: statusFilter === s ? '#fff' : statusColors[s],
          }}>
            {s} ({counts[s] || 0})
          </button>
        ))}
      </div>

      <div className="table-wrap">
        <div className="table-toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Search assets..." />
          <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--ink-muted)' }}>{filtered.length} assets</span>
        </div>
        {filtered.length === 0 ? (
          <Empty icon={<Box size={40} />} title="No assets found" desc="Add company assets to track them" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Code</th><th>Name</th><th>Category</th>
                <th>Value</th><th>Status</th><th>Assigned To</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => (
                <tr key={a.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--c1)', fontWeight: 700 }}>{a.asset_code || '—'}</td>
                  <td className="td-bold">{a.name}</td>
                  <td><span className="badge badge-info">{a.category}</span></td>
                  <td>{a.project ? <span style={{padding:'2px 8px',borderRadius:999,fontSize:11,fontWeight:700,background:'#ede9fe',color:'#6d28d9'}}>{a.project.name}</span> : '—'}</td>
                  <td>{rupee(a.purchase_value)}</td>
                  <td><span className="badge" style={{ background: `${statusColors[a.status]}18`, color: statusColors[a.status], textTransform: 'capitalize' }}>{a.status}</span></td>
                  <td>{a.assignee?.full_name || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setShowDetail(a)} title="View"><Eye size={13} /></button>
                      {canEdit && <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openEdit(a)} title="Edit"><Edit2 size={13} /></button>}
                      {canEdit && <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => setDeleteConfirm(a.id)} title="Delete"><Trash2 size={13} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create/Edit Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Asset' : 'Add Asset'} size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>{submitting ? 'Saving...' : editing ? 'Update' : 'Add Asset'}</button>
        </>}
      >
        {err && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{err}</div>}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Asset Name *</label>
            <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. MacBook Pro 14" required />
          </div>
          <div className="form-group">
            <label className="form-label">Category *</label>
            <select className="form-select" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} required>
              <option value="">Select category</option>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Make / Brand</label>
            <input className="form-input" value={form.make} onChange={e => setForm(f => ({ ...f, make: e.target.value }))} placeholder="Apple, Dell, HP..." />
          </div>
          <div className="form-group">
            <label className="form-label">Model</label>
            <input className="form-input" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} placeholder="Model number" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Serial Number</label>
            <input className="form-input" value={form.serial_number} onChange={e => setForm(f => ({ ...f, serial_number: e.target.value }))} placeholder="Serial / IMEI" />
          </div>
          <div className="form-group">
            <label className="form-label">Purchase Value (₹)</label>
            <input className="form-input" type="number" value={form.purchase_value} onChange={e => setForm(f => ({ ...f, purchase_value: e.target.value }))} placeholder="0" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Purchase Date</label>
            <input className="form-input" type="date" value={form.purchase_date} onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Warranty Expiry</label>
            <input className="form-input" type="date" value={form.warranty_expiry} onChange={e => setForm(f => ({ ...f, warranty_expiry: e.target.value }))} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Assigned To</label>
            <select className="form-select" value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}>
              <option value="">Unassigned</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="form-select" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {STATUSES.map(s => <option key={s} value={s} style={{ textTransform: 'capitalize' }}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Project</label>
          <select className="form-select" value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}>
            <option value="">No project</option>
            {projects.map(p => {
              return <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
            })}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Location</label>
          <input className="form-input" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Office / Room" />
        </div>
        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea className="form-textarea" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Additional notes..." />
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal open={!!showDetail} onClose={() => setShowDetail(null)} title="Asset Details" size="lg"
        footer={<>
          {canEdit && <button className="btn btn-primary btn-sm" onClick={() => { setShowDetail(null); openEdit(showDetail) }}>Edit Asset</button>}
          <button className="btn btn-ghost" onClick={() => setShowDetail(null)}>Close</button>
        </>}>
        {showDetail && (
          <div className="grid-2">
            {[
              ['Asset Code', showDetail.asset_code], ['Name', showDetail.name],
              ['Category', showDetail.category], ['Make', showDetail.make],
              ['Model', showDetail.model], ['Serial #', showDetail.serial_number],
              ['Purchase Value', rupee(showDetail.purchase_value)], ['Purchase Date', dateFmt(showDetail.purchase_date)],
              ['Status', showDetail.status], ['Location', showDetail.location],
              ['Assigned To', showDetail.assignee?.full_name], ['Warranty Expiry', dateFmt(showDetail.warranty_expiry)],
            ].map(([k, v]) => (
              <div key={k} style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--surface)' }}>
                <div style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 600, marginBottom: 2 }}>{k}</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{v || '—'}</div>
              </div>
            ))}
            {showDetail.notes && (
              <div style={{ gridColumn: '1/-1', padding: '10px 14px', borderRadius: 10, background: 'var(--surface)' }}>
                <div style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 600, marginBottom: 2 }}>Notes</div>
                <div style={{ fontSize: 14 }}>{showDetail.notes}</div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Confirm open={!!deleteConfirm} message="Delete this asset?" danger
        onConfirm={() => handleDelete(deleteConfirm)} onCancel={() => setDeleteConfirm(null)} />
    </div>
  )
}
