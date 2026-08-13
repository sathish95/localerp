import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import {
  getAward, createAward, updateAward, updateAwardStatus, publishAward,
  listCategories, createCategory,
  saveEligibilityRules, previewEligibleEmployees, getEmployeeFilterOptions,
  saveWorkflowSteps, saveQuestions,
  saveScoringConfig, totalScoringWeight,
  AWARD_STATUSES, FREQUENCY_SUGGESTIONS, WORKFLOW_STEP_DEFS, QUESTION_TYPES, ELIGIBILITY_RULE_TYPES,
  UNENFORCED_RULE_TYPES, DEFAULT_SCORING_WEIGHTS, DEFAULT_RATING_SCALE, DEFAULT_RECOMMENDATION_THRESHOLDS, DEFAULT_TIE_BREAK_ORDER,
} from '../lib/awards'
import { Loader, Stepper, StatusBadge } from '../components/ui'
import { Trophy, Plus, Trash2, ArrowUp, ArrowDown, Users, Info, CheckCircle2 } from 'lucide-react'

const STEPS = ['Basic Info', 'Eligibility', 'Workflow', 'Scoring', 'Review & Publish']
const QUESTION_STEP_KEYS = ['self_feedback', 'manager_feedback', 'peer_nomination']
const TIE_BREAK_LABEL = { manager_score: 'Manager Score', peer_score: 'Peer Score', performance_score: 'Performance Score' }

const emptyBasics = {
  name: '', code: '', category_id: '', description: '', objective: '', frequency: 'Annual',
  start_date: '', end_date: '', nomination_start_date: '', nomination_end_date: '',
  evaluation_start_date: '', evaluation_end_date: '', announcement_date: '', status: 'draft',
}

export default function AwardWizardPage() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [loading, setLoading] = useState(!isNew)
  const [activeStep, setActiveStep] = useState(0)
  const [awardId, setAwardId] = useState(isNew ? null : id)
  const [status, setStatus] = useState('draft')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const [basics, setBasics] = useState(emptyBasics)
  const [rules, setRules] = useState([])
  const [steps, setSteps] = useState(WORKFLOW_STEP_DEFS.map((d, i) => ({ step_key: d.key, is_enabled: d.key !== 'additional_evaluation', step_order: i, config: {} })))
  const [questionsByStep, setQuestionsByStep] = useState({ self_feedback: [], manager_feedback: [], peer_nomination: [] })
  const [scoring, setScoring] = useState({
    ...DEFAULT_SCORING_WEIGHTS, rating_scale: DEFAULT_RATING_SCALE,
    recommendation_thresholds: DEFAULT_RECOMMENDATION_THRESHOLDS, tie_break_order: DEFAULT_TIE_BREAK_ORDER,
  })

  useEffect(() => {
    if (isNew) return
    (async () => {
      const award = await getAward(id)
      setBasics({
        name: award.name, code: award.code, category_id: award.category_id || '', description: award.description || '',
        objective: award.objective || '', frequency: award.frequency || 'Annual', start_date: award.start_date || '',
        end_date: award.end_date || '', nomination_start_date: award.nomination_start_date || '', nomination_end_date: award.nomination_end_date || '',
        evaluation_start_date: award.evaluation_start_date || '', evaluation_end_date: award.evaluation_end_date || '',
        announcement_date: award.announcement_date || '', status: award.status,
      })
      setStatus(award.status)
      setRules(award.eligibilityRules.map(r => ({ rule_type: r.rule_type, rule_value: r.rule_value })))
      if (award.workflowSteps.length) setSteps(award.workflowSteps.map(s => ({ step_key: s.step_key, is_enabled: s.is_enabled, step_order: s.step_order, config: s.config || {} })))
      const qs = { self_feedback: [], manager_feedback: [], peer_nomination: [] }
      award.questions.forEach(q => { if (qs[q.step_key]) qs[q.step_key].push(q) })
      setQuestionsByStep(qs)
      setScoring({
        self_feedback_weight: award.scoringConfig.self_feedback_weight, manager_feedback_weight: award.scoringConfig.manager_feedback_weight,
        peer_feedback_weight: award.scoringConfig.peer_feedback_weight, performance_weight: award.scoringConfig.performance_weight,
        rating_scale: award.scoringConfig.rating_scale, recommendation_thresholds: award.scoringConfig.recommendation_thresholds,
        tie_break_order: award.scoringConfig.tie_break_order,
      })
      setLoading(false)
    })()
  }, [id])

  async function saveBasicsAndNext() {
    if (!basics.name.trim() || !basics.code.trim()) { setErr('Award name and code are required'); return }
    setSaving(true); setErr('')
    try {
      const patch = { ...basics, category_id: basics.category_id || null }
      if (!awardId) {
        const created = await createAward(patch, profile.id)
        setAwardId(created.id)
        navigate(`/awards/${created.id}/edit`, { replace: true })
      } else {
        await updateAward(awardId, patch)
      }
      setActiveStep(1)
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  async function saveEligibilityAndNext() {
    setSaving(true); setErr('')
    try { await saveEligibilityRules(awardId, rules); setActiveStep(2) }
    catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  async function saveWorkflowAndNext() {
    setSaving(true); setErr('')
    try {
      await saveWorkflowSteps(awardId, steps)
      await Promise.all(QUESTION_STEP_KEYS.map(key => saveQuestions(awardId, key, questionsByStep[key] || [])))
      setActiveStep(3)
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  async function saveScoringAndNext() {
    setSaving(true); setErr('')
    try { await saveScoringConfig(awardId, scoring); setActiveStep(4) }
    catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  async function finish(publish) {
    setSaving(true); setErr('')
    try {
      if (publish) await publishAward(awardId)
      else await updateAwardStatus(awardId, 'draft')
      navigate('/awards')
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#4338ca)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <Trophy size={19} />
            </span>
            {isNew && !awardId ? 'Create Award' : basics.name || 'Edit Award'}
          </div>
          <div className="page-subtitle">{awardId ? <StatusBadge status={status} /> : 'Step 1 creates the award — every later step edits it'}</div>
        </div>
      </div>

      <Stepper steps={STEPS} activeIndex={activeStep} onStepClick={awardId ? setActiveStep : undefined} />

      {err && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{err}</div>}

      {activeStep === 0 && <StepBasicInfo basics={basics} setBasics={setBasics} />}
      {activeStep === 1 && awardId && <StepEligibility rules={rules} setRules={setRules} />}
      {activeStep === 2 && awardId && <StepWorkflow steps={steps} setSteps={setSteps} questionsByStep={questionsByStep} setQuestionsByStep={setQuestionsByStep} />}
      {activeStep === 3 && awardId && <StepScoring scoring={scoring} setScoring={setScoring} />}
      {activeStep === 4 && awardId && <StepReview basics={basics} rules={rules} steps={steps} questionsByStep={questionsByStep} scoring={scoring} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
        <div>
          {activeStep > 0 && <button className="btn btn-outline" onClick={() => setActiveStep(s => s - 1)}>Back</button>}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {activeStep === 0 && <button className="btn btn-primary" onClick={saveBasicsAndNext} disabled={saving}>{saving ? 'Saving…' : 'Save & Continue'}</button>}
          {activeStep === 1 && <button className="btn btn-primary" onClick={saveEligibilityAndNext} disabled={saving}>{saving ? 'Saving…' : 'Save & Continue'}</button>}
          {activeStep === 2 && <button className="btn btn-primary" onClick={saveWorkflowAndNext} disabled={saving}>{saving ? 'Saving…' : 'Save & Continue'}</button>}
          {activeStep === 3 && <button className="btn btn-primary" onClick={saveScoringAndNext} disabled={saving}>{saving ? 'Saving…' : 'Save & Continue'}</button>}
          {activeStep === 4 && (
            <>
              <button className="btn btn-outline" onClick={() => finish(false)} disabled={saving}>Save as Draft</button>
              <button className="btn btn-primary" onClick={() => finish(true)} disabled={saving}><CheckCircle2 size={15} /> Publish Award</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ═══ Step 1 — Basic Info ═══ */
function StepBasicInfo({ basics, setBasics }) {
  const { profile } = useAuth()
  const [categories, setCategories] = useState([])
  const [newCatName, setNewCatName] = useState('')
  const set = (k, v) => setBasics(b => ({ ...b, [k]: v }))

  useEffect(() => { listCategories({ includeInactive: false }).then(setCategories) }, [])

  async function addCategory() {
    if (!newCatName.trim()) return
    const cat = await createCategory({ name: newCatName.trim() }, profile.id)
    setCategories(c => [...c, cat].sort((a, b) => a.name.localeCompare(b.name)))
    setBasics(b => ({ ...b, category_id: cat.id }))
    setNewCatName('')
  }

  return (
    <div className="card" style={{ padding: 24 }}>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Award Name *</label><input className="form-input" value={basics.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Outstanding Performer" /></div>
        <div className="form-group"><label className="form-label">Award Code *</label><input className="form-input" value={basics.code} onChange={e => set('code', e.target.value)} placeholder="e.g. OUT-PERF-2026" /></div>
      </div>
      <div className="form-row">
        <div className="form-group" style={{ flex: 2 }}>
          <label className="form-label">Award Category</label>
          <select className="form-select" value={basics.category_id} onChange={e => set('category_id', e.target.value)}>
            <option value="">— None —</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ flex: 2 }}>
          <label className="form-label">Quick-add category</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="form-input" value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="New category name" />
            <button type="button" className="btn btn-outline" onClick={addCategory}><Plus size={14} /></button>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Frequency</label>
          <select className="form-select" value={basics.frequency} onChange={e => set('frequency', e.target.value)}>
            {FREQUENCY_SUGGESTIONS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
      </div>
      <div className="form-group"><label className="form-label">Description</label><textarea className="form-input" rows={2} value={basics.description} onChange={e => set('description', e.target.value)} /></div>
      <div className="form-group"><label className="form-label">Objective</label><textarea className="form-input" rows={2} value={basics.objective} onChange={e => set('objective', e.target.value)} placeholder="What behavior/outcome is this award meant to reinforce?" /></div>

      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)', margin: '18px 0 8px', textTransform: 'uppercase', letterSpacing: 0.4 }}>Cycle Dates</div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Start Date</label><input className="form-input" type="date" value={basics.start_date} onChange={e => set('start_date', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">End Date</label><input className="form-input" type="date" value={basics.end_date} onChange={e => set('end_date', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Announcement Date</label><input className="form-input" type="date" value={basics.announcement_date} onChange={e => set('announcement_date', e.target.value)} /></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Nomination Start</label><input className="form-input" type="date" value={basics.nomination_start_date} onChange={e => set('nomination_start_date', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Nomination End</label><input className="form-input" type="date" value={basics.nomination_end_date} onChange={e => set('nomination_end_date', e.target.value)} /></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Evaluation Start</label><input className="form-input" type="date" value={basics.evaluation_start_date} onChange={e => set('evaluation_start_date', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Evaluation End</label><input className="form-input" type="date" value={basics.evaluation_end_date} onChange={e => set('evaluation_end_date', e.target.value)} /></div>
      </div>
      {basics.status && basics.status !== 'draft' && (
        <div className="form-group"><label className="form-label">Status</label>
          <select className="form-select" value={basics.status} onChange={e => set('status', e.target.value)}>
            {AWARD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}

/* ═══ Step 2 — Eligibility ═══ */
function StepEligibility({ rules, setRules }) {
  const [options, setOptions] = useState({ departments: [], designations: [], employmentTypes: [] })
  const [preview, setPreview] = useState(null)
  const [showList, setShowList] = useState(false)
  const [checking, setChecking] = useState(false)

  useEffect(() => { getEmployeeFilterOptions().then(setOptions) }, [])

  const usedTypes = new Set(rules.map(r => r.rule_type))
  const availableTypes = ELIGIBILITY_RULE_TYPES.filter(t => !usedTypes.has(t.key))

  function addRule(type) {
    setRules(r => [...r, { rule_type: type, rule_value: {} }])
    setPreview(null)
  }
  function updateRule(idx, rule_value) {
    setRules(r => r.map((x, i) => i === idx ? { ...x, rule_value } : x))
    setPreview(null)
  }
  function removeRule(idx) {
    setRules(r => r.filter((_, i) => i !== idx))
    setPreview(null)
  }

  async function runPreview() {
    setChecking(true)
    try { setPreview(await previewEligibleEmployees(rules)) }
    finally { setChecking(false) }
  }

  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 16 }}>
        Every rule added below must be satisfied (AND). Leave empty for "open to all employees".
      </div>

      {rules.map((rule, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ minWidth: 160, fontSize: 13, fontWeight: 600, paddingTop: 8 }}>
            {ELIGIBILITY_RULE_TYPES.find(t => t.key === rule.rule_type)?.label}
            {UNENFORCED_RULE_TYPES.includes(rule.rule_type) && (
              <div style={{ fontSize: 10, color: '#b45309', display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}><Info size={10} /> not enforced in preview</div>
            )}
          </div>
          <div style={{ flex: 1 }}><RuleValueEditor rule={rule} options={options} onChange={v => updateRule(idx, v)} /></div>
          <button className="btn btn-ghost btn-sm" onClick={() => removeRule(idx)}><Trash2 size={13} /></button>
        </div>
      ))}

      {availableTypes.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <select className="form-select" style={{ maxWidth: 260 }} value="" onChange={e => e.target.value && addRule(e.target.value)}>
            <option value="">+ Add eligibility rule…</option>
            {availableTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
      )}

      <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-outline" onClick={runPreview} disabled={checking}><Users size={14} /> {checking ? 'Checking…' : 'Check Eligible Employees'}</button>
        {preview && (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--c1)' }}>Eligible Employees: {preview.count}</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowList(s => !s)}>{showList ? 'Hide list' : 'View list'}</button>
          </>
        )}
      </div>
      {showList && preview && (
        <div className="table-wrap" style={{ marginTop: 12, maxHeight: 300, overflowY: 'auto' }}>
          <table>
            <thead><tr><th>Name</th><th>Designation</th><th>Department</th></tr></thead>
            <tbody>{preview.employees.map(e => <tr key={e.id}><td>{e.full_name}</td><td>{e.designation || '—'}</td><td>{e.dept?.name || '—'}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RuleValueEditor({ rule, options, onChange }) {
  const v = rule.rule_value || {}
  switch (rule.rule_type) {
    case 'department':
      return <CheckboxList items={options.departments.map(d => ({ key: d.id, label: d.name }))} selected={v.department_ids || []} onChange={ids => onChange({ department_ids: ids })} />
    case 'designation':
      return <CheckboxList items={options.designations.map(d => ({ key: d, label: d }))} selected={v.designations || []} onChange={vals => onChange({ designations: vals })} />
    case 'employment_type':
      return <CheckboxList items={options.employmentTypes.map(d => ({ key: d, label: d }))} selected={v.employment_types || []} onChange={vals => onChange({ employment_types: vals })} />
    case 'employment_status':
      return <CheckboxList items={[{ key: 'active', label: 'Active' }, { key: 'inactive', label: 'Inactive' }]} selected={v.statuses || []} onChange={vals => onChange({ statuses: vals })} />
    case 'location':
      return <input className="form-input" placeholder="Comma-separated locations" value={(v.locations || []).join(', ')} onChange={e => onChange({ locations: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
    case 'min_tenure_months':
      return <input className="form-input" type="number" min="0" style={{ maxWidth: 140 }} placeholder="Months" value={v.months || ''} onChange={e => onChange({ months: Number(e.target.value) })} />
    case 'min_performance_rating':
      return <input className="form-input" type="number" min="0" max="100" style={{ maxWidth: 140 }} placeholder="Min score (0-100)" value={v.min_score ?? ''} onChange={e => onChange({ min_score: Number(e.target.value) })} />
    case 'specific_employees':
      return <EmployeePicker selected={v.employee_ids || []} onChange={ids => onChange({ employee_ids: ids })} />
    default: return null
  }
}

function CheckboxList({ items, selected, onChange }) {
  const set = new Set(selected)
  function toggle(key) {
    const next = new Set(set)
    next.has(key) ? next.delete(key) : next.add(key)
    onChange([...next])
  }
  if (!items.length) return <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>No options found yet.</div>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {items.map(it => (
        <label key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5 }}>
          <input type="checkbox" checked={set.has(it.key)} onChange={() => toggle(it.key)} /> {it.label}
        </label>
      ))}
    </div>
  )
}

function EmployeePicker({ selected, onChange }) {
  const [search, setSearch] = useState('')
  const [all, setAll] = useState([])
  useEffect(() => { supabase.from('profiles').select('id,full_name').order('full_name').then(({ data }) => setAll(data || [])) }, [])
  const set = new Set(selected)
  const filtered = search ? all.filter(e => e.full_name?.toLowerCase().includes(search.toLowerCase())) : all
  function toggle(id) {
    const next = new Set(set)
    next.has(id) ? next.delete(id) : next.add(id)
    onChange([...next])
  }
  return (
    <div>
      <input className="form-input" placeholder="Search employees…" value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 8 }} />
      <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {filtered.slice(0, 60).map(e => (
          <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5 }}>
            <input type="checkbox" checked={set.has(e.id)} onChange={() => toggle(e.id)} /> {e.full_name}
          </label>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 4 }}>{selected.length} selected</div>
    </div>
  )
}

/* ═══ Step 3 — Workflow + Questions ═══ */
function StepWorkflow({ steps, setSteps, questionsByStep, setQuestionsByStep }) {
  function toggleEnabled(key) {
    setSteps(s => s.map(x => x.step_key === key ? { ...x, is_enabled: !x.is_enabled } : x))
  }
  function move(key, dir) {
    setSteps(s => {
      const idx = s.findIndex(x => x.step_key === key)
      const swapWith = idx + dir
      if (swapWith < 0 || swapWith >= s.length) return s
      const next = [...s]
      ;[next[idx], next[swapWith]] = [next[swapWith], next[idx]]
      return next.map((x, i) => ({ ...x, step_order: i }))
    })
  }
  function setStepConfig(key, config) {
    setSteps(s => s.map(x => x.step_key === key ? { ...x, config: { ...x.config, ...config } } : x))
  }

  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 16 }}>
        Toggle which steps this award requires and reorder them. Disabled steps are skipped entirely for every participant.
      </div>
      {steps.map((step, i) => {
        const def = WORKFLOW_STEP_DEFS.find(d => d.key === step.step_key)
        return (
          <div key={step.step_key} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 12, opacity: step.is_enabled ? 1 : 0.55 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, flex: 1 }}>
                <input type="checkbox" checked={step.is_enabled} onChange={() => toggleEnabled(step.step_key)} />
                {def.label}
              </label>
              <button className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => move(step.step_key, -1)}><ArrowUp size={13} /></button>
              <button className="btn btn-ghost btn-sm" disabled={i === steps.length - 1} onClick={() => move(step.step_key, 1)}><ArrowDown size={13} /></button>
            </div>

            {step.is_enabled && QUESTION_STEP_KEYS.includes(step.step_key) && (
              <QuestionBuilder questions={questionsByStep[step.step_key] || []}
                onChange={qs => setQuestionsByStep(m => ({ ...m, [step.step_key]: qs }))} />
            )}

            {step.is_enabled && step.step_key === 'peer_nomination' && (
              <div style={{ display: 'flex', gap: 20, marginTop: 12, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                  <input type="checkbox" checked={!!step.config.allow_self_nomination} onChange={e => setStepConfig('peer_nomination', { allow_self_nomination: e.target.checked })} /> Allow self-nomination
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                  <input type="checkbox" checked={!!step.config.allow_anonymous_nomination} onChange={e => setStepConfig('peer_nomination', { allow_anonymous_nomination: e.target.checked })} /> Allow anonymous nomination
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                  Max nominations/employee:
                  <input type="number" min="1" className="form-input" style={{ width: 70 }} value={step.config.max_nominations_per_employee || ''} onChange={e => setStepConfig('peer_nomination', { max_nominations_per_employee: Number(e.target.value) })} />
                </label>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function QuestionBuilder({ questions, onChange }) {
  function add() { onChange([...questions, { question_text: '', question_type: 'text', is_required: true }]) }
  function update(i, patch) { onChange(questions.map((q, idx) => idx === i ? { ...q, ...patch } : q)) }
  function remove(i) { onChange(questions.filter((_, idx) => idx !== i)) }

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--border)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 8, textTransform: 'uppercase' }}>Questions</div>
      {questions.map((q, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <input className="form-input" style={{ flex: 1 }} placeholder="Question text" value={q.question_text} onChange={e => update(i, { question_text: e.target.value })} />
          <select className="form-select" style={{ maxWidth: 140 }} value={q.question_type} onChange={e => update(i, { question_type: e.target.value })}>
            {QUESTION_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={q.is_required} onChange={e => update(i, { is_required: e.target.checked })} /> Required
          </label>
          <button className="btn btn-ghost btn-sm" onClick={() => remove(i)}><Trash2 size={13} /></button>
        </div>
      ))}
      <button className="btn btn-outline btn-sm" onClick={add}><Plus size={13} /> Add Question</button>
    </div>
  )
}

/* ═══ Step 4 — Scoring ═══ */
function StepScoring({ scoring, setScoring }) {
  const total = useMemo(() => totalScoringWeight(scoring), [scoring])
  const setWeight = (k, v) => setScoring(s => ({ ...s, [k]: Number(v) }))

  function updateRatingRow(i, patch) { setScoring(s => ({ ...s, rating_scale: s.rating_scale.map((r, idx) => idx === i ? { ...r, ...patch } : r) })) }
  function addRatingRow() { setScoring(s => ({ ...s, rating_scale: [...s.rating_scale, { value: s.rating_scale.length + 1, label: '' }] })) }
  function removeRatingRow(i) { setScoring(s => ({ ...s, rating_scale: s.rating_scale.filter((_, idx) => idx !== i) })) }

  function updateThresholdRow(i, patch) { setScoring(s => ({ ...s, recommendation_thresholds: s.recommendation_thresholds.map((r, idx) => idx === i ? { ...r, ...patch } : r) })) }
  function addThresholdRow() { setScoring(s => ({ ...s, recommendation_thresholds: [...s.recommendation_thresholds, { min_score: 0, label: '' }] })) }
  function removeThresholdRow(i) { setScoring(s => ({ ...s, recommendation_thresholds: s.recommendation_thresholds.filter((_, idx) => idx !== i) })) }

  function moveTieBreak(i, dir) {
    setScoring(s => {
      const arr = [...s.tie_break_order]
      const j = i + dir
      if (j < 0 || j >= arr.length) return s
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
      return { ...s, tie_break_order: arr }
    })
  }

  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 10, textTransform: 'uppercase' }}>Scoring Weights</div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Self Feedback %</label><input className="form-input" type="number" step="0.1" value={scoring.self_feedback_weight} onChange={e => setWeight('self_feedback_weight', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Manager Feedback %</label><input className="form-input" type="number" step="0.1" value={scoring.manager_feedback_weight} onChange={e => setWeight('manager_feedback_weight', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Peer Feedback %</label><input className="form-input" type="number" step="0.1" value={scoring.peer_feedback_weight} onChange={e => setWeight('peer_feedback_weight', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Performance Score %</label><input className="form-input" type="number" step="0.1" value={scoring.performance_weight} onChange={e => setWeight('performance_weight', e.target.value)} /></div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: Math.round(total * 100) / 100 === 100 ? '#15803d' : '#dc2626', marginBottom: 22 }}>Total: {total}% {Math.round(total * 100) / 100 !== 100 && '(must equal 100%)'}</div>

      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 10, textTransform: 'uppercase' }}>Rating Scale</div>
      {scoring.rating_scale.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <input className="form-input" type="number" style={{ width: 70 }} value={r.value} onChange={e => updateRatingRow(i, { value: Number(e.target.value) })} />
          <input className="form-input" style={{ flex: 1 }} value={r.label} onChange={e => updateRatingRow(i, { label: e.target.value })} />
          <button className="btn btn-ghost btn-sm" onClick={() => removeRatingRow(i)}><Trash2 size={13} /></button>
        </div>
      ))}
      <button className="btn btn-outline btn-sm" onClick={addRatingRow} style={{ marginBottom: 22 }}><Plus size={13} /> Add Rating Level</button>

      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 10, textTransform: 'uppercase' }}>Recommendation Thresholds</div>
      {scoring.recommendation_thresholds.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <input className="form-input" type="number" style={{ width: 90 }} value={r.min_score} onChange={e => updateThresholdRow(i, { min_score: Number(e.target.value) })} />
          <input className="form-input" style={{ flex: 1 }} value={r.label} onChange={e => updateThresholdRow(i, { label: e.target.value })} />
          <button className="btn btn-ghost btn-sm" onClick={() => removeThresholdRow(i)}><Trash2 size={13} /></button>
        </div>
      ))}
      <button className="btn btn-outline btn-sm" onClick={addThresholdRow} style={{ marginBottom: 22 }}><Plus size={13} /> Add Threshold</button>

      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 10, textTransform: 'uppercase' }}>Tie-Break Order</div>
      {scoring.tie_break_order.map((key, i) => (
        <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <div style={{ width: 20, fontSize: 12, color: 'var(--ink-muted)' }}>{i + 1}.</div>
          <div style={{ flex: 1, fontSize: 13 }}>{TIE_BREAK_LABEL[key] || key}</div>
          <button className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => moveTieBreak(i, -1)}><ArrowUp size={13} /></button>
          <button className="btn btn-ghost btn-sm" disabled={i === scoring.tie_break_order.length - 1} onClick={() => moveTieBreak(i, 1)}><ArrowDown size={13} /></button>
        </div>
      ))}
    </div>
  )
}

/* ═══ Step 5 — Review ═══ */
function StepReview({ basics, rules, steps, questionsByStep, scoring }) {
  const enabledSteps = steps.filter(s => s.is_enabled)
  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{basics.name}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 20 }}>{basics.code} · {basics.frequency}</div>

      <ReviewSection title="Eligibility">
        {rules.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Open to all employees</div> : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {rules.map((r, i) => <li key={i}>{ELIGIBILITY_RULE_TYPES.find(t => t.key === r.rule_type)?.label}: {JSON.stringify(r.rule_value)}</li>)}
          </ul>
        )}
      </ReviewSection>

      <ReviewSection title="Workflow">
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
          {enabledSteps.map(s => {
            const def = WORKFLOW_STEP_DEFS.find(d => d.key === s.step_key)
            const qCount = (questionsByStep[s.step_key] || []).length
            return <li key={s.step_key}>{def.label}{qCount ? ` — ${qCount} question(s)` : ''}</li>
          })}
        </ul>
      </ReviewSection>

      <ReviewSection title="Scoring">
        <div style={{ fontSize: 13 }}>
          Self {scoring.self_feedback_weight}% · Manager {scoring.manager_feedback_weight}% · Peer {scoring.peer_feedback_weight}% · Performance {scoring.performance_weight}%
        </div>
      </ReviewSection>
    </div>
  )
}

function ReviewSection({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 8, textTransform: 'uppercase' }}>{title}</div>
      {children}
    </div>
  )
}
