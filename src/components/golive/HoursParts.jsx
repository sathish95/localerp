import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  listHoursCompare, listHoursUploads, readHoursFile, ingestHours, toleranceOf, saveTolerance,
  createMismatchAction, acceptVariance, setActionStatus, getTasksByIds, exportHoursXlsx,
} from '../../lib/goLiveHours'
import { summarizeHours, matchEquipment, findDuplicateRows, applyHoursEdit, HOURS_STATUSES, ACTION_STATUSES } from '../../lib/goLiveHoursRules'
import { deviceLabel } from '../../lib/goLive'
import { istToday, addDays, istDateTime } from '../../lib/goLiveRules'
import { Modal, Loader, Empty, StatCard, Badge } from '../ui'
import { PersonSelect, Field, ErrorLine, Chip, errText } from './shared'
import { Upload, Settings2, Download, Gauge, Scale, Timer, AlertTriangle, ClipboardList, CheckCircle2 } from 'lucide-react'

const fmt = (n, d = 1) => (n == null ? '—' : Number(n).toFixed(d))
const signed = n => (n == null ? '—' : `${n > 0 ? '+' : ''}${Number(n).toFixed(2)}`)

// Shared hours pieces (STEP237/238) used by the Daily Checks tab and the
// Overview: upload, tolerance, field-task and accept-variance dialogs and
// the category summary table.

export function CategoryTable({ categories, tolerance, onPick, picked }) {
  if (!categories.length) return <div style={{ fontSize: 13, color: 'var(--ink-muted)', padding: 12 }}>No hours for this period yet.</div>
  return (
    <table className="data-table" style={{ display: 'table', fontSize: 12.5 }}>
      <thead><tr><th>Category</th><th>Equipment</th><th>Manual h</th><th>IoT h</th><th>Diff</th><th>Uptime manual / IoT</th><th>Match rate</th><th>Mismatch</th><th>Missing</th><th>Tolerance</th><th>Fuel L</th><th>Avg fuel L/h</th></tr></thead>
      <tbody>{categories.map(c => (
        <tr key={c.category} style={{ cursor: onPick ? 'pointer' : 'default' }} onClick={() => onPick?.(c.category)}>
          <td style={{ fontWeight: 700 }}>{c.category}{picked === c.category && <span style={{ color: 'var(--c1)' }}> · filtered</span>}</td>
          <td>{c.equipment}</td><td>{fmt(c.manualHours)}</td><td>{fmt(c.iotHours)}</td>
          <td style={{ color: c.diffPct != null && Math.abs(c.diffPct) > (tolerance.by_category[c.category] ?? tolerance.default_pct) ? '#b91c1c' : undefined }}>{c.diffPct == null ? '—' : `${c.diffPct > 0 ? '+' : ''}${c.diffPct}%`}</td>
          <td>{c.manualUptimePct ?? '—'}% / {c.iotUptimePct ?? '—'}%</td>
          <td>{c.matchRate == null ? '—' : `${c.matchRate}%`}</td>
          <td>{c.mismatch ? <Chip tone="red">{c.mismatch}</Chip> : 0}</td>
          <td>{c.missingManual + c.missingIot || ''}</td>
          <td>±{tolerance.by_category[c.category] ?? tolerance.default_pct}%</td>
          <td>{c.fuelLitres ?? '—'}</td>
          <td>{c.avgFuelLph ?? '—'}</td>
        </tr>
      ))}</tbody>
    </table>
  )
}

// One editable hours cell in the upload preview (blank = no value).
function HourInput({ value, edited, onChange, width = 72 }) {
  return (
    <input type="number" min={0} step="any" className="form-input" value={value ?? ''} onChange={e => onChange(e.target.value)}
      style={{ width, height: 28, padding: '0 6px', fontSize: 12, borderColor: edited ? 'var(--c1)' : undefined, background: edited ? 'rgba(99,102,241,.06)' : undefined }} />
  )
}

const PREVIEW_VIEWS = [['all', 'All'], ['attention', 'Needs attention'], ['changed', 'Differs from saved'], ['edited', 'Edited']]

export function UploadModal({ source, ctx, onClose, onDone }) {
  const { engagement, enrollments } = ctx
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [mapping, setMapping] = useState({}) // ref (lowercased) → enrollment id
  const [edits, setEdits] = useState({}) // row key → { running_hours, offline_hours, … } as typed
  const [skipped, setSkipped] = useState({}) // row key → true
  const [saved, setSaved] = useState({}) // `${enrollment}|${date}` → { running, offline, fuel } already saved
  const [view, setView] = useState('all')
  const [q, setQ] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const isIot = source === 'IOT'
  const label = isIot ? 'IoT logger hours' : "client's manual hours report"
  const live = enrollments.filter(e => !e.deleted_at)
  const logsheet = parsed?.layout === 'logsheet'

  async function pick(f) {
    setFile(f); setParsed(null); setResult(null); setError(''); setMapping({}); setEdits({}); setSkipped({}); setSaved({})
    if (!f) return
    try {
      const p = await readHoursFile(f)
      p.rows = p.rows.map(r => ({ ...r, key: r.key ?? String(r.rowNo) }))
      setParsed(p)
      // what's already saved for these dates, shown alongside the upload
      const dates = p.rows.map(r => r.date).filter(Boolean).sort()
      if (dates.length) {
        const cur = await listHoursCompare(engagement.id, { from: dates[0], to: dates[dates.length - 1] }).catch(() => [])
        setSaved(Object.fromEntries(cur.map(c => [`${c.enrollment_id}|${c.reading_date}`, isIot
          ? { running: c.iot_hours, offline: c.iot_offline_hours, fuel: c.iot_fuel_litres }
          : { running: c.manual_hours, offline: c.manual_offline_hours }])))
      }
    } catch (e) { setError(errText(e)) }
  }
  const rows = useMemo(() => (parsed?.rows || []).map(r => applyHoursEdit(r, edits[r.key])), [parsed, edits])
  const dups = useMemo(() => findDuplicateRows(rows), [rows])
  const resolved = rows.map(r => {
    const enr = mapping[r.equipment_ref.toLowerCase()] ? live.find(e => e.id === mapping[r.equipment_ref.toLowerCase()]) : matchEquipment(r.equipment_ref, live)
    const cur = enr && r.date ? saved[`${enr.id}|${r.date}`] : null
    const same = (a, b) => (a == null ? null : Number(a)) === (b == null ? null : Number(b))
    const differs = !!cur && (cur.running != null || cur.offline != null) && !(same(cur.running, r.running_hours) && same(cur.offline, r.offline_hours))
    return { ...r, enrollment: enr, saved: cur, differs }
  })
  const unmatchedRefs = [...new Set(resolved.filter(r => !r.enrollment && r.equipment_ref && !r.issues.length).map(r => r.equipment_ref))]
  const ready = resolved.filter(r => r.enrollment && !r.issues.length && !skipped[r.key])
  const errorRows = resolved.filter(r => r.issues.length).length
  const skippedCount = Object.values(skipped).filter(Boolean).length
  const needsAttention = r => !r.enrollment || r.issues.length > 0 || dups.has(r.key)
  const counts = {
    all: resolved.length, attention: resolved.filter(needsAttention).length,
    changed: resolved.filter(r => r.differs).length, edited: resolved.filter(r => r.edited).length,
  }
  const ql = q.trim().toLowerCase()
  const shown = resolved.filter(r =>
    (view === 'all' || (view === 'attention' && needsAttention(r)) || (view === 'changed' && r.differs) || (view === 'edited' && r.edited))
    && (!ql || [r.equipment_ref, r.equipment_name, r.enrollment?.equipment_name, r.date].some(v => String(v || '').toLowerCase().includes(ql))))

  const edit = (key, field, value) => setEdits(m => ({ ...m, [key]: { ...m[key], [field]: value } }))
  const isEdited = (r, field) => !!edits[r.key] && field in edits[r.key]
  const cellVal = (r, field) => (isEdited(r, field) ? edits[r.key][field] : r[field])
  const resetRow = key => setEdits(m => { const n = { ...m }; delete n[key]; return n })
  const hourCell = (r, field, width) => <td><HourInput width={width} value={cellVal(r, field)} edited={isEdited(r, field)} onChange={v => edit(r.key, field, v)} /></td>

  async function commit() {
    setBusy(true); setError('')
    try {
      const res = await ingestHours(engagement.id, source, ready.map(r => ({ ...r, enrollment_id: r.enrollment.id })), file.name)
      setResult(res); await onDone()
    } catch (e) { setError(errText(e)) }
    setBusy(false)
  }

  return (
    <Modal open size="lg" title={`Upload ${label}`} onClose={onClose}
      footer={result ? <button className="btn btn-primary" onClick={onClose}>Done</button> : <>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !ready.length} onClick={commit}>{busy ? 'Saving…' : `Save ${ready.length} row(s)`}</button></>}>
      <ErrorLine error={error} />
      {result ? (
        <div style={{ fontSize: 13 }}>
          <p style={{ marginTop: 0 }}><CheckCircle2 size={15} color="#059669" style={{ verticalAlign: -3 }} /> Saved <strong>{result.saved}</strong> row(s). A re-upload for the same equipment and date replaces the earlier value.</p>
          {result.unmatched?.length > 0 && <p>Not matched on the server: {result.unmatched.join(', ')}</p>}
          {result.invalid?.length > 0 && <p style={{ color: '#b91c1c' }}>Rejected: {result.invalid.map(i => `row ${i.row} (${i.error})`).join('; ')}</p>}
        </div>
      ) : (
        <>
          <p style={{ fontSize: 13, marginTop: 0, color: 'var(--ink-soft)' }}>
            Excel or CSV with one row per equipment per day: <strong>Equipment ID</strong>, <strong>Date</strong>, <strong>Running hrs</strong>, and optionally <strong>Offline hrs</strong>, <strong>Category</strong>{isIot && <> and <strong>Fuel (L)</strong></>}. The header row is found automatically; hours can be decimals or hh:mm.{!isIot && <> The client's daily logsheet also works as is: <strong>Equipment Number</strong> with <strong>Open / Closing / Total / B/D Hrs</strong> under each date — Total Hrs (or Closing − Open) is the running time, B/D Hrs the offline time.</>}
          </p>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={e => pick(e.target.files[0])} />
          {parsed && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
                <Chip tone="green">{ready.length} ready</Chip>
                {unmatchedRefs.length > 0 && <Chip tone="amber">{unmatchedRefs.length} equipment not matched</Chip>}
                {errorRows > 0 && <Chip tone="red">{errorRows} row(s) with errors</Chip>}
                {dups.size > 0 && <Chip tone="amber">{dups.size} duplicate equipment/date rows — the last one wins</Chip>}
                {skippedCount > 0 && <Chip tone="gray">{skippedCount} unticked</Chip>}
                <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Sheet “{parsed.sheet}”, header on row {parsed.headerRow}{logsheet && ` · daily logsheet, ${parsed.dates.length} date(s): ${parsed.dates.join(', ')} · Total Hrs → running, B/D Hrs → offline`}</span>
              </div>
              {unmatchedRefs.length > 0 && (
                <div className="card" style={{ padding: 10, marginBottom: 10, maxHeight: 180, overflow: 'auto' }}>
                  <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>Map equipment to an enrolled device (or set the Equipment ID on the device in the Devices tab)</div>
                  {unmatchedRefs.map(ref => (
                    <div key={ref} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, fontSize: 13 }}>
                      <span style={{ minWidth: 140 }}>“{ref}”</span>
                      <select className="form-select" style={{ maxWidth: 300 }} value={mapping[ref.toLowerCase()] || ''} onChange={e => setMapping(m => ({ ...m, [ref.toLowerCase()]: e.target.value }))}>
                        <option value="">Skip these rows</option>
                        {live.map(e => <option key={e.id} value={e.id}>{deviceLabel(e.device)}{e.equipment_id ? ` · ${e.equipment_id}` : ''}{e.equipment_name ? ` · ${e.equipment_name}` : ''}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                {PREVIEW_VIEWS.map(([k, l]) => (
                  <button key={k} className={`btn btn-sm ${view === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setView(k)}>{l} ({counts[k]})</button>
                ))}
                <input className="form-input" style={{ maxWidth: 220, height: 30 }} placeholder="Search equipment or date…" value={q} onChange={e => setQ(e.target.value)} />
                {counts.edited > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setEdits({})}>Undo all edits</button>}
                <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Edit any hours before saving{logsheet && ' — changing Open / Closing recalculates the total'}.</span>
              </div>
              <div className="gl-tscroll" style={{ maxHeight: 420, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                <table className="data-table" style={{ display: 'table', fontSize: 12 }}>
                  <thead><tr>
                    <th title="Include in the save">Save</th><th>Row</th><th>Equipment</th><th>Device</th>{!logsheet && <th>Category</th>}<th>Date</th>
                    {logsheet && <><th>Open</th><th>Closing</th></>}
                    <th>{logsheet ? 'Total (running)' : 'Running'}</th><th>{logsheet ? 'B/D (offline)' : 'Offline'}</th>{isIot && <th>Fuel L</th>}
                    <th>Saved now</th><th>Issues</th><th />
                  </tr></thead>
                  <tbody>{shown.map(r => {
                    const ok = r.enrollment && !r.issues.length
                    return (
                      <tr key={r.key} style={{ opacity: ok && !skipped[r.key] ? 1 : 0.75, background: r.issues.length ? 'rgba(220,38,38,.05)' : undefined }}>
                        <td><input type="checkbox" disabled={!ok} checked={!!ok && !skipped[r.key]} onChange={e => setSkipped(m => ({ ...m, [r.key]: !e.target.checked }))} /></td>
                        <td>{r.rowNo}</td>
                        <td>{r.equipment_ref}{r.equipment_name && <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{r.equipment_name}</div>}</td>
                        <td>{r.enrollment ? deviceLabel(r.enrollment.device) : <span style={{ color: '#b45309' }}>not matched</span>}</td>
                        {!logsheet && <td>{r.category || r.enrollment?.equipment_category || ''}</td>}
                        <td style={{ whiteSpace: 'nowrap' }}>{r.date || '—'}</td>
                        {logsheet && <>{hourCell(r, 'open_hours', 84)}{hourCell(r, 'closing_hours', 84)}</>}
                        {/* running follows Closing − Open edits, so show the computed value unless typed directly */}
                        <td><HourInput value={isEdited(r, 'running_hours') ? edits[r.key].running_hours : r.running_hours} edited={isEdited(r, 'running_hours')} onChange={v => edit(r.key, 'running_hours', v)} /></td>
                        {hourCell(r, 'offline_hours')}
                        {isIot && hourCell(r, 'fuel_litres')}
                        <td style={{ whiteSpace: 'nowrap', color: r.differs ? '#b45309' : 'var(--ink-muted)' }} title={r.differs ? 'Saving replaces this value' : ''}>
                          {r.saved && r.saved.running != null ? `${r.saved.running} h${r.saved.offline != null ? ` · ${r.saved.offline} off` : ''}` : '—'}
                        </td>
                        <td style={{ color: '#b91c1c' }}>{[...r.issues, dups.has(r.key) ? 'duplicate' : ''].filter(Boolean).join('; ')}</td>
                        <td>{r.edited && <button className="btn btn-ghost btn-sm" title="Undo edits on this row" onClick={() => resetRow(r.key)}>Undo</button>}</td>
                      </tr>
                    )
                  })}</tbody>
                </table>
                {!shown.length && <div style={{ padding: 14, fontSize: 13, color: 'var(--ink-muted)' }}>No rows in this view.</div>}
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

export function ToleranceModal({ engagement, categories, onClose, onSaved }) {
  const t = toleranceOf(engagement)
  const [form, setForm] = useState({ default_pct: t.default_pct, abs_hours: t.abs_hours, by_category: { ...Object.fromEntries(categories.map(c => [c, ''])), ...t.by_category } })
  const [newCat, setNewCat] = useState('')
  const [error, setError] = useState('')
  async function save() {
    setError('')
    try { await saveTolerance(engagement, form); await onSaved() } catch (e) { setError(errText(e)) }
  }
  return (
    <Modal open title="Hours tolerance" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>}>
      <ErrorLine error={error} />
      <p style={{ fontSize: 13, marginTop: 0 }}>An equipment-day <strong>matches</strong> when IoT hours are within ± the percentage of the manual (client) hours, <em>or</em> within the minimum difference in hours — so short running days don't flag on rounding.</p>
      <div className="form-row">
        <Field label="Default tolerance (± %)"><input type="number" min={0} step={0.1} className="form-input" value={form.default_pct} onChange={e => setForm(f => ({ ...f, default_pct: e.target.value }))} /></Field>
        <Field label="Minimum difference (hours)" hint="Differences up to this are always a match"><input type="number" min={0} step={0.05} className="form-input" value={form.abs_hours} onChange={e => setForm(f => ({ ...f, abs_hours: e.target.value }))} /></Field>
      </div>
      <div style={{ fontWeight: 700, fontSize: 13, margin: '4px 0 8px' }}>Per-category override <span style={{ fontWeight: 400, color: 'var(--ink-muted)' }}>(blank = default)</span></div>
      {Object.keys(form.by_category).map(c => (
        <div key={c} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <span style={{ minWidth: 160, fontSize: 13 }}>{c}</span>
          <input type="number" min={0} step={0.1} className="form-input" style={{ width: 110 }} placeholder={`${form.default_pct}`} value={form.by_category[c]} onChange={e => setForm(f => ({ ...f, by_category: { ...f.by_category, [c]: e.target.value } }))} />
          <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>%</span>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input className="form-input" style={{ maxWidth: 200 }} placeholder="Add category…" value={newCat} onChange={e => setNewCat(e.target.value)} />
        <button className="btn btn-ghost btn-sm" disabled={!newCat.trim()} onClick={() => { setForm(f => ({ ...f, by_category: { ...f.by_category, [newCat.trim()]: '' } })); setNewCat('') }}>Add</button>
      </div>
    </Modal>
  )
}

export function TaskModal({ ctx, row, enrollment, onClose, onDone }) {
  const { engagement, lookups, cur, profile } = ctx
  const fieldUser = enrollment?.onsite_coordinator_user_id || (cur.ONSITE_COORDINATOR?.primary_unavailable ? cur.ONSITE_COORDINATOR?.backup_user_id : cur.ONSITE_COORDINATOR?.primary_user_id) || ''
  const big = row.diff_pct != null && Math.abs(row.diff_pct) >= 10
  const [form, setForm] = useState({ assignedTo: fieldUser, dueDate: addDays(istToday(), 1), priority: big ? 'high' : 'medium', note: '', withIncident: true })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  async function save() {
    setBusy(true); setError('')
    try { await createMismatchAction({ engagement, enrollment, row, ...form }, profile); await onDone() } catch (e) { setError(errText(e)) }
    setBusy(false)
  }
  return (
    <Modal open title={`Field task · ${row.equipment}`} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !form.assignedTo} onClick={save}>{busy ? 'Creating…' : 'Create task'}</button></>}>
      <ErrorLine error={error} />
      <div className="card" style={{ padding: 10, marginBottom: 12, fontSize: 13 }}>
        {row.reading_date} · manual <strong>{fmt(row.manual_hours, 2)} h</strong> vs IoT <strong>{fmt(row.iot_hours, 2)} h</strong>
        {row.diff_pct != null && <> · <span style={{ color: '#b91c1c', fontWeight: 700 }}>{row.diff_pct > 0 ? '+' : ''}{row.diff_pct}%</span> (tolerance ±{row.tolerance_pct}%)</>}
        {row.status !== 'MISMATCH' && <> · <Badge type="warning">{HOURS_STATUSES[row.status]?.label}</Badge></>}
      </div>
      <Field label="Field user" required hint="Defaults to the device's onsite coordinator">
        <PersonSelect people={lookups.people} value={form.assignedTo} onChange={v => set('assignedTo', v)} prefer={[fieldUser, cur.ONSITE_COORDINATOR?.backup_user_id]} />
      </Field>
      <div className="form-row">
        <Field label="Due date"><input type="date" className="form-input" min={istToday()} value={form.dueDate} onChange={e => set('dueDate', e.target.value)} /></Field>
        <Field label="Priority">
          <select className="form-select" value={form.priority} onChange={e => set('priority', e.target.value)}>
            {['low', 'medium', 'high', 'critical'].map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Instructions for the field user"><textarea className="form-textarea" value={form.note} onChange={e => set('note', e.target.value)} placeholder="Check the logger clock and run-status input; compare against the shift log." /></Field>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
        <input type="checkbox" checked={form.withIncident} onChange={e => set('withIncident', e.target.checked)} /> Also raise a linked go-live incident (Data quality)
      </label>
    </Modal>
  )
}

export function AcceptModal({ row, profile, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  async function save() {
    setError('')
    try { await acceptVariance({ row, reason }, profile); await onDone() } catch (e) { setError(errText(e)) }
  }
  return (
    <Modal open title={`Accept variance · ${row.equipment}`} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!reason.trim()} onClick={save}>Accept</button></>}>
      <ErrorLine error={error} />
      <p style={{ fontSize: 13, marginTop: 0 }}>{row.reading_date}: manual {fmt(row.manual_hours, 2)} h vs IoT {fmt(row.iot_hours, 2)} h. No task is created; the reason is kept with the record and shown in reports.</p>
      <Field label="Reason" required><textarea className="form-textarea" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Planned maintenance not recorded in the manual log" /></Field>
    </Modal>
  )
}
