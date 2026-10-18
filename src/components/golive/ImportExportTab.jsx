import { useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { exportTracker, parseTrackerFile, resolveDevices, stageImport, commitImport, downloadImportReport } from '../../lib/goLiveExcel'
import { searchDevices, deviceLabel } from '../../lib/goLive'
import { istToday, labelOf, PRIORITIES, INCIDENT_STATUSES, ROSTER_ROLES } from '../../lib/goLiveRules'
import { Tabs, Loader } from '../ui'
import { ResultBadge, FlagBadge, Field, ErrorLine, Chip, errText } from './shared'
import { Download, Upload, FileSpreadsheet, CheckCircle2 } from 'lucide-react'

const norm = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

export default function ImportExportTab({ ctx }) {
  const { engagement, perms } = ctx
  return (
    <div>
      <ExportCard ctx={ctx} />
      {perms.canManage && !['CLOSED', 'CANCELLED'].includes(engagement.status) && <ImportCard ctx={ctx} />}
    </div>
  )
}

function ExportCard({ ctx }) {
  const { engagement, lookups } = ctx
  const [range, setRange] = useState({ from: engagement.hypercare_start || engagement.go_live_date, to: istToday(), review: istToday() })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function go() {
    setBusy(true); setError('')
    try { await exportTracker({ engagement, lookups, from: range.from, to: range.to, reviewDate: range.review }) } catch (e) { setError(errText(e)) }
    setBusy(false)
  }
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header"><div className="card-title"><FileSpreadsheet size={14} /> Export tracker (Excel layout)</div></div>
      <div className="card-body">
        <ErrorLine error={error} />
        <p style={{ fontSize: 13, marginTop: 0, color: 'var(--ink-soft)' }}>Device Register, Daily Checks and Incidents sheets in the same column order as the manual tracker, with computed result and follow-up flags — plus a Handover Summary sheet.</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Checks from"><input type="date" className="form-input" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} /></Field>
          <Field label="to"><input type="date" className="form-input" value={range.to} max={istToday()} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} /></Field>
          <Field label="Review date (header counters)"><input type="date" className="form-input" value={range.review} onChange={e => setRange(r => ({ ...r, review: e.target.value }))} /></Field>
          <div className="form-group"><button className="btn btn-primary" disabled={busy || !range.from || !range.to} onClick={go}><Download size={14} /> {busy ? 'Building…' : 'Download .xlsx'}</button></div>
        </div>
      </div>
    </div>
  )
}

function ImportCard({ ctx }) {
  const { engagement, lookups, enrollments, reloadAll } = ctx
  const [parsed, setParsed] = useState(null)
  const [resolver, setResolver] = useState(null)
  const [existing, setExisting] = useState([])
  const [maps, setMaps] = useState({ devices: {}, people: {}, keep: {} })
  const [tab, setTab] = useState('checks')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [deviceSearch, setDeviceSearch] = useState({})

  const staged = useMemo(() => parsed && resolver ? stageImport(parsed, resolver, lookups.people, maps, existing) : null, [parsed, resolver, lookups.people, maps, existing])

  async function onFile(file) {
    if (!file) return
    setBusy('parse'); setError(''); setResult(null); setMaps({ devices: {}, people: {}, keep: {} })
    try {
      const p = await parseTrackerFile(file)
      const r = await resolveDevices(p, enrollments)
      const { data } = await supabase.from('golive_daily_checks').select('enrollment_id,check_date').eq('engagement_id', engagement.id).is('deleted_at', null)
      const devOf = Object.fromEntries(enrollments.map(e => [e.id, e.device_id]))
      setExisting((data || []).map(c => ({ device_id: devOf[c.enrollment_id], check_date: c.check_date })))
      setParsed(p); setResolver(r)
    } catch (e) { setError(errText(e)) }
    setBusy('')
  }

  async function commit() {
    setBusy('commit'); setError('')
    try { setResult(await commitImport(engagement, staged)); setParsed(null); await reloadAll() } catch (e) { setError(errText(e)) }
    setBusy('')
  }

  async function findDevice(ref) {
    const term = deviceSearch[ref]?.term ?? ref
    try { const r = await searchDevices(term); setDeviceSearch(s => ({ ...s, [ref]: { term, results: r } })) } catch (e) { setError(errText(e)) }
  }

  // Keep one row of a duplicate group; the others become DUPLICATE and are skipped.
  function keepRow(check) {
    setMaps(m => {
      const keep = { ...m.keep }
      staged.checks.filter(c => c.dupGroup === check.dupGroup).forEach(c => delete keep[c.rowNo])
      keep[check.rowNo] = true
      return { ...m, keep }
    })
  }

  const blocking = staged ? staged.checks.filter(c => c.result === 'DUPLICATE' || c.result === 'CHECK_DEVICE_ID').length : 0

  return (
    <div className="card">
      <div className="card-header"><div className="card-title"><Upload size={14} /> Import from the manual tracker</div></div>
      <div className="card-body">
        <ErrorLine error={error} />
        {result && (
          <div className="card" style={{ padding: 12, marginBottom: 12, fontSize: 13, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <CheckCircle2 size={16} color="#059669" /> Imported {result.counts.enrolled} device(s), {result.counts.checks} check(s), {result.counts.incidents} incident(s). {result.counts.skippedChecks} check row(s) skipped.
            <button className="btn btn-ghost btn-sm" onClick={() => downloadImportReport(engagement, result.report)}><Download size={12} /> Import report</button>
          </div>
        )}
        <p style={{ fontSize: 13, marginTop: 0, color: 'var(--ink-soft)' }}>
          Upload <code>IoT_Daily_Support_Tracker.xlsx</code>. Rows are staged first: devices must match the device master (by Device ID, then serial), names are matched to users,
          IST times convert to UTC, and duplicate device/date rows must be resolved. Result and follow-up columns are recomputed, not read.
        </p>
        <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
          <Upload size={14} /> {busy === 'parse' ? 'Reading…' : 'Choose .xlsx'}
          <input type="file" accept=".xlsx,.xlsm,.xls" style={{ display: 'none' }} onChange={e => { onFile(e.target.files[0]); e.target.value = '' }} />
        </label>

        {busy === 'parse' && <Loader />}
        {staged && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              <Chip tone="green">{staged.summary.devicesToEnroll} device(s) to enroll</Chip>
              {staged.summary.devicesBlocked > 0 && <Chip tone="red">{staged.summary.devicesBlocked} device(s) not in master</Chip>}
              <Chip tone="green">{staged.summary.checksReady} check(s) ready</Chip>
              {staged.summary.checksBlocked > 0 && <Chip tone="amber">{staged.summary.checksBlocked} check(s) blocked / skipped</Chip>}
              {staged.summary.duplicateGroups > 0 && <Chip tone="red">{staged.summary.duplicateGroups} duplicate group(s)</Chip>}
              <Chip>{staged.summary.incidents} incident(s)</Chip>
            </div>

            {(staged.unresolvedNames.length > 0 || staged.unresolvedDevices.length > 0) && (
              <div className="card" style={{ padding: 12, marginBottom: 12 }}>
                {staged.unresolvedNames.length > 0 && <>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Names not matched to a user</div>
                  {staged.unresolvedNames.map(n => (
                    <div key={n} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, fontSize: 13 }}>
                      <span style={{ minWidth: 160 }}>"{n}"</span>
                      <select className="form-select" style={{ maxWidth: 260 }} value={maps.people[norm(n)] || ''} onChange={e => setMaps(m => ({ ...m, people: { ...m.people, [norm(n)]: e.target.value || undefined } }))}>
                        <option value="">Choose user…</option>
                        <option value="__legacy">Keep as legacy name (flagged)</option>
                        {lookups.people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                      </select>
                    </div>
                  ))}
                </>}
                {staged.unresolvedDevices.length > 0 && <>
                  <div style={{ fontWeight: 700, fontSize: 13, margin: '10px 0 8px' }}>Device IDs not matched (map to an existing device, or register them in Devices and re-upload)</div>
                  {staged.unresolvedDevices.map(ref => (
                    <div key={ref} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, fontSize: 13, flexWrap: 'wrap' }}>
                      <span style={{ minWidth: 160 }}>"{ref}"</span>
                      <input className="form-input" style={{ maxWidth: 180 }} value={deviceSearch[ref]?.term ?? ref} onChange={e => setDeviceSearch(s => ({ ...s, [ref]: { ...(s[ref] || {}), term: e.target.value } }))} />
                      <button className="btn btn-ghost btn-sm" onClick={() => findDevice(ref)}>Search</button>
                      {deviceSearch[ref]?.results && (
                        <select className="form-select" style={{ maxWidth: 240 }} value={maps.devices[norm(ref)] || ''} onChange={e => setMaps(m => ({ ...m, devices: { ...m.devices, [norm(ref)]: e.target.value || undefined } }))}>
                          <option value="">{deviceSearch[ref].results.length ? 'Pick device…' : 'No match'}</option>
                          {deviceSearch[ref].results.map(d => <option key={d.id} value={d.id}>{deviceLabel(d)} · {d.serial_number}</option>)}
                        </select>
                      )}
                    </div>
                  ))}
                  <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>A device mapped here must also be in the Device Register sheet (or already enrolled) for its checks to import.</div>
                </>}
              </div>
            )}

            <Tabs active={tab} onChange={setTab} tabs={[
              { id: 'roster', label: 'Roster', count: staged.roster.length },
              { id: 'devices', label: 'Devices', count: staged.devices.length },
              { id: 'checks', label: 'Daily checks', count: staged.checks.length },
              { id: 'incidents', label: 'Incidents', count: staged.incidents.length },
            ]} />
            <div style={{ maxHeight: 420, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              <table className="data-table" style={{ display: 'table', fontSize: 12 }}>
                {tab === 'roster' && <>
                  <thead><tr><th>Row</th><th>Role</th><th>Primary</th><th>Backup</th><th>Issues</th></tr></thead>
                  <tbody>{staged.roster.map(r => <tr key={r.rowNo}><td>{r.rowNo}</td><td>{labelOf(ROSTER_ROLES, r.role)}</td><td>{r.primaryName} <MatchTag p={r.primary} /></td><td>{r.backupName} <MatchTag p={r.backup} /></td><td style={{ color: '#b45309' }}>{r.issues.join('; ')}</td></tr>)}</tbody>
                </>}
                {tab === 'devices' && <>
                  <thead><tr><th>Row</th><th>Device ID</th><th>Serial</th><th>Site</th><th>Status</th><th>Action</th><th>Issues</th></tr></thead>
                  <tbody>{staged.devices.map(d => <tr key={d.rowNo}><td>{d.rowNo}</td><td>{d.deviceRef}</td><td>{d.serial}</td><td>{d.site}</td><td>{d.statusRaw}</td>
                    <td>{d.action === 'blocked' ? <Chip tone="red">Blocked</Chip> : d.action === 'enroll' ? <Chip tone="green">Enroll</Chip> : <Chip>Already enrolled</Chip>}</td><td style={{ color: '#b45309' }}>{d.issues.join('; ')}</td></tr>)}</tbody>
                </>}
                {tab === 'checks' && <>
                  <thead><tr><th>Row</th><th>Date</th><th>Device</th><th>Result</th><th>Keep</th><th>Issues</th></tr></thead>
                  <tbody>{staged.checks.map(c => <tr key={c.rowNo} style={{ opacity: c.blocked ? 0.75 : 1 }}>
                    <td>{c.rowNo}</td><td>{c.check_date || '—'}</td><td>{c.deviceRef}</td><td><ResultBadge result={c.result} /></td>
                    <td>{c.dupGroup && <input type="radio" name={c.dupGroup} checked={!!maps.keep[c.rowNo]} onChange={() => keepRow(c)} title="Keep this row" />}</td>
                    <td style={{ color: '#b45309' }}>{c.issues.join('; ')}</td></tr>)}</tbody>
                </>}
                {tab === 'incidents' && <>
                  <thead><tr><th>Row</th><th>Excel ID</th><th>Priority</th><th>Status</th><th>Owner</th><th>Follow-up</th><th>Issues</th></tr></thead>
                  <tbody>{staged.incidents.map(i => <tr key={i.rowNo}><td>{i.rowNo}</td><td>{i.legacy_ref}</td><td>{labelOf(PRIORITIES, i.priority) || '—'}</td><td>{labelOf(INCIDENT_STATUSES, i.status)}</td>
                    <td>{i.ownerName} <MatchTag p={{ id: i.assigned_owner_user_id, legacy: i.assigned_owner_legacy }} /></td><td><FlagBadge flag={i.flag} /></td><td style={{ color: '#b45309' }}>{i.issues.join('; ')}</td></tr>)}</tbody>
                </>}
              </table>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
              {blocking > 0 && <span style={{ fontSize: 12, color: '#b45309' }}>{blocking} check row(s) are Duplicate / Check device ID and will be skipped unless resolved.</span>}
              <div style={{ flex: 1 }} />
              <button className="btn btn-ghost" onClick={() => { setParsed(null); setResolver(null) }}>Discard</button>
              <button className="btn btn-primary" disabled={busy === 'commit'} onClick={commit}>{busy === 'commit' ? 'Importing…' : 'Commit import'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function MatchTag({ p }) {
  if (!p || (!p.id && !p.legacy)) return null
  if (p.id) return <span style={{ fontSize: 10.5, color: '#047857' }}>✓</span>
  return <span style={{ fontSize: 10.5, color: '#b45309' }}>(legacy)</span>
}
