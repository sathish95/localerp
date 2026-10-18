import { useState, useEffect, useCallback, useMemo } from 'react'
import { Modal } from '../ui'
import { dateFmt, timeFmt } from '../../lib/supabase'
import {
  ANNOUNCEMENT_KINDS, EMPTY_ANNOUNCEMENT, listAnnouncements, saveAnnouncement, cancelAnnouncement, deleteAnnouncement,
  announcementAudienceCount, previewAnnouncement,
} from '../../lib/email'
import { resolveGroup } from './EmailGroupsSection'
import { Megaphone, Plus, Edit2, Trash2, Eye, Ban, Wrench, Sparkles, Bell, X } from 'lucide-react'

// Announcement emails (STEP233): maintenance windows, product updates and
// general notices. Used in two places:
//   Settings → Email            orgId = the admin's organisation, audience = its people
//   Super Admin → Announcements orgId = null (platform-wide), audience = organisations + roles
// Email only — nothing is shown in-app. The send-email worker delivers.

const KIND_ICON = { maintenance: Wrench, update: Sparkles, general: Bell }
const IMPACTS = ['App unavailable', 'Read-only (no saving)', 'Some features unavailable', 'Slower than usual', 'Brief interruptions']
const REMINDERS = [[null, 'No reminder'], [15, '15 minutes before'], [30, '30 minutes before'], [60, '1 hour before'], [120, '2 hours before'], [1440, '1 day before']]

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
// <input type="datetime-local"> works in the browser's local time.
const toLocalInput = iso => { if (!iso) return ''; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
const whenText = iso => `${dateFmt(iso)}, ${new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`

function StatusText({ a }) {
  if (a.status === 'sent') return <span style={{ color: '#15803d', fontWeight: 600 }}>Sent{a.recipient_count != null ? ` to ${plural(a.recipient_count, 'person', 'people')}` : ''}<div style={{ fontSize: 12, color: '#64748b', fontWeight: 400 }}>{timeFmt(a.sent_at)}{a.reminder_sent_at ? ' · reminder sent' : a.remind_before_minutes ? ' · reminder pending' : ''}</div></span>
  if (a.status === 'scheduled') return <span style={{ color: '#92400e', fontWeight: 600 }}>Scheduled<div style={{ fontSize: 12, color: '#64748b', fontWeight: 400 }}>{a.send_at ? whenText(a.send_at) : 'Sending now'}</div></span>
  if (a.status === 'cancelled') return <span style={{ color: '#94a3b8', fontWeight: 600 }}>Cancelled</span>
  return <span style={{ color: '#64748b', fontWeight: 600 }}>Draft</span>
}

export default function AnnouncementsSection({ orgId = null, profile, people = [], departments = [], roles = [], groups = [], teams = [], orgs = [], flash, onQueued, emailOn = true }) {
  const platform = !orgId
  const [items, setItems] = useState([])
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try { setItems(await listAnnouncements(orgId)) } catch (e) { flash('danger', e.message) }
  }, [orgId])
  useEffect(() => { load() }, [load])

  const audienceText = a => {
    if (platform) {
      const o = a.org_ids?.length ? a.org_ids.map(id => orgs.find(x => x.id === id)?.name || '?').join(', ') : 'All organisations'
      return a.roles?.length ? `${o} · ${a.roles.map(r => r.replace(/_/g, ' ')).join(', ')}` : o
    }
    if (a.audience_mode === 'roles') return a.roles.map(k => roles.find(r => r.role_key === k)?.label || k).join(', ')
    if (a.audience_mode === 'departments') return a.department_ids.map(id => departments.find(d => d.id === id)?.name || '?').join(', ')
    if (a.audience_mode === 'groups') return a.group_ids.map(id => groups.find(g => g.id === id)?.name || 'deleted group').join(', ')
    if (a.audience_mode === 'people') return plural(a.people_ids.length, 'person', 'people')
    return 'Everyone'
  }

  async function preview(a) {
    setBusy('p-' + a.id)
    try { await previewAnnouncement(a.id); flash('success', `Preview of "${a.title}" queued to ${profile.email}.`); onQueued?.() }
    catch (e) { flash('danger', e.message) } finally { setBusy('') }
  }
  async function cancel(a) {
    if (!window.confirm(a.status === 'sent' ? `Cancel the pending reminder for "${a.title}"?` : `Cancel "${a.title}"? It won't be sent.`)) return
    try { await cancelAnnouncement(a.id, a.status === 'sent'); await load() } catch (e) { flash('danger', e.message) }
  }
  async function remove(a) {
    if (!window.confirm(`Delete "${a.title}"?`)) return
    try { await deleteAnnouncement(a.id); setItems(x => x.filter(y => y.id !== a.id)) } catch (e) { flash('danger', e.message) }
  }
  const edit = a => setEditing({ ...EMPTY_ANNOUNCEMENT, ...a, message: a.message || '', impact: a.impact || '', version: a.version || '', cta_label: a.cta_label || '', cta_url: a.cta_url || '',
    starts_at: toLocalInput(a.starts_at), ends_at: toLocalInput(a.ends_at), send_at: toLocalInput(a.send_at), send_mode: a.send_at ? 'later' : 'now' })

  return (
    <div style={S.section}>
      <div style={S.head}>
        <Megaphone size={16} style={{ color: '#94a3b8' }} />
        <div style={{ flex: 1 }}>
          <div style={S.title}>{platform ? 'Platform announcements' : 'Announcements'}</div>
          <div style={S.sub}>{platform ? 'Maintenance notices and product updates emailed to every organisation (or the ones you pick)' : 'Maintenance notices, updates and general announcements emailed to your team'}</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...EMPTY_ANNOUNCEMENT })}><Plus size={13} /> New announcement</button>
      </div>
      {!emailOn && <div style={{ padding: '10px 18px', background: '#fffbeb', borderBottom: '1px solid #fde68a', fontSize: 12.5, color: '#92400e' }}>Email is off for your organisation, so announcements won't be sent. Turn it on under Sending.</div>}
      {items.length === 0 ? (
        <div style={{ padding: '26px 18px', textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>Nothing sent yet. Start one:</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            {Object.entries(ANNOUNCEMENT_KINDS).map(([k, v]) => { const I = KIND_ICON[k]; return <button key={k} className="btn btn-outline btn-sm" onClick={() => setEditing({ ...EMPTY_ANNOUNCEMENT, kind: k })}><I size={13} /> {v.label}</button> })}
          </div>
        </div>
      ) : (
        <table style={{ display: 'table', width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#fff' }}><tr>
            {['Announcement', 'To', 'Status', ''].map(h => <th key={h} style={{ textTransform: 'none', letterSpacing: 0, fontSize: 12, fontWeight: 600, color: '#94a3b8', borderBottom: '1px solid var(--border)' }}>{h}</th>)}
          </tr></thead>
          <tbody>{items.map(a => { const K = ANNOUNCEMENT_KINDS[a.kind] || ANNOUNCEMENT_KINDS.general; const I = KIND_ICON[a.kind] || Bell; return (
            <tr key={a.id} style={{ opacity: a.status === 'cancelled' ? .55 : 1 }}>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 26, height: 26, borderRadius: 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', border: '1px solid var(--border)', color: K.color, flexShrink: 0 }}><I size={13} /></span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{a.title}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{K.label}{a.kind === 'maintenance' && a.starts_at ? ` · ${whenText(a.starts_at)}` : ''}{a.kind === 'update' && a.version ? ` · v${a.version}` : ''}</div>
                  </div>
                </div>
              </td>
              <td style={{ fontSize: 12.5, maxWidth: 240 }}>{audienceText(a)}</td>
              <td style={{ fontSize: 13 }}><StatusText a={a} /></td>
              <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                <button className="btn btn-ghost btn-sm btn-icon" title="Send me a preview" disabled={busy === 'p-' + a.id || !emailOn} onClick={() => preview(a)}><Eye size={13} /></button>{' '}
                {['draft', 'scheduled'].includes(a.status) && <><button className="btn btn-ghost btn-sm btn-icon" title="Edit" onClick={() => edit(a)}><Edit2 size={13} /></button>{' '}</>}
                {(a.status === 'scheduled' || (a.status === 'sent' && a.remind_before_minutes && !a.reminder_sent_at)) && <><button className="btn btn-ghost btn-sm btn-icon" title={a.status === 'sent' ? 'Cancel the reminder' : 'Cancel'} onClick={() => cancel(a)}><Ban size={13} /></button>{' '}</>}
                {a.status !== 'scheduled' && <button className="btn btn-ghost btn-sm btn-icon" title={a.status === 'sent' ? 'Remove from history' : 'Delete'} style={{ color: '#dc2626' }} onClick={() => remove(a)}><Trash2 size={13} /></button>}
              </td>
            </tr>) })}</tbody>
        </table>
      )}
      {editing && <AnnouncementModal value={editing} platform={platform} orgId={orgId} profile={profile} people={people} departments={departments} roles={roles} groups={groups} teams={teams} orgs={orgs}
        emailOn={emailOn} flash={flash}
        onClose={() => setEditing(null)}
        onDone={async (text, queued) => { setEditing(null); await load(); if (text) flash('success', text); if (queued) onQueued?.() }} />}
    </div>
  )
}

function AnnouncementModal({ value, platform, orgId, profile, people, departments, roles, groups, teams, orgs, emailOn, onClose, onDone }) {
  const [a, setA] = useState(value)
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState('')
  const set = patch => setA(x => ({ ...x, ...patch }))
  const toggleIn = (key, v) => set({ [key]: a[key].includes(v) ? a[key].filter(x => x !== v) : [...a[key], v] })
  const kind = a.kind

  // Live audience estimate (the send-time source of truth is _announcement_audience()).
  const estimate = useMemo(() => {
    if (platform) return null
    const ps = people.filter(p => p.email)
    if (a.audience_mode === 'roles') return ps.filter(p => a.roles.includes(p.role)).length
    if (a.audience_mode === 'departments') return ps.filter(p => a.department_ids.includes(p.department_id)).length
    if (a.audience_mode === 'groups') { const ids = new Set(); groups.filter(g => a.group_ids.includes(g.id)).forEach(g => resolveGroup(g, ps, teams).forEach(p => ids.add(p.id))); return ids.size }
    if (a.audience_mode === 'people') return a.people_ids.length
    return ps.length
  }, [a, people, groups, teams, platform])

  function validate() {
    if (!a.title.trim()) return 'Give it a title'
    if (kind === 'maintenance') {
      if (!a.starts_at) return 'Set when the maintenance starts'
      if (a.ends_at && new Date(a.ends_at) <= new Date(a.starts_at)) return 'The end time must be after the start'
    }
    if (kind !== 'maintenance' && !a.message.trim() && !(a.items || []).some(x => x.title?.trim())) return 'Write a message'
    if (!platform && a.audience_mode !== 'all') {
      const k = { roles: 'roles', departments: 'department_ids', groups: 'group_ids', people: 'people_ids' }[a.audience_mode]
      if (!a[k].length) return 'Pick who should receive it'
    }
    if (a.send_mode === 'later') {
      if (!a.send_at) return 'Pick the send time'
      if (new Date(a.send_at) <= new Date()) return 'The send time is in the past. Choose "Send now" instead.'
      if (kind === 'maintenance' && new Date(a.send_at) >= new Date(a.starts_at)) return 'Send the notice before the maintenance starts'
    }
    if (a.cta_url && !/^(https?:\/\/|\/)/i.test(a.cta_url.trim())) return 'The link must start with https:// or / (a page in the app)'
    return null
  }

  async function save(status) {
    setErr('')
    const v = validate(); if (v) return setErr(v)
    setSaving(status)
    try {
      if (status === 'draft' || status === 'preview') {
        const row = await saveAnnouncement(orgId, a, profile.id, 'draft')
        set({ id: row.id })
        if (status === 'preview') { await previewAnnouncement(row.id); setSaving(''); setErr(''); return onDone(`Saved as draft. Preview queued to ${profile.email}.`, true) }
        return onDone('Draft saved')
      }
      // Send / schedule: save as draft first so we can count the real audience, then confirm.
      const row = await saveAnnouncement(orgId, a, profile.id, 'draft')
      set({ id: row.id })
      const n = await announcementAudienceCount(row.id)
      if (!n) { setSaving(''); return setErr('Nobody matches this audience (people need an email address and an active account).') }
      const when = a.send_mode === 'later' ? `on ${whenText(new Date(a.send_at).toISOString())}` : 'now'
      if (!window.confirm(`Email "${a.title}" to ${plural(n, 'person', 'people')} ${when}?${platform ? '\n\nThis goes to every selected organisation.' : ''}`)) { setSaving(''); return }
      await saveAnnouncement(orgId, { ...a, id: row.id }, profile.id, 'scheduled')
      onDone(a.send_mode === 'later' ? `Scheduled for ${plural(n, 'person', 'people')}.` : `Sending to ${plural(n, 'person', 'people')}. It goes out within a minute.`, true)
    } catch (e) { setErr(e.message); setSaving('') }
  }

  const items = a.items?.length ? a.items : [{ title: '', description: '' }]
  const setItem = (i, patch) => set({ items: items.map((x, j) => j === i ? { ...x, ...patch } : x) })
  const shownPeople = people.filter(p => p.email && (!q || `${p.full_name} ${p.email}`.toLowerCase().includes(q.toLowerCase())))
  const PLATFORM_ROLES = ['admin', 'ceo', 'manager', 'department_head', 'finance', 'hr', 'employee']

  return (
    <Modal open onClose={onClose} title={value.id ? 'Edit announcement' : platform ? 'New platform announcement' : 'New announcement'} size="lg">
      {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginBottom: 14 }}>
        {Object.entries(ANNOUNCEMENT_KINDS).map(([k, v]) => { const I = KIND_ICON[k]; const on = kind === k; return (
          <button key={k} type="button" onClick={() => set({ kind: k })}
            style={{ textAlign: 'left', display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
              border: `1px solid ${on ? '#a5b4fc' : 'var(--border)'}`, background: on ? '#f5f7ff' : '#fff' }}>
            <I size={16} style={{ color: v.color, marginTop: 2, flexShrink: 0 }} />
            <span><span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{v.label}</span>
              <span style={{ display: 'block', fontSize: 12, color: '#64748b', lineHeight: 1.45 }}>{v.desc}</span></span>
          </button>) })}
      </div>

      <div className="form-group">
        <label style={S.label}>Title</label>
        <input className="form-input" value={a.title} onChange={e => set({ title: e.target.value })}
          placeholder={kind === 'maintenance' ? 'e.g. Database upgrade' : kind === 'update' ? 'e.g. New Week Planner and email groups' : 'e.g. Office closed on Friday'} />
      </div>

      {kind === 'maintenance' && (
        <div style={S.group}>
          <div style={S.groupTitle}>Maintenance window</div>
          <div className="form-row">
            <div className="form-group"><label style={S.label}>Starts</label><input type="datetime-local" className="form-input" value={a.starts_at} onChange={e => set({ starts_at: e.target.value })} /></div>
            <div className="form-group"><label style={S.label}>Expected to end</label><input type="datetime-local" className="form-input" value={a.ends_at} onChange={e => set({ ends_at: e.target.value })} /></div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label style={S.label}>What to expect</label>
              <input className="form-input" list="ann-impacts" value={a.impact} onChange={e => set({ impact: e.target.value })} placeholder="App unavailable" />
              <datalist id="ann-impacts">{IMPACTS.map(x => <option key={x} value={x} />)}</datalist>
            </div>
            <div className="form-group">
              <label style={S.label}>Reminder email</label>
              <select className="form-select" value={a.remind_before_minutes ?? ''} onChange={e => set({ remind_before_minutes: e.target.value ? Number(e.target.value) : null })}>
                {REMINDERS.map(([m, l]) => <option key={l} value={m ?? ''}>{l}</option>)}
              </select>
            </div>
          </div>
          <div style={S.hint}>Times are in your browser's time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Emails show them in each organisation's time zone.</div>
        </div>
      )}

      <div className="form-group">
        <label style={S.label}>{kind === 'update' ? 'Intro' : 'Message'}{kind === 'maintenance' && <span style={{ fontWeight: 400, color: '#94a3b8' }}> (optional)</span>}</label>
        <textarea className="form-input" rows={kind === 'general' ? 6 : 3} value={a.message} onChange={e => set({ message: e.target.value })}
          placeholder={kind === 'maintenance' ? 'Why, and anything people should do beforehand' : kind === 'update' ? 'A sentence about this release' : 'Your announcement'} style={{ resize: 'vertical' }} />
      </div>

      {kind === 'update' && (
        <div style={S.group}>
          <div style={{ ...S.groupTitle, display: 'flex', alignItems: 'center' }}>
            <span style={{ flex: 1 }}>What's new</span>
            <input className="form-input" value={a.version} onChange={e => set({ version: e.target.value })} placeholder="Version (optional)" style={{ width: 170, height: 30, textTransform: 'none', fontWeight: 400, letterSpacing: 0 }} />
          </div>
          {items.map((x, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <input className="form-input" value={x.title} onChange={e => setItem(i, { title: e.target.value })} placeholder={`Change ${i + 1}, e.g. "Week Planner"`} style={{ marginBottom: 4 }} />
                <input className="form-input" value={x.description} onChange={e => setItem(i, { description: e.target.value })} placeholder="What it does (optional)" style={{ fontSize: 12.5 }} />
              </div>
              <button type="button" className="btn btn-ghost btn-sm btn-icon" title="Remove" disabled={items.length === 1} onClick={() => set({ items: items.filter((_, j) => j !== i) })}><X size={13} /></button>
            </div>
          ))}
          <button type="button" className="btn btn-outline btn-sm" onClick={() => set({ items: [...items, { title: '', description: '' }] })}><Plus size={13} /> Add a change</button>
        </div>
      )}

      <div className="form-row">
        <div className="form-group"><label style={S.label}>Button link <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span></label>
          <input className="form-input" value={a.cta_url} onChange={e => set({ cta_url: e.target.value })} placeholder="https://… or /tasks" /></div>
        <div className="form-group"><label style={S.label}>Button text</label>
          <input className="form-input" value={a.cta_label} onChange={e => set({ cta_label: e.target.value })} placeholder={kind === 'update' ? "See what's new" : 'Learn more'} disabled={!a.cta_url} /></div>
      </div>

      <div style={S.group}>
        <div style={S.groupTitle}>Send to</div>
        {platform ? (<>
          <label style={S.label}>Organisations <span style={{ fontWeight: 400, color: '#94a3b8' }}>({a.org_ids.length ? `${a.org_ids.length} selected` : 'none selected = all active organisations'})</span></label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, maxHeight: 150, overflowY: 'auto' }}>{orgs.map(o => pill(a.org_ids.includes(o.id), () => toggleIn('org_ids', o.id), o.name, o.id))}</div>
          <label style={S.label}>Only these roles <span style={{ fontWeight: 400, color: '#94a3b8' }}>(none = everyone)</span></label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{PLATFORM_ROLES.map(r => pill(a.roles.includes(r), () => toggleIn('roles', r), r.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()), r))}</div>
        </>) : (<>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {[['all', 'Everyone'], ['roles', 'Roles'], ['departments', 'Departments'], ['groups', 'Groups'], ['people', 'Specific people']].map(([k, l]) => pill(a.audience_mode === k, () => set({ audience_mode: k }), l, k))}
          </div>
          {a.audience_mode === 'roles' && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{roles.map(r => pill(a.roles.includes(r.role_key), () => toggleIn('roles', r.role_key), r.label, r.role_key))}</div>}
          {a.audience_mode === 'departments' && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{departments.map(d => pill(a.department_ids.includes(d.id), () => toggleIn('department_ids', d.id), d.name, d.id))}</div>}
          {a.audience_mode === 'groups' && (groups.length ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{groups.map(g => pill(a.group_ids.includes(g.id), () => toggleIn('group_ids', g.id), `${g.name}${g.size != null ? ` · ${g.size}` : ''}`, g.id))}</div> : <div style={S.hint}>No groups yet. Create one under Groups.</div>)}
          {a.audience_mode === 'people' && (<>
            <input className="form-input" placeholder="Search people…" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 6 }} />
            <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              {shownPeople.map(p => (
                <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', fontSize: 13 }}>
                  <input type="checkbox" checked={a.people_ids.includes(p.id)} onChange={() => toggleIn('people_ids', p.id)} style={{ accentColor: 'var(--c1)' }} />
                  <span style={{ flex: 1 }}>{p.full_name}</span><span style={{ fontSize: 12, color: '#94a3b8', textTransform: 'capitalize' }}>{p.role?.replace(/_/g, ' ')}</span>
                </label>))}
            </div>
          </>)}
          {estimate != null && <div style={{ ...S.hint, color: '#4338ca', marginTop: 10 }}>About {plural(estimate, 'person', 'people')} will receive it.</div>}
        </>)}
      </div>

      <div style={S.group}>
        <div style={S.groupTitle}>When</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {pill(a.send_mode === 'now', () => set({ send_mode: 'now' }), 'Send now', 'now')}
          {pill(a.send_mode === 'later', () => set({ send_mode: 'later' }), 'Schedule', 'later')}
          {a.send_mode === 'later' && <input type="datetime-local" className="form-input" value={a.send_at} onChange={e => set({ send_at: e.target.value })} style={{ width: 230, height: 32 }} />}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => save('preview')} disabled={!!saving || !emailOn} title="Saves a draft and emails only you"><Eye size={13} /> {saving === 'preview' ? 'Queuing…' : 'Preview to me'}</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => save('draft')} disabled={!!saving}>{saving === 'draft' ? 'Saving…' : 'Save draft'}</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => save('send')} disabled={!!saving || !emailOn}>{saving === 'send' ? 'Working…' : a.send_mode === 'later' ? 'Schedule' : 'Send'}</button>
      </div>
    </Modal>
  )
}
