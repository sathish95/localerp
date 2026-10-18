import { useState, useEffect, useMemo } from 'react'
import { dateFmt } from '../../lib/supabase'
import FleetSummary from './FleetSummary'
import DailySummary from './DailySummary'
import { ExecHeader, KpiTiles, AttentionPanel, SiteBreakdown, dailySeries } from './ExecutiveOverview'
import { listDeviceSensors, listSensorDefaults } from '../../lib/deviceMaster'
import { listChecks, getExitReadiness, submitExit, updateEngagement, listEvents, equipmentLabel } from '../../lib/goLive'
import { computeKpis, istToday, addDays, PRIORITIES, istDateTime } from '../../lib/goLiveRules'
import { Loader, Modal } from '../ui'
import { listHoursCompare, toleranceOf } from '../../lib/goLiveHours'
import { summarizeHours } from '../../lib/goLiveHoursRules'
import { CategoryTable } from './HoursParts'
import { ErrorLine, Field, errText, DeviceFilterSelects } from './shared'
import { deviceFilterActive, goLiveCounts } from '../../lib/goLiveDeviceFields'
import { CheckCircle2, XCircle, CircleDashed, Send, Share2 } from 'lucide-react'

const TREND = [
  { key: 'HEALTHY', label: 'Healthy', color: '#059669' },
  { key: 'ATTENTION', label: 'Attention', color: '#dc2626' },
  { key: 'INCOMPLETE', label: 'Incomplete', color: '#d97706' },
]

const fmtMins = m => (m == null ? '—' : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${(m / 60).toFixed(1)}h` : `${(m / 1440).toFixed(1)}d`)

export default function OverviewTab({ ctx: fullCtx }) {
  // the shared device filter (Go-live / custom fields) scopes every figure below;
  // exit readiness stays engagement-wide
  const devFiltering = deviceFilterActive(fullCtx.deviceFilter)
  const ctx = useMemo(() => {
    if (!devFiltering) return fullCtx
    const enrollments = fullCtx.enrollments.filter(fullCtx.matchDev)
    const ids = new Set(enrollments.map(e => e.id))
    return { ...fullCtx, enrollments, incidents: fullCtx.incidents.filter(i => (i.device_enrollment_ids || []).some(id => ids.has(id))) }
  }, [fullCtx, devFiltering])
  const { engagement, enrollments, incidents, lookups, perms } = ctx
  const [date, setDate] = useState(istToday())
  const [allChecks, setChecks] = useState(null)
  const checks = useMemo(() => {
    if (!allChecks || !devFiltering) return allChecks
    const ids = new Set(enrollments.map(e => e.id))
    return allChecks.filter(c => ids.has(c.enrollment_id))
  }, [allChecks, devFiltering, enrollments])
  const gl = goLiveCounts(fullCtx.enrollments)
  const pickLive = v => { fullCtx.setDeviceFilter(d => ({ ...d, golive: d.golive === v ? '' : v })) }
  const [readiness, setReadiness] = useState(null)
  const [events, setEvents] = useState([])
  const [error, setError] = useState('')
  const [showTable, setShowTable] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [hours, setHours] = useState(null)
  const [fleetSensors, setFleetSensors] = useState([])
  const [sensorDefaults, setSensorDefaults] = useState([])
  useEffect(() => {
    listDeviceSensors(enrollments.map(e => e.device_id)).then(setFleetSensors).catch(() => setFleetSensors([]))
    listSensorDefaults().then(setSensorDefaults).catch(() => setSensorDefaults([]))
  }, [enrollments.map(e => e.device_id).join()])

  const from = useMemo(() => {
    const f = addDays(date, -13)
    return engagement.hypercare_start && engagement.hypercare_start > f ? engagement.hypercare_start : f
  }, [date, engagement.hypercare_start])

  useEffect(() => {
    listChecks(engagement.id, { from: addDays(date, -13), to: date }).then(setChecks).catch(e => setError(errText(e)))
    listHoursCompare(engagement.id, { from: addDays(date, -13), to: date }).then(setHours).catch(() => setHours([]))
  }, [engagement.id, date])
  const hoursSum = useMemo(() => summarizeHours(hours || []), [hours])
  useEffect(() => {
    if (engagement.status !== 'DRAFT') getExitReadiness(engagement.id).then(setReadiness).catch(e => setError(errText(e)))
    listEvents(engagement.id, 30).then(setEvents).catch(() => {})
  }, [engagement.id, engagement.status, engagement.version])

  const k = useMemo(() => checks && computeKpis({
    enrollments, checks: checks.filter(c => c.check_date === date), incidents,
    recentChecks: checks.filter(c => c.check_date > addDays(date, -7)),
  }), [checks, enrollments, incidents, date])

  const trend = useMemo(() => {
    if (!checks) return []
    const days = []
    for (let d = from; d <= date; d = addDays(d, 1)) {
      const day = checks.filter(c => c.check_date === d)
      days.push({ date: d, ...Object.fromEntries(TREND.map(t => [t.key, day.filter(c => c.daily_result === t.key).length])) })
    }
    return days
  }, [checks, from, date])

  const series = useMemo(() => checks ? dailySeries({ checks, enrollments, incidents, from: addDays(date, -13), to: date }) : [], [checks, enrollments, incidents, date])
  const mttr = useMemo(() => {
    const live = incidents.filter(i => !i.deleted_at)
    const avg = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
    const mins = (a, b) => (a && b ? (new Date(b) - new Date(a)) / 60000 : null)
    return { mttr: avg(live.map(i => mins(i.reported_at, i.resolved_at)).filter(x => x != null)), mtta: avg(live.map(i => mins(i.reported_at, i.acknowledged_at)).filter(x => x != null)) }
  }, [incidents])

  if (!k) return error ? <ErrorLine error={error} /> : <Loader />
  // latest check up to the review date per device, plus its sensors — same rows the shared report uses
  const lc = s => String(s || '').trim().toLowerCase()
  const fleetRows = enrollments.filter(e => !e.unenrolled_at).map(e => {
    const last = checks.filter(c => c.enrollment_id === e.id).sort((a, b) => b.check_date.localeCompare(a.check_date))[0]
    const mine = fleetSensors.filter(x => x.device_id === e.device_id && x.health !== 'REMOVED')
    const fitted = new Set(mine.map(x => x.sensor_type_id))
    return {
      equipment_id: e.equipment_id, equipment: e.equipment_name, device: e.device?.serial_number || '', site: e.site,
      last_check_date: last?.check_date,
      sensors_down_names: mine.filter(x => x.health === 'NOT_WORKING' || x.health === 'FAULTY').map(x => x.sensor_name).join(', '),
      category: e.equipment_category || 'Uncategorised', support_status: e.support_status,
      last_result: last?.daily_result, connectivity: last?.connectivity, last_maintenance: !!last?.equipment_maintenance,
      sensors_total: mine.length, sensors_working: mine.filter(x => x.health === 'WORKING').length,
      sensors_down: mine.filter(x => x.health === 'NOT_WORKING' || x.health === 'FAULTY').length,
      sensors_missing: sensorDefaults.filter(d => lc(d.equipment_category) === lc(e.equipment_category) && !fitted.has(d.sensor_type_id)).length,
    }
  })
  const enrById = Object.fromEntries(enrollments.map(e => [e.id, e]))
  const person = id => lookups.people.find(p => p.id === id)?.full_name || 'System'

  return (
    <div>
      <ErrorLine error={error} />
      <div className="gl-exec-bar">
        <div>
          <div className="gl-exec-title">Executive overview</div>
          <div className="gl-exec-note">{engagement.code} · {(engagement.sites || []).join(', ') || 'No sites'} · counts are check records, not uptime</div>
        </div>
        <div className="gl-grow" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => ctx.setTab('share')} title="Share this overview as an external report link, or email it daily"><Share2 size={13} /> Share / email report</button>
        <div className="gl-seg">
          <button type="button" className={date === istToday() ? 'on' : ''} onClick={() => setDate(istToday())}>Today</button>
          <button type="button" className={date === addDays(istToday(), -1) ? 'on' : ''} onClick={() => setDate(addDays(istToday(), -1))}>Yesterday</button>
        </div>
        <input type="date" className="form-input" style={{ width: 160, height: 34, fontSize: 12.5 }} max={istToday()} value={date} onChange={e => setDate(e.target.value || istToday())} aria-label="Review date" />
      </div>
      <div className="gl-bar" style={{ border: '1px solid var(--border)', borderRadius: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Devices</span>
        <DeviceFilterSelects ctx={fullCtx} />
        {devFiltering && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{enrollments.filter(e => !e.unenrolled_at).length} of {fullCtx.enrollments.filter(e => !e.unenrolled_at).length} devices · device incidents only · exit readiness is engagement-wide</span>}
      </div>

      <ExecHeader engagement={engagement} k={k} readiness={readiness} date={date} lookups={lookups} />

      <KpiTiles tiles={[
        { label: 'Go-live devices', value: `${gl.live}/${gl.total}`, sub: `${gl.pct}% live · ${gl.notLive} not live`, accent: '#059669', onClick: () => pickLive('YES') },
        { label: 'Go-live healthy', value: (() => { const day = checks.filter(c => c.check_date === date); const liveIds = new Set(enrollments.filter(e => e.is_golive).map(e => e.id)); const lc = day.filter(c => liveIds.has(c.enrollment_id)); return lc.length ? Math.round((lc.filter(c => c.daily_result === 'HEALTHY').length / lc.length) * 100) : null })(), unit: '%', sub: 'Healthy share of go-live devices checked', accent: '#10b981', onClick: () => { pickLive('YES'); ctx.setTab('checks') } },
        { label: 'Check coverage', value: k.coveragePct, unit: '%', series: series.map(d => d.coverage), goodUp: true, sub: `${k.checksLogged} checks · ${k.activeDevices} active devices`, accent: '#0891b2', onClick: () => ctx.setTab('checks') },
        { label: 'Healthy rate', value: k.healthyPct, unit: '%', series: series.map(d => d.healthyPct), goodUp: true, sub: `${k.healthy} healthy of ${k.checksLogged} checked`, accent: '#059669' },
        { label: 'Needing attention', value: k.attention, series: series.map(d => d.attention), goodUp: false, sub: `${k.incomplete} incomplete`, accent: '#dc2626', onClick: () => ctx.setTab('checks') },
        { label: 'Missing checks', value: k.missingCount, series: series.map(d => d.devices - d.checked), goodUp: false, sub: `${k.pendingReviews} awaiting engineer review`, accent: '#d97706', onClick: () => ctx.setTab('checks') },
        { label: 'Open incidents', value: k.openTickets, series: series.map(d => d.openIncidents), goodUp: false, sub: `${k.criticalOpen} P1 critical`, accent: '#6366f1', onClick: () => ctx.setTab('incidents') },
        { label: 'Overdue actions', value: k.overdue, sub: 'Incident next actions past due', accent: k.overdue ? '#dc2626' : '#94a3b8', onClick: () => ctx.setTab('incidents') },
        { label: 'Mean time to resolve', value: mttr.mttr == null ? null : fmtMins(mttr.mttr), sub: `MTTA ${fmtMins(mttr.mtta)} · all priorities`, accent: '#7c3aed' },
        { label: 'Repeat-failure devices', value: k.repeatFailures.length, sub: '3+ attention results in 7 days', accent: k.repeatFailures.length ? '#dc2626' : '#94a3b8', onClick: () => ctx.setTab('devices') },
      ]} />

      <div className="gl-exec-grid">
        <AttentionPanel ctx={ctx} k={k} dayChecks={checks.filter(c => c.check_date === date)} date={date} />
        <ExitReadiness readiness={readiness} engagement={engagement} perms={perms} onSubmit={() => setSubmitting(true)} onSaved={ctx.reloadEngagement} />
      </div>

      <DailySummary ctx={ctx} date={date} checks={checks} />

      <div className="gl-exec-grid">
        <SiteBreakdown enrollments={enrollments} dayChecks={checks.filter(c => c.check_date === date)} incidents={incidents} />
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="card-title">Daily results · 14 days</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowTable(s => !s)}>{showTable ? 'Chart' : 'Table'}</button>
          </div>
          <div className="card-body">
            {showTable ? <TrendTable days={trend} /> : <TrendChart days={trend} />}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>Equipment overview</strong>
          <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Latest check up to {dateFmt(date)} · same figures as the shared report</span>
        </div>
        <FleetSummary rows={fleetRows} sensorSummary={(() => {
          const live = new Set(enrollments.filter(e => !e.unenrolled_at).map(e => e.device_id))
          const by = {}
          for (const x of fleetSensors) {
            if (!live.has(x.device_id) || x.health === 'REMOVED') continue
            const r = (by[x.sensor_type_id] ||= { sensor: x.sensor_name, kind: x.sensor_kind || 'Other', devs: new Set(), installed: 0, working: 0, not_working: 0, not_reviewed: 0, na: 0 })
            r.devs.add(x.device_id); r.installed++
            if (x.health === 'WORKING') r.working++
            else if (x.health === 'NOT_WORKING' || x.health === 'FAULTY') r.not_working++
            else if (x.health === 'NA') r.na++
            else r.not_reviewed++
          }
          return Object.values(by).map(({ devs, ...r }) => ({ ...r, devices: devs.size })).sort((a, b) => a.kind.localeCompare(b.kind) || b.installed - a.installed)
        })()} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
          <div className="card-title">Manual vs IoT hours by equipment category</div>
          <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Last 14 days to {dateFmt(date)}{hoursSum.total.compared ? ` · ${hoursSum.total.matchRate}% of ${hoursSum.total.compared} equipment-days match` : ''} · entered in Daily Checks</span>
        </div>
        {!hours ? <Loader /> : <div style={{ overflowX: 'auto' }}><CategoryTable categories={hoursSum.categories} tolerance={toleranceOf(engagement)} /></div>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header"><div className="card-title">Response times</div></div>
          <table className="data-table" style={{ display: 'table', fontSize: 12.5 }}>
            <thead><tr><th>Priority</th><th>Incidents</th><th title="Reported → acknowledged">MTTA</th><th title="Reported → resolved">MTTR</th></tr></thead>
            <tbody>{PRIORITIES.map(p => (
              <tr key={p.key}><td>{p.label}</td><td>{k.byPriority[p.key].count}</td><td>{fmtMins(k.byPriority[p.key].mtta)}</td><td>{fmtMins(k.byPriority[p.key].mttr)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">Incidents by category</div></div>
          <div className="card-body"><CategoryBars rows={k.byCategory} /></div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">Repeat-failure devices</div></div>
          <div className="card-body" style={{ fontSize: 13 }}>
            {!k.repeatFailures.length ? <span style={{ color: 'var(--ink-muted)' }}>No device with 3+ attention results in the last 7 days.</span>
              : k.repeatFailures.map(r => (
                <div key={r.enrollment_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <strong>{equipmentLabel(enrById[r.enrollment_id])}</strong><span>{r.count} × attention</span>
                </div>
              ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title">Recent activity</div></div>
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {!events.length ? <div className="card-body" style={{ color: 'var(--ink-muted)', fontSize: 13 }}>No activity yet.</div> : events.map(ev => (
            <div key={ev.id} style={{ display: 'flex', gap: 10, padding: '8px 20px', borderBottom: '1px solid var(--border)', fontSize: 12.5 }}>
              <span style={{ color: 'var(--ink-muted)', minWidth: 130 }}>{istDateTime(ev.created_at)}</span>
              <span style={{ minWidth: 80, textTransform: 'capitalize', fontWeight: 600 }}>{ev.entity}</span>
              <span style={{ flex: 1 }}>{ev.event_type.replace(/_/g, ' ')} — {ev.summary}
                {ev.event_type !== 'created' && Object.keys(ev.changes || {}).length > 0 && !ev.changes.readiness && (
                  <span style={{ color: 'var(--ink-muted)' }}> ({Object.keys(ev.changes).filter(f => !f.endsWith('_at') && !f.endsWith('_by')).slice(0, 4).join(', ')})</span>
                )}
              </span>
              <span style={{ color: 'var(--ink-muted)' }}>{person(ev.actor_id)}</span>
            </div>
          ))}
        </div>
      </div>

      {submitting && <SubmitExitModal engagement={engagement} readiness={readiness} onClose={() => setSubmitting(false)} onDone={async () => { setSubmitting(false); await ctx.reloadEngagement() }} />}
    </div>
  )
}

// Stacked bars per day, 2px gaps between segments, hover title per segment.
function TrendChart({ days }) {
  const max = Math.max(1, ...days.map(d => TREND.reduce((s, t) => s + d[t.key], 0)))
  const H = 140
  return (
    <div>
      <div style={{ display: 'flex', gap: 14, fontSize: 12, marginBottom: 10, color: 'var(--ink-soft)' }}>
        {TREND.map(t => <span key={t.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: t.color }} />{t.label}</span>)}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: H, borderBottom: '1px solid var(--border)' }}>
        {days.map(d => {
          const total = TREND.reduce((s, t) => s + d[t.key], 0)
          return (
            <div key={d.date} title={`${dateFmt(d.date)}\n${TREND.map(t => `${t.label}: ${d[t.key]}`).join('\n')}`}
              style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column-reverse', gap: 2, cursor: 'default', minWidth: 6 }}>
              {TREND.filter(t => d[t.key] > 0).map((t, i, arr) => (
                <div key={t.key} style={{ height: `${(d[t.key] / max) * (H - 4)}px`, background: t.color, borderRadius: i === arr.length - 1 ? '4px 4px 0 0' : 0 }} />
              ))}
              {!total && <div style={{ height: 2, background: 'var(--border)' }} />}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-muted)', marginTop: 4 }}>
        <span>{days[0] && dateFmt(days[0].date)}</span><span>{days.length > 0 && dateFmt(days[days.length - 1].date)}</span>
      </div>
    </div>
  )
}

function TrendTable({ days }) {
  return (
    <table className="data-table" style={{ display: 'table', fontSize: 12 }}>
      <thead><tr><th>Date</th>{TREND.map(t => <th key={t.key}>{t.label}</th>)}</tr></thead>
      <tbody>{[...days].reverse().map(d => <tr key={d.date}><td>{dateFmt(d.date)}</td>{TREND.map(t => <td key={t.key}>{d[t.key]}</td>)}</tr>)}</tbody>
    </table>
  )
}

function CategoryBars({ rows }) {
  const max = Math.max(1, ...rows.map(r => r.count))
  return (
    <div>
      {rows.map(r => (
        <div key={r.key} title={`${r.label}: ${r.count}`} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 28px', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 8 }}>
          <span style={{ color: 'var(--ink-soft)' }}>{r.label}</span>
          <div style={{ height: 10, background: 'var(--surface)', borderRadius: 4 }}>
            <div style={{ width: `${(r.count / max) * 100}%`, height: '100%', background: 'var(--c1)', borderRadius: 4 }} />
          </div>
          <span style={{ textAlign: 'right', fontWeight: 600 }}>{r.count}</span>
        </div>
      ))}
    </div>
  )
}

function ExitReadiness({ readiness, engagement, perms, onSubmit, onSaved }) {
  const [signoff, setSignoff] = useState({ customer_signoff_name: engagement.customer_signoff_name || '', customer_signoff_date: engagement.customer_signoff_date || '', customer_signoff_ref: engagement.customer_signoff_ref || '' })
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(false)
  async function saveSignoff() {
    setErr('')
    try { await updateEngagement({ ...engagement, ...signoff }); setOpen(false); await onSaved() } catch (e) { setErr(errText(e)) }
  }
  const Icon = ({ met }) => met === true ? <CheckCircle2 size={15} color="#059669" /> : met === false ? <XCircle size={15} color="#dc2626" /> : <CircleDashed size={15} color="#94a3b8" />

  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="card-title">Exit readiness</div>
        {readiness && <span style={{ fontSize: 12, fontWeight: 700, color: readiness.all_met ? '#059669' : 'var(--ink-muted)' }}>{readiness.all_met ? 'Ready to exit' : 'Not ready'}</span>}
      </div>
      <div className="card-body">
        {engagement.status === 'DRAFT' ? <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Activate hypercare to start tracking exit criteria.</span>
          : !readiness ? <Loader /> : (
            <>
              {readiness.criteria.map(c => (
                <div key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <Icon met={c.met} />
                  <span style={{ flex: 1 }}>{c.label}<span style={{ fontWeight: 600 }}>{c.met ? ' — met' : ' — not met'}</span></span>
                  <span style={{ color: 'var(--ink-muted)', fontSize: 12 }}>
                    {c.key === 'stable_days' ? `${c.value} / ${c.target} days` : c.key === 'signoff' ? (c.value || '—') : c.key === 'handover' ? `${c.value} open` : c.value}
                  </span>
                </div>
              ))}
              {readiness.days?.length > 0 && (
                <div style={{ display: 'flex', gap: 3, marginTop: 10, flexWrap: 'wrap' }}>
                  {[...readiness.days].reverse().map(d => (
                    <span key={d.date} title={`${dateFmt(d.date)}: ${d.logged}/${d.expected} checked, ${d.healthy} healthy${d.ok === null ? ' (today, in progress)' : ''}`}
                      style={{ fontSize: 10, padding: '2px 5px', borderRadius: 4, border: '1px solid var(--border)', background: d.ok ? '#ecfdf5' : d.ok === false ? '#fef2f2' : 'var(--surface)', color: d.ok ? '#047857' : d.ok === false ? '#b91c1c' : 'var(--ink-muted)' }}>
                      {d.date.slice(8)} {d.ok ? 'ok' : d.ok === false ? 'miss' : '…'}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                {perms.canManage && ['ACTIVE', 'EXIT_REVIEW'].includes(engagement.status) && <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>{engagement.customer_signoff_name ? 'Edit' : 'Record'} customer sign-off</button>}
                {perms.isPM && engagement.status === 'ACTIVE' && <button className="btn btn-primary btn-sm" onClick={onSubmit}><Send size={13} /> Submit exit</button>}
              </div>
            </>
          )}
      </div>
      {open && (
        <Modal open title="Customer sign-off" onClose={() => setOpen(false)}
          footer={<><button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={saveSignoff}>Save</button></>}>
          <ErrorLine error={err} />
          <Field label="Signed off by (customer representative)" required><input className="form-input" value={signoff.customer_signoff_name} onChange={e => setSignoff(s => ({ ...s, customer_signoff_name: e.target.value }))} /></Field>
          <div className="form-row">
            <Field label="Sign-off date" required><input type="date" className="form-input" value={signoff.customer_signoff_date} onChange={e => setSignoff(s => ({ ...s, customer_signoff_date: e.target.value }))} /></Field>
            <Field label="Reference" hint="Email / document reference"><input className="form-input" value={signoff.customer_signoff_ref} onChange={e => setSignoff(s => ({ ...s, customer_signoff_ref: e.target.value }))} /></Field>
          </div>
        </Modal>
      )}
    </div>
  )
}

function SubmitExitModal({ engagement, readiness, onClose, onDone }) {
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const unmet = (readiness?.criteria || []).filter(c => !c.met && c.key !== 'signoff')
  async function go() {
    setBusy(true); setError('')
    try { await submitExit(engagement.id, comment); await onDone() } catch (e) { setError(errText(e)) }
    setBusy(false)
  }
  return (
    <Modal open title="Submit hypercare exit" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || (unmet.length > 0 && !comment.trim())} onClick={go}>Submit for approval</button></>}>
      <ErrorLine error={error} />
      {unmet.length ? (
        <>
          <p style={{ fontSize: 13, marginTop: 0 }}>These criteria are not met. You can still submit with an override comment for the approver:</p>
          <ul style={{ fontSize: 13 }}>{unmet.map(c => <li key={c.key}>{c.label}</li>)}</ul>
          <Field label="Override comment" required><textarea className="form-textarea" value={comment} onChange={e => setComment(e.target.value)} /></Field>
        </>
      ) : <p style={{ fontSize: 13, marginTop: 0 }}>All exit criteria are met. The CTO will be asked to approve.</p>}
    </Modal>
  )
}
