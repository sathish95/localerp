import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { dateFmt } from '../lib/supabase'
import {
  listCycles, createCycle, updateCycle, getScoreWeights, saveScoreWeights,
  CYCLE_TYPES, CYCLE_STATUSES,
} from '../lib/performance'
import { Modal, Loader, Empty, StatCard } from '../components/ui'
import { Target, Plus, Settings2, CheckCircle } from 'lucide-react'

const STATUS_COLOR = {
  'Planning': { bg: '#f1f5f9', color: '#475569' }, 'Goal-Setting Open': { bg: '#e0e7ff', color: '#4338ca' },
  'In Progress': { bg: '#fef3c7', color: '#b45309' }, 'Feedback Open': { bg: '#dbeafe', color: '#1d4ed8' },
  'Manager Review': { bg: '#fce7f3', color: '#be185d' }, 'Calibration': { bg: '#fee2e2', color: '#dc2626' },
  'Closed': { bg: '#dcfce7', color: '#15803d' },
}
const StatusPill = ({ status }) => {
  const c = STATUS_COLOR[status] || STATUS_COLOR.Planning
  return <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: c.bg, color: c.color, whiteSpace: 'nowrap' }}>{status}</span>
}

export default function PerformanceCyclesPage() {
  const { profile } = useAuth()
  const [cycles, setCycles] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showWeights, setShowWeights] = useState(false)
  const [form, setForm] = useState({ cycle_name: '', cycle_type: 'Quarterly', start_date: '', end_date: '', calibration_required: false })
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() { setLoading(true); setCycles(await listCycles()); setLoading(false) }

  async function handleCreate(e) {
    e.preventDefault()
    if (!form.cycle_name || !form.start_date || !form.end_date) { setErr('Cycle name, start date and end date are required'); return }
    setCreating(true); setErr('')
    try {
      await createCycle(form, profile.id)
      setShowCreate(false)
      setForm({ cycle_name: '', cycle_type: 'Quarterly', start_date: '', end_date: '', calibration_required: false })
      await load()
    } catch (e) { setErr(e.message) }
    finally { setCreating(false) }
  }

  async function advanceStatus(cycle) {
    const idx = CYCLE_STATUSES.indexOf(cycle.status)
    if (idx === -1 || idx === CYCLE_STATUSES.length - 1) return
    await updateCycle(cycle.id, { status: CYCLE_STATUSES[idx + 1] })
    await load()
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#4338ca)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <Target size={19} />
            </span>
            Performance Review Cycles
          </div>
          <div className="page-subtitle">Goal-setting → self-assessment → 360 feedback → manager review → calibration → final rating</div>
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={() => setShowWeights(true)}><Settings2 size={15} /> Composite Score Weights</button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} /> New Cycle</button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <StatCard label="Total Cycles" value={cycles.length} icon={<Target size={17} />} accent="#6366f1" />
        <StatCard label="Active" value={cycles.filter(c => !['Planning', 'Closed'].includes(c.status)).length} icon={<CheckCircle size={17} />} accent="#b45309" />
        <StatCard label="Closed" value={cycles.filter(c => c.status === 'Closed').length} icon={<CheckCircle size={17} />} accent="#15803d" />
      </div>

      {cycles.length === 0 ? (
        <Empty icon={<Target size={40} />} title="No review cycles yet" desc="Create the first one to start goal-setting" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Cycle</th><th>Type</th><th>Period</th><th>Status</th><th>Calibration</th><th></th></tr></thead>
            <tbody>
              {cycles.map(c => (
                <tr key={c.id}>
                  <td className="td-bold">{c.cycle_name}</td>
                  <td><span className="badge">{c.cycle_type}</span></td>
                  <td style={{ fontSize: 12 }}>{dateFmt(c.start_date)} – {dateFmt(c.end_date)}</td>
                  <td><StatusPill status={c.status} /></td>
                  <td style={{ fontSize: 12 }}>{c.calibration_required ? 'Required' : 'Optional / Skipped'}</td>
                  <td>
                    {c.status !== 'Closed' && (
                      <button className="btn btn-outline btn-sm" onClick={() => advanceStatus(c)}>
                        Advance → {CYCLE_STATUSES[CYCLE_STATUSES.indexOf(c.status) + 1]}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Performance Cycle"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>{creating ? 'Creating…' : 'Create Cycle'}</button>
        </>}>
        <form onSubmit={handleCreate}>
          {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
          <div className="form-group"><label className="form-label">Cycle Name *</label><input className="form-input" value={form.cycle_name} onChange={e => setForm(f => ({ ...f, cycle_name: e.target.value }))} placeholder="e.g. Q3 FY26" required /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Type</label>
              <select className="form-select" value={form.cycle_type} onChange={e => setForm(f => ({ ...f, cycle_type: e.target.value }))}>
                {CYCLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Start Date *</label><input className="form-input" type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} required /></div>
            <div className="form-group"><label className="form-label">End Date *</label><input className="form-input" type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} required /></div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={form.calibration_required} onChange={e => setForm(f => ({ ...f, calibration_required: e.target.checked }))} />
            Calibration is required for this cycle (otherwise it's optional/skippable)
          </label>
        </form>
      </Modal>

      {showWeights && <ScoreWeightsModal profileId={profile.id} onClose={() => setShowWeights(false)} />}
    </div>
  )
}

function ScoreWeightsModal({ profileId, onClose }) {
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { getScoreWeights().then(setForm) }, [])

  const total = form ? Number(form.goal_achievement_weight_percent || 0) + Number(form.manager_rating_weight_percent || 0) + Number(form.utilization_weight_percent || 0) : 0

  async function save() {
    if (Math.round(total) !== 100) { setErr('Weights must sum to exactly 100%.'); return }
    setSaving(true); setErr('')
    try {
      await saveScoreWeights({
        goal_achievement_weight_percent: form.goal_achievement_weight_percent,
        manager_rating_weight_percent: form.manager_rating_weight_percent,
        utilization_weight_percent: form.utilization_weight_percent,
      }, profileId)
      onClose()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title="Composite Score Weights"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving || !form}>{saving ? 'Saving…' : 'Save'}</button>
      </>}>
      {!form ? <Loader /> : (
        <div>
          {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
            How much each signal counts toward an employee's composite performance score. This is a policy decision — tune it as HR/Leadership agrees, not a fixed default. Must sum to 100%.
          </div>
          <div className="form-group"><label className="form-label">Goal Achievement (%)</label><input className="form-input" type="number" step="0.1" value={form.goal_achievement_weight_percent} onChange={e => setForm(f => ({ ...f, goal_achievement_weight_percent: e.target.value }))} /></div>
          <div className="form-group"><label className="form-label">Manager Rating (%)</label><input className="form-input" type="number" step="0.1" value={form.manager_rating_weight_percent} onChange={e => setForm(f => ({ ...f, manager_rating_weight_percent: e.target.value }))} /></div>
          <div className="form-group"><label className="form-label">Utilization % (objective/system-tracked signal)</label><input className="form-input" type="number" step="0.1" value={form.utilization_weight_percent} onChange={e => setForm(f => ({ ...f, utilization_weight_percent: e.target.value }))} /></div>
          <div style={{ fontSize: 13, fontWeight: 700, color: Math.round(total) === 100 ? '#15803d' : '#dc2626' }}>Total: {total}%</div>
        </div>
      )}
    </Modal>
  )
}
