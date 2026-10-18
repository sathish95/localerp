import { useState, useMemo } from 'react'
import { Modal } from '../ui'
import { EMPTY_GROUP, saveEmailGroup, deleteEmailGroup, isValidEmail } from '../../lib/email'
import { Users, Plus, Edit2, Trash2 } from 'lucide-react'

// Settings → Email → Groups (STEP232). Reusable recipient lists for
// automatic alerts and scheduled reports. Members = chosen people + roles +
// departments + Teams + outside addresses, resolved at send time.

const S = {
  section: { border: '1px solid var(--border)', borderRadius: 10, marginBottom: 20, background: '#fff' },
  head: { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--border)' },
  title: { fontSize: 14, fontWeight: 600, color: 'var(--text)' },
  sub: { fontSize: 12.5, color: '#64748b', marginTop: 2 },
  label: { display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6 },
  hint: { fontSize: 12, color: '#94a3b8', marginTop: 4 },
  group: { border: '1px solid #eef2f6', borderRadius: 10, padding: '14px 16px', marginBottom: 14 },
}
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`
const pill = (on, onClick, label, key) => (
  <button key={key || label} type="button" onClick={onClick}
    style={{ height: 30, padding: '0 12px', borderRadius: 15, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
      border: `1px solid ${on ? '#a5b4fc' : 'var(--border)'}`, background: on ? '#eef2ff' : '#fff', color: on ? '#4338ca' : '#475569' }}>{label}</button>
)

// Who a group resolves to, computed in the browser for the live preview in the editor
// (the send-time source of truth is _group_profile_ids() in STEP232).
export function resolveGroup(g, people, teams) {
  const teamPeople = new Set()
  teams.filter(t => (g.team_ids || []).includes(t.id)).forEach(t => { if (t.lead_id) teamPeople.add(t.lead_id); (t.members || []).forEach(id => teamPeople.add(id)) })
  return people.filter(p => (g.member_ids || []).includes(p.id) || (g.role_keys || []).includes(p.role)
    || (g.department_ids || []).includes(p.department_id) || teamPeople.has(p.id))
}

export default function EmailGroupsSection({ orgId, profile, groups, people, departments, roles, teams, flash, onChanged }) {
  const [editing, setEditing] = useState(null)
  const summary = g => [
    g.member_ids.length && plural(g.member_ids.length, 'person', 'people'),
    g.role_keys.length && `roles: ${g.role_keys.map(k => roles.find(r => r.role_key === k)?.label || k).join(', ')}`,
    g.department_ids.length && `depts: ${g.department_ids.map(id => departments.find(d => d.id === id)?.name || '?').join(', ')}`,
    g.team_ids.length && `teams: ${g.team_ids.map(id => teams.find(t => t.id === id)?.name || '?').join(', ')}`,
    g.extra_emails.length && plural(g.extra_emails.length, 'outside address', 'outside addresses'),
  ].filter(Boolean).join(' · ')

  async function remove(g) {
    if (!window.confirm(`Delete the group "${g.name}"? Alerts and reports that use it will stop sending to its members.`)) return
    try { await deleteEmailGroup(g.id); onChanged() } catch (e) { flash('danger', e.message) }
  }

  return (
    <div style={S.section}>
      <div style={S.head}>
        <Users size={16} style={{ color: '#94a3b8' }} />
        <div style={{ flex: 1 }}>
          <div style={S.title}>Groups</div>
          <div style={S.sub}>Reusable recipient lists for alerts and scheduled reports</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...EMPTY_GROUP })}><Plus size={13} /> New group</button>
      </div>
      {groups.length === 0 ? (
        <div style={{ padding: '24px 18px', textAlign: 'center', fontSize: 13, color: '#94a3b8' }}>
          No groups yet. Create one (for example "Leadership", "HR team", "Field staff") and pick it in any alert or report.
        </div>
      ) : (
        <table style={{ display: 'table', width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#fff' }}><tr>
            {['Group', 'Made up of', 'Members', ''].map(h => <th key={h} style={{ textTransform: 'none', letterSpacing: 0, fontSize: 12, fontWeight: 600, color: '#94a3b8', borderBottom: '1px solid var(--border)' }}>{h}</th>)}
          </tr></thead>
          <tbody>{groups.map(g => (
            <tr key={g.id}>
              <td><div style={{ fontWeight: 600, fontSize: 13 }}>{g.name}</div>{g.description && <div style={{ fontSize: 12, color: '#64748b' }}>{g.description}</div>}</td>
              <td style={{ fontSize: 12.5, color: '#475569', maxWidth: 320 }}>{summary(g) || <span style={{ color: '#94a3b8' }}>Empty</span>}</td>
              <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}><b>{g.size ?? '—'}</b> {g.size === 1 ? 'person' : 'people'}{g.outside ? <span style={{ color: '#64748b' }}> + {g.outside} outside</span> : ''}</td>
              <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                <button className="btn btn-ghost btn-sm btn-icon" title="Edit" onClick={() => setEditing({ ...g })}><Edit2 size={13} /></button>{' '}
                <button className="btn btn-ghost btn-sm btn-icon" title="Delete" style={{ color: '#dc2626' }} onClick={() => remove(g)}><Trash2 size={13} /></button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {editing && <GroupModal value={editing} people={people} departments={departments} roles={roles} teams={teams}
        onClose={() => setEditing(null)}
        onSave={async g => { await saveEmailGroup(orgId, g, profile.id); setEditing(null); onChanged(); flash('success', `Group "${g.name}" saved`) }} />}
    </div>
  )
}

function GroupModal({ value, people, departments, roles, teams, onClose, onSave }) {
  const [g, setG] = useState({ ...EMPTY_GROUP, ...value, extraText: (value.extra_emails || []).join(', ') })
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const set = patch => setG(x => ({ ...x, ...patch }))
  const toggleIn = (key, v) => set({ [key]: g[key].includes(v) ? g[key].filter(x => x !== v) : [...g[key], v] })
  const resolved = useMemo(() => resolveGroup(g, people, teams), [g, people, teams])
  const shown = people.filter(p => !q || `${p.full_name} ${p.email || ''}`.toLowerCase().includes(q.toLowerCase()))

  async function submit(e) {
    e.preventDefault(); setErr('')
    const extra = g.extraText.split(/[,\s;]+/).map(x => x.trim()).filter(Boolean)
    const bad = extra.filter(x => !isValidEmail(x))
    if (!g.name.trim()) return setErr('Give the group a name')
    if (bad.length) return setErr(`Not a valid email: ${bad.join(', ')}`)
    if (!resolved.length && !extra.length) return setErr('Add at least one member (a person, role, department, team or outside address)')
    setSaving(true)
    try { await onSave({ ...g, extra_emails: extra }) } catch (e2) { setErr(e2.message); setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={value.id ? `Edit group — ${value.name}` : 'New group'} size="lg">
      <form onSubmit={submit}>
        {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="form-row">
          <div className="form-group"><label style={S.label}>Name</label><input className="form-input" value={g.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Leadership" /></div>
          <div className="form-group"><label style={S.label}>Description</label><input className="form-input" value={g.description || ''} onChange={e => set({ description: e.target.value })} placeholder="Optional" /></div>
        </div>

        <div style={S.group}>
          <label style={S.label}>Everyone with these roles</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{roles.map(r => pill(g.role_keys.includes(r.role_key), () => toggleIn('role_keys', r.role_key), r.label, r.role_key))}</div>
        </div>
        <div style={S.group}>
          <label style={S.label}>Everyone in these departments</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{departments.length ? departments.map(d => pill(g.department_ids.includes(d.id), () => toggleIn('department_ids', d.id), d.name, d.id)) : <span style={S.hint}>No departments yet.</span>}</div>
        </div>
        <div style={S.group}>
          <label style={S.label}>Members of these Teams <span style={{ fontWeight: 400, color: '#94a3b8' }}>(including the team lead)</span></label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{teams.length ? teams.map(t => pill(g.team_ids.includes(t.id), () => toggleIn('team_ids', t.id), t.name, t.id)) : <span style={S.hint}>No teams yet (Settings → Teams).</span>}</div>
        </div>
        <div style={S.group}>
          <label style={S.label}>Specific people <span style={{ fontWeight: 400, color: '#94a3b8' }}>({g.member_ids.length} selected)</span></label>
          <input className="form-input" placeholder="Search people…" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 6 }} />
          <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            {shown.map(p => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={g.member_ids.includes(p.id)} onChange={() => toggleIn('member_ids', p.id)} style={{ accentColor: 'var(--c1)' }} />
                <span style={{ flex: 1 }}>{p.full_name}</span>
                <span style={{ fontSize: 12, color: '#94a3b8', textTransform: 'capitalize' }}>{p.role?.replace(/_/g, ' ')}</span>
              </label>
            ))}
          </div>
        </div>
        <div style={S.group}>
          <label style={S.label}>Outside email addresses</label>
          <input className="form-input" value={g.extraText} onChange={e => set({ extraText: e.target.value })} placeholder="director@company.com, auditor@firm.com" />
          <div style={S.hint}>For people without a login. They receive reports and alert summaries sent to this group, not personal reminders.</div>
        </div>

        <div style={{ padding: '10px 14px', borderRadius: 8, background: '#f5f7ff', border: '1px solid #e0e7ff', fontSize: 12.5, color: '#3730a3', marginBottom: 14 }}>
          <b>{plural(resolved.length, 'person', 'people')}</b> in this group right now{resolved.length ? `: ${resolved.slice(0, 8).map(p => p.full_name).join(', ')}${resolved.length > 8 ? ` and ${resolved.length - 8} more` : ''}` : ''}.
          <span style={{ display: 'block', color: '#6366f1', marginTop: 2 }}>Worked out each time an email is sent, so new people in a chosen role, department or team are included automatically.</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save group'}</button>
        </div>
      </form>
    </Modal>
  )
}
