import { useState, useMemo } from 'react'
import { Modal } from '../ui'
import { createEngagement, updateEngagement, budgetLabel } from '../../lib/goLive'
import { addDays, DEFAULT_EXIT_CRITERIA, DEFAULT_CONFIG, checkParameters, parseParameterLines, parameterLines } from '../../lib/goLiveRules'
import { Field, PersonSelect, ErrorLine, errText } from './shared'
import { deviceFields, parseFieldLines, fieldLines } from '../../lib/goLiveDeviceFields'

// Create / edit a go-live engagement. Department → Project → Budget line is
// the spine (§3.1): all three are required.
export default function EngagementForm({ initial, lookups, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    name: '', department_ids: [], project_id: '', budget_line_id: '', customer_id: '', sites: [], pm_user_id: '',
    go_live_date: '', hypercare_start: '', hypercare_planned_end: '', handover_to: '',
    ...initial,
    department_ids: initial?.department_ids?.length ? initial.department_ids : (initial?.department_id ? [initial.department_id] : []),
    exit_criteria: { ...DEFAULT_EXIT_CRITERIA, ...(initial?.exit_criteria || {}) },
    config: { ...DEFAULT_CONFIG, ...(initial?.config || {}) },
  }))
  const [sitesText, setSitesText] = useState((initial?.sites || []).join(', '))
  const [paramText, setParamText] = useState(() => parameterLines(checkParameters(initial?.config)))
  const [fieldText, setFieldText] = useState(() => fieldLines(deviceFields(initial?.config)))
  const parsedFields = useMemo(() => parseFieldLines(fieldText), [fieldText])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setCrit = (k, v) => setForm(f => ({ ...f, exit_criteria: { ...f.exit_criteria, [k]: v } }))
  const setCfg = (k, v) => setForm(f => ({ ...f, config: { ...f.config, [k]: v } }))

  // Delivery-stage projects only (spec: project must be active).
  const projects = lookups.projects.filter(p => p.status === 'active' || p.id === form.project_id)
  const budgets = useMemo(() => lookups.budgets.filter(b => b.project_id === form.project_id || (!b.project_id && form.department_ids.includes(b.department_id))), [lookups.budgets, form.project_id, form.department_ids])
  const [deptQuery, setDeptQuery] = useState('')
  const toggleDept = id => set('department_ids', form.department_ids.includes(id) ? form.department_ids.filter(x => x !== id) : [...form.department_ids, id])

  function pickProject(id) {
    const p = lookups.projects.find(x => x.id === id)
    setForm(f => ({
      ...f, project_id: id,
      department_ids: f.department_ids.length || !p?.department_id ? f.department_ids : [p.department_id],
      customer_id: p?.customer_id || f.customer_id,
      budget_line_id: '',
      name: f.name || (p ? `${p.name} go-live` : ''),
    }))
  }

  function pickGoLive(d) {
    setForm(f => ({
      ...f, go_live_date: d,
      hypercare_start: !f.hypercare_start || f.hypercare_start === f.go_live_date ? d : f.hypercare_start,
      hypercare_planned_end: !f.hypercare_planned_end || f.hypercare_planned_end === addDays(f.go_live_date || d, 30) ? (d ? addDays(d, 30) : '') : f.hypercare_planned_end,
    }))
  }

  async function save() {
    setError('')
    const sites = sitesText.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
    if (!form.name.trim() || !form.project_id || !form.department_ids.length || !form.budget_line_id || !form.go_live_date) {
      setError('Name, at least one department, project, budget line and go-live date are required'); return
    }
    if (!sites.length) { setError('Add at least one site'); return }
    if (form.hypercare_planned_end && form.hypercare_start && form.hypercare_planned_end < form.hypercare_start) {
      setError('Hypercare end must be on or after the start'); return
    }
    setSaving(true)
    try {
      const payload = { ...form, sites }
      const saved = initial?.id ? await updateEngagement(payload) : await createEngagement(payload)
      onSaved(saved)
    } catch (e) { setError(errText(e)) }
    setSaving(false)
  }

  const num = (v, fallback) => (v === '' ? '' : Number.isFinite(Number(v)) ? Number(v) : fallback)

  return (
    <Modal open size="lg" title={initial?.id ? `Edit ${initial.code}` : 'New go-live engagement'} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button></>}>
      <ErrorLine error={error} />
      <div className="form-row">
        <Field label="Project" required>
          <select className="form-select" value={form.project_id} onChange={e => pickProject(e.target.value)} disabled={!!initial?.id}>
            <option value="">Select project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ''}{p.name}</option>)}
          </select>
        </Field>
        <Field label="Departments" required hint={form.department_ids.length > 1 ? `${form.department_ids.length} selected · first is the primary department` : 'Pick one or more'}>
          <div style={{ border: '1.5px solid var(--border)', borderRadius: 10, padding: 8, background: '#fff' }}>
            {lookups.departments.length > 8 && (
              <input className="form-input" style={{ marginBottom: 6, fontSize: 12, padding: '5px 8px' }} placeholder="Search departments…" value={deptQuery} onChange={e => setDeptQuery(e.target.value)} />
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 110, overflowY: 'auto' }}>
              {lookups.departments
                .filter(d => form.department_ids.includes(d.id) || !deptQuery.trim() || d.name.toLowerCase().includes(deptQuery.trim().toLowerCase()))
                .map(d => (
                  <button key={d.id} type="button" className={`chip-toggle ${form.department_ids.includes(d.id) ? 'on' : ''}`} onClick={() => toggleDept(d.id)}>{d.name}</button>
                ))}
              {!lookups.departments.length && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>No departments set up yet</span>}
            </div>
          </div>
        </Field>
      </div>
      <div className="form-row">
        <Field label="Budget line" required hint={form.project_id && !budgets.length ? 'No budget lines for this project yet — add one in Budget' : null}>
          <select className="form-select" value={form.budget_line_id} onChange={e => set('budget_line_id', e.target.value)}>
            <option value="">Select budget line</option>
            {budgets.map(b => <option key={b.id} value={b.id}>{budgetLabel(b)}</option>)}
          </select>
        </Field>
        <Field label="Customer" hint="Defaulted from the project">
          <select className="form-select" value={form.customer_id || ''} onChange={e => set('customer_id', e.target.value)}>
            <option value="">—</option>
            {lookups.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Engagement name" required>
        <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} />
      </Field>
      <div className="form-row">
        <Field label="Sites" required hint="Comma-separated">
          <input className="form-input" value={sitesText} onChange={e => setSitesText(e.target.value)} placeholder="Plant A, Warehouse 2" />
        </Field>
        <Field label="Project manager">
          <PersonSelect people={lookups.people} value={form.pm_user_id} onChange={v => set('pm_user_id', v)} placeholder="Me (default)" />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Go-live date" required>
          <input type="date" className="form-input" value={form.go_live_date || ''} onChange={e => pickGoLive(e.target.value)} />
        </Field>
        <Field label="Handover to" hint="Steady-state team / queue after exit">
          <input className="form-input" value={form.handover_to || ''} onChange={e => set('handover_to', e.target.value)} placeholder="L2 Support" />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Hypercare start">
          <input type="date" className="form-input" value={form.hypercare_start || ''} onChange={e => set('hypercare_start', e.target.value)} />
        </Field>
        <Field label="Hypercare planned end" hint="Default 30 days from go-live">
          <input type="date" className="form-input" value={form.hypercare_planned_end || ''} onChange={e => set('hypercare_planned_end', e.target.value)} />
        </Field>
      </div>

      <details style={{ marginTop: 6 }} open={!!parsedFields.length || undefined}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Custom device fields{parsedFields.length ? ` (${parsedFields.length})` : ''}</summary>
        <Field label="Fields captured per device" hint="One per line: “Label | list | option 1, option 2”, “Label | text” or “Label | yesno”. Each field is set when adding or editing devices, is an Excel column on the Devices export and a filter on every tab. Renaming a field starts it fresh; removing one hides it but keeps saved values.">
          <textarea className="form-textarea" rows={4} style={{ fontFamily: 'monospace', fontSize: 12 }} value={fieldText} placeholder={'Zone | list | North, South, East\nContract ref | text\nCritical asset | yesno'}
            onChange={e => { setFieldText(e.target.value); setCfg('device_fields', parseFieldLines(e.target.value)) }} />
        </Field>
        {parsedFields.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: -6, marginBottom: 10 }}>
            {parsedFields.map(f => <span key={f.key} className="gl-tag">{f.label} · {f.type === 'list' ? `${(f.options || []).length} options` : f.type === 'yesno' ? 'Yes / No' : 'text'}</span>)}
          </div>
        )}
      </details>

      <details style={{ marginTop: 6 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Exit criteria &amp; rules</summary>
        <div className="form-row">
          <Field label="Consecutive stable days"><input type="number" min={1} className="form-input" value={form.exit_criteria.consecutive_days} onChange={e => setCrit('consecutive_days', num(e.target.value, 7))} /></Field>
          <Field label="Coverage % required"><input type="number" min={0} max={100} className="form-input" value={form.exit_criteria.coverage_pct} onChange={e => setCrit('coverage_pct', num(e.target.value, 100))} /></Field>
        </div>
        <div className="form-row">
          <Field label="Healthy % required"><input type="number" min={0} max={100} className="form-input" value={form.exit_criteria.healthy_pct} onChange={e => setCrit('healthy_pct', num(e.target.value, 95))} /></Field>
          <Field label="Back-dated edit window (days)" hint="Edits after check date + N days need a reason"><input type="number" min={0} className="form-input" value={form.config.back_date_days} onChange={e => setCfg('back_date_days', num(e.target.value, 1))} /></Field>
        </div>
        <div className="form-row">
          <Field label="Stale data threshold (× reporting interval)"><input type="number" min={1} step={0.5} className="form-input" value={form.config.stale_multiplier} onChange={e => setCfg('stale_multiplier', num(e.target.value, 2))} /></Field>
          <Field label="Customer sign-off">
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={!!form.exit_criteria.require_customer_signoff} onChange={e => setCrit('require_customer_signoff', e.target.checked)} /> Required before exit approval
            </label>
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={!!form.config.require_incident_on_attention} onChange={e => setCfg('require_incident_on_attention', e.target.checked)} /> Attention needs an incident or waiver</label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={!!form.config.stale_data_warning} onChange={e => setCfg('stale_data_warning', e.target.checked)} /> Warn when Operation is Yes but data is stale</label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={!!form.config.verifier_must_differ} onChange={e => setCfg('verifier_must_differ', e.target.checked)} /> Verifier must differ from owner</label>
        </div>
        <Field label="Application review parameters" hint="One per line, as “Label | unit”. The application engineer marks each one working, not working or N/A in the daily check. Renaming a parameter starts it fresh.">
          <textarea className="form-textarea" rows={8} style={{ fontFamily: 'monospace', fontSize: 12 }} value={paramText}
            onChange={e => { setParamText(e.target.value); setCfg('parameters', parseParameterLines(e.target.value)) }} />
        </Field>
      </details>

    </Modal>
  )
}
