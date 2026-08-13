import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { listTemplates, createTemplate, duplicateTemplate, setTemplateStatus, deleteTemplate } from '../lib/scenarioTemplates'
import { Loader, Alert, Badge, Empty, SearchBox, Modal, Confirm } from '../components/ui'
import { dateFmt } from '../lib/supabase'
import { Plus, Copy, Archive, CheckCircle, Trash2, Pencil } from 'lucide-react'

const CATEGORIES = ['general', 'expansion', 'cost-reduction', 'hiring', 'product-launch', 'restructuring']

export default function ScenarioTemplatesPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const canManage = ['admin', 'ceo'].includes(profile?.role)

  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState('general')
  const [deleteTarget, setDeleteTarget] = useState(null)

  async function load() {
    setLoading(true)
    try { setTemplates(await listTemplates()) } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function handleCreate() {
    try {
      const t = await createTemplate({ name: newName, category: newCategory })
      setCreateOpen(false); setNewName('')
      navigate(`/scenarios/templates/${t.id}`)
    } catch (e) { setErr(e.message) }
  }

  async function handleDuplicate(id) {
    try { await duplicateTemplate(id); await load() } catch (e) { setErr(e.message) }
  }

  async function handleStatus(id, status) {
    try { await setTemplateStatus(id, status); await load() } catch (e) { setErr(e.message) }
  }

  async function handleDelete() {
    try { await deleteTemplate(deleteTarget); setDeleteTarget(null); await load() } catch (e) { setErr(e.message) }
  }

  const filtered = templates.filter(t => !q || t.name.toLowerCase().includes(q.toLowerCase()))

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Scenario Templates</div>
          <div className="page-subtitle">Reusable variable sets for common scenario types</div>
        </div>
        {canManage && <button className="btn btn-primary" onClick={() => setCreateOpen(true)}><Plus size={15} /> New Template</button>}
      </div>

      {err && <Alert type="error" message={err} />}

      <div style={{ marginBottom: 16, maxWidth: 360 }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search templates…" />
      </div>

      {filtered.length === 0 ? (
        <Empty title="No templates yet" desc={canManage ? 'Create one to standardize how scenarios in a category get built.' : 'Ask an admin to create one.'} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {filtered.map(t => (
            <div key={t.id} className="card" style={{ padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ fontWeight: 700 }}>{t.name}</div>
                <Badge type={t.status === 'published' ? 'success' : t.status === 'archived' ? 'info' : 'warning'}>{t.status}</Badge>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 10 }}>{t.category?.replace(/-/g, ' ')} · {t.variables?.length || 0} variables · {dateFmt(t.created_at)}</div>
              {t.description && <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 10 }}>{t.description}</p>}
              {canManage && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/scenarios/templates/${t.id}`)}><Pencil size={13} /> Edit</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleDuplicate(t.id)}><Copy size={13} /> Duplicate</button>
                  {t.status !== 'published' && <button className="btn btn-ghost btn-sm" onClick={() => handleStatus(t.id, 'published')}><CheckCircle size={13} /> Publish</button>}
                  {t.status !== 'archived' && <button className="btn btn-ghost btn-sm" onClick={() => handleStatus(t.id, 'archived')}><Archive size={13} /> Archive</button>}
                  <button className="btn btn-ghost btn-sm" onClick={() => setDeleteTarget(t.id)}><Trash2 size={13} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Template" footer={
        <><button className="btn btn-ghost" onClick={() => setCreateOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!newName.trim()} onClick={handleCreate}>Create</button></>
      }>
        <label className="form-label">Name</label>
        <input className="form-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Regional Expansion" autoFocus />
        <label className="form-label" style={{ marginTop: 12 }}>Category</label>
        <select className="form-input" value={newCategory} onChange={e => setNewCategory(e.target.value)}>
          {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/-/g, ' ')}</option>)}
        </select>
      </Modal>

      <Confirm open={!!deleteTarget} message="Delete this template? Scenarios already created from it are unaffected." danger onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
    </div>
  )
}
