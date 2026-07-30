import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, rupee, dateFmt } from '../lib/supabase'
import { listRoleRates, upsertRoleRate, deleteRoleRate } from '../lib/roleRates'
import { Modal, Loader, Empty, Confirm } from '../components/ui'
import { Plus, Trash2, ChevronDown, ChevronRight, DollarSign } from 'lucide-react'

const initForm = () => ({ designation: '', hourly_rate: '', effective_from: new Date().toISOString().slice(0, 10), notes: '' })

export default function RoleRatesPage() {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const canManage = ['admin', 'finance', 'hr'].includes(role)

  const [rates, setRates] = useState([])
  const [designations, setDesignations] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(initForm())
  const [submitting, setSubmitting] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set())
  const [delId, setDelId] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [r, p] = await Promise.all([
      listRoleRates(),
      supabase.from('profiles').select('designation').not('designation', 'is', null),
    ])
    setRates(r)
    setDesignations([...new Set((p.data || []).map(x => x.designation).filter(Boolean))].sort())
    setLoading(false)
  }

  async function saveRate(e) {
    e.preventDefault()
    if (!form.designation.trim() || !form.hourly_rate || !form.effective_from) return
    setSubmitting(true)
    try {
      await upsertRoleRate({
        designation: form.designation.trim(), hourly_rate: parseFloat(form.hourly_rate),
        effective_from: form.effective_from, notes: form.notes || null, created_by: profile.id,
      })
      setShowModal(false); setForm(initForm()); load()
    } catch (e) { alert(e.message) } finally { setSubmitting(false) }
  }

  async function removeRate(id) {
    await deleteRoleRate(id)
    setDelId(null); load()
  }

  function toggle(designation) {
    setExpanded(prev => { const n = new Set(prev); n.has(designation) ? n.delete(designation) : n.add(designation); return n })
  }

  const grouped = {}
  rates.forEach(r => { (grouped[r.designation] ||= []).push(r) })
  const designationList = Object.keys(grouped).sort()

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Role Rates</div>
          <div className="page-subtitle">Default cost rate per designation, used for Actual Cost & Burn Rate when no individual rate is set</div>
        </div>
        {canManage && (
          <button className="btn btn-primary" onClick={() => { setForm(initForm()); setShowModal(true) }}>
            <Plus size={15} /> Add Rate
          </button>
        )}
      </div>

      {designationList.length === 0 ? (
        <Empty icon={<DollarSign size={44} />} title="No role rates configured" desc="Add a rate for a designation to enable people-cost rollups" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {designationList.map(desig => {
            const history = grouped[desig]
            const current = history.find(r => !r.effective_to) || history[0]
            const isOpen = expanded.has(desig)
            return (
              <div key={desig} style={{ background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
                <div onClick={() => toggle(desig)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', cursor: 'pointer' }}>
                  {isOpen ? <ChevronDown size={14} style={{ color: '#94a3b8' }} /> : <ChevronRight size={14} style={{ color: '#94a3b8' }} />}
                  <span style={{ fontWeight: 700, fontSize: 13.5, flex: 1 }}>{desig}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#6366f1' }}>{rupee(current.hourly_rate)}/hr</span>
                  <span style={{ fontSize: 10.5, color: '#94a3b8' }}>{history.length} rate{history.length !== 1 ? 's' : ''}</span>
                </div>
                {isOpen && (
                  <div className="table-wrap" style={{ borderTop: '1px solid #f1f5f9' }}>
                    <table>
                      <thead><tr><th>Rate</th><th>Effective From</th><th>Effective To</th><th>Notes</th>{canManage && <th></th>}</tr></thead>
                      <tbody>
                        {history.map(r => (
                          <tr key={r.id}>
                            <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{rupee(r.hourly_rate)}/hr</td>
                            <td>{dateFmt(r.effective_from)}</td>
                            <td>{r.effective_to ? dateFmt(r.effective_to) : <span style={{ color: '#10b981', fontWeight: 700 }}>Current</span>}</td>
                            <td style={{ fontSize: 12, color: '#64748b' }}>{r.notes || '—'}</td>
                            {canManage && <td><button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => setDelId(r.id)}><Trash2 size={12} /></button></td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add Role Rate" size="md"
        footer={<><button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button><button className="btn btn-primary" onClick={saveRate} disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</button></>}>
        <div className="form-group">
          <label className="form-label">Designation *</label>
          <input className="form-input" list="designation-options" value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} placeholder="e.g. Software Engineer" />
          <datalist id="designation-options">{designations.map(d => <option key={d} value={d} />)}</datalist>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Hourly Rate (₹) *</label>
            <input className="form-input" type="number" min={0} step={0.01} value={form.hourly_rate} onChange={e => setForm(f => ({ ...f, hourly_rate: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Effective From *</label>
            <input className="form-input" type="date" value={form.effective_from} onChange={e => setForm(f => ({ ...f, effective_from: e.target.value }))} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea className="form-textarea" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional context for this rate change…" />
        </div>
        <div style={{ fontSize: 11.5, color: '#94a3b8' }}>Adding a rate for a designation that already has a current (open-ended) rate automatically closes the old one the day before this rate starts.</div>
      </Modal>

      <Confirm open={!!delId} message="Delete this rate entry? This may affect historical cost calculations." danger onConfirm={() => removeRate(delId)} onCancel={() => setDelId(null)} />
    </div>
  )
}
