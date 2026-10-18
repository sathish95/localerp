import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, dateFmt } from '../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import {
  listCycles, listGoals, addGoal, updateGoal, deleteGoal, totalGoalWeight,
  getSelfAppraisal, upsertSelfAppraisal,
  listFeedbackRequestsForProvider, submitPeerFeedback, createFeedbackRequest, getPeerFeedbackForSubject, declineFeedbackRequest,
  listDevelopmentPlans, getFinalRating, getPerformanceScore,
  RATING_BANDS, GOAL_STATUSES,
} from '../lib/performance'
import { Loader, Empty, Tabs, Modal } from '../components/ui'
import { Award, Plus, Trash2, Edit2, Save, X, MessageSquare, Send, History, Target } from 'lucide-react'

const RATING_COLOR = {
  'Unsatisfactory': '#dc2626', 'Needs Improvement': '#f59e0b', 'Meets Expectations': '#0ea5e9', 'Exceeds Expectations': '#15803d',
}
const RatingPill = ({ rating }) => rating
  ? <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: `${RATING_COLOR[rating]}18`, color: RATING_COLOR[rating] }}>{rating}</span>
  : <span style={{ fontSize: 11, color: '#94a3b8' }}>Not rated</span>

export default function MyPerformancePage() {
  const { profile } = useAuth()
  const [cycles, setCycles] = useState([])
  const [cycleId, setCycleId] = useState('')
  const [tab, setTab] = useState('goals')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listCycles().then(cs => {
      setCycles(cs)
      const active = cs.find(c => c.status !== 'Planning' && c.status !== 'Closed') || cs[0]
      setCycleId(active?.id || '')
      setLoading(false)
    })
  }, [])

  const cycle = cycles.find(c => c.id === cycleId)

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#f59e0b,#b45309)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <Award size={19} />
            </span>
            My Performance
          </div>
          <div className="page-subtitle">Goals, self-assessment, 360 feedback and your rating history</div>
        </div>
        <div className="page-actions">
          <select className="form-select" value={cycleId} onChange={e => setCycleId(e.target.value)} style={{ minWidth: 200 }}>
            <option value="">Select a cycle…</option>
            {cycles.map(c => <option key={c.id} value={c.id}>{c.cycle_name} ({c.status})</option>)}
          </select>
        </div>
      </div>

      <Tabs tabs={[
        { id: 'goals', label: 'Goals' }, { id: 'self', label: 'Self-Appraisal' },
        { id: 'feedback', label: '360 Feedback' }, { id: 'history', label: 'My History' },
      ]} active={tab} onChange={setTab} />

      {tab === 'history' ? (
        <HistoryTab employeeId={profile.id} cycles={cycles} />
      ) : !cycle ? (
        <Empty icon={<Target size={40} />} title="Select a cycle" desc="Pick a review cycle above to see your goals, self-appraisal and feedback" />
      ) : (
        <>
          {tab === 'goals' && (
            <GoalsTab employeeId={profile.id} cycle={cycle}
              priorCycle={[...cycles].sort((a, b) => new Date(a.start_date) - new Date(b.start_date)).filter(c => new Date(c.start_date) < new Date(cycle.start_date)).pop()} />
          )}
          {tab === 'self' && <SelfAppraisalTab employeeId={profile.id} cycle={cycle} />}
          {tab === 'feedback' && <FeedbackTab profile={profile} cycle={cycle} />}
        </>
      )}
    </div>
  )
}

/* ── Goals ── */
function GoalsTab({ employeeId, cycle, priorCycle }) {
  const [goals, setGoals] = useState([])
  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState([])
  const [priorPlans, setPriorPlans] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ goal_title: '', description: '', weight_percent: '', linked_project_id: '', target_metric: '' })
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => { setLoading(true); setGoals(await listGoals(employeeId, cycle.id)); setLoading(false) }, [employeeId, cycle.id])
  useEffect(() => { load() }, [load])
  useEffect(() => { supabase.from('projects').select('id,name').order('name').then(({ data }) => setProjects(data || [])) }, [])
  useEffect(() => {
    if (!priorCycle) { setPriorPlans([]); return }
    listDevelopmentPlans(employeeId, priorCycle.id).then(plans => setPriorPlans(plans.filter(p => p.status !== 'Achieved')))
  }, [employeeId, priorCycle])

  function openNew() { setEditing(null); setForm({ goal_title: '', description: '', weight_percent: '', linked_project_id: '', target_metric: '' }); setErr(''); setShowModal(true) }
  function openEdit(g) { setEditing(g); setForm({ goal_title: g.goal_title, description: g.description || '', weight_percent: g.weight_percent, linked_project_id: g.linked_project_id || '', target_metric: g.target_metric || '' }); setErr(''); setShowModal(true) }

  async function save() {
    if (!form.goal_title.trim()) { setErr('Goal title is required.'); return }
    const newTotal = totalGoalWeight(goals, editing?.id) + (Number(form.weight_percent) || 0)
    if (newTotal > 100.01) { setErr(`Goal weights would total ${Math.round(newTotal)}% — they must sum to 100% or less across this cycle's goals.`); return }
    setSaving(true); setErr('')
    try {
      const payload = { goal_title: form.goal_title, description: form.description || null, weight_percent: form.weight_percent || 0, linked_project_id: form.linked_project_id || null, target_metric: form.target_metric || null }
      if (editing) await updateGoal(editing.id, payload)
      else await addGoal({ employee_id: employeeId, cycle_id: cycle.id, ...payload })
      setShowModal(false); await load()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  async function rateGoal(g, band) { await updateGoal(g.id, { self_rating: band || null }); await load() }
  async function setStatus(g, status) { await updateGoal(g.id, { status }); await load() }

  const total = totalGoalWeight(goals)

  if (loading) return <Loader />

  return (
    <div>
      {priorPlans.length > 0 && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#eef2ff', border: '1px solid #c7d2fe', marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#4338ca', marginBottom: 6 }}>From {priorCycle.cycle_name}'s Development Plan — consider a goal that addresses these</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {priorPlans.map(p => <span key={p.id} style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: '#e0e7ff', color: '#4338ca' }}>{p.improvement_area} ({p.status})</span>)}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: Math.round(total) === 100 ? '#15803d' : '#b45309' }}>
          Total weight: {total}% {Math.round(total) !== 100 && '(should sum to 100%)'}
        </div>
        <button className="btn btn-primary btn-sm" onClick={openNew}><Plus size={13} /> Add Goal</button>
      </div>

      {goals.length === 0 ? (
        <Empty icon={<Target size={40} />} title="No goals set yet" desc="Add your goals for this cycle — they should sum to 100% weight." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Goal</th><th>Weight</th><th>Linked Project</th><th>Status</th><th>Self Rating</th><th>Manager Rating</th><th></th></tr></thead>
            <tbody>
              {goals.map(g => (
                <tr key={g.id}>
                  <td>
                    <div className="td-bold" style={{ fontSize: 13 }}>{g.goal_title}</div>
                    {g.target_metric && <div style={{ fontSize: 11, color: '#94a3b8' }}>{g.target_metric}</div>}
                  </td>
                  <td style={{ fontSize: 12 }}>{g.weight_percent}%</td>
                  <td style={{ fontSize: 12 }}>{g.project?.name || '—'}</td>
                  <td>
                    <select className="form-select" style={{ fontSize: 11, padding: '3px 6px' }} value={g.status} onChange={e => setStatus(g, e.target.value)}>
                      {GOAL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="form-select" style={{ fontSize: 11, padding: '3px 6px' }} value={g.self_rating || ''} onChange={e => rateGoal(g, e.target.value)}>
                      <option value="">Not rated</option>
                      {RATING_BANDS.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </td>
                  <td><RatingPill rating={g.manager_rating} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openEdit(g)}><Edit2 size={12} /></button>
                      <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={async () => { await deleteGoal(g.id); await load() }}><Trash2 size={12} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Goal' : 'Add Goal'}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </>}>
        {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="form-group"><label className="form-label">Goal Title *</label><input className="form-input" value={form.goal_title} onChange={e => setForm(f => ({ ...f, goal_title: e.target.value }))} /></div>
        <div className="form-group"><label className="form-label">Description</label><textarea className="form-textarea" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Weight (%)</label><input className="form-input" type="number" value={form.weight_percent} onChange={e => setForm(f => ({ ...f, weight_percent: e.target.value }))} /></div>
          <div className="form-group"><label className="form-label">Linked Project</label>
            <select className="form-select" value={form.linked_project_id} onChange={e => setForm(f => ({ ...f, linked_project_id: e.target.value }))}>
              <option value="">— None —</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
        </div>
        <div className="form-group"><label className="form-label">Target Metric</label><input className="form-input" value={form.target_metric} onChange={e => setForm(f => ({ ...f, target_metric: e.target.value }))} placeholder="e.g. Reduce firmware defect rate by 20%" /></div>
      </Modal>
    </div>
  )
}

/* ── Self-Appraisal ── */
function SelfAppraisalTab({ employeeId, cycle }) {
  const [form, setForm] = useState({ key_achievements: '', challenges_faced: '', skills_developed: '', self_overall_rating: '' })
  const [submittedAt, setSubmittedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    getSelfAppraisal(employeeId, cycle.id).then(a => {
      if (a) setForm({ key_achievements: a.key_achievements || '', challenges_faced: a.challenges_faced || '', skills_developed: a.skills_developed || '', self_overall_rating: a.self_overall_rating || '' })
      setSubmittedAt(a?.submitted_at || null)
      setLoading(false)
    })
  }, [employeeId, cycle.id])

  async function save(submit) {
    setSaving(true); setErr('')
    try {
      await upsertSelfAppraisal(employeeId, cycle.id, form, submit)
      if (submit) setSubmittedAt(new Date().toISOString())
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  if (loading) return <Loader />

  return (
    <div>
      {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
      {submittedAt && (
        <div style={{ padding: '8px 14px', borderRadius: 8, background: '#dcfce7', color: '#15803d', fontSize: 12, fontWeight: 600, marginBottom: 14 }}>
          Submitted on {dateFmt(submittedAt)} — you can still update it below.
        </div>
      )}
      <div className="form-group"><label className="form-label">Key Achievements</label><textarea className="form-textarea" rows={3} value={form.key_achievements} onChange={e => setForm(f => ({ ...f, key_achievements: e.target.value }))} /></div>
      <div className="form-group"><label className="form-label">Challenges Faced</label><textarea className="form-textarea" rows={3} value={form.challenges_faced} onChange={e => setForm(f => ({ ...f, challenges_faced: e.target.value }))} /></div>
      <div className="form-group"><label className="form-label">Skills Developed This Cycle</label><textarea className="form-textarea" rows={2} value={form.skills_developed} onChange={e => setForm(f => ({ ...f, skills_developed: e.target.value }))} placeholder="Reference your updated Skill Matrix entries" /></div>
      <div className="form-group"><label className="form-label">Self Overall Rating</label>
        <select className="form-select" value={form.self_overall_rating} onChange={e => setForm(f => ({ ...f, self_overall_rating: e.target.value }))}>
          <option value="">Select…</option>{RATING_BANDS.map(b => <option key={b} value={b}>{b}</option>)}
        </select></div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-outline" onClick={() => save(false)} disabled={saving}>Save Draft</button>
        <button className="btn btn-primary" onClick={() => save(true)} disabled={saving}>{saving ? 'Submitting…' : 'Submit'}</button>
      </div>
    </div>
  )
}

/* ── 360 Feedback ── */
function FeedbackTab({ profile, cycle }) {
  const [sub, setSub] = useState('owe')
  const [owed, setOwed] = useState([])
  const [about, setAbout] = useState([])
  const [colleagues, setColleagues] = useState([])
  const [loading, setLoading] = useState(true)
  const [requestForm, setRequestForm] = useState({ feedback_provider_id: '', is_anonymous: true })
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const [o, a] = await Promise.all([listFeedbackRequestsForProvider(profile.id), getPeerFeedbackForSubject(profile.id, cycle.id)])
      setOwed(o.filter(r => r.cycle_id === cycle.id)); setAbout(a)
    } catch (e) { setErr(e.message) } // an RPC failure must never leave the tab stuck on the loading spinner forever
    finally { setLoading(false) }
  }, [profile.id, cycle.id])
  useEffect(() => { load() }, [load])
  useEffect(() => { supabase.from('profiles').select('id,full_name').neq('id', profile.id).order('full_name').then(({ data }) => setColleagues(data || [])) }, [profile.id])

  async function requestFeedback(e) {
    e.preventDefault()
    if (!requestForm.feedback_provider_id) { setErr('Pick a colleague to ask for feedback.'); return }
    setErr('')
    try {
      await createFeedbackRequest({ cycleId: cycle.id, subjectEmployeeId: profile.id, feedbackProviderId: requestForm.feedback_provider_id, requestedBy: profile.id, isAnonymous: requestForm.is_anonymous })
      setRequestForm({ feedback_provider_id: '', is_anonymous: true })
      await load()
    } catch (e) { setErr(e.message) }
  }

  if (loading) return <Loader />

  return (
    <div>
      <Tabs tabs={[
        { id: 'owe', label: 'Feedback I Owe', count: owed.filter(r => r.status === 'Requested').length },
        { id: 'about', label: 'Feedback About Me', count: about.length },
        { id: 'request', label: 'Request Feedback' },
      ]} active={sub} onChange={setSub} />

      {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}

      {sub === 'owe' && (
        owed.length === 0 ? <Empty icon={<MessageSquare size={40} />} title="Nothing requested of you" desc="No one has asked you for feedback this cycle." /> :
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {owed.map(r => <FeedbackOweCard key={r.id} request={r} onDone={load} />)}
        </div>
      )}

      {sub === 'about' && (
        about.length === 0 ? <Empty icon={<MessageSquare size={40} />} title="No feedback yet" desc="Feedback submitted about you this cycle will show here." /> :
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {about.map(f => (
            <div key={f.id} style={{ padding: 14, borderRadius: 10, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>{f.is_anonymous ? (f.provider_name || 'Anonymous colleague') : (f.provider_name || 'Colleague')}</span>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>{dateFmt(f.submitted_at)}</span>
              </div>
              {f.strengths_noted && <div style={{ fontSize: 12, marginBottom: 4 }}><strong>Strengths:</strong> {f.strengths_noted}</div>}
              {f.improvement_areas_noted && <div style={{ fontSize: 12 }}><strong>Could improve:</strong> {f.improvement_areas_noted}</div>}
              {f.rating && <div style={{ marginTop: 6 }}><RatingPill rating={f.rating} /></div>}
            </div>
          ))}
        </div>
      )}

      {sub === 'request' && (
        <form onSubmit={requestFeedback} style={{ padding: 14, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', maxWidth: 420 }}>
          <div className="form-group"><label className="form-label">Ask a colleague</label>
            <select className="form-select" value={requestForm.feedback_provider_id} onChange={e => setRequestForm(f => ({ ...f, feedback_provider_id: e.target.value }))}>
              <option value="">Select…</option>{colleagues.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12 }}>
            <input type="checkbox" checked={requestForm.is_anonymous} onChange={e => setRequestForm(f => ({ ...f, is_anonymous: e.target.checked }))} />
            Keep their identity anonymous to me (visible to HR only)
          </label>
          <button className="btn btn-primary btn-sm"><Send size={13} /> Send Request</button>
        </form>
      )}
    </div>
  )
}

function FeedbackOweCard({ request, onDone }) {
  const [form, setForm] = useState({ strengths_noted: '', improvement_areas_noted: '', rating: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    if (!form.strengths_noted?.trim() && !form.improvement_areas_noted?.trim()) { setErr('Add at least strengths or an improvement area.'); return }
    setBusy(true); setErr('')
    try { await submitPeerFeedback(request.id, { ...form, rating: form.rating || null }); onDone() }
    catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }
  async function decline() {
    setBusy(true)
    try { await declineFeedbackRequest(request.id); onDone() }
    finally { setBusy(false) }
  }

  if (request.status !== 'Requested') {
    return (
      <div style={{ padding: 14, borderRadius: 10, border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13 }}>Feedback for {request.subject?.full_name}</span>
        <span style={{ fontSize: 12, color: request.status === 'Submitted' ? '#15803d' : '#94a3b8' }}>{request.status}</span>
      </div>
    )
  }

  return (
    <div style={{ padding: 14, borderRadius: 10, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Feedback for {request.subject?.full_name} {request.is_anonymous && <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>(your identity stays anonymous)</span>}</div>
      {err && <div className="alert alert-danger" style={{ marginBottom: 8 }}>{err}</div>}
      <div className="form-group"><label className="form-label">Strengths</label><textarea className="form-textarea" rows={2} value={form.strengths_noted} onChange={e => setForm(f => ({ ...f, strengths_noted: e.target.value }))} /></div>
      <div className="form-group"><label className="form-label">Areas to Improve</label><textarea className="form-textarea" rows={2} value={form.improvement_areas_noted} onChange={e => setForm(f => ({ ...f, improvement_areas_noted: e.target.value }))} /></div>
      <div className="form-group"><label className="form-label">Rating (optional)</label>
        <select className="form-select" value={form.rating} onChange={e => setForm(f => ({ ...f, rating: e.target.value }))}>
          <option value="">Prefer not to rate numerically</option>{RATING_BANDS.map(b => <option key={b} value={b}>{b}</option>)}
        </select></div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Submit Feedback'}</button>
        <button className="btn btn-ghost btn-sm" onClick={decline} disabled={busy}>Decline</button>
      </div>
    </div>
  )
}

/* ── History ── */
function HistoryTab({ employeeId, cycles }) {
  const [rows, setRows] = useState([])
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      setLoading(true)
      const results = await Promise.all(cycles.map(async c => {
        const [rating, score] = await Promise.all([getFinalRating(employeeId, c.id), getPerformanceScore(employeeId, c.id)])
        return { cycle: c, rating, score }
      }))
      setPlans(await listDevelopmentPlans(employeeId))
      setRows(results.filter(r => r.rating || r.score).sort((a, b) => new Date(b.cycle.start_date) - new Date(a.cycle.start_date)))
      setLoading(false)
    })()
  }, [employeeId, cycles])

  if (loading) return <Loader />
  if (rows.length === 0) return <Empty icon={<History size={40} />} title="No history yet" desc="Once a cycle is rated, it will show up here." />

  const chartData = [...rows].reverse().map(r => ({ name: r.cycle.cycle_name, score: r.score?.composite_score || 0 }))

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Composite Score Trend</div>
      <div style={{ height: 200, marginBottom: 20 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} domain={[0, 100]} />
            <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12 }} />
            <Bar dataKey="score" name="Composite Score" fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="table-wrap" style={{ marginBottom: 20 }}>
        <table>
          <thead><tr><th>Cycle</th><th>Final Rating</th><th>Goal Achievement</th><th>Self vs Manager Gap</th><th>Utilization %</th><th>Composite</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.cycle.id}>
                <td className="td-bold">{r.cycle.cycle_name}</td>
                <td><RatingPill rating={r.rating?.final_rating} /></td>
                <td style={{ fontSize: 12 }}>{r.score?.goal_achievement_score ?? '—'}</td>
                <td style={{ fontSize: 12 }}>{r.score?.self_manager_rating_gap ?? '—'}</td>
                <td style={{ fontSize: 12 }}>{r.score?.utilization_percent ?? '—'}%</td>
                <td style={{ fontSize: 12, fontWeight: 700 }}>{r.score?.composite_score ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Development Plan</div>
      {plans.length === 0 ? <Empty icon={<Award size={40} />} title="No development items yet" desc="Your manager creates these after a review." /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Improvement Area</th><th>Recommended Action</th><th>Target Date</th><th>Status</th></tr></thead>
            <tbody>
              {plans.map(p => (
                <tr key={p.id}>
                  <td className="td-bold" style={{ fontSize: 12 }}>{p.improvement_area}{p.skill?.skill_name && <span style={{ fontWeight: 400, color: '#94a3b8' }}> ({p.skill.skill_name})</span>}</td>
                  <td style={{ fontSize: 12 }}>{p.recommended_action || '—'}</td>
                  <td style={{ fontSize: 12 }}>{p.target_date ? dateFmt(p.target_date) : '—'}</td>
                  <td><span className="badge">{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
