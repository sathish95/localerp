import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, dateFmt } from '../lib/supabase'
import {
  listCycles, listGoals, updateGoal, getManagerReview, upsertManagerReview, getContextPanel,
  listDevelopmentPlans, addDevelopmentPlan, updateDevelopmentPlan, getFinalRating, setFinalRating,
  createFeedbackRequest, recomputeScore, RATING_BANDS, DEV_PLAN_STATUSES,
} from '../lib/performance'
import { Loader, Empty, Tabs, Modal } from '../components/ui'
import { UserCheck, Monitor, CalendarOff, GraduationCap, Briefcase, Send, Plus, ShieldCheck, CheckCircle } from 'lucide-react'

const RATING_COLOR = {
  'Unsatisfactory': '#dc2626', 'Needs Improvement': '#f59e0b', 'Meets Expectations': '#0ea5e9', 'Exceeds Expectations': '#15803d',
}
const RatingPill = ({ rating }) => rating
  ? <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: `${RATING_COLOR[rating]}18`, color: RATING_COLOR[rating] }}>{rating}</span>
  : <span style={{ fontSize: 11, color: '#94a3b8' }}>Not rated</span>

export default function TeamReviewsPage() {
  const { profile } = useAuth()
  const isHRAdmin = ['admin', 'ceo', 'hr'].includes(profile?.role)
  const [cycles, setCycles] = useState([])
  const [cycleId, setCycleId] = useState('')
  const [employees, setEmployees] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const cs = await listCycles()
      setCycles(cs)
      const active = cs.find(c => c.status !== 'Planning' && c.status !== 'Closed') || cs[0]
      setCycleId(active?.id || '')
      const { data } = isHRAdmin
        ? await supabase.from('profiles').select('id,full_name,designation,dept:departments(name)').order('full_name')
        : await supabase.from('profiles').select('id,full_name,designation,dept:departments(name)').eq('reporting_manager_id', profile.id).order('full_name')
      setEmployees(data || [])
      setLoading(false)
    })()
  }, [profile.id, isHRAdmin])

  const cycle = cycles.find(c => c.id === cycleId)

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#0ea5e9,#0369a1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <UserCheck size={19} />
            </span>
            Team Reviews
          </div>
          <div className="page-subtitle">{isHRAdmin ? 'All employees' : 'Your direct reports'} — manager review with live work-data context</div>
        </div>
        <div className="page-actions">
          <select className="form-select" value={cycleId} onChange={e => { setCycleId(e.target.value); setSelected(null) }} style={{ minWidth: 200 }}>
            <option value="">Select a cycle…</option>
            {cycles.map(c => <option key={c.id} value={c.id}>{c.cycle_name} ({c.status})</option>)}
          </select>
        </div>
      </div>

      {!cycle ? (
        <Empty icon={<UserCheck size={40} />} title="Select a cycle" desc="Pick a review cycle to see your team" />
      ) : employees.length === 0 ? (
        <Empty icon={<UserCheck size={40} />} title="No direct reports found" desc="No employees report to you yet." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20, alignItems: 'start' }}>
          <div className="card" style={{ overflow: 'hidden' }}>
            {employees.map(e => (
              <button key={e.id} onClick={() => setSelected(e)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '11px 14px', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selected?.id === e.id ? 'linear-gradient(135deg,#0ea5e9,#0369a1)' : 'transparent', color: selected?.id === e.id ? '#fff' : 'inherit' }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{e.full_name}</div>
                <div style={{ fontSize: 11, opacity: .85 }}>{e.designation || '—'} · {e.dept?.name || '—'}</div>
              </button>
            ))}
          </div>
          <div className="card" style={{ padding: 20, minHeight: 400 }}>
            {!selected ? (
              <Empty icon={<UserCheck size={40} />} title="Select an employee" desc="Pick someone from the list to review" />
            ) : (
              <EmployeeReviewPanel key={selected.id + cycle.id} employee={selected} cycle={cycle} reviewerId={profile.id} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function EmployeeReviewPanel({ employee, cycle, reviewerId }) {
  const [tab, setTab] = useState('context')
  const [goals, setGoals] = useState([])
  const [review, setReview] = useState(null)
  const [context, setContext] = useState(null)
  const [plans, setPlans] = useState([])
  const [finalRating, setFinalRatingState] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [g, r, ctx, p, fr] = await Promise.all([
      listGoals(employee.id, cycle.id), getManagerReview(employee.id, cycle.id), getContextPanel(employee.id, cycle),
      listDevelopmentPlans(employee.id, cycle.id), getFinalRating(employee.id, cycle.id),
    ])
    setGoals(g); setReview(r); setContext(ctx); setPlans(p); setFinalRatingState(fr)
    setLoading(false)
  }, [employee.id, cycle.id])
  useEffect(() => { load() }, [load])

  async function rateGoal(g, band) { await updateGoal(g.id, { manager_rating: band || null }); await load() }

  if (loading) return <Loader />

  return (
    <div>
      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>{employee.full_name}</div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16 }}>{employee.designation || '—'} · {employee.dept?.name || '—'}</div>

      <Tabs tabs={[
        { id: 'context', label: 'Work Context' }, { id: 'goals', label: 'Goals', count: goals.length },
        { id: 'review', label: 'Manager Review' }, { id: 'plan', label: 'Development Plan', count: plans.length },
        { id: 'feedback', label: 'Request 360' },
      ]} active={tab} onChange={setTab} />

      {tab === 'context' && <ContextPanelView context={context} />}

      {tab === 'goals' && (
        goals.length === 0 ? <Empty icon={<ShieldCheck size={40} />} title="No goals set" desc="This employee hasn't set goals for this cycle yet." /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Goal</th><th>Weight</th><th>Status</th><th>Self Rating</th><th>Manager Rating</th></tr></thead>
              <tbody>
                {goals.map(g => (
                  <tr key={g.id}>
                    <td className="td-bold" style={{ fontSize: 12 }}>{g.goal_title}</td>
                    <td style={{ fontSize: 12 }}>{g.weight_percent}%</td>
                    <td style={{ fontSize: 12 }}>{g.status}</td>
                    <td><RatingPill rating={g.self_rating} /></td>
                    <td>
                      <select className="form-select" style={{ fontSize: 11, padding: '3px 6px' }} value={g.manager_rating || ''} onChange={e => rateGoal(g, e.target.value)}>
                        <option value="">Not rated</option>
                        {RATING_BANDS.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'review' && (
        <ManagerReviewForm employee={employee} cycle={cycle} reviewerId={reviewerId} review={review} finalRating={finalRating} onChanged={load} />
      )}

      {tab === 'plan' && <DevelopmentPlanTab employee={employee} cycle={cycle} plans={plans} onChanged={load} />}

      {tab === 'feedback' && <RequestFeedbackTab employee={employee} cycle={cycle} reviewerId={reviewerId} />}
    </div>
  )
}

function ContextPanelView({ context }) {
  if (!context) return null
  return (
    <div>
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div style={{ padding: 14, borderRadius: 10, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#0ea5e9', textTransform: 'uppercase' }}><Monitor size={12} style={{ verticalAlign: -2 }} /> Avg Utilization</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{context.avgUtilization}%</div>
        </div>
        <div style={{ padding: 14, borderRadius: 10, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase' }}><CalendarOff size={12} style={{ verticalAlign: -2 }} /> Leave Days</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{context.totalLeaveDays}</div>
        </div>
        <div style={{ padding: 14, borderRadius: 10, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#8b5cf6', textTransform: 'uppercase' }}><GraduationCap size={12} style={{ verticalAlign: -2 }} /> Skills Updated</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{context.skillsUpdated.length}</div>
        </div>
        <div style={{ padding: 14, borderRadius: 10, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#14b8a6', textTransform: 'uppercase' }}><Briefcase size={12} style={{ verticalAlign: -2 }} /> Projects</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{context.projects.length}</div>
        </div>
      </div>

      {context.skillsUpdated.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Skill Growth This Cycle</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {context.skillsUpdated.map(s => <span key={s.id} className="badge">{s.skill?.skill_name} · {s.proficiency_level}</span>)}
          </div>
        </div>
      )}

      {context.projects.length > 0 && (
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Project Contributions</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Project</th><th>Role</th><th>Allocation %</th><th>Status</th></tr></thead>
              <tbody>
                {context.projects.map(a => (
                  <tr key={a.id}>
                    <td className="td-bold" style={{ fontSize: 12 }}>{a.project?.name || '—'}</td>
                    <td style={{ fontSize: 12 }}>{a.role_on_project || '—'}</td>
                    <td style={{ fontSize: 12 }}>{a.allocation_percent}%</td>
                    <td style={{ fontSize: 12 }}>{a.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function ManagerReviewForm({ employee, cycle, reviewerId, review, finalRating, onChanged }) {
  const [form, setForm] = useState({ strengths: review?.strengths || '', improvement_areas: review?.improvement_areas || '', overall_rating: review?.overall_rating || '', promotion_recommendation: review?.promotion_recommendation || false })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save(submit) {
    if (submit && !form.overall_rating) { setErr('Pick an overall rating before submitting.'); return }
    setSaving(true); setErr('')
    try {
      await upsertManagerReview(employee.id, cycle.id, reviewerId, form, submit)
      await recomputeScore(employee.id, cycle.id)
      onChanged()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  // Only lockable once the review has actually been submitted AND the
  // on-screen rating matches what was submitted — otherwise an unsaved
  // edit to Overall Rating could get locked in as the Final Rating without
  // ever having been saved to the Manager Review itself.
  const canLockFinalRating = !!review?.submitted_at && form.overall_rating === review.overall_rating

  async function lockFinalRating() {
    setSaving(true); setErr('')
    try {
      await setFinalRating(employee.id, cycle.id, form.overall_rating, 'Manager Direct', reviewerId)
      onChanged()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div>
      {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
      {review?.submitted_at && (
        <div style={{ padding: '8px 14px', borderRadius: 8, background: '#dcfce7', color: '#15803d', fontSize: 12, fontWeight: 600, marginBottom: 14 }}>
          Submitted on {dateFmt(review.submitted_at)} — you can still update it below.
        </div>
      )}
      {finalRating && (
        <div style={{ padding: '8px 14px', borderRadius: 8, background: '#eef2ff', color: '#4338ca', fontSize: 12, fontWeight: 600, marginBottom: 14 }}>
          Final rating locked in: {finalRating.final_rating} ({finalRating.rating_source})
        </div>
      )}
      <div className="form-group"><label className="form-label">Strengths</label><textarea className="form-textarea" rows={3} value={form.strengths} onChange={e => setForm(f => ({ ...f, strengths: e.target.value }))} /></div>
      <div className="form-group"><label className="form-label">Improvement Areas</label><textarea className="form-textarea" rows={3} value={form.improvement_areas} onChange={e => setForm(f => ({ ...f, improvement_areas: e.target.value }))} /></div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Overall Rating</label>
          <select className="form-select" value={form.overall_rating} onChange={e => setForm(f => ({ ...f, overall_rating: e.target.value }))}>
            <option value="">Select…</option>{RATING_BANDS.map(b => <option key={b} value={b}>{b}</option>)}
          </select></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 26 }}>
          <input type="checkbox" checked={form.promotion_recommendation} onChange={e => setForm(f => ({ ...f, promotion_recommendation: e.target.checked }))} />
          Recommend for promotion
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-outline" onClick={() => save(false)} disabled={saving}>Save Draft</button>
        <button className="btn btn-primary" onClick={() => save(true)} disabled={saving}>{saving ? 'Saving…' : 'Submit Review'}</button>
        {!cycle.calibration_required && !finalRating && canLockFinalRating && (
          <button className="btn btn-success" onClick={lockFinalRating} disabled={saving}><CheckCircle size={13} /> Lock Final Rating (no calibration needed)</button>
        )}
      </div>
      {!cycle.calibration_required && !finalRating && form.overall_rating && !canLockFinalRating && (
        <div style={{ fontSize: 11, color: '#b45309', marginTop: 10 }}>Submit the review with this rating before you can lock it in as the Final Rating.</div>
      )}
      {cycle.calibration_required && !finalRating && (
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 10 }}>This cycle requires calibration — the final rating gets locked in from the Calibration screen, not here.</div>
      )}
    </div>
  )
}

function DevelopmentPlanTab({ employee, cycle, plans, onChanged }) {
  const [showModal, setShowModal] = useState(false)
  const [skills, setSkills] = useState([])
  const [form, setForm] = useState({ improvement_area: '', recommended_action: '', target_date: '', linked_skill_id: '' })
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { supabase.from('skills').select('id,skill_name').order('skill_name').then(({ data }) => setSkills(data || [])) }, [])

  async function save() {
    if (!form.improvement_area.trim()) { setErr('Improvement area is required.'); return }
    setSaving(true); setErr('')
    try {
      await addDevelopmentPlan({
        employee_id: employee.id, cycle_id: cycle.id, improvement_area: form.improvement_area,
        recommended_action: form.recommended_action || null, target_date: form.target_date || null, linked_skill_id: form.linked_skill_id || null,
      })
      setShowModal(false); setForm({ improvement_area: '', recommended_action: '', target_date: '', linked_skill_id: '' }); onChanged()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  async function setStatus(p, status) { await updateDevelopmentPlan(p.id, { status }); onChanged() }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}><Plus size={13} /> Add Development Item</button>
      </div>
      {plans.length === 0 ? <Empty icon={<GraduationCap size={40} />} title="No development plan yet" desc="Add improvement areas coming out of this review." /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Improvement Area</th><th>Recommended Action</th><th>Target Date</th><th>Linked Skill</th><th>Status</th></tr></thead>
            <tbody>
              {plans.map(p => (
                <tr key={p.id}>
                  <td className="td-bold" style={{ fontSize: 12 }}>{p.improvement_area}</td>
                  <td style={{ fontSize: 12 }}>{p.recommended_action || '—'}</td>
                  <td style={{ fontSize: 12 }}>{p.target_date ? dateFmt(p.target_date) : '—'}</td>
                  <td style={{ fontSize: 12 }}>{p.skill?.skill_name || '—'}</td>
                  <td>
                    <select className="form-select" style={{ fontSize: 11, padding: '3px 6px' }} value={p.status} onChange={e => setStatus(p, e.target.value)}>
                      {DEV_PLAN_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add Development Item"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </>}>
        {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="form-group"><label className="form-label">Improvement Area *</label><input className="form-input" value={form.improvement_area} onChange={e => setForm(f => ({ ...f, improvement_area: e.target.value }))} /></div>
        <div className="form-group"><label className="form-label">Recommended Action</label><textarea className="form-textarea" rows={2} value={form.recommended_action} onChange={e => setForm(f => ({ ...f, recommended_action: e.target.value }))} /></div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Target Date</label><input className="form-input" type="date" value={form.target_date} onChange={e => setForm(f => ({ ...f, target_date: e.target.value }))} /></div>
          <div className="form-group"><label className="form-label">Linked Skill</label>
            <select className="form-select" value={form.linked_skill_id} onChange={e => setForm(f => ({ ...f, linked_skill_id: e.target.value }))}>
              <option value="">— None —</option>{skills.map(s => <option key={s.id} value={s.id}>{s.skill_name}</option>)}
            </select></div>
        </div>
      </Modal>
    </div>
  )
}

function RequestFeedbackTab({ employee, cycle, reviewerId }) {
  const [colleagues, setColleagues] = useState([])
  const [form, setForm] = useState({ feedback_provider_id: '', is_anonymous: true })
  const [sent, setSent] = useState([])
  const [err, setErr] = useState('')

  useEffect(() => { supabase.from('profiles').select('id,full_name').neq('id', employee.id).order('full_name').then(({ data }) => setColleagues(data || [])) }, [employee.id])

  async function send(e) {
    e.preventDefault()
    if (!form.feedback_provider_id) { setErr('Pick a colleague.'); return }
    setErr('')
    try {
      await createFeedbackRequest({ cycleId: cycle.id, subjectEmployeeId: employee.id, feedbackProviderId: form.feedback_provider_id, requestedBy: reviewerId, isAnonymous: form.is_anonymous })
      setSent(s => [...s, colleagues.find(c => c.id === form.feedback_provider_id)?.full_name])
      setForm({ feedback_provider_id: '', is_anonymous: true })
    } catch (e) { setErr(e.message) }
  }

  return (
    <form onSubmit={send} style={{ padding: 14, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', maxWidth: 420 }}>
      {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="form-group"><label className="form-label">Ask a colleague about {employee.full_name}</label>
        <select className="form-select" value={form.feedback_provider_id} onChange={e => setForm(f => ({ ...f, feedback_provider_id: e.target.value }))}>
          <option value="">Select…</option>{colleagues.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
        </select></div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12 }}>
        <input type="checkbox" checked={form.is_anonymous} onChange={e => setForm(f => ({ ...f, is_anonymous: e.target.checked }))} />
        Keep provider anonymous to {employee.full_name} (visible to HR only)
      </label>
      <button className="btn btn-primary btn-sm"><Send size={13} /> Send Request</button>
      {sent.length > 0 && <div style={{ fontSize: 11, color: '#15803d', marginTop: 10 }}>Sent to: {sent.join(', ')}</div>}
    </form>
  )
}
