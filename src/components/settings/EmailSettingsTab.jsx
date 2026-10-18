import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase, dateFmt, timeFmt } from '../../lib/supabase'
import { Modal, Loader } from '../ui'
import AlertRulesSection from './AlertRulesSection'
import EmailGroupsSection from './EmailGroupsSection'
import AnnouncementsSection from './AnnouncementsSection'
import EventRulesSection from './EventRulesSection'
import { listRoles } from '../../lib/roles'
import {
  getOrgEmailSettings, saveOrgEmailSettings, sendTestEmail, listEmailLog,
  listReportSchedules, saveReportSchedule, deleteReportSchedule, sendReportPreview, isValidEmail,
  REPORT_TYPES, canUseReportType, REPORT_SCOPE, canManageAlerts, listEmailGroups,
} from '../../lib/email'
import { Send, RefreshCw, Plus, Edit2, Trash2, Mail, CheckCircle2, AlertCircle, Clock, Eye } from 'lucide-react'

// Settings → Email (STEP228). Sender identity, scheduled report emails and
// the delivery log. SMTP credentials are NOT here on purpose — they're
// Edge Function secrets, never readable from the browser.

const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const hourLabel = (h, m = 0) => new Date(2000, 0, 1, h, m).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
const TEMPLATE_LABEL = { notification: 'Notification', digest: 'Daily summary', team_report: 'Report', welcome: 'Welcome', invite: 'Invite', test: 'Test', checkin_reminder: 'Check-in reminder', checkin_manager: 'Check-in list', overdue_digest: 'Overdue list', overdue_manager: 'Overdue summary', announcement: 'Announcement', event: 'Event trigger' }
const EMPTY_SCHEDULE = { report_type: 'team_performance', coverage: 'to_date', project_id: '', name: 'Daily team performance', period: 'daily', send_hour: 19, send_weekday: 5, send_monthday: 1, weekdays_only: true, department_id: '', recipient_ids: [], extra_emails: [], enabled: true }
const typeOf = key => REPORT_TYPES.find(t => t.key === (key || 'team_performance')) || REPORT_TYPES[0]

const S = {
  section: { border: '1px solid var(--border)', borderRadius: 10, marginBottom: 20, background: '#fff' },
  head: { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--border)' },
  title: { fontSize: 14, fontWeight: 600, color: 'var(--text)' },
  sub: { fontSize: 12.5, color: '#64748b', marginTop: 2 },
  body: { padding: 18 },
  label: { display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6 },
  hint: { fontSize: 12, color: '#94a3b8', marginTop: 4 },
}

export default function EmailSettingsTab() {
  const { profile } = useAuth()
  const orgId = profile?.organization_id
  const isAdmin = ['admin', 'ceo'].includes(profile?.role)
  const [settings, setSettings] = useState(null)
  const [schedules, setSchedules] = useState([])
  const [log, setLog] = useState([])
  const [people, setPeople] = useState([])
  const [departments, setDepartments] = useState([])
  const [projects, setProjects] = useState([])
  const [groups, setGroups] = useState([])
  const [roles, setRoles] = useState([])
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null) // {type, text}
  const [editing, setEditing] = useState(null)

  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 5000) }

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const [s, sch, lg, ppl, dep, prj, grp, rls, tms, tmm] = await Promise.all([
        getOrgEmailSettings(orgId), listReportSchedules(orgId), isAdmin ? listEmailLog(orgId) : Promise.resolve([]),
        supabase.from('profiles').select('id, full_name, email, role, department_id, is_active').order('full_name'),
        supabase.from('departments').select('id, name').order('name'),
        supabase.from('projects').select('id, name, code, status').order('name'),
        listEmailGroups(orgId).catch(() => []), listRoles().catch(() => []),
        supabase.from('teams').select('id, name, lead_id').order('name'),
        supabase.from('team_members').select('team_id, person_id'),
      ])
      setSettings(s); setSchedules(sch); setLog(lg)
      setPeople((ppl.data || []).filter(p => p.is_active !== false)); setDepartments(dep.data || []); setProjects(prj.data || [])
      setGroups(grp); setRoles(rls)
      setTeams((tms.data || []).map(t => ({ ...t, members: (tmm.data || []).filter(m => m.team_id === t.id).map(m => m.person_id) })))
    } catch (e) { flash('danger', e.message) }
    finally { setLoading(false) }
  }, [orgId, isAdmin])
  useEffect(() => { load() }, [load])

  async function refreshLog() { try { setLog(await listEmailLog(orgId)) } catch (e) { flash('danger', e.message) } }

  async function save(e) {
    e.preventDefault()
    if (settings.reply_to && !isValidEmail(settings.reply_to)) return flash('danger', 'Reply-to must be a valid email address')
    setBusy('save')
    try { setSettings(await saveOrgEmailSettings(orgId, settings, profile.id)); flash('success', 'Email settings saved') }
    catch (e) { flash('danger', e.message) } finally { setBusy('') }
  }
  async function test() {
    setBusy('test')
    try { await sendTestEmail(); flash('success', `Test email queued to ${profile.email}. It should arrive within a minute.`); setTimeout(refreshLog, 1500) }
    catch (e) { flash('danger', e.message) } finally { setBusy('') }
  }
  async function preview(s) {
    setBusy('preview-' + s.id)
    try { await sendReportPreview(s.id); flash('success', `Preview of "${s.name}" queued to ${profile.email}.`); setTimeout(refreshLog, 1500) }
    catch (e) { flash('danger', e.message) } finally { setBusy('') }
  }
  async function remove(s) {
    if (!window.confirm(`Delete the schedule "${s.name}"?`)) return
    try { await deleteReportSchedule(s.id); setSchedules(x => x.filter(y => y.id !== s.id)) } catch (e) { flash('danger', e.message) }
  }

  if (loading || !settings) return <Loader />
  const sent = log.filter(l => l.status === 'sent').length, failed = log.filter(l => l.status === 'failed').length

  return (
    <div>
      {msg && <div className={`alert alert-${msg.type}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      {isAdmin && (
        <form style={S.section} onSubmit={save}>
          <div style={S.head}>
            <Mail size={16} style={{ color: '#94a3b8' }} />
            <div style={{ flex: 1 }}>
              <div style={S.title}>Sending</div>
              <div style={S.sub}>How emails from your organization appear to recipients</div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!settings.enabled} onChange={e => setSettings(s => ({ ...s, enabled: e.target.checked }))} style={{ accentColor: 'var(--c1)', width: 16, height: 16 }} />
              {settings.enabled ? 'Email is on' : 'Email is off'}
            </label>
          </div>
          <div style={S.body}>
            <div className="form-row">
              <div className="form-group">
                <label style={S.label}>Sender name</label>
                <input className="form-input" value={settings.from_name || ''} placeholder={profile?.org?.name || 'e.g. ThingsAlive HR'} onChange={e => setSettings(s => ({ ...s, from_name: e.target.value }))} />
                <div style={S.hint}>Shown as the "From" name. The address is the platform's verified mailbox.</div>
              </div>
              <div className="form-group">
                <label style={S.label}>Reply-to address</label>
                <input className="form-input" type="email" value={settings.reply_to || ''} placeholder="hr@yourcompany.com" onChange={e => setSettings(s => ({ ...s, reply_to: e.target.value }))} />
                <div style={S.hint}>Where replies go. Leave blank to use the sender mailbox.</div>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label style={S.label}>Timezone</label>
                <select className="form-select" value={settings.timezone} onChange={e => setSettings(s => ({ ...s, timezone: e.target.value }))}>
                  {TIMEZONES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <div style={S.hint}>Used for daily summaries and report send times.</div>
              </div>
              <div className="form-group">
                <label style={S.label}>Footer text</label>
                <input className="form-input" value={settings.footer_text || ''} placeholder="Company name, address" onChange={e => setSettings(s => ({ ...s, footer_text: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn btn-primary btn-sm" type="submit" disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save settings'}</button>
              <button className="btn btn-outline btn-sm" type="button" onClick={test} disabled={busy === 'test' || !settings.enabled} title={settings.enabled ? '' : 'Turn email on and save first'}>
                <Send size={13} /> {busy === 'test' ? 'Queuing…' : 'Send test email'}
              </button>
              {!settings.enabled && <span style={{ fontSize: 12, color: '#94a3b8' }}>No emails are sent while email is off.</span>}
            </div>
          </div>
        </form>
      )}

      <EmailGroupsSection orgId={orgId} profile={profile} groups={groups} people={people} departments={departments} roles={roles} teams={teams}
        flash={flash} onChanged={async () => setGroups(await listEmailGroups(orgId))} />

      {canManageAlerts(profile?.role) && (
        <AlertRulesSection orgId={orgId} profile={profile} people={people} departments={departments} groups={groups} flash={flash}
          emailOn={!!settings.enabled} onQueued={() => setTimeout(refreshLog, 1500)} />
      )}

      {isAdmin && (<>
        <EventRulesSection orgId={orgId} profile={profile} people={people} groups={groups} flash={flash}
          emailOn={!!settings.enabled} onQueued={() => setTimeout(refreshLog, 1500)} />
        <AnnouncementsSection orgId={orgId} profile={profile} people={people} departments={departments} roles={roles} groups={groups} teams={teams}
          flash={flash} emailOn={!!settings.enabled} onQueued={() => setTimeout(refreshLog, 1500)} />
      </>)}

      <div style={S.section}>
        <div style={S.head}>
          <Clock size={16} style={{ color: '#94a3b8' }} />
          <div style={{ flex: 1 }}>
            <div style={S.title}>Scheduled reports</div>
            <div style={S.sub}>Team performance (attendance, task time logged, delivery, flags) emailed to managers automatically</div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...EMPTY_SCHEDULE, recipient_ids: [profile.id] })}><Plus size={13} /> New scheduled report</button>
        </div>
        {schedules.length === 0 ? (
          <div style={{ padding: '28px 18px', textAlign: 'center', fontSize: 13, color: '#94a3b8' }}>No scheduled reports yet.</div>
        ) : (
          <table style={{ display: 'table', width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: '#fff' }}><tr>
              {['Report', 'When', 'Scope', 'Recipients', 'Last sent', ''].map(h => <th key={h} style={{ textTransform: 'none', letterSpacing: 0, fontSize: 12, fontWeight: 600, color: '#94a3b8', borderBottom: '1px solid var(--border)' }}>{h}</th>)}
            </tr></thead>
            <tbody>{schedules.map(s => (
              <tr key={s.id}>
                <td>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{typeOf(s.report_type).label} · <span style={{ color: s.enabled ? '#15803d' : '#94a3b8' }}>{s.enabled ? 'Active' : 'Paused'}</span></div>
                </td>
                <td style={{ fontSize: 13 }}>{describeWhen(s)}</td>
                <td style={{ fontSize: 13 }}>{s.report_type === 'project_status'
                  ? (projects.find(p => p.id === s.project_id)?.name || 'All active projects')
                  : s.report_type === 'manager_team' ? 'Each manager’s own team'
                  : REPORT_SCOPE[s.report_type] !== 'department' ? 'Whole organization'
                  : departments.find(d => d.id === s.department_id)?.name || 'Whole organization'}</td>
                <td style={{ fontSize: 13 }}>{s.recipient_ids.length + s.extra_emails.length} {s.recipient_ids.length + s.extra_emails.length === 1 ? 'person' : 'people'}
                  {(s.recipient_group_ids || []).length > 0 && <div style={{ fontSize: 12, color: '#64748b' }}>+ {(s.recipient_group_ids || []).map(id => groups.find(g => g.id === id)?.name || 'group').join(', ')}</div>}</td>
                <td style={{ fontSize: 13, color: '#64748b' }}>{s.last_sent_on ? dateFmt(s.last_sent_on) : 'Never'}</td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button className="btn btn-ghost btn-sm btn-icon" title="Send a preview to me" disabled={busy === 'preview-' + s.id || !settings.enabled} onClick={() => preview(s)}><Eye size={13} /></button>{' '}
                  <button className="btn btn-ghost btn-sm btn-icon" title="Edit" onClick={() => setEditing({ ...s, department_id: s.department_id || '' })}><Edit2 size={13} /></button>{' '}
                  <button className="btn btn-ghost btn-sm btn-icon" title="Delete" style={{ color: '#dc2626' }} onClick={() => remove(s)}><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      {isAdmin && (
        <div style={S.section}>
          <div style={S.head}>
            <Send size={16} style={{ color: '#94a3b8' }} />
            <div style={{ flex: 1 }}>
              <div style={S.title}>Delivery log</div>
              <div style={S.sub}>Last {log.length} emails · {sent} sent · {failed} failed</div>
            </div>
            <button className="btn btn-outline btn-sm" onClick={refreshLog}><RefreshCw size={13} /> Refresh</button>
          </div>
          {log.length === 0 ? <div style={{ padding: '28px 18px', textAlign: 'center', fontSize: 13, color: '#94a3b8' }}>Nothing sent yet.</div> : (
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              <table style={{ display: 'table', width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ background: '#fff', position: 'sticky', top: 0 }}><tr>
                  {['Status', 'To', 'Type', 'Subject', 'Queued'].map(h => <th key={h} style={{ textTransform: 'none', letterSpacing: 0, fontSize: 12, fontWeight: 600, color: '#94a3b8', borderBottom: '1px solid var(--border)', background: '#fff' }}>{h}</th>)}
                </tr></thead>
                <tbody>{log.map(l => (
                  <tr key={l.id}>
                    <td><StatusPill l={l} /></td>
                    <td style={{ fontSize: 13 }}><div>{l.to_name || l.to_email}</div>{l.to_name && <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{l.to_email}</div>}</td>
                    <td style={{ fontSize: 12.5, color: '#64748b' }}>{TEMPLATE_LABEL[l.template] || l.template}</td>
                    <td style={{ fontSize: 13, maxWidth: 320 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.subject || '—'}</div>
                      {l.last_error && <div style={{ fontSize: 11.5, color: '#b91c1c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.last_error}>{l.last_error}</div>}
                    </td>
                    <td style={{ fontSize: 12.5, color: '#64748b', whiteSpace: 'nowrap' }}>{timeFmt(l.created_at)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {editing && <ScheduleModal value={editing} people={people} departments={departments} projects={projects} groups={groups} timezone={settings.timezone}
        role={profile?.role}
        onClose={() => setEditing(null)}
        onSave={async s => { await saveReportSchedule(orgId, s, profile.id); setEditing(null); setSchedules(await listReportSchedules(orgId)); flash('success', 'Schedule saved') }} />}
    </div>
  )
}

const COVERS = {
  daily: { to_date: 'the same day', previous: 'the previous day' },
  weekly: { to_date: 'the last 7 days', previous: 'the previous Mon–Sun week' },
  monthly: { to_date: 'the month to date', previous: 'the previous month' },
}
function describeWhen(s) {
  const at = hourLabel(s.send_hour, s.send_minute || 0), covers = COVERS[s.period]?.[s.coverage || 'to_date'] || ''
  if (s.period === 'daily') return `Daily at ${at}${s.weekdays_only ? ', Mon–Fri' : ''} · covers ${covers}`
  if (s.period === 'weekly') return `${WEEKDAYS[s.send_weekday ?? 5]}s at ${at} · covers ${covers}`
  return `Day ${s.send_monthday ?? 1} of each month at ${at} · covers ${covers}`
}

function StatusPill({ l }) {
  const m = l.status === 'sent' ? { c: '#15803d', b: '#f0fdf4', I: CheckCircle2, t: 'Sent' }
    : l.status === 'failed' ? { c: '#b91c1c', b: '#fef2f2', I: AlertCircle, t: 'Failed' }
      : { c: '#92400e', b: '#fffbeb', I: Clock, t: l.attempts > 0 ? `Retrying (${l.attempts})` : 'Queued' }
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 6, background: m.b, color: m.c, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}><m.I size={12} />{m.t}</span>
}

function ScheduleModal({ value, people, departments, projects, groups = [], timezone, role, onClose, onSave }) {
  const [s, setS] = useState({ report_type: 'team_performance', coverage: 'to_date', recipient_group_ids: [], ...value, project_id: value.project_id || '', extraText: (value.extra_emails || []).join(', ') })
  const types = REPORT_TYPES.filter(t => canUseReportType(t.key, role) || t.key === s.report_type)
  const hidden = REPORT_TYPES.filter(t => !types.includes(t))
  const perManager = s.report_type === 'manager_team'
  const sensitive = ['financial', 'monthly_summary', 'ceo_briefing', 'hr_people'].includes(s.report_type)
  const type = typeOf(s.report_type)
  // New schedule: picking a type fills in that report's sensible defaults.
  const pickType = key => {
    const t = typeOf(key)
    setS(x => value.id ? { ...x, report_type: key } : { ...x, report_type: key, ...t.defaults })
  }
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const set = patch => setS(x => ({ ...x, ...patch }))
  const toggle = id => set({ recipient_ids: s.recipient_ids.includes(id) ? s.recipient_ids.filter(x => x !== id) : [...s.recipient_ids, id] })
  const shown = people.filter(p => p.email && (!q || `${p.full_name} ${p.email}`.toLowerCase().includes(q.toLowerCase())))

  async function submit(e) {
    e.preventDefault(); setErr('')
    const extra = s.extraText.split(/[,\s;]+/).map(x => x.trim()).filter(Boolean)
    const bad = extra.filter(x => !isValidEmail(x))
    if (!s.name.trim()) return setErr('Give the schedule a name')
    if (bad.length) return setErr(`Not a valid email: ${bad.join(', ')}`)
    if (!perManager && s.recipient_ids.length + extra.length + (s.recipient_group_ids || []).length === 0) return setErr('Add at least one recipient or group')
    setSaving(true)
    try { await onSave({ ...s, extra_emails: extra }) } catch (e2) { setErr(e2.message); setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={value.id ? 'Edit scheduled report' : 'New scheduled report'} size="lg">
      <form onSubmit={submit}>
        {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="form-group">
          <label style={S.label}>Report</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
            {types.map(t => (
              <label key={t.key} style={{ display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                border: `1px solid ${s.report_type === t.key ? '#a5b4fc' : 'var(--border)'}`, background: s.report_type === t.key ? '#f5f7ff' : '#fff' }}>
                <input type="radio" name="report_type" checked={s.report_type === t.key} onChange={() => pickType(t.key)} style={{ accentColor: 'var(--c1)', marginTop: 3 }} />
                <span>
                  <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#94a3b8' }}>{t.audience}</span>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{t.label}</span>
                  <span style={{ display: 'block', fontSize: 12, color: '#64748b', lineHeight: 1.45 }}>{t.desc}</span>
                </span>
              </label>
            ))}
          </div>
          {hidden.length > 0 && <div style={S.hint}>{hidden.map(t => t.label).join(', ')}: not available for your role.</div>}
          {sensitive && <div style={{ ...S.hint, color: '#92400e' }}>Contains confidential {s.report_type === 'hr_people' ? 'staff attendance and leave' : 'company financial'} figures. Only add recipients who should see them.</div>}
          {perManager && <div style={{ ...S.hint, color: '#5b21b6' }}>Sent separately to each manager, covering only their own direct reports (set by Reporting manager on the Users page).</div>}
        </div>
        <div className="form-group">
          <label style={S.label}>Name</label>
          <input className="form-input" value={s.name} onChange={e => set({ name: e.target.value })} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label style={S.label}>Frequency</label>
            <select className="form-select" value={s.period} onChange={e => set({ period: e.target.value })}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div className="form-group">
            <label style={S.label}>Covers</label>
            <select className="form-select" value={s.coverage} onChange={e => set({ coverage: e.target.value })}>
              <option value="previous">{COVERS[s.period].previous.replace(/^the /, 'The ')}</option>
              <option value="to_date">{COVERS[s.period].to_date.replace(/^the /, 'The ')}</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label style={S.label}>Send at ({timezone})</label>
            <input type="time" className="form-input" required
              value={`${String(s.send_hour ?? 9).padStart(2, '0')}:${String(s.send_minute ?? 0).padStart(2, '0')}`}
              onChange={e => { const [hh, mm] = (e.target.value || '09:00').split(':').map(Number); set({ send_hour: hh, send_minute: mm }) }} />
            <div style={S.hint}>Goes out within a minute of this time.</div>
          </div>
        </div>
        <div className="form-row">
          {s.period === 'daily' && (
            <div className="form-group">
              <label style={{ ...S.label, display: 'flex', alignItems: 'center', gap: 8, marginTop: 26, cursor: 'pointer' }}>
                <input type="checkbox" checked={s.weekdays_only} onChange={e => set({ weekdays_only: e.target.checked })} style={{ accentColor: 'var(--c1)' }} /> Weekdays only (Mon–Fri)
              </label>
            </div>
          )}
          {s.period === 'weekly' && (
            <div className="form-group">
              <label style={S.label}>Day of week</label>
              <select className="form-select" value={s.send_weekday ?? 5} onChange={e => set({ send_weekday: Number(e.target.value) })}>
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </div>
          )}
          {s.period === 'monthly' && (
            <div className="form-group">
              <label style={S.label}>Day of month</label>
              <select className="form-select" value={s.send_monthday ?? 1} onChange={e => set({ send_monthday: Number(e.target.value) })}>
                {Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
              </select>
            </div>
          )}
          {s.report_type === 'project_status' ? (
            <div className="form-group">
              <label style={S.label}>Project</label>
              <select className="form-select" value={s.project_id || ''} onChange={e => set({ project_id: e.target.value })}>
                <option value="">All active projects</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.code ? ` (${p.code})` : ''}{p.status && p.status !== 'active' ? ` · ${p.status}` : ''}</option>)}
              </select>
            </div>
          ) : REPORT_SCOPE[s.report_type] === 'department' && (
            <div className="form-group">
              <label style={S.label}>{s.report_type === 'monthly_summary' ? 'People section' : 'Scope'}</label>
              <select className="form-select" value={s.department_id || ''} onChange={e => set({ department_id: e.target.value })}>
                <option value="">Whole organization</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="form-group">
          {groups.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>{perManager ? 'Limit to managers in these groups' : 'Groups'}</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {groups.map(g => { const on = (s.recipient_group_ids || []).includes(g.id); return (
                  <button key={g.id} type="button" onClick={() => set({ recipient_group_ids: on ? s.recipient_group_ids.filter(x => x !== g.id) : [...(s.recipient_group_ids || []), g.id] })}
                    style={{ height: 30, padding: '0 12px', borderRadius: 15, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                      border: `1px solid ${on ? '#a5b4fc' : 'var(--border)'}`, background: on ? '#eef2ff' : '#fff', color: on ? '#4338ca' : '#475569' }}>
                    {g.name}{g.size != null ? ` · ${g.size}` : ''}
                  </button>) })}
              </div>
            </div>
          )}
          <label style={S.label}>{perManager ? 'Limit to these managers' : 'Recipients'} <span style={{ fontWeight: 400, color: '#94a3b8' }}>({perManager && !s.recipient_ids.length ? 'none selected = every manager' : `${s.recipient_ids.length} selected`})</span></label>
          <input className="form-input" placeholder="Search people…" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 6 }} />
          <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            {shown.map(p => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={s.recipient_ids.includes(p.id)} onChange={() => toggle(p.id)} style={{ accentColor: 'var(--c1)' }} />
                <span style={{ flex: 1 }}>{p.full_name}</span>
                <span style={{ fontSize: 12, color: '#94a3b8', textTransform: 'capitalize' }}>{p.role?.replace(/_/g, ' ')}</span>
              </label>
            ))}
            {shown.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: '#94a3b8' }}>No one matches</div>}
          </div>
        </div>
        {!perManager && <div className="form-group">
          <label style={S.label}>Other email addresses</label>
          <input className="form-input" value={s.extraText} onChange={e => set({ extraText: e.target.value })} placeholder="director@company.com, auditor@firm.com" />
          <div style={S.hint}>Separate with commas. These people receive per-person figures, so only add people who should see them.</div>
        </div>}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 16, cursor: 'pointer' }}>
          <input type="checkbox" checked={s.enabled} onChange={e => set({ enabled: e.target.checked })} style={{ accentColor: 'var(--c1)' }} /> Active
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save schedule'}</button>
        </div>
      </form>
    </Modal>
  )
}
