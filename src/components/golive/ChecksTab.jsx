import { useState, useEffect, useMemo, useCallback } from 'react'
import { dateFmt } from '../../lib/supabase'
import {
  listChecks, saveCheckSection, listLinks, linkChecks, uploadEvidence, evidenceUrl, deviceLabel, ConflictError, SECTION_FIELDS,
} from '../../lib/goLive'
import {
  CHECK_STATUSES, CONNECTIVITY_STATUSES, OPERATION_OPTIONS, DAILY_RESULTS, computeDailyResult, isStaleWhileOnline, failingFields,
  istToday, addDays, toIstInput, fromIstInput, mapEnum, excelToUtcIso, daysBetween,
  checkParameters, fillParameterChecks, parameterSummary, SEVERITIES,
} from '../../lib/goLiveRules'
import { Modal, Loader, Empty, Badge } from '../ui'
import { listHoursCompare, setCheckHours, toleranceOf } from '../../lib/goLiveHours'
import { hoursStatus, toleranceFor, summarizeHours, fuelLph, HOURS_STATUSES, ACTION_STATUSES } from '../../lib/goLiveHoursRules'
import { UploadModal, ToleranceModal, TaskModal, AcceptModal } from './HoursParts'
import { ResultBadge, PersonSelect, EnumSelect, Field, ErrorLine, Chip, Kpi, Search, errText, GoLiveBadge, DeviceFilterSelects } from './shared'
import { IncidentForm } from './IncidentsTab'
import { listDeviceSensors, SENSOR_HEALTH } from '../../lib/deviceMaster'
import { Eye, AlertTriangle, CheckCheck, ClipboardPaste, Save, LayoutGrid, FileText, Paperclip, Link2, Plus, ChevronLeft, ChevronRight, Upload, Settings2, Timer } from 'lucide-react'

const STATUS_COLS = [
  { key: 'power_check', label: 'Power', section: 'onsite', options: CHECK_STATUSES, pass: 'PASS' },
  { key: 'cable_indicator_check', label: 'Cable / ind.', section: 'onsite', options: CHECK_STATUSES, pass: 'PASS' },
  { key: 'connectivity', label: 'Operation', section: 'onsite', options: OPERATION_OPTIONS, pass: 'ONLINE' },
  { key: 'firmware_health', label: 'Firmware', section: 'firmware', options: CHECK_STATUSES, pass: 'PASS' },
  { key: 'application_health', label: 'Application', section: 'application', options: CHECK_STATUSES, pass: 'PASS' },
  { key: 'data_quality', label: 'Data quality', section: 'application', options: CHECK_STATUSES, pass: 'PASS' },
]
const STICKY = { position: 'sticky', left: 0, zIndex: 1, background: 'var(--surface)', boxShadow: '1px 0 0 var(--border)' }
// Hours are part of the check (STEP238): manual log in the firmware
// section, IoT hours in the application section. They're stored as
// golive_hours_readings, not on the check row.
const HOUR_FIELDS = {
  manual_running_hours: { source: 'MANUAL', section: 'firmware' },
  manual_offline_hours: { source: 'MANUAL', section: 'firmware' },
  iot_running_hours: { source: 'IOT', section: 'application' },
  iot_offline_hours: { source: 'IOT', section: 'application' },
  iot_fuel_litres: { source: 'IOT', section: 'application' },
}
const isHourKey = k => k in HOUR_FIELDS
const hoursFromRow = h => (h ? { manual_running_hours: h.manual_hours, manual_offline_hours: h.manual_offline_hours, iot_running_hours: h.iot_hours, iot_offline_hours: h.iot_offline_hours, iot_fuel_litres: h.iot_fuel_litres } : {})
const pctText = n => (n == null ? '' : `${n > 0 ? '+' : ''}${n}%`)

// Saves changed hour fields; the unchanged half of each source comes from `base`.
async function saveHours(enrollmentId, date, draft, base) {
  for (const source of ['MANUAL', 'IOT']) {
    const run = source === 'MANUAL' ? 'manual_running_hours' : 'iot_running_hours'
    const off = source === 'MANUAL' ? 'manual_offline_hours' : 'iot_offline_hours'
    const fuelKey = source === 'IOT' ? 'iot_fuel_litres' : null
    if (!(run in draft) && !(off in draft) && !(fuelKey && fuelKey in draft)) continue
    const running = run in draft ? draft[run] : base[run]
    const offline = off in draft ? draft[off] : base[off]
    const fuel = fuelKey ? (fuelKey in draft ? draft[fuelKey] : base[fuelKey]) : null
    // every field is optional; all three blank clears the reading
    await setCheckHours(enrollmentId, date, source, running, offline, fuel)
  }
}

// JSON with sorted object keys, so a jsonb round trip doesn't read as a change
const stable = x => JSON.stringify(x ?? null, (k, val) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val))
const sectionOf = k => Object.entries(SECTION_FIELDS).find(([, f]) => f.includes(k))?.[0]

export default function ChecksTab({ ctx }) {
  const { engagement, enrollments, incidents, lookups, perms, cur, params, setParams, profile, reloadIncidents } = ctx
  const [date, setDateState] = useState(params.get('date') || istToday())
  const [checks, setChecks] = useState(null)
  const [links, setLinks] = useState([])
  const [drafts, setDrafts] = useState({})
  const [view, setView] = useState('grid')
  const [filters, setFilters] = useState({ result: '', site: '', reviewer: '' })
  const [q, setQ] = useState('')
  const [openForm, setOpenForm] = useState(null)
  const [attention, setAttention] = useState(null)
  const [pasting, setPasting] = useState(false)
  const [editReason, setEditReason] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [hours, setHours] = useState([])
  const [hoursError, setHoursError] = useState('')
  const [hoursUpload, setHoursUpload] = useState(null) // 'MANUAL' | 'IOT'
  const [tolOpen, setTolOpen] = useState(false)
  const [hoursAct, setHoursAct] = useState(null) // { row, kind: 'task' | 'accept' }
  // faulty sensors per device — a faulty sensor makes the day ATTENTION (STEP249)
  const [faultyOf, setFaultyOf] = useState({})
  useEffect(() => {
    listDeviceSensors(enrollments.map(e => e.device_id))
      .then(r => setFaultyOf(r.filter(x => x.sensor_status === 'FAULTY').reduce((m, x) => ((m[x.device_id] = (m[x.device_id] || 0) + 1), m), {})))
      .catch(() => setFaultyOf({}))
  }, [enrollments.map(e => e.device_id).join()])
  const cfg = engagement.config || {}
  const checkParams = checkParameters(cfg)
  const tol = toleranceOf(engagement)
  const live = ['ACTIVE', 'EXIT_REVIEW'].includes(engagement.status)
  const backDated = daysBetween(date, istToday()) > Number(cfg.back_date_days ?? 1)

  const setDate = d => {
    setDateState(d); setDrafts({})
    const p = new URLSearchParams(params); p.set('date', d); setParams(p, { replace: true })
  }

  const load = useCallback(async () => {
    setError('')
    try {
      const [c, l, h] = await Promise.all([
        listChecks(engagement.id, { from: date, to: date }), listLinks(engagement.id),
        // checks still load when hours can't — but say why, and lock hour entry
        listHoursCompare(engagement.id, { from: date, to: date }).then(h => { setHoursError(''); return h }).catch(err => { setHoursError(errText(err)); return [] }),
      ])
      setChecks(c); setLinks(l); setHours(h)
    } catch (e) { setError(errText(e)) }
  }, [engagement.id, date])
  useEffect(() => { setChecks(null); load() }, [load])

  const checkOf = useMemo(() => Object.fromEntries((checks || []).map(c => [c.enrollment_id, c])), [checks])
  const hoursOf = useMemo(() => Object.fromEntries(hours.map(h => [h.enrollment_id, h])), [hours])
  const hoursDay = useMemo(() => summarizeHours(hours).total, [hours])
  const linksOf = checkId => links.filter(l => l.check_id === checkId).map(l => incidents.find(i => i.id === l.incident_id)).filter(Boolean)

  // Devices expected on this date: ACTIVE + MAINTENANCE enrollments, plus anything already checked.
  const rows = useMemo(() => enrollments.filter(e =>
    checkOf[e.id] || (!e.unenrolled_at && e.support_status !== 'DECOMMISSIONED' && (e.enrolled_at || '').slice(0, 10) <= date)
  ), [enrollments, checkOf, date])

  const resolveUser = (e, role, col) => e[col] || (cur[role]?.primary_unavailable && cur[role]?.backup_user_id ? cur[role].backup_user_id : cur[role]?.primary_user_id) || null
  const valueOf = e => ({ ...(checkOf[e.id] || { site_snapshot: e.site, equipment_snapshot: e.equipment_id }), ...hoursFromRow(hoursOf[e.id]), ...(drafts[e.id] || {}) })
  const withEquip = (h, e) => ({ ...h, equipment: e.equipment_name || e.equipment_id || deviceLabel(e.device) })
  // the shared device filter (Go-live / custom fields) scopes the KPIs and the list
  const scoped = rows.filter(ctx.matchDev)
  const missing = scoped.filter(e => e.support_status === 'ACTIVE' && !checkOf[e.id])

  const shown = scoped.filter(e => {
    const v = valueOf(e)
    const t = q.trim().toLowerCase()
    return (!filters.result || (checkOf[e.id]?.daily_result || 'NONE') === filters.result)
      && (!t || [e.device?.device_code, e.device?.serial_number, e.equipment_id, e.equipment_name, e.equipment_category, v.site_snapshot, e.site].some(x => (x || '').toLowerCase().includes(t)))
      && (!filters.site || (v.site_snapshot || e.site) === filters.site)
      && (!filters.reviewer || [v.firmware_reviewer_user_id, v.application_reviewer_user_id].includes(filters.reviewer))
  })
  const sites = [...new Set(rows.map(e => e.site).filter(Boolean))]

  const setDraft = (id, k, v) => setDrafts(d => ({ ...d, [id]: { ...(d[id] || {}), [k]: v } }))
  const canSection = s => live && (s === 'onsite' ? perms.onsite : s === 'firmware' ? perms.firmware : s === 'application' ? perms.application : true)
  // hour inputs follow their section, but stay locked if hours can't be read (saving would blank values)
  const canHours = key => !hoursError && canSection(HOUR_FIELDS[key].section)

  // Saves the changed sections of one device row, in order onsite → firmware → application.
  async function saveRow(e, fullDraft = drafts[e.id]) {
    if (!fullDraft || !Object.keys(fullDraft).length) return null
    const draft = Object.fromEntries(Object.entries(fullDraft).filter(([k]) => !isHourKey(k)))
    const hourDraft = Object.fromEntries(Object.entries(fullDraft).filter(([k]) => isHourKey(k)))
    let existing = checkOf[e.id]
    const sections = [...new Set(Object.keys(draft).map(sectionOf).filter(Boolean))]
    const order = ['onsite', 'firmware', 'application', 'shared'].filter(s => sections.includes(s))
    let saved = existing
    for (const s of order) {
      if (s === 'shared' && order.length > 1) continue // shared fields ride along with the first real section
      const values = { ...draft }
      if (s === 'onsite' && !values.onsite_coordinator_user_id && !existing?.onsite_coordinator_user_id) values.onsite_coordinator_user_id = resolveUser(e, 'ONSITE_COORDINATOR', 'onsite_coordinator_user_id') || profile.id
      if (s === 'firmware' && !values.firmware_reviewer_user_id && !existing?.firmware_reviewer_user_id) values.firmware_reviewer_user_id = profile.id
      if (s === 'application' && !values.application_reviewer_user_id && !existing?.application_reviewer_user_id) values.application_reviewer_user_id = profile.id
      if (backDated && existing) values.edit_reason = editReason
      const sectionKey = s === 'shared' ? (perms.onsite ? 'onsite' : perms.firmware ? 'firmware' : 'application') : s
      saved = await saveCheckSection({ existing: saved, engagementId: engagement.id, enrollmentId: e.id, checkDate: date }, sectionKey,
        s === order[0] ? values : Object.fromEntries(Object.entries(values).filter(([k]) => SECTION_FIELDS[s].includes(k))))
      existing = saved
    }
    if (Object.keys(hourDraft).length) await saveHours(e.id, date, hourDraft, hoursFromRow(hoursOf[e.id]))
    return saved
  }

  async function saveOne(e) {
    setSaving(true); setError('')
    try {
      const saved = await saveRow(e)
      setDrafts(d => { const n = { ...d }; delete n[e.id]; return n })
      await load()
      if (saved) promptIfAttention(e, saved)
    } catch (err) { handleErr(err) }
    setSaving(false)
  }

  async function saveAll() {
    setSaving(true); setError('')
    const failed = []
    const needPrompt = []
    for (const e of rows.filter(r => drafts[r.id])) {
      const v = valueOf(e)
      try {
        const saved = await saveRow(e)
        setDrafts(d => { const n = { ...d }; delete n[e.id]; return n })
        if (saved?.daily_result === 'ATTENTION') needPrompt.push([e, saved])
      } catch (err) { failed.push(`${deviceLabel(e.device)}: ${errText(err)}`) }
    }
    await load()
    if (failed.length) setError(failed.join(' · '))
    if (needPrompt.length) promptIfAttention(...needPrompt[0])
    setSaving(false)
  }

  function handleErr(err) {
    if (err instanceof ConflictError) { setError(`${err.message}. Reloaded — make your change again.`); load() }
    else setError(errText(err))
  }

  // R-A1: ATTENTION without an incident → raise / link / waive.
  function promptIfAttention(e, saved) {
    if (saved.daily_result !== 'ATTENTION' || cfg.require_incident_on_attention === false) return
    if (links.some(l => l.check_id === saved.id) || saved.attention_waiver_reason) return
    setAttention({ enrollment: e, check: saved })
  }

  // "Set all to Pass" for a column — fills only blank cells the user can edit.
  function setAllPass(col) {
    if (!canSection(col.section)) return
    setDrafts(d => {
      const n = { ...d }
      for (const e of shown) {
        if (e.support_status === 'DECOMMISSIONED') continue
        if (!valueOf(e)[col.key]) n[e.id] = { ...(n[e.id] || {}), [col.key]: col.pass }
      }
      return n
    })
  }

  const draftCount = Object.keys(drafts).length
  const person = id => lookups.people.find(p => p.id === id)?.full_name
  const prefer = role => [cur[role]?.primary_user_id, cur[role]?.backup_user_id, ...enrollments.map(e => e[{ ONSITE_COORDINATOR: 'onsite_coordinator_user_id', FIRMWARE_ENGINEER: 'firmware_engineer_user_id', APPLICATION_ENGINEER: 'application_engineer_user_id' }[role]])]

  const resultOf = e => checkOf[e.id]?.daily_result || 'NONE'
  const expected = scoped.filter(e => e.support_status === 'ACTIVE')
  const count = r => scoped.filter(e => resultOf(e) === r).length
  const loggedActive = expected.filter(e => checkOf[e.id]).length
  const liveDue = expected.filter(e => e.is_golive)
  const liveLogged = liveDue.filter(e => checkOf[e.id])
  const liveHealthy = liveLogged.filter(e => resultOf(e) === 'HEALTHY').length
  const pickLive = () => ctx.setDeviceFilter(d => ({ ...d, golive: d.golive === 'YES' ? '' : 'YES' }))
  const pickResult = r => setFilters(f => ({ ...f, result: f.result === r ? '' : r }))
  const cardTone = r => ({ HEALTHY: 'healthy', ATTENTION: 'attention', INCOMPLETE: 'incomplete' }[r] || '')
  // section progress for a card: done when the section's status is in, fail when it failed
  const steps = v => [
    { label: 'Onsite', done: !!(v.power_check && v.cable_indicator_check && v.connectivity), fail: v.power_check === 'FAIL' || v.cable_indicator_check === 'FAIL' || ['OFFLINE', 'INTERMITTENT'].includes(v.connectivity) },
    { label: 'Firmware', done: !!v.firmware_health, fail: v.firmware_health === 'FAIL' },
    { label: 'Application', done: !!(v.application_health && v.data_quality), fail: v.application_health === 'FAIL' || v.data_quality === 'FAIL' },
  ]

  return (
    <div>
      {checks && scoped.length > 0 && (
        <div className="gl-kpis">
          <Kpi label="Devices due" value={expected.length} sub={`${scoped.length - expected.length} in maintenance`} accent="#6366f1" active={!filters.result} onClick={() => setFilters(f => ({ ...f, result: '' }))} />
          <Kpi label="Logged" value={`${loggedActive}/${expected.length}`} sub={expected.length ? `${Math.round((loggedActive / expected.length) * 100)}% coverage` : '—'} accent="#0ea5e9" />
          <Kpi label="Healthy" value={count('HEALTHY')} sub="All sections pass" accent="#10b981" active={filters.result === 'HEALTHY'} onClick={() => pickResult('HEALTHY')} />
          <Kpi label="Attention" value={count('ATTENTION')} sub="A check failed" accent="#ef4444" active={filters.result === 'ATTENTION'} onClick={() => pickResult('ATTENTION')} />
          <Kpi label="Incomplete" value={count('INCOMPLETE')} sub="Sections pending" accent="#f59e0b" active={filters.result === 'INCOMPLETE'} onClick={() => pickResult('INCOMPLETE')} />
          <Kpi label="Go-live checked" value={`${liveLogged.length}/${liveDue.length}`} sub={liveLogged.length ? `${liveHealthy} healthy · ${Math.round((liveHealthy / liveLogged.length) * 100)}%` : 'Go-live = Yes devices'} accent="#059669" active={ctx.deviceFilter.golive === 'YES'} onClick={pickLive} />
          <Kpi label="Not logged" value={count('NONE')} sub={hours.length ? `Hours ${hoursDay.match}/${hoursDay.compared} match` : 'No check yet'} accent="#94a3b8" active={filters.result === 'NONE'} onClick={() => pickResult('NONE')} />
        </div>
      )}

      {!live && <div className="card" style={{ padding: '10px 14px', marginBottom: 12, fontSize: 13, color: 'var(--ink-muted)' }}>Checks can be logged while the engagement is active.</div>}
      {live && missing.length > 0 && date <= istToday() && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 12, fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderColor: '#fcd34d' }}>
          <AlertTriangle size={15} color="#d97706" /> <strong>{missing.length} active device(s) not checked</strong> for {dateFmt(date)}:
          {missing.slice(0, 12).map(e => <Chip key={e.id} tone="amber">{deviceLabel(e.device)}</Chip>)}{missing.length > 12 && <span>+{missing.length - 12} more</span>}
        </div>
      )}
      {live && backDated && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>
          <Field label={`This date is more than ${cfg.back_date_days ?? 1} day(s) old — reason for editing saved checks (optional)`}>
            <input className="form-input" value={editReason} onChange={e => setEditReason(e.target.value)} placeholder="e.g. Coordinator's paper log entered late" />
          </Field>
        </div>
      )}
      <ErrorLine error={error} />
      {hoursError && <div className="card" style={{ padding: '10px 12px', marginBottom: 12, fontSize: 13, color: '#b45309' }}>Hours and fuel can't be shown or saved: {hoursError}</div>}

      <div className="table-wrap">
        <div className="gl-bar">
          <div className="gl-datebar">
            <button className="btn btn-ghost btn-sm" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}><ChevronLeft size={14} /></button>
            <input type="date" className="form-input" value={date} max={istToday()} onChange={e => e.target.value && setDate(e.target.value)} />
            <button className="btn btn-ghost btn-sm" aria-label="Next day" disabled={date >= istToday()} onClick={() => setDate(addDays(date, 1))}><ChevronRight size={14} /></button>
            {date !== istToday() && <button className="btn btn-ghost btn-sm" onClick={() => setDate(istToday())}>Today</button>}
          </div>
          <Search value={q} onChange={setQ} placeholder="Device, equipment, site…" />
          <select className="form-select" value={filters.result} onChange={e => setFilters(f => ({ ...f, result: e.target.value }))}>
            <option value="">All results</option>{Object.entries(DAILY_RESULTS).slice(0, 3).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}<option value="NONE">Not logged</option>
          </select>
          {sites.length > 1 && <select className="form-select" value={filters.site} onChange={e => setFilters(f => ({ ...f, site: e.target.value }))}>
            <option value="">All sites</option>{sites.map(s => <option key={s}>{s}</option>)}
          </select>}
          <select className="form-select" value={filters.reviewer} onChange={e => setFilters(f => ({ ...f, reviewer: e.target.value }))}>
            <option value="">All reviewers</option>{[...new Set((checks || []).flatMap(c => [c.firmware_reviewer_user_id, c.application_reviewer_user_id]).filter(Boolean))].map(id => <option key={id} value={id}>{person(id)}</option>)}
          </select>
          <DeviceFilterSelects ctx={ctx} />
          <div className="gl-grow" />
          <div className="gl-seg gl-desktop" role="tablist" aria-label="View">
            <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')}><LayoutGrid size={13} /> Table</button>
            <button className={view === 'form' ? 'on' : ''} onClick={() => setView('form')}><FileText size={13} /> Cards</button>
          </div>
        </div>
        {live && rows.length > 0 && (
          <div className="gl-sub">
            <span>{shown.length === rows.length ? `${rows.length} devices` : `${shown.length} of ${rows.length} devices`}</span>
            <span>{rows.filter(e => e.is_golive).length} go-live</span>
            {hours.length > 0 && <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Timer size={13} /> Hours {hoursDay.match}/{hoursDay.compared} match{hoursDay.mismatch ? ` · ${hoursDay.mismatch} mismatch` : ''}</span>}
            <span>Tolerance ±{tol.default_pct}% (min {tol.abs_hours} h){perms.canManage && <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', marginLeft: 2 }} title="Hours tolerance" onClick={() => setTolOpen(true)}><Settings2 size={12} /></button>}</span>
            <div className="gl-grow" style={{ flex: 1 }} />
            {perms.firmware && <button className="btn btn-ghost btn-sm" onClick={() => setHoursUpload('MANUAL')}><Upload size={13} /> Manual log file</button>}
            {perms.application && <button className="btn btn-ghost btn-sm" onClick={() => setHoursUpload('IOT')}><Upload size={13} /> IoT hours file</button>}
            {perms.onsite && <button className="btn btn-ghost btn-sm gl-desktop" onClick={() => setPasting(true)}><ClipboardPaste size={13} /> Paste from Excel</button>}
            <button className="btn btn-primary btn-sm gl-desktop" disabled={!draftCount || saving} onClick={saveAll}><Save size={13} /> Save {draftCount || ''} changed</button>
          </div>
        )}

        {!checks ? <Loader /> : !rows.length ? <Empty title="No devices to check" desc="Enroll devices on the Devices tab." />
          : !shown.length ? <Empty title="No devices match" desc="Change or clear the filters." /> : <>
          {view === 'grid' && (
            <div className="gl-desktop gl-tscroll">
              <table className="gl-table" style={{ minWidth: 1900 }}>
                <thead>
                  <tr className="gl-groups">
                    <th className="gl-sticky" /><th colSpan={5} />
                    <th colSpan={6} className="gl-sep">Onsite</th>
                    <th colSpan={3} className="gl-sep">Firmware</th>
                    <th colSpan={5} className="gl-sep">Application</th>
                    <th colSpan={3} className="gl-sep">Follow-up</th>
                  </tr>
                  <tr>
                    <th className="gl-sticky">Device</th><th>View</th><th>Equipment ID</th><th>Equipment name</th><th>Category</th><th>Result</th>
                    <th className="gl-sep">Coordinator</th>
                    {STATUS_COLS.slice(0, 3).map(c => <ColHead key={c.key} col={c} can={canSection(c.section)} onPass={setAllPass} />)}
                    <th title="Equipment under maintenance — Operation = No is then expected">Maintenance</th>
                    <th>Last data (IST)</th>
                    <ColHead col={STATUS_COLS[3]} can={canSection('firmware')} onPass={setAllPass} sep /><th>Reviewer</th><th title="Manual log running hours (firmware)">Manual log h</th>
                    <ColHead col={STATUS_COLS[4]} can={canSection('application')} onPass={setAllPass} sep /><th>Reviewer</th>
                    <ColHead col={STATUS_COLS[5]} can={canSection('application')} onPass={setAllPass} />
                    <th title="IoT / application running hours">IoT h</th><th title="Fuel consumed that day (litres) · average L per running hour">Fuel L · L/h</th>
                    <th className="gl-sep">Hours</th><th>Observation / action</th><th>Incidents</th>
                  </tr>
                </thead>
                <tbody>{shown.map(e => {
                  const v = valueOf(e)
                  const saved = checkOf[e.id]
                  const preview = computeDailyResult({ ...v, enrollment_id: e.id, check_date: date }, { faultySensors: faultyOf[e.device_id] })
                  const dirty = !!drafts[e.id]
                  const stale = cfg.stale_data_warning !== false && isStaleWhileOnline(v, e.expected_reporting_interval_min, Number(cfg.stale_multiplier || 2), v.onsite_submitted_at ? new Date(v.onsite_submitted_at) : new Date())
                  const inc = saved ? linksOf(saved.id) : []
                  const needsInc = saved?.daily_result === 'ATTENTION' && !inc.length && !saved.attention_waiver_reason && cfg.require_incident_on_attention !== false
                  const hrs = key => (
                    <td>
                      <input type="number" min={0} step={0.1} className="form-input num" style={{ width: 72 }}
                        disabled={!canHours(key)} value={v[key] ?? ''} placeholder="h"
                        onChange={x => setDraft(e.id, key, x.target.value === '' ? null : x.target.value)} />
                    </td>
                  )
                  const tolE = toleranceFor(tol, e.equipment_category)
                  const hs = hoursStatus(v.manual_running_hours, v.iot_running_hours, tolE)
                  const hRow = hoursOf[e.id]
                  const sel = (col, sep) => (
                    <td className={sep ? 'gl-sep' : undefined}>
                      <EnumSelect className="gl-sel" options={col.key === 'connectivity' && v[col.key] === 'INTERMITTENT' ? CONNECTIVITY_STATUSES : col.options} value={v[col.key]} disabled={!canSection(col.section)} style={{ minWidth: 100 }}
                        onChange={x => setDraft(e.id, col.key, x)} />
                    </td>
                  )
                  const ps = parameterSummary(v.parameter_checks, checkParams)
                  return (
                    <tr key={e.id} className={dirty ? 'dirty' : undefined}>
                      <td className="gl-sticky" style={{ minWidth: 130 }}>
                        <div className="gl-code">{deviceLabel(e.device)}</div>
                        <div className="gl-meta">{v.site_snapshot || e.site || '—'}{e.support_status === 'MAINTENANCE' ? ' · maintenance' : ''}</div>
                        <div style={{ marginTop: 3 }}><GoLiveBadge e={e} compact /></div>
                        {dirty && <div style={{ marginTop: 4 }}><button className="btn btn-primary btn-sm" style={{ padding: '2px 8px' }} disabled={saving} onClick={() => saveOne(e)}>Save</button></div>}
                      </td>
                      <td><button className="btn btn-outline btn-sm" style={{ padding: '3px 10px', fontWeight: 700, whiteSpace: 'nowrap' }} title="Open the full check" onClick={() => setOpenForm(e)}><Eye size={12} /> View</button></td>
                      <td className="nowrap" style={{ fontWeight: 600 }}>{e.equipment_id || <span className="muted">—</span>}</td>
                      <td className="nowrap">{e.equipment_name || <span className="muted">—</span>}</td>
                      <td>{e.equipment_category ? <span className="gl-tag">{e.equipment_category}</span> : <span className="muted">—</span>}</td>
                      <td className="nowrap">
                        <ResultBadge result={dirty ? preview : saved?.daily_result} />
                        {(dirty ? preview : saved?.daily_result) === 'ATTENTION' && live && (
                          <select className="form-select" style={{ marginTop: 4, width: 110, color: v.attention_severity === 'HIGH' ? '#b91c1c' : undefined, fontWeight: 600 }}
                            value={v.attention_severity || ''} title="Severity (optional)" onChange={x => setDraft(e.id, 'attention_severity', x.target.value || null)}>
                            <option value="">Severity</option>{SEVERITIES.map(sv => <option key={sv.key} value={sv.key}>{sv.label}</option>)}
                          </select>
                        )}
                        {dirty && <div className="gl-meta">unsaved</div>}
                        {needsInc && <div style={{ fontSize: 10.5, color: '#b91c1c', marginTop: 2, cursor: 'pointer', fontWeight: 600 }} onClick={() => setAttention({ enrollment: e, check: saved })}>Needs incident</div>}
                      </td>
                      <td className="gl-sep nowrap">{person(v.onsite_coordinator_user_id) || <span className="muted">{person(resolveUser(e, 'ONSITE_COORDINATOR', 'onsite_coordinator_user_id')) || '—'}</span>}</td>
                      {sel(STATUS_COLS[0])}{sel(STATUS_COLS[1])}{sel(STATUS_COLS[2])}
                      <td>
                        <select className="form-select gl-sel" data-v={v.equipment_maintenance ? 'INTERMITTENT' : ''} style={{ minWidth: 82 }} disabled={!live}
                          value={v.equipment_maintenance == null ? '' : v.equipment_maintenance ? 'YES' : 'NO'}
                          onChange={x => setDraft(e.id, 'equipment_maintenance', x.target.value === '' ? null : x.target.value === 'YES')}>
                          <option value="">—</option><option value="YES">Yes</option><option value="NO">No</option>
                        </select>
                      </td>
                      <td>
                        <input type="datetime-local" className="form-input" style={{ width: 172 }} disabled={!canSection('onsite')}
                          value={toIstInput(v.last_data_received_at)} onChange={x => setDraft(e.id, 'last_data_received_at', fromIstInput(x.target.value))} />
                        {stale && <div style={{ fontSize: 10.5, color: '#b45309', marginTop: 2 }}>Operating but data is stale</div>}
                      </td>
                      {sel(STATUS_COLS[3], true)}
                      <td className="nowrap" style={{ fontSize: 11.5 }}>{person(v.firmware_reviewer_user_id) || v.firmware_reviewer_legacy || <span className="muted">—</span>}</td>
                      {hrs('manual_running_hours')}
                      {sel(STATUS_COLS[4], true)}
                      <td className="nowrap" style={{ fontSize: 11.5 }}>
                        {person(v.application_reviewer_user_id) || v.application_reviewer_legacy || <span className="muted">—</span>}
                        {ps.notWorking > 0 && <div style={{ fontSize: 10.5, color: '#b91c1c', marginTop: 2 }} title={`Not working: ${ps.notWorkingLabels.join(', ')}`}>{ps.notWorking} param{ps.notWorking === 1 ? '' : 's'} not working</div>}
                      </td>
                      {sel(STATUS_COLS[5])}
                      {hrs('iot_running_hours')}
                      <td className="nowrap">
                        <input type="number" min={0} step={0.1} className="form-input num" style={{ width: 76 }}
                          disabled={!canHours('iot_fuel_litres')} value={v.iot_fuel_litres ?? ''} placeholder="L"
                          onChange={x => setDraft(e.id, 'iot_fuel_litres', x.target.value === '' ? null : x.target.value)} />
                        {fuelLph(v.iot_fuel_litres, v.iot_running_hours) != null && <div className="gl-meta">{fuelLph(v.iot_fuel_litres, v.iot_running_hours)} L/h</div>}
                      </td>
                      <td className="gl-sep nowrap" style={{ minWidth: 120 }}>
                        {hs.status ? <>
                          <Badge type={HOURS_STATUSES[hs.status].badge}>{HOURS_STATUSES[hs.status].label}</Badge>
                          <div className="gl-meta">{pctText(hs.diffPct)} ±{tolE.pct}%</div>
                        </> : <span className="muted">—</span>}
                        {hRow?.action_status ? <div style={{ marginTop: 3 }}><Badge type={ACTION_STATUSES[hRow.action_status]?.badge}>{ACTION_STATUSES[hRow.action_status]?.label}</Badge></div>
                          : live && !drafts[e.id] && hRow && hRow.status !== 'MATCH' && (
                            <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                              <button className="btn btn-primary btn-sm" style={{ padding: '2px 7px' }} onClick={() => setHoursAct({ row: withEquip(hRow, e), kind: 'task' })}>Task</button>
                              <button className="btn btn-ghost btn-sm" style={{ padding: '2px 7px' }} onClick={() => setHoursAct({ row: withEquip(hRow, e), kind: 'accept' })}>Accept</button>
                            </div>
                          )}
                      </td>
                      <td><input className="form-input" style={{ minWidth: 180 }} disabled={!live} value={v.observation_action || ''} onChange={x => setDraft(e.id, 'observation_action', x.target.value)} placeholder="Observation / action" /></td>
                      <td className="nowrap" style={{ fontSize: 11.5 }}>{inc.length ? inc.map(i => <div key={i.id}>{i.number}</div>) : <span className="muted">—</span>}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
          )}
          <div className={view === 'grid' ? 'gl-mobile' : undefined}>
            <div className="gl-cards">
              {shown.map(e => {
                const saved = checkOf[e.id]
                const v = valueOf(e)
                const r = saved?.daily_result
                const hs = hoursOf[e.id]?.status
                const inc = saved ? linksOf(saved.id) : []
                const needsInc = r === 'ATTENTION' && !inc.length && !saved.attention_waiver_reason && cfg.require_incident_on_attention !== false
                const ps = parameterSummary(v.parameter_checks, checkParams)
                return (
                  <button key={e.id} type="button" className={`gl-card ${cardTone(r)}`} onClick={() => setOpenForm(e)}>
                    <div className="gl-card-head">
                      <div style={{ minWidth: 0 }}>
                        <div className="gl-card-title gl-code">{deviceLabel(e.device)}</div>
                        <div className="gl-card-eq">{[e.equipment_id, e.equipment_name].filter(Boolean).join(' · ') || 'No equipment set'} <GoLiveBadge e={e} compact /></div>
                      </div>
                      {r ? <ResultBadge result={r} /> : <span className="gl-pill gray">Not logged</span>}
                    </div>
                    <div className="gl-kv">
                      <div><span>Category</span><span>{e.equipment_category || '—'}</span></div>
                      <div><span>Site</span><span>{v.site_snapshot || e.site || '—'}</span></div>
                      <div><span>Coordinator</span><span>{person(v.onsite_coordinator_user_id) || person(resolveUser(e, 'ONSITE_COORDINATOR', 'onsite_coordinator_user_id')) || '—'}</span></div>
                      <div><span>Hours (manual / IoT)</span><span>{v.manual_running_hours ?? '—'} / {v.iot_running_hours ?? '—'}</span></div>
                    </div>
                    <div className="gl-steps">
                      {steps(v).map(s => (
                        <div key={s.label} className={`gl-step${s.fail ? ' fail' : s.done ? ' done' : ''}`}>
                          <div className="gl-step-bar" /><div className="gl-step-label">{s.label}{s.fail ? ' · failed' : s.done ? ' · done' : ''}</div>
                        </div>
                      ))}
                    </div>
                    {(needsInc || hs || ps.notWorking > 0 || inc.length > 0 || e.support_status === 'MAINTENANCE' || v.equipment_maintenance) && (
                      <div className="gl-card-foot">
                        {needsInc && <span className="gl-pill red">Needs incident</span>}
                        {inc.map(i => <span key={i.id} className="gl-tag">{i.number}</span>)}
                        {hs && <span className={`gl-pill ${hs === 'MATCH' ? 'green' : hs === 'MISMATCH' ? 'red' : 'amber'}`}>Hours {(HOURS_STATUSES[hs]?.label || hs).toLowerCase()}</span>}
                        {ps.notWorking > 0 && <span className="gl-pill red" title={ps.notWorkingLabels.join(', ')}>{ps.notWorking} param{ps.notWorking === 1 ? '' : 's'} not working</span>}
                        {(e.support_status === 'MAINTENANCE' || v.equipment_maintenance) && <span className="gl-pill amber">Maintenance</span>}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </>}
      </div>

      {openForm && (
        <CheckForm ctx={ctx} enrollment={openForm} date={date} check={checkOf[openForm.id]} links={checkOf[openForm.id] ? linksOf(checkOf[openForm.id].id) : []}
          canSection={canSection} backDated={backDated} editReason={editReason} resolveUser={resolveUser} prefer={prefer}
          hoursRow={hoursOf[openForm.id]} tolerance={tol} hoursLocked={!!hoursError} onHoursAct={kind => hoursOf[openForm.id] && setHoursAct({ row: withEquip(hoursOf[openForm.id], openForm), kind })}
          onClose={() => setOpenForm(null)}
          onSaved={async saved => { await load(); if (saved) promptIfAttention(openForm, saved) }}
          onRaise={saved => setAttention({ enrollment: openForm, check: saved })} />
      )}
      {attention && (
        <AttentionPrompt ctx={ctx} {...attention} onClose={() => setAttention(null)}
          onDone={async () => { setAttention(null); await Promise.all([load(), reloadIncidents()]) }} />
      )}
      {hoursUpload && <UploadModal source={hoursUpload} ctx={ctx} onClose={() => setHoursUpload(null)} onDone={load} />}
      {tolOpen && <ToleranceModal engagement={engagement} categories={[...new Set(enrollments.map(e => e.equipment_category).filter(Boolean))]}
        onClose={() => setTolOpen(false)} onSaved={async () => { setTolOpen(false); await ctx.reloadEngagement(); await load() }} />}
      {hoursAct?.kind === 'task' && <TaskModal ctx={ctx} row={hoursAct.row} enrollment={enrollments.find(x => x.id === hoursAct.row.enrollment_id)}
        onClose={() => setHoursAct(null)} onDone={async () => { setHoursAct(null); await Promise.all([load(), reloadIncidents()]) }} />}
      {hoursAct?.kind === 'accept' && <AcceptModal row={hoursAct.row} profile={profile} onClose={() => setHoursAct(null)} onDone={async () => { setHoursAct(null); await load() }} />}
      {pasting && <PasteModal rows={rows} onClose={() => setPasting(false)} onApply={patch => { setDrafts(d => { const n = { ...d }; for (const [id, p] of Object.entries(patch)) n[id] = { ...(n[id] || {}), ...p }; return n }); setPasting(false) }} />}
    </div>
  )
}

function ColHead({ col, can, onPass, sep }) {
  return (
    <th className={sep ? 'gl-sep' : undefined} style={{ whiteSpace: 'nowrap' }}>
      {col.label}
      {can && <button title={`Set blank ${col.label} cells to ${col.pass === 'ONLINE' ? 'Yes' : 'Pass'}`} onClick={() => onPass(col)}
        style={{ marginLeft: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--c1)', padding: 0, verticalAlign: 'middle' }}><CheckCheck size={13} /></button>}
    </th>
  )
}

// Form view of one check: three separately-saveable sections (§4.4).
function CheckForm({ ctx, enrollment, date, check, links, canSection, backDated, editReason, resolveUser, prefer, hoursRow, tolerance, hoursLocked, onHoursAct, onClose, onSaved, onRaise }) {
  const { engagement, lookups, profile } = ctx
  const cfg = engagement.config || {}
  const [v, setV] = useState({ site_snapshot: enrollment.site, equipment_snapshot: enrollment.equipment_id, ...(check || {}) })
  const [saved, setSaved] = useState(check || null)
  const [hv, setHv] = useState(() => hoursFromRow(hoursRow))
  const [hvSaved, setHvSaved] = useState(() => hoursFromRow(hoursRow))
  const setH = (k, x) => setHv(s => ({ ...s, [k]: x === '' ? null : x }))
  const tolE = toleranceFor(tolerance, enrollment.equipment_category)
  const hs = hoursStatus(hv.manual_running_hours, hv.iot_running_hours, tolE)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const set = (k, x) => setV(s => ({ ...s, [k]: x }))
  const stale = cfg.stale_data_warning !== false && isStaleWhileOnline(v, enrollment.expected_reporting_interval_min, Number(cfg.stale_multiplier || 2))

  const [info, setInfo] = useState('')
  const same = (a, b) => stable(a) === stable(b) || (a != null && b != null && typeof a !== 'object' && String(a) === String(b))
  const checkParams = checkParameters(cfg)
  // sensors fitted on this device (STEP243) — listed in the popup and matched to checklist parameters
  const [sensors, setSensors] = useState(null)
  useEffect(() => { listDeviceSensors([enrollment.device_id]).then(r => setSensors(r.filter(x => x.health !== 'REMOVED'))).catch(() => setSensors([])) }, [enrollment.device_id])
  const sensorsFor = key => (sensors || []).filter(x => x.parameter_key === key)
  const faultySensors = (sensors || []).filter(x => x.sensor_status === 'FAULTY').length
  const preview = computeDailyResult({ ...v, enrollment_id: enrollment.id, check_date: date }, { faultySensors })
  const paramMap = v.parameter_checks || {}
  const setParam = (key, status) => set('parameter_checks', fillParameterChecks({ ...paramMap, [key]: status }, checkParams))
  const ps = parameterSummary(v.parameter_checks, checkParams)
  const base = saved || { site_snapshot: enrollment.site, equipment_snapshot: enrollment.equipment_id }
  const changedIn = keys => keys.filter(k => !same(v[k], base[k]))
  const hourChanges = Object.keys(HOUR_FIELDS).filter(k => !hoursLocked && canSection(HOUR_FIELDS[k].section) && !same(hv[k], hvSaved[k]))
  const pending = {
    onsite: canSection('onsite') ? changedIn(SECTION_FIELDS.onsite) : [],
    firmware: canSection('firmware') ? changedIn(SECTION_FIELDS.firmware) : [],
    application: canSection('application') ? changedIn(SECTION_FIELDS.application) : [],
    shared: changedIn(['observation_action', 'customer_visible', 'attention_waiver_reason', 'attention_severity', 'equipment_maintenance']),
  }
  const dirty = pending.onsite.length + pending.firmware.length + pending.application.length + pending.shared.length + hourChanges.length > 0
  const firstSection = ['onsite', 'firmware', 'application'].find(canSection)

  // One Save for the whole check: each changed section is sent on its own
  // (so section stamps and rights stay exact), shared fields such as the
  // observation ride along, then the hours / fuel.
  async function saveAll() {
    setBusy('save'); setError(''); setInfo('')
    try {
      let row = saved
      const sections = ['onsite', 'firmware', 'application'].filter(sec => pending[sec].length)
      if (!sections.length && pending.shared.length) sections.push(firstSection)
      for (const [i, sec] of sections.entries()) {
        const values = Object.fromEntries(pending[sec].map(k => [k, v[k]]))
        if (i === 0) pending.shared.forEach(k => { values[k] = v[k] })
        if (sec === 'onsite' && !v.onsite_coordinator_user_id) values.onsite_coordinator_user_id = resolveUser(enrollment, 'ONSITE_COORDINATOR', 'onsite_coordinator_user_id') || profile.id
        if (sec === 'firmware' && !v.firmware_reviewer_user_id) values.firmware_reviewer_user_id = profile.id
        if (sec === 'application' && !v.application_reviewer_user_id) values.application_reviewer_user_id = profile.id
        if (sec === 'application') values.parameter_checks = fillParameterChecks(v.parameter_checks, checkParams)
        if (backDated && row) values.edit_reason = editReason
        row = await saveCheckSection({ existing: row, engagementId: engagement.id, enrollmentId: enrollment.id, checkDate: date }, sec, values)
      }
      if (row !== saved) { setSaved(row); setV(x => ({ ...x, ...row })) }
      if (hourChanges.length) {
        await saveHours(enrollment.id, date, Object.fromEntries(hourChanges.map(k => [k, hv[k]])), hvSaved)
        setHvSaved(x => ({ ...x, ...Object.fromEntries(hourChanges.map(k => [k, hv[k]])) }))
      }
      setInfo('Saved')
      await onSaved(row)
    } catch (e) {
      setError(e instanceof ConflictError ? `${e.message} — close and reopen to load the latest.` : errText(e))
    }
    setBusy('')
  }

  function close() {
    if (dirty && !window.confirm('You have unsaved changes on this check. Close without saving?')) return
    onClose()
  }

  async function addEvidence(files) {
    setBusy('evidence'); setError('')
    try {
      const up = []
      for (const f of files) up.push({ ...(await uploadEvidence(f, { organizationId: engagement.organization_id, engagementId: engagement.id })), uploaded_by: profile.id })
      set('evidence', [...(v.evidence || []), ...up])
    } catch (e) { setError(errText(e)) }
    setBusy('')
  }
  async function openEvidence(path) { try { window.open(await evidenceUrl(path), '_blank', 'noopener') } catch (e) { setError(errText(e)) } }

  const status = (k, label, options) => (
    <Field label={label}><EnumSelect className="gl-sel" options={options} value={v[k]} disabled={!canSection(sectionOf(k))} onChange={x => set(k, x)} /></Field>
  )
  const SECTION_NO = { onsite: 1, firmware: 2, application: 3 }
  const sectionDone = { onsite: !!saved?.onsite_submitted_at, firmware: !!saved?.firmware_submitted_at, application: !!saved?.application_submitted_at }
  const section = (id, title, sub, children) => (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <span className={`gl-sec-num${sectionDone[id] ? ' done' : ''}`}>{sectionDone[id] ? '✓' : SECTION_NO[id]}</span>
          <div style={{ minWidth: 0 }}><div className="card-title" style={{ fontSize: 14 }}>{title}</div>{sub && <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{sub}</div>}</div>
        </div>
        {pending[id]?.length > 0 || Object.keys(HOUR_FIELDS).some(k => HOUR_FIELDS[k].section === id && hourChanges.includes(k)) ? <span style={{ fontSize: 11, color: '#b45309', fontWeight: 600 }}>Unsaved changes</span> : null}
      </div>
      <div className="card-body">{children}</div>
    </div>
  )
  const by = (id, at) => (at ? `Saved by ${lookups.people.find(p => p.id === id)?.full_name || '—'} · ${new Date(at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}` : 'Not saved yet')

  return (
    <Modal open size="lg" title={`${deviceLabel(enrollment.device)} · ${dateFmt(date)}`} onClose={close}
      footer={<>
        {info && !dirty && <span style={{ fontSize: 12, color: '#047857', marginRight: 'auto' }}>Saved</span>}
        <button className="btn btn-ghost" onClick={close}>Close</button>
        <button className="btn btn-primary" disabled={!dirty || busy === 'save'} onClick={saveAll}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
      </>}>
      <ErrorLine error={error} />
      <div className="gl-summary">
        {[['Equipment ID', enrollment.equipment_id], ['Equipment name', enrollment.equipment_name], ['Category', enrollment.equipment_category], ['Site', v.site_snapshot || enrollment.site]].map(([k, val]) => (
          <div key={k}><span>{k}</span><span title={val || ''}>{val || '—'}</span></div>
        ))}
      </div>
      {sensors && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-muted)', marginBottom: 6 }}>
            Sensors fitted ({sensors.length}){sensors.some(x => ['NOT_WORKING', 'FAULTY'].includes(x.health)) && <span style={{ color: '#b91c1c', marginLeft: 6 }}>· {sensors.filter(x => ['NOT_WORKING', 'FAULTY'].includes(x.health)).length} down</span>}
          </div>
          {!sensors.length ? <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>No sensors mapped to this device — map them in Devices → Device 360 → Sensors.</div> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 6 }}>
              {sensors.map(x => {
                const h = SENSOR_HEALTH[x.health] || { label: x.health, tone: 'gray' }
                return (
                  <div key={x.id} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8, background: '#fff', minWidth: 0 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={x.sensor_name}>{x.sensor_name}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--ink-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[x.serial_number && `SN ${x.serial_number}`, x.position, x.last_check_date && `checked ${dateFmt(x.last_check_date)}`].filter(Boolean).join(' · ') || 'No serial recorded'}</div>
                    </div>
                    <span className={`gl-pill ${!x.parameter_key && x.health === 'NOT_REVIEWED' ? 'gray' : h.tone}`} style={{ flexShrink: 0 }}
                      title={x.health === 'NOT_REVIEWED' ? (x.parameter_key ? 'Review it below: Application review → Parameters — tick, untick or N/A, then Save.' : 'No checklist parameter linked to this sensor type — set “Reports parameter” in the Sensor catalog.') : undefined}>
                      {!x.parameter_key && x.health === 'NOT_REVIEWED' ? 'No checklist link' : h.label}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13 }}>Result:</span> <ResultBadge result={preview} />
        {preview === 'ATTENTION' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>Severity</span>
            <select className="form-select" style={{ width: 120, padding: '4px 8px', color: v.attention_severity === 'HIGH' ? '#b91c1c' : undefined, fontWeight: 600 }}
              value={v.attention_severity || ''} onChange={e => set('attention_severity', e.target.value || null)}>
              <option value="">Select…</option>{SEVERITIES.map(sv => <option key={sv.key} value={sv.key}>{sv.label}</option>)}
            </select>
            {v.attention_severity === 'HIGH' && <span style={{ fontSize: 11.5, color: '#b91c1c' }}>needs an incident</span>}
          </span>
        )}
        {preview === 'ATTENTION' && <span style={{ fontSize: 12, color: '#b91c1c' }}>{failingFields({ ...v, faulty_sensors: faultySensors }).join(', ')}</span>}
        <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Firmware {v.firmware_version_snapshot || enrollment.firmware_version || '—'}</span>
      </div>

      {section('onsite', 'Onsite', by(saved?.onsite_submitted_by, saved?.onsite_submitted_at), <>
        <div className="form-row">
          <Field label="Site"><input className="form-input" value={v.site_snapshot || ''} disabled={!canSection('onsite') || !!enrollment.site} onChange={e => set('site_snapshot', e.target.value)} /></Field>
          <Field label="Onsite coordinator"><PersonSelect people={lookups.people} value={v.onsite_coordinator_user_id} disabled={!canSection('onsite')} onChange={x => set('onsite_coordinator_user_id', x)} prefer={prefer('ONSITE_COORDINATOR')} warnLabel="onsite coordinator" placeholder={lookups.people.find(p => p.id === resolveUser(enrollment, 'ONSITE_COORDINATOR', 'onsite_coordinator_user_id'))?.full_name || 'Select'} /></Field>
        </div>
        <div className="form-row">
          {status('power_check', 'Power', CHECK_STATUSES)}
          {status('cable_indicator_check', 'Cable / indicator', CHECK_STATUSES)}
        </div>
        <div className="form-row">
          {status('connectivity', 'Operation', v.connectivity === 'INTERMITTENT' ? CONNECTIVITY_STATUSES : OPERATION_OPTIONS)}
          <Field label="Equipment maintenance" hint={v.equipment_maintenance ? 'Under maintenance — Operation = No won’t flag attention' : 'Is the equipment under maintenance today?'}>
            <select className="form-select" value={v.equipment_maintenance == null ? '' : v.equipment_maintenance ? 'YES' : 'NO'} disabled={!canSection('onsite')}
              onChange={x => set('equipment_maintenance', x.target.value === '' ? null : x.target.value === 'YES')}>
              <option value="">—</option><option value="YES">Yes</option><option value="NO">No</option>
            </select>
          </Field>
          <Field label="Last data received (IST)" hint={stale ? <span style={{ color: '#b45309' }}>Operation marked Yes but data is stale</span> : `Expected every ${enrollment.expected_reporting_interval_min} min`}>
            <input type="datetime-local" className="form-input" disabled={!canSection('onsite')} value={toIstInput(v.last_data_received_at)} onChange={e => set('last_data_received_at', fromIstInput(e.target.value))} />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
          {(v.evidence || []).map(ev => <button key={ev.path} className="btn btn-ghost btn-sm" onClick={() => openEvidence(ev.path)}><Paperclip size={12} /> {ev.name}</button>)}
          {canSection('onsite') && <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}><Plus size={12} /> {busy === 'evidence' ? 'Uploading…' : 'Evidence photo / log'}
            <input type="file" multiple accept="image/*,.pdf,.txt,.log,.csv" style={{ display: 'none' }} onChange={e => addEvidence([...e.target.files])} /></label>}
        </div>
      </>)}

      {section('firmware', 'Firmware review', by(saved?.firmware_submitted_by, saved?.firmware_submitted_at), <>
        <div className="form-row">
          {status('firmware_health', 'Firmware health', CHECK_STATUSES)}
          <Field label="Reviewer"><PersonSelect people={lookups.people} value={v.firmware_reviewer_user_id} disabled={!canSection('firmware')} onChange={x => set('firmware_reviewer_user_id', x)} prefer={prefer('FIRMWARE_ENGINEER')} warnLabel="firmware engineer" placeholder="Me" /></Field>
        </div>
        <div className="form-row">
          <Field label="Manual log — running hours" hint="From the site / client manual log for this day">
            <input type="number" min={0} step={0.1} className="form-input" disabled={hoursLocked || !canSection('firmware')} value={hv.manual_running_hours ?? ''} onChange={e => setH('manual_running_hours', e.target.value)} />
          </Field>
          <Field label="Manual log — offline hours">
            <input type="number" min={0} step={0.1} className="form-input" disabled={hoursLocked || !canSection('firmware')} value={hv.manual_offline_hours ?? ''} onChange={e => setH('manual_offline_hours', e.target.value)} />
          </Field>
        </div>
      </>)}

      {section('application', 'Application review', by(saved?.application_submitted_by, saved?.application_submitted_at), <>
        <div className="form-row">
          {status('application_health', 'Application health', CHECK_STATUSES)}
          <Field label="Reviewer"><PersonSelect people={lookups.people} value={v.application_reviewer_user_id} disabled={!canSection('application')} onChange={x => set('application_reviewer_user_id', x)} prefer={prefer('APPLICATION_ENGINEER')} warnLabel="application engineer" placeholder="Me" /></Field>
        </div>
        {status('data_quality', 'Data quality', CHECK_STATUSES)}
        <div style={{ margin: '4px 0 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>Parameters</span>
            {ps.reviewed
              ? <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{ps.working} working · <span style={{ color: ps.notWorking ? '#b91c1c' : undefined }}>{ps.notWorking} not working</span> · {ps.na} N/A</span>
              : <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>Tick what shows correctly. Unticked parameters are saved as not working.</span>}
            <div style={{ flex: 1 }} />
            {canSection('application') && <>
              <button className="btn btn-ghost btn-sm" onClick={() => set('parameter_checks', Object.fromEntries(checkParams.map(p => [p.key, paramMap[p.key] === 'NA' ? 'NA' : 'WORKING'])))}><CheckCheck size={12} /> All working</button>
              {v.parameter_checks && <button className="btn btn-ghost btn-sm" onClick={() => set('parameter_checks', fillParameterChecks({}, checkParams))}>Untick all</button>}
            </>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {checkParams.map(p => {
              const st = paramMap[p.key]
              const na = st === 'NA'
              const off = !canSection('application')
              return (
                <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderBottom: '1px solid var(--border)', fontSize: 13,
                  background: v.parameter_checks && st === 'NOT_WORKING' ? '#fef2f2' : undefined }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: off || na ? 'default' : 'pointer', opacity: na ? 0.5 : 1 }}>
                    <input type="checkbox" checked={st === 'WORKING'} disabled={off || na} onChange={e => setParam(p.key, e.target.checked ? 'WORKING' : 'NOT_WORKING')} />
                    <span style={{ minWidth: 0 }}>{p.label}{p.unit && <span style={{ color: 'var(--ink-muted)', fontSize: 11 }}> · {p.unit}</span>}
                      {sensors && <span style={{ display: 'block', fontSize: 10.5, color: sensorsFor(p.key).length ? 'var(--ink-muted)' : '#b45309' }}>
                        {sensorsFor(p.key).length ? sensorsFor(p.key).map(x => [x.sensor_name, x.serial_number && `SN ${x.serial_number}`, x.position].filter(Boolean).join(' · ')).join('; ') : 'No sensor mapped'}
                      </span>}
                    </span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ink-muted)', cursor: off ? 'default' : 'pointer' }} title="The device doesn't report this parameter">
                    <input type="checkbox" checked={na} disabled={off} onChange={e => setParam(p.key, e.target.checked ? 'NA' : 'NOT_WORKING')} /> N/A
                  </label>
                </div>
              )
            })}
          </div>
        </div>
        <div className="form-row">
          <Field label="IoT / application — running hours" hint="From the application for this day">
            <input type="number" min={0} step={0.1} className="form-input" disabled={hoursLocked || !canSection('application')} value={hv.iot_running_hours ?? ''} onChange={e => setH('iot_running_hours', e.target.value)} />
          </Field>
          <Field label="IoT / application — offline hours">
            <input type="number" min={0} step={0.1} className="form-input" disabled={hoursLocked || !canSection('application')} value={hv.iot_offline_hours ?? ''} onChange={e => setH('iot_offline_hours', e.target.value)} />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Fuel consumed (litres)" hint="From the application for this day">
            <input type="number" min={0} step={0.1} className="form-input" disabled={hoursLocked || !canSection('application')} value={hv.iot_fuel_litres ?? ''} onChange={e => setH('iot_fuel_litres', e.target.value)} />
          </Field>
          <Field label="Average fuel consumption">
            <div className="form-input" style={{ background: 'var(--surface)', color: 'var(--ink-soft)' }}>
              {fuelLph(hv.iot_fuel_litres, hv.iot_running_hours) != null ? `${fuelLph(hv.iot_fuel_litres, hv.iot_running_hours)} L/h` : 'Enter fuel and IoT running hours'}
            </div>
          </Field>
        </div>
      </>)}

      {hs.status && (
        <div className="card" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
          <Timer size={15} color="var(--ink-muted)" />
          <strong>Hours</strong> manual {hv.manual_running_hours ?? '—'} h vs IoT {hv.iot_running_hours ?? '—'} h
          <Badge type={HOURS_STATUSES[hs.status].badge}>{HOURS_STATUSES[hs.status].label}</Badge>
          <span style={{ color: 'var(--ink-muted)' }}>{pctText(hs.diffPct)} · tolerance ±{tolE.pct}%{enrollment.equipment_category ? ` (${enrollment.equipment_category})` : ''}</span>
          <div style={{ flex: 1 }} />
          {hoursRow?.action_status ? <Badge type={ACTION_STATUSES[hoursRow.action_status]?.badge}>{ACTION_STATUSES[hoursRow.action_status]?.label}</Badge>
            : hoursRow && hoursRow.status !== 'MATCH' && String(hv.manual_running_hours ?? '') === String(hvSaved.manual_running_hours ?? '') && String(hv.iot_running_hours ?? '') === String(hvSaved.iot_running_hours ?? '') && <>
              <button className="btn btn-primary btn-sm" onClick={() => onHoursAct('task')}>Create field task</button>
              <button className="btn btn-ghost btn-sm" onClick={() => onHoursAct('accept')}>Accept variance</button>
            </>}
          {(String(hv.manual_running_hours ?? '') !== String(hvSaved.manual_running_hours ?? '') || String(hv.iot_running_hours ?? '') !== String(hvSaved.iot_running_hours ?? '')) && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Save to record the hours</span>}
        </div>
      )}

      <Field label="Observation / action">
        <textarea className="form-textarea" value={v.observation_action || ''} onChange={e => set('observation_action', e.target.value)} />
      </Field>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, marginBottom: 12 }}>
        <input type="checkbox" checked={!!v.customer_visible} onChange={e => set('customer_visible', e.target.checked)} /> Observation can be shared with the customer
      </label>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
        <strong>Incidents:</strong>
        {links.length ? links.map(i => <Chip key={i.id}>{i.number} · {i.title}</Chip>) : <span style={{ color: 'var(--ink-muted)' }}>none</span>}
        {saved?.attention_waiver_reason && <Chip tone="amber" title={saved.attention_waiver_reason}>Waived</Chip>}
        {saved && <button className="btn btn-ghost btn-sm" onClick={() => onRaise(saved)}><Link2 size={12} /> Raise / link incident</button>}
        <button className="btn btn-ghost btn-sm" onClick={() => { const p = new URLSearchParams(ctx.params); p.set('tab', 'devices'); p.set('notes', enrollment.id); ctx.setParams(p, { replace: true }) }}>Device notes &amp; issues</button>
      </div>
    </Modal>
  )
}

// R-A1 prompt: ATTENTION saved without an incident.
function AttentionPrompt({ ctx, enrollment, check, onClose, onDone }) {
  const { engagement, incidents, profile } = ctx
  const [mode, setMode] = useState('raise')
  const [linkId, setLinkId] = useState('')
  const [waiver, setWaiver] = useState('')
  const [error, setError] = useState('')
  const candidates = incidents.filter(i => i.status !== 'CLOSED' && ((i.device_enrollment_ids || []).includes(enrollment.id) || (i.site && i.site === check.site_snapshot) || i.scope_type === 'PLATFORM'))

  async function link() {
    setError('')
    try { await linkChecks(linkId, [check.id]); await onDone() } catch (e) { setError(errText(e)) }
  }
  async function waive() {
    setError('')
    try {
      await saveCheckSection({ existing: check, engagementId: engagement.id, enrollmentId: enrollment.id, checkDate: check.check_date }, 'shared', { attention_waiver_reason: waiver })
      await onDone()
    } catch (e) { setError(errText(e)) }
  }

  if (mode === 'raise') {
    return (
      <IncidentForm ctx={ctx} title={`Raise incident · ${deviceLabel(enrollment.device)} needs attention`}
        prefillFromCheck={{ check, enrollment }}
        prefill={check.attention_severity ? { priority: SEVERITIES.find(sv => sv.key === check.attention_severity)?.priority } : undefined}
        extraFooter={<div style={{ display: 'flex', gap: 8, marginRight: 'auto' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setMode('link')}>Link existing</button>
          {check.attention_severity !== 'HIGH' && <button className="btn btn-ghost btn-sm" onClick={() => setMode('waive')}>Waive</button>}
        </div>}
        onClose={onClose} onSaved={onDone} />
    )
  }
  return (
    <Modal open title={mode === 'link' ? 'Link an existing incident' : 'Waive incident'} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={() => setMode('raise')}>Raise new instead</button>
        {mode === 'link'
          ? <button className="btn btn-primary" disabled={!linkId} onClick={link}>Link</button>
          : <button className="btn btn-primary" disabled={!waiver.trim()} onClick={waive}>Save waiver</button>}
      </>}>
      <ErrorLine error={error} />
      <p style={{ fontSize: 13, marginTop: 0 }}>{deviceLabel(enrollment.device)} failed: {failingFields(check).join(', ')}.</p>
      {mode === 'link' ? (
        !candidates.length ? <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>No open incidents for this device or site.</div> : candidates.map(i => (
          <label key={i.id} style={{ display: 'flex', gap: 8, padding: '6px 0', fontSize: 13 }}>
            <input type="radio" name="inc" checked={linkId === i.id} onChange={() => setLinkId(i.id)} /> <strong>{i.number}</strong> {i.title}
          </label>
        ))
      ) : (
        <Field label="Why no incident is needed" required><textarea className="form-textarea" value={waiver} onChange={e => setWaiver(e.target.value)} placeholder="e.g. Planned power shutdown at site" /></Field>
      )}
    </Modal>
  )
}

// Paste tab-separated rows copied from the Excel Daily Checks sheet:
// Device ID, then Power, Cable, Connectivity, Last data received.
function PasteModal({ rows, onClose, onApply }) {
  const [text, setText] = useState('')
  const byRef = Object.fromEntries(rows.flatMap(e => [[(e.device?.device_code || '').toLowerCase(), e.id], [(e.device?.serial_number || '').toLowerCase(), e.id]]).filter(([k]) => k))
  const parsed = text.split(/\r?\n/).filter(l => l.trim()).map(l => {
    const [ref, power, cable, conn, last] = l.split('\t').map(s => s.trim())
    const id = byRef[(ref || '').toLowerCase()]
    const patch = {}
    const p = mapEnum('check', power), c = mapEnum('check', cable), n = mapEnum('connectivity', conn), t = last ? excelToUtcIso(last) : null
    if (p) patch.power_check = p
    if (c) patch.cable_indicator_check = c
    if (n) patch.connectivity = n
    if (t) patch.last_data_received_at = t
    return { ref, id, patch }
  })
  const ok = parsed.filter(r => r.id && Object.keys(r.patch).length)
  return (
    <Modal open size="lg" title="Paste onsite results" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!ok.length} onClick={() => onApply(Object.fromEntries(ok.map(r => [r.id, r.patch])))}>Apply {ok.length} row(s)</button></>}>
      <p style={{ fontSize: 13, marginTop: 0 }}>Copy columns <strong>Device ID · Power · Cable · Operation (Yes / No) · Last data received</strong> from Excel and paste below. Rows land as unsaved changes in the grid.</p>
      <textarea className="form-textarea" style={{ minHeight: 160, fontFamily: 'monospace', fontSize: 12 }} value={text} onChange={e => setText(e.target.value)} placeholder={'SN-10001\tPass\tPass\tOnline\t30/09/2026 09:10'} />
      {parsed.length > 0 && <div style={{ fontSize: 12, marginTop: 8 }}>{ok.length} matched · {parsed.filter(r => !r.id).length} unknown device(s){parsed.filter(r => !r.id).length ? `: ${parsed.filter(r => !r.id).map(r => r.ref).join(', ')}` : ''}</div>}
    </Modal>
  )
}
