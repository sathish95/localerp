import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { Modal, SearchBox, StatusBadge, Loader, Empty, Confirm } from '../components/ui'
import { Plus, Edit2, Trash2, Star, Phone, Mail, MapPin, Building } from 'lucide-react'

const CARD_COLORS = [
  { bg: '#f0f9ff', border: '#bae6fd', accent: '#0284c7' },
  { bg: '#f0fdf4', border: '#bbf7d0', accent: '#16a34a' },
  { bg: '#fdf4ff', border: '#e9d5ff', accent: '#9333ea' },
  { bg: '#fff7ed', border: '#fed7aa', accent: '#ea580c' },
  { bg: '#fdf2f8', border: '#fbcfe8', accent: '#db2777' },
  { bg: '#f0fdfa', border: '#99f6e4', accent: '#0d9488' },
]

const CATEGORIES = ['Technology', 'Manufacturing', 'Services', 'Logistics', 'Healthcare', 'Finance', 'Construction', 'Retail', 'Other']

const initForm = () => ({
  name: '', contact_name: '', email: '', phone: '', category: '',
  address: '', city: '', gst_number: '', bank_account: '', bank_name: '', ifsc_code: '',
  payment_terms: 30, status: 'active', bank_ifsc: ''
})

export default function VendorsPage() {
  const { profile } = useAuth()
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(initForm())
  const [submitting, setSubmitting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [activeTab, setActiveTab] = useState('cards')

  const role = profile?.role || 'employee'
  const canEdit = ['admin', 'ceo', 'manager', 'finance', 'department_head'].includes(role)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('vendors').select('*').order('name')
    setVendors(data || [])
    setLoading(false)
  }

  function openCreate() { setEditing(null); setForm(initForm()); setShowModal(true) }
  function openEdit(v) {
    setEditing(v)
    setForm({ ...initForm(), ...v })
    setShowModal(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    try {
      if (editing) {
        const { name, email, phone, category, address, city, gst_number, pan_number,
               bank_account, bank_name, bank_ifsc, credit_days, status } = form
        const upd = { name, email: email||null, phone: phone||null, category: category||null,
          address: address||null, city: city||null, gst_number: gst_number||null,
          pan_number: pan_number||null, bank_account: bank_account||null, bank_name: bank_name||null,
          bank_ifsc: bank_ifsc||null, credit_days: parseInt(credit_days)||30, status: status||'active' }
        const { error } = await supabase.from('vendors').update(upd).eq('id', editing.id)
        if (error) throw error
      } else {
        const { name, email, phone, category, address, city, gst_number, pan_number,
               bank_account, bank_name, bank_ifsc, credit_days, status } = form
        const code = 'VEN-' + Date.now().toString().slice(-6)
        const payload = { name, email: email||null, phone: phone||null, category: category||null,
          address: address||null, city: city||null, gst_number: gst_number||null,
          pan_number: pan_number||null, bank_account: bank_account||null, bank_name: bank_name||null,
          bank_ifsc: bank_ifsc||null, credit_days: parseInt(credit_days)||30,
          status: status||'active', code, created_by: profile.id }
        const { error } = await supabase.from('vendors').insert(payload)
        if (error) throw error
      }
      setShowModal(false); load()
    } catch (err) { alert(err.message) }
    finally { setSubmitting(false) }
  }

  async function handleDelete(id) {
    await supabase.from('vendors').delete().eq('id', id)
    setDeleteConfirm(null); load()
  }

  const filtered = vendors.filter(v =>
    !search || v.name?.toLowerCase().includes(search.toLowerCase()) ||
    v.category?.toLowerCase().includes(search.toLowerCase()) ||
    v.city?.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Vendor Management</div>
          <div className="page-subtitle">Manage your supplier and vendor network</div>
        </div>
        <div className="page-actions">
          <button className={`btn btn-ghost ${activeTab === 'cards' ? 'btn-primary' : ''}`} onClick={() => setActiveTab('cards')}>⊞ Cards</button>
          <button className={`btn btn-ghost ${activeTab === 'table' ? 'btn-primary' : ''}`} onClick={() => setActiveTab('table')}>☰ Table</button>
          {canEdit && <button className="btn btn-primary" onClick={openCreate}><Plus size={15} /> Add Vendor</button>}
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {[
          { label: 'Total Vendors', value: vendors.length, color: '#6366f1' },
          { label: 'Active', value: vendors.filter(v => v.status === 'active').length, color: '#10b981' },
          { label: 'Inactive', value: vendors.filter(v => !v.status === 'active').length, color: '#ef4444' },
          { label: 'Categories', value: [...new Set(vendors.map(v => v.category))].filter(Boolean).length, color: '#f59e0b' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ '--accent': s.color }}>
            <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 16 }}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search vendors..." />
      </div>

      {activeTab === 'cards' ? (
        <div className="grid-3">
          {filtered.length === 0 ? <div style={{ gridColumn: '1/-1' }}><Empty icon="🏭" title="No vendors found" desc="Add your first vendor to get started" /></div>
          : filtered.map((v, idx) => {
            const c = CARD_COLORS[idx % CARD_COLORS.length]
            return (
              <div key={v.id} style={{
                background: c.bg, border: `1.5px solid ${c.border}`, borderRadius: 14,
                padding: 20, position: 'relative', transition: 'transform .15s, box-shadow .15s'
              }} onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,.1)' }}
                onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: c.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 20, fontWeight: 700 }}>
                    {v.name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className={`badge ${v.status === 'active' ? 'badge-success' : 'badge-danger'}`}>{v.status === 'active' ? 'Active' : 'Inactive'}</span>
                    {canEdit && <>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openEdit(v)}><Edit2 size={12} /></button>
                      <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => setDeleteConfirm(v.id)}><Trash2 size={12} /></button>
                    </>}
                  </div>
                </div>

                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{v.name}</div>
                {v.category && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: `${c.accent}20`, color: c.accent, fontWeight: 600 }}>{v.category}</span>}

                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {v.contact_name && <div style={{ display: 'flex', gap: 8, fontSize: 12.5, color: 'var(--ink-soft)', alignItems: 'center' }}><Building size={12} style={{ color: c.accent }} />{v.contact_name}</div>}
                  {v.phone && <div style={{ display: 'flex', gap: 8, fontSize: 12.5, color: 'var(--ink-soft)', alignItems: 'center' }}><Phone size={12} style={{ color: c.accent }} />{v.phone}</div>}
                  {v.email && <div style={{ display: 'flex', gap: 8, fontSize: 12.5, color: 'var(--ink-soft)', alignItems: 'center' }}><Mail size={12} style={{ color: c.accent }} />{v.email}</div>}
                  {v.city && <div style={{ display: 'flex', gap: 8, fontSize: 12.5, color: 'var(--ink-soft)', alignItems: 'center' }}><MapPin size={12} style={{ color: c.accent }} />{v.city}</div>}
                </div>

                {v.gst_number && (
                  <div style={{ marginTop: 10, padding: '6px 10px', background: 'rgba(255,255,255,.6)', borderRadius: 8, fontSize: 11, fontFamily: 'monospace', color: 'var(--ink-soft)' }}>
                    GST: {v.gst_number}
                  </div>
                )}

                <div style={{ marginTop: 10, display: 'flex', gap: 2 }}>
                  {[1,2,3,4,5].map(s => <Star key={s} size={12} fill={s <= (v.rating || 0) ? c.accent : 'none'} color={c.accent} />)}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Category</th><th>Contact</th><th>Phone</th><th>City</th><th>GST</th><th>Rating</th><th>Status</th>{canEdit && <th>Actions</th>}</tr></thead>
            <tbody>
              {filtered.map(v => (
                <tr key={v.id}>
                  <td className="td-bold">{v.name}</td>
                  <td>{v.category}</td>
                  <td>{v.contact_name}</td>
                  <td>{v.phone}</td>
                  <td>{v.city}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{v.gst_number || '—'}</td>
                  <td>{'★'.repeat(v.rating || 0)}{'☆'.repeat(5 - (v.rating || 0))}</td>
                  <td><StatusBadge status={v.status === 'active' ? 'active' : 'inactive'} /></td>
                  {canEdit && <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openEdit(v)}><Edit2 size={12} /></button>
                      <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => setDeleteConfirm(v.id)}><Trash2 size={12} /></button>
                    </div>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Vendor' : 'Add New Vendor'} size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>{submitting ? 'Saving...' : editing ? 'Update Vendor' : 'Add Vendor'}</button>
        </>}
      >
        <form onSubmit={handleSubmit}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--c1)', marginBottom: 12, marginTop: 4 }}>Basic Information</div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Vendor Name *</label><input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
            <div className="form-group"><label className="form-label">Category</label>
              <select className="form-select" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                <option value="">Select...</option>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Contact Person</label><input className="form-input" value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">City</label><input className="form-input" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} /></div>
          </div>
          <div className="form-group"><label className="form-label">Address</label><textarea className="form-textarea" style={{ minHeight: 60 }} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>

          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--c1)', marginBottom: 12, marginTop: 16 }}>Tax & Banking</div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">GST Number</label><input className="form-input" value={form.gst_number} onChange={e => setForm(f => ({ ...f, gst_number: e.target.value }))} placeholder="22AAAAA0000A1Z5" /></div>
            <div className="form-group"><label className="form-label">Payment Terms (days)</label><input className="form-input" type="number" value={form.payment_terms} onChange={e => setForm(f => ({ ...f, payment_terms: parseInt(e.target.value) }))} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Bank Name</label><input className="form-input" value={form.bank_name} onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Account Number</label><input className="form-input" value={form.bank_account} onChange={e => setForm(f => ({ ...f, bank_account: e.target.value }))} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">IFSC Code</label><input className="form-input" value={form.ifsc_code} onChange={e => setForm(f => ({ ...f, ifsc_code: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Rating (1–5)</label>
              <select className="form-select" value={form.rating} onChange={e => setForm(f => ({ ...f, rating: parseInt(e.target.value) }))}>
                {[1,2,3,4,5].map(r => <option key={r} value={r}>{'★'.repeat(r)} {r}/5</option>)}</select></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <select className="form-select" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="blacklisted">Blacklisted</option>
            </select>
          </div>
        </form>
      </Modal>

      <Confirm open={!!deleteConfirm} message="Delete this vendor? This cannot be undone." danger onConfirm={() => handleDelete(deleteConfirm)} onCancel={() => setDeleteConfirm(null)} />
    </div>
  )
}
