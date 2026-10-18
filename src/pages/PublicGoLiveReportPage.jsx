import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { getPublicReport } from '../lib/goLiveHours'
import { summarizeHours, buildInsights, HOURS_STATUSES } from '../lib/goLiveHoursRules'
import { computeKpis, PRIORITIES, INCIDENT_STATUSES, FOLLOW_UP_FLAGS, DAILY_RESULTS, CONNECTIVITY_STATUSES, labelOf, istDateTime } from '../lib/goLiveRules'
import { dateFmt } from '../lib/supabase'
import { useAppName } from '../context/BrandingContext'
import FleetSummary from '../components/golive/FleetSummary'
import ReportOverview from '../components/golive/ReportOverview'
import { Printer, CheckCircle2, XCircle, AlertTriangle, Lightbulb } from 'lucide-react'

// Public, unauthenticated hypercare report reached through a
// golive_report_links token (STEP237). Everything comes from the
// get_golive_report() RPC, which already trims the customer view (no
// internal names, only customer-visible incidents).

const TREND = [
  { key: 'healthy', label: 'Healthy', color: '#059669' },
  { key: 'attention', label: 'Attention', color: '#dc2626' },
  { key: 'incomplete', label: 'Incomplete', color: '#d97706' },
]
// Equipment status from get_golive_report(): the latest check's
// connectivity, or the latest IoT hours when there's no newer check.
const EQUIP_STATUS = {
  ONLINE: { label: 'Operating', color: '#047857' },
  RUNNING: { label: 'Running (IoT)', color: '#047857' },
  INTERMITTENT: { label: 'Intermittent', color: '#b45309' },
  OFFLINE: { label: 'Not operating', color: '#b91c1c' },
  NOT_RUNNING: { label: 'Not running (IoT)', color: '#b91c1c' },
  MAINTENANCE: { label: 'Maintenance', color: 'var(--ink-muted)' },
  DECOMMISSIONED: { label: 'Decommissioned', color: 'var(--ink-muted)' },
  NO_DATA: { label: 'No data in period', color: 'var(--ink-muted)' },
}
const ON = ['ONLINE', 'RUNNING']
const OFF = ['OFFLINE', 'INTERMITTENT', 'NOT_RUNNING']
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null)
const fmtMins = m => (m == null ? '—' : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} d`)

export default function PublicGoLiveReportPage() {
  const { token } = useParams()
  const appName = useAppName()
  const [r, setR] = useState(undefined)
  const [err, setErr] = useState('')
  useEffect(() => { getPublicReport(token).then(setR).catch(e => { setErr(e.message); setR(null) }) }, [token])

  const hoursRows = useMemo(() => (r?.hours || []).map(h => ({ ...h, equipment_category: h.category, manual_hours: h.manual, iot_hours: h.iot, iot_fuel_litres: h.fuel, enrollment_id: h.equipment })), [r])
  const hours = useMemo(() => summarizeHours(hoursRows), [hoursRows])
  const insights = useMemo(() => (r ? buildInsights(r) : []), [r])

  if (r === undefined) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f8fafc' }}><div className="spinner" /></div>
  if (!r) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f8fafc', padding: 16 }}>
        <div className="card" style={{ padding: 28, maxWidth: 420, textAlign: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 6 }}>Report not available</div>
          <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>{err || 'This link has expired or was revoked. Ask your contact for a new one.'}</div>
        </div>
      </div>
    )
  }

  const NEW_SECTIONS = ['fleet', 'trends', 'devices', 'sla']
  const secs = r.sections || []
  const show = k => secs.includes(k) || (NEW_SECTIONS.includes(k) && !secs.some(x => NEW_SECTIONS.includes(x)) && (k !== 'sla' || secs.includes('incidents') || mgmt))
  const mgmt = r.audience === 'MANAGEMENT'
  const g = r.engagement
  const health = r.health || []
  const logged = health.reduce((s, d) => s + d.logged, 0)
  const expected = health.reduce((s, d) => s + d.expected, 0)
  const checkRecords = health.reduce((s, d) => s + d.healthy + d.attention + d.incomplete, 0)
  const healthy = health.reduce((s, d) => s + d.healthy, 0)
  const equipment = r.equipment || []
  const online = equipment.filter(e => ON.includes(e.status)).length
  const offline = equipment.filter(e => OFF.includes(e.status)).length
  const incidents = r.incidents || []
  const openInc = incidents.filter(i => i.status !== 'CLOSED')
  const incKpi = computeKpis({ incidents })
  const actions = r.actions || []
  const byCat = equipment.reduce((m, e) => ((m[e.category] ||= []).push(e), m), {})
  const weeks = weeklyRollup(health, r.hours || [], incidents)
  const sensorsTotal = equipment.reduce((n, e) => n + (e.sensors_total || 0), 0)
  const sensorsDown = equipment.reduce((n, e) => n + (e.sensors_down || 0), 0)
  const withFw = equipment.filter(e => e.firmware_version)
  const fwCurrent = withFw.filter(e => e.firmware_status === 'CURRENT' || (e.firmware_current && e.firmware_version === e.firmware_current)).length
  const status = overallStatus({ healthyPct: pct(healthy, checkRecords), coverage: pct(logged, expected), openCritical: openInc.filter(i => i.priority === 'P1_CRITICAL').length, sensorsDownPct: pct(sensorsDown, sensorsTotal), readiness: r.readiness })
  const lastWeek = weeks[weeks.length - 1]
  const prevWeek = weeks[weeks.length - 2]

  const Section = ({ title, children, sub }) => (
    <section className="card" style={{ marginBottom: 16, breakInside: 'avoid' }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px 12px' }}><div className="card-title">{title}</div>{sub && <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{sub}</div>}</div>
      <div className="card-body">{children}</div>
    </section>
  )
  const Tile = ({ label, value, sub, tone }) => (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: String(value).length > 7 ? 20 : 26, fontWeight: 800, margin: '4px 0', color: tone || 'var(--ink)', whiteSpace: 'nowrap' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{sub}</div>}
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      <style>{`.gl-scroll { overflow-x: auto; max-width: 100% } .gl-scroll > table { min-width: 560px }
        @media print { .no-print { display: none !important } body { background: #fff } .card { box-shadow: none !important } .gl-scroll > table { min-width: 0 } }`}</style>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 16px 48px' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 18 }}>
          <div style={{ minWidth: 0, flex: '1 1 300px' }}>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)', fontWeight: 600 }}>{appName} · {mgmt ? 'Management report' : 'Customer report'}</div>
            <h1 style={{ fontFamily: 'Playfair Display, serif', fontSize: 'clamp(22px, 5vw, 28px)', margin: '4px 0', overflowWrap: 'anywhere' }}>{r.title}</h1>
            <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
              {[g.customer, g.project, (g.sites || []).join(', ')].filter(Boolean).join(' · ')}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 4 }}>
              Period {dateFmt(r.period.from)} – {dateFmt(r.period.to)} · Go-live {dateFmt(g.go_live_date)} · Hypercare {g.status === 'CLOSED' ? `closed ${dateFmt(g.hypercare_actual_end)}` : `until ${dateFmt(g.hypercare_planned_end)}`}
            </div>
          </div>
          <div className="no-print">
            <button className="btn btn-ghost btn-sm" onClick={() => window.print()}><Printer size={13} /> Print / PDF</button>
            <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 6 }}>Generated {istDateTime(r.generated_at)} IST</div>
          </div>
        </header>

        {(show('overview') || show('daily')) && <ReportOverview token={token} showOverview={show('overview')} showDaily={show('daily')} />}

        {show('fleet') && equipment.length > 0 && (
          <Section title="Equipment overview" sub="Device, operation, maintenance and sensor status per equipment · latest check in the period · click a figure to filter">
            <FleetSummary rows={equipment} sensorSummary={r.sensor_summary} />
          </Section>
        )}

        {show('summary') && (
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', padding: '14px 18px', marginBottom: 12, borderRadius: 12, background: status.bg, border: `1.5px solid ${status.color}33` }}>
            <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: status.color }}>Overall · {status.label}</span>
            <span style={{ fontSize: 13, color: 'var(--ink-soft)', flex: '1 1 320px' }}>
              {[
                pct(logged, expected) != null && `${pct(logged, expected)}% of expected daily checks logged`,
                pct(healthy, checkRecords) != null && `${pct(healthy, checkRecords)}% healthy`,
                hours.total.matchRate != null && `${hours.total.matchRate}% of equipment-days within hours tolerance`,
                `${openInc.length} open incident${openInc.length === 1 ? '' : 's'}`,
              ].filter(Boolean).join(' · ')}
              {lastWeek && prevWeek && lastWeek.healthyPct != null && prevWeek.healthyPct != null && <> · healthy share this week <Delta now={lastWeek.healthyPct} prev={prevWeek.healthyPct} /> vs last week</>}
            </span>
          </div>
        )}
        {show('summary') && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
            <Tile label="Equipment operating" value={equipment.length ? `${online}/${equipment.length}` : '—'} sub={offline ? `${offline} not operating or not running` : 'All operating'} tone={offline ? '#b91c1c' : '#047857'} />
            <Tile label="Running time (IoT)" value={hours.total.iotUptimePct != null ? `${hours.total.iotUptimePct}%` : '—'} sub={hours.total.manualUptimePct != null ? `Manual report: ${hours.total.manualUptimePct}% of the day` : 'Share of the day equipment ran'} />
            <Tile label="Hours agreement" value={hours.total.matchRate != null ? `${hours.total.matchRate}%` : '—'} sub={hours.total.compared ? `${hours.total.match} of ${hours.total.compared} equipment-days within tolerance` : 'No hours compared yet'} tone={hours.total.matchRate != null && hours.total.matchRate < 90 ? '#b45309' : undefined} />
            <Tile label="Daily check coverage" value={pct(logged, expected) != null ? `${pct(logged, expected)}%` : '—'} sub={checkRecords ? `${pct(healthy, checkRecords)}% of check records healthy` : 'No checks in period'} />
            <Tile label="Open incidents" value={openInc.length} sub={`${openInc.filter(i => i.priority === 'P1_CRITICAL').length} critical`} tone={openInc.some(i => i.priority === 'P1_CRITICAL') ? '#b91c1c' : undefined} />
            {hours.total.fuelLitres != null && <Tile label="Average fuel consumption" value={hours.total.avgFuelLph != null ? `${hours.total.avgFuelLph} L/h` : '—'} sub={`${hours.total.fuelLitres} L over ${hours.total.fuelDays} equipment-day(s)`} />}
            <Tile label="Open actions" value={actions.length} sub="Hours mismatches, device issues, incident actions" />
            {sensorsTotal > 0 && <Tile label="Sensors working" value={`${sensorsTotal - sensorsDown}/${sensorsTotal}`} sub={sensorsDown ? `${sensorsDown} down across ${equipment.filter(e => e.sensors_down).length} device(s)` : 'None down'} tone={sensorsDown ? '#b45309' : '#047857'} />}
            {withFw.length > 0 && <Tile label="Firmware current" value={`${pct(fwCurrent, withFw.length)}%`} sub={`${fwCurrent} of ${withFw.length} devices on the current release`} tone={fwCurrent < withFw.length ? '#b45309' : '#047857'} />}
          </div>
        )}

        {show('trends') && health.length > 1 && (
          <Section title="Trends" sub="Daily coverage and healthy share · week on week">
            <TrendLines days={health} />
            <WeeklyTable weeks={weeks} />
          </Section>
        )}

        {show('health') && (
          <Section title="Daily device health" sub="Counts are check records, not uptime">
            <HealthChart days={health} />
          </Section>
        )}

        {show('hours') && (
          <Section title="Manual vs IoT running hours" sub={`IoT − manual; manual (client) hours are the reference`}>
            {!hours.categories.length ? <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>No hours reported in this period.</div> : (
              <>
                <UptimeBars categories={hours.categories} />
                <div className="gl-scroll"><table className="data-table" style={{ display: 'table', fontSize: 12.5, marginTop: 14 }}>
                  <thead><tr><th>Category</th><th>Equipment</th><th>Manual h</th><th>IoT h</th><th>Difference</th><th>Within tolerance</th><th>Missing</th><th>Fuel L</th><th>Avg fuel L/h</th></tr></thead>
                  <tbody>{hours.categories.map(c => (
                    <tr key={c.category}><td style={{ fontWeight: 700 }}>{c.category}</td><td>{c.equipment}</td><td>{c.manualHours}</td><td>{c.iotHours}</td>
                      <td>{c.diffPct == null ? '—' : `${c.diffPct > 0 ? '+' : ''}${c.diffPct}%`}</td><td>{c.matchRate == null ? '—' : `${c.matchRate}% (${c.match}/${c.compared})`}</td><td>{c.missingManual + c.missingIot || ''}</td>
                      <td>{c.fuelLitres ?? '—'}</td><td>{c.avgFuelLph ?? '—'}</td></tr>
                  ))}</tbody>
                </table></div>
                <details open style={{ marginTop: 10 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>By equipment ({hours.equipment.length})</summary>
                  <div className="gl-scroll"><table className="data-table" style={{ display: 'table', fontSize: 12, marginTop: 8 }}>
                    <thead><tr><th>Equipment</th><th>Category</th><th>Days</th><th>Manual h</th><th>IoT h</th><th>Difference</th><th>Uptime manual / IoT</th><th>Mismatched days</th><th>Fuel L</th><th>Avg fuel L/h</th></tr></thead>
                    <tbody>{hours.equipment.map(e => (
                      <tr key={e.equipment}><td>{e.equipment}</td><td>{e.category}</td><td>{e.days}</td><td>{e.manualHours}</td><td>{e.iotHours}</td>
                        <td>{e.diffPct == null ? '—' : `${e.diffPct > 0 ? '+' : ''}${e.diffPct}%`}</td><td>{e.manualUptimePct ?? '—'}% / {e.iotUptimePct ?? '—'}%</td><td>{e.mismatch || ''}</td>
                        <td>{e.fuelLitres ?? '—'}</td><td>{e.avgFuelLph ?? '—'}</td></tr>
                    ))}</tbody>
                  </table></div>
                  {mgmt && (
                    <div className="gl-scroll"><table className="data-table" style={{ display: 'table', fontSize: 12, marginTop: 8 }}>
                      <thead><tr><th>Date</th><th>Equipment</th><th>Manual</th><th>IoT</th><th>Diff %</th><th>Status</th></tr></thead>
                      <tbody>{(r.hours || []).filter(h => h.status !== 'MATCH').map((h, i) => (
                        <tr key={i}><td>{h.date}</td><td>{h.equipment}</td><td>{h.manual ?? '—'}</td><td>{h.iot ?? '—'}</td><td>{h.diff_pct ?? '—'}</td><td>{HOURS_STATUSES[h.status]?.label}{h.action_status ? ` · action ${h.action_status.toLowerCase()}` : ''}</td></tr>
                      ))}</tbody>
                    </table></div>
                  )}
                </details>
              </>
            )}
          </Section>
        )}

        {show('devices') && equipment.length > 0 && (
          <Section title="Device register" sub={`${equipment.length} devices · checks, firmware and sensors over the period`}>
            <DeviceRegister equipment={equipment} mgmt={mgmt} />
          </Section>
        )}

        {show('equipment') && (
          <Section title="Equipment status" sub="Latest onsite check in the period, or the latest IoT hours when there's no newer check">
            {!equipment.length ? <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>No equipment enrolled.</div> : Object.entries(byCat).map(([cat, list]) => (
              <div key={cat} style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{cat} <span style={{ fontWeight: 400, color: 'var(--ink-muted)' }}>· {list.filter(e => ON.includes(e.status)).length}/{list.length} operating</span></div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(230px, 100%), 1fr))', gap: 8 }}>
                  {list.map((e, i) => {
                    const st = EQUIP_STATUS[e.status] || { label: e.status || '—', color: 'var(--ink-muted)' }
                    return (
                      <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, background: '#fff', fontSize: 12.5 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                          <strong>{e.equipment || e.device}</strong>
                          <span style={{ fontWeight: 700, color: st.color, whiteSpace: 'nowrap' }}>{st.label}</span>
                        </div>
                        <div style={{ color: 'var(--ink-muted)', marginTop: 2 }}>{[e.equipment_id !== e.equipment ? e.equipment_id : null, e.device, e.site].filter(Boolean).join(' · ')}</div>
                        <div style={{ marginTop: 4 }}>
                          {e.last_result ? <>Check: {DAILY_RESULTS[e.last_result]?.label}{e.connectivity ? `, operation ${labelOf(CONNECTIVITY_STATUSES, e.connectivity).toLowerCase()}` : ''} · {dateFmt(e.last_check_date)}</> : 'No check in period'}
                          {e.open_issues > 0 && <span style={{ color: '#b45309' }}> · {e.open_issues} open issue{e.open_issues > 1 ? 's' : ''}</span>}
                        </div>
                        {e.hour_days > 0 && (
                          <div style={{ marginTop: 4, color: 'var(--ink-soft)' }}>
                            Hours: manual {e.manual_hours ?? '—'} h · IoT {e.iot_hours ?? '—'} h ({e.hour_days} day{e.hour_days > 1 ? 's' : ''})
                            {e.iot_uptime_pct != null && <> · running {e.iot_uptime_pct}% IoT / {e.manual_uptime_pct}% manual</>}
                            {e.fuel_lph != null && <> · fuel {e.fuel_lph} L/h</>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </Section>
        )}

        {show('sla') && (
          <Section title="Incidents & SLA" sub="Acknowledgement against target, time to resolve, ageing and categories">
            <SlaSection incidents={incidents} targets={g.sla_targets} mgmt={mgmt} />
          </Section>
        )}

        {show('incidents') && (
          <Section title="Incidents" sub={mgmt ? 'Open, plus closed in the period' : 'Incidents shared with you'}>
            {!incidents.length ? <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>No incidents in this period.</div> : (
              <>
                {mgmt && (
                  <div className="gl-scroll"><table className="data-table" style={{ display: 'table', fontSize: 12, marginBottom: 12 }}>
                    <thead><tr><th>Priority</th><th>Incidents</th><th>Mean time to acknowledge</th><th>Mean time to resolve</th></tr></thead>
                    <tbody>{PRIORITIES.map(p => <tr key={p.key}><td>{p.label}</td><td>{incKpi.byPriority[p.key].count}</td><td>{fmtMins(incKpi.byPriority[p.key].mtta)}</td><td>{fmtMins(incKpi.byPriority[p.key].mttr)}</td></tr>)}</tbody>
                  </table></div>
                )}
                <div className="gl-scroll"><table className="data-table" style={{ display: 'table', fontSize: 12.5 }}>
                  <thead><tr><th>Incident</th><th>Priority</th><th>Status</th><th>Next action</th>{mgmt && <th>Owner</th>}{mgmt && <th>Follow-up</th>}</tr></thead>
                  <tbody>{incidents.map(i => (
                    <tr key={i.number}><td><strong>{i.number}</strong> {i.title}<div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Reported {istDateTime(i.reported_at)}</div></td>
                      <td>{labelOf(PRIORITIES, i.priority)}</td><td>{labelOf(INCIDENT_STATUSES, i.status)}</td>
                      <td>{i.next_action || '—'}{i.action_due_at && i.status !== 'CLOSED' && <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>due {istDateTime(i.action_due_at)}</div>}</td>
                      {mgmt && <td>{i.owner || '—'}</td>}{mgmt && <td>{FOLLOW_UP_FLAGS[i.follow_up_flag]?.label}</td>}</tr>
                  ))}</tbody>
                </table></div>
              </>
            )}
          </Section>
        )}

        {show('actions') && (
          <Section title="Improvement actions">
            <div style={{ marginBottom: 12 }}>
              {insights.map((ins, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, padding: '6px 0' }}>
                  {ins.tone === 'green' ? <CheckCircle2 size={15} color="#059669" style={{ flexShrink: 0, marginTop: 1 }} /> : ins.tone === 'red' ? <AlertTriangle size={15} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} /> : <Lightbulb size={15} color="#d97706" style={{ flexShrink: 0, marginTop: 1 }} />}
                  <span>{ins.text}</span>
                </div>
              ))}
            </div>
            {actions.length > 0 && (
              <div className="gl-scroll"><table className="data-table" style={{ display: 'table', fontSize: 12.5 }}>
                <thead><tr><th>Type</th><th>Equipment / ref</th><th>Action</th><th>Since</th>{mgmt && <th>Owner</th>}</tr></thead>
                <tbody>{actions.map((a, i) => (
                  <tr key={i}><td>{a.kind === 'hours' ? 'Hours mismatch' : a.kind === 'device_issue' ? `Device issue${a.severity ? ` · ${a.severity.toLowerCase()}` : ''}` : 'Incident'}</td>
                    <td>{a.equipment}</td><td>{a.text}{mgmt && a.note && <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{a.note}</div>}</td><td>{dateFmt(a.date)}</td>{mgmt && <td>{a.owner || '—'}</td>}</tr>
                ))}</tbody>
              </table></div>
            )}
          </Section>
        )}

        {show('readiness') && r.readiness?.criteria && (
          <Section title="Hypercare exit readiness" sub={r.readiness.all_met ? 'All criteria met' : 'Not ready yet'}>
            {r.readiness.criteria.map(c => (
              <div key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                {c.met ? <CheckCircle2 size={15} color="#059669" /> : <XCircle size={15} color="#dc2626" />}
                <span style={{ flex: 1 }}>{c.label} — <strong>{c.met ? 'met' : 'not met'}</strong></span>
                {mgmt && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{c.key === 'stable_days' ? `${c.value}/${c.target} days` : c.key === 'signoff' ? c.value || '—' : c.value}</span>}
              </div>
            ))}
          </Section>
        )}
      </div>
    </div>
  )
}

function HealthChart({ days }) {
  if (!days.length) return <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>No checks in this period.</div>
  const max = Math.max(1, ...days.map(d => d.healthy + d.attention + d.incomplete), ...days.map(d => d.expected))
  const H = 150
  return (
    <div>
      <div style={{ display: 'flex', gap: 14, fontSize: 12, marginBottom: 10, color: 'var(--ink-soft)', flexWrap: 'wrap' }}>
        {TREND.map(t => <span key={t.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: t.color }} />{t.label}</span>)}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, borderTop: '2px dashed #94a3b8' }} />Devices expected</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: H, borderBottom: '1px solid var(--border)' }}>
        {days.map(d => (
          <div key={d.date} title={`${dateFmt(d.date)}\nExpected ${d.expected} · logged ${d.logged}\nHealthy ${d.healthy} · Attention ${d.attention} · Incomplete ${d.incomplete}`}
            style={{ flex: 1, height: '100%', position: 'relative', display: 'flex', flexDirection: 'column-reverse', gap: 2, minWidth: 4 }}>
            {TREND.filter(t => d[t.key] > 0).map((t, i, arr) => (
              <div key={t.key} style={{ height: (d[t.key] / max) * (H - 6), background: t.color, borderRadius: i === arr.length - 1 ? '4px 4px 0 0' : 0 }} />
            ))}
            {d.expected > 0 && <div style={{ position: 'absolute', left: 0, right: 0, bottom: (d.expected / max) * (H - 6), borderTop: '2px dashed #94a3b8' }} />}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-muted)', marginTop: 4 }}>
        <span>{dateFmt(days[0].date)}</span><span>{dateFmt(days[days.length - 1].date)}</span>
      </div>
    </div>
  )
}

// Running time as a share of the day, manual vs IoT, per category.
function UptimeBars({ categories }) {
  const series = [{ key: 'manualUptimePct', label: 'Manual report', color: '#64748b' }, { key: 'iotUptimePct', label: 'IoT logger', color: '#6366f1' }]
  return (
    <div>
      <div style={{ display: 'flex', gap: 14, fontSize: 12, marginBottom: 8, color: 'var(--ink-soft)' }}>
        {series.map(s => <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: s.color }} />{s.label}</span>)}
        <span style={{ color: 'var(--ink-muted)' }}>· running time as % of the day</span>
      </div>
      {categories.map(c => (
        <div key={c.category} style={{ display: 'grid', gridTemplateColumns: 'minmax(80px, 130px) 1fr', gap: 10, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{c.category}</span>
          <div style={{ display: 'grid', gap: 2 }}>
            {series.map(s => (
              <div key={s.key} title={`${c.category} · ${s.label}: ${c[s.key] ?? '—'}%`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, height: 9, background: 'var(--surface)', borderRadius: 4 }}>
                  <div style={{ width: `${Math.min(100, c[s.key] || 0)}%`, height: '100%', background: s.color, borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 11.5, width: 44, textAlign: 'right' }}>{c[s.key] ?? '—'}%</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ═══ STEP245 sections ═══ */

const DAY = 86400000
const isoWeekStart = d => { const x = new Date(`${d}T00:00:00Z`); const wd = (x.getUTCDay() + 6) % 7; return new Date(x - wd * DAY).toISOString().slice(0, 10) }
const minsBetween = (a, b) => (a && b ? (new Date(b) - new Date(a)) / 60000 : null)
const avg = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

// Week-on-week rollup of daily health, hours and incidents.
export function weeklyRollup(health, hoursRows, incidents) {
  const weeks = {}
  const w = d => (weeks[isoWeekStart(d)] ||= { week: isoWeekStart(d), expected: 0, logged: 0, healthy: 0, attention: 0, records: 0, compared: 0, match: 0, opened: 0, resolved: 0 })
  for (const d of health) { const x = w(d.date); x.expected += d.expected; x.logged += d.logged; x.healthy += d.healthy; x.attention += d.attention; x.records += d.healthy + d.attention + d.incomplete }
  for (const h of hoursRows) { if (h.manual != null && h.iot != null) { const x = w(h.date); x.compared++; if (h.status === 'MATCH') x.match++ } }
  const first = health[0]?.date
  for (const i of incidents) {
    const rep = i.reported_at?.slice(0, 10)
    if (rep && (!first || rep >= first)) w(rep).opened++
    const res = (i.resolved_at || i.closed_at)?.slice(0, 10)
    if (res && (!first || res >= first)) w(res).resolved++
  }
  return Object.values(weeks).sort((a, b) => a.week.localeCompare(b.week)).map(x => ({
    ...x,
    coverage: x.expected ? Math.round((x.logged / x.expected) * 1000) / 10 : null,
    healthyPct: x.records ? Math.round((x.healthy / x.records) * 1000) / 10 : null,
    matchPct: x.compared ? Math.round((x.match / x.compared) * 1000) / 10 : null,
  }))
}

function Delta({ now, prev, good = 'up', unit = '%' }) {
  if (now == null || prev == null) return null
  const d = Math.round((now - prev) * 10) / 10
  if (!d) return <span style={{ color: 'var(--ink-muted)', fontSize: 11 }}> ±0</span>
  const better = good === 'up' ? d > 0 : d < 0
  return <span style={{ color: better ? '#047857' : '#b91c1c', fontSize: 11, fontWeight: 700 }}> {d > 0 ? '▲' : '▼'} {Math.abs(d)}{unit}</span>
}

// Overall RAG: red on critical incidents or healthy < 80 %, amber below targets.
export function overallStatus({ healthyPct, coverage, openCritical, sensorsDownPct, readiness }) {
  if (openCritical > 0 || (healthyPct != null && healthyPct < 80) || (coverage != null && coverage < 80)) return { tone: 'red', label: 'At risk', color: '#b91c1c', bg: '#fef2f2' }
  if ((healthyPct != null && healthyPct < 95) || (coverage != null && coverage < 95) || (sensorsDownPct != null && sensorsDownPct > 5)) return { tone: 'amber', label: 'Needs attention', color: '#b45309', bg: '#fffbeb' }
  return { tone: 'green', label: readiness?.all_met ? 'Ready to exit hypercare' : 'On track', color: '#047857', bg: '#ecfdf5' }
}

// Daily coverage and healthy % as two lines.
export function TrendLines({ days }) {
  const pts = days.map(d => ({ date: d.date, cov: d.expected ? (d.logged / d.expected) * 100 : null, hp: (d.healthy + d.attention + d.incomplete) ? (d.healthy / (d.healthy + d.attention + d.incomplete)) * 100 : null }))
  if (pts.length < 2) return null
  const W = 600, H = 140, P = 6
  const x = i => P + (i / (pts.length - 1)) * (W - 2 * P)
  const y = v => H - P - (v / 100) * (H - 2 * P)
  const line = k => pts.map((p, i) => (p[k] == null ? null : `${x(i)},${y(p[k])}`)).filter(Boolean).join(' ')
  return (
    <div>
      <div style={{ display: 'flex', gap: 14, fontSize: 12, marginBottom: 6, color: 'var(--ink-soft)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, borderTop: '2.5px solid #6366f1' }} />Check coverage</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, borderTop: '2.5px solid #059669' }} />Healthy share</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 140, display: 'block' }} preserveAspectRatio="none" role="img" aria-label="Daily coverage and healthy share">
        {[0, 50, 100].map(v => <line key={v} x1={P} x2={W - P} y1={y(v)} y2={y(v)} stroke="#e2e8f0" strokeDasharray={v === 100 ? '' : '3 3'} />)}
        <polyline points={line('cov')} fill="none" stroke="#6366f1" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        <polyline points={line('hp')} fill="none" stroke="#059669" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-muted)' }}><span>{dateFmt(pts[0].date)}</span><span>Scale 0–100%</span><span>{dateFmt(pts[pts.length - 1].date)}</span></div>
    </div>
  )
}

export function WeeklyTable({ weeks }) {
  if (!weeks.length) return null
  return (
    <div className="gl-scroll"><table className="data-table" style={{ display: 'table', fontSize: 12.5, marginTop: 14 }}>
      <thead><tr><th>Week of</th><th>Check coverage</th><th>Healthy share</th><th>Attention records</th><th>Hours within tolerance</th><th>Incidents opened</th><th>Resolved</th></tr></thead>
      <tbody>{weeks.map((w, i) => {
        const p = weeks[i - 1]
        return (
          <tr key={w.week}>
            <td style={{ fontWeight: 600 }}>{dateFmt(w.week)}</td>
            <td>{w.coverage ?? '—'}{w.coverage != null && '%'}<Delta now={w.coverage} prev={p?.coverage} /></td>
            <td>{w.healthyPct ?? '—'}{w.healthyPct != null && '%'}<Delta now={w.healthyPct} prev={p?.healthyPct} /></td>
            <td>{w.attention}<Delta now={w.attention} prev={p?.attention} good="down" unit="" /></td>
            <td>{w.matchPct ?? '—'}{w.matchPct != null && '%'}<Delta now={w.matchPct} prev={p?.matchPct} /></td>
            <td>{w.opened}</td><td>{w.resolved}</td>
          </tr>
        )
      })}</tbody>
    </table></div>
  )
}

const FW_LABEL = { CURRENT: ['Current', '#047857'], SUPPORTED: ['Supported', 'var(--ink-soft)'], DEPRECATED: ['Deprecated', '#b91c1c'] }
export function DeviceRegister({ equipment, mgmt }) {
  const [q, setQ] = useState('')
  const rows = equipment.filter(e => !q.trim() || [e.equipment_id, e.equipment, e.category, e.device, e.site].some(v => String(v || '').toLowerCase().includes(q.trim().toLowerCase())))
  const fw = e => {
    if (!e.firmware_version) return <span style={{ color: 'var(--ink-muted)' }}>—</span>
    if (e.firmware_status === 'CURRENT' || (!e.firmware_status && e.firmware_version === e.firmware_current)) return <span>{e.firmware_version} <span style={{ color: '#047857', fontWeight: 600 }}>· current</span></span>
    const [l, c] = FW_LABEL[e.firmware_status] || [e.firmware_current ? 'Update due' : '', '#b45309']
    return <span>{e.firmware_version}{l && <span style={{ color: e.firmware_current && e.firmware_status !== 'DEPRECATED' ? '#b45309' : c, fontWeight: 600 }}> · {e.firmware_current && e.firmware_status !== 'CURRENT' ? `update to ${e.firmware_current}` : l.toLowerCase()}</span>}</span>
  }
  return (
    <div>
      <input className="form-input no-print" value={q} onChange={e => setQ(e.target.value)} placeholder="Search equipment, category, device, site…" style={{ maxWidth: 340, marginBottom: 10 }} />
      <div className="gl-scroll"><table className="data-table" style={{ display: 'table', fontSize: 12.5 }}>
        <thead><tr><th>Equipment ID</th><th>Equipment</th><th>Category</th><th>Device</th><th>Site</th><th>Status</th><th>Days checked</th><th>Healthy</th><th>Last result</th><th>Firmware</th><th>Sensors</th><th>Open issues</th></tr></thead>
        <tbody>{rows.map((e, i) => {
          const st = EQUIP_STATUS[e.status] || { label: e.status || '—', color: 'var(--ink-muted)' }
          const hp = e.checked_days ? Math.round((e.healthy_days / e.checked_days) * 100) : null
          return (
            <tr key={i}>
              <td style={{ fontWeight: 700 }}>{e.equipment_id || '—'}</td>
              <td>{e.equipment || '—'}</td>
              <td>{e.category}</td>
              <td style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, whiteSpace: 'nowrap' }}>{e.device}{mgmt && e.serial && e.serial !== e.device && <div style={{ fontSize: 10.5, color: 'var(--ink-muted)' }}>{e.serial}</div>}</td>
              <td>{e.site || '—'}</td>
              <td style={{ color: st.color, fontWeight: 700, whiteSpace: 'nowrap' }}>{st.label}</td>
              <td>{e.checked_days ?? 0}</td>
              <td style={{ color: hp == null ? undefined : hp >= 95 ? '#047857' : hp >= 80 ? '#b45309' : '#b91c1c', fontWeight: 600 }}>{hp == null ? '—' : `${hp}%`}{e.attention_days ? <div style={{ fontSize: 10.5, color: '#b91c1c', fontWeight: 400 }}>{e.attention_days} attention day{e.attention_days > 1 ? 's' : ''}</div> : null}</td>
              <td>{e.last_result ? DAILY_RESULTS[e.last_result]?.label : '—'}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{fw(e)}</td>
              <td style={{ whiteSpace: 'nowrap', minWidth: 150 }}>{!e.sensors_total ? '—' : <>{e.sensors_total - (e.sensors_down || 0)}/{e.sensors_total} ok{e.sensors_down > 0 && <div style={{ fontSize: 10.5, color: '#b91c1c', whiteSpace: 'normal', maxWidth: 200 }}>Down: {e.sensors_down_names}</div>}</>}</td>
              <td>{e.open_issues || '—'}</td>
            </tr>
          )
        })}</tbody>
      </table></div>
    </div>
  )
}

const AGE = [['< 1 day', 0, 1], ['1–3 days', 1, 3], ['3–7 days', 3, 7], ['> 7 days', 7, Infinity]]
export function SlaSection({ incidents, targets, mgmt }) {
  const rows = PRIORITIES.map(p => {
    const list = incidents.filter(i => i.priority === p.key)
    const ack = list.map(i => minsBetween(i.reported_at, i.acknowledged_at)).filter(v => v != null)
    const res = list.map(i => minsBetween(i.reported_at, i.resolved_at || i.closed_at)).filter(v => v != null)
    const target = Number(targets?.[p.key]) || null
    const met = target ? ack.filter(m => m <= target).length : null
    return { p, count: list.length, open: list.filter(i => !['RESOLVED', 'CLOSED'].includes(i.status)).length, target, mtta: avg(ack), mttr: avg(res), acked: ack.length, met }
  }).filter(r => r.count)
  const allAcked = rows.reduce((s, r) => s + r.acked, 0)
  const allMet = rows.reduce((s, r) => s + (r.met || 0), 0)
  const open = incidents.filter(i => !['RESOLVED', 'CLOSED'].includes(i.status))
  const now = Date.now()
  const ages = AGE.map(([label, lo, hi]) => ({ label, n: open.filter(i => { const d = (now - new Date(i.reported_at)) / DAY; return d >= lo && d < hi }).length }))
  const byCat = Object.entries(incidents.reduce((m, i) => ((m[i.category || 'OTHER'] = (m[i.category || 'OTHER'] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1])
  const maxCat = Math.max(1, ...byCat.map(c => c[1]))
  if (!incidents.length) return <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>No incidents in this period.</div>
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
        <MiniStat label="Acknowledged within target" value={allAcked ? `${Math.round((allMet / allAcked) * 100)}%` : '—'} sub={`${allMet} of ${allAcked} acknowledged`} tone={allAcked && allMet / allAcked < 0.9 ? '#b45309' : '#047857'} />
        <MiniStat label="Mean time to acknowledge" value={fmtMins(avg(incidents.map(i => minsBetween(i.reported_at, i.acknowledged_at)).filter(v => v != null)))} />
        <MiniStat label="Mean time to resolve" value={fmtMins(avg(incidents.map(i => minsBetween(i.reported_at, i.resolved_at || i.closed_at)).filter(v => v != null)))} />
        <MiniStat label="Open now" value={open.length} sub={`${open.filter(i => i.priority === 'P1_CRITICAL').length} critical`} tone={open.some(i => i.priority === 'P1_CRITICAL') ? '#b91c1c' : undefined} />
      </div>
      <div className="gl-scroll"><table className="data-table" style={{ display: 'table', fontSize: 12.5 }}>
        <thead><tr><th>Priority</th><th>Incidents</th><th>Open</th><th>Acknowledge target</th><th>Within target</th><th>Mean to acknowledge</th><th>Mean to resolve</th></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.p.key}><td style={{ fontWeight: 600 }}>{r.p.label}</td><td>{r.count}</td><td>{r.open || '—'}</td><td>{r.target ? fmtMins(r.target) : '—'}</td>
            <td style={{ color: r.acked && r.met / r.acked < 0.9 ? '#b45309' : '#047857', fontWeight: 600 }}>{r.acked ? `${Math.round((r.met / r.acked) * 100)}% (${r.met}/${r.acked})` : '—'}</td>
            <td>{fmtMins(r.mtta)}</td><td>{fmtMins(r.mttr)}</td></tr>
        ))}</tbody>
      </table></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20, marginTop: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Open incident age</div>
          {ages.map(a => (
            <div key={a.label} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 30px', gap: 8, alignItems: 'center', fontSize: 12.5, marginBottom: 5 }}>
              <span>{a.label}</span>
              <div style={{ height: 9, background: 'var(--surface)', borderRadius: 4 }}><div style={{ width: `${open.length ? (a.n / open.length) * 100 : 0}%`, height: '100%', borderRadius: 4, background: a.label === '> 7 days' ? '#dc2626' : a.label === '3–7 days' ? '#d97706' : '#6366f1' }} /></div>
              <span style={{ textAlign: 'right', fontWeight: 600 }}>{a.n}</span>
            </div>
          ))}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Incidents by category</div>
          {byCat.map(([c, n]) => (
            <div key={c} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 30px', gap: 8, alignItems: 'center', fontSize: 12.5, marginBottom: 5 }}>
              <span>{c.charAt(0) + c.slice(1).toLowerCase().replace(/_/g, ' ')}</span>
              <div style={{ height: 9, background: 'var(--surface)', borderRadius: 4 }}><div style={{ width: `${(n / maxCat) * 100}%`, height: '100%', borderRadius: 4, background: '#64748b' }} /></div>
              <span style={{ textAlign: 'right', fontWeight: 600 }}>{n}</span>
            </div>
          ))}
        </div>
      </div>
      {mgmt && incidents.some(i => i.root_cause) && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Root causes</div>
          {incidents.filter(i => i.root_cause).map(i => (
            <div key={i.number} style={{ fontSize: 12.5, padding: '6px 0', borderBottom: '1px solid var(--border)' }}><strong>{i.number}</strong> {i.title} — <span style={{ color: 'var(--ink-soft)' }}>{i.root_cause}</span></div>
          ))}
        </div>
      )}
    </div>
  )
}

function MiniStat({ label, value, sub, tone }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
      <div style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: tone || 'var(--ink)', marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{sub}</div>}
    </div>
  )
}
