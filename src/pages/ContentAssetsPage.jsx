import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, dateFmt } from '../lib/supabase'
import { ASSET_TYPES, listContentAssets, createContentAsset, updateContentAsset, deleteContentAsset } from '../lib/marketingContentAssets'
import { Modal, SearchBox, Loader, Empty, Confirm } from '../components/ui'
import { Plus, Edit2, Trash2, ExternalLink, Copy } from 'lucide-react'

const MARKETING_WRITE_ROLES = ['admin', 'ceo', 'cmo', 'campaign_manager']
const initForm = () => ({ asset_name: '', asset_type: ASSET_TYPES[0], file_reference: '', linked_product_id: '', tags: '' })

export default function ContentAssetsPage() {
  const { profile } = useAuth()
  const canEdit = MARKETING_WRITE_ROLES.includes(profile?.role)
  const [assets, setAssets] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(initForm())
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [copiedId, setCopiedId] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const [a, p] = await Promise.all([listContentAssets(), supabase.from('products').select('part_number,name').then(x => x.data || [])])
    setAssets(a); setProducts(p)
    setLoading(false)
  }

  function openCreate() { setEditing(null); setForm(initForm()); setShowModal(true) }
  function openEdit(a) { setEditing(a); setForm({ ...initForm(), ...a, tags: (a.tags || []).join(', ') }); setShowModal(true) }

  async function save(e) {
    e.preventDefault()
    if (!form.asset_name.trim()) { setErr('Asset name is required'); return }
    setSaving(true); setErr('')
    const payload = { ...form, tags: form.tags.split(',').map(t => t.trim()).filter(Boolean) }
    try {
      if (editing) await updateContentAsset(editing.id, payload)
      else await createContentAsset(payload, profile.id)
      setShowModal(false); await load()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  async function handleDelete(id) { await deleteContentAsset(id); setDeleteConfirm(null); await load() }
  async function copyRef(a) { try { await navigator.clipboard.writeText(a.file_reference || ''); setCopiedId(a.id); setTimeout(() => setCopiedId(''), 1200) } catch {} }

  const filtered = assets.filter(a =>
    (!search || a.asset_name?.toLowerCase().includes(search.toLowerCase()) || (a.tags || []).some(t => t.toLowerCase().includes(search.toLowerCase()))) &&
    (!typeFilter || a.asset_type === typeFilter)
  )

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Content Assets</div>
          <div className="page-subtitle">Shared marketing collateral — Sales pulls what they need, no more scattered personal folders</div>
        </div>
        {canEdit && <div className="page-actions"><button className="btn btn-primary" onClick={openCreate}><Plus size={15} /> Add Asset</button></div>}
      </div>

      <div className="card" style={{ padding: 12, marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: '1 1 260px', minWidth: 220 }}><SearchBox value={search} onChange={setSearch} placeholder="Search by name or tag…" /></div>
        <select className="form-select" style={{ fontSize: 12, width: 180 }} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All Types</option>{ASSET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ padding: '20px 24px' }}><Empty icon="📁" title="No assets yet" desc="Add reusable collateral for Sales to pull from" /></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Type</th><th>Product</th><th>Tags</th><th>Updated</th><th></th></tr></thead>
            <tbody>
              {filtered.map(a => (
                <tr key={a.id}>
                  <td className="td-bold">{a.asset_name}</td>
                  <td>{a.asset_type}</td>
                  <td style={{ fontSize: 12 }}>{products.find(p => p.part_number === a.linked_product_id)?.name || '—'}</td>
                  <td style={{ fontSize: 11, color: '#94a3b8' }}>{(a.tags || []).join(', ') || '—'}</td>
                  <td style={{ fontSize: 12, color: '#94a3b8' }}>{dateFmt(a.updated_at)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {a.file_reference && (
                        <>
                          <a className="btn btn-ghost btn-sm btn-icon" href={a.file_reference} target="_blank" rel="noreferrer" title="Open"><ExternalLink size={12} /></a>
                          <button className="btn btn-ghost btn-sm btn-icon" title="Copy link" onClick={() => copyRef(a)}>{copiedId === a.id ? '✓' : <Copy size={12} />}</button>
                        </>
                      )}
                      {canEdit && <>
                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openEdit(a)}><Edit2 size={12} /></button>
                        <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => setDeleteConfirm(a.id)}><Trash2 size={12} /></button>
                      </>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Asset' : 'Add Content Asset'} size="lg"
        footer={<><button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Update' : 'Add'}</button></>}>
        <form onSubmit={save}>
          {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
          <div className="form-row">
            <div className="form-group"><label className="form-label">Asset Name *</label><input className="form-input" value={form.asset_name} onChange={e => setForm(f => ({ ...f, asset_name: e.target.value }))} required /></div>
            <div className="form-group"><label className="form-label">Type</label>
              <select className="form-select" value={form.asset_type} onChange={e => setForm(f => ({ ...f, asset_type: e.target.value }))}>
                {ASSET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select></div>
          </div>
          <div className="form-group"><label className="form-label">File / Link</label><input className="form-input" value={form.file_reference} onChange={e => setForm(f => ({ ...f, file_reference: e.target.value }))} placeholder="https://…" /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Linked Product</label>
              <select className="form-select" value={form.linked_product_id} onChange={e => setForm(f => ({ ...f, linked_product_id: e.target.value }))}>
                <option value="">—</option>{products.map(p => <option key={p.part_number} value={p.part_number}>{p.name}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Tags (comma-separated)</label><input className="form-input" value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} /></div>
          </div>
        </form>
      </Modal>

      <Confirm open={!!deleteConfirm} message="Delete this asset? This cannot be undone." danger onConfirm={() => handleDelete(deleteConfirm)} onCancel={() => setDeleteConfirm(null)} />
    </div>
  )
}
