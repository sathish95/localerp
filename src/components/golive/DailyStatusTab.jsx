import { useState, useEffect, useMemo, Fragment } from 'react'
import { listChecks, loadDayActivity, deviceLabel } from '../../lib/goLive'
import { buildDailyStatus, statusText, personLine, SECTIONS, PERSON_STATUSES } from '../../lib/goLiveDailyStatus'
import { istToday, addDays, istDateTime } from '../../lib/goLiveRules'
import { deviceFilterActive } from '../../lib/goLiveDeviceFields'
import { activityLabel } from '../../lib/supportVisits'
import { ensureXLSX } from '../../lib/xlsxLoader'
import { dateFmt } from '../../lib/supabase'
import { Loader } from '../ui'
import { Kpi, Search, ErrorLine, PriorityBadge, errText, DeviceFilterNote } from './shared'
import {
  ChevronLeft, ChevronRight, ChevronDown, Copy, Download, RefreshCw, ClipboardCheck, MapPin, AlertTriangle,
  StickyNote, MessageSquare, ArrowRightLeft, Eye, ExternalLink, Users,
} from 'lucide-react'

const hm = ts => (ts ? istDateTime(ts).split(', ').pop() : '')
const initials = n => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
const RESULT_TONE = { ATTENTION: 'red', INCOMPLETE: 'amber', HEALTHY: 'green' }
const RESULT_LABEL = { ATTENTION: 'Attention', INCOMPLETE: 'Incomplete', HEALTHY: 'Healthy' }
const KIND_ICON = { check: ClipboardCheck, visit: MapPin, observation: Eye, note: StickyNote, issue: AlertTriangle, incident: AlertTriangle, status: ArrowRightLeft, update: MessageSquare }
const STATUS_FILTERS = [['', 'All'], ['UPDATED', 'Updated'], ['ON_SITE', 'On site'], ['NO_UPDATE', 'No update']]

// Daily Status: who did what on one IST day — roster coverage, a team table
// and each person's activity timeline.
export default function DailyStatusTab({ ctx }) {
  const { engagement, enrollments: allEnrollments, incidents, lookups, roster } = ctx
  const [date, setDate] = useState(istToday())
  const [checks, setChecks] = useState(null)
  const [activity, setActivity] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [role, setRole] = useState('')
  const [open, setOpen] = useState({})
  const [copied, setCopied] = useState(false)
  const [tick, setTick] = useState(0)
  const today = istToday()

  const filtering = deviceFilterActive(ctx.deviceFilter)
  const enrollments = useMemo(() => (filtering ? allEnrollments.filter(ctx.matchDev) : allEnrollments), [allEnrollments, filtering, ctx.matchDev])

  useEffect(() => {
    let live = true
    setChecks(null); setActivity(null); setError('')
    Promise.all([listChecks(engagement.id, { from: date, to: date }), loadDayActivity(engagement.id, incidents.map(i => i.id), date)])
      .then(([c, a]) => { if (live) { setChecks(c); setActivity(a) } })
      .catch(e => live && setError(errText(e)))
    return () => { live = false }
  }, [engagement.id, date, incidents.map(i => i.id).join(), tick])

  const person = id => lookups.people.find(p => p.id === id)?.full_name || ''
  const s = useMemo(() => {
    if (!checks || !activity) return null
    const ids = new Set(enrollments.map(e => e.id))
    return buildDailyStatus({
      date, today, checks: filtering ? checks.filter(c => ids.has(c.enrollment_id)) : checks, enrollments, incidents, ...activity,
      roster, pmUserId: engagement.pm_user_id, person, deviceLabel,
    })
  }, [checks, activity, enrollments, incidents, roster, date, engagement.pm_user_id])

  const counts = useMemo(() => s && Object.fromEntries(STATUS_FILTERS.map(([k]) => [k, k ? s.people.filter(p => p.status === k).length : s.people.length])), [s])
  const ql = q.trim().toLowerCase()
  const rows = !s ? [] : s.people.filter(p =>
    (!statusFilter || p.status === statusFilter)
    && (!role || (role === 'OTHER' ? !p.onRoster : p.roles.some(r => r.key === role)))
    && (!ql || p.name.toLowerCase().includes(ql) || p.roles.some(r => r.label.toLowerCase().includes(ql))))
  const allOpen = rows.length > 0 && rows.every(p => open[p.id])

  const openIncident = id => { const p = new URLSearchParams(ctx.params); p.set('tab', 'incidents'); p.set('incident', id); ctx.setParams(p, { replace: true }) }

  async function copy() {
    try { await navigator.clipboard.writeText(statusText(s, engagement.name || engagement.code)); setCopied(true); setTimeout(() => setCopied(false), 1500) }
    catch { setError('Copy failed — your browser blocked clipboard access') }
  }

  async function exportXlsx() {
    await ensureXLSX()
    const XLSX = window.XLSX
    const roleText = p => p.roles.map(r => `${r.label}${r.backup ? ' (backup)' : ''}`).join(', ')
    const team = [
      [`${engagement.code} — daily status`, '', dateFmt(date)], [],
      ['Team member', 'Roles', 'Status', 'Onsite checks', 'Firmware checks', 'Application checks', 'Devices checked', 'Need attention',
        'Observations', 'Notes', 'Issues', 'Incidents raised', 'Status changes', 'Incident updates', 'Incident hours', 'Site visits', 'Visit hours', 'First activity', 'Last activity', 'Summary'],
      ...s.people.map(p => [p.name, roleText(p), PERSON_STATUSES[p.status].label, p.sections.onsite, p.sections.firmware, p.sections.application,
        p.checked, p.attention, p.observations.length, p.notes.length - p.issues, p.issues, p.raised.length, p.statusChanges.length, p.updates.length,
        p.incidentHours, p.visits.length, p.visitHours, hm(p.firstAt), hm(p.lastAt), personLine(p)]),
    ]
    const acts = [['Team member', 'Time', 'Until', 'Type', 'What', 'Detail'],
      ...s.people.flatMap(p => p.timeline.map(t => [p.name, hm(t.at), t.until ? hm(t.until) : t.open ? 'on site' : '', t.kind, t.title,
        [t.detail, ...(t.devices || []).map(d => `${d.device}${d.activity ? ` (${activityLabel(d.activity)})` : ''}`)].filter(Boolean).join(' · ')]))]
    const wb = XLSX.utils.book_new()
    const ws1 = XLSX.utils.aoa_to_sheet(team)
    ws1['!cols'] = [22, 30, 12, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 10, 10, 80].map(w => ({ wch: w }))
    const ws2 = XLSX.utils.aoa_to_sheet(acts)
    ws2['!cols'] = [22, 8, 8, 12, 40, 80].map(w => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws1, 'Team status')
    XLSX.utils.book_append_sheet(wb, ws2, 'Activity')
    XLSX.writeFile(wb, `${engagement.code}_daily_status_${date}.xlsx`)
  }

  return (
    <div className="gl-st">
      <div className="table-wrap" style={{ marginBottom: 12 }}>
        <div className="gl-bar">
          <div className="gl-datebar">
            <button className="btn btn-ghost btn-sm" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}><ChevronLeft size={14} /></button>
            <input type="date" className="form-input" value={date} max={today} onChange={e => e.target.value && setDate(e.target.value)} />
            <button className="btn btn-ghost btn-sm" aria-label="Next day" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}><ChevronRight size={14} /></button>
            {date !== today && <button className="btn btn-ghost btn-sm" onClick={() => setDate(today)}>Today</button>}
          </div>
          <div className="gl-st-when">{date === today ? <><span className="gl-st-live" /> Live · {dateFmt(date)}</> : dateFmt(date)}</div>
          <div className="gl-grow" />
          <button className="btn btn-ghost btn-sm" onClick={() => setTick(t => t + 1)} title="Reload"><RefreshCw size={13} /> Refresh</button>
          <button className="btn btn-ghost btn-sm" disabled={!s} onClick={copy} title="Copy as plain text (WhatsApp / email)"><Copy size={13} /> {copied ? 'Copied' : 'Copy'}</button>
          <button className="btn btn-ghost btn-sm" disabled={!s} onClick={exportXlsx}><Download size={13} /> Export</button>
        </div>
      </div>
      <DeviceFilterNote ctx={ctx} what="device checks" />
      <ErrorLine error={error} />

      {!s ? (!error && <Loader />) : <>
        <div className="gl-kpis">
          <Kpi label="Team updated" value={`${s.totals.teamUpdated}/${s.totals.team}`} accent="#6366f1"
            sub={s.totals.team ? `${Math.round(s.totals.teamUpdated * 100 / s.totals.team)}% of roster${s.totals.contributors > s.totals.teamUpdated ? ` · +${s.totals.contributors - s.totals.teamUpdated} others` : ''}` : 'No roster set'} />
          <Kpi label="On site now" value={s.totals.onSite} accent="#6366f1" sub={date === today ? 'checked in on a visit' : 'live only for today'} />
          <Kpi label="Devices checked" value={`${s.totals.checked}/${s.totals.devices}`} accent={s.totals.checked < s.totals.devices ? '#d97706' : '#059669'}
            sub={s.totals.attention ? `${s.totals.attention} need attention` : 'none need attention'} />
          <Kpi label="Site visits" value={s.totals.visits} accent="#0ea5e9" sub={s.totals.visitHours ? `${s.totals.visitHours} h on site` : 'no hours logged'} />
          <Kpi label="Incident actions" value={s.totals.incidentActions} accent="#dc2626" sub={s.totals.incidentHours ? `${s.totals.incidentHours} h logged` : 'raised, moved or updated'} />
          <Kpi label="Notes & issues" value={s.totals.notes} accent="#64748b" sub={`${s.totals.issues} issue${s.totals.issues === 1 ? '' : 's'}`} />
          <Kpi label="No update" value={s.totals.noUpdate} accent={s.totals.noUpdate ? '#d97706' : '#059669'} active={statusFilter === 'NO_UPDATE'}
            onClick={() => setStatusFilter(f => (f === 'NO_UPDATE' ? '' : 'NO_UPDATE'))} sub={s.totals.noUpdate ? 'click to list' : 'everyone reported'} />
        </div>

        <RoleCoverage roles={s.roles} onPick={id => { setStatusFilter(''); setRole(''); setQ(''); setOpen(o => ({ ...o, [id]: true })); document.getElementById(`gl-st-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }} />

        <div className="table-wrap">
          <div className="gl-bar">
            <Search value={q} onChange={setQ} placeholder="Team member or role…" />
            <div className="gl-seg">
              {STATUS_FILTERS.map(([k, l]) => <button key={k} type="button" className={statusFilter === k ? 'on' : ''} onClick={() => setStatusFilter(k)}>{l} <span className="gl-st-n">{counts[k]}</span></button>)}
            </div>
            <select className="form-select" value={role} onChange={e => setRole(e.target.value)}>
              <option value="">All roles</option>
              <option value="PM">Project manager</option>
              {s.roles.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
              <option value="OTHER">Not on roster</option>
            </select>
            <div className="gl-grow" />
            <button className="btn btn-ghost btn-sm" disabled={!rows.length} onClick={() => setOpen(allOpen ? {} : Object.fromEntries(rows.map(p => [p.id, true])))}>{allOpen ? 'Collapse all' : 'Expand all'}</button>
          </div>
          <div className="gl-tscroll" style={{ maxHeight: 'none' }}>
            <table className="gl-table gl-st-table">
              <thead>
                <tr className="gl-groups">
                  <th colSpan={2} /><th colSpan={4} className="gl-sep" style={{ textAlign: 'center' }}>Daily checks</th>
                  <th colSpan={4} className="gl-sep" style={{ textAlign: 'center' }}>Activity</th><th colSpan={2} className="gl-sep" />
                </tr>
                <tr>
                  <th style={{ minWidth: 240 }}>Team member</th><th>Status</th>
                  {SECTIONS.map((x, i) => <th key={x.key} className={`num${i === 0 ? ' gl-sep' : ''}`}>{x.label}</th>)}<th className="num">Attention</th>
                  <th className="num gl-sep">Site visits</th><th className="num">Incidents</th><th className="num">Observations</th><th className="num">Notes / issues</th>
                  <th className="gl-sep">Active</th><th style={{ width: 34 }} />
                </tr>
              </thead>
              <tbody>
                {!rows.length && <tr><td colSpan={12} className="gl-st-empty">{s.people.length ? 'No team member matches these filters.' : 'No roster and no updates on this day. Set up the Support Roster to track who is expected to report.'}</td></tr>}
                {rows.map(p => {
                  const isOpen = !!open[p.id]
                  const toggle = () => setOpen(o => ({ ...o, [p.id]: !o[p.id] }))
                  return (
                    <Fragment key={p.id}>
                      <tr id={`gl-st-${p.id}`} className={`gl-st-row${isOpen ? ' open' : ''}${p.status === 'NO_UPDATE' ? ' idle' : ''}`} onClick={toggle}>
                        <td>
                          <div className="gl-st-who">
                            <span className="gl-st-av">{initials(p.name)}</span>
                            <div style={{ minWidth: 0 }}>
                              <div className="gl-st-name">{p.name}</div>
                              <div className="gl-st-roles">{p.roles.length ? p.roles.map(r => <span key={r.key + r.backup} className="gl-tag">{r.label}{r.backup ? ' · backup' : ''}</span>) : <span className="gl-meta">Not on roster</span>}</div>
                            </div>
                          </div>
                        </td>
                        <td><StatusPill status={p.status} /></td>
                        {SECTIONS.map((x, i) => <td key={x.key} className={`num${i === 0 ? ' gl-sep' : ''}`}><Num v={p.sections[x.key]} /></td>)}
                        <td className="num">{p.attention ? <span className="gl-st-bad">{p.attention}</span> : <Num v={0} />}</td>
                        <td className="num gl-sep"><Num v={p.visits.length} />{p.visitHours > 0 && <div className="gl-meta">{p.visitHours} h</div>}</td>
                        <td className="num"><Num v={p.incidentCount} />{p.incidentHours > 0 && <div className="gl-meta">{p.incidentHours} h</div>}</td>
                        <td className="num"><Num v={p.observations.length} /></td>
                        <td className="num"><Num v={p.notes.length} />{p.issues > 0 && <div className="gl-meta" style={{ color: '#b45309' }}>{p.issues} issue{p.issues === 1 ? '' : 's'}</div>}</td>
                        <td className="gl-sep nowrap">{p.firstAt ? <>{hm(p.firstAt)}{p.lastAt !== p.firstAt && <>–{hm(p.lastAt)}</>}<div className="gl-meta">last {hm(p.lastAt)}</div></> : <span className="muted">—</span>}</td>
                        <td><ChevronDown size={15} className="gl-st-chev" /></td>
                      </tr>
                      {isOpen && (
                        <tr className="gl-st-detail"><td colSpan={12}><PersonDetail p={p} onOpenIncident={openIncident} /></td></tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </>}
    </div>
  )
}

const Num = ({ v }) => (v ? <span className="gl-st-num">{v}</span> : <span className="gl-st-zero">–</span>)

function StatusPill({ status }) {
  const st = PERSON_STATUSES[status]
  return <span className={`gl-pill ${st.tone === 'indigo' ? 'gl-st-indigo' : st.tone}`}>{st.label}</span>
}

function RoleCoverage({ roles, onPick }) {
  if (!roles.some(r => r.primary)) return null
  return (
    <div className="gl-st-roster">
      <div className="gl-st-roster-head"><Users size={14} /> Roster coverage</div>
      <div className="gl-st-roster-grid">
        {roles.map(r => {
          const p = r.primaryPerson
          const b = r.backupPerson
          const covered = (p && p.status !== 'NO_UPDATE') || (b && b.status !== 'NO_UPDATE')
          return (
            <div key={r.key} className={`gl-st-role${!r.primary ? ' unset' : covered ? '' : ' gap'}`}>
              <div className="gl-st-role-label">{r.label}</div>
              {p ? (
                <button type="button" className="gl-st-role-who" onClick={() => onPick(p.id)}>
                  <span className="gl-st-av sm">{initials(p.name)}</span>
                  <span className="gl-st-role-name">{p.name}</span>
                  <StatusPill status={p.status} />
                </button>
              ) : <div className="gl-meta" style={{ padding: '6px 0' }}>Not assigned</div>}
              {b && (
                <div className="gl-st-role-backup">
                  Backup: <button type="button" onClick={() => onPick(b.id)}>{b.name}</button>
                  {b.status !== 'NO_UPDATE' && <span style={{ color: '#047857' }}> · updated</span>}
                </div>
              )}
              {r.primary && !covered && <div className="gl-st-role-warn"><AlertTriangle size={12} /> No update from this role</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PersonDetail({ p, onOpenIncident }) {
  if (p.status === 'NO_UPDATE') {
    return <div className="gl-st-detail-empty">No checks, visits, notes or incident updates logged by {p.name} on this day.</div>
  }
  const byResult = ['ATTENTION', 'INCOMPLETE', 'HEALTHY'].map(k => [k, p.devices.filter(d => d.result === k)]).filter(([, d]) => d.length)
  const other = p.devices.filter(d => !RESULT_LABEL[d.result])
  return (
    <div className="gl-st-detail-grid">
      <section>
        <div className="gl-st-h">Activity timeline <span className="gl-st-n">{p.timeline.length}</span></div>
        <ol className="gl-st-tl">
          {p.timeline.map((t, n) => {
            const Icon = KIND_ICON[t.kind] || ClipboardCheck
            return (
              <li key={n} className={`gl-st-ev ${t.tone}`}>
                <div className="gl-st-time">{hm(t.at)}{t.until && <span>–{hm(t.until)}</span>}{t.open && <span className="gl-st-onsite">on site</span>}</div>
                <div className="gl-st-dot"><Icon size={12} /></div>
                <div className="gl-st-body">
                  <div className="gl-st-title">
                    {t.title}
                    {t.priority && <> <PriorityBadge priority={t.priority} /></>}
                    {t.incidentId && <button type="button" className="gl-st-link" onClick={() => onOpenIncident(t.incidentId)} title="Open incident"><ExternalLink size={11} /></button>}
                  </div>
                  {t.detail && <div className="gl-st-text">{t.detail}</div>}
                  {t.devices?.length > 0 && (
                    <div className="gl-st-devs">{t.devices.map((d, i) => (
                      <span key={i} className="gl-tag">{d.device}{d.activity ? ` · ${activityLabel(d.activity)}` : ''}{d.minutes ? ` · ${d.minutes} min` : ''}{d.note ? ` — ${d.note}` : ''}</span>
                    ))}</div>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </section>
      <section>
        <div className="gl-st-h">Devices checked <span className="gl-st-n">{p.devices.length}</span></div>
        {!p.devices.length ? <div className="gl-meta">No daily checks submitted.</div> : (
          <div className="gl-st-devgroups">
            {[...byResult, ...(other.length ? [['OTHER', other]] : [])].map(([k, list]) => (
              <div key={k}>
                <div className="gl-st-devgroup-h"><span className={`gl-pill ${RESULT_TONE[k] || 'gray'}`}>{RESULT_LABEL[k] || 'Not complete'}</span> <span className="gl-meta">{list.length}</span></div>
                <ul className="gl-st-devlist">
                  {list.map(d => (
                    <li key={d.id}>
                      <span className="gl-st-devname">{d.device}</span>
                      {d.site && <span className="gl-meta"> · {d.site}</span>}
                      <span className="gl-st-secs">{d.sections.map(x => <span key={x} className="gl-tag">{SECTIONS.find(s => s.key === x)?.label}</span>)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
