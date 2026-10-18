import { useState, useEffect } from 'react'
import { Modal, Loader } from '../ui'
import { dateFmt } from '../../lib/supabase'
import { ACTIVITY_TYPES, activityLabel, listDeviceVisits, checkInOnDevice, getActiveLog, mapLink, CHECKIN_EVENT } from '../../lib/supportVisits'
import { LogIn, MapPin } from 'lucide-react'

// Support visits on a device (STEP248): "Check in here" and the visit history.

const fmtTime = t => (t ? new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '—')
const fmtMins = m => (m == null ? '—' : m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`)

// Adds this device to the user's running check-in, or starts a support visit for it.
export function CheckInHereButton({ device, profile, projectId, engagementId, site, className = 'btn btn-ghost', onDone }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(undefined)
  const [form, setForm] = useState({ activity: 'INSPECTION', minutes: '', note: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  useEffect(() => { if (open) { setActive(undefined); setDone(''); setError(''); getActiveLog(profile.id).then(setActive).catch(() => setActive(null)) } }, [open])
  async function save() {
    setBusy(true); setError('')
    try {
      const { started } = await checkInOnDevice({ employeeId: profile.id, device, projectId, engagementId, site, ...form })
      setDone(started ? 'Support visit started and this device recorded. Check out from the Check-In button when you leave.' : 'Device added to your current visit.')
      onDone?.()
    } catch (e) { setError(e.message) }
    setBusy(false)
  }
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} title="Record support work on this device"><LogIn size={13} /> Check in here</button>
      {open && (
        <Modal open title={`Check in · ${device.serial_number || device.device_code}`} onClose={() => setOpen(false)}
          footer={done ? <button className="btn btn-primary" onClick={() => setOpen(false)}>Done</button>
            : <><button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={busy || active === undefined} onClick={save}>{busy ? 'Saving…' : active ? 'Add to current visit' : 'Start visit'}</button></>}>
          {error && <div className="alert alert-danger" style={{ fontSize: 13, marginBottom: 12 }}>{error}</div>}
          {done ? <div className="alert alert-success" style={{ fontSize: 13 }}>{done}</div> : <>
            <div style={{ fontSize: 13, marginBottom: 12, color: 'var(--ink-soft)' }}>
              {active === undefined ? 'Checking your current session…'
                : active ? <>You're checked in since <strong>{fmtTime(active.check_in)}</strong>{active.project?.name ? <> on <strong>{active.project.name}</strong></> : ''} — this device will be added to that visit.</>
                  : <>No active check-in — this starts a <strong>support visit</strong>{device.current_location || site ? <> at <strong>{site || device.current_location}</strong></> : ''} and records this device. Your location is captured if your browser allows it.</>}
            </div>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Activity</label>
                <select className="form-select" value={form.activity} onChange={e => setForm(f => ({ ...f, activity: e.target.value }))}>
                  {ACTIVITY_TYPES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select></div>
              <div className="form-group"><label className="form-label">Minutes (optional)</label>
                <input type="number" min={0} className="form-input" value={form.minutes} onChange={e => setForm(f => ({ ...f, minutes: e.target.value }))} placeholder="Split evenly if blank" /></div>
            </div>
            <div className="form-group"><label className="form-label">What was done</label>
              <textarea className="form-textarea" style={{ minHeight: 60 }} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="e.g. Re-seated fuel probe connector, verified readings" /></div>
          </>}
        </Modal>
      )}
    </>
  )
}

// Visit history for one device.
export function DeviceVisitsPanel({ deviceId, people }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const load = () => listDeviceVisits(deviceId).then(setRows).catch(e => { setError(e.message); setRows([]) })
  useEffect(() => { load() }, [deviceId])
  useEffect(() => { window.addEventListener(CHECKIN_EVENT, load); return () => window.removeEventListener(CHECKIN_EVENT, load) }, [deviceId])
  const person = id => people?.find(p => p.id === id)?.full_name || '—'
  if (!rows) return <Loader />
  const totalMin = rows.reduce((n, r) => n + Number(r.minutes || 0), 0)
  return (
    <div>
      {error && <div style={{ fontSize: 12.5, color: '#b45309', marginBottom: 8 }}>{error}</div>}
      {!rows.length ? <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>No support visits recorded on this device yet. Use “Check in here” when working on it.</div> : <>
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 8 }}>{rows.length} visit{rows.length === 1 ? '' : 's'} · {fmtMins(totalMin)} of support time · {new Set(rows.map(r => r.employee_id)).size} engineer(s)</div>
        <div className="table-wrap" style={{ marginBottom: 0 }}>
          <table className="gl-table">
            <thead><tr><th>Date</th><th>Engineer</th><th>Activity</th><th>Time on device</th><th>Visit</th><th>Note</th><th /></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id}>
                <td className="nowrap">{dateFmt(r.work_date)}</td>
                <td className="nowrap">{person(r.employee_id)}</td>
                <td><span className="gl-tag">{activityLabel(r.activity_type)}</span></td>
                <td className="nowrap">{r.check_out ? fmtMins(r.minutes) : <span className="gl-pill green">In progress</span>}</td>
                <td className="nowrap muted" style={{ fontSize: 12 }}>{fmtTime(r.check_in)}–{r.check_out ? fmtTime(r.check_out) : 'now'}{r.site ? ` · ${r.site}` : ''}</td>
                <td style={{ fontSize: 12, maxWidth: 260, whiteSpace: 'normal' }}>{r.note || <span className="muted">—</span>}</td>
                <td>{mapLink(r.check_in_lat, r.check_in_lng) && <a href={mapLink(r.check_in_lat, r.check_in_lng)} target="_blank" rel="noreferrer" title="Check-in location"><MapPin size={13} /></a>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </>}
    </div>
  )
}
