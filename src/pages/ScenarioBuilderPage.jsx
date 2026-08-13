import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { createScenario, getVersion, updateVersion, getScenario, updateScenario, upsertVariable, listVariables, deleteVariable } from '../lib/scenarios'
import { LINKABLE_TYPES, listLinks, addLink, removeLink } from '../lib/scenarioLinks'
import ScenarioLinkPicker from '../components/ScenarioLinkPicker'
import { Loader, Alert, Stepper } from '../components/ui'
import { Plus, Trash2, Link2, X } from 'lucide-react'

const STEPS = ['Objective', 'Context & Timeline', 'Linked Data', 'Assumptions', 'Risks', 'Review']
const CATEGORIES = ['general', 'expansion', 'cost-reduction', 'hiring', 'product-launch', 'restructuring']

// Scenario Builder wizard (Phase 5) — creates a scenario + its first
// draft version. Simulation/Approval/Execution/Variance are NOT wizard
// steps — they're ongoing lifecycle actions that happen after this
// draft exists, so they live on ScenarioDetailPage's tabs instead
// (matches the Phase 1 navigation-flow design).
export default function ScenarioBuilderPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const editVersionId = params.get('version')

  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(!!editVersionId)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const [scenarioId, setScenarioId] = useState(null)
  const [versionId, setVersionId] = useState(editVersionId || null)
  const [form, setForm] = useState({ name: '', code: '', objective: '', category: 'general' })
  const [context, setContext] = useState({ background: '', stakeholders: '', risks: '' })
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [links, setLinks] = useState([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [variables, setVariables] = useState([])

  useEffect(() => {
    if (!editVersionId) return
    ;(async () => {
      try {
        const version = await getVersion(editVersionId)
        const scenario = await getScenario(version.scenario_id)
        setScenarioId(scenario.id)
        setForm({ name: scenario.name, code: scenario.code, objective: scenario.objective || '', category: scenario.category })
        setContext({ background: '', stakeholders: '', risks: '', ...(version.context || {}) })
        setStartDate(version.start_date || ''); setEndDate(version.end_date || '')
        setLinks(await listLinks(editVersionId))
        setVariables(await listVariables(editVersionId))
      } catch (e) { setErr(e.message) }
      finally { setLoading(false) }
    })()
  }, [editVersionId])

  async function ensureDraft() {
    if (versionId) return versionId
    const { scenario, version } = await createScenario({ name: form.name, objective: form.objective, category: form.category })
    setScenarioId(scenario.id); setVersionId(version.id); setForm(f => ({ ...f, code: scenario.code }))
    return version.id
  }

  async function goNext() {
    setErr('')
    if (step === 0 && !form.name.trim()) { setErr('Give this scenario a name first.'); return }
    try {
      setSaving(true)
      const vId = await ensureDraft()
      if (scenarioId) await updateScenario(scenarioId, { name: form.name, objective: form.objective, category: form.category })
      if (step === 1) await updateVersion(vId, { context, start_date: startDate || null, end_date: endDate || null })
      if (step === 4) await updateVersion(vId, { context: { ...context } })
      setStep(s => Math.min(STEPS.length - 1, s + 1))
      if (step === 2) setLinks(await listLinks(vId))
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  async function handleAddLink(item, type) {
    await addLink(versionId, { linkedType: type, linkedId: item.id })
    setLinks(await listLinks(versionId))
    setPickerOpen(false)
  }

  async function handleRemoveLink(id) {
    await removeLink(id)
    setLinks(l => l.filter(x => x.id !== id))
  }

  async function handleAddVariable() {
    const key = `var_${Date.now()}`
    await upsertVariable(versionId, { key, label: 'New Variable', dataType: 'number', value: '0', sortOrder: variables.length })
    setVariables(await listVariables(versionId))
  }

  async function handleUpdateVariable(v, fields) {
    await upsertVariable(versionId, { key: v.key, label: v.label, dataType: v.data_type, value: v.value, sortOrder: v.sort_order, ...fields })
    setVariables(await listVariables(versionId))
  }

  async function handleDeleteVariable(id) {
    await deleteVariable(id)
    setVariables(v => v.filter(x => x.id !== id))
  }

  async function handleFinish() {
    setSaving(true); setErr('')
    try {
      await updateVersion(versionId, { context, start_date: startDate || null, end_date: endDate || null })
      navigate(`/scenarios/${versionId}`)
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">{editVersionId ? 'Edit Scenario' : 'New Scenario'}</div>
          <div className="page-subtitle">{form.code ? `${form.code} — ` : ''}Draft — nothing is simulated or executed until you choose to.</div>
        </div>
      </div>

      <Stepper steps={STEPS} activeIndex={step} onStepClick={setStep} allowJumpAhead={!!versionId} />

      {err && <Alert type="error" message={err} />}

      <div className="card" style={{ padding: '24px 28px', maxWidth: 760 }}>
        {step === 0 && (
          <div>
            <div style={{ marginBottom: 14 }}>
              <label className="form-label">Scenario Name *</label>
              <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Q3 APAC Expansion" autoFocus />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label className="form-label">Objective</label>
              <textarea className="form-input" rows={3} value={form.objective} onChange={e => setForm(f => ({ ...f, objective: e.target.value }))} placeholder="What decision is this scenario trying to inform?" />
            </div>
            <div>
              <label className="form-label">Category</label>
              <select className="form-input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/-/g, ' ')}</option>)}
              </select>
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <div style={{ display: 'flex', gap: 14, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <label className="form-label">Start Date</label>
                <input className="form-input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="form-label">End Date</label>
                <input className="form-input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label className="form-label">Background</label>
              <textarea className="form-input" rows={3} value={context.background} onChange={e => setContext(c => ({ ...c, background: e.target.value }))} placeholder="Why is this scenario being explored now?" />
            </div>
            <div>
              <label className="form-label">Key Stakeholders</label>
              <input className="form-input" value={context.stakeholders} onChange={e => setContext(c => ({ ...c, stakeholders: e.target.value }))} placeholder="Who needs to sign off on this?" />
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <p style={{ color: 'var(--ink-muted)', fontSize: 13, margin: 0 }}>Link the real records this scenario should be simulated against — projects, budgets, employees, and more.</p>
              <button className="btn btn-primary btn-sm" onClick={() => setPickerOpen(true)}><Link2 size={13} /> Link a Record</button>
            </div>
            {links.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-muted)', border: '1px dashed var(--border)', borderRadius: 10 }}>No records linked yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {links.map(l => (
                  <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }}>
                    <span className="badge">{LINKABLE_TYPES.find(t => t.key === l.linked_type)?.label || l.linked_type}</span>
                    <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 12, color: 'var(--ink-muted)' }}>{l.linked_id}</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleRemoveLink(l.id)}><X size={13} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <p style={{ color: 'var(--ink-muted)', fontSize: 13, margin: 0 }}>Assumptions the simulation engine will use — add <code>expected_revenue</code> if this scenario should compute ROI.</p>
              <button className="btn btn-primary btn-sm" onClick={handleAddVariable}><Plus size={13} /> Add Variable</button>
            </div>
            {variables.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-muted)', border: '1px dashed var(--border)', borderRadius: 10 }}>No assumptions yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {variables.map(v => (
                  <div key={v.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input className="form-input" style={{ flex: 1 }} value={v.label} onChange={e => setVariables(vs => vs.map(x => x.id === v.id ? { ...x, label: e.target.value } : x))} onBlur={() => handleUpdateVariable(v, { label: v.label })} placeholder="Label" />
                    <input className="form-input" style={{ width: 140, fontFamily: 'monospace', fontSize: 12 }} value={v.key} onChange={e => setVariables(vs => vs.map(x => x.id === v.id ? { ...x, key: e.target.value } : x))} onBlur={() => handleUpdateVariable(v, { key: v.key })} placeholder="key" />
                    <input className="form-input" style={{ width: 120 }} value={v.value} onChange={e => setVariables(vs => vs.map(x => x.id === v.id ? { ...x, value: e.target.value } : x))} onBlur={() => handleUpdateVariable(v, { value: v.value })} placeholder="Value" />
                    <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteVariable(v.id)}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div>
            <label className="form-label">Known Risks</label>
            <textarea className="form-input" rows={5} value={context.risks} onChange={e => setContext(c => ({ ...c, risks: e.target.value }))} placeholder="What could make this scenario's assumptions wrong?" />
          </div>
        )}

        {step === 5 && (
          <div>
            <h3 style={{ fontWeight: 800, marginBottom: 12 }}>{form.name}</h3>
            <p style={{ color: 'var(--ink-muted)', marginBottom: 16 }}>{form.objective || 'No objective set.'}</p>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13, marginBottom: 16 }}>
              <div><strong>{links.length}</strong> linked record{links.length === 1 ? '' : 's'}</div>
              <div><strong>{variables.length}</strong> assumption{variables.length === 1 ? '' : 's'}</div>
              <div><strong>{startDate || '—'}</strong> → <strong>{endDate || '—'}</strong></div>
            </div>
            <button className="btn btn-primary" disabled={saving} onClick={handleFinish}>{saving ? 'Saving…' : 'Save Draft & Continue'}</button>
          </div>
        )}
      </div>

      {step < STEPS.length - 1 && (
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          {step > 0 && <button className="btn btn-ghost" onClick={() => setStep(s => s - 1)}>Back</button>}
          <button className="btn btn-primary" disabled={saving} onClick={goNext}>{saving ? 'Saving…' : 'Continue'}</button>
        </div>
      )}

      {pickerOpen && versionId && (
        <ScenarioLinkPicker onSelect={handleAddLink} onClose={() => setPickerOpen(false)} />
      )}
    </div>
  )
}
