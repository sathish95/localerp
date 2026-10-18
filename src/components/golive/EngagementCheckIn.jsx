import { useState, useEffect, useRef } from 'react'
import { Modal } from '../ui'
import { getActiveLog, startVisit, checkOutLog, getGps, announceCheckin, CHECKIN_EVENT } from '../../lib/supportVisits'
import { notifyManagers } from '../../lib/notifications'
import { LogIn, LogOut } from 'lucide-react'

// Engagement-level check-in / check-out: a support visit for the whole
// go-live (not tied to any one device). Same time_logs row as the topbar
// Check-In, so either can end it; billed to the project's Support costs.
export default function EngagementCheckIn({ engagement, profile }) {
  const [log, setLog] = useState(undefined)
  const [asking, setAsking] = useState(false)
  const [site, setSite] = useState(engagement.sites?.[0] || '')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState('')
  const timer = useRef(null)
  const load = () => getActiveLog(profile.id).then(setLog).catch(() => setLog(null))
  useEffect(() => { load(); window.addEventListener(CHECKIN_EVENT, load); return () => window.removeEventListener(CHECKIN_EVENT, load) }, [profile.id])
  useEffect(() => {
    clearInterval(timer.current)
    if (log?.check_in) {
      const tick = () => { const s = (Date.now() - new Date(log.check_in)) / 1000; setElapsed(`${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`) }
      tick(); timer.current = setInterval(tick, 30000)
    }
    return () => clearInterval(timer.current)
  }, [log?.id])

  const here = log && log.engagement_id === engagement.id
  async function checkIn() {
    setBusy(true)
    try {
      const gps = await getGps()
      await startVisit({ employeeId: profile.id, projectId: engagement.project_id, engagementId: engagement.id, site: site || null, comment: comment || `${engagement.code} support visit`, gps })
      notifyManagers({ type: 'checkin', title: `🟢 ${profile.full_name} checked in at ${engagement.name}`, body: [site, comment].filter(Boolean).join(' · ') || 'Support visit', link: `/golive/${engagement.id}?tab=support`, senderId: profile.id })
      setAsking(false); setComment(''); announceCheckin(); await load()
    } catch (e) { alert(e.message) }
    setBusy(false)
  }
  async function checkOut() {
    if (!window.confirm(`Check out${here ? ` of ${engagement.name}` : ''}? Time so far: ${elapsed}.`)) return
    setBusy(true)
    try {
      const gps = log.visit_type === 'SUPPORT' ? await getGps() : null
      const hrs = await checkOutLog(log, gps)
      notifyManagers({ type: 'checkout', title: `🔴 ${profile.full_name} checked out${here ? ` of ${engagement.name}` : ''}`, body: `Visit: ${hrs} h`, link: `/golive/${engagement.id}?tab=support`, senderId: profile.id })
      announceCheckin(); await load()
    } catch (e) { alert(e.message) }
    setBusy(false)
  }

  if (log === undefined) return null
  if (log) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '3px 4px 3px 10px', border: '1.5px solid #a7f3d0', background: '#ecfdf5', borderRadius: 8 }}
        title={here ? `Checked in at ${engagement.name}${log.site ? ` · ${log.site}` : ''}` : `Checked in elsewhere (${log.project?.name || 'another session'}) — check out there first to check in here`}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981' }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#047857', whiteSpace: 'nowrap' }}>{here ? 'On site' : 'Checked in elsewhere'} · {elapsed}{here && log.site ? ` · ${log.site}` : ''}</span>
        <button className="btn btn-sm" style={{ background: '#e11d48', color: '#fff', border: 'none', padding: '4px 10px' }} disabled={busy} onClick={checkOut}><LogOut size={13} /> {busy ? '…' : 'Check out'}</button>
      </div>
    )
  }
  return (
    <>
      <button className="btn btn-primary btn-sm" onClick={() => setAsking(true)} title="Start a support visit for this go-live (not tied to one device)"><LogIn size={13} /> Check in</button>
      {asking && (
        <Modal open title={`Check in · ${engagement.name}`} onClose={() => setAsking(false)}
          footer={<><button className="btn btn-ghost" onClick={() => setAsking(false)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={checkIn}>{busy ? 'Checking in…' : 'Check in'}</button></>}>
          <p style={{ fontSize: 13, marginTop: 0, color: 'var(--ink-soft)' }}>Starts a support visit for this go-live. The time is billed to the project's Support costs when you check out. Add the devices you work on from the Check-In button or “Check in here” on a device — optional. Your location is captured if your browser allows it.</p>
          {(engagement.sites || []).length > 0 && (
            <div className="form-group"><label className="form-label">Site</label>
              <select className="form-select" value={site} onChange={e => setSite(e.target.value)}>
                <option value="">—</option>{engagement.sites.map(s => <option key={s} value={s}>{s}</option>)}
              </select></div>
          )}
          <div className="form-group"><label className="form-label">What are you here for?</label>
            <input className="form-input" value={comment} onChange={e => setComment(e.target.value)} placeholder="e.g. Weekly site round, customer meeting, training" onKeyDown={e => e.key === 'Enter' && checkIn()} /></div>
        </Modal>
      )}
    </>
  )
}
