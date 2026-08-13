import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  getTemplate, updateTemplate, setTemplateSections,
  addTemplateVariable, updateTemplateVariable, deleteTemplateVariable, reorderTemplateVariables,
} from '../lib/scenarioTemplates'
import { Loader, Alert } from '../components/ui'
import { ArrowUp, ArrowDown, Plus, Trash2, ArrowLeft } from 'lucide-react'

const DATA_TYPES = ['number', 'percent', 'currency', 'text', 'boolean', 'date']
const SECTION_PRESETS = [
  { key: 'context', label: 'Context & Timeline' },
  { key: 'linked_data', label: 'Linked Data' },
  { key: 'assumptions', label: 'Assumptions & Variables' },
  { key: 'risks', label: 'Risks' },
]

export default function ScenarioTemplateBuilderPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [template, setTemplate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    try { setTemplate(await getTemplate(id)) } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [id])

  async function handleMeta(fields) {
    setSaving(true)
    try { await updateTemplate(id, fields); await load() } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  function toggleSection(preset) {
    const sections = template.sections || []
    const exists = sections.some(s => s.key === preset.key)
    const next = exists ? sections.filter(s => s.key !== preset.key) : [...sections, { key: preset.key, label: preset.label, sort_order: sections.length }]
    setTemplateSections(id, next).then(load).catch(e => setErr(e.message))
  }

  async function handleAddVariable() {
    try {
      await addTemplateVariable(id, { key: `var_${Date.now()}`, label: 'New Variable', dataType: 'number', sortOrder: template.variables?.length || 0 })
      await load()
    } catch (e) { setErr(e.message) }
  }

  async function handleUpdateVariable(v, fields) {
    try { await updateTemplateVariable(v.id, fields); await load() } catch (e) { setErr(e.message) }
  }

  async function handleDeleteVariable(vid) {
    try { await deleteTemplateVariable(vid); await load() } catch (e) { setErr(e.message) }
  }

  async function move(index, dir) {
    const vars = [...(template.variables || [])].sort((a, b) => a.sort_order - b.sort_order)
    const target = index + dir
    if (target < 0 || target >= vars.length) return
    ;[vars[index], vars[target]] = [vars[target], vars[index]]
    try { await reorderTemplateVariables(vars.map(v => v.id)); await load() } catch (e) { setErr(e.message) }
  }

  if (loading) return <Loader />
  if (!template) return <Alert type="error" message="Template not found" />

  const sortedVars = [...(template.variables || [])].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to="/scenarios/templates" style={{ fontSize: 13, color: 'var(--ink-muted)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}><ArrowLeft size={13} /> Templates</Link>
          <div className="page-title">{template.name}</div>
        </div>
      </div>

      {err && <Alert type="error" message={err} />}

      <div className="card" style={{ padding: 20, marginBottom: 20, maxWidth: 700 }}>
        <label className="form-label">Name</label>
        <input className="form-input" defaultValue={template.name} onBlur={e => e.target.value !== template.name && handleMeta({ name: e.target.value })} />
        <label className="form-label" style={{ marginTop: 12 }}>Description</label>
        <textarea className="form-input" rows={2} defaultValue={template.description || ''} onBlur={e => handleMeta({ description: e.target.value })} />
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 20, maxWidth: 700 }}>
        <h3 style={{ fontWeight: 800, marginBottom: 10 }}>Sections included</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SECTION_PRESETS.map(p => {
            const on = (template.sections || []).some(s => s.key === p.key)
            return (
              <button key={p.key} className={`btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}`} onClick={() => toggleSection(p)}>{p.label}</button>
            )
          })}
        </div>
      </div>

      <div className="card" style={{ padding: 20, maxWidth: 700 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontWeight: 800, margin: 0 }}>Variables</h3>
          <button className="btn btn-primary btn-sm" onClick={handleAddVariable}><Plus size={13} /> Add Variable</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sortedVars.map((v, i) => (
            <div key={v.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <button className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => move(i, -1)} style={{ padding: 2 }}><ArrowUp size={12} /></button>
                <button className="btn btn-ghost btn-sm" disabled={i === sortedVars.length - 1} onClick={() => move(i, 1)} style={{ padding: 2 }}><ArrowDown size={12} /></button>
              </div>
              <input className="form-input" style={{ flex: 1 }} defaultValue={v.label} onBlur={e => e.target.value !== v.label && handleUpdateVariable(v, { label: e.target.value })} placeholder="Label" />
              <input className="form-input" style={{ width: 140, fontFamily: 'monospace', fontSize: 12 }} defaultValue={v.key} onBlur={e => e.target.value !== v.key && handleUpdateVariable(v, { key: e.target.value })} placeholder="key" />
              <select className="form-input" style={{ width: 120 }} defaultValue={v.data_type} onChange={e => handleUpdateVariable(v, { data_type: e.target.value })}>
                {DATA_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input className="form-input" style={{ width: 120 }} defaultValue={v.default_value || ''} onBlur={e => handleUpdateVariable(v, { default_value: e.target.value })} placeholder="Default" />
              <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteVariable(v.id)}><Trash2 size={13} /></button>
            </div>
          ))}
          {sortedVars.length === 0 && <p style={{ color: 'var(--ink-muted)', fontSize: 13 }}>No variables yet — add one above.</p>}
        </div>
      </div>
    </div>
  )
}
