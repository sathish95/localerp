import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  listSlaPolicies, updateSlaPolicy, listAgents, addAgent, setAgentActive, removeAgent,
  listAssignmentRules, createAssignmentRule, setAssignmentRuleActive, deleteAssignmentRule,
  listSuperAdmins, getProjectTagConfig, setProjectTagEnabled, setProjectTagRoleVisibility, isProjectTagVisibleForRole,
  ROLE_KEYS, CATEGORIES, PRIORITIES,
} from '../lib/supportDesk'
import { Loader, Alert, Badge, Empty } from '../components/ui'
import { ArrowLeft, Plus, Trash2, UserPlus } from 'lucide-react'

const ROLE_LABELS = { admin: 'Admin', ceo: 'CEO', manager: 'Manager', department_head: 'Dept. Head', finance: 'Finance', hr: 'HR', employee: 'Employee' }

const CATEGORY_LABELS = { billing: 'Billing', technical: 'Technical', feature_request: 'Feature Request', account: 'Account', onboarding: 'Onboarding', general: 'General' }

function minutesToLabel(mins) {
  if (mins % 1440 === 0) return `${mins / 1440}d`
  if (mins % 60 === 0) return `${mins / 60}h`
  return `${mins}m`
}
function labelToMinutes(label, fallback) {
  const m = String(label).trim().match(/^(\d+)\s*(d|h|m)?$/i)
  if (!m) return fallback
  const n = Number(m[1])
  const unit = (m[2] || 'm').toLowerCase()
  return unit === 'd' ? n * 1440 : unit === 'h' ? n * 60 : n
}

export default function SupportDeskSettingsPage() {
  const { profile } = useAuth()
  const [policies, setPolicies] = useState([])
  const [agents, setAgents] = useState([])
  const [rules, setRules] = useState([])
  const [staff, setStaff] = useState([])
  const [projectTag, setProjectTag] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [addAgentId, setAddAgentId] = useState('')
  const [newRule, setNewRule] = useState({ category: '', priority: '', ruleType: 'least_loaded', assignedAgentId: '' })

  async function load() {
    try {
      const [p, a, r, s, pt] = await Promise.all([listSlaPolicies(), listAgents(), listAssignmentRules(), listSuperAdmins(), getProjectTagConfig()])
      setPolicies(p); setAgents(a); setRules(r); setStaff(s); setProjectTag(pt)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function handleToggleProjectTag() {
    try { await setProjectTagEnabled(!projectTag.enabled, profile?.id); await load() } catch (e) { setErr(e.message) }
  }

  async function handleToggleRoleVisibility(roleKey) {
    const currentlyVisible = isProjectTagVisibleForRole(projectTag, roleKey)
    try { await setProjectTagRoleVisibility(roleKey, !currentlyVisible); await load() } catch (e) { setErr(e.message) }
  }

  async function handlePolicyChange(policy, field, label) {
    const minutes = labelToMinutes(label, policy[field])
    try { await updateSlaPolicy(policy.id, { [field]: minutes }); await load() } catch (e) { setErr(e.message) }
  }

  async function handleAddAgent() {
    if (!addAgentId) return
    try { await addAgent(addAgentId); setAddAgentId(''); await load() } catch (e) { setErr(e.message) }
  }

  async function handleCreateRule() {
    try {
      await createAssignmentRule({ ...newRule, category: newRule.category || null, priority: newRule.priority || null, sortOrder: rules.length })
      setNewRule({ category: '', priority: '', ruleType: 'least_loaded', assignedAgentId: '' })
      await load()
    } catch (e) { setErr(e.message) }
  }

  if (loading) return <Loader />

  const nonAgentStaff = staff.filter(s => !agents.some(a => a.profile_id === s.id))

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to="/super-admin/support" style={{ fontSize: 13, color: 'var(--ink-muted)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, textDecoration: 'none' }}><ArrowLeft size={13} /> Support Desk</Link>
          <div className="page-title">SLA & Agents</div>
          <div className="page-subtitle">Configure response/resolution targets, who works tickets, and how they get assigned</div>
        </div>
      </div>

      {err && <Alert type="error" message={err} />}

      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontWeight: 800, marginBottom: 4 }}>SLA Policies</h3>
        <p style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginBottom: 14 }}>Format: number + d/h/m (e.g. "2h", "1d", "30m")</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {policies.map(p => (
            <div key={p.id} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ width: 70, fontWeight: 700, fontSize: 13, textTransform: 'capitalize' }}>{p.priority}</span>
              <label style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>First response</label>
              <input className="form-input" style={{ width: 70 }} defaultValue={minutesToLabel(p.first_response_minutes)}
                onBlur={e => handlePolicyChange(p, 'first_response_minutes', e.target.value)} />
              <label style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>Resolution</label>
              <input className="form-input" style={{ width: 70 }} defaultValue={minutesToLabel(p.resolution_minutes)}
                onBlur={e => handlePolicyChange(p, 'resolution_minutes', e.target.value)} />
            </div>
          ))}
        </div>
      </div>

      {projectTag && (
        <div className="card" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: projectTag.enabled ? 16 : 4 }}>
            <div>
              <h3 style={{ fontWeight: 800, marginBottom: 4 }}>Tag Tickets with a Project</h3>
              <p style={{ fontSize: 12.5, color: 'var(--ink-muted)', margin: 0 }}>Lets employees optionally link a ticket to one of their org's projects when raising it.</p>
            </div>
            <button className={`btn btn-sm ${projectTag.enabled ? 'btn-primary' : 'btn-ghost'}`} onClick={handleToggleProjectTag}>
              {projectTag.enabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
          {projectTag.enabled && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Visible to these roles</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {ROLE_KEYS.map(role => {
                  const visible = isProjectTagVisibleForRole(projectTag, role)
                  return (
                    <button key={role} className={`btn btn-sm ${visible ? 'btn-primary' : 'btn-ghost'}`} onClick={() => handleToggleRoleVisibility(role)}>
                      {ROLE_LABELS[role] || role}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontWeight: 800, marginBottom: 14 }}>Support Agents</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <select className="form-input" style={{ flex: 1 }} value={addAgentId} onChange={e => setAddAgentId(e.target.value)}>
            <option value="">Select a platform account…</option>
            {nonAgentStaff.map(s => <option key={s.id} value={s.id}>{s.full_name} ({s.email})</option>)}
          </select>
          <button className="btn btn-primary btn-sm" disabled={!addAgentId} onClick={handleAddAgent}><UserPlus size={13} /> Add Agent</button>
        </div>
        {agents.length === 0 ? <Empty title="No agents yet" desc="Add a platform account above so tickets have someone to route to." /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {agents.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8 }}>
                <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{a.full_name}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{a.email}</span>
                <Badge type={a.is_active ? 'success' : 'info'}>{a.is_active ? 'Active' : 'Inactive'}</Badge>
                <button className="btn btn-ghost btn-sm" onClick={() => setAgentActive(a.id, !a.is_active).then(load)}>{a.is_active ? 'Deactivate' : 'Activate'}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => removeAgent(a.id).then(load)}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ fontWeight: 800, marginBottom: 14 }}>Assignment Rules</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--ink-muted)', display: 'block', marginBottom: 4 }}>Category</label>
            <select className="form-input" style={{ width: 140 }} value={newRule.category} onChange={e => setNewRule(r => ({ ...r, category: e.target.value }))}>
              <option value="">Any</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--ink-muted)', display: 'block', marginBottom: 4 }}>Priority</label>
            <select className="form-input" style={{ width: 110 }} value={newRule.priority} onChange={e => setNewRule(r => ({ ...r, priority: e.target.value }))}>
              <option value="">Any</option>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--ink-muted)', display: 'block', marginBottom: 4 }}>Rule</label>
            <select className="form-input" style={{ width: 150 }} value={newRule.ruleType} onChange={e => setNewRule(r => ({ ...r, ruleType: e.target.value }))}>
              <option value="least_loaded">Least-loaded agent</option>
              <option value="manual_default">Always this agent</option>
            </select>
          </div>
          {newRule.ruleType === 'manual_default' && (
            <div>
              <label style={{ fontSize: 11, color: 'var(--ink-muted)', display: 'block', marginBottom: 4 }}>Agent</label>
              <select className="form-input" style={{ width: 160 }} value={newRule.assignedAgentId} onChange={e => setNewRule(r => ({ ...r, assignedAgentId: e.target.value }))}>
                <option value="">Select…</option>
                {agents.map(a => <option key={a.profile_id} value={a.profile_id}>{a.full_name}</option>)}
              </select>
            </div>
          )}
          <button className="btn btn-primary btn-sm" onClick={handleCreateRule}><Plus size={13} /> Add Rule</button>
        </div>
        {rules.length === 0 ? <Empty title="No rules — every new ticket goes to the least-loaded active agent" /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rules.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }}>
                <span className="badge">{r.category ? CATEGORY_LABELS[r.category] : 'Any category'}</span>
                <span className="badge">{r.priority || 'Any priority'}</span>
                <span style={{ flex: 1, color: 'var(--ink-muted)' }}>{r.rule_type === 'manual_default' ? `Always → ${r.agent_name || 'Unknown'}` : 'Least-loaded agent'}</span>
                <Badge type={r.is_active ? 'success' : 'info'}>{r.is_active ? 'Active' : 'Inactive'}</Badge>
                <button className="btn btn-ghost btn-sm" onClick={() => setAssignmentRuleActive(r.id, !r.is_active).then(load)}>{r.is_active ? 'Disable' : 'Enable'}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => deleteAssignmentRule(r.id).then(load)}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
