import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Loader, Alert, Empty, Confirm } from '../components/ui'
import { ArrowLeft, Plus, Trash2, Eye, EyeOff } from 'lucide-react'
import {
  ensureSeed, listCategories, upsertCategory, setCategoryActive, deleteCategory,
  listSlaPolicies, updateSlaPolicy, listAssignmentRules, createAssignmentRule,
  setAssignmentRuleActive, deleteAssignmentRule, listItAgents,
  IT_PRIORITIES,
} from '../lib/itHelpdesk'

const slug = s => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export default function ITHelpdeskSettingsPage() {
  const { profile } = useAuth()
  const [cats, setCats] = useState([])
  const [sla, setSla] = useState([])
  const [rules, setRules] = useState([])
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const [newCat, setNewCat] = useState('')
  const [slaDraft, setSlaDraft] = useState({})
  const [ruleForm, setRuleForm] = useState({ category: '', priority: '', rule_type: 'least_loaded', assigned_to: '' })
  const [delCat, setDelCat] = useState(null)

  const load = useCallback(async () => {
    setErr('')
    try {
      await ensureSeed().catch(() => {})
      const [c, s, r, a] = await Promise.all([
        listCategories({ activeOnly: false }), listSlaPolicies(), listAssignmentRules(), listItAgents(),
      ])
      setCats(c); setSla(s); setRules(r); setAgents(a)
      setSlaDraft(Object.fromEntries(s.map(p => [p.id, { first: p.first_response_minutes, res: p.resolution_minutes }])))
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function flash(m) { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  async function addCategory() {
    const label = newCat.trim()
    if (!label) return
    const key = slug(label)
    if (!key) { setErr('Enter a valid category name.'); return }
    if (cats.some(c => c.key === key)) { setErr('A category with that key already exists.'); return }
    try {
      await upsertCategory({ organization_id: profile.organization_id, key, label, sort_order: (cats.at(-1)?.sort_order ?? 0) + 1, is_active: true })
      setNewCat(''); flash('Category added'); await load()
    } catch (e) { setErr(e.message) }
  }

  async function saveSla(p) {
    const d = slaDraft[p.id]
    const first = Number(d.first), res = Number(d.res)
    if (!Number.isFinite(first) || !Number.isFinite(res) || first <= 0 || res <= 0) { setErr('SLA minutes must be positive numbers.'); return }
    try { await updateSlaPolicy(p.id, { first_response_minutes: first, resolution_minutes: res }, profile.id); flash(`${p.priority} SLA saved`) }
    catch (e) { setErr(e.message) }
  }

  async function addRule() {
    if (ruleForm.rule_type === 'manual_default' && !ruleForm.assigned_to) { setErr('Pick an agent for a manual-default rule.'); return }
    try {
      await createAssignmentRule({
        organization_id: profile.organization_id,
        category: ruleForm.category || null,
        priority: ruleForm.priority || null,
        rule_type: ruleForm.rule_type,
        assigned_to: ruleForm.rule_type === 'manual_default' ? ruleForm.assigned_to : null,
        sort_order: (rules.at(-1)?.sort_order ?? 0) + 1,
      })
      setRuleForm({ category: '', priority: '', rule_type: 'least_loaded', assigned_to: '' })
      flash('Rule added'); await load()
    } catch (e) { setErr(e.message) }
  }

  if (loading) return <Loader />

  const box = { border: '1.5px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 20, background: '#fff' }
  const h3 = { fontWeight: 800, fontSize: '1.05rem', marginBottom: 4 }
  const sub = { color: 'var(--ink-muted)', fontSize: '0.86rem', marginBottom: 14 }

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to="/it-helpdesk" style={{ fontSize: 13, color: 'var(--ink-muted)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, textDecoration: 'none' }}>
            <ArrowLeft size={13} /> IT Helpdesk
          </Link>
          <div className="page-title">IT Helpdesk Settings</div>
          <div className="page-subtitle">Categories, SLA targets and auto-assignment rules for your organization</div>
        </div>
      </div>

      {err && <Alert type="error" message={err} />}
      {msg && <Alert type="success" message={msg} />}

      {/* Categories */}
      <div style={box}>
        <h3 style={h3}>Categories</h3>
        <p style={sub}>Shown in the New Ticket form. Deactivating hides a category from new tickets without touching existing ones.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {cats.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, opacity: c.is_active ? 1 : 0.55 }}>
              <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{c.label} <span style={{ fontWeight: 500, color: 'var(--ink-muted)', fontSize: 11 }}>{c.key}</span></span>
              <button className="btn btn-ghost btn-sm" onClick={() => setCategoryActive(c.id, !c.is_active).then(load)}>
                {c.is_active ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
              <button className="btn btn-ghost btn-sm" style={{ color: '#ef4444' }} onClick={() => setDelCat(c)}><Trash2 size={13} /></button>
            </div>
          ))}
          {cats.length === 0 && <Empty title="No categories" desc="Add one below." />}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="form-input" placeholder="New category name" value={newCat}
            onChange={e => setNewCat(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCategory()} />
          <button className="btn btn-primary btn-sm" onClick={addCategory}><Plus size={14} /> Add</button>
        </div>
      </div>

      {/* SLA */}
      <div style={box}>
        <h3 style={h3}>SLA targets</h3>
        <p style={sub}>Minutes from ticket creation. Applied when a ticket is raised and recomputed if its priority changes.</p>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ minWidth: 460 }}>
            <thead><tr><th>Priority</th><th>First response (min)</th><th>Resolution (min)</th><th></th></tr></thead>
            <tbody>
              {sla.map(p => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 700, textTransform: 'capitalize' }}>{p.priority}</td>
                  <td>
                    <input className="form-input" style={{ width: 110 }} type="number" min={1}
                      value={slaDraft[p.id]?.first ?? ''} onChange={e => setSlaDraft(d => ({ ...d, [p.id]: { ...d[p.id], first: e.target.value } }))} />
                  </td>
                  <td>
                    <input className="form-input" style={{ width: 110 }} type="number" min={1}
                      value={slaDraft[p.id]?.res ?? ''} onChange={e => setSlaDraft(d => ({ ...d, [p.id]: { ...d[p.id], res: e.target.value } }))} />
                  </td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => saveSla(p)}>Save</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Assignment rules */}
      <div style={box}>
        <h3 style={h3}>Auto-assignment rules</h3>
        <p style={sub}>The most specific active rule wins. With no matching rule, a new ticket goes to the manager or department head with the fewest open tickets.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {rules.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, opacity: r.is_active ? 1 : 0.55, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, flex: 1, minWidth: 180 }}>
                <strong>{r.category ? (cats.find(c => c.key === r.category)?.label || r.category) : 'Any category'}</strong>
                {' · '}{r.priority || 'any priority'}
                {' → '}{r.rule_type === 'manual_default' ? (r.assignee?.full_name || 'a set agent') : 'least-loaded agent'}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => setAssignmentRuleActive(r.id, !r.is_active).then(load)}>
                {r.is_active ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
              <button className="btn btn-ghost btn-sm" style={{ color: '#ef4444' }} onClick={() => deleteAssignmentRule(r.id).then(load)}><Trash2 size={13} /></button>
            </div>
          ))}
          {rules.length === 0 && <Empty title="No custom rules" desc="Least-loaded assignment is used by default." />}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className="form-label">Category</label>
            <select className="form-input" style={{ width: 170 }} value={ruleForm.category} onChange={e => setRuleForm(f => ({ ...f, category: e.target.value }))}>
              <option value="">Any</option>
              {cats.filter(c => c.is_active).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Priority</label>
            <select className="form-input" style={{ width: 130 }} value={ruleForm.priority} onChange={e => setRuleForm(f => ({ ...f, priority: e.target.value }))}>
              <option value="">Any</option>
              {IT_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Assign</label>
            <select className="form-input" style={{ width: 150 }} value={ruleForm.rule_type} onChange={e => setRuleForm(f => ({ ...f, rule_type: e.target.value }))}>
              <option value="least_loaded">Least loaded</option>
              <option value="manual_default">Specific agent</option>
            </select>
          </div>
          {ruleForm.rule_type === 'manual_default' && (
            <div>
              <label className="form-label">Agent</label>
              <select className="form-input" style={{ width: 170 }} value={ruleForm.assigned_to} onChange={e => setRuleForm(f => ({ ...f, assigned_to: e.target.value }))}>
                <option value="">Pick…</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
              </select>
            </div>
          )}
          <button className="btn btn-primary btn-sm" onClick={addRule}><Plus size={14} /> Add rule</button>
        </div>
      </div>

      <Confirm open={!!delCat} danger
        message={`Delete the "${delCat?.label}" category? Existing tickets keep their category label.`}
        onConfirm={() => { deleteCategory(delCat.id).then(() => { setDelCat(null); load() }).catch(e => { setErr(e.message); setDelCat(null) }) }}
        onCancel={() => setDelCat(null)} />
    </div>
  )
}
