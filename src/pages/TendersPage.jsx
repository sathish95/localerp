import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { rupee, dateFmt } from '../lib/supabase'
import { listTenders, createTender, updateTenderStatus, markTenderWon } from '../lib/salesTenders'
import { listRegions } from '../lib/salesAdmin'
import { Modal, StatusBadge, Loader, Empty, StatCard } from '../components/ui'
import { Plus, Landmark, CheckCircle } from 'lucide-react'

const STATUSES = ['Identified', 'Eligibility Check', 'Documents Prepared', 'Submitted', 'Under Evaluation', 'Won', 'Lost']
const initForm = () => ({ tender_number: '', issuing_body: '', submission_deadline: '', bid_amount: '', currency: 'INR' })

export default function TendersPage() {
  const { profile } = useAuth()
  const [tenders, setTenders] = useState([])
  const [regions, setRegions] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [wonTarget, setWonTarget] = useState(null)
  const [form, setForm] = useState(initForm())
  const [wonForm, setWonForm] = useState({ region_id: '', expected_close_date: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() { setLoading(true); const [t, r] = await Promise.all([listTenders(), listRegions()]); setTenders(t); setRegions(r); setLoading(false) }

  async function save(e) {
    e.preventDefault()
    if (!form.tender_number || !form.issuing_body) { setErr('Tender number and issuing body are required'); return }
    setSaving(true); setErr('')
    try { await createTender(form, profile.id); setShowModal(false); setForm(initForm()); await load() }
    catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  async function changeStatus(t, status) {
    if (status === 'Won') { setWonTarget(t); return }
    await updateTenderStatus(t.id, status, profile.id); await load()
  }

  async function confirmWon() {
    setSaving(true); setErr('')
    try { await markTenderWon(wonTarget.id, wonForm, profile.id); setWonTarget(null); setWonForm({ region_id: '', expected_close_date: '' }); await load() }
    catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Government Tenders</div>
          <div className="page-subtitle">Won tenders converge into the standard Opportunity → Proposal pipeline</div>
        </div>
        <div className="page-actions"><button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={15} /> New Tender</button></div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Total" value={tenders.length} icon={<Landmark size={17} />} accent="#0369a1" />
        <StatCard label="Under Evaluation" value={tenders.filter(t => t.status === 'Under Evaluation').length} icon={<Landmark size={17} />} accent="#f59e0b" />
        <StatCard label="Won" value={tenders.filter(t => t.status === 'Won').length} icon={<CheckCircle size={17} />} accent="#15803d" />
      </div>

      {tenders.length === 0 ? (
        <div className="card" style={{ padding: '20px 24px' }}><Empty icon="🏛" title="No tenders tracked" desc="Add the first tender" /></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Tender #</th><th>Issuing Body</th><th>Deadline</th><th>Bid Amount</th><th>Status</th></tr></thead>
            <tbody>
              {tenders.map(t => (
                <tr key={t.id}>
                  <td className="td-bold">{t.tender_number}</td>
                  <td>{t.issuing_body}</td>
                  <td style={{ fontSize: 12 }}>{t.submission_deadline ? dateFmt(t.submission_deadline) : '—'}</td>
                  <td>{t.bid_amount ? rupee(t.bid_amount) : '—'}</td>
                  <td>
                    <select className="form-select" style={{ fontSize: 12, width: 160 }} value={t.status} disabled={t.status === 'Won'} onChange={e => changeStatus(t, e.target.value)}>
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="New Tender"
        footer={<><button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Create'}</button></>}>
        <form onSubmit={save}>
          {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
          <div className="form-row">
            <div className="form-group"><label className="form-label">Tender Number *</label><input className="form-input" value={form.tender_number} onChange={e => setForm(f => ({ ...f, tender_number: e.target.value }))} required /></div>
            <div className="form-group"><label className="form-label">Issuing Body *</label><input className="form-input" value={form.issuing_body} onChange={e => setForm(f => ({ ...f, issuing_body: e.target.value }))} required /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Submission Deadline</label><input className="form-input" type="date" value={form.submission_deadline} onChange={e => setForm(f => ({ ...f, submission_deadline: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Bid Amount</label><input className="form-input" type="number" value={form.bid_amount} onChange={e => setForm(f => ({ ...f, bid_amount: e.target.value }))} /></div>
          </div>
        </form>
      </Modal>

      <Modal open={!!wonTarget} onClose={() => setWonTarget(null)} title="Mark Tender Won"
        footer={<><button className="btn btn-ghost" onClick={() => setWonTarget(null)}>Cancel</button><button className="btn btn-primary" onClick={confirmWon} disabled={saving}>{saving ? 'Converting…' : 'Confirm & Create Opportunity'}</button></>}>
        {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="form-group"><label className="form-label">Region</label>
          <select className="form-select" value={wonForm.region_id} onChange={e => setWonForm(f => ({ ...f, region_id: e.target.value }))}>
            <option value="">—</option>{regions.map(r => <option key={r.id} value={r.id}>{r.region_name}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">Expected Close Date</label><input className="form-input" type="date" value={wonForm.expected_close_date} onChange={e => setWonForm(f => ({ ...f, expected_close_date: e.target.value }))} /></div>
      </Modal>
    </div>
  )
}
