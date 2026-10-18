import { useState, useEffect, useMemo } from 'react'
import { Modal, Loader } from '../ui'
import { supabase, dateFmt } from '../../lib/supabase'
import {
  FIRMWARE_STATUSES, listFirmware, saveFirmware, deleteFirmware, releasesFor, firmwareState,
  SENSOR_STATUSES, SENSOR_HEALTH, SENSOR_KINDS, listSensorTypes, saveSensorType, listSensorDefaults, addSensorDefault, removeSensorDefault,
  listDeviceSensors, addDeviceSensor, updateDeviceSensor, applyDefaultSensors, sensorSummary,
  listDeviceTasks, createFirmwareUpgradeTask, isMissingSetup, searchDevicesForLink, getDevice, bulkAddSensor, bulkRemoveSensor,
} from '../../lib/deviceMaster'
import { listFlows, makeStatusHelpers } from '../../lib/departmentStatusFlows'
import { DEFAULT_CHECK_PARAMETERS } from '../../lib/goLiveRules'
import { Plus, Trash2, Pencil, Cpu, Radio, Wrench, ArrowUpCircle, ListChecks, RotateCcw } from 'lucide-react'

// Shared Device-master pieces used by Device Instances and Go-Live:
// firmware releases (STEP242), sensors (STEP243), linked tasks (STEP244).

const errText = (e, step) => (isMissingSetup(e) ? `This needs the database update in sql/${step} — run it in the Supabase SQL Editor, then reload.` : e?.message || String(e))
const Err = ({ error }) => (error ? <div className="alert alert-danger" style={{ marginBottom: 12, fontSize: 13 }}>{error}</div> : null)

/* ═══ Firmware ═══ */

const FW_STATE = {
  CURRENT: { tone: 'green', text: 'current' },
  SUPPORTED: { tone: 'gray', text: 'supported' },
  OUTDATED: { tone: 'amber', text: 'update available' },
  DEPRECATED: { tone: 'red', text: 'deprecated' },
  UNLISTED: { tone: 'amber', text: 'not in release list' },
}

// Firmware version with its standing against the product's release list.
export function FirmwareBadge({ releases, partNumber, version, compact }) {
  const v = String(version || '').trim()
  if (!v) return <span style={{ color: 'var(--ink-muted)' }}>—</span>
  const { state, current } = firmwareState(releases || [], partNumber, v)
  const s = FW_STATE[state]
  if (!s) return <span>{v}</span>
  const title = state === 'OUTDATED' || state === 'DEPRECATED' || state === 'UNLISTED' ? `${v} is ${s.text}${current ? ` — current is ${current}` : ''}` : `${v} · ${s.text}`
  return (
    <span title={title} style={{ display: 'inline-flex', flexDirection: compact ? 'row' : 'column', gap: compact ? 6 : 1, alignItems: compact ? 'center' : 'flex-start' }}>
      <span style={{ fontWeight: 600 }}>{v}</span>
      {state !== 'SUPPORTED' && <span className={`gl-pill ${s.tone}`} style={{ fontSize: 10 }}>{state === 'OUTDATED' && current ? `→ ${current}` : s.text}</span>}
    </span>
  )
}

// Picks from the product's release list; free text when the product has no list yet.
export function FirmwareSelect({ releases, partNumber, value, onChange, disabled }) {
  const list = releasesFor(releases || [], partNumber)
  if (!list.length) {
    return <input className="form-input" value={value || ''} disabled={disabled} onChange={e => onChange(e.target.value)} placeholder={partNumber ? 'No release list for this product yet' : 'Firmware version'} />
  }
  const known = list.some(r => r.version === value)
  return (
    <select className="form-select" value={value || ''} disabled={disabled} onChange={e => onChange(e.target.value || null)}>
      <option value="">Not recorded</option>
      {value && !known && <option value={value}>{value} (not in release list)</option>}
      {list.map(r => (
        <option key={r.id} value={r.version}>
          {r.version}{r.status === 'CURRENT' ? ' · current' : r.status === 'DEPRECATED' ? ' · deprecated' : ''}{r.release_date ? ` · ${dateFmt(r.release_date)}` : ''}
        </option>
      ))}
    </select>
  )
}

export function useFirmwareReleases() {
  const [releases, setReleases] = useState([])
  const [error, setError] = useState('')
  const reload = () => listFirmware().then(r => { setReleases(r); setError('') }).catch(e => setError(errText(e, 'STEP242_firmware_releases.sql')))
  useEffect(() => { reload() }, [])
  return { releases, reload, error }
}

export function FirmwareReleasesModal({ products: given, initialPart, canEdit, onClose, onChanged }) {
  const [loaded, setLoaded] = useState([])
  const products = given || loaded
  useEffect(() => {
    if (given) return
    supabase.from('products').select('part_number,name').eq('is_serialized', true).order('name').then(({ data }) => setLoaded(data || []))
  }, [given])
  const [part, setPart] = useState(initialPart || given?.[0]?.part_number || '')
  useEffect(() => { if (!part && products.length) setPart(products[0].part_number) }, [products, part])
  const [releases, setReleases] = useState(null)
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => listFirmware().then(setReleases).catch(e => { setError(errText(e, 'STEP242_firmware_releases.sql')); setReleases([]) })
  useEffect(() => { load() }, [])
  const list = releasesFor(releases || [], part)
  const counts = useMemo(() => (releases || []).reduce((m, r) => ((m[r.part_number] = (m[r.part_number] || 0) + 1), m), {}), [releases])

  async function save() {
    setBusy(true); setError('')
    try { await saveFirmware({ ...editing, part_number: part }); setEditing(null); await load(); onChanged?.() } catch (e) { setError(errText(e, 'STEP242_firmware_releases.sql')) }
    setBusy(false)
  }
  async function remove(r) {
    if (!window.confirm(`Delete firmware ${r.version}? Devices already on it keep the version, flagged as not in the release list.`)) return
    try { await deleteFirmware(r.id); await load(); onChanged?.() } catch (e) { setError(errText(e, 'STEP242_firmware_releases.sql')) }
  }
  async function makeCurrent(r) {
    try { await saveFirmware({ ...r, status: 'CURRENT' }); await load(); onChanged?.() } catch (e) { setError(errText(e, 'STEP242_firmware_releases.sql')) }
  }

  return (
    <Modal open size="lg" title="Firmware releases" onClose={onClose} footer={<button className="btn btn-ghost" onClick={onClose}>Close</button>}>
      <Err error={error} />
      <div className="form-row" style={{ alignItems: 'end' }}>
        <div className="form-group">
          <label className="form-label">Product</label>
          <select className="form-select" value={part} onChange={e => { setPart(e.target.value); setEditing(null) }}>
            {products.map(p => <option key={p.part_number} value={p.part_number}>{p.name} ({p.part_number}){counts[p.part_number] ? ` · ${counts[p.part_number]}` : ''}</option>)}
          </select>
        </div>
        {canEdit && part && <div className="form-group"><button className="btn btn-primary" onClick={() => setEditing({ version: '', status: list.length ? 'SUPPORTED' : 'CURRENT', release_date: new Date().toISOString().slice(0, 10) })}><Plus size={14} /> Add release</button></div>}
      </div>
      {editing && (
        <div className="card" style={{ padding: 14, marginBottom: 12, background: '#f8fafc' }}>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Version *</label><input className="form-input" value={editing.version} onChange={e => setEditing(s => ({ ...s, version: e.target.value }))} placeholder="e.g. 2.4.1" autoFocus /></div>
            <div className="form-group"><label className="form-label">Release date</label><input type="date" className="form-input" value={editing.release_date || ''} onChange={e => setEditing(s => ({ ...s, release_date: e.target.value }))} /></div>
          </div>
          <div className="form-group"><label className="form-label">Status</label>
            <select className="form-select" value={editing.status} onChange={e => setEditing(s => ({ ...s, status: e.target.value }))}>
              {FIRMWARE_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 4 }}>Only one release is current per product; marking this current makes the previous one supported. Devices on older releases are flagged “update available”.</div>
          </div>
          <div className="form-group"><label className="form-label">Release notes</label><textarea className="form-textarea" style={{ minHeight: 60 }} value={editing.release_notes || ''} onChange={e => setEditing(s => ({ ...s, release_notes: e.target.value }))} /></div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary btn-sm" disabled={busy || !editing.version?.trim()} onClick={save}>{editing.id ? 'Save' : 'Add'}</button>
          </div>
        </div>
      )}
      {!releases ? <Loader /> : !list.length ? <div style={{ fontSize: 13, color: 'var(--ink-muted)', padding: '12px 0' }}>No releases recorded for this product.</div> : (
        <div className="table-wrap" style={{ marginBottom: 0 }}>
          <table className="gl-table">
            <thead><tr><th>Version</th><th>Status</th><th>Released</th><th>Notes</th>{canEdit && <th />}</tr></thead>
            <tbody>{list.map(r => (
              <tr key={r.id}>
                <td className="gl-code">{r.version}</td>
                <td><span className={`gl-pill ${FIRMWARE_STATUSES.find(s => s.key === r.status)?.tone}`}>{FIRMWARE_STATUSES.find(s => s.key === r.status)?.label}</span></td>
                <td className="nowrap">{r.release_date ? dateFmt(r.release_date) : '—'}</td>
                <td style={{ fontSize: 12, maxWidth: 280, whiteSpace: 'pre-wrap' }}>{r.release_notes || <span className="muted">—</span>}</td>
                {canEdit && <td className="nowrap">
                  {r.status !== 'CURRENT' && <button className="btn btn-ghost btn-sm" onClick={() => makeCurrent(r)}>Make current</button>}
                  <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => setEditing(r)}><Pencil size={12} /></button>
                  <button className="btn btn-ghost btn-sm" title="Delete" style={{ color: '#dc2626' }} onClick={() => remove(r)}><Trash2 size={12} /></button>
                </td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

/* ═══ Sensors ═══ */

export const NOT_REVIEWED_HINT = 'Reviewed in Go-Live → Daily Checks → open the device → Application review → Parameters: tick the parameter this sensor reports (or untick / N/A) and save.'
// Sensor health pill. Pass the sensor row so "Not reviewed" can explain itself,
// and a sensor with no checklist parameter reads as such (it can't be reviewed).
export function SensorHealthPill({ health, row }) {
  if (health === 'NOT_REVIEWED' && row && !row.parameter_key) return <span className="gl-pill gray" title="This sensor type has no checklist parameter — link one in the Sensor catalog (Reports parameter) so daily checks can review it.">No checklist link</span>
  const h = SENSOR_HEALTH[health] || { label: health, tone: 'gray' }
  return <span className={`gl-pill ${h.tone}`} title={health === 'NOT_REVIEWED' ? NOT_REVIEWED_HINT : undefined}>{h.label}</span>
}

// "6 sensors · 1 not working" style summary.
export function SensorSummary({ rows, onClick }) {
  const s = sensorSummary(rows || [])
  const body = !s.total ? <span style={{ color: 'var(--ink-muted)' }}>None mapped</span> : (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontWeight: 600 }}>{s.total} sensor{s.total === 1 ? '' : 's'}</span>
      {s.problem > 0 && <span className="gl-pill red">{s.problem} down</span>}
      {s.problem === 0 && s.working > 0 && <span className="gl-pill green">{s.working} ok</span>}
      {s.notReviewed > 0 && <span className="gl-pill amber">{s.notReviewed} unchecked</span>}
    </span>
  )
  return onClick ? <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '3px 6px', whiteSpace: 'nowrap' }} onClick={onClick}>{body}</button> : body
}

// Catalog of sensor types + default sensor set per equipment category.
export function SensorCatalogModal({ categories, products, canEdit, onClose, onChanged }) {
  const [tab, setTab] = useState('defaults')
  const [types, setTypes] = useState(null)
  const [defaults, setDefaults] = useState([])
  const [editing, setEditing] = useState(null)
  const [cat, setCat] = useState(categories[0] || '')
  const [newCat, setNewCat] = useState('')
  const [error, setError] = useState('')
  const load = async () => {
    try { const [t, d] = await Promise.all([listSensorTypes(), listSensorDefaults()]); setTypes(t); setDefaults(d) } catch (e) { setError(errText(e, 'STEP243_device_sensors.sql')); setTypes([]) }
  }
  useEffect(() => { load() }, [])
  const allCats = useMemo(() => [...new Set([...categories, ...defaults.map(d => d.equipment_category)])].sort((a, b) => a.localeCompare(b)), [categories, defaults])
  const lc = s => String(s || '').trim().toLowerCase()
  const catDefaults = defaults.filter(d => lc(d.equipment_category) === lc(cat))
  const inCat = new Set(catDefaults.map(d => d.sensor_type_id))

  async function toggleDefault(typeId) {
    setError('')
    try {
      const hit = catDefaults.find(d => d.sensor_type_id === typeId)
      if (hit) await removeSensorDefault(hit.id); else await addSensorDefault(cat, typeId)
      await load(); onChanged?.()
    } catch (e) { setError(errText(e, 'STEP243_device_sensors.sql')) }
  }
  async function saveType() {
    setError('')
    try { await saveSensorType(editing); setEditing(null); await load(); onChanged?.() } catch (e) { setError(errText(e, 'STEP243_device_sensors.sql')) }
  }

  return (
    <Modal open size="lg" title="Sensor catalog" onClose={onClose} footer={<button className="btn btn-ghost" onClick={onClose}>Close</button>}>
      <Err error={error} />
      <div className="gl-seg" style={{ marginBottom: 14 }}>
        <button className={tab === 'defaults' ? 'on' : ''} onClick={() => setTab('defaults')}><ListChecks size={13} /> Defaults by equipment</button>
        <button className={tab === 'types' ? 'on' : ''} onClick={() => setTab('types')}><Radio size={13} /> Sensor types</button>
      </div>
      {!types ? <Loader /> : tab === 'defaults' ? (
        <>
          <p style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 0 }}>Tick the sensors every device of this equipment category gets. They are added automatically to devices in the category (now and when a device's category is set); devices can still have sensors added or removed individually.</p>
          <div className="form-row" style={{ alignItems: 'end' }}>
            <div className="form-group"><label className="form-label">Equipment category</label>
              <select className="form-select" value={cat} onChange={e => setCat(e.target.value)}>
                {!allCats.length && <option value="">No categories yet</option>}
                {allCats.map(c => <option key={c} value={c}>{c} · {defaults.filter(d => lc(d.equipment_category) === lc(c)).length} default{defaults.filter(d => lc(d.equipment_category) === lc(c)).length === 1 ? '' : 's'}</option>)}
              </select></div>
            {canEdit && <div className="form-group" style={{ display: 'flex', gap: 6 }}>
              <input className="form-input" value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="New category" />
              <button className="btn btn-ghost" disabled={!newCat.trim()} onClick={() => { setCat(newCat.trim()); setNewCat('') }}>Use</button>
            </div>}
          </div>
          {cat && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              {types.filter(t => t.is_active).map(t => (
                <label key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '9px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, cursor: canEdit ? 'pointer' : 'default', background: inCat.has(t.id) ? '#f5f7ff' : '#fff' }}>
                  <input type="checkbox" checked={inCat.has(t.id)} disabled={!canEdit} onChange={() => toggleDefault(t.id)} />
                  <span style={{ minWidth: 0 }}>{t.name}{t.unit && <span style={{ color: 'var(--ink-muted)', fontSize: 11 }}> · {t.unit}</span>}</span>
                </label>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {canEdit && !editing && <button className="btn btn-primary btn-sm" style={{ marginBottom: 10 }} onClick={() => setEditing({ name: '', parameter_key: '', unit: '', is_active: true })}><Plus size={13} /> Add sensor type</button>}
          {editing && (
            <div className="card" style={{ padding: 14, marginBottom: 12, background: '#f8fafc' }}>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={editing.name} onChange={e => setEditing(s => ({ ...s, name: e.target.value }))} placeholder="e.g. Fuel level sensor" autoFocus /></div>
                <div className="form-group"><label className="form-label">Unit</label><input className="form-input" value={editing.unit || ''} onChange={e => setEditing(s => ({ ...s, unit: e.target.value }))} placeholder="ltr, °C, kPa…" /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Reports parameter</label>
                  <select className="form-select" value={editing.parameter_key || ''} onChange={e => setEditing(s => ({ ...s, parameter_key: e.target.value }))}>
                    <option value="">None</option>
                    {DEFAULT_CHECK_PARAMETERS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                    {editing.parameter_key && !DEFAULT_CHECK_PARAMETERS.some(p => p.key === editing.parameter_key) && <option value={editing.parameter_key}>{editing.parameter_key}</option>}
                  </select>
                  <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 4 }}>Its status comes from this parameter in the daily application review.</div>
                </div>
                <div className="form-group"><label className="form-label">Sensor product</label>
                  <select className="form-select" value={editing.part_number || ''} onChange={e => setEditing(s => ({ ...s, part_number: e.target.value }))}>
                    <option value="">Not tracked</option>{products.map(p => <option key={p.part_number} value={p.part_number}>{p.name} ({p.part_number})</option>)}
                  </select></div>
              </div>
              <div className="form-group"><label className="form-label">Sensor type</label>
                <select className="form-select" value={editing.sensor_kind || ''} onChange={e => setEditing(s => ({ ...s, sensor_kind: e.target.value }))}>
                  <option value="">Select…</option>{SENSOR_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                </select></div>
              <div className="form-group"><label className="form-label">Unit cost (₹)</label>
                <input type="number" min={0} className="form-input" value={editing.unit_cost ?? ''} onChange={e => setEditing(s => ({ ...s, unit_cost: e.target.value }))} placeholder={editing.part_number ? 'Uses the sensor product’s standard cost' : 'e.g. 1500'} />
                <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 4 }}>Prices this sensor in project hardware cost when it has no sensor product (or the product has no standard cost).</div>
              </div>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginBottom: 10 }}><input type="checkbox" checked={editing.is_active !== false} onChange={e => setEditing(s => ({ ...s, is_active: e.target.checked }))} /> Active</label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                <button className="btn btn-primary btn-sm" disabled={!editing.name?.trim()} onClick={saveType}>{editing.id ? 'Save' : 'Add'}</button>
              </div>
            </div>
          )}
          <div className="table-wrap" style={{ marginBottom: 0 }}>
            <table className="gl-table">
              <thead><tr><th>Sensor</th><th>Type</th><th>Parameter</th><th>Unit</th><th className="num">Unit cost</th><th>Defaults for</th><th>Status</th>{canEdit && <th />}</tr></thead>
              <tbody>{types.map(t => (
                <tr key={t.id} style={{ opacity: t.is_active ? 1 : 0.55 }}>
                  <td style={{ fontWeight: 600 }}>{t.name}</td>
                  <td>{t.sensor_kind ? <span className="gl-tag">{t.sensor_kind}</span> : <span className="muted">—</span>}</td>
                  <td className="muted">{DEFAULT_CHECK_PARAMETERS.find(p => p.key === t.parameter_key)?.label || t.parameter_key || '—'}</td>
                  <td>{t.unit || '—'}</td>
                  <td className="num">{t.unit_cost != null ? `₹${Number(t.unit_cost).toLocaleString('en-IN')}` : t.part_number ? <span className="muted">product</span> : <span className="muted">—</span>}</td>
                  <td style={{ fontSize: 12 }}>{defaults.filter(d => d.sensor_type_id === t.id).map(d => d.equipment_category).join(', ') || <span className="muted">—</span>}</td>
                  <td>{t.is_active ? <span className="gl-pill green">Active</span> : <span className="gl-pill gray">Inactive</span>}</td>
                  {canEdit && <td><button className="btn btn-ghost btn-sm" title="Edit" onClick={() => setEditing(t)}><Pencil size={12} /></button></td>}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  )
}

// Sensors fitted to one device, with live health.
export function DeviceSensorsModal({ device, canEdit, onClose, onChanged }) {
  const [rows, setRows] = useState(null)
  const [types, setTypes] = useState([])
  const [adding, setAdding] = useState(null)
  const [showRemoved, setShowRemoved] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const load = async () => {
    try { const [r, t] = await Promise.all([listDeviceSensors([device.id]), listSensorTypes()]); setRows(r); setTypes(t) } catch (e) { setError(errText(e, 'STEP243_device_sensors.sql')); setRows([]) }
  }
  useEffect(() => { load() }, [device.id])
  const changed = async () => { await load(); onChanged?.() }
  const run = async fn => { setError(''); setInfo(''); try { await fn(); await changed() } catch (e) { setError(errText(e, 'STEP243_device_sensors.sql')) } }
  const shown = (rows || []).filter(r => showRemoved || r.sensor_status !== 'REMOVED')
  const s = sensorSummary(rows || [])

  return (
    <Modal open size="lg" title={`Sensors · ${device.serial_number || device.device_code}`} onClose={onClose} footer={<button className="btn btn-ghost" onClick={onClose}>Close</button>}>
      <Err error={error} />
      <div className="gl-summary">
        <div><span>Equipment</span><span>{[device.equipment_id, device.equipment_name].filter(Boolean).join(' · ') || '—'}</span></div>
        <div><span>Category</span><span>{device.equipment_category || '—'}</span></div>
        <div><span>Sensors</span><span>{s.total}</span></div>
        <div><span>Working / down</span><span>{s.working} / {s.problem}</span></div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setAdding({ sensor_type_id: '', serial_number: '', position: '', installed_at: '' })}><Plus size={13} /> Add sensor</button>}
        {canEdit && device.equipment_category && <button className="btn btn-ghost btn-sm" onClick={() => run(async () => { const n = await applyDefaultSensors([device.id]); setInfo(n ? `${n} default sensor(s) added` : 'All default sensors are already mapped') })}>Apply {device.equipment_category} defaults</button>}
        <label style={{ fontSize: 12, display: 'flex', gap: 5, alignItems: 'center', marginLeft: 'auto', color: 'var(--ink-muted)' }}><input type="checkbox" checked={showRemoved} onChange={e => setShowRemoved(e.target.checked)} /> Show removed</label>
      </div>
      {info && <div style={{ fontSize: 12.5, color: '#047857', marginBottom: 8 }}>{info}</div>}
      {adding && (
        <div className="card" style={{ padding: 14, marginBottom: 12, background: '#f8fafc' }}>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Sensor *</label>
              <select className="form-select" value={adding.sensor_type_id} onChange={e => setAdding(a => ({ ...a, sensor_type_id: e.target.value }))}>
                <option value="">Select…</option>{types.filter(t => t.is_active).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Serial number</label><input className="form-input" value={adding.serial_number} onChange={e => setAdding(a => ({ ...a, serial_number: e.target.value }))} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Position</label><input className="form-input" value={adding.position} onChange={e => setAdding(a => ({ ...a, position: e.target.value }))} placeholder="e.g. Tank 1, Rear axle" /></div>
            <div className="form-group"><label className="form-label">Installed</label><input type="date" className="form-input" value={adding.installed_at} onChange={e => setAdding(a => ({ ...a, installed_at: e.target.value }))} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setAdding(null)}>Cancel</button>
            <button className="btn btn-primary btn-sm" disabled={!adding.sensor_type_id} onClick={() => run(async () => { await addDeviceSensor(device.id, adding); setAdding(null) })}>Add</button>
          </div>
        </div>
      )}
      {!rows ? <Loader /> : !shown.length ? <div style={{ fontSize: 13, color: 'var(--ink-muted)', padding: '10px 0' }}>No sensors mapped.{device.equipment_category ? ` Set up defaults for ${device.equipment_category} in the Sensor catalog, or add sensors here.` : ' Set the equipment category to pick up its default sensors, or add sensors here.'}</div> : (
        <div className="table-wrap" style={{ marginBottom: 0 }}>
          <table className="gl-table">
            <thead><tr><th>Sensor</th><th>Serial / position</th><th>Health</th><th>Last reviewed</th><th>Status</th><th>Source</th></tr></thead>
            <tbody>{shown.map(r => (
              <tr key={r.id} style={{ opacity: r.sensor_status === 'REMOVED' ? 0.55 : 1 }}>
                <td style={{ fontWeight: 600 }}>{r.sensor_name}{r.unit && <div className="gl-meta">{r.unit}</div>}</td>
                <td className="nowrap" style={{ fontSize: 12 }}>{[r.serial_number, r.position].filter(Boolean).join(' · ') || <span className="muted">—</span>}</td>
                <td><SensorHealthPill health={r.health} row={r} /></td>
                <td className="nowrap muted" style={{ fontSize: 12 }}>{r.last_check_date ? dateFmt(r.last_check_date) : r.parameter_key ? 'Never' : 'No parameter'}</td>
                <td>
                  {canEdit ? (
                    <select className="form-select gl-sel" data-v={r.sensor_status === 'FAULTY' ? 'FAIL' : r.sensor_status === 'ACTIVE' ? 'PASS' : 'NOT_APPLICABLE'} style={{ minWidth: 110 }} value={r.sensor_status}
                      onChange={e => run(() => updateDeviceSensor(r.id, { status: e.target.value }))}>
                      {SENSOR_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  ) : SENSOR_STATUSES.find(s => s.key === r.sensor_status)?.label}
                </td>
                <td className="muted" style={{ fontSize: 12 }}>{r.source === 'DEFAULT' ? 'Default' : 'Added'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

/* ═══ Device history: linked tasks ═══ */

export function DeviceTasksPanel({ device, people, organizationId, onUpgrade, reloadKey }) {
  const [tasks, setTasks] = useState(null)
  const [flows, setFlows] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    setTasks(null)
    listDeviceTasks(device.id).then(setTasks).catch(e => { setError(errText(e, 'STEP244_device_task_links.sql')); setTasks([]) })
    if (organizationId) listFlows(organizationId).then(setFlows).catch(() => {})
  }, [device.id, reloadKey])
  const h = useMemo(() => makeStatusHelpers(flows, []), [flows])
  const person = id => people?.find(p => p.id === id)?.full_name
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 0 8px', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>Linked tasks</span>
        {onUpgrade && <button className="btn btn-ghost btn-sm" onClick={onUpgrade}><ArrowUpCircle size={13} /> Plan firmware upgrade</button>}
      </div>
      {error && <div style={{ fontSize: 12.5, color: '#b45309' }}>{error}</div>}
      {!tasks ? <Loader /> : !tasks.length ? <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>No tasks linked to this device.</div> : tasks.map(t => {
        const done = h.isTaskDone(t) || ['done', 'completed', 'closed'].includes(String(t.status).toLowerCase())
        return (
          <div key={t.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13, flexWrap: 'wrap' }}>
            {t.device_task_kind === 'FIRMWARE_UPGRADE' ? <Cpu size={14} color="#6366f1" /> : <Wrench size={14} color="var(--ink-muted)" />}
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{t.task_id ? <span className="gl-code" style={{ marginRight: 6 }}>{t.task_id}</span> : null}{t.task_name}</div>
              <div className="gl-meta" style={{ whiteSpace: 'normal' }}>{[person(t.assigned_to), t.planned_end_date && `due ${dateFmt(t.planned_end_date)}`, `created ${dateFmt(t.created_at)}`].filter(Boolean).join(' · ')}</div>
            </div>
            <span className={`gl-pill ${done ? 'green' : 'amber'}`} style={{ color: done ? undefined : h.colorFor(t) }}>{h.labelFor(t)}</span>
          </div>
        )
      })}
    </div>
  )
}

export function FirmwareUpgradeModal({ device, releases, people, organizationId, profile, projectId, onClose, onDone }) {
  const list = releasesFor(releases || [], device.part_number)
  const current = list.find(r => r.status === 'CURRENT')?.version
  const [form, setForm] = useState({ target: current && current !== device.firmware_version ? current : '', assignedTo: '', dueDate: '', note: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true); setError('')
    try {
      await createFirmwareUpgradeTask({ device, targetVersion: form.target, assignedTo: form.assignedTo || null, dueDate: form.dueDate || null, projectId, note: form.note, organizationId }, profile)
      await onDone?.()
    } catch (e) { setError(errText(e, 'STEP244_device_task_links.sql')) }
    setBusy(false)
  }
  return (
    <Modal open title={`Plan firmware upgrade · ${device.serial_number || device.device_code}`} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !form.target} onClick={save}>Create task</button></>}>
      <Err error={error} />
      <p style={{ fontSize: 13, marginTop: 0 }}>Creates a Task Management task linked to this device. When the task is closed, the device's firmware changes to the target version everywhere (Device Instances and Go-Live).</p>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Current firmware</label><div className="form-input" style={{ background: '#f8fafc' }}>{device.firmware_version || 'Not recorded'}</div></div>
        <div className="form-group"><label className="form-label">Target version *</label>
          {list.length ? (
            <select className="form-select" value={form.target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))}>
              <option value="">Select…</option>
              {list.filter(r => r.status !== 'DEPRECATED' && r.version !== device.firmware_version).map(r => <option key={r.id} value={r.version}>{r.version}{r.status === 'CURRENT' ? ' · current' : ''}</option>)}
            </select>
          ) : <input className="form-input" value={form.target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))} placeholder="No release list for this product" />}
        </div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Assign to</label>
          <select className="form-select" value={form.assignedTo} onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))}>
            <option value="">Unassigned</option>{(people || []).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">Due</label><input type="date" className="form-input" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} /></div>
      </div>
      <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" style={{ minHeight: 60 }} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></div>
    </Modal>
  )
}

// Sensor slots for one device: fitted sensors as cards, a "+" placeholder
// for each default sensor of its equipment category that is not fitted yet,
// and a "+ Add sensor" card for anything else.
export function DeviceSensorSlots({ device, canEdit, onChanged }) {
  const [rows, setRows] = useState(null)
  const [types, setTypes] = useState([])
  const [defaults, setDefaults] = useState([])
  const [assign, setAssign] = useState(null) // { sensor_type_id, serial_number, position, installed_at, fixed }
  const [error, setError] = useState('')
  const load = async () => {
    try {
      const [r, t, d] = await Promise.all([listDeviceSensors([device.id]), listSensorTypes(), listSensorDefaults()])
      setRows(r); setTypes(t); setDefaults(d)
    } catch (e) { setError(errText(e, 'STEP243_device_sensors.sql')); setRows([]) }
  }
  useEffect(() => { load() }, [device.id])
  const run = async fn => { setError(''); try { await fn(); await load(); onChanged?.() } catch (e) { setError(errText(e, 'STEP243_device_sensors.sql')) } }
  const lc = s => String(s || '').trim().toLowerCase()
  const live = (rows || []).filter(r => r.sensor_status !== 'REMOVED')
  const removed = (rows || []).filter(r => r.sensor_status === 'REMOVED' && !live.some(l => l.sensor_type_id === r.sensor_type_id))
  const removeSensor = r => { if (window.confirm(`Remove ${r.sensor_name}${r.serial_number ? ` (SN ${r.serial_number})` : ''} from this device? It stays in the history and can be re-fitted.`)) run(() => updateDeviceSensor(r.id, { status: 'REMOVED' })) }
  const fitted = new Set(live.map(r => r.sensor_type_id))
  const missing = defaults.filter(d => lc(d.equipment_category) === lc(device.equipment_category) && !fitted.has(d.sensor_type_id))
    .map(d => types.find(t => t.id === d.sensor_type_id)).filter(t => t?.is_active)
  const card = { border: '1.5px solid var(--border)', borderRadius: 10, padding: '10px 12px', background: '#fff', minWidth: 0 }
  const slot = { ...card, borderStyle: 'dashed', background: '#fafbff', cursor: canEdit ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink-soft)', textAlign: 'left', font: 'inherit' }
  const bar = { green: '#10b981', red: '#ef4444', amber: '#f59e0b', gray: '#cbd5e1' }

  if (!rows) return <Loader />
  return (
    <div>
      <Err error={error} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10, fontSize: 12.5 }}>
        <SensorSummary rows={rows} />
        {missing.length > 0 && <span className="gl-pill amber">{missing.length} default{missing.length === 1 ? '' : 's'} not fitted</span>}
        {!device.equipment_category && <span style={{ color: 'var(--ink-muted)' }}>Set the equipment category to get its default sensors.</span>}
        <div style={{ flex: 1 }} />
        {canEdit && missing.length > 1 && <button className="btn btn-ghost btn-sm" onClick={() => run(() => applyDefaultSensors([device.id]))}><Plus size={12} /> Fit all {missing.length} defaults</button>}
        {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setAssign({ sensor_type_id: '', serial_number: '', position: '', installed_at: '', fixed: false })}><Plus size={12} /> Add sensor</button>}
      </div>
      {assign && (
        <div className="card" style={{ padding: 14, marginBottom: 12, background: '#f8fafc' }}>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Sensor *</label>
              {assign.fixed ? <div className="form-input" style={{ background: '#fff' }}>{types.find(t => t.id === assign.sensor_type_id)?.name}</div> : (
                <select className="form-select" value={assign.sensor_type_id} onChange={e => setAssign(a => ({ ...a, sensor_type_id: e.target.value }))} autoFocus>
                  <option value="">Select…</option>{types.filter(t => t.is_active).map(t => <option key={t.id} value={t.id}>{t.name}{fitted.has(t.id) ? ' (already fitted)' : ''}</option>)}
                </select>
              )}</div>
            <div className="form-group"><label className="form-label">Serial number</label><input className="form-input" value={assign.serial_number} onChange={e => setAssign(a => ({ ...a, serial_number: e.target.value }))} autoFocus={assign.fixed} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Position</label><input className="form-input" value={assign.position} onChange={e => setAssign(a => ({ ...a, position: e.target.value }))} placeholder="e.g. Tank 1" /></div>
            <div className="form-group"><label className="form-label">Installed</label><input type="date" className="form-input" value={assign.installed_at} onChange={e => setAssign(a => ({ ...a, installed_at: e.target.value }))} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setAssign(null)}>Cancel</button>
            <button className="btn btn-primary btn-sm" disabled={!assign.sensor_type_id} onClick={() => run(async () => { await addDeviceSensor(device.id, assign); setAssign(null) })}>Assign</button>
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
        {live.map(r => (
          <div key={r.id} style={{ ...card, borderLeft: `4px solid ${bar[SENSOR_HEALTH[r.health]?.tone || 'gray']}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ fontWeight: 700, fontSize: 13, minWidth: 0 }}>{r.sensor_name}</div>
              <SensorHealthPill health={r.health} row={r} />
            </div>
            <div className="gl-meta" style={{ marginTop: 3, whiteSpace: 'normal' }}>
              {r.sensor_kind && <span className="gl-tag" style={{ marginRight: 6 }}>{r.sensor_kind}</span>}
              {[r.serial_number && `SN ${r.serial_number}`, r.position, r.unit, r.source === 'DEFAULT' ? 'default' : null].filter(Boolean).join(' · ') || 'No serial recorded'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <span className="gl-meta" style={{ flex: 1 }}>{r.last_check_date ? `Reviewed ${dateFmt(r.last_check_date)}` : r.parameter_key ? 'Not reviewed yet' : 'No checklist parameter'}</span>
              {canEdit && <>
                <select className="form-select gl-sel" data-v={r.sensor_status === 'FAULTY' ? 'FAIL' : 'PASS'} style={{ width: 'auto', height: 28, padding: '2px 6px', fontSize: 11.5 }} value={r.sensor_status}
                  onChange={e => run(() => updateDeviceSensor(r.id, { status: e.target.value }))} aria-label={`${r.sensor_name} status`}>
                  {SENSOR_STATUSES.filter(x => x.key !== 'REMOVED').map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
                <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '3px 7px', color: '#dc2626' }} title="Remove this sensor" onClick={() => removeSensor(r)}><Trash2 size={12} /></button>
              </>}
            </div>
          </div>
        ))}
        {missing.map(t => (
          <button key={t.id} type="button" style={slot} disabled={!canEdit} title={canEdit ? `Assign ${t.name}` : 'Default sensor not fitted'}
            onClick={() => setAssign({ sensor_type_id: t.id, serial_number: '', position: '', installed_at: '', fixed: true })}>
            <span style={{ width: 28, height: 28, borderRadius: 8, border: '1.5px dashed #a5b4fc', display: 'grid', placeItems: 'center', color: '#6366f1', flexShrink: 0 }}><Plus size={15} /></span>
            <span style={{ minWidth: 0 }}><span style={{ display: 'block', fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>{t.name}</span><span className="gl-meta">Default for {device.equipment_category} · not fitted</span></span>
          </button>
        ))}
        {canEdit && (
          <button type="button" style={{ ...slot, justifyContent: 'center', minHeight: 64 }} onClick={() => setAssign({ sensor_type_id: '', serial_number: '', position: '', installed_at: '', fixed: false })}>
            <Plus size={15} color="#6366f1" /> <span style={{ fontWeight: 700, color: '#4338ca' }}>Add sensor</span>
          </button>
        )}
      </div>
      {!live.length && !missing.length && !canEdit && <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>No sensors mapped.</div>}
      {removed.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-muted)', marginBottom: 6 }}>Removed ({removed.length})</div>
          {removed.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12.5 }}>
              <span style={{ flex: 1, minWidth: 0, color: 'var(--ink-soft)' }}>{r.sensor_name}{r.serial_number ? ` · SN ${r.serial_number}` : ''}{r.removed_at ? ` · removed ${dateFmt(r.removed_at)}` : ''}</span>
              {canEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => run(() => updateDeviceSensor(r.id, { status: 'ACTIVE' }))}><RotateCcw size={12} /> Re-fit</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Add or remove one sensor type across several devices (Device Instances bulk action).
export function BulkSensorModal({ mode, deviceIds, onClose, onDone }) {
  const [types, setTypes] = useState([])
  const [typeId, setTypeId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { listSensorTypes().then(t => setTypes(t.filter(x => x.is_active))).catch(e => setError(errText(e, 'STEP243_device_sensors.sql'))) }, [])
  async function go() {
    setBusy(true); setError('')
    try {
      const n = mode === 'add' ? await bulkAddSensor(deviceIds, typeId) : await bulkRemoveSensor(deviceIds, typeId)
      const name = types.find(t => t.id === typeId)?.name
      await onDone(mode === 'add' ? `${name} fitted on ${n} device(s)${n < deviceIds.length ? ` — ${deviceIds.length - n} already had it` : ''}.` : `${name} removed from ${n} device(s).`)
    } catch (e) { setError(errText(e, 'STEP243_device_sensors.sql')) }
    setBusy(false)
  }
  return (
    <Modal open title={`${mode === 'add' ? 'Add a sensor to' : 'Remove a sensor from'} ${deviceIds.length} device${deviceIds.length === 1 ? '' : 's'}`} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className={`btn ${mode === 'add' ? 'btn-primary' : 'btn-danger'}`} disabled={busy || !typeId} onClick={go}>{busy ? 'Saving…' : mode === 'add' ? 'Add sensor' : 'Remove sensor'}</button></>}>
      <Err error={error} />
      <div className="form-group"><label className="form-label">Sensor</label>
        <select className="form-select" value={typeId} onChange={e => setTypeId(e.target.value)} autoFocus>
          <option value="">Select…</option>{types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select></div>
      <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{mode === 'add' ? 'Devices that already have this sensor are left as they are. Add serial numbers per device from the device view.' : 'Removed sensors stay in each device’s history and can be re-fitted from the device view.'}</div>
    </Modal>
  )
}

// Device link for Task Management: search by device code, serial or
// equipment; the chosen device lists this task in its history.
export function DevicePicker({ value, onChange }) {
  const [device, setDevice] = useState(null)
  const [term, setTerm] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  useEffect(() => { if (value && value !== device?.id) getDevice(value).then(setDevice); if (!value) setDevice(null) }, [value])
  useEffect(() => {
    if (!term.trim()) { setResults([]); return }
    const t = setTimeout(() => searchDevicesForLink(term).then(setResults).catch(() => setResults([])), 250)
    return () => clearTimeout(t)
  }, [term])
  const label = d => [d.serial_number || d.device_code, [d.equipment_id, d.equipment_name].filter(Boolean).join(' · ')].filter(Boolean).join(' — ')
  if (device) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 10px', border: '1.5px solid var(--border)', borderRadius: 8, background: '#fff' }}>
        <Cpu size={14} color="#6366f1" style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label(device)}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDevice(null); onChange(null) }}>Remove</button>
      </div>
    )
  }
  return (
    <div style={{ position: 'relative' }}>
      <input className="form-input" value={term} placeholder="Search device code, serial or equipment…" onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={e => { setTerm(e.target.value); setOpen(true) }} />
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%', marginTop: 4, background: '#fff', border: '1.5px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(15,23,42,.12)', maxHeight: 240, overflowY: 'auto' }}>
          {results.map(d => (
            <button key={d.id} type="button" onMouseDown={e => e.preventDefault()} onClick={() => { setDevice(d); onChange(d.id); setTerm(''); setOpen(false) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', borderBottom: '1px solid var(--border)', background: '#fff', cursor: 'pointer', font: 'inherit', fontSize: 13 }}>
              <span className="gl-code">{d.serial_number || d.device_code}</span>
              <span style={{ color: 'var(--ink-muted)', fontSize: 12 }}>{[d.equipment_id, d.equipment_name, d.current_location].filter(Boolean).length ? ` · ${[d.equipment_id, d.equipment_name, d.current_location].filter(Boolean).join(' · ')}` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Read-only device label for task detail.
export function DeviceLink({ id }) {
  const [d, setD] = useState(null)
  useEffect(() => { getDevice(id).then(setD) }, [id])
  if (!d) return null
  return <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Cpu size={12} color="#6366f1" /><span className="gl-code">{d.serial_number || d.device_code}</span>{[d.equipment_id, d.equipment_name].filter(Boolean).length > 0 && <span style={{ color: 'var(--ink-muted)' }}>{[d.equipment_id, d.equipment_name].filter(Boolean).join(' · ')}</span>}</span>
}
