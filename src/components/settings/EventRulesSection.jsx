import { useState, useEffect, useCallback, useRef } from 'react'
import { Modal } from '../ui'
import { timeFmt } from '../../lib/supabase'
import {
  EVENT_ENTITIES, EVENT_KINDS, CONDITION_OPS, EVENT_PLACEHOLDERS, EMPTY_EVENT_RULE, eventEntity,
  listEventRules, saveEventRule, deleteEventRule, setEventRuleEnabled, testEventRule, eventStatusValues, isValidEmail,
} from '../../lib/email'
import { Zap, Plus, Edit2, Trash2, Send, X } from 'lucide-react'

// Settings → Email → Event triggers (STEP233). "When a <record> is created /
// changes status / is updated [and conditions], email <people>." Row changes
// are captured by database triggers and turned into emails by the
// send-email worker within a minute. Wording supports {placeholders}.

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
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`
const human = s => String(s || '').replace(/_/g, ' ')

// Starting points for "New trigger" — every field stays editable.
const PRESETS = [
  { label: 'New task → assignee', rule: { name: 'Task assigned', entity: 'task', event: 'created', recipient_roles: ['assignee'] } },
  { label: 'Task closed → creator', rule: { name: 'Task completed', entity: 'task', event: 'status_changed', status_to: ['done', 'closed', 'completed'], recipient_roles: ['creator'] } },
  { label: 'Expense submitted → approver', rule: { name: 'Expense to approve', entity: 'expense', event: 'created', recipient_roles: ['approver'] } },
  { label: 'Leave decided → employee', rule: { name: 'Leave decision', entity: 'leave', event: 'status_changed', status_to: ['approved', 'rejected'], recipient_roles: ['requester'] } },
  { label: 'Urgent IT ticket → assignee', rule: { name: 'Urgent IT ticket', entity: 'it_ticket', event: 'created', conditions: [{ field: 'priority', op: 'in', value: 'urgent, critical, high' }], recipient_roles: ['assignee'] } },
  { label: 'Large purchase request → requester’s manager', rule: { name: 'Large purchase request', entity: 'purchase_request', event: 'created', conditions: [{ field: 'estimated_total', op: 'gte', value: '100000' }], recipient_roles: ['manager:requester'] } },
  { label: 'Deal won → rep and their manager', rule: { name: 'Opportunity won', entity: 'opportunity', event: 'status_changed', status_to: ['won'], recipient_roles: ['owner', 'manager:owner'] } },
]

export function ruleSentence(r) {
  const e = eventEntity(r.entity)
  const when = r.event === 'status_changed' && r.status_to?.length ? `changes status to ${r.status_to.map(human).join(' / ')}` : EVENT_KINDS[r.event]
  const cond = (r.conditions || []).map(c => `${human(c.field)} ${CONDITION_OPS[c.op] || c.op}${['is_empty', 'not_empty'].includes(c.op) ? '' : ` ${c.value}`}`).join(' and ')
  return `When a ${e.label.toLowerCase()} ${when}${cond ? `, if ${cond}` : ''}`
}
function recipientsText(r, groups, people) {
  const e = eventEntity(r.entity)
  const roleText = k => k.startsWith('manager:') ? `manager of ${(e.people[k.slice(8)] || k.slice(8)).toLowerCase()}` : (e.people[k] || k).toLowerCase()
  const parts = [
    ...(r.recipient_roles || []).map(roleText),
    ...(r.group_ids || []).map(id => groups.find(g => g.id === id)?.name || 'deleted group'),
    ...(r.people_ids || []).map(id => people.find(p => p.id === id)?.full_name || 'someone'),
    ...(r.extra_emails || []),
  ]
  return parts.length ? parts.join(', ') : 'nobody'
}

export default function EventRulesSection({ orgId, profile, people, groups = [], flash, onQueued, emailOn }) {
  const [rules, setRules] = useState([])
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try { setRules(await listEventRules(orgId)) } catch (e) { flash('danger', e.message) }
  }, [orgId])
  useEffect(() => { load() }, [load])

  async function test(r) {
    setBusy('t-' + r.id)
    try { const rec = await testEventRule(r.id); flash('success', `Test email for "${r.name}" queued to ${profile.email}, using ${rec}.`); onQueued?.() }
    catch (e) { flash('danger', e.message) } finally { setBusy('') }
  }
  async function toggle(r) {
    try { await setEventRuleEnabled(r.id, !r.enabled); setRules(xs => xs.map(x => x.id === r.id ? { ...x, enabled: !r.enabled } : x)) } catch (e) { flash('danger', e.message) }
  }
  async function remove(r) {
    if (!window.confirm(`Delete the trigger "${r.name}"?`)) return
    try { await deleteEventRule(r.id); setRules(xs => xs.filter(x => x.id !== r.id)) } catch (e) { flash('danger', e.message) }
  }
  const startNew = (patch = {}) => setEditing({ ...EMPTY_EVENT_RULE, ...patch, _new: true })

  return (
    <div style={S.section}>
      <div style={S.head}>
        <Zap size={16} style={{ color: '#94a3b8' }} />
        <div style={{ flex: 1 }}>
          <div style={S.title}>Event triggers</div>
          <div style={S.sub}>Email people the moment something happens: a record is created, changes status or is updated</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => startNew()}><Plus size={13} /> New trigger</button>
      </div>
      {!emailOn && <div style={{ padding: '10px 18px', background: '#fffbeb', borderBottom: '1px solid #fde68a', fontSize: 12.5, color: '#92400e' }}>Email is off for your organisation, so triggers won't send. Turn it on under Sending.</div>}
      {rules.length === 0 ? (
        <div style={{ padding: '26px 18px', textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>No triggers yet. Start from a template:</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', maxWidth: 760, margin: '0 auto' }}>
            {PRESETS.map(p => <button key={p.label} className="btn btn-outline btn-sm" onClick={() => startNew(p.rule)}>{p.label}</button>)}
          </div>
        </div>
      ) : (
        <table style={{ display: 'table', width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#fff' }}><tr>
            {['Trigger', 'Emails', 'Last fired', ''].map(h => <th key={h} style={{ textTransform: 'none', letterSpacing: 0, fontSize: 12, fontWeight: 600, color: '#94a3b8', borderBottom: '1px solid var(--border)' }}>{h}</th>)}
          </tr></thead>
          <tbody>{rules.map(r => (
            <tr key={r.id} style={{ opacity: r.enabled ? 1 : .55 }}>
              <td style={{ maxWidth: 360 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{ruleSentence(r)}</div>
              </td>
              <td style={{ fontSize: 12.5, maxWidth: 240 }}>{recipientsText(r, groups, people)}{r.skip_actor ? <div style={{ fontSize: 11.5, color: '#94a3b8' }}>not the person who made the change</div> : null}</td>
              <td style={{ fontSize: 12.5, color: '#64748b', whiteSpace: 'nowrap' }}>{r.last_fired_at ? <>{timeFmt(r.last_fired_at)}<div style={{ fontSize: 11.5 }}>{plural(r.fire_count, 'time')} so far</div></> : 'Never'}</td>
              <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                <label title={r.enabled ? 'On' : 'Off'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, marginRight: 8, cursor: 'pointer', color: r.enabled ? '#15803d' : '#94a3b8', fontWeight: 600 }}>
                  <input type="checkbox" checked={r.enabled} onChange={() => toggle(r)} style={{ accentColor: 'var(--c1)' }} />{r.enabled ? 'On' : 'Off'}
                </label>
                <button className="btn btn-ghost btn-sm btn-icon" title="Send me a test email" disabled={busy === 't-' + r.id || !emailOn} onClick={() => test(r)}><Send size={13} /></button>{' '}
                <button className="btn btn-ghost btn-sm btn-icon" title="Edit" onClick={() => setEditing({ ...r, subject: r.subject || '', message: r.message || '' })}><Edit2 size={13} /></button>{' '}
                <button className="btn btn-ghost btn-sm btn-icon" title="Delete" style={{ color: '#dc2626' }} onClick={() => remove(r)}><Trash2 size={13} /></button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {editing && <EventRuleModal value={editing} people={people} groups={groups}
        onClose={() => setEditing(null)}
        onSave={async r => { await saveEventRule(orgId, r, profile.id); setEditing(null); await load(); flash('success', `Trigger "${r.name}" saved. It applies to changes from now on.`) }} />}
    </div>
  )
}

function EventRuleModal({ value, people, groups, onClose, onSave }) {
  const [r, setR] = useState({ ...EMPTY_EVENT_RULE, ...value, extraText: (value.extra_emails || []).join(', ') })
  const [statuses, setStatuses] = useState([])
  const [statusText, setStatusText] = useState('')
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const focused = useRef('message')
  const subjectRef = useRef(null), messageRef = useRef(null)
  const set = patch => setR(x => ({ ...x, ...patch }))
  const toggleIn = (key, v) => set({ [key]: r[key].includes(v) ? r[key].filter(x => x !== v) : [...r[key], v] })
  const ent = eventEntity(r.entity)

  useEffect(() => { eventStatusValues(r.entity).then(setStatuses).catch(() => setStatuses([])) }, [r.entity])

  // Changing the record type drops people roles that type doesn't have.
  const pickEntity = key => {
    const e = eventEntity(key)
    const ok = k => !!e.people[k.startsWith('manager:') ? k.slice(8) : k]
    const kept = r.recipient_roles.filter(ok)
    set({ entity: key, status_to: [], recipient_roles: kept.length ? kept : [Object.keys(e.people)[0]] })
  }
  const addStatus = s => { const v = s.trim(); if (v && !r.status_to.map(x => x.toLowerCase()).includes(v.toLowerCase())) set({ status_to: [...r.status_to, v] }); setStatusText('') }
  const setCond = (i, patch) => set({ conditions: r.conditions.map((c, j) => j === i ? { ...c, ...patch } : c) })
  function insert(ph) {
    const key = focused.current, el = key === 'subject' ? subjectRef.current : messageRef.current
    const cur = r[key] || '', token = `{${ph}}`
    const at = el?.selectionStart ?? cur.length
    set({ [key]: cur.slice(0, at) + token + cur.slice(el?.selectionEnd ?? at) })
    setTimeout(() => { el?.focus(); el?.setSelectionRange(at + token.length, at + token.length) }, 0)
  }
  const shown = people.filter(p => p.email && (!q || `${p.full_name} ${p.email}`.toLowerCase().includes(q.toLowerCase())))

  async function submit(e) {
    e.preventDefault(); setErr('')
    const extra = r.extraText.split(/[,\s;]+/).map(x => x.trim()).filter(Boolean)
    const bad = extra.filter(x => !isValidEmail(x))
    if (!r.name.trim()) return setErr('Give the trigger a name')
    if (bad.length) return setErr(`Not a valid email: ${bad.join(', ')}`)
    if (!r.recipient_roles.length && !r.group_ids.length && !r.people_ids.length && !extra.length) return setErr('Choose who gets the email')
    if (r.conditions.some(c => !c.field?.trim() || (!['is_empty', 'not_empty'].includes(c.op) && !String(c.value ?? '').trim()))) return setErr('Complete or remove the empty condition')
    setSaving(true)
    try { await onSave({ ...r, extra_emails: extra }) } catch (e2) { setErr(e2.message); setSaving(false) }
  }

  const groupsByArea = EVENT_ENTITIES.reduce((m, x) => { (m[x.group] ||= []).push(x); return m }, {})

  return (
    <Modal open onClose={onClose} title={value.id ? `Edit trigger — ${value.name}` : 'New event trigger'} size="lg">
      <form onSubmit={submit}>
        {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="form-group">
          <label style={S.label}>Name</label>
          <input className="form-input" value={r.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Task assigned" />
        </div>

        <div style={S.group}>
          <div style={S.groupTitle}>When</div>
          <div className="form-row">
            <div className="form-group">
              <label style={S.label}>Record</label>
              <select className="form-select" value={r.entity} onChange={e => pickEntity(e.target.value)}>
                {Object.entries(groupsByArea).map(([g, xs]) => <optgroup key={g} label={g}>{xs.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>)}
              </select>
            </div>
            <div className="form-group">
              <label style={S.label}>Event</label>
              <select className="form-select" value={r.event} onChange={e => set({ event: e.target.value })}>
                {Object.entries(EVENT_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
          </div>
          {r.event === 'status_changed' && (
            <div className="form-group" style={{ marginBottom: 6 }}>
              <label style={S.label}>To status <span style={{ fontWeight: 400, color: '#94a3b8' }}>(none selected = any status change)</span></label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {[...new Set([...statuses, ...r.status_to])].map(s => pill(r.status_to.some(x => x.toLowerCase() === s.toLowerCase()), () => r.status_to.some(x => x.toLowerCase() === s.toLowerCase()) ? set({ status_to: r.status_to.filter(x => x.toLowerCase() !== s.toLowerCase()) }) : addStatus(s), human(s), s))}
                <input className="form-input" value={statusText} onChange={e => setStatusText(e.target.value)} placeholder="Other status…"
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addStatus(statusText) } }} onBlur={() => statusText && addStatus(statusText)} style={{ width: 150, height: 30 }} />
              </div>
              {statuses.length === 0 && <div style={S.hint}>No {ent.label.toLowerCase()} statuses recorded yet. Type the ones you want.</div>}
            </div>
          )}
          {r.event === 'updated' && <div style={S.hint}>Fires on every saved change to a {ent.label.toLowerCase()}, so add a condition or pick "changes status" to keep emails down.</div>}

          <div style={{ marginTop: 12 }}>
            <label style={S.label}>Only if <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional, all must match)</span></label>
            {r.conditions.map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <input className="form-input" list={`ev-fields-${r.entity}`} value={c.field} onChange={e => setCond(i, { field: e.target.value })} placeholder="field, e.g. priority" style={{ flex: 1.2 }} />
                <select className="form-select" value={c.op} onChange={e => setCond(i, { op: e.target.value })} style={{ flex: 1 }}>
                  {Object.entries(CONDITION_OPS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                {!['is_empty', 'not_empty'].includes(c.op) && <input className="form-input" value={c.value ?? ''} onChange={e => setCond(i, { value: e.target.value })} placeholder={c.op === 'in' ? 'high, urgent' : 'value'} style={{ flex: 1.2 }} />}
                <button type="button" className="btn btn-ghost btn-sm btn-icon" title="Remove" onClick={() => set({ conditions: r.conditions.filter((_, j) => j !== i) })}><X size={13} /></button>
              </div>
            ))}
            <datalist id={`ev-fields-${r.entity}`}>{['status', ...ent.fields].map(f => <option key={f} value={f} />)}</datalist>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => set({ conditions: [...r.conditions, { field: ent.fields[0] || 'status', op: 'equals', value: '' }] })}><Plus size={13} /> Add condition</button>
          </div>
        </div>

        <div style={S.group}>
          <div style={S.groupTitle}>Email</div>
          <label style={S.label}>People on the {ent.label.toLowerCase()}</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            {Object.entries(ent.people).map(([k, l]) => pill(r.recipient_roles.includes(k), () => toggleIn('recipient_roles', k), l, k))}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {Object.entries(ent.people).filter(([k]) => k !== 'manager').map(([k, l]) => pill(r.recipient_roles.includes('manager:' + k), () => toggleIn('recipient_roles', 'manager:' + k), `Manager of ${l.toLowerCase()}`, 'm' + k))}
          </div>
          {groups.length > 0 && (<>
            <label style={S.label}>Groups</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>{groups.map(g => pill(r.group_ids.includes(g.id), () => toggleIn('group_ids', g.id), `${g.name}${g.size != null ? ` · ${g.size}` : ''}`, g.id))}</div>
          </>)}
          <label style={S.label}>Specific people <span style={{ fontWeight: 400, color: '#94a3b8' }}>({r.people_ids.length} selected)</span></label>
          <input className="form-input" placeholder="Search people…" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 6 }} />
          <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12 }}>
            {shown.map(p => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={r.people_ids.includes(p.id)} onChange={() => toggleIn('people_ids', p.id)} style={{ accentColor: 'var(--c1)' }} />
                <span style={{ flex: 1 }}>{p.full_name}</span><span style={{ fontSize: 12, color: '#94a3b8', textTransform: 'capitalize' }}>{p.role?.replace(/_/g, ' ')}</span>
              </label>))}
          </div>
          <label style={S.label}>Outside email addresses</label>
          <input className="form-input" value={r.extraText} onChange={e => set({ extraText: e.target.value })} placeholder="client@company.com" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={r.skip_actor} onChange={e => set({ skip_actor: e.target.checked })} style={{ accentColor: 'var(--c1)' }} />
            Don't email the person who made the change
          </label>
        </div>

        <div style={S.group}>
          <div style={S.groupTitle}>Wording <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400, color: '#94a3b8' }}>(optional — leave blank for the standard email)</span></div>
          <div className="form-group">
            <label style={S.label}>Subject</label>
            <input ref={subjectRef} className="form-input" value={r.subject} onFocus={() => { focused.current = 'subject' }} onChange={e => set({ subject: e.target.value })}
              placeholder={`${ent.label} ${r.event === 'status_changed' ? 'moved to {status}' : r.event === 'created' ? 'was created' : 'was updated'}: {code} · {title}`} />
          </div>
          <div className="form-group" style={{ marginBottom: 8 }}>
            <label style={S.label}>Message</label>
            <textarea ref={messageRef} className="form-input" rows={4} value={r.message} onFocus={() => { focused.current = 'message' }} onChange={e => set({ message: e.target.value })}
              placeholder={'{actor} just ' + (r.event === 'status_changed' ? 'moved {title} from {old_status} to {status}.' : r.event === 'created' ? 'created {title}.' : 'updated {title}.')} style={{ resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#64748b', marginRight: 4 }}>Insert:</span>
            {[...EVENT_PLACEHOLDERS, ...ent.fields.filter(f => !['title', 'name'].includes(f))].map(ph => (
              <button key={ph} type="button" onClick={() => insert(ph)} style={{ height: 24, padding: '0 8px', borderRadius: 6, border: '1px solid var(--border)', background: '#f8fafc', fontSize: 11.5, fontFamily: 'Consolas, Menlo, monospace', color: '#475569', cursor: 'pointer' }}>{`{${ph}}`}</button>
            ))}
          </div>
          <div style={S.hint}>The email always includes a summary card (record, status, amount, due date, who changed it) and a button to open it.</div>
        </div>

        <div style={{ padding: '10px 14px', borderRadius: 8, background: '#f5f7ff', border: '1px solid #e0e7ff', fontSize: 12.5, color: '#3730a3', marginBottom: 14 }}>
          <b>{ruleSentence(r)}</b>, email {recipientsText({ ...r, extra_emails: r.extraText.split(/[,\s;]+/).filter(Boolean) }, groups, people)}.
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', flex: 1 }}>
            <input type="checkbox" checked={r.enabled} onChange={e => set({ enabled: e.target.checked })} style={{ accentColor: 'var(--c1)' }} /> Active
          </label>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save trigger'}</button>
        </div>
      </form>
    </Modal>
  )
}
