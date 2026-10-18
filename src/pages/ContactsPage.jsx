import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { Modal, SearchBox, Loader, Empty, Confirm } from '../components/ui'
import { Plus, Edit2, Trash2, Phone, Mail, MapPin, Building2, Linkedin, MessageCircle, Star, Download, Copy } from 'lucide-react'

// Kind of company a contact belongs to. CUSTOMER / VENDOR can be linked to
// the existing masters; the rest are free-text companies.
export const COMPANY_TYPES = [
  { key: 'CUSTOMER', label: 'Customer', color: '#0284c7' },
  { key: 'VENDOR', label: 'Vendor', color: '#ea580c' },
  { key: 'PARTNER', label: 'Partner', color: '#9333ea' },
  { key: 'CONSULTANT', label: 'Consultant', color: '#0d9488' },
  { key: 'GOVERNMENT', label: 'Government', color: '#475569' },
  { key: 'INTERNAL', label: 'Internal', color: '#6366f1' },
  { key: 'OTHER', label: 'Other', color: '#64748b' },
]
const TYPE_BY_KEY = Object.fromEntries(COMPANY_TYPES.map(t => [t.key, t]))

// Suggestions only — contact_role is free text, any role can be typed.
const ROLE_SUGGESTIONS = ['Decision Maker', 'Primary POC', 'Technical', 'Procurement', 'Billing / Accounts', 'Operations', 'Site In-charge', 'Management', 'Sales', 'Support', 'Legal']

const EDIT_ROLES = ['admin', 'ceo', 'cto', 'manager', 'department_head', 'finance', 'procurement_lead', 'sales_head']

const initForm = () => ({
  full_name: '', designation: '', contact_role: '', department: '',
  company_type: 'CUSTOMER', company_name: '', customer_id: '', vendor_id: '',
  email: '', phone: '', alt_phone: '', whatsapp: '', linkedin: '',
  city: '', address: '', tags: '', is_primary: false, status: 'active', notes: '',
})

const telHref = p => 'tel:' + String(p).replace(/[^\d+]/g, '')
const waHref = p => 'https://wa.me/' + String(p).replace(/\D/g, '')

export default function ContactsPage() {
  const { profile } = useAuth()
  const [contacts, setContacts] = useState([])
  const [customers, setCustomers] = useState([])
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [companyFilter, setCompanyFilter] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [view, setView] = useState('table')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(initForm())
  const [submitting, setSubmitting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  const role = profile?.role || 'employee'
  const isManagerish = EDIT_ROLES.includes(role)
  const canEdit = c => isManagerish || c.created_by === profile?.id

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [c, cu, ve] = await Promise.all([
      supabase.from('contacts').select('*').order('full_name'),
      supabase.from('customers').select('id,name').order('name'),
      supabase.from('vendors').select('id,name').order('name'),
    ])
    if (c.error) alert(c.error.message.includes('contacts') ? 'Contacts table missing — run sql/STEP258_contacts.sql' : c.error.message)
    setContacts(c.data || [])
    setCustomers(cu.data || [])
    setVendors(ve.data || [])
    setLoading(false)
  }

  function openCreate() { setEditing(null); setForm(initForm()); setShowModal(true) }
  function openEdit(c) {
    setEditing(c)
    setForm({
      ...initForm(),
      ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v ?? ''])),
      tags: (c.tags || []).join(', '),
      is_primary: !!c.is_primary,
    })
    setShowModal(true)
  }
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e) {
    e?.preventDefault()
    if (!form.full_name.trim()) return alert('Name is required')
    setSubmitting(true)
    try {
      const nz = v => (typeof v === 'string' ? v.trim() : v) || null
      const linkCustomer = form.company_type === 'CUSTOMER' && form.customer_id
      const linkVendor = form.company_type === 'VENDOR' && form.vendor_id
      const payload = {
        full_name: form.full_name.trim(),
        designation: nz(form.designation), contact_role: nz(form.contact_role), department: nz(form.department),
        company_type: form.company_type,
        company_name: linkCustomer || linkVendor ? null : nz(form.company_name),
        customer_id: linkCustomer ? form.customer_id : null,
        vendor_id: linkVendor ? form.vendor_id : null,
        email: nz(form.email), phone: nz(form.phone), alt_phone: nz(form.alt_phone),
        whatsapp: nz(form.whatsapp), linkedin: nz(form.linkedin),
        city: nz(form.city), address: nz(form.address),
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        is_primary: !!form.is_primary, status: form.status || 'active', notes: nz(form.notes),
      }
      const { error } = editing
        ? await supabase.from('contacts').update(payload).eq('id', editing.id)
        : await supabase.from('contacts').insert(payload)
      if (error) throw error
      setShowModal(false); load()
    } catch (err) { alert(err.message) }
    finally { setSubmitting(false) }
  }

  async function handleDelete(id) {
    const { error } = await supabase.from('contacts').delete().eq('id', id)
    if (error) alert(error.message)
    setDeleteConfirm(null); load()
  }

  const companies = useMemo(
    () => [...new Set(contacts.map(c => c.company_name).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [contacts]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return contacts.filter(c =>
      (showInactive || c.status !== 'inactive') &&
      (typeFilter === 'ALL' || c.company_type === typeFilter) &&
      (!companyFilter || c.company_name === companyFilter) &&
      (!q || [c.full_name, c.company_name, c.designation, c.contact_role, c.department, c.email, c.phone, c.city, ...(c.tags || [])]
        .some(v => v && String(v).toLowerCase().includes(q)))
    )
  }, [contacts, search, typeFilter, companyFilter, showInactive])

  function exportCsv() {
    const cols = ['full_name', 'designation', 'contact_role', 'department', 'company_type', 'company_name', 'email', 'phone', 'alt_phone', 'whatsapp', 'linkedin', 'city', 'address', 'tags', 'is_primary', 'status', 'notes']
    const esc = v => `"${String(Array.isArray(v) ? v.join('; ') : v ?? '').replace(/"/g, '""')}"`
    const csv = [cols.join(','), ...filtered.map(c => cols.map(k => esc(c[k])).join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  function copyCard(c) {
    const lines = [c.full_name, [c.designation, c.company_name].filter(Boolean).join(', '), c.phone, c.email].filter(Boolean)
    navigator.clipboard?.writeText(lines.join('\n'))
  }

  if (loading) return <Loader />

  const typeBadge = t => {
    const ty = TYPE_BY_KEY[t] || TYPE_BY_KEY.OTHER
    return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: `${ty.color}18`, color: ty.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{ty.label}</span>
  }

  const actions = c => canEdit(c) && (
    <div style={{ display: 'flex', gap: 4 }}>
      <button className="btn btn-ghost btn-sm btn-icon" title="Edit" onClick={() => openEdit(c)}><Edit2 size={12} /></button>
      {isManagerish && <button className="btn btn-ghost btn-sm btn-icon" title="Delete" style={{ color: '#ef4444' }} onClick={() => setDeleteConfirm(c.id)}><Trash2 size={12} /></button>}
    </div>
  )

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Contacts</div>
          <div className="page-subtitle">Points of contact at every customer, vendor, partner and other company you work with</div>
        </div>
        <div className="page-actions">
          <button className={`btn ${view === 'table' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setView('table')}>Table</button>
          <button className={`btn ${view === 'cards' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setView('cards')}>Cards</button>
          <button className="btn btn-ghost" onClick={exportCsv} disabled={!filtered.length}><Download size={14} /> Export</button>
          <button className="btn btn-primary" onClick={openCreate}><Plus size={15} /> Add Contact</button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {[
          { label: 'Total Contacts', value: contacts.length, color: '#6366f1' },
          { label: 'Customer Contacts', value: contacts.filter(c => c.company_type === 'CUSTOMER').length, color: '#0284c7' },
          { label: 'Vendor Contacts', value: contacts.filter(c => c.company_type === 'VENDOR').length, color: '#ea580c' },
          { label: 'Companies', value: companies.length, color: '#10b981' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ '--accent': s.color }}>
            <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ flex: '1 1 240px' }}><SearchBox value={search} onChange={setSearch} placeholder="Search name, company, role, phone, email, tag..." /></div>
        <select className="form-select" style={{ width: 'auto' }} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="ALL">All company types</option>
          {COMPANY_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select className="form-select" style={{ width: 'auto', maxWidth: 220 }} value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}>
          <option value="">All companies</option>
          {companies.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: 'var(--ink-soft)' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive
        </label>
      </div>

      {filtered.length === 0 ? (
        <Empty title="No contacts found" desc={contacts.length ? 'Try a different search or filter' : 'Add your first point of contact to get started'} />
      ) : view === 'table' ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Company</th><th>Type</th><th>Role</th><th>Phone</th><th>Email</th><th>City</th><th></th></tr></thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} style={c.status === 'inactive' ? { opacity: 0.55 } : undefined}>
                  <td className="td-bold">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {c.full_name}
                      {c.is_primary && <Star size={12} fill="#f59e0b" color="#f59e0b" aria-label="Primary contact" />}
                    </div>
                    {c.designation && <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--ink-soft)' }}>{c.designation}</div>}
                  </td>
                  <td>{c.company_name || '—'}</td>
                  <td>{typeBadge(c.company_type)}</td>
                  <td>{c.contact_role || '—'}</td>
                  <td>{c.phone ? <a href={telHref(c.phone)}>{c.phone}</a> : '—'}</td>
                  <td>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '—'}</td>
                  <td>{c.city || '—'}</td>
                  <td>{actions(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid-3">
          {filtered.map(c => (
            <div key={c.id} className="card" style={{ padding: 18, opacity: c.status === 'inactive' ? 0.55 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {c.full_name}
                    {c.is_primary && <Star size={12} fill="#f59e0b" color="#f59e0b" aria-label="Primary contact" />}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{[c.designation, c.department].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                  <button className="btn btn-ghost btn-sm btn-icon" title="Copy details" onClick={() => copyCard(c)}><Copy size={12} /></button>
                  {actions(c)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {typeBadge(c.company_type)}
                {c.contact_role && <span className="badge">{c.contact_role}</span>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--ink-soft)' }}>
                {c.company_name && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Building2 size={12} />{c.company_name}</div>}
                {c.phone && <a href={telHref(c.phone)} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Phone size={12} />{c.phone}{c.alt_phone ? ` / ${c.alt_phone}` : ''}</a>}
                {c.whatsapp && <a href={waHref(c.whatsapp)} target="_blank" rel="noreferrer" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><MessageCircle size={12} />{c.whatsapp}</a>}
                {c.email && <a href={`mailto:${c.email}`} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Mail size={12} />{c.email}</a>}
                {c.linkedin && <a href={c.linkedin.startsWith('http') ? c.linkedin : `https://${c.linkedin}`} target="_blank" rel="noreferrer" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Linkedin size={12} />LinkedIn</a>}
                {c.city && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><MapPin size={12} />{c.city}</div>}
              </div>
              {c.tags?.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 10 }}>
                  {c.tags.map(t => <span key={t} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 99, border: '1px solid var(--border)', color: 'var(--ink-soft)' }}>{t}</span>)}
                </div>
              )}
              {c.notes && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-soft)', whiteSpace: 'pre-wrap' }}>{c.notes}</div>}
            </div>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Contact' : 'Add Contact'} size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>{submitting ? 'Saving...' : editing ? 'Update Contact' : 'Add Contact'}</button>
        </>}
      >
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Full Name *</label><input className="form-input" value={form.full_name} onChange={e => set('full_name', e.target.value)} required /></div>
            <div className="form-group"><label className="form-label">Designation</label><input className="form-input" value={form.designation} onChange={e => set('designation', e.target.value)} placeholder="e.g. Plant Head" /></div>
          </div>

          <div className="form-row">
            <div className="form-group"><label className="form-label">Company Type</label>
              <select className="form-select" value={form.company_type} onChange={e => set('company_type', e.target.value)}>
                {COMPANY_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
            {form.company_type === 'CUSTOMER' ? (
              <div className="form-group"><label className="form-label">Customer</label>
                <select className="form-select" value={form.customer_id} onChange={e => set('customer_id', e.target.value)}>
                  <option value="">— Not in customer list (type below) —</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            ) : form.company_type === 'VENDOR' ? (
              <div className="form-group"><label className="form-label">Vendor</label>
                <select className="form-select" value={form.vendor_id} onChange={e => set('vendor_id', e.target.value)}>
                  <option value="">— Not in vendor list (type below) —</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
            ) : (
              <div className="form-group"><label className="form-label">Company Name</label>
                <input className="form-input" list="contact-companies" value={form.company_name} onChange={e => set('company_name', e.target.value)} />
              </div>
            )}
          </div>
          {((form.company_type === 'CUSTOMER' && !form.customer_id) || (form.company_type === 'VENDOR' && !form.vendor_id)) && (
            <div className="form-group"><label className="form-label">Company Name</label>
              <input className="form-input" list="contact-companies" value={form.company_name} onChange={e => set('company_name', e.target.value)} />
            </div>
          )}
          <datalist id="contact-companies">{companies.map(n => <option key={n} value={n} />)}</datalist>

          <div className="form-row">
            <div className="form-group"><label className="form-label">Role / Responsibility</label>
              <input className="form-input" list="contact-roles" value={form.contact_role} onChange={e => set('contact_role', e.target.value)} placeholder="Any role, e.g. Decision Maker" />
              <datalist id="contact-roles">{ROLE_SUGGESTIONS.map(r => <option key={r} value={r} />)}</datalist>
            </div>
            <div className="form-group"><label className="form-label">Department</label><input className="form-input" value={form.department} onChange={e => set('department', e.target.value)} /></div>
          </div>

          <div className="form-row">
            <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Alternate Phone</label><input className="form-input" value={form.alt_phone} onChange={e => set('alt_phone', e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} /></div>
            <div className="form-group"><label className="form-label">WhatsApp</label><input className="form-input" value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} placeholder="with country code, e.g. 9198..." /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">LinkedIn</label><input className="form-input" value={form.linkedin} onChange={e => set('linkedin', e.target.value)} /></div>
            <div className="form-group"><label className="form-label">City</label><input className="form-input" value={form.city} onChange={e => set('city', e.target.value)} /></div>
          </div>
          <div className="form-group"><label className="form-label">Address</label><textarea className="form-textarea" style={{ minHeight: 50 }} value={form.address} onChange={e => set('address', e.target.value)} /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Tags</label><input className="form-input" value={form.tags} onChange={e => set('tags', e.target.value)} placeholder="comma separated, e.g. pune-site, escalation" /></div>
            <div className="form-group"><label className="form-label">Status</label>
              <select className="form-select" value={form.status} onChange={e => set('status', e.target.value)}>
                <option value="active">Active</option>
                <option value="inactive">Inactive (left company)</option>
              </select>
            </div>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 12 }}>
            <input type="checkbox" checked={form.is_primary} onChange={e => set('is_primary', e.target.checked)} /> Primary point of contact for this company
          </label>
          <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" style={{ minHeight: 60 }} value={form.notes} onChange={e => set('notes', e.target.value)} /></div>
        </form>
      </Modal>

      <Confirm open={!!deleteConfirm} message="Delete this contact? This cannot be undone." danger onConfirm={() => handleDelete(deleteConfirm)} onCancel={() => setDeleteConfirm(null)} />
    </div>
  )
}
