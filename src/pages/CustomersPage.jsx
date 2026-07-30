import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { Modal, SearchBox, StatusBadge, Loader, Empty, Confirm } from '../components/ui'
import { Plus, Edit2, Trash2, Phone, Mail, MapPin, Building2 } from 'lucide-react'

const CARD_COLORS = [
  { bg: '#f0f9ff', border: '#bae6fd', accent: '#0284c7' },
  { bg: '#f0fdf4', border: '#bbf7d0', accent: '#16a34a' },
  { bg: '#fdf4ff', border: '#e9d5ff', accent: '#9333ea' },
  { bg: '#fff7ed', border: '#fed7aa', accent: '#ea580c' },
  { bg: '#fdf2f8', border: '#fbcfe8', accent: '#db2777' },
  { bg: '#f0fdfa', border: '#99f6e4', accent: '#0d9488' },
]

const initForm = () => ({
  name: '', industry: '', contact_name: '', email: '', phone: '',
  address: '', city: '', gst_number: '', status: 'active', notes: '',
})

export default function CustomersPage() {
  const { profile } = useAuth()
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(initForm())
  const [submitting, setSubmitting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [activeTab, setActiveTab] = useState('cards')

  const role = profile?.role || 'employee'
  const canEdit = ['admin', 'ceo', 'manager', 'department_head', 'finance', 'procurement_lead'].includes(role)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('customers').select('*').order('name')
    setCustomers(data || [])
    setLoading(false)
  }

  function openCreate() { setEditing(null); setForm(initForm()); setShowModal(true) }
  function openEdit(c) { setEditing(c); setForm({ ...initForm(), ...c }); setShowModal(true) }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const { name, industry, contact_name, email, phone, address, city, gst_number, status, notes } = form
      const payload = {
        name, industry: industry || null, contact_name: contact_name || null, email: email || null,
        phone: phone || null, address: address || null, city: city || null,
        gst_number: gst_number || null, status: status || 'active', notes: notes || null,
      }
      if (editing) {
        const { error } = await supabase.from('customers').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const code = 'CUS-' + Date.now().toString().slice(-6)
        const { error } = await supabase.from('customers').insert({ ...payload, code, created_by: profile.id })
        if (error) throw error
      }
      setShowModal(false); load()
    } catch (err) { alert(err.message) }
    finally { setSubmitting(false) }
  }

  async function handleDelete(id) {
    await supabase.from('customers').delete().eq('id', id)
    setDeleteConfirm(null); load()
  }

  const filtered = customers.filter(c =>
    !search || c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.industry?.toLowerCase().includes(search.toLowerCase()) ||
    c.city?.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Customers</div>
          <div className="page-subtitle">Customer accounts behind every project and deployed device</div>
        </div>
        <div className="page-actions">
          <button className={`btn btn-ghost ${activeTab === 'cards' ? 'btn-primary' : ''}`} onClick={() => setActiveTab('cards')}>⊞ Cards</button>
          <button className={`btn btn-ghost ${activeTab === 'table' ? 'btn-primary' : ''}`} onClick={() => setActiveTab('table')}>☰ Table</button>
          {canEdit && <button className="btn btn-primary" onClick={openCreate}><Plus size={15} /> Add Customer</button>}
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {[
          { label: 'Total Customers', value: customers.length, color: '#6366f1' },
          { label: 'Active', value: customers.filter(c => c.status === 'active').length, color: '#10b981' },
          { label: 'Inactive', value: customers.filter(c => c.status === 'inactive').length, color: '#ef4444' },
          { label: 'Industries', value: [...new Set(customers.map(c => c.industry))].filter(Boolean).length, color: '#f59e0b' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ '--accent': s.color }}>
            <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 16 }}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search customers..." />
      </div>

      {activeTab === 'cards' ? (
        <div className="grid-3">
          {filtered.length === 0 ? <div style={{ gridColumn: '1/-1' }}><Empty icon="🏢" title="No customers found" desc="Add your first customer to get started" /></div>
          : filtered.map((c, idx) => {
            const col = CARD_COLORS[idx % CARD_COLORS.length]
            return (
              <div key={c.id} style={{
                background: col.bg, border: `1.5px solid ${col.border}`, borderRadius: 14,
                padding: 20, position: 'relative', transition: 'transform .15s, box-shadow .15s'
              }} onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,.1)' }}
                onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: col.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 20, fontWeight: 700 }}>
                    {c.name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className={`badge ${c.status === 'active' ? 'badge-success' : 'badge-danger'}`}>{c.status === 'active' ? 'Active' : 'Inactive'}</span>
                    {canEdit && <>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openEdit(c)}><Edit2 size={12} /></button>
                      <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => setDeleteConfirm(c.id)}><Trash2 size={12} /></button>
                    </>}
                  </div>
                </div>

                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{c.name}</div>
                {c.industry && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: `${col.accent}20`, color: col.accent, fontWeight: 600 }}>{c.industry}</span>}

                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {c.contact_name && <div style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--ink-soft)', alignItems: 'center' }}><Building2 size={12} style={{ color: col.accent }} />{c.contact_name}</div>}
                  {c.phone && <div style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--ink-soft)', alignItems: 'center' }}><Phone size={12} style={{ color: col.accent }} />{c.phone}</div>}
                  {c.email && <div style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--ink-soft)', alignItems: 'center' }}><Mail size={12} style={{ color: col.accent }} />{c.email}</div>}
                  {c.city && <div style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--ink-soft)', alignItems: 'center' }}><MapPin size={12} style={{ color: col.accent }} />{c.city}</div>}
                </div>

                {c.gst_number && (
                  <div style={{ marginTop: 10, padding: '6px 10px', background: 'rgba(255,255,255,.6)', borderRadius: 8, fontSize: 11, fontFamily: 'monospace', color: 'var(--ink-soft)' }}>
                    GST: {c.gst_number}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Industry</th><th>Contact</th><th>Phone</th><th>City</th><th>GST</th><th>Status</th>{canEdit && <th>Actions</th>}</tr></thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id}>
                  <td className="td-bold">{c.name}</td>
                  <td>{c.industry}</td>
                  <td>{c.contact_name}</td>
                  <td>{c.phone}</td>
                  <td>{c.city}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{c.gst_number || '—'}</td>
                  <td><StatusBadge status={c.status === 'active' ? 'active' : 'inactive'} /></td>
                  {canEdit && <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openEdit(c)}><Edit2 size={12} /></button>
                      <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => setDeleteConfirm(c.id)}><Trash2 size={12} /></button>
                    </div>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Customer' : 'Add New Customer'} size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>{submitting ? 'Saving...' : editing ? 'Update Customer' : 'Add Customer'}</button>
        </>}
      >
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Customer Name *</label><input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
            <div className="form-group"><label className="form-label">Industry</label><input className="form-input" value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))} placeholder="e.g. Manufacturing" /></div>
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
          <div className="form-row">
            <div className="form-group"><label className="form-label">GST Number</label><input className="form-input" value={form.gst_number} onChange={e => setForm(f => ({ ...f, gst_number: e.target.value }))} placeholder="22AAAAA0000A1Z5" /></div>
            <div className="form-group"><label className="form-label">Status</label>
              <select className="form-select" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select></div>
          </div>
          <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" style={{ minHeight: 60 }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
        </form>
      </Modal>

      <Confirm open={!!deleteConfirm} message="Delete this customer? This cannot be undone." danger onConfirm={() => handleDelete(deleteConfirm)} onCancel={() => setDeleteConfirm(null)} />
    </div>
  )
}
