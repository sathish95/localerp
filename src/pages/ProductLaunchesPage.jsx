import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { dateFmt } from '../lib/supabase'
import { listProductLaunches, createProductLaunch, updateProductLaunch, getInterestCounts } from '../lib/productLaunch'
import { Modal, StatusBadge, Loader, Empty, StatCard } from '../components/ui'
import { Plus, Sparkles, TrendingUp } from 'lucide-react'

const STAGES = ['Concept', 'Development', 'Beta', 'Pilot-Ready', 'Launched']
const initForm = () => ({ product_name: '', description: '', target_launch_date: '', development_stage: 'Concept' })

export default function ProductLaunchesPage() {
  const { profile } = useAuth()
  const [launches, setLaunches] = useState([])
  const [interest, setInterest] = useState({})
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(initForm())
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const [l, i] = await Promise.all([listProductLaunches(), getInterestCounts()])
    setLaunches(l); setInterest(i)
    setLoading(false)
  }

  async function save(e) {
    e.preventDefault()
    if (!form.product_name) { setErr('Product name is required'); return }
    setSaving(true); setErr('')
    try { await createProductLaunch(form, profile.id); setShowModal(false); setForm(initForm()); await load() }
    catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  async function changeStage(id, development_stage) { await updateProductLaunch(id, { development_stage }); await load() }

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Product Launches</div>
          <div className="page-subtitle">Upcoming/new products, before they're in the live catalog — sales-logged interest is real pre-launch demand signal</div>
        </div>
        <div className="page-actions"><button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={15} /> New Product Launch</button></div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Tracked" value={launches.length} icon={<Sparkles size={17} />} accent="#8b5cf6" />
        <StatCard label="Pilot-Ready" value={launches.filter(l => l.development_stage === 'Pilot-Ready').length} icon={<Sparkles size={17} />} accent="#0ea5e9" />
        <StatCard label="Total Interest Logged" value={Object.values(interest).reduce((a, b) => a + b, 0)} icon={<TrendingUp size={17} />} accent="#f59e0b" />
      </div>

      {launches.length === 0 ? (
        <div className="card" style={{ padding: '20px 24px' }}><Empty icon="✨" title="No product launches tracked" desc="Add the first upcoming product" /></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Product</th><th>Target Launch</th><th>Stage</th><th>Interest</th></tr></thead>
            <tbody>
              {launches.map(l => (
                <tr key={l.id}>
                  <td className="td-bold">{l.product_name}</td>
                  <td style={{ fontSize: 12 }}>{l.target_launch_date ? dateFmt(l.target_launch_date) : '—'}</td>
                  <td>
                    <select className="form-select" style={{ fontSize: 12, width: 140 }} value={l.development_stage} onChange={e => changeStage(l.id, e.target.value)}>
                      {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>{interest[l.id] || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="New Product Launch"
        footer={<><button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Create'}</button></>}>
        <form onSubmit={save}>
          {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
          <div className="form-group"><label className="form-label">Product Name *</label><input className="form-input" value={form.product_name} onChange={e => setForm(f => ({ ...f, product_name: e.target.value }))} required /></div>
          <div className="form-group"><label className="form-label">Description</label><textarea className="form-textarea" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Target Launch Date</label><input className="form-input" type="date" value={form.target_launch_date} onChange={e => setForm(f => ({ ...f, target_launch_date: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Stage</label>
              <select className="form-select" value={form.development_stage} onChange={e => setForm(f => ({ ...f, development_stage: e.target.value }))}>
                {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
              </select></div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
