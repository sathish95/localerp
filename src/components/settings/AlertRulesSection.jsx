import { useState, useEffect, useCallback } from 'react'
import { Modal } from '../ui'
import { listRoles } from '../../lib/roles'
import {
  ALERT_TYPES, ALERT_PRESETS, EMPTY_ALERT, listAlertRules, saveAlertRule, deleteAlertRule, setAlertRuleEnabled, sendAlertPreview,
} from '../../lib/email'
import { AlarmClock, Plus, Edit2, Trash2, Eye, Users, UserCheck, Building2, Shield, User } from 'lucide-react'

// Settings → Email → Automatic alerts (STEP231). Any number of rules, each
// with its own time, days, audience, delivery, filters and wording. The
// send-email worker runs them; this screen only edits email_alert_rules.

const DAYS = [['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6], ['Sun', 0]]
const PRIORITIES = ['critical', 'urgent', 'high', 'medium', 'low']
const t12 = hhmm => { const [h, m] = String(hhmm || '10:30').split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) }
const daysText = ds => {
  const set = new Set(ds || [])
  if (set.size === 7) return 'every day'
  if (set.size === 5 && [1, 2, 3, 4, 5].every(d => set.has(d))) return 'weekdays'
  return DAYS.filter(([, d]) => set.has(d)).map(([l]) => l).join(', ') || 'no days'
}

const S = {
  section: { border: '1px solid var(--border)', borderRadius: 10, marginBottom: 20, background: '#fff' },
  head: { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--border)' },
  title: { fontSize: 14, fontWeight: 600, color: 'var(--text)' },
  sub: { fontSize: 12.5, color: '#64748b', marginTop: 2 },
  label: { display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6 },
  hint: { fontSize: 12, color: '#94a3b8', marginTop: 4 },
  group: { border: '1px solid #eef2f6', borderRadius: 10, padding: '14px 16px', marginBottom: 14 },
  groupTitle: { fontSize: 11.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 },
}
const pill = (on, onClick, label, key) => (
  <button key={key || label} type="button" onClick={onClick}
    style={{ height: 30, padding: '0 12px', borderRadius: 15, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
      border: `1px solid ${on ? '#a5b4fc' : 'var(--border)'}`, background: on ? '#eef2ff' : '#fff', color: on ? '#4338ca' : '#475569' }}>{label}</button>
)

export default function AlertRulesSection({ orgId, profile, people, departments, groups = [], flash, onQueued, emailOn }) {
  const [rules, setRules] = useState([])
  const [roles, setRoles] = useState([])
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try { setRules(await listAlertRules(orgId)) } catch (e) { flash('danger', e.message) }
  }, [orgId])
  useEffect(() => { load(); listRoles().then(setRoles).catch(() => setRoles([])) }, [load])

  const nameOf = id => people.find(p => p.id === id)?.full_name || 'Unknown'
  const gName = id => groups.find(g => g.id === id)?.name || 'deleted group'
  const audienceText = r => {
    const ex = r.exclude_ids?.length ? ` · excl. ${r.exclude_ids.length}` : ''
    if (r.audience_mode === 'departments') return `${r.department_ids.map(id => departments.find(d => d.id === id)?.name || '?').join(', ') || 'no departments'}${ex}`
    if (r.audience_mode === 'roles') return `${r.roles.map(k => roles.find(x => x.role_key === k)?.label || k).join(', ') || 'no roles'}${ex}`
    if (r.audience_mode === 'people') return `${plural(r.people_ids.length, 'person', 'people')}${ex}`
    if (r.audience_mode === 'groups') return `${(r.group_ids || []).map(gName).join(', ') || 'no groups'}${ex}`
    return `Everyone${ex}`
  }
  const deliveryText = r => [r.send_to_person && 'each person', r.send_to_manager && 'their manager', (r.summary_to_ids?.length || r.summary_group_ids?.length) && `summary to ${[...(r.summary_to_ids || []).map(nameOf), ...(r.summary_group_ids || []).map(gName)].join(', ')}`].filter(Boolean).join(' · ') || 'nobody'

  async function preview(r) {
    setBusy('p-' + r.id)
    try {
      const n = await sendAlertPreview(r.id)
      flash(n ? 'success' : 'info', n ? `${plural(n, 'sample email')} from "${r.name}" queued to ${profile.email}.` : `"${r.name}" has nobody to email right now (everyone has checked in / nothing is overdue).`)
      if (n) onQueued?.()
    } catch (e) { flash('danger', e.message) } finally { setBusy('') }
  }
  async function toggle(r) {
    try { await setAlertRuleEnabled(r.id, !r.enabled); setRules(xs => xs.map(x => x.id === r.id ? { ...x, enabled: !r.enabled } : x)) } catch (e) { flash('danger', e.message) }
  }
  async function remove(r) {
    if (!window.confirm(`Delete the alert "${r.name}"?`)) return
    try { await deleteAlertRule(r.id); setRules(xs => xs.filter(x => x.id !== r.id)) } catch (e) { flash('danger', e.message) }
  }

  return (
    <div style={S.section}>
      <div style={S.head}>
        <AlarmClock size={16} style={{ color: '#94a3b8' }} />
        <div style={{ flex: 1 }}>
          <div style={S.title}>Automatic alerts</div>
          <div style={S.sub}>Rules that email people automatically: missed check-ins, overdue work</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...EMPTY_ALERT, _new: true })}><Plus size={13} /> New alert</button>
      </div>
      {!emailOn && <div style={{ padding: '10px 18px', background: '#fffbeb', borderBottom: '1px solid #fde68a', fontSize: 12.5, color: '#92400e' }}>Email is off for your organisation, so no alerts will be sent. Turn it on under Sending.</div>}
      {rules.length === 0 ? (
        <div style={{ padding: '26px 18px', textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>No alerts yet. Start from a template:</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            {ALERT_PRESETS.map(p => <button key={p.key} className="btn btn-outline btn-sm" onClick={() => setEditing({ ...EMPTY_ALERT, ...p.rule, _new: true })}>{p.label}</button>)}
          </div>
        </div>
      ) : (
        <table style={{ display: 'table', width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#fff' }}><tr>
            {['Alert', 'When', 'Covers', 'Emails', ''].map(h => <th key={h} style={{ textTransform: 'none', letterSpacing: 0, fontSize: 12, fontWeight: 600, color: '#94a3b8', borderBottom: '1px solid var(--border)' }}>{h}</th>)}
          </tr></thead>
          <tbody>{rules.map(r => (
            <tr key={r.id} style={{ opacity: r.enabled ? 1 : .55 }}>
              <td>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{ALERT_TYPES[r.alert_type]?.label}{r.alert_type === 'overdue_work' && r.min_days_overdue > 1 ? ` · ${r.min_days_overdue}+ days` : ''}</div>
              </td>
              <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{t12(r.send_time)}<div style={{ fontSize: 12, color: '#64748b' }}>{daysText(r.days_of_week)}{r.skip_holidays ? ', not holidays' : ''}</div></td>
              <td style={{ fontSize: 12.5, maxWidth: 200 }}>{audienceText(r)}</td>
              <td style={{ fontSize: 12.5, maxWidth: 220 }}>{deliveryText(r)}</td>
              <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                <label title={r.enabled ? 'On' : 'Off'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, marginRight: 8, cursor: 'pointer', color: r.enabled ? '#15803d' : '#94a3b8', fontWeight: 600 }}>
                  <input type="checkbox" checked={r.enabled} onChange={() => toggle(r)} style={{ accentColor: 'var(--c1)' }} />{r.enabled ? 'On' : 'Off'}
                </label>
                <button className="btn btn-ghost btn-sm btn-icon" title="Send me a preview now" disabled={busy === 'p-' + r.id || !emailOn} onClick={() => preview(r)}><Eye size={13} /></button>{' '}
                <button className="btn btn-ghost btn-sm btn-icon" title="Edit" onClick={() => setEditing({ ...r, send_time: String(r.send_time).slice(0, 5), custom_subject: r.custom_subject || '', custom_message: r.custom_message || '' })}><Edit2 size={13} /></button>{' '}
                <button className="btn btn-ghost btn-sm btn-icon" title="Delete" style={{ color: '#dc2626' }} onClick={() => remove(r)}><Trash2 size={13} /></button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {editing && <AlertRuleModal value={editing} people={people} departments={departments} roles={roles} groups={groups}
        onClose={() => setEditing(null)}
        onSave={async r => { await saveAlertRule(orgId, r, profile.id); setEditing(null); await load(); flash('success', `Alert "${r.name}" saved`) }} />}
    </div>
  )
}

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`

function PeoplePicker({ people, selected, onChange, placeholder = 'Search people…', height = 170 }) {
  const [q, setQ] = useState('')
  const shown = people.filter(p => !q || `${p.full_name} ${p.email || ''}`.toLowerCase().includes(q.toLowerCase()))
  const toggle = id => onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  return (
    <div>
      <input className="form-input" placeholder={placeholder} value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 6 }} />
      <div style={{ maxHeight: height, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        {shown.map(p => (
          <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} style={{ accentColor: 'var(--c1)' }} />
            <span style={{ flex: 1 }}>{p.full_name}</span>
            <span style={{ fontSize: 12, color: '#94a3b8', textTransform: 'capitalize' }}>{p.role?.replace(/_/g, ' ')}</span>
          </label>
        ))}
        {shown.length === 0 && <div style={{ padding: 10, fontSize: 12.5, color: '#94a3b8' }}>No one matches</div>}
      </div>
      <div style={S.hint}>{selected.length} selected</div>
    </div>
  )
}

function AlertRuleModal({ value, people, departments, roles, groups, onClose, onSave }) {
  const [r, setR] = useState({ ...EMPTY_ALERT, ...value, group_ids: value.group_ids || [], summary_group_ids: value.summary_group_ids || [] })
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const set = patch => setR(x => ({ ...x, ...patch }))
  const toggleIn = (key, v) => set({ [key]: r[key].includes(v) ? r[key].filter(x => x !== v) : [...r[key], v] })
  const isCheckin = r.alert_type === 'checkin_missing'

  async function submit(e) {
    e.preventDefault(); setErr('')
    if (!r.name.trim()) return setErr('Give the alert a name')
    if (!r.days_of_week.length) return setErr('Pick at least one day')
    if (!r.send_to_person && !r.send_to_manager && !r.summary_to_ids.length && !r.summary_group_ids.length) return setErr('Choose who gets the email (the person, their manager, or a summary recipient)')
    if (r.audience_mode === 'departments' && !r.department_ids.length) return setErr('Pick at least one department')
    if (r.audience_mode === 'roles' && !r.roles.length) return setErr('Pick at least one role')
    if (r.audience_mode === 'people' && !r.people_ids.length) return setErr('Pick at least one person')
    if (r.audience_mode === 'groups' && !r.group_ids.length) return setErr('Pick at least one group')
    if (!isCheckin && !r.include_tasks && !r.include_it && !r.include_support) return setErr('Include at least one kind of work')
    setSaving(true)
    try { await onSave(r) } catch (e2) { setErr(e2.message); setSaving(false) }
  }

  const AUD = [['all', 'Everyone', Users], ['groups', 'Groups', Users], ['departments', 'Departments', Building2], ['roles', 'Roles', Shield], ['people', 'Specific people', User]]
  const groupPill = (key, g) => pill(r[key].includes(g.id), () => toggleIn(key, g.id), `${g.name}${g.size != null ? ` · ${g.size}` : ''}`, key + g.id)
  return (
    <Modal open onClose={onClose} title={value.id ? 'Edit alert' : 'New alert'} size="lg">
      <form onSubmit={submit}>
        {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}

        {value._new && (
          <div style={{ marginBottom: 14 }}>
            <div style={S.label}>Start from</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ALERT_PRESETS.map(p => pill(false, () => setR({ ...EMPTY_ALERT, ...p.rule, _new: true }), p.label, p.key))}
            </div>
          </div>
        )}

        <div style={S.group}>
          <div style={S.groupTitle}>Alert</div>
          <div className="form-row">
            <div className="form-group">
              <label style={S.label}>Type</label>
              <select className="form-select" value={r.alert_type} onChange={e => set({ alert_type: e.target.value })}>
                {Object.entries(ALERT_TYPES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
              </select>
              <div style={S.hint}>{ALERT_TYPES[r.alert_type].desc}</div>
            </div>
            <div className="form-group">
              <label style={S.label}>Name</label>
              <input className="form-input" value={r.name} onChange={e => set({ name: e.target.value })} placeholder={isCheckin ? 'Check-in reminder' : 'Daily overdue list'} />
            </div>
          </div>
        </div>

        <div style={S.group}>
          <div style={S.groupTitle}>When</div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={S.label}>{isCheckin ? 'Not checked in by' : 'Send at'}</label>
              <input type="time" className="form-input" style={{ width: 130 }} required value={r.send_time} onChange={e => set({ send_time: e.target.value || '10:30' })} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.label}>Days</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{DAYS.map(([l, d]) => pill(r.days_of_week.includes(d), () => toggleIn('days_of_week', d), l))}</div>
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={r.skip_holidays} onChange={e => set({ skip_holidays: e.target.checked })} style={{ accentColor: 'var(--c1)' }} /> Skip company holidays
          </label>
        </div>

        <div style={S.group}>
          <div style={S.groupTitle}>Who it covers</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {AUD.map(([k, l, Icon]) => (
              <button key={k} type="button" onClick={() => set({ audience_mode: k })}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  border: `1px solid ${r.audience_mode === k ? '#a5b4fc' : 'var(--border)'}`, background: r.audience_mode === k ? '#eef2ff' : '#fff', color: r.audience_mode === k ? '#4338ca' : '#475569' }}>
                <Icon size={13} /> {l}
              </button>
            ))}
          </div>
          {r.audience_mode === 'departments' && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{departments.map(d => pill(r.department_ids.includes(d.id), () => toggleIn('department_ids', d.id), d.name, d.id))}</div>}
          {r.audience_mode === 'roles' && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{roles.map(x => pill(r.roles.includes(x.role_key), () => toggleIn('roles', x.role_key), x.label, x.role_key))}</div>}
          {r.audience_mode === 'people' && <PeoplePicker people={people} selected={r.people_ids} onChange={v => set({ people_ids: v })} />}
          {r.audience_mode === 'groups' && (groups.length
            ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{groups.map(g => groupPill('group_ids', g))}</div>
            : <div style={S.hint}>No groups yet. Create one under Groups on this page.</div>)}
          <details style={{ marginTop: 12 }} open={r.exclude_ids.length > 0}>
            <summary style={{ fontSize: 12.5, fontWeight: 600, color: '#475569', cursor: 'pointer' }}>Exclude people ({r.exclude_ids.length})</summary>
            <div style={{ marginTop: 8 }}><PeoplePicker people={people} selected={r.exclude_ids} onChange={v => set({ exclude_ids: v })} placeholder="Search people to exclude…" height={140} /></div>
          </details>
          {isCheckin && <div style={S.hint}>Automatically skipped: people on approved leave, on a shift that starts later, vendor logins, and anyone already checked in.</div>}
        </div>

        {!isCheckin && (
          <div style={S.group}>
            <div style={S.groupTitle}>What counts as overdue</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {pill(r.include_tasks, () => set({ include_tasks: !r.include_tasks }), 'Tasks')}
              {pill(r.include_it, () => set({ include_it: !r.include_it }), 'IT tickets')}
              {pill(r.include_support, () => set({ include_support: !r.include_support }), 'Support tickets')}
            </div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <label style={S.label}>At least</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="number" min={1} max={365} className="form-input" style={{ width: 80 }} value={r.min_days_overdue} onChange={e => set({ min_days_overdue: e.target.value })} />
                  <span style={{ fontSize: 13, color: '#475569' }}>day(s) overdue</span>
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <label style={S.label}>Priorities <span style={{ fontWeight: 400, color: '#94a3b8' }}>(none selected = all)</span></label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{PRIORITIES.map(p => pill(r.priorities.includes(p), () => toggleIn('priorities', p), p.charAt(0).toUpperCase() + p.slice(1)))}</div>
              </div>
            </div>
          </div>
        )}

        <div style={S.group}>
          <div style={S.groupTitle}>Who gets emailed</div>
          <label style={{ display: 'flex', gap: 10, fontSize: 13, marginBottom: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={r.send_to_person} onChange={e => set({ send_to_person: e.target.checked })} style={{ accentColor: 'var(--c1)', marginTop: 2 }} />
            <span><b>Each person</b><span style={{ display: 'block', fontSize: 12, color: '#64748b' }}>{isCheckin ? 'A reminder to check in' : 'Their own list of overdue items'}</span></span>
          </label>
          <label style={{ display: 'flex', gap: 10, fontSize: 13, marginBottom: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={r.send_to_manager} onChange={e => set({ send_to_manager: e.target.checked })} style={{ accentColor: 'var(--c1)', marginTop: 2 }} />
            <span><b>Their manager</b><span style={{ display: 'block', fontSize: 12, color: '#64748b' }}>One list per manager of their own people (Reporting manager on the Users page)</span></span>
          </label>
          <div style={{ display: 'flex', gap: 10, fontSize: 13, alignItems: 'flex-start' }}>
            <UserCheck size={15} style={{ color: '#64748b', marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <b>Summary to</b><span style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 6 }}>These people or groups get one organisation-wide list (for example HR or the CEO). Groups can include outside addresses.</span>
              {groups.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>{groups.map(g => groupPill('summary_group_ids', g))}</div>}
              <PeoplePicker people={people} selected={r.summary_to_ids} onChange={v => set({ summary_to_ids: v })} height={130} />
            </div>
          </div>
        </div>

        <div style={S.group}>
          <div style={S.groupTitle}>Wording (optional)</div>
          <div className="form-group">
            <label style={S.label}>Subject</label>
            <input className="form-input" value={r.custom_subject} onChange={e => set({ custom_subject: e.target.value })}
              placeholder={isCheckin ? "Reminder: you haven't checked in today ({date})" : 'You have {count} overdue items'} />
            <div style={S.hint}>Leave blank for the default. You can use {'{name}'}, {'{date}'}, {'{time}'}, {'{count}'}{isCheckin ? '' : ', {oldest}'}.</div>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={S.label}>Message</label>
            <textarea className="form-input" rows={3} value={r.custom_message} onChange={e => set({ custom_message: e.target.value })}
              placeholder={isCheckin ? 'e.g. Please check in by 10:30 every working day. Contact HR if you are working remotely.' : 'e.g. Please update these before the 11:00 stand-up.'} />
            <div style={S.hint}>Shown at the top of the email, above the standard content.</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginRight: 'auto' }}>
            <input type="checkbox" checked={r.enabled} onChange={e => set({ enabled: e.target.checked })} style={{ accentColor: 'var(--c1)' }} /> Active
          </label>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save alert'}</button>
        </div>
      </form>
    </Modal>
  )
}
