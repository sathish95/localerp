import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { dateFmt } from '../../lib/supabase'
import {
  listChecks, listDeployableDevices, searchDevices, enrollDevices, updateEnrollment, bulkSetSupportStatus, bulkSetGoLive,
  replaceDevice, getDevice360, requestMasterCorrection, deviceLabel, listDeviceNotes, updateEngagement,
} from '../../lib/goLive'
import { SUPPORT_STATUSES, DAILY_RESULTS, istToday, labelOf } from '../../lib/goLiveRules'
import { exportDevicesSheet, readDevicesSheet } from '../../lib/goLiveExcel'
import { columnHeader, changesToPatch } from '../../lib/goLiveDeviceSheet'
import { Modal, Loader, Empty } from '../ui'
import { ResultBadge, PriorityBadge, FlagBadge, PersonSelect, EnumSelect, Field, ErrorLine, Chip, Kpi, Search, errText, GoLiveBadge, DeviceFilterSelects } from './shared'
import { goLiveCounts, fieldDisplay, coerceFieldValue, deviceFilterActive, EMPTY_DEVICE_FILTER, parseFieldLines, fieldLines } from '../../lib/goLiveDeviceFields'
import DeviceNotesModal, { noteCounts, NotesBadge } from './DeviceNotes'
import { Plus, Cpu, Pencil, Repeat, Eye, ScanLine, MessageSquare, Download, Upload, Radio, Rocket, SlidersHorizontal } from 'lucide-react'
import { listDeviceSensors } from '../../lib/deviceMaster'
import {
  FirmwareBadge, FirmwareSelect, FirmwareReleasesModal, useFirmwareReleases, SensorSummary, SensorHealthPill, DeviceSensorsModal,
  DeviceTasksPanel, FirmwareUpgradeModal, DeviceSensorSlots,
} from '../devices/DeviceParts'
import { CheckInHereButton, DeviceVisitsPanel } from '../devices/VisitParts'

// Support status as a pill; ended enrollments (replaced / unenrolled) read as such.
function StatusPill({ e }) {
  if (e.unenrolled_at) return <span className="gl-pill gray">{e.replaced_by_enrollment_id ? 'Replaced' : 'Unenrolled'}</span>
  const tone = { ACTIVE: 'green', MAINTENANCE: 'amber', DECOMMISSIONED: 'gray' }[e.support_status] || 'gray'
  return <span className={`gl-pill ${tone}`}>{labelOf(SUPPORT_STATUSES, e.support_status)}</span>
}

// Warranty end date, flagged when expired or within 30 days.
function Warranty({ end }) {
  if (!end) return <span className="muted" style={{ color: 'var(--ink-muted)' }}>—</span>
  const days = Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${istToday()}T00:00:00Z`)) / 86400000)
  if (days < 0) return <span className="gl-pill red" title={`Expired ${-days} day(s) ago`}>{dateFmt(end)}</span>
  if (days <= 30) return <span className="gl-pill amber" title={`Ends in ${days} day(s)`}>{dateFmt(end)}</span>
  return <span>{dateFmt(end)}</span>
}

export default function DevicesTab({ ctx }) {
  const { engagement, enrollments, incidents, lookups, perms, cur, reloadEnrollments, reloadIncidents, params, setParams, deviceFields: fields, deviceFilter, setDeviceFilter, matchDev } = ctx
  const [today, setToday] = useState([])
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [replacing, setReplacing] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [bulk, setBulk] = useState(null)
  const [bulkLive, setBulkLive] = useState(false)
  const [fieldsOpen, setFieldsOpen] = useState(false)
  const [error, setError] = useState('')
  const [notes, setNotes] = useState([])
  const [sheetBusy, setSheetBusy] = useState('')
  const [plan, setPlan] = useState(null)
  const [catFilter, setCatFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [kpi, setKpi] = useState('')
  const [sensors, setSensors] = useState([])
  const [sensorsFor, setSensorsFor] = useState(null)
  const [firmwareOpen, setFirmwareOpen] = useState(false)
  const { releases, reload: reloadReleases } = useFirmwareReleases()
  const loadSensors = () => listDeviceSensors(enrollments.map(e => e.device_id)).then(setSensors).catch(() => setSensors([]))
  useEffect(() => { loadSensors() }, [enrollments.map(e => e.device_id).join()])
  const sensorsOf = useMemo(() => sensors.reduce((m, r) => ((m[r.device_id] ||= []).push(r), m), {}), [sensors])
  // the device master row, with the enrollment's (synced) equipment and firmware
  const deviceOf = e => ({ ...(e.device || {}), id: e.device_id, equipment_id: e.equipment_id, equipment_name: e.equipment_name, equipment_category: e.equipment_category, firmware_version: e.firmware_version })
  const notesFor = params.get('notes')
  const setNotesFor = id => { const p = new URLSearchParams(params); id ? p.set('notes', id) : p.delete('notes'); setParams(p, { replace: true }) }
  const loadNotes = () => listDeviceNotes(engagement.id).then(setNotes).catch(e => setError(errText(e)))
  const counts = useMemo(() => noteCounts(notes), [notes])
  const editable = perms.canManage && !['CLOSED', 'CANCELLED'].includes(engagement.status)

  useEffect(() => {
    const d = istToday()
    listChecks(engagement.id, { from: d, to: d }).then(setToday).catch(() => {})
    loadNotes()
  }, [engagement.id])

  const todayOf = useMemo(() => Object.fromEntries(today.map(c => [c.enrollment_id, c])), [today])
  const openOf = id => incidents.filter(i => i.status !== 'CLOSED' && (i.device_enrollment_ids || []).includes(id)).length
  const person = id => lookups.people.find(p => p.id === id)?.full_name
  const live = enrollments.filter(e => !e.unenrolled_at)
  const categories = [...new Set(enrollments.map(e => e.equipment_category).filter(Boolean))].sort()
  const sites = [...new Set(enrollments.map(e => e.site).filter(Boolean))].sort()
  const issuesOf = id => (counts[id]?.openIssues || 0) + openOf(id)
  const activeLive = live.filter(e => e.support_status === 'ACTIVE')
  const checkedToday = activeLive.filter(e => todayOf[e.id]).length
  const healthyToday = activeLive.filter(e => todayOf[e.id]?.daily_result === 'HEALTHY').length
  const attentionToday = live.filter(e => todayOf[e.id]?.daily_result === 'ATTENTION').length
  const withIssues = live.filter(e => issuesOf(e.id) > 0).length
  const gl = goLiveCounts(enrollments)
  const kpiMatch = e => {
    if (!kpi) return true
    if (kpi === 'ACTIVE' || kpi === 'MAINTENANCE') return !e.unenrolled_at && e.support_status === kpi
    if (kpi === 'UNCHECKED') return !e.unenrolled_at && e.support_status === 'ACTIVE' && !todayOf[e.id]
    if (kpi === 'ATTENTION') return todayOf[e.id]?.daily_result === 'ATTENTION'
    if (kpi === 'ISSUES') return !e.unenrolled_at && issuesOf(e.id) > 0
    return true
  }
  const rows = enrollments.filter(e => {
    const t = q.trim().toLowerCase()
    return kpiMatch(e) && matchDev(e)
      && (!statusFilter || e.support_status === statusFilter)
      && (!catFilter || e.equipment_category === catFilter)
      && (!siteFilter || e.site === siteFilter)
      && (!t || [e.device?.device_code, e.device?.serial_number, e.site, e.equipment_id, e.equipment_name, e.equipment_category, ...fields.map(f => fieldDisplay(e, f))].some(v => (v || '').toLowerCase().includes(t)))
  })
  const filtering = !!(q.trim() || statusFilter || catFilter || siteFilter || kpi || deviceFilterActive(deviceFilter))
  const clearFilters = () => { setQ(''); setStatusFilter(''); setCatFilter(''); setSiteFilter(''); setKpi(''); setDeviceFilter(EMPTY_DEVICE_FILTER) }
  const pickLive = v => setDeviceFilter(d => ({ ...d, golive: d.golive === v ? '' : v }))
  const pickKpi = k => setKpi(v => (v === k ? '' : k))
  async function exportSheet() {
    setSheetBusy('export'); setError('')
    try {
      await exportDevicesSheet(engagement, enrollments, lookups.people, {
        fields,
        todayOf: Object.fromEntries(today.map(c => [c.enrollment_id, DAILY_RESULTS[c.daily_result]?.label || ''])),
        issuesOf: Object.fromEntries(enrollments.map(e => [e.id, openOf(e.id)])),
      })
    } catch (e) { setError(errText(e)) }
    setSheetBusy('')
  }
  async function uploadSheet(file) {
    if (!file) return
    setSheetBusy('upload'); setError('')
    // unenrolled / replaced devices are not editable, so their rows show as "not enrolled"
    try { setPlan({ ...(await readDevicesSheet(file, enrollments.filter(e => !e.unenrolled_at), lookups.people, fields)), fileName: file.name }) } catch (e) { setError(errText(e)) }
    setSheetBusy('')
  }
  const toggle = id => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selectable = rows.filter(e => !e.unenrolled_at)
  const allSelected = selectable.length > 0 && selectable.every(e => selected.has(e.id))
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectable.map(e => e.id)))
  const engineer = (e, col, role) => {
    const own = person(e[col])
    if (own) return <span>{own}</span>
    const roster = person(cur[role]?.primary_user_id)
    return <span className="muted" title="Inherited from the roster">{roster || '—'}</span>
  }
  const actions = e => (
    <>
      <button className="btn btn-ghost btn-sm" title="Device 360" onClick={() => setViewing(e)}><Eye size={13} /></button>
      {editable && !e.unenrolled_at && <>
        <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => setEditing(e)}><Pencil size={13} /></button>
        <button className="btn btn-ghost btn-sm" title="Replace device" onClick={() => setReplacing(e)}><Repeat size={13} /></button>
      </>}
    </>
  )

  return (
    <div>
      <ErrorLine error={error} />
      {enrollments.length > 0 && (
        <div className="gl-kpis">
          <Kpi label="Enrolled" value={live.length} sub={`${categories.length} categor${categories.length === 1 ? 'y' : 'ies'} · ${sites.length} site${sites.length === 1 ? '' : 's'}`} accent="#6366f1" active={!kpi} onClick={() => setKpi('')} />
          <Kpi label="Active" value={activeLive.length} sub="In daily checks" accent="#10b981" active={kpi === 'ACTIVE'} onClick={() => pickKpi('ACTIVE')} />
          <Kpi label="Maintenance" value={live.filter(e => e.support_status === 'MAINTENANCE').length} sub="Checks optional" accent="#f59e0b" active={kpi === 'MAINTENANCE'} onClick={() => pickKpi('MAINTENANCE')} />
          <Kpi label="Checked today" value={`${checkedToday}/${activeLive.length}`} sub={`${healthyToday} healthy · ${activeLive.length - checkedToday} pending`} accent="#0ea5e9" active={kpi === 'UNCHECKED'} onClick={() => pickKpi('UNCHECKED')} />
          <Kpi label="Needs attention" value={attentionToday} sub="Today's checks" accent="#ef4444" active={kpi === 'ATTENTION'} onClick={() => pickKpi('ATTENTION')} />
          <Kpi label="Open issues" value={withIssues} sub="Devices with issues / incidents" accent="#f97316" active={kpi === 'ISSUES'} onClick={() => pickKpi('ISSUES')} />
          <Kpi label="Go-live" value={`${gl.live}/${gl.total}`} sub={`${gl.pct}% live`} accent="#059669" active={deviceFilter.golive === 'YES'} onClick={() => pickLive('YES')} />
          <Kpi label="Not live" value={gl.notLive} sub="Go-live = No" accent="#64748b" active={deviceFilter.golive === 'NO'} onClick={() => pickLive('NO')} />
        </div>
      )}
      <div className="table-wrap">
        <div className="gl-bar">
          <Search value={q} onChange={setQ} placeholder="Device, serial, equipment, site…" />
          <select className="form-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>{SUPPORT_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          {categories.length > 0 && <select className="form-select" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
            <option value="">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}
          </select>}
          {sites.length > 1 && <select className="form-select" value={siteFilter} onChange={e => setSiteFilter(e.target.value)}>
            <option value="">All sites</option>{sites.map(s => <option key={s}>{s}</option>)}
          </select>}
          <DeviceFilterSelects ctx={ctx} />
          {filtering && <button className="btn btn-ghost btn-sm" onClick={clearFilters}>Clear</button>}
          <div className="gl-grow" />
          {editable && selected.size > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setBulkLive(true)}><Rocket size={13} /> Set go-live ({selected.size})</button>}
          {editable && selected.size > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setBulk(true)}>Set status ({selected.size})</button>}
          {editable && <button className="btn btn-ghost btn-sm" onClick={() => setFieldsOpen(true)} title="Custom fields captured per device — each one is also a filter"><SlidersHorizontal size={13} /> Custom fields{fields.length ? ` (${fields.length})` : ''}</button>}
          {editable && <button className="btn btn-ghost btn-sm" onClick={() => setFirmwareOpen(true)} title="Firmware release list per product"><Cpu size={13} /> Firmware</button>}
          {enrollments.length > 0 && <button className="btn btn-ghost btn-sm" disabled={!!sheetBusy} onClick={exportSheet} title="Download the devices to edit in Excel"><Download size={13} /> {sheetBusy === 'export' ? 'Exporting…' : 'Export'}</button>}
          {editable && enrollments.length > 0 && (
            <label className="btn btn-ghost btn-sm" style={{ cursor: sheetBusy ? 'default' : 'pointer', opacity: sheetBusy ? 0.6 : 1 }} title="Upload the edited export. Changes are previewed before saving">
              <Upload size={13} /> {sheetBusy === 'upload' ? 'Reading…' : 'Upload edits'}
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} disabled={!!sheetBusy} onChange={e => { uploadSheet(e.target.files[0]); e.target.value = '' }} />
            </label>
          )}
          {editable && <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Plus size={13} /> Add devices</button>}
        </div>
        {enrollments.length > 0 && (
          <div className="gl-sub">
            <span>{rows.length === enrollments.length ? `${rows.length} device${rows.length === 1 ? '' : 's'}` : `${rows.length} of ${enrollments.length} devices`}</span>
            {selected.size > 0 && <span>· {selected.size} selected</span>}
          </div>
        )}
        {!enrollments.length ? <Empty icon={<Cpu size={26} />} title="No devices enrolled" desc="Add devices deployed to this project from the device master." />
          : !rows.length ? <Empty icon={<Cpu size={26} />} title="No devices match" desc="Change or clear the filters." /> : <>
          <div className="gl-desktop gl-tscroll">
            <table className="gl-table">
              <thead><tr>
                <th className="gl-sticky"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>{editable && <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />}Device</span></th><th>View</th><th>Go-live</th><th>Equipment ID</th><th>Equipment name</th><th>Category</th><th>Site</th>
                {fields.map(f => <th key={f.key}>{f.label}</th>)}
                <th>Firmware</th><th>Sensors</th><th className="num">Interval</th><th>Warranty end</th><th>Status</th><th>Engineers</th><th>Today</th><th className="num">Open</th><th>Notes / issues</th><th />
              </tr></thead>
              <tbody>{rows.map(e => (
                <tr key={e.id} style={{ opacity: e.unenrolled_at ? 0.55 : 1, cursor: 'pointer' }} title="Open Device 360"
                  onClick={ev => { if (!ev.target.closest('input,select,button,a,label,textarea')) setViewing(e) }}>
                  <td className="gl-sticky">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {editable && <input type="checkbox" checked={selected.has(e.id)} disabled={!!e.unenrolled_at} onChange={() => toggle(e.id)} aria-label={`Select ${deviceLabel(e.device)}`} />}
                      <div><div className="gl-code">{deviceLabel(e.device)}</div><div className="gl-meta">{[e.device?.serial_number, e.device?.part_number].filter(Boolean).join(' · ')}</div></div>
                    </div>
                  </td>
                  <td><button className="btn btn-outline btn-sm" style={{ padding: '3px 10px', fontWeight: 700, whiteSpace: 'nowrap' }} title="Open Device 360" onClick={() => setViewing(e)}><Eye size={12} /> View</button></td>
                  <td className="nowrap"><GoLiveBadge e={e} />{e.golive_since && <div className="gl-meta">since {dateFmt(e.golive_since)}</div>}</td>
                  <td className="nowrap" style={{ fontWeight: 600 }}>{e.equipment_id || <span className="muted">—</span>}</td>
                  <td className="nowrap">{e.equipment_name || <span className="muted">—</span>}</td>
                  <td>{e.equipment_category ? <span className="gl-tag">{e.equipment_category}</span> : <span className="muted">—</span>}</td>
                  <td className="nowrap">{e.site || <span className="muted">—</span>}</td>
                  {fields.map(f => <td key={f.key} className="nowrap">{fieldDisplay(e, f) || <span className="muted">—</span>}</td>)}
                  <td className="nowrap"><FirmwareBadge releases={releases} partNumber={e.device?.part_number} version={e.firmware_version} /></td>
                  <td><SensorSummary rows={sensorsOf[e.device_id] || []} onClick={() => setSensorsFor(e)} /></td>
                  <td className="num nowrap">{e.expected_reporting_interval_min} min</td>
                  <td className="nowrap"><Warranty end={e.device?.warranty_end} /></td>
                  <td><StatusPill e={e} />{e.status_reason && <div className="gl-meta" title={e.status_reason} style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.status_reason}</div>}</td>
                  <td style={{ fontSize: 11.5, lineHeight: 1.55 }}>
                    <div className="nowrap"><span className="muted" style={{ display: 'inline-block', width: 30 }}>On</span>{engineer(e, 'onsite_coordinator_user_id', 'ONSITE_COORDINATOR')}</div>
                    <div className="nowrap"><span className="muted" style={{ display: 'inline-block', width: 30 }}>FW</span>{engineer(e, 'firmware_engineer_user_id', 'FIRMWARE_ENGINEER')}</div>
                    <div className="nowrap"><span className="muted" style={{ display: 'inline-block', width: 30 }}>App</span>{engineer(e, 'application_engineer_user_id', 'APPLICATION_ENGINEER')}</div>
                  </td>
                  <td><ResultBadge result={todayOf[e.id]?.daily_result} /></td>
                  <td className="num">{openOf(e.id) || <span className="muted">—</span>}</td>
                  <td><button className="btn btn-ghost btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={() => setNotesFor(e.id)}><MessageSquare size={12} /> <NotesBadge count={counts[e.id]} /></button></td>
                  <td className="nowrap">{actions(e)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="gl-mobile">
            <div className="gl-cards">
              {rows.map(e => {
                const t = todayOf[e.id]?.daily_result
                const issues = counts[e.id]?.openIssues || 0
                return (
                  <div key={e.id} className={`gl-card ${t ? t.toLowerCase() : ''}`} style={{ opacity: e.unenrolled_at ? 0.6 : 1, cursor: 'pointer' }}
                    onClick={ev => { if (!ev.target.closest('input,select,button,a,label,textarea')) setViewing(e) }}>
                    <div className="gl-card-head">
                      <div style={{ minWidth: 0 }}>
                        <div className="gl-card-title gl-code">{deviceLabel(e.device)}</div>
                        <div className="gl-card-eq">{[e.equipment_id, e.equipment_name].filter(Boolean).join(' · ') || 'No equipment set'}</div>
                      </div>
                      <StatusPill e={e} />
                    </div>
                    <div className="gl-kv">
                      <div><span>Go-live</span><span><GoLiveBadge e={e} /></span></div>
                      {fields.map(f => <div key={f.key}><span>{f.label}</span><span>{fieldDisplay(e, f) || '—'}</span></div>)}
                      <div><span>Category</span><span>{e.equipment_category || '—'}</span></div>
                      <div><span>Site</span><span>{e.site || '—'}</span></div>
                      <div><span>Firmware</span><span><FirmwareBadge releases={releases} partNumber={e.device?.part_number} version={e.firmware_version} compact /></span></div>
                      <div><span>Sensors</span><span><SensorSummary rows={sensorsOf[e.device_id] || []} /></span></div>
                      <div><span>Warranty end</span><span><Warranty end={e.device?.warranty_end} /></span></div>
                      <div><span>Today</span><span><ResultBadge result={t} /></span></div>
                      <div><span>Open</span><span>{[openOf(e.id) && `${openOf(e.id)} incident${openOf(e.id) === 1 ? '' : 's'}`, issues && `${issues} issue${issues === 1 ? '' : 's'}`].filter(Boolean).join(' · ') || '—'}</span></div>
                    </div>
                    <div className="gl-card-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => setViewing(e)}><Eye size={13} /> 360</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setNotesFor(e.id)}><MessageSquare size={13} /> Notes{counts[e.id]?.notes ? ` (${counts[e.id].notes})` : ''}</button>
                      <button className="btn btn-ghost btn-sm" title="Sensors" onClick={() => setSensorsFor(e)}><Radio size={13} /></button>
                      {editable && !e.unenrolled_at && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(e)}><Pencil size={13} /> Edit</button>}
                      {editable && !e.unenrolled_at && <button className="btn btn-ghost btn-sm" title="Replace device" onClick={() => setReplacing(e)}><Repeat size={13} /></button>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>}
      </div>

      {adding && <AddDevicesModal ctx={ctx} onClose={() => setAdding(false)} onDone={async () => { setAdding(false); await reloadEnrollments() }} />}
      {editing && <EnrollmentModal enrollment={editing} ctx={ctx} onClose={() => setEditing(null)} onDone={async () => { setEditing(null); await reloadEnrollments() }} />}
      {replacing && <ReplaceModal enrollment={replacing} ctx={ctx} onClose={() => setReplacing(null)} onDone={async () => { setReplacing(null); await Promise.all([reloadEnrollments(), reloadIncidents()]) }} />}
      {viewing && <Device360 enrollment={enrollments.find(x => x.id === viewing.id) || viewing} ctx={ctx} device={deviceOf(enrollments.find(x => x.id === viewing.id) || viewing)} releases={releases}
        sensors={sensorsOf[viewing.device_id] || []} canEdit={editable} onSensorsChanged={loadSensors}
        notes={notes} onNotes={() => { setNotesFor(viewing.id); setViewing(null) }}
        onEdit={() => { setEditing(viewing); setViewing(null) }} onReplace={() => { setReplacing(viewing); setViewing(null) }} onClose={() => setViewing(null)} />}
      {sensorsFor && <DeviceSensorsModal device={deviceOf(sensorsFor)} canEdit={editable} onClose={() => setSensorsFor(null)} onChanged={loadSensors} />}
      {firmwareOpen && <FirmwareReleasesModal canEdit={editable} onClose={() => setFirmwareOpen(false)} onChanged={reloadReleases} />}
      {notesFor && enrollments.find(e => e.id === notesFor) && (
        <DeviceNotesModal ctx={ctx} enrollment={enrollments.find(e => e.id === notesFor)} notes={notes} onClose={() => setNotesFor(null)}
          onChanged={async withIncidents => { await loadNotes(); if (withIncidents) await reloadIncidents() }} />
      )}
      {plan && <DeviceUploadModal plan={plan} people={lookups.people} onClose={() => setPlan(null)} onDone={async () => { setPlan(null); await reloadEnrollments() }} />}
      {fieldsOpen && <DeviceFieldsModal engagement={engagement} onClose={() => setFieldsOpen(false)} onDone={async () => { setFieldsOpen(false); await ctx.reloadEngagement() }} />}
      {bulkLive && <BulkGoLiveModal count={selected.size} onClose={() => setBulkLive(false)} onSave={async on => {
        try {
          await bulkSetGoLive(enrollments.filter(e => selected.has(e.id)), on)
          setSelected(new Set()); setBulkLive(false); await reloadEnrollments()
        } catch (e) { setError(errText(e)); setBulkLive(false); await reloadEnrollments() }
      }} />}
      {bulk && <BulkStatusModal count={selected.size} onClose={() => setBulk(null)} onSave={async (status, reason) => {
        try {
          await bulkSetSupportStatus(enrollments.filter(e => selected.has(e.id)), status, reason)
          setSelected(new Set()); setBulk(null); await reloadEnrollments()
        } catch (e) { setError(errText(e)); setBulk(null); await reloadEnrollments() }
      }} />}
    </div>
  )
}

function AddDevicesModal({ ctx, onClose, onDone }) {
  const { engagement, enrollments, perms } = ctx
  const [deployable, setDeployable] = useState(null)
  const [picked, setPicked] = useState({})
  const [term, setTerm] = useState('')
  const [results, setResults] = useState([])
  const [defaults, setDefaults] = useState({ expected_reporting_interval_min: 15, firmware_version: '', deployment_override_reason: '', is_golive: false, custom_fields: {} })
  const fields = ctx.deviceFields
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const enrolledIds = enrollments.map(e => e.device_id)

  useEffect(() => { listDeployableDevices(engagement.project_id, enrolledIds).then(setDeployable).catch(e => setError(errText(e))) }, [])

  async function search() {
    setError('')
    try {
      const r = await searchDevices(term)
      setResults(r.filter(d => !enrolledIds.includes(d.id)))
      if (!r.length) setError(`No device "${term}" in the device master — register it in Devices first.`)
    } catch (e) { setError(errText(e)) }
  }
  const pickedList = Object.values(picked)
  const offProject = pickedList.filter(d => d.project_id !== engagement.project_id)

  async function save() {
    setError('')
    const cf = customFieldValues(fields, defaults.custom_fields)
    if (cf.error) { setError(cf.error); return }
    setBusy(true)
    try { await enrollDevices(engagement.id, pickedList, { ...defaults, custom_fields: cf.values }); await onDone() } catch (e) { setError(errText(e)) }
    setBusy(false)
  }
  const toggle = d => setPicked(p => { const n = { ...p }; n[d.id] ? delete n[d.id] : (n[d.id] = d); return n })
  const DeviceRow = ({ d }) => (
    <label style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 10px', borderBottom: '1px solid var(--border)', fontSize: 13, cursor: 'pointer' }}>
      <input type="checkbox" checked={!!picked[d.id]} onChange={() => toggle(d)} />
      <strong>{deviceLabel(d)}</strong><span style={{ color: 'var(--ink-muted)' }}>{d.serial_number}</span>
      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-muted)' }}>{d.current_location || ''} · {d.status}</span>
    </label>
  )

  return (
    <Modal open size="lg" title="Add devices" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !pickedList.length || (offProject.length > 0 && !defaults.deployment_override_reason.trim())} onClick={save}>Enroll {pickedList.length || ''}</button></>}>
      <ErrorLine error={error} />
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Deployed to this project</div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, maxHeight: 240, overflowY: 'auto', marginBottom: 14 }}>
        {!deployable ? <Loader /> : !deployable.length ? <div style={{ padding: 12, fontSize: 13, color: 'var(--ink-muted)' }}>No un-enrolled devices are deployed to this project. Deploy them in <Link to="/devices">Devices</Link>.</div>
          : <>
            <label style={{ display: 'flex', gap: 10, padding: '7px 10px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 600 }}>
              <input type="checkbox" checked={deployable.every(d => picked[d.id])} onChange={e => setPicked(p => { const n = { ...p }; deployable.forEach(d => e.target.checked ? (n[d.id] = d) : delete n[d.id]); return n })} /> Select all ({deployable.length})
            </label>
            {deployable.map(d => <DeviceRow key={d.id} d={d} />)}
          </>}
      </div>

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Find by device ID / serial (or scan)</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input className="form-input" value={term} onChange={e => setTerm(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} placeholder="Scan or type device code / serial" autoFocus />
        <button className="btn btn-ghost" onClick={search}><ScanLine size={14} /> Find</button>
      </div>
      {results.length > 0 && <div style={{ border: '1px solid var(--border)', borderRadius: 8, marginBottom: 14 }}>{results.map(d => <DeviceRow key={d.id} d={d} />)}</div>}

      <div className="form-row">
        <Field label="Reporting interval (min)" hint="Expected telemetry interval"><input type="number" min={1} className="form-input" value={defaults.expected_reporting_interval_min} onChange={e => setDefaults(s => ({ ...s, expected_reporting_interval_min: e.target.value }))} /></Field>
        <Field label="Firmware version" hint="Not held on the device master — captured here"><input className="form-input" value={defaults.firmware_version} onChange={e => setDefaults(s => ({ ...s, firmware_version: e.target.value }))} /></Field>
      </div>
      <CustomFieldInputs fields={fields} isGoLive={defaults.is_golive} onGoLive={v => setDefaults(s => ({ ...s, is_golive: v }))}
        values={defaults.custom_fields} onChange={(k, v) => setDefaults(s => ({ ...s, custom_fields: { ...s.custom_fields, [k]: v } }))}
        hint="Applied to every device added now · editable per device later" />
      {offProject.length > 0 && (
        <Field label={`${offProject.length} device(s) not deployed to this project — override reason`} required hint={perms.isAdmin ? 'Admin override' : 'Only an admin can override this'}>
          <input className="form-input" value={defaults.deployment_override_reason} onChange={e => setDefaults(s => ({ ...s, deployment_override_reason: e.target.value }))} disabled={!perms.isAdmin} />
        </Field>
      )}
    </Modal>
  )
}

function EnrollmentModal({ enrollment, ctx, onClose, onDone }) {
  const { lookups, cur, profile } = ctx
  const { releases } = useFirmwareReleases()
  const [form, setForm] = useState({ ...enrollment })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const masterMissingSite = !enrollment.device?.current_location
  const fields = ctx.deviceFields
  // STEP259 columns are sent only once the database has them (select('*') carries them)
  const hasLiveCols = 'is_golive' in enrollment
  async function save() {
    setError('')
    const cf = customFieldValues(fields, form.custom_fields || {})
    if (cf.error) { setError(cf.error); return }
    setBusy(true)
    try {
      const patch = hasLiveCols
        ? { ...form, custom_fields: { ...(enrollment.custom_fields || {}), ...cf.values }, golive_since: form.is_golive ? form.golive_since || null : null }
        : { ...form, is_golive: undefined, golive_since: undefined, custom_fields: undefined }
      await updateEnrollment(enrollment, patch)
      // §6.1: gaps in the device master are raised as a correction request, never written there from here
      if (masterMissingSite && form.site && form.site !== enrollment.site) {
        await requestMasterCorrection(enrollment.device, { location: form.site, equipment: form.equipment_id }, profile.id)
      }
      await onDone()
    } catch (e) { setError(errText(e)) }
    setBusy(false)
  }
  const prefer = role => [cur[role]?.primary_user_id, cur[role]?.backup_user_id]
  return (
    <Modal open size="lg" title={`Device ${deviceLabel(enrollment.device)}`} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>Save</button></>}>
      <ErrorLine error={error} />
      <div className="form-row">
        <Field label="Site" hint={masterMissingSite ? 'Device master has no location — saving raises a correction request' : null}><input className="form-input" value={form.site || ''} onChange={e => set('site', e.target.value)} /></Field>
        <Field label="Equipment ID" hint="As it appears in the client's hours report"><input className="form-input" value={form.equipment_id || ''} onChange={e => set('equipment_id', e.target.value)} /></Field>
      </div>
      <div className="form-row">
        <Field label="Equipment name"><input className="form-input" value={form.equipment_name || ''} onChange={e => set('equipment_name', e.target.value)} placeholder="Air Compressor 1" /></Field>
        <Field label="Equipment category" hint="Used for category-wise hours and tolerance">
          <input className="form-input" list="golive-equipment-categories" value={form.equipment_category || ''} onChange={e => set('equipment_category', e.target.value)} placeholder="Compressor, Pump, Chiller…" />
          <datalist id="golive-equipment-categories">{[...new Set(ctx.enrollments.map(e => e.equipment_category).filter(Boolean))].map(c => <option key={c} value={c} />)}</datalist>
        </Field>
      </div>
      <div className="form-row">
        <Field label="Firmware version" hint="From the product's release list · changes are logged in the timeline"><FirmwareSelect releases={releases} partNumber={enrollment.device?.part_number} value={form.firmware_version} onChange={v => set('firmware_version', v)} /></Field>
        <Field label="SIM / network reference"><input className="form-input" value={form.connectivity_ref || ''} onChange={e => set('connectivity_ref', e.target.value)} /></Field>
      </div>
      <div className="form-row">
        <Field label="Reporting interval (min)"><input type="number" min={1} className="form-input" value={form.expected_reporting_interval_min} onChange={e => set('expected_reporting_interval_min', Number(e.target.value) || 1)} /></Field>
        <Field label="Support status" hint={form.support_status === 'DECOMMISSIONED' ? 'Stops new checks here only — raise a lifecycle change in Devices for the asset itself' : null}>
          <EnumSelect options={SUPPORT_STATUSES} value={form.support_status} onChange={v => set('support_status', v || 'ACTIVE')} />
        </Field>
      </div>
      {hasLiveCols ? (
        <CustomFieldInputs fields={fields} isGoLive={!!form.is_golive} onGoLive={v => set('is_golive', v)} since={form.golive_since} onSince={v => set('golive_since', v || null)}
          values={form.custom_fields || {}} onChange={(k, v) => set('custom_fields', { ...(form.custom_fields || {}), [k]: v })} />
      ) : <div style={{ fontSize: 12, color: '#b45309', marginBottom: 10 }}>Go-live and custom fields need sql/STEP259_golive_device_live_flag.sql — run it in the Supabase SQL Editor.</div>}
      {form.support_status !== 'ACTIVE' && <Field label="Status reason" required><input className="form-input" value={form.status_reason || ''} onChange={e => set('status_reason', e.target.value)} /></Field>}
      <div style={{ fontWeight: 700, fontSize: 13, margin: '6px 0 8px' }}>Per-device engineer overrides <span style={{ fontWeight: 400, color: 'var(--ink-muted)' }}>(blank = roster primary)</span></div>
      <div className="form-row">
        <Field label="Onsite coordinator"><PersonSelect people={lookups.people} value={form.onsite_coordinator_user_id} onChange={v => set('onsite_coordinator_user_id', v)} prefer={prefer('ONSITE_COORDINATOR')} placeholder="Inherit roster" /></Field>
        <Field label="Firmware engineer"><PersonSelect people={lookups.people} value={form.firmware_engineer_user_id} onChange={v => set('firmware_engineer_user_id', v)} prefer={prefer('FIRMWARE_ENGINEER')} placeholder="Inherit roster" /></Field>
      </div>
      <Field label="Application engineer"><PersonSelect people={lookups.people} value={form.application_engineer_user_id} onChange={v => set('application_engineer_user_id', v)} prefer={prefer('APPLICATION_ENGINEER')} placeholder="Inherit roster" /></Field>
      <Field label="Notes"><textarea className="form-textarea" value={form.notes || ''} onChange={e => set('notes', e.target.value)} /></Field>
    </Modal>
  )
}

function ReplaceModal({ enrollment, ctx, onClose, onDone }) {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState([])
  const [pick, setPick] = useState(null)
  const [carry, setCarry] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function search() {
    setError('')
    try {
      const r = (await searchDevices(term)).filter(d => d.id !== enrollment.device_id && !ctx.enrollments.some(e => e.device_id === d.id))
      setResults(r); if (!r.length) setError('No matching device in the device master')
    } catch (e) { setError(errText(e)) }
  }
  async function save() {
    setBusy(true); setError('')
    try { await replaceDevice(enrollment, pick, { carryIncidents: carry }); await onDone() } catch (e) { setError(errText(e)) }
    setBusy(false)
  }
  return (
    <Modal open title={`Replace ${deviceLabel(enrollment.device)}`} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !pick} onClick={save}>Replace</button></>}>
      <ErrorLine error={error} />
      <p style={{ fontSize: 13, marginTop: 0 }}>The replacement gets a new enrollment; this one ends with reason <code>REPLACED_BY</code>. Check history stays with the old device.</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input className="form-input" value={term} onChange={e => setTerm(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} placeholder="Replacement device code / serial" autoFocus />
        <button className="btn btn-ghost" onClick={search}>Find</button>
      </div>
      {results.map(d => (
        <label key={d.id} style={{ display: 'flex', gap: 8, padding: '6px 0', fontSize: 13 }}>
          <input type="radio" name="rep" checked={pick?.id === d.id} onChange={() => setPick(d)} /> <strong>{deviceLabel(d)}</strong> <span style={{ color: 'var(--ink-muted)' }}>{d.serial_number}</span>
        </label>
      ))}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginTop: 10 }}>
        <input type="checkbox" checked={carry} onChange={e => setCarry(e.target.checked)} /> Carry open incidents to the new device
      </label>
    </Modal>
  )
}

// Preview of an uploaded devices sheet; only the changed fields are saved.
function DeviceUploadModal({ plan, people, onClose, onDone }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(null)
  const show = (key, v) => {
    if (v == null || v === '') return key.endsWith('_user_id') ? 'roster' : '—'
    if (key.endsWith('_user_id')) return people.find(p => p.id === v)?.full_name || '(unknown user)'
    if (key === 'support_status') return labelOf(SUPPORT_STATUSES, v)
    if (key === 'is_golive') return v ? 'Yes' : 'No'
    return String(v)
  }
  async function apply() {
    setBusy(true)
    const errs = []
    for (const u of plan.updates) {
      try { await updateEnrollment(u.enrollment, changesToPatch(u.enrollment, u.changes)) } catch (e) { errs.push({ rowNo: u.rowNo, label: deviceLabel(u.enrollment.device), message: errText(e) }) }
    }
    setBusy(false)
    if (errs.length) setFailed({ errs, saved: plan.updates.length - errs.length })
    else await onDone()
  }
  const n = plan.updates.length
  return (
    <Modal open size="lg" title={`Upload edits · ${plan.fileName}`} onClose={failed ? onDone : onClose}
      footer={failed
        ? <button className="btn btn-primary" onClick={onDone}>Close</button>
        : <><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !n} onClick={apply}>{busy ? 'Saving…' : `Save ${n} device${n === 1 ? '' : 's'}`}</button></>}>
      {failed ? (
        <>
          <p style={{ fontSize: 13, marginTop: 0 }}>{failed.saved} device(s) saved; {failed.errs.length} could not be saved:</p>
          {failed.errs.map(f => <div key={f.rowNo} style={{ fontSize: 13, padding: '5px 0', borderBottom: '1px solid var(--border)' }}><strong>Row {f.rowNo} · {f.label}</strong>: <span style={{ color: '#dc2626' }}>{f.message}</span></div>)}
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            <Chip tone={n ? 'green' : 'gray'}>{n} to update</Chip>
            <Chip>{plan.unchanged} unchanged</Chip>
            {plan.notEnrolled.length > 0 && <Chip tone="amber">{plan.notEnrolled.length} not enrolled</Chip>}
            {plan.errors.length > 0 && <Chip tone="red">{plan.errors.length} skipped</Chip>}
          </div>
          {!n && <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 12 }}>Nothing in this file differs from what is saved.</div>}
          {plan.updates.map(u => (
            <div key={u.enrollment.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{deviceLabel(u.enrollment.device)} <span style={{ fontWeight: 400, color: 'var(--ink-muted)', fontSize: 11.5 }}>row {u.rowNo}</span></div>
              {Object.entries(u.changes).map(([k, c]) => (
                <div key={k} style={{ display: 'flex', gap: 8, fontSize: 12.5, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--ink-muted)', minWidth: 170 }}>{c.label || columnHeader(k)}</span>
                  <span style={{ textDecoration: 'line-through', color: 'var(--ink-muted)' }}>{show(k, c.from)}</span><span>→</span><strong>{show(k, 'display' in c ? c.display : c.to)}</strong>
                </div>
              ))}
              {u.issues.map((m, i) => <div key={i} style={{ fontSize: 12, color: '#b45309', marginTop: 2 }}>{m}</div>)}
            </div>
          ))}
          {(plan.notEnrolled.length > 0 || plan.errors.length > 0) && <div style={{ fontWeight: 700, fontSize: 13, margin: '14px 0 6px' }}>Not applied</div>}
          {plan.notEnrolled.map(r => <div key={`n${r.rowNo}`} style={{ fontSize: 12.5, padding: '3px 0' }}>Row {r.rowNo}: <strong>{r.ref}</strong> is not enrolled in this engagement. Add it with Add devices first.</div>)}
          {plan.errors.map(r => <div key={`e${r.rowNo}`} style={{ fontSize: 12.5, padding: '3px 0', color: '#b45309' }}>Row {r.rowNo}: {r.message}</div>)}
        </>
      )}
    </Modal>
  )
}

// Validates custom field inputs; returns { values } or { error }.
function customFieldValues(fields, raw) {
  const values = {}
  for (const f of fields) {
    if (!(f.key in raw)) continue
    const r = coerceFieldValue(f, raw[f.key])
    if (r.error) return { error: r.error }
    values[f.key] = r.value
  }
  return { values }
}

// Go-live Yes / No (+ live-since date) and the engagement's custom device fields.
function CustomFieldInputs({ fields, isGoLive, onGoLive, since, onSince, values, onChange, hint }) {
  const yn = v => (v === true ? 'YES' : v === false ? 'NO' : '')
  return (
    <>
      <div className="form-row">
        <Field label="Go-live" hint={hint || 'Has this device gone live?'}>
          <select className="form-select" value={isGoLive ? 'YES' : 'NO'} onChange={e => onGoLive(e.target.value === 'YES')}>
            <option value="NO">No</option><option value="YES">Yes</option>
          </select>
        </Field>
        {onSince ? (
          <Field label="Live since" hint={isGoLive ? 'Blank = today' : 'Set when Go-live is Yes'}>
            <input type="date" className="form-input" disabled={!isGoLive} value={isGoLive ? since || '' : ''} max={istToday()} onChange={e => onSince(e.target.value)} />
          </Field>
        ) : <div />}
      </div>
      {fields.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
          {fields.map(f => (
            <Field key={f.key} label={f.label}>
              {f.type === 'list' ? (
                <select className="form-select" value={values[f.key] ?? ''} onChange={e => onChange(f.key, e.target.value || null)}>
                  <option value="">—</option>{(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                  {values[f.key] && !(f.options || []).includes(values[f.key]) && <option value={values[f.key]}>{values[f.key]}</option>}
                </select>
              ) : f.type === 'yesno' ? (
                <select className="form-select" value={yn(values[f.key])} onChange={e => onChange(f.key, e.target.value === '' ? null : e.target.value === 'YES')}>
                  <option value="">—</option><option value="YES">Yes</option><option value="NO">No</option>
                </select>
              ) : <input className="form-input" value={values[f.key] ?? ''} onChange={e => onChange(f.key, e.target.value)} />}
            </Field>
          ))}
        </div>
      )}
    </>
  )
}

// Edit the engagement's custom device fields (config.device_fields) in place.
function DeviceFieldsModal({ engagement, onClose, onDone }) {
  const [text, setText] = useState(() => fieldLines(engagement.config?.device_fields || []))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const parsed = parseFieldLines(text)
  async function save() {
    setBusy(true); setError('')
    try { await updateEngagement({ id: engagement.id, version: engagement.version, config: { ...(engagement.config || {}), device_fields: parsed } }); await onDone() } catch (e) { setError(errText(e)) }
    setBusy(false)
  }
  return (
    <Modal open title="Custom device fields" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <ErrorLine error={error} />
      <p style={{ fontSize: 13, marginTop: 0 }}>Extra fields captured for each device in this engagement. Each one can be set when adding or editing devices, is a column in the Excel export / upload and a filter on every tab.</p>
      <Field label="One field per line" hint="“Label | list | option 1, option 2” · “Label | text” · “Label | yesno”. Renaming a field starts it fresh; removing one hides it but keeps saved values.">
        <textarea className="form-textarea" rows={6} style={{ fontFamily: 'monospace', fontSize: 12 }} value={text} onChange={e => setText(e.target.value)}
          placeholder={'Zone | list | North, South, East\nContract ref | text\nCritical asset | yesno'} autoFocus />
      </Field>
      {parsed.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {parsed.map(f => <span key={f.key} className="gl-tag">{f.label} · {f.type === 'list' ? (f.options || []).join(' / ') || 'no options yet' : f.type === 'yesno' ? 'Yes / No' : 'text'}</span>)}
      </div>}
    </Modal>
  )
}

function BulkGoLiveModal({ count, onClose, onSave }) {
  const [on, setOn] = useState(true)
  const [busy, setBusy] = useState(false)
  return (
    <Modal open title={`Set go-live for ${count} device(s)`} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); await onSave(on) }}>Apply</button></>}>
      <Field label="Go-live" hint={on ? 'Live-since is set to today for devices not already live' : 'Clears the live-since date'}>
        <select className="form-select" value={on ? 'YES' : 'NO'} onChange={e => setOn(e.target.value === 'YES')}><option value="YES">Yes</option><option value="NO">No</option></select>
      </Field>
    </Modal>
  )
}

function BulkStatusModal({ count, onClose, onSave }) {
  const [status, setStatus] = useState('MAINTENANCE')
  const [reason, setReason] = useState('')
  return (
    <Modal open title={`Set status for ${count} device(s)`} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={status !== 'ACTIVE' && !reason.trim()} onClick={() => onSave(status, reason)}>Apply</button></>}>
      <Field label="Support status"><EnumSelect options={SUPPORT_STATUSES} value={status} onChange={v => setStatus(v || 'ACTIVE')} /></Field>
      {status !== 'ACTIVE' && <Field label="Reason" required><input className="form-input" value={reason} onChange={e => setReason(e.target.value)} /></Field>}
    </Modal>
  )
}

// §6.1 Device 360 — opens on row click; same layout as the Device Instances
// device view: summary strip, then Overview / Sensors / Tasks & history /
// Incidents & issues tabs.
function Device360({ enrollment, ctx, device, releases, sensors, canEdit, notes = [], onNotes, onEdit, onReplace, onSensorsChanged, onClose }) {
  const { lookups, profile, engagement, cur } = ctx
  const [tab, setTab] = useState('overview')
  const [upgrade, setUpgrade] = useState(false)
  const [tasksKey, setTasksKey] = useState(0)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { getDevice360(enrollment).then(setData).catch(e => setError(errText(e))) }, [enrollment.id])
  const dayResults = data ? Object.fromEntries(data.checks.map(c => [c.check_date, c.daily_result])) : {}
  const last14 = []
  for (let i = 13; i >= 0; i--) { const d = new Date(`${istToday()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - i); last14.push(d.toISOString().slice(0, 10)) }
  const color = { HEALTHY: '#059669', ATTENTION: '#dc2626', INCOMPLETE: '#d97706' }
  const checked = last14.filter(d => dayResults[d]).length
  const healthy14 = last14.filter(d => dayResults[d] === 'HEALTHY').length
  const openIssues = notes.filter(n => n.enrollment_id === enrollment.id && n.is_issue && n.issue_status === 'OPEN')
  const person = id => lookups.people.find(p => p.id === id)?.full_name
  const engineer = (col, role) => person(enrollment[col]) || (person(cur[role]?.primary_user_id) ? `${person(cur[role]?.primary_user_id)} (roster)` : '—')
  const Row = ({ k, v }) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}><span style={{ color: 'var(--ink-muted)' }}>{k}</span><span style={{ fontWeight: 600, textAlign: 'right' }}>{v || '—'}</span></div>
  const openInc = data ? data.incidents.filter(i => !['RESOLVED', 'CLOSED'].includes(i.status)).length : 0
  const live = !enrollment.unenrolled_at
  return (
    <Modal open size="lg" title={`${deviceLabel(enrollment.device)} · Device 360`} onClose={onClose}
      footer={<>
        {live && <CheckInHereButton device={device} profile={profile} projectId={engagement.project_id} engagementId={engagement.id} site={enrollment.site} />}
        <button className="btn btn-ghost" onClick={onNotes}><MessageSquare size={13} /> Notes &amp; issues</button>
        {canEdit && live && <button className="btn btn-ghost" onClick={onEdit}><Pencil size={13} /> Edit</button>}
        {canEdit && live && <button className="btn btn-ghost" onClick={onReplace}><Repeat size={13} /> Replace</button>}
        <button className="btn btn-primary" onClick={onClose}>Close</button>
      </>}>
      <ErrorLine error={error} />
      <div className="gl-summary">
        <div><span>Equipment</span><span title={[enrollment.equipment_id, enrollment.equipment_name].filter(Boolean).join(' · ')}>{[enrollment.equipment_id, enrollment.equipment_name].filter(Boolean).join(' · ') || '—'}</span></div>
        <div><span>Category</span><span>{enrollment.equipment_category || '—'}</span></div>
        <div><span>Site</span><span>{enrollment.site || '—'}</span></div>
        <div><span>Status</span><span><StatusPill e={enrollment} /></span></div>
        <div><span>Go-live</span><span><GoLiveBadge e={enrollment} />{enrollment.golive_since ? ` ${dateFmt(enrollment.golive_since)}` : ''}</span></div>
        {ctx.deviceFields.map(f => <div key={f.key}><span>{f.label}</span><span>{fieldDisplay(enrollment, f) || '—'}</span></div>)}
        <div><span>Firmware</span><span><FirmwareBadge releases={releases} partNumber={device.part_number} version={enrollment.firmware_version} compact /></span></div>
        <div><span>Sensors</span><span><SensorSummary rows={sensors} /></span></div>
        <div><span>Last 14 days</span><span>{checked ? `${healthy14}/${checked} healthy` : 'No checks'}</span></div>
        <div><span>Open</span><span>{[openInc && `${openInc} incident${openInc === 1 ? '' : 's'}`, openIssues.length && `${openIssues.length} issue${openIssues.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ') || 'None'}</span></div>
      </div>
      <div className="gl-seg" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        {[['overview', 'Overview'], ['sensors', `Sensors (${sensors.filter(r => r.health !== 'REMOVED').length})`], ['visits', 'Visits'], ['history', 'Tasks & history'], ['issues', `Incidents & issues${openInc + openIssues.length ? ` (${openInc + openIssues.length})` : ''}`]].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'overview' && (!data ? <Loader /> : (
        <>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Daily checks · last 14 days</div>
          <div style={{ display: 'flex', gap: 3 }}>
            {last14.map(d => (
              <div key={d} title={`${dateFmt(d)}: ${dayResults[d] ? dayResults[d].toLowerCase() : 'no check'}`}
                style={{ flex: 1, height: 24, borderRadius: 4, background: color[dayResults[d]] || '#f1f5f9', border: '1px solid var(--border)' }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--ink-muted)', margin: '6px 0 16px', flexWrap: 'wrap' }}>
            <span>■ <span style={{ color: '#059669' }}>Healthy</span></span><span>■ <span style={{ color: '#dc2626' }}>Attention</span></span><span>■ <span style={{ color: '#d97706' }}>Incomplete</span></span><span>□ No check</span>
            <span style={{ marginLeft: 'auto' }}>{dateFmt(last14[0])} – {dateFmt(last14[13])}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0 24px' }}>
            <div>
              <Row k="Serial number" v={<span className="gl-code">{data.device?.serial_number || '—'}</span>} />
              <Row k="Product" v={[data.product?.name, data.device?.part_number].filter(Boolean).join(' · ')} />
              <Row k="Reporting interval" v={`${enrollment.expected_reporting_interval_min} min`} />
              <Row k="SIM / network ref" v={enrollment.connectivity_ref} />
              <Row k="Last data received" v={data.lastDataAt && new Date(data.lastDataAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} />
              <Row k="Installed" v={data.device?.installed_date && dateFmt(data.device.installed_date)} />
            </div>
            <div>
              <Row k="Onsite coordinator" v={engineer('onsite_coordinator_user_id', 'ONSITE_COORDINATOR')} />
              <Row k="Firmware engineer" v={engineer('firmware_engineer_user_id', 'FIRMWARE_ENGINEER')} />
              <Row k="Application engineer" v={engineer('application_engineer_user_id', 'APPLICATION_ENGINEER')} />
              <Row k="Warranty" v={data.warrantyEnd ? `${data.underWarranty ? 'In warranty' : 'Out of warranty'} · ${dateFmt(data.warrantyEnd)}` : 'No warranty record'} />
              <Row k="Customer" v={lookups.customers?.find(c => c.id === data.device?.customer_id)?.name} />
              <Row k="Device master" v={<Link to="/devices">{data.device?.status || 'View'} · open in Devices</Link>} />
            </div>
          </div>
          {enrollment.status_reason && <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 10 }}>Status reason: {enrollment.status_reason}</div>}
          {enrollment.notes && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 6, whiteSpace: 'pre-wrap' }}>{enrollment.notes}</div>}
        </>
      ))}

      {tab === 'sensors' && <DeviceSensorSlots device={device} canEdit={canEdit} onChanged={onSensorsChanged} />}

      {tab === 'visits' && <DeviceVisitsPanel deviceId={device.id} people={lookups.people} />}

      {tab === 'history' && <>
        <DeviceTasksPanel device={device} people={lookups.people} organizationId={engagement.organization_id} reloadKey={tasksKey} onUpgrade={canEdit ? () => setUpgrade(true) : null} />
        {upgrade && <FirmwareUpgradeModal device={device} releases={releases} people={lookups.people} organizationId={engagement.organization_id} profile={profile} projectId={engagement.project_id}
          onClose={() => setUpgrade(false)} onDone={() => { setUpgrade(false); setTasksKey(k => k + 1) }} />}
      </>}

      {tab === 'issues' && (!data ? <Loader /> : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>Open device issues</span>
            <button className="btn btn-ghost btn-sm" onClick={onNotes}><MessageSquare size={12} /> Notes &amp; issues</button>
          </div>
          {!openIssues.length ? <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>None</div> : openIssues.map(n => (
            <div key={n.id} style={{ fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <Chip tone={n.severity === 'HIGH' ? 'red' : 'amber'}>{n.severity.toLowerCase()}</Chip> {n.body.split(/\r?\n/)[0]}
            </div>
          ))}
          <div style={{ fontWeight: 700, fontSize: 13, margin: '16px 0 8px' }}>Go-live incidents</div>
          {!data.incidents.length ? <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>None</div> : data.incidents.map(i => (
            <div key={i.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13, flexWrap: 'wrap' }}>
              <strong>{i.number}</strong><PriorityBadge priority={i.priority} /><span style={{ flex: '1 1 200px' }}>{i.title}</span><FlagBadge flag={i.follow_up_flag} />
            </div>
          ))}
        </>
      ))}
    </Modal>
  )
}
