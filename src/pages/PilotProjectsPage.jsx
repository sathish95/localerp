import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, rupee, dateFmt } from '../lib/supabase'
import { listPilotProjects, createPilotProject, convertPilotProject, markPilotNotConverted } from '../lib/salesPilotProjects'
import { listRegions } from '../lib/salesAdmin'
import { Modal, StatusBadge, Loader, Empty, StatCard } from '../components/ui'
import { Plus, FlaskConical, CheckCircle, XCircle } from 'lucide-react'

const initForm = () => ({ prospect_name: '', product_piloted: '', pilot_cost: '', pilot_duration: '', start_date: '', end_date: '' })

export default function PilotProjectsPage() {
  const { profile } = useAuth()
  const [pilots, setPilots] = useState([])
  const [products, setProducts] = useState([])
  const [regions, setRegions] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [convertTarget, setConvertTarget] = useState(null)
  const [notConvertTarget, setNotConvertTarget] = useState(null)
  const [form, setForm] = useState(initForm())
  const [convertForm, setConvertForm] = useState({ region_id: '', expected_value: '', expected_close_date: '' })
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const [p, prods, r] = await Promise.all([listPilotProjects(), supabase.from('products').select('part_number,name').then(x => x.data || []), listRegions()])
    setPilots(p); setProducts(prods); setRegions(r)
    setLoading(false)
  }

  async function save(e) {
    e.preventDefault()
    if (!form.prospect_name) { setErr('Prospect name is required'); return }
    setSaving(true); setErr('')
    try { await createPilotProject(form, profile.id); setShowModal(false); setForm(initForm()); await load() }
    catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  async function confirmConvert() {
    setSaving(true); setErr('')
    try { await convertPilotProject(convertTarget.id, convertForm, profile.id); setConvertTarget(null); await load() }
    catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  async function confirmNotConverted() {
    await markPilotNotConverted(notConvertTarget.id, reason)
    setNotConvertTarget(null); setReason(''); await load()
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Pilot Projects</div>
          <div className="page-subtitle">Non-Government pilots — near-zero cost, absorbed as BD spend; non-conversion reasons feed CTO's technical feedback loop</div>
        </div>
        <div className="page-actions"><button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={15} /> New Pilot</button></div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Total Pilots" value={pilots.length} icon={<FlaskConical size={17} />} accent="#0ea5e9" />
        <StatCard label="Converted" value={pilots.filter(p => p.conversion_outcome === 'Converted').length} icon={<CheckCircle size={17} />} accent="#15803d" />
        <StatCard label="Not Converted" value={pilots.filter(p => p.conversion_outcome === 'Not Converted').length} icon={<XCircle size={17} />} accent="#dc2626" />
      </div>

      {pilots.length === 0 ? (
        <div className="card" style={{ padding: '20px 24px' }}><Empty icon="🧪" title="No pilots tracked" desc="Add the first pilot" /></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Prospect</th><th>Product</th><th>Pilot Cost</th><th>Duration</th><th>Outcome</th><th></th></tr></thead>
            <tbody>
              {pilots.map(p => (
                <tr key={p.id}>
                  <td className="td-bold">{p.prospect_name}</td>
                  <td>{p.product?.name || '—'}</td>
                  <td>{rupee(p.pilot_cost)}</td>
                  <td style={{ fontSize: 12 }}>{p.pilot_duration || '—'}</td>
                  <td>{p.conversion_outcome ? <StatusBadge status={p.conversion_outcome === 'Converted' ? 'approved' : 'rejected'} /> : <span style={{ fontSize: 11, color: '#94a3b8' }}>Pending</span>}</td>
                  <td>
                    {!p.conversion_outcome && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setConvertTarget(p)}>Convert</button>
                        <button className="btn btn-ghost btn-sm" style={{ color: '#ef4444' }} onClick={() => setNotConvertTarget(p)}>Not Converted</button>
                      </div>
                    )}
                    {p.conversion_outcome === 'Not Converted' && p.conversion_reason && <span style={{ fontSize: 11, color: '#94a3b8' }} title={p.conversion_reason}>{p.conversion_reason.slice(0, 30)}…</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="New Pilot Project"
        footer={<><button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Create'}</button></>}>
        <form onSubmit={save}>
          {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
          <div className="form-group"><label className="form-label">Prospect Name *</label><input className="form-input" value={form.prospect_name} onChange={e => setForm(f => ({ ...f, prospect_name: e.target.value }))} required /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Product Piloted</label>
              <select className="form-select" value={form.product_piloted} onChange={e => setForm(f => ({ ...f, product_piloted: e.target.value }))}>
                <option value="">—</option>{products.map(p => <option key={p.part_number} value={p.part_number}>{p.name}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Pilot Cost</label><input className="form-input" type="number" value={form.pilot_cost} onChange={e => setForm(f => ({ ...f, pilot_cost: e.target.value }))} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Start Date</label><input className="form-input" type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">End Date</label><input className="form-input" type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} /></div>
          </div>
          <div className="form-group"><label className="form-label">Duration (free text)</label><input className="form-input" value={form.pilot_duration} onChange={e => setForm(f => ({ ...f, pilot_duration: e.target.value }))} placeholder="e.g. 6 weeks" /></div>
        </form>
      </Modal>

      <Modal open={!!convertTarget} onClose={() => setConvertTarget(null)} title="Convert to Opportunity"
        footer={<><button className="btn btn-ghost" onClick={() => setConvertTarget(null)}>Cancel</button><button className="btn btn-primary" onClick={confirmConvert} disabled={saving}>{saving ? 'Converting…' : 'Convert'}</button></>}>
        {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="form-group"><label className="form-label">Region</label>
          <select className="form-select" value={convertForm.region_id} onChange={e => setConvertForm(f => ({ ...f, region_id: e.target.value }))}>
            <option value="">—</option>{regions.map(r => <option key={r.id} value={r.id}>{r.region_name}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">Expected Value</label><input className="form-input" type="number" value={convertForm.expected_value} onChange={e => setConvertForm(f => ({ ...f, expected_value: e.target.value }))} /></div>
        <div className="form-group"><label className="form-label">Expected Close Date</label><input className="form-input" type="date" value={convertForm.expected_close_date} onChange={e => setConvertForm(f => ({ ...f, expected_close_date: e.target.value }))} /></div>
      </Modal>

      <Modal open={!!notConvertTarget} onClose={() => setNotConvertTarget(null)} title="Mark Not Converted"
        footer={<><button className="btn btn-ghost" onClick={() => setNotConvertTarget(null)}>Cancel</button><button className="btn btn-danger" onClick={confirmNotConverted}>Confirm</button></>}>
        <div className="form-group"><label className="form-label">Reason (routed to CTO as technical/product feedback)</label><textarea className="form-textarea" value={reason} onChange={e => setReason(e.target.value)} /></div>
      </Modal>
    </div>
  )
}
