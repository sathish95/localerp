import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  createIncident, updateIncident, listComments, addComment, listEntityEvents, listLinks, linkChecks, unlinkCheck, listChecks, getChecksByIds,
  raiseWarrantyClaim, getDevice360, deviceLabel, equipmentLabel, ConflictError,
} from '../../lib/goLive'
import {
  PRIORITIES, CATEGORIES, INCIDENT_STATUSES, SCOPE_TYPES, FOLLOW_UP_FLAGS, labelOf, computeFollowUpFlag,
  transitionErrors, inferIncidentCategory, failingFields, toIstInput, fromIstInput, istDateTime, istToday,
} from '../../lib/goLiveRules'
import { Modal, Loader, Empty, SearchBox } from '../ui'
import { PriorityBadge, FlagBadge, PersonSelect, EnumSelect, Field, ErrorLine, Chip, errText, Kpi, DeviceFilterSelects } from './shared'
import { deviceFilterActive } from '../../lib/goLiveDeviceFields'
import { Plus, List, Columns3, ShieldCheck, RotateCcw, MessageSquare, Link2, Unlink, Wrench, History } from 'lucide-react'

const age = ts => {
  if (!ts) return '—'
  const m = (Date.now() - new Date(ts)) / 60000
  return m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}

export default function IncidentsTab({ ctx }) {
  const { engagement, incidents, enrollments, lookups, params, setParams, reloadIncidents } = ctx
  const [view, setView] = useState('list')
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState({ status: 'OPEN_ONLY', priority: '', category: '', flag: '' })
  const [creating, setCreating] = useState(false)
  const openId = params.get('incident')
  const setOpen = id => { const p = new URLSearchParams(params); id ? p.set('incident', id) : p.delete('incident'); setParams(p, { replace: true }) }
  const enrById = Object.fromEntries(enrollments.map(e => [e.id, e]))
  const person = id => lookups.people.find(p => p.id === id)?.full_name
  const now = new Date()
  // shared device filter (Go-live / custom fields): an incident matches when any of its devices does;
  // site / platform incidents have no device, so they drop out while a device filter is on
  const devFiltering = deviceFilterActive(ctx.deviceFilter)
  const devicesOf = i => (i.device_enrollment_ids || []).map(id => enrById[id]).filter(Boolean)
  const devMatch = i => !devFiltering || devicesOf(i).some(ctx.matchDev)
  const openInc = incidents.filter(i => i.status !== 'CLOSED' && devMatch(i))
  const onLive = openInc.filter(i => devicesOf(i).some(e => e.is_golive))
  const onNotLive = openInc.filter(i => devicesOf(i).length && !devicesOf(i).some(e => e.is_golive))
  const pickLive = v => ctx.setDeviceFilter(d => ({ ...d, golive: d.golive === v ? '' : v }))

  const shown = incidents.filter(i => {
    const flag = computeFollowUpFlag(i, now)
    const t = q.trim().toLowerCase()
    return (filters.status === 'OPEN_ONLY' ? i.status !== 'CLOSED' : !filters.status || i.status === filters.status)
      && (!filters.priority || i.priority === filters.priority) && (!filters.category || i.category === filters.category)
      && (!filters.flag || flag === filters.flag) && devMatch(i)
      && (!t || [i.number, i.legacy_ref, i.title, i.issue_business_impact].some(v => (v || '').toLowerCase().includes(t)))
  })
  const setF = (k, v) => setFilters(f => ({ ...f, [k]: v }))
  const scope = i => i.scope_type === 'SITE' ? `Site${i.site ? ` · ${i.site}` : ''}` : i.scope_type === 'PLATFORM' ? 'Platform'
    : (i.device_enrollment_ids || []).map(id => equipmentLabel(enrById[id])).join(', ') || '—'
  const open = incidents.find(i => i.id === openId)
  const canRaise = !['CLOSED', 'CANCELLED', 'DRAFT'].includes(engagement.status)

  return (
    <div>
      {incidents.length > 0 && (
        <div className="gl-kpis">
          <Kpi label="Open incidents" value={openInc.length} sub={`${openInc.filter(i => i.priority === 'P1_CRITICAL').length} P1 critical`} accent="#6366f1" />
          <Kpi label="On go-live devices" value={onLive.length} sub={`${onLive.filter(i => i.priority === 'P1_CRITICAL').length} P1 · Go-live = Yes`} accent="#059669" active={ctx.deviceFilter.golive === 'YES'} onClick={() => pickLive('YES')} />
          <Kpi label="On not-live devices" value={onNotLive.length} sub="Go-live = No" accent="#64748b" active={ctx.deviceFilter.golive === 'NO'} onClick={() => pickLive('NO')} />
          <Kpi label="Site / platform" value={incidents.filter(i => i.status !== 'CLOSED' && !(i.device_enrollment_ids || []).length).length} sub={devFiltering ? 'Hidden while a device filter is on' : 'No device linked'} accent="#94a3b8" />
          <Kpi label="Overdue" value={openInc.filter(i => computeFollowUpFlag(i, now) === 'OVERDUE').length} sub="Follow-up flag" accent="#dc2626" />
          <Kpi label="Resolved" value={incidents.filter(i => ['RESOLVED', 'CLOSED'].includes(i.status) && devMatch(i)).length} sub="Resolved or closed" accent="#10b981" />
        </div>
      )}
      <div className="table-wrap">
        <div className="table-toolbar">
          <SearchBox value={q} onChange={setQ} placeholder="Number, title…" />
          <select className="form-select" style={{ width: 140, fontSize: 12 }} value={filters.status} onChange={e => setF('status', e.target.value)}>
            <option value="OPEN_ONLY">Not closed</option><option value="">All statuses</option>{INCIDENT_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <select className="form-select" style={{ width: 130, fontSize: 12 }} value={filters.priority} onChange={e => setF('priority', e.target.value)}>
            <option value="">All priorities</option>{PRIORITIES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <select className="form-select" style={{ width: 130, fontSize: 12 }} value={filters.category} onChange={e => setF('category', e.target.value)}>
            <option value="">All categories</option>{CATEGORIES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <select className="form-select" style={{ width: 150, fontSize: 12 }} value={filters.flag} onChange={e => setF('flag', e.target.value)}>
            <option value="">All follow-up flags</option>{Object.entries(FOLLOW_UP_FLAGS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <span className="gl-bar" style={{ display: 'contents' }}><DeviceFilterSelects ctx={ctx} /></span>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <button className="btn btn-sm" style={{ borderRadius: 0, background: view === 'list' ? 'var(--surface-2)' : 'transparent' }} onClick={() => setView('list')}><List size={13} /> List</button>
            <button className="btn btn-sm" style={{ borderRadius: 0, background: view === 'kanban' ? 'var(--surface-2)' : 'transparent' }} onClick={() => setView('kanban')}><Columns3 size={13} /> Board</button>
          </div>
          {canRaise && <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={13} /> Raise incident</button>}
        </div>

        {!shown.length ? <Empty title="No incidents" desc="Incidents raised from checks or directly appear here." /> : view === 'list' ? (
          <table className="data-table" style={{ display: 'table', fontSize: 12.5 }}>
            <thead><tr><th>Incident</th><th>Scope</th><th>Priority</th><th>Category</th><th>Owner</th><th>Status</th><th>Next action / due</th><th>Age</th><th>Follow-up</th></tr></thead>
            <tbody>{shown.map(i => (
              <tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(i.id)}>
                <td><div style={{ fontWeight: 700 }}>{i.number}{i.legacy_ref ? <span style={{ fontWeight: 400, color: 'var(--ink-muted)' }}> · {i.legacy_ref}</span> : ''}</div><div style={{ fontSize: 11.5 }}>{i.title}</div></td>
                <td style={{ fontSize: 11.5 }}>{scope(i)}</td>
                <td><PriorityBadge priority={i.priority} /></td>
                <td>{labelOf(CATEGORIES, i.category)}</td>
                <td>{person(i.assigned_owner_user_id) || i.assigned_owner_legacy || <span style={{ color: '#b45309' }}>Unassigned</span>}</td>
                <td>{labelOf(INCIDENT_STATUSES, i.status)}{i.handed_over_at && <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>→ {i.handed_over_to}</div>}</td>
                <td style={{ fontSize: 11.5 }}>{i.next_action || '—'}<div style={{ color: 'var(--ink-muted)' }}>{i.action_due_at ? istDateTime(i.action_due_at) : ''}</div></td>
                <td>{age(i.reported_at)}</td>
                <td><FlagBadge flag={computeFollowUpFlag(i, now)} /></td>
              </tr>
            ))}</tbody>
          </table>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${INCIDENT_STATUSES.length}, minmax(200px, 1fr))`, gap: 10, padding: 12, overflowX: 'auto' }}>
            {INCIDENT_STATUSES.map(s => (
              <div key={s.key} style={{ background: 'var(--surface)', borderRadius: 10, padding: 8, minHeight: 120 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--ink-muted)', marginBottom: 8 }}>{s.label} · {shown.filter(i => i.status === s.key).length}</div>
                {shown.filter(i => i.status === s.key).map(i => (
                  <div key={i.id} onClick={() => setOpen(i.id)} className="card" style={{ padding: 10, marginBottom: 8, cursor: 'pointer', fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}><strong>{i.number}</strong><PriorityBadge priority={i.priority} /></div>
                    <div style={{ margin: '4px 0' }}>{i.title}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--ink-muted)' }}><span>{person(i.assigned_owner_user_id) || '—'}</span><FlagBadge flag={computeFollowUpFlag(i, now)} /></div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {creating && <IncidentForm ctx={ctx} onClose={() => setCreating(false)} onSaved={async i => { setCreating(false); await reloadIncidents(); if (i) setOpen(i.id) }} />}
      {open && <IncidentDetail ctx={ctx} incident={open} onClose={() => setOpen(null)} />}
      {openId && !open && incidents.length > 0 && <Modal open title="Incident not found" onClose={() => setOpen(null)}><p>This incident isn't part of this engagement.</p></Modal>}
    </div>
  )
}

// Create form — also used by the R-A1 prompt from a failing check
// (prefilled with device, site and category inferred from the failing field).
export function IncidentForm({ ctx, title, prefillFromCheck, prefill, extraFooter, onClose, onSaved }) {
  const { engagement, enrollments, lookups, cur, profile } = ctx
  const pre = prefillFromCheck
  const [form, setForm] = useState(() => ({
    engagement_id: engagement.id,
    title: pre ? `${equipmentLabel(pre.enrollment)}: ${failingFields(pre.check).join(', ') || 'check failed'}` : '',
    scope_type: 'DEVICE', device_enrollment_ids: pre ? [pre.enrollment.id] : [],
    site: pre?.check.site_snapshot || pre?.enrollment.site || (engagement.sites || [])[0] || '',
    reported_at: new Date().toISOString(), priority: 'P3_NORMAL',
    category: pre ? inferIncidentCategory(pre.check) : 'HARDWARE',
    issue_business_impact: pre?.check.observation_action || '',
    assigned_owner_user_id: '', status: 'OPEN', next_action: '', action_due_at: '', origin_check_id: pre?.check.id || null, customer_visible: false,
    ...(prefill || {}),
  }))
  const [linkToday, setLinkToday] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const live = enrollments.filter(e => !e.unenrolled_at)
  const toggleDevice = id => set('device_enrollment_ids', form.device_enrollment_ids.includes(id) ? form.device_enrollment_ids.filter(x => x !== id) : [...form.device_enrollment_ids, id])
  const engineers = ['FIRMWARE_ENGINEER', 'APPLICATION_ENGINEER', 'ESCALATION_OWNER', 'ONSITE_COORDINATOR'].flatMap(r => [cur[r]?.primary_user_id, cur[r]?.backup_user_id])
  const guard = form.status !== 'OPEN' ? transitionErrors({ ...form, status: 'OPEN' }, form.status) : []

  async function save() {
    setError('')
    if (!form.title.trim() || !form.issue_business_impact.trim()) { setError('Title and issue / business impact are required'); return }
    if (['DEVICE', 'MULTI_DEVICE'].includes(form.scope_type) && !form.device_enrollment_ids.length) { setError('Pick the affected device(s)'); return }
    if (guard.length) { setError(`Needed for ${labelOf(INCIDENT_STATUSES, form.status)}: ${guard.join(', ')}`); return }
    setBusy(true)
    try {
      let linkIds = pre ? [pre.check.id] : []
      if (linkToday && form.device_enrollment_ids.length && (form.scope_type !== 'DEVICE' || !pre)) {
        // §6.3: link all affected devices' checks for the day in one action
        const d = pre?.check.check_date || istToday()
        const day = await listChecks(engagement.id, { from: d, to: d })
        linkIds = [...new Set([...linkIds, ...day.filter(c => form.device_enrollment_ids.includes(c.enrollment_id)).map(c => c.id)])]
      }
      const saved = await createIncident({ ...form, scope_type: form.scope_type === 'DEVICE' && form.device_enrollment_ids.length > 1 ? 'MULTI_DEVICE' : form.scope_type }, { linkCheckIds: linkIds })
      await onSaved(saved)
    } catch (e) { setError(errText(e)) }
    setBusy(false)
  }

  return (
    <Modal open size="lg" title={title || 'Raise incident'} onClose={onClose}
      footer={<>{extraFooter}<button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>Raise incident</button></>}>
      <ErrorLine error={error} />
      <Field label="Title" required><input className="form-input" value={form.title} onChange={e => set('title', e.target.value)} /></Field>
      <div className="form-row">
        <Field label="Scope"><EnumSelect options={SCOPE_TYPES} value={form.scope_type} onChange={v => set('scope_type', v || 'DEVICE')} /></Field>
        <Field label="Site">
          <select className="form-select" value={form.site} onChange={e => set('site', e.target.value)}>
            <option value="">—</option>{[...new Set([...(engagement.sites || []), ...live.map(e => e.site).filter(Boolean)])].map(s => <option key={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      {['DEVICE', 'MULTI_DEVICE'].includes(form.scope_type) && (
        <Field label="Affected devices" required>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 120, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
            {live.filter(e => !form.site || !e.site || e.site === form.site || form.device_enrollment_ids.includes(e.id)).map(e => (
              <button key={e.id} type="button" className={`chip-toggle ${form.device_enrollment_ids.includes(e.id) ? 'on' : ''}`} onClick={() => toggleDevice(e.id)}>{equipmentLabel(e)}</button>
            ))}
          </div>
        </Field>
      )}
      <div className="form-row">
        <Field label="Priority" required><EnumSelect options={PRIORITIES} value={form.priority} onChange={v => set('priority', v)} /></Field>
        <Field label="Category" required><EnumSelect options={CATEGORIES} value={form.category} onChange={v => set('category', v)} /></Field>
      </div>
      <Field label="Issue / business impact" required><textarea className="form-textarea" value={form.issue_business_impact} onChange={e => set('issue_business_impact', e.target.value)} /></Field>
      <div className="form-row">
        <Field label="Reported at (IST)"><input type="datetime-local" className="form-input" value={toIstInput(form.reported_at)} onChange={e => set('reported_at', fromIstInput(e.target.value))} /></Field>
        <Field label="Assigned owner" hint="Required before leaving OPEN"><PersonSelect people={lookups.people} value={form.assigned_owner_user_id} onChange={v => set('assigned_owner_user_id', v)} prefer={engineers} placeholder="Unassigned" /></Field>
      </div>
      <div className="form-row">
        <Field label="Next action"><input className="form-input" value={form.next_action} onChange={e => set('next_action', e.target.value)} /></Field>
        <Field label="Action due (IST)"><input type="datetime-local" className="form-input" value={toIstInput(form.action_due_at)} onChange={e => set('action_due_at', fromIstInput(e.target.value))} /></Field>
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13 }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={form.status === 'IN_PROGRESS'} onChange={e => set('status', e.target.checked ? 'IN_PROGRESS' : 'OPEN')} /> Start work now (In progress)</label>
        {form.device_enrollment_ids.length > (pre ? 1 : 0) && <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={linkToday} onChange={e => setLinkToday(e.target.checked)} /> Link the affected devices' checks for the day</label>}
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={form.customer_visible} onChange={e => set('customer_visible', e.target.checked)} /> Customer visible</label>
      </div>
      {form.assigned_owner_user_id === profile?.id && <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 6 }}>You are the owner — the incident is acknowledged when you start work.</div>}
      <DeviceIncidentHistory ctx={ctx} enrollmentIds={['DEVICE', 'MULTI_DEVICE'].includes(form.scope_type) ? form.device_enrollment_ids : []} site={form.scope_type === 'SITE' ? form.site : null} />
    </Modal>
  )
}

function IncidentDetail({ ctx, incident, onClose }) {
  const { engagement, enrollments, lookups, perms, profile, cur, reloadIncidents } = ctx
  const [form, setForm] = useState(incident)
  const [comments, setComments] = useState(null)
  const [events, setEvents] = useState(null)
  const [links, setLinks] = useState([])
  const [checksById, setChecksById] = useState({})
  const [comment, setComment] = useState({ body: '', hours: '' })
  const [transition, setTransition] = useState(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [warranty, setWarranty] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const person = id => lookups.people.find(p => p.id === id)?.full_name
  const enrById = Object.fromEntries(enrollments.map(e => [e.id, e]))
  const engineers = ['FIRMWARE_ENGINEER', 'APPLICATION_ENGINEER', 'ESCALATION_OWNER', 'ONSITE_COORDINATOR'].flatMap(r => [cur[r]?.primary_user_id, cur[r]?.backup_user_id])
  const canWork = !['CLOSED', 'CANCELLED'].includes(engagement.status) && (perms.canManage || perms.firmware || perms.application || perms.onsite || incident.assigned_owner_user_id === profile.id)
  const cfg = engagement.config || {}

  useEffect(() => { setForm(incident) }, [incident])
  useEffect(() => { loadSide() }, [incident.id])
  // History reloads whenever the incident row changes (save, transition, comment)
  useEffect(() => { listEntityEvents(incident.id).then(setEvents).catch(e => { setEvents([]); setError(errText(e)) }) }, [incident.id, incident.updated_at, incident.status])
  async function loadSide() {
    try {
      const [c, l] = await Promise.all([listComments(incident.id), listLinks(engagement.id)])
      setComments(c)
      const mine = l.filter(x => x.incident_id === incident.id)
      setLinks(mine)
      if (mine.length) {
        const rows = await getChecksByIds(mine.map(x => x.check_id))
        setChecksById(Object.fromEntries(rows.map(x => [x.id, x])))
      }
      const firstDevice = enrById[(incident.device_enrollment_ids || [])[0]]
      if (incident.category === 'HARDWARE' && firstDevice) setWarranty({ enrollment: firstDevice, ...(await getDevice360(firstDevice)) })
    } catch (e) { setError(errText(e)) }
  }

  async function saveFields() {
    setError(''); setInfo('')
    try {
      const { status, ...rest } = form // status only changes through transitions
      await updateIncident(incident, rest)
      await reloadIncidents(); setInfo('Saved')
    } catch (e) { setError(e instanceof ConflictError ? `${e.message}.` : errText(e)); if (e instanceof ConflictError) reloadIncidents() }
  }

  async function doTransition(to, extra = {}) {
    setError(''); setInfo('')
    try {
      await updateIncident(incident, { ...form, ...extra, status: to })
      setTransition(null)
      await reloadIncidents()
    } catch (e) { setError(errText(e)) }
  }

  async function postComment() {
    if (!comment.body.trim()) return
    try { await addComment(incident.id, comment.body, comment.hours, profile.id); setComment({ body: '', hours: '' }); await Promise.all([loadSide(), reloadIncidents()]) } catch (e) { setError(errText(e)) }
  }

  async function linkTodaysChecks() {
    try {
      const d = istToday()
      const day = await listChecks(engagement.id, { from: d, to: d })
      const ids = day.filter(c => (incident.device_enrollment_ids || []).includes(c.enrollment_id)).map(c => c.id)
      if (!ids.length) { setInfo('No checks logged today for the affected devices'); return }
      await linkChecks(incident.id, ids); await loadSide(); setInfo(`Linked ${ids.length} check(s)`)
    } catch (e) { setError(errText(e)) }
  }

  async function claim() {
    try {
      const c = await raiseWarrantyClaim(incident, warranty.enrollment, profile.id)
      await reloadIncidents(); setInfo(`Warranty claim ${c.claim_number} raised`)
    } catch (e) { setError(errText(e)) }
  }

  const flag = computeFollowUpFlag(incident)
  const nexts = {
    OPEN: ['IN_PROGRESS', 'AWAITING_SITE', 'AWAITING_VENDOR', 'RESOLVED'],
    IN_PROGRESS: ['AWAITING_SITE', 'AWAITING_VENDOR', 'RESOLVED'],
    AWAITING_SITE: ['IN_PROGRESS', 'AWAITING_VENDOR', 'RESOLVED'],
    AWAITING_VENDOR: ['IN_PROGRESS', 'AWAITING_SITE', 'RESOLVED'],
    RESOLVED: ['CLOSED'],
    CLOSED: [],
  }[incident.status] || []
  const reopenable = ['RESOLVED', 'CLOSED'].includes(incident.status)

  return (
    <Modal open size="lg" title={`${incident.number} · ${incident.title}`} onClose={onClose}>
      <ErrorLine error={error} />
      {info && <div style={{ fontSize: 12, color: '#047857', marginBottom: 8 }}>{info}</div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <PriorityBadge priority={incident.priority} /> <Chip>{labelOf(INCIDENT_STATUSES, incident.status)}</Chip> <FlagBadge flag={flag} />
        {incident.legacy_ref && <Chip>Excel {incident.legacy_ref}</Chip>}
        {incident.chargeable_candidate && <Chip tone="amber" title="Out-of-warranty hardware — for Finance review">Chargeable candidate</Chip>}
        {incident.handed_over_at && <Chip>Handed over to {incident.handed_over_to}</Chip>}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-muted)' }}>Reported {istDateTime(incident.reported_at)} · ack {incident.acknowledged_at ? istDateTime(incident.acknowledged_at) : 'pending'}</span>
      </div>

      {canWork && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {nexts.filter(s => s !== 'CLOSED' || perms.canManage).map(s => (
            <button key={s} className={`btn btn-sm ${s === 'RESOLVED' || s === 'CLOSED' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTransition(s)}>
              {s === 'CLOSED' ? <><ShieldCheck size={12} /> Verify & close</> : `→ ${labelOf(INCIDENT_STATUSES, s)}`}
            </button>
          ))}
          {reopenable && <button className="btn btn-ghost btn-sm" onClick={() => setTransition('REOPEN')}><RotateCcw size={12} /> Reopen</button>}
        </div>
      )}

      <div className="form-row">
        <Field label="Title"><input className="form-input" disabled={!canWork} value={form.title || ''} onChange={e => set('title', e.target.value)} /></Field>
        <Field label="Assigned owner"><PersonSelect people={lookups.people} disabled={!canWork} value={form.assigned_owner_user_id} onChange={v => set('assigned_owner_user_id', v)} prefer={engineers} placeholder={incident.assigned_owner_legacy ? `${incident.assigned_owner_legacy} (legacy)` : 'Unassigned'} /></Field>
      </div>
      <div className="form-row">
        <Field label="Priority"><EnumSelect options={PRIORITIES} disabled={!canWork} value={form.priority} onChange={v => set('priority', v)} /></Field>
        <Field label="Category"><EnumSelect options={CATEGORIES} disabled={!canWork} value={form.category} onChange={v => set('category', v)} /></Field>
      </div>
      <Field label="Issue / business impact"><textarea className="form-textarea" disabled={!canWork} value={form.issue_business_impact || ''} onChange={e => set('issue_business_impact', e.target.value)} /></Field>
      <div className="form-row">
        <Field label="Next action" required={incident.status !== 'CLOSED'}><input className="form-input" disabled={!canWork} value={form.next_action || ''} onChange={e => set('next_action', e.target.value)} /></Field>
        <Field label="Action due (IST)" required={incident.status !== 'CLOSED'}><input type="datetime-local" className="form-input" disabled={!canWork} value={toIstInput(form.action_due_at)} onChange={e => set('action_due_at', fromIstInput(e.target.value))} /></Field>
      </div>
      <div className="form-row">
        <Field label="Vendor reference" hint="Required while awaiting vendor"><input className="form-input" disabled={!canWork} value={form.vendor_ref || ''} onChange={e => set('vendor_ref', e.target.value)} /></Field>
        <Field label="Root cause / resolution" hint="Required to resolve"><input className="form-input" disabled={!canWork} value={form.root_cause_resolution || ''} onChange={e => set('root_cause_resolution', e.target.value)} /></Field>
      </div>
      {(incident.resolved_at || incident.closed_at || incident.verified_by_user_id || incident.verified_by_legacy) && (
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 12 }}>
          Resolved {incident.resolved_at ? istDateTime(incident.resolved_at) : '—'} · Verified by {person(incident.verified_by_user_id) || incident.verified_by_legacy || '—'} · Closed {incident.closed_at ? istDateTime(incident.closed_at) : '—'}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}><input type="checkbox" disabled={!canWork} checked={!!form.customer_visible} onChange={e => set('customer_visible', e.target.checked)} /> Customer visible</label>
        {canWork && <button className="btn btn-primary btn-sm" onClick={saveFields}>Save changes</button>}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="card-title"><Link2 size={13} /> Affected devices &amp; linked checks</div>
          {canWork && (incident.device_enrollment_ids || []).length > 0 && <button className="btn btn-ghost btn-sm" onClick={linkTodaysChecks}>Link today's checks</button>}
        </div>
        <div className="card-body" style={{ fontSize: 13 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {incident.scope_type === 'SITE' && <Chip>Site-wide{incident.site ? ` · ${incident.site}` : ''}</Chip>}
            {incident.scope_type === 'PLATFORM' && <Chip>Platform</Chip>}
            {(incident.device_enrollment_ids || []).map(id => <Chip key={id}>{equipmentLabel(enrById[id])}</Chip>)}
          </div>
          {!links.length ? <span style={{ color: 'var(--ink-muted)' }}>No checks linked.</span> : links.map(l => {
            const c = checksById[l.check_id]
            return (
              <div key={l.check_id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
                <span>{c ? `${c.check_date} · ${equipmentLabel(enrById[c.enrollment_id])} · ${c.daily_result?.toLowerCase()}` : l.check_id.slice(0, 8)}</span>
                {canWork && <button className="btn btn-ghost btn-sm" title="Unlink" onClick={async () => { await unlinkCheck(l.check_id, incident.id); loadSide() }}><Unlink size={11} /></button>}
              </div>
            )
          })}
        </div>
      </div>

      {warranty && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-header"><div className="card-title"><Wrench size={13} /> Warranty</div></div>
          <div className="card-body" style={{ fontSize: 13, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{deviceLabel(warranty.device)} — {warranty.warrantyEnd ? (warranty.underWarranty ? `in warranty until ${warranty.warrantyEnd}` : `out of warranty since ${warranty.warrantyEnd}`) : 'no warranty record'}</span>
            {incident.warranty_claim_id ? <Link to="/warranty" className="btn btn-ghost btn-sm">View claim</Link>
              : warranty.underWarranty && canWork && <button className="btn btn-primary btn-sm" onClick={claim}>Raise warranty claim</button>}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header"><div className="card-title"><MessageSquare size={13} /> Updates</div></div>
        <div className="card-body">
          {!comments ? <Loader /> : !comments.length ? <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 8 }}>No updates yet.</div> : comments.map(c => (
            <div key={c.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{person(c.created_by) || '—'} · {istDateTime(c.created_at)}{c.hours_spent ? ` · ${c.hours_spent}h` : ''}</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input className="form-input" placeholder="Add an update…" value={comment.body} onChange={e => setComment(s => ({ ...s, body: e.target.value }))} onKeyDown={e => e.key === 'Enter' && postComment()} />
            <input className="form-input" style={{ width: 80 }} type="number" min={0} step={0.25} placeholder="Hours" value={comment.hours} onChange={e => setComment(s => ({ ...s, hours: e.target.value }))} />
            <button className="btn btn-ghost" onClick={postComment}>Post</button>
          </div>
        </div>
      </div>

      <IncidentHistory events={events} person={person} enrById={enrById} />
      <DeviceIncidentHistory ctx={ctx} enrollmentIds={incident.device_enrollment_ids || []} site={incident.scope_type === 'SITE' ? incident.site : null} excludeId={incident.id} />

      {transition && <TransitionModal to={transition} incident={{ ...incident, ...form }} people={lookups.people} verifierMustDiffer={cfg.verifier_must_differ !== false}
        prefer={[engagement.pm_user_id, cur.ESCALATION_OWNER?.primary_user_id, cur.ESCALATION_OWNER?.backup_user_id]}
        onClose={() => setTransition(null)} onConfirm={doTransition} />}
    </Modal>
  )
}

// Field-level audit trail from golive_events (written by the golive_audit trigger).
const HISTORY_FIELDS = {
  status: 'Status', priority: 'Priority', category: 'Category', title: 'Title', scope_type: 'Scope', site: 'Site',
  device_enrollment_ids: 'Devices', assigned_owner_user_id: 'Owner', issue_business_impact: 'Issue / impact',
  next_action: 'Next action', action_due_at: 'Action due', vendor_ref: 'Vendor ref', root_cause_resolution: 'Root cause / resolution',
  verified_by_user_id: 'Verified by', reopen_reason: 'Reopen reason', customer_visible: 'Customer visible',
  acknowledged_at: 'Acknowledged', resolved_at: 'Resolved', closed_at: 'Closed', reported_at: 'Reported',
  handed_over_to: 'Handed over to', chargeable_candidate: 'Chargeable candidate', warranty_claim_id: 'Warranty claim', deleted_at: 'Deleted',
}

function IncidentHistory({ events, person, enrById }) {
  const fmt = (k, v) => {
    if (v == null || v === '') return '—'
    if (k === 'status') return labelOf(INCIDENT_STATUSES, v)
    if (k === 'priority') return labelOf(PRIORITIES, v)
    if (k === 'category') return labelOf(CATEGORIES, v)
    if (k === 'scope_type') return labelOf(SCOPE_TYPES, v)
    if (k.endsWith('_user_id')) return person(v) || 'Unknown user'
    if (k === 'device_enrollment_ids') return (v || []).map(id => equipmentLabel(enrById[id])).join(', ') || '—'
    if (k === 'warranty_claim_id') return 'Raised'
    if (k.endsWith('_at')) return istDateTime(v)
    if (typeof v === 'boolean') return v ? 'Yes' : 'No'
    return String(v)
  }
  const describe = ev => ev.event_type === 'created'
    ? ['Incident raised']
    : Object.entries(ev.changes || {}).filter(([k]) => HISTORY_FIELDS[k]).map(([k, c]) => ({ k, from: fmt(k, c.from), to: fmt(k, c.to) }))
  const rows = (events || []).map(ev => ({ ev, items: describe(ev) })).filter(r => r.items.length).reverse()

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-header"><div className="card-title"><History size={13} /> History</div></div>
      <div className="card-body" style={{ fontSize: 12.5, maxHeight: 320, overflowY: 'auto' }}>
        {!events ? <Loader /> : !rows.length ? <div style={{ color: 'var(--ink-muted)' }}>No history recorded yet.</div> : rows.map(({ ev, items }) => (
          <div key={ev.id} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ width: 8, height: 8, borderRadius: 999, marginTop: 5, flexShrink: 0, background: ['status_changed', 'created'].includes(ev.event_type) ? 'var(--c1)' : 'var(--border)' }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{istDateTime(ev.created_at)} · {person(ev.actor_id) || (ev.actor_id ? 'Unknown user' : 'System')}</div>
              {items.map((it, n) => typeof it === 'string' ? <div key={n} style={{ fontWeight: 600 }}>{it}</div> : (
                <div key={n} style={{ wordBreak: 'break-word' }}>
                  <span style={{ fontWeight: 600 }}>{HISTORY_FIELDS[it.k]}</span>: <span style={{ color: 'var(--ink-muted)', textDecoration: 'line-through' }}>{it.from}</span> → {it.to}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Earlier incidents on the same device(s) / site, so repeat issues are visible when raising or working one.
function DeviceIncidentHistory({ ctx, enrollmentIds, site, excludeId }) {
  const { incidents, lookups } = ctx
  const ids = enrollmentIds || []
  if (!ids.length && !site) return null
  const rows = incidents
    .filter(i => i.id !== excludeId && ((i.device_enrollment_ids || []).some(id => ids.includes(id)) || (site && i.scope_type === 'SITE' && i.site === site)))
    .sort((a, b) => new Date(b.reported_at) - new Date(a.reported_at))
  const person = id => lookups.people.find(p => p.id === id)?.full_name
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-header"><div className="card-title"><History size={13} /> Previous incidents on {ids.length ? (ids.length > 1 ? 'these devices' : 'this device') : 'this site'} · {rows.length}</div></div>
      <div className="card-body" style={{ fontSize: 12.5, maxHeight: 220, overflowY: 'auto' }}>
        {!rows.length ? <div style={{ color: 'var(--ink-muted)' }}>No earlier incidents.</div> : rows.map(i => (
          <div key={i.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <strong>{i.number}</strong>
            <span style={{ flex: 1, minWidth: 140 }}>{i.title}</span>
            <PriorityBadge priority={i.priority} />
            <Chip tone={['CLOSED', 'RESOLVED'].includes(i.status) ? 'green' : 'amber'}>{labelOf(INCIDENT_STATUSES, i.status)}</Chip>
            <span style={{ color: 'var(--ink-muted)', fontSize: 11.5 }}>{istDateTime(i.reported_at)}{person(i.assigned_owner_user_id) ? ` · ${person(i.assigned_owner_user_id)}` : ''}</span>
            {i.root_cause_resolution && <div style={{ width: '100%', fontSize: 11.5, color: 'var(--ink-soft)' }}>Resolution: {i.root_cause_resolution}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function TransitionModal({ to, incident, people, verifierMustDiffer, prefer, onClose, onConfirm }) {
  const reopen = to === 'REOPEN'
  const target = reopen ? 'IN_PROGRESS' : to
  const [extra, setExtra] = useState({
    root_cause_resolution: incident.root_cause_resolution || '', verified_by_user_id: incident.verified_by_user_id || '',
    reopen_reason: '', next_action: incident.next_action || '', action_due_at: incident.action_due_at || '', vendor_ref: incident.vendor_ref || '',
    assigned_owner_user_id: incident.assigned_owner_user_id || '',
  })
  const set = (k, v) => setExtra(e => ({ ...e, [k]: v }))
  const merged = { ...incident, ...extra, reopen_reason: reopen ? extra.reopen_reason : incident.reopen_reason }
  const errs = transitionErrors(merged, target, { verifierMustDiffer })
  const needs = f => ({
    owner: target !== 'OPEN', action: ['IN_PROGRESS', 'AWAITING_SITE', 'AWAITING_VENDOR'].includes(target),
    vendor: target === 'AWAITING_VENDOR', root: target === 'RESOLVED', verify: target === 'CLOSED',
  })[f]
  return (
    <Modal open title={reopen ? 'Reopen incident' : `Move to ${labelOf(INCIDENT_STATUSES, target)}`} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={errs.length > 0} onClick={() => onConfirm(target, reopen ? extra : Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'reopen_reason')))}>Confirm</button></>}>
      {reopen && <Field label="Reason to reopen" required><textarea className="form-textarea" value={extra.reopen_reason} onChange={e => set('reopen_reason', e.target.value)} /></Field>}
      {needs('owner') && !incident.assigned_owner_user_id && <Field label="Assigned owner" required><PersonSelect people={people} value={extra.assigned_owner_user_id} onChange={v => set('assigned_owner_user_id', v)} /></Field>}
      {needs('action') && <>
        <Field label="Next action" required><input className="form-input" value={extra.next_action} onChange={e => set('next_action', e.target.value)} /></Field>
        <Field label="Action due (IST)" required><input type="datetime-local" className="form-input" value={toIstInput(extra.action_due_at)} onChange={e => set('action_due_at', fromIstInput(e.target.value))} /></Field>
      </>}
      {needs('vendor') && <Field label="Vendor reference" required><input className="form-input" value={extra.vendor_ref} onChange={e => set('vendor_ref', e.target.value)} /></Field>}
      {needs('root') && <Field label="Root cause / resolution" required><textarea className="form-textarea" value={extra.root_cause_resolution} onChange={e => set('root_cause_resolution', e.target.value)} /></Field>}
      {needs('verify') && <Field label="Verified by" required hint={verifierMustDiffer ? 'Must be different from the assigned owner' : null}>
        <PersonSelect people={people.filter(p => !verifierMustDiffer || p.id !== incident.assigned_owner_user_id)} value={extra.verified_by_user_id} onChange={v => set('verified_by_user_id', v)} prefer={prefer} />
      </Field>}
      {errs.length > 0 && <div style={{ fontSize: 12, color: '#b45309' }}>Still needed: {errs.join(', ')}</div>}
      {reopen && <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Reopening clears the resolved/closed stamps; the timeline keeps the history.</div>}
    </Modal>
  )
}
