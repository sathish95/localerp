import { useState, useEffect, useMemo } from 'react'
import { supabase, dateFmt } from '../../lib/supabase'
import { deviceLabel } from '../../lib/goLive'
import { istToday, addDays } from '../../lib/goLiveRules'
import { listVisits, activityLabel, mapLink, CHECKIN_EVENT } from '../../lib/supportVisits'
import { Loader, Empty } from '../ui'
import { Kpi, ErrorLine, GoLiveBadge, DeviceFilterSelects } from './shared'
import { deviceFilterActive } from '../../lib/goLiveDeviceFields'
import { MapPin, Users } from 'lucide-react'

// Support activity for an engagement (STEP248): who visited, when, for how
// long, which devices they worked on — and which devices nobody visited.
const fmtTime = t => (t ? new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '—')
const hrs = n => `${Math.round(Number(n || 0) * 10) / 10} h`

export default function SupportTab({ ctx }) {
  const { engagement, enrollments, lookups } = ctx
  const [days, setDays] = useState(30)
  const [visits, setVisits] = useState(null)
  const [lastVisit, setLastVisit] = useState({})
  const [error, setError] = useState('')
  const to = istToday()
  const from = addDays(to, -(days - 1))
  // the shared device filter (Go-live / custom fields) scopes devices and visits
  const devFiltering = deviceFilterActive(ctx.deviceFilter)
  const live = enrollments.filter(e => !e.unenrolled_at && ctx.matchDev(e))
  const deviceById = useMemo(() => Object.fromEntries(enrollments.map(e => [e.device_id, e])), [enrollments])
  const person = id => lookups.people.find(p => p.id === id)?.full_name || '—'

  const load = async () => {
    setError('')
    try {
      setVisits(await listVisits({ engagementId: engagement.id, from, to }))
      const ids = enrollments.filter(e => !e.unenrolled_at).map(e => e.device_id)
      if (ids.length) {
        const { data } = await supabase.from('device_visits').select('device_id,work_date').in('device_id', ids)
        setLastVisit((data || []).reduce((m, r) => ((m[r.device_id] = !m[r.device_id] || r.work_date > m[r.device_id] ? r.work_date : m[r.device_id]), m), {}))
      }
    } catch (e) { setError(e.message); setVisits([]) }
  }
  useEffect(() => { setVisits(null); load() }, [engagement.id, days])
  useEffect(() => { window.addEventListener(CHECKIN_EVENT, load); return () => window.removeEventListener(CHECKIN_EVENT, load) }, [engagement.id, days])

  const shownVisits = useMemo(() => (visits || []).filter(x => !devFiltering || x.devices.some(d => deviceById[d.device_id] && ctx.matchDev(deviceById[d.device_id]))), [visits, devFiltering, deviceById, ctx.matchDev])
  const stats = useMemo(() => {
    const v = shownVisits
    const done = v.filter(x => x.check_out)
    const visited = new Set(v.flatMap(x => x.devices.map(d => d.device_id)))
    const byPerson = {}
    for (const x of v) {
      const p = (byPerson[x.employee_id] ||= { id: x.employee_id, visits: 0, hours: 0, devices: new Set(), last: null })
      p.visits++; p.hours += Number(x.hours_worked || 0); x.devices.forEach(d => p.devices.add(d.device_id))
      if (!p.last || x.check_in > p.last) p.last = x.check_in
    }
    return {
      visits: v.length, hours: done.reduce((n, x) => n + Number(x.hours_worked || 0), 0), engineers: Object.keys(byPerson).length,
      visited: live.filter(e => visited.has(e.device_id)).length, notVisited: live.filter(e => !visited.has(e.device_id)),
      people: Object.values(byPerson).sort((a, b) => b.hours - a.hours), inProgress: v.filter(x => !x.check_out).length,
      liveTotal: live.filter(e => e.is_golive).length, liveVisited: live.filter(e => e.is_golive && visited.has(e.device_id)).length,
    }
  }, [shownVisits, enrollments, ctx.matchDev])

  return (
    <div>
      <ErrorLine error={error} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="gl-seg">
          {[7, 30, 90].map(d => <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>Last {d} days</button>)}
        </div>
        <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{dateFmt(from)} – {dateFmt(to)} · support visits are billed to the project's Support costs</span>
        <div style={{ flex: 1 }} />
        <div className="gl-bar" style={{ padding: 0, border: 0, background: 'transparent' }}><DeviceFilterSelects ctx={ctx} /></div>
      </div>
      {!visits ? <Loader /> : <>
        <div className="gl-kpis">
          <Kpi label="Visits" value={stats.visits} sub={stats.inProgress ? `${stats.inProgress} in progress` : 'Checked in on this engagement'} accent="#6366f1" />
          <Kpi label="Support hours" value={hrs(stats.hours)} sub="Checked-out visits" accent="#0ea5e9" />
          <Kpi label="Engineers" value={stats.engineers} sub="Made at least one visit" accent="#8b5cf6" />
          <Kpi label="Devices visited" value={`${stats.visited}/${live.length}`} sub="In this period" accent="#10b981" />
          <Kpi label="Go-live visited" value={`${stats.liveVisited}/${stats.liveTotal}`} sub="Go-live = Yes devices" accent="#059669" active={ctx.deviceFilter.golive === 'YES'} onClick={() => ctx.setDeviceFilter(d => ({ ...d, golive: d.golive === 'YES' ? '' : 'YES' }))} />
          <Kpi label="Not visited" value={stats.notVisited.length} sub="No visit in this period" accent="#f59e0b" />
          <Kpi label="Avg per visit" value={stats.visits ? hrs(stats.hours / Math.max(1, stats.visits - stats.inProgress)) : '—'} sub="Time on site" accent="#94a3b8" />
        </div>

        <div className="table-wrap">
          <div className="gl-bar"><strong style={{ fontSize: 13 }}>Visits</strong></div>
          {!shownVisits.length ? <Empty icon={<Users size={26} />} title="No support visits in this period" desc="Engineers record visits from the Check-In button (Support / site visit) or “Check in here” on a device." /> : <>
            <div className="gl-desktop gl-tscroll">
              <table className="gl-table">
                <thead><tr><th>Date</th><th>Engineer</th><th>Site</th><th>In – out</th><th className="num">Hours</th><th>Devices & work done</th><th>Location</th></tr></thead>
                <tbody>{shownVisits.map(v => (
                  <tr key={v.id}>
                    <td className="nowrap">{dateFmt(v.work_date)}</td>
                    <td className="nowrap" style={{ fontWeight: 600 }}>{person(v.employee_id)}</td>
                    <td className="nowrap">{v.site || <span className="muted">—</span>}</td>
                    <td className="nowrap">{fmtTime(v.check_in)} – {v.check_out ? fmtTime(v.check_out) : <span className="gl-pill green">In progress</span>}</td>
                    <td className="num">{v.check_out ? hrs(v.hours_worked) : '—'}</td>
                    <td style={{ minWidth: 260 }}>
                      {!v.devices.length ? <span className="muted">No devices recorded{v.comment ? ` · ${v.comment}` : ''}</span> : v.devices.map(d => (
                        <div key={d.id} style={{ fontSize: 12, padding: '1px 0' }}>
                          <span className="gl-code">{deviceLabel(deviceById[d.device_id]?.device)}</span>{' '}
                          <span className="gl-tag">{activityLabel(d.activity_type)}</span>{' '}
                          <span className="muted">{d.minutes != null ? `${Math.round(d.minutes)} min` : ''}{d.note ? ` · ${d.note}` : ''}</span>
                        </div>
                      ))}
                    </td>
                    <td>{mapLink(v.check_in_lat, v.check_in_lng) ? <a href={mapLink(v.check_in_lat, v.check_in_lng)} target="_blank" rel="noreferrer"><MapPin size={13} /> In</a> : <span className="muted">—</span>}
                      {mapLink(v.check_out_lat, v.check_out_lng) && <> · <a href={mapLink(v.check_out_lat, v.check_out_lng)} target="_blank" rel="noreferrer">Out</a></>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="gl-mobile"><div className="gl-cards">
              {shownVisits.map(v => (
                <div key={v.id} className="gl-card">
                  <div className="gl-card-head"><div className="gl-card-title">{person(v.employee_id)}</div>{v.check_out ? <span className="gl-pill gray">{hrs(v.hours_worked)}</span> : <span className="gl-pill green">In progress</span>}</div>
                  <div className="gl-card-eq">{dateFmt(v.work_date)} · {fmtTime(v.check_in)}–{v.check_out ? fmtTime(v.check_out) : 'now'}{v.site ? ` · ${v.site}` : ''}</div>
                  <div style={{ marginTop: 8 }}>{v.devices.map(d => <div key={d.id} style={{ fontSize: 12 }}><span className="gl-code">{deviceLabel(deviceById[d.device_id]?.device)}</span> · {activityLabel(d.activity_type)}{d.note ? ` · ${d.note}` : ''}</div>)}</div>
                </div>
              ))}
            </div></div>
          </>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
          <div className="table-wrap" style={{ marginBottom: 0 }}>
            <div className="gl-bar"><strong style={{ fontSize: 13 }}>By engineer</strong></div>
            {!stats.people.length ? <div style={{ padding: 14, fontSize: 13, color: 'var(--ink-muted)' }}>No visits.</div> : (
              <table className="gl-table">
                <thead><tr><th>Engineer</th><th className="num">Visits</th><th className="num">Hours</th><th className="num">Devices</th><th>Last visit</th></tr></thead>
                <tbody>{stats.people.map(p => (
                  <tr key={p.id}><td style={{ fontWeight: 600 }}>{person(p.id)}</td><td className="num">{p.visits}</td><td className="num">{hrs(p.hours)}</td><td className="num">{p.devices.size}</td><td className="nowrap">{p.last ? dateFmt(p.last) : '—'}</td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
          <div className="table-wrap" style={{ marginBottom: 0 }}>
            <div className="gl-bar"><strong style={{ fontSize: 13 }}>Not visited in this period ({stats.notVisited.length})</strong></div>
            {!stats.notVisited.length ? <div style={{ padding: 14, fontSize: 13, color: '#047857' }}>Every device had a visit.</div> : (
              <div className="gl-tscroll" style={{ maxHeight: 320, minHeight: 0 }}>
                <table className="gl-table">
                  <thead><tr><th>Device</th><th>Go-live</th><th>Equipment</th><th>Site</th><th>Last visit</th></tr></thead>
                  <tbody>{stats.notVisited.map(e => (
                    <tr key={e.id}><td className="gl-code">{deviceLabel(e.device)}</td><td><GoLiveBadge e={e} compact /></td><td className="nowrap">{[e.equipment_id, e.equipment_name].filter(Boolean).join(' · ') || '—'}</td><td className="nowrap">{e.site || '—'}</td>
                      <td className="nowrap">{lastVisit[e.device_id] ? dateFmt(lastVisit[e.device_id]) : <span className="gl-pill amber">Never</span>}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </>}
    </div>
  )
}
