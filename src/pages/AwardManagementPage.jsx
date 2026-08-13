import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { dateFmt } from '../lib/supabase'
import {
  listAwards, listCategories, createCategory, updateCategory, setCategoryActive, deleteCategory, deleteAward,
} from '../lib/awards'
import { Modal, Loader, Empty, StatCard, StatusBadge, Tabs, SearchBox, Confirm } from '../components/ui'
import { Trophy, Plus, Tag, Trash2, Ban, CheckCircle2, Pencil, BarChart3 } from 'lucide-react'

export default function AwardManagementPage() {
  const [activeTab, setActiveTab] = useState('awards')
  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#4338ca)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <Trophy size={19} />
            </span>
            Award Management
          </div>
          <div className="page-subtitle">Configure recognition awards, eligibility, workflow, scoring and recommendations</div>
        </div>
      </div>
      <Tabs tabs={[{ id: 'awards', label: 'Awards' }, { id: 'categories', label: 'Categories' }]} active={activeTab} onChange={setActiveTab} />
      {activeTab === 'awards' ? <AwardsTab /> : <CategoriesTab />}
    </div>
  )
}

const STATUS_LABEL = { draft: 'Draft', active: 'Active', evaluation: 'Evaluation', completed: 'Completed', cancelled: 'Cancelled' }

function AwardsTab() {
  const navigate = useNavigate()
  const [awards, setAwards] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => { load() }, [statusFilter])
  async function load() { setLoading(true); setAwards(await listAwards({ status: statusFilter || undefined })); setLoading(false) }

  const filtered = search ? awards.filter(a => a.name.toLowerCase().includes(search.toLowerCase()) || a.code.toLowerCase().includes(search.toLowerCase())) : awards

  async function handleDelete() {
    try { await deleteAward(confirmDelete.id); setConfirmDelete(null); await load() }
    catch (e) { alert(e.message); setConfirmDelete(null) }
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <StatCard label="Total Awards" value={awards.length} icon={<Trophy size={17} />} accent="#6366f1" />
        <StatCard label="Active" value={awards.filter(a => a.status === 'active').length} icon={<CheckCircle2 size={17} />} accent="#15803d" />
        <StatCard label="Evaluation" value={awards.filter(a => a.status === 'evaluation').length} icon={<CheckCircle2 size={17} />} accent="#b45309" />
        <StatCard label="Completed" value={awards.filter(a => a.status === 'completed').length} icon={<CheckCircle2 size={17} />} accent="#1d4ed8" />
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search awards..." />
        <select className="form-select" style={{ maxWidth: 180 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => navigate('/awards/new')}><Plus size={15} /> Create Award</button>
      </div>

      {filtered.length === 0 ? (
        <Empty icon={<Trophy size={40} />} title="No awards yet" desc="Create the first award to start the recognition workflow" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Award</th><th>Category</th><th>Frequency</th><th>Cycle Period</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtered.map(a => (
                <tr key={a.id}>
                  <td>
                    <div className="td-bold">{a.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{a.code}</div>
                  </td>
                  <td>{a.category ? <span className="badge">{a.category.name}</span> : <span style={{ color: 'var(--ink-muted)' }}>—</span>}</td>
                  <td style={{ fontSize: 12 }}>{a.frequency || '—'}</td>
                  <td style={{ fontSize: 12 }}>{a.start_date ? `${dateFmt(a.start_date)} – ${dateFmt(a.end_date)}` : '—'}</td>
                  <td><StatusBadge status={a.status} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-outline btn-sm" onClick={() => navigate(`/awards/${a.id}/edit`)}><Pencil size={13} /> Open</button>
                      {a.status !== 'draft' && (
                        <button className="btn btn-outline btn-sm" onClick={() => navigate(`/awards/${a.id}/recommendations`)}><BarChart3 size={13} /> Recommendations</button>
                      )}
                      {a.status === 'draft' && (
                        <button className="btn btn-ghost btn-sm" title="Delete draft" onClick={() => setConfirmDelete(a)}><Trash2 size={13} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Confirm open={!!confirmDelete} danger message={`Delete draft award "${confirmDelete?.name}"? This cannot be undone.`}
        onConfirm={handleDelete} onCancel={() => setConfirmDelete(null)} />
    </div>
  )
}

function CategoriesTab() {
  const { profile } = useAuth()
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => { load() }, [])
  async function load() { setLoading(true); setCategories(await listCategories()); setLoading(false) }

  function openCreate() { setEditing(null); setForm({ name: '', description: '' }); setErr(''); setShowForm(true) }
  function openEdit(cat) { setEditing(cat); setForm({ name: cat.name, description: cat.description || '' }); setErr(''); setShowForm(true) }

  async function handleSave() {
    if (!form.name.trim()) { setErr('Category name is required'); return }
    setSaving(true); setErr('')
    try {
      if (editing) await updateCategory(editing.id, form)
      else await createCategory(form, profile.id)
      setShowForm(false); await load()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    try { await deleteCategory(confirmDelete.id); setConfirmDelete(null); await load() }
    catch (e) { alert(e.message); setConfirmDelete(null) }
  }

  if (loading) return <Loader />

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={openCreate}><Plus size={15} /> New Category</button>
      </div>

      {categories.length === 0 ? (
        <Empty icon={<Tag size={40} />} title="No award categories yet" desc="e.g. Best Performer, Employee of the Month, Innovation Award" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Category</th><th>Description</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {categories.map(c => (
                <tr key={c.id}>
                  <td className="td-bold">{c.name}</td>
                  <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{c.description || '—'}</td>
                  <td><StatusBadge status={c.is_active ? 'active' : 'inactive'} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-outline btn-sm" onClick={() => openEdit(c)}><Pencil size={13} /></button>
                      <button className="btn btn-outline btn-sm" title={c.is_active ? 'Disable' : 'Enable'} onClick={() => setCategoryActive(c.id, !c.is_active).then(load)}>
                        {c.is_active ? <Ban size={13} /> : <CheckCircle2 size={13} />}
                      </button>
                      <button className="btn btn-ghost btn-sm" title="Delete" onClick={() => setConfirmDelete(c)}><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? 'Edit Category' : 'New Award Category'}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </>}>
        {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="form-group"><label className="form-label">Category Name *</label>
          <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Employee of the Month" /></div>
        <div className="form-group"><label className="form-label">Description</label>
          <textarea className="form-input" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
      </Modal>

      <Confirm open={!!confirmDelete} danger message={`Delete category "${confirmDelete?.name}"?`} onConfirm={handleDelete} onCancel={() => setConfirmDelete(null)} />
    </div>
  )
}
