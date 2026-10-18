// Enterprise header for the Go-Live Overview: hypercare health index,
// timeline, KPI tiles with 14-day sparklines and day-on-day deltas, a ranked
// "needs attention now" list and a per-site breakdown. Pure presentation —
// OverviewTab passes the rows it already loaded.
import { dateFmt } from '../../lib/supabase'
import { addDays, computeFollowUpFlag, labelOf, PRIORITIES, istDateTime } from '../../lib/goLiveRules'
import { equipmentLabel } from '../../lib/goLive'
import { Activity, AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, ShieldAlert, Wrench, CircleDashed, ClipboardList } from 'lucide-react'

const GOOD = '#059669', WARN = '#d97706', BAD = '#dc2626', ACC = '#6366f1'
const pct = (a, b) => (b ? Math.round((a * 1000) / b) / 10 : null)
const endOfIstDay = d => new Date(new Date(`${d}T00:00:00+05:30`).getTime() + 86400000)

// One point per day: coverage, healthy %, attention, open incidents.
export function dailySeries({ checks, enrollments, incidents, from, to }) {
  const out = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const end = endOfIstDay(d)
    const live = enrollments.filter(e => !e.deleted_at && e.support_status !== 'DECOMMISSIONED'
      && (!e.enrolled_at || new Date(e.enrolled_at) < end) && (!e.unenrolled_at || new Date(e.unenrolled_at) >= end))
    const day = checks.filter(c => c.check_date === d && c.daily_result !== 'DUPLICATE')
    const ids = new Set(day.map(c => c.enrollment_id))
    const healthy = day.filter(c => c.daily_result === 'HEALTHY').length
    const openInc = incidents.filter(i => !i.deleted_at && new Date(i.reported_at) < end
      && !((i.resolved_at && new Date(i.resolved_at) < end) || (i.closed_at && new Date(i.closed_at) < end))).length
    out.push({
      date: d, devices: live.length, checked: ids.size, coverage: pct(ids.size, live.length), healthyPct: pct(healthy, day.length),
      attention: day.filter(c => c.daily_result === 'ATTENTION').length, openIncidents: openInc,
    })
  }
  return out
}

// Composite 0–100: coverage 30%, healthy share of checks 40%, incident load 30%.
export function healthIndex(k) {
  if (k.coveragePct == null && k.healthyPct == null) return null
  const inc = Math.max(0, 100 - k.criticalOpen * 25 - k.overdue * 10 - Math.max(0, k.openTickets - k.criticalOpen) * 3)
  return Math.round((k.coveragePct ?? 0) * 0.3 + (k.healthyPct ?? 0) * 0.4 + inc * 0.3)
}
const band = s => s == null ? ['No data', 'var(--ink-muted)'] : s >= 85 ? ['Stable', GOOD] : s >= 65 ? ['Watch', WARN] : ['At risk', BAD]

export function ExecHeader({ engagement, k, readiness, date, lookups, pm: pmName }) {
  const score = healthIndex(k)
  const [label, color] = band(score)
  const start = engagement.hypercare_start || engagement.go_live_date
  const end = engagement.hypercare_planned_end
  const dayN = start ? Math.max(0, Math.round((new Date(date) - new Date(start)) / 86400000) + 1) : null
  const total = start && end ? Math.max(1, Math.round((new Date(end) - new Date(start)) / 86400000) + 1) : null
  const left = total != null && dayN != null ? total - dayN : null
  const stable = readiness?.criteria?.find(c => c.key === 'stable_days')
  const met = (readiness?.criteria || []).filter(c => c.met).length
  const pm = pmName !== undefined ? pmName : lookups?.people.find(p => p.id === engagement.pm_user_id)?.full_name
  const R = 34, C = 2 * Math.PI * R

  return (
    <div className="gl-exec">
      <div className="gl-exec-score">
        <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden>
          <circle cx="44" cy="44" r={R} fill="none" stroke="#eef2f6" strokeWidth="8" />
          {score != null && <circle cx="44" cy="44" r={R} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
            strokeDasharray={`${(score / 100) * C} ${C}`} transform="rotate(-90 44 44)" />}
          <text x="44" y="50" textAnchor="middle" fontSize="22" fontWeight="800" fill="#0f172a">{score ?? '—'}</text>
        </svg>
        <div>
          <div className="gl-exec-eyebrow">Hypercare health index</div>
          <div className="gl-exec-big" style={{ color }}>{label}</div>
          <div className="gl-exec-note" title="30% check coverage + 40% healthy share of checks + 30% incident load (P1 open −25, overdue −10, other open −3)">
            Coverage, device health and incident load · {dateFmt(date)}
          </div>
        </div>
      </div>

      <div className="gl-exec-block">
        <div className="gl-exec-eyebrow"><CalendarClock size={12} /> Hypercare timeline</div>
        <div className="gl-exec-big">{dayN != null ? <>Day {dayN}{total ? <span className="gl-exec-of"> of {total}</span> : ''}</> : '—'}</div>
        {total != null && dayN != null && (
          <div className="gl-exec-track"><div style={{ width: `${Math.min(100, (dayN / total) * 100)}%`, background: left < 0 ? BAD : ACC }} /></div>
        )}
        <div className="gl-exec-note">
          {start ? dateFmt(start) : '—'} → {end ? dateFmt(end) : 'open-ended'}
          {left != null && <> · {left >= 0 ? `${left} day${left === 1 ? '' : 's'} left` : <span style={{ color: BAD }}>{-left} day{left === -1 ? '' : 's'} over plan</span>}</>}
        </div>
      </div>

      <div className="gl-exec-block">
        <div className="gl-exec-eyebrow"><CheckCircle2 size={12} /> Exit readiness</div>
        <div className="gl-exec-big">{readiness ? <>{met}<span className="gl-exec-of"> / {readiness.criteria.length} criteria</span></> : '—'}</div>
        {stable && (
          <div className="gl-exec-track"><div style={{ width: `${Math.min(100, (stable.value / Math.max(1, stable.target)) * 100)}%`, background: stable.met ? GOOD : ACC }} /></div>
        )}
        <div className="gl-exec-note">{stable ? `${stable.value} of ${stable.target} consecutive stable days` : engagement.status === 'DRAFT' ? 'Starts when hypercare is active' : 'Loading…'}</div>
      </div>

      <div className="gl-exec-block gl-exec-facts">
        <div><span>Devices</span><b>{k.activeDevices}</b></div>
        <div><span>Sites</span><b>{(engagement.sites || []).length}</b></div>
        <div><span>Open incidents</span><b style={{ color: k.criticalOpen ? BAD : undefined }}>{k.openTickets}</b></div>
        <div><span>PM</span><b title={pm}>{pm || '—'}</b></div>
      </div>
    </div>
  )
}

function Spark({ values, color, invert }) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null)
  if (pts.length < 2) return <div className="gl-spark-empty" />
  const W = 120, H = 30
  const max = Math.max(...pts.map(p => p[1])), min = Math.min(...pts.map(p => p[1]))
  const span = max - min || 1
  const x = i => (i / (values.length - 1)) * W
  const y = v => H - 3 - ((v - min) / span) * (H - 6)
  const d = pts.map(([i, v], n) => `${n ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const [li, lv] = pts[pts.length - 1]
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden data-invert={invert ? 1 : 0}>
      <path d={`${d} L${x(li)},${H} L${x(pts[0][0])},${H} Z`} fill={color} opacity=".08" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      <circle cx={x(li)} cy={y(lv)} r="2.4" fill={color} />
    </svg>
  )
}

// tiles: [{ label, value, unit, series:number[], goodUp:boolean|null, sub, accent, onClick }]
export function KpiTiles({ tiles }) {
  return (
    <div className="gl-xkpis">
      {tiles.map(t => {
        const s = t.series || []
        const cur = s[s.length - 1], prev = s[s.length - 2]
        const delta = cur != null && prev != null ? Math.round((cur - prev) * 10) / 10 : null
        const good = delta == null || delta === 0 || t.goodUp == null ? null : (delta > 0) === t.goodUp
        const Tag = t.onClick ? 'button' : 'div'
        return (
          <Tag key={t.label} type={t.onClick ? 'button' : undefined} className="gl-xkpi" onClick={t.onClick} style={{ '--gl-accent': t.accent || ACC }}>
            <div className="gl-xkpi-label">{t.label}</div>
            <div className="gl-xkpi-row">
              <span className="gl-xkpi-value">{t.value ?? '—'}{t.unit && t.value != null ? <small>{t.unit}</small> : ''}</span>
              {delta != null && (
                <span className="gl-xkpi-delta" style={{ color: good == null ? 'var(--ink-muted)' : good ? GOOD : BAD, background: good == null ? '#f1f5f9' : good ? '#ecfdf5' : '#fef2f2' }}>
                  {delta === 0 ? '— 0' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}${t.unit || ''}`}
                </span>
              )}
            </div>
            <Spark values={s} color={t.accent || ACC} />
            <div className="gl-xkpi-sub">{t.sub || ' '}</div>
          </Tag>
        )
      })}
    </div>
  )
}

// Ranked exceptions with a jump to where they're fixed.
export function AttentionPanel({ ctx, k, dayChecks, date }) {
  const { incidents, enrollments, lookups, setParams, params } = ctx
  const enrById = Object.fromEntries(enrollments.map(e => [e.id, e]))
  const person = id => lookups.people.find(p => p.id === id)?.full_name
  const go = (tab, extra = {}) => { const p = new URLSearchParams(params); p.set('tab', tab); p.delete('incident'); Object.entries(extra).forEach(([a, b]) => p.set(a, b)); setParams(p, { replace: true }) }
  const now = new Date()
  const rank = { P1_CRITICAL: 0, P2_HIGH: 1, P3_NORMAL: 2, P4_REQUEST: 3 }
  const items = []

  incidents.filter(i => !i.deleted_at && !['RESOLVED', 'CLOSED'].includes(i.status))
    .sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9))
    .forEach(i => {
      const overdue = computeFollowUpFlag(i, now) === 'OVERDUE'
      if (!overdue && !['P1_CRITICAL', 'P2_HIGH'].includes(i.priority)) return
      items.push({
        sev: i.priority === 'P1_CRITICAL' ? 0 : overdue ? 1 : 2, icon: ShieldAlert,
        title: `${i.number} · ${i.title}`,
        meta: `${labelOf(PRIORITIES, i.priority)}${overdue ? ` · overdue${i.action_due_at ? ` since ${istDateTime(i.action_due_at)}` : ''}` : ''} · ${person(i.assigned_owner_user_id) || 'Unassigned'}`,
        action: 'Open incident', onClick: () => go('incidents', { incident: i.id }),
      })
    })
  dayChecks.filter(c => c.daily_result === 'ATTENTION').forEach(c => items.push({
    sev: c.attention_severity === 'HIGH' ? 1 : 2, icon: AlertTriangle,
    title: `${equipmentLabel(enrById[c.enrollment_id])} needs attention`,
    meta: [c.attention_severity && `${c.attention_severity.toLowerCase()} severity`, (c.observation_action || '').slice(0, 90)].filter(Boolean).join(' · ') || 'Failing check',
    action: 'View check', onClick: () => go('checks'),
  }))
  k.repeatFailures.forEach(r => items.push({
    sev: 2, icon: Wrench, title: `${equipmentLabel(enrById[r.enrollment_id])} — repeat failure`,
    meta: `${r.count} attention results in the last 7 days`, action: 'View device', onClick: () => go('devices'),
  }))
  if (k.missingCount) items.push({ sev: 3, icon: CircleDashed, title: `${k.missingCount} device${k.missingCount === 1 ? '' : 's'} without a check`, meta: `For ${dateFmt(date)}`, action: 'Log checks', onClick: () => go('checks') })
  if (k.pendingReviews) items.push({ sev: 3, icon: ClipboardList, title: `${k.pendingReviews} check${k.pendingReviews === 1 ? '' : 's'} awaiting engineer review`, meta: 'Firmware / application sections not complete', action: 'Review', onClick: () => go('checks') })
  items.sort((a, b) => a.sev - b.sev)
  const sevColor = [BAD, BAD, WARN, 'var(--ink-muted)']

  return (
    <div className="card gl-attn">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="card-title"><Activity size={13} /> Needs attention now</div>
        <span className="gl-attn-count" style={{ background: items.length ? '#fef2f2' : '#ecfdf5', color: items.length ? BAD : GOOD }}>{items.length ? `${items.length} item${items.length === 1 ? '' : 's'}` : 'All clear'}</span>
      </div>
      <div className="gl-attn-list">
        {!items.length ? <div className="gl-attn-empty"><CheckCircle2 size={16} color={GOOD} /> No critical incidents, overdue actions or failing devices.</div>
          : items.slice(0, 12).map((it, n) => (
            <button key={n} type="button" className="gl-attn-row" onClick={it.onClick}>
              <span className="gl-attn-sev" style={{ background: sevColor[it.sev] }} />
              <it.icon size={14} color={sevColor[it.sev]} style={{ flexShrink: 0 }} />
              <span className="gl-attn-text"><b>{it.title}</b><small>{it.meta}</small></span>
              <span className="gl-attn-go">{it.action} <ArrowRight size={12} /></span>
            </button>
          ))}
        {items.length > 12 && <div className="gl-attn-empty">+{items.length - 12} more in Incidents and Daily Checks</div>}
      </div>
    </div>
  )
}

export function SiteBreakdown({ enrollments, dayChecks, incidents }) {
  const live = enrollments.filter(e => !e.deleted_at && !e.unenrolled_at && e.support_status !== 'DECOMMISSIONED')
  const sites = [...new Set(live.map(e => e.site || 'Unassigned'))].sort()
  const rows = sites.map(s => {
    const devs = live.filter(e => (e.site || 'Unassigned') === s)
    const ids = new Set(devs.map(e => e.id))
    const day = dayChecks.filter(c => ids.has(c.enrollment_id) && c.daily_result !== 'DUPLICATE')
    const checked = new Set(day.map(c => c.enrollment_id)).size
    const open = incidents.filter(i => !i.deleted_at && !['RESOLVED', 'CLOSED'].includes(i.status)
      && ((i.device_enrollment_ids || []).some(id => ids.has(id)) || (i.scope_type === 'SITE' && i.site === s)))
    return {
      site: s, devices: devs.length, checked,
      healthy: day.filter(c => c.daily_result === 'HEALTHY').length, attention: day.filter(c => c.daily_result === 'ATTENTION').length,
      open: open.length, critical: open.filter(i => ['P1_CRITICAL', 'P2_HIGH'].includes(i.priority)).length,
    }
  })
  return <SiteTable rows={rows} />
}

// rows: [{ site, devices, checked, healthy, attention, open, critical }] — from the
// app (SiteBreakdown) or from get_golive_report_overview().sites (shared report).
export function SiteTable({ rows: raw }) {
  const rows = raw.map(r => ({ ...r, coverage: pct(r.checked, r.devices) }))
  const status = r => r.critical || r.attention > 0 && r.attention >= r.healthy ? ['At risk', BAD, '#fef2f2'] : r.attention || r.open || (r.coverage ?? 0) < 100 ? ['Watch', WARN, '#fffbeb'] : ['Stable', GOOD, '#ecfdf5']
  return (
    <div className="card">
      <div className="card-header"><div className="card-title">Site performance</div></div>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table gl-sites" style={{ display: 'table', fontSize: 12.5 }}>
          <thead><tr><th>Site</th><th>Status</th><th>Devices</th><th style={{ minWidth: 110 }}>Checked</th><th>Healthy</th><th>Attention</th><th>Open inc.</th></tr></thead>
          <tbody>{rows.map(r => { const [l, c, bg] = status(r); return (
            <tr key={r.site}>
              <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{r.site}</td>
              <td><span className="gl-pill" style={{ color: c, background: bg }}>{l}</span></td>
              <td>{r.devices}</td>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="gl-exec-track" style={{ flex: 1, margin: 0 }}><div style={{ width: `${r.coverage ?? 0}%`, background: (r.coverage ?? 0) >= 100 ? GOOD : ACC }} /></div>
                  <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 36, textAlign: 'right' }}>{r.checked}/{r.devices}</span>
                </div>
              </td>
              <td style={{ color: GOOD, fontWeight: 600 }}>{r.healthy}</td>
              <td style={{ color: r.attention ? BAD : undefined, fontWeight: r.attention ? 700 : 400 }}>{r.attention}</td>
              <td>{r.open}{r.critical ? <span style={{ color: BAD, fontWeight: 700 }}> · {r.critical} P1/P2</span> : ''}</td>
            </tr>
          ) })}</tbody>
        </table>
        {!rows.length && <div className="card-body" style={{ color: 'var(--ink-muted)', fontSize: 13 }}>No devices enrolled yet.</div>}
      </div>
    </div>
  )
}

// Shared report: the engagement-level numbers ExecHeader / KpiTiles need,
// from get_golive_report_overview() instead of live app rows.
export function reportKpis(ov) {
  const series = ov.series || []
  const cur = series[series.length - 1] || {}
  const k = ov.incident_kpis || {}
  return {
    series, cur,
    k: {
      activeDevices: cur.devices || 0, checksLogged: cur.records || 0, healthy: cur.healthy || 0, attention: cur.attention || 0,
      incomplete: cur.incomplete || 0, missingCount: Math.max(0, (cur.devices || 0) - (cur.checked || 0)),
      coveragePct: pct(cur.checked || 0, cur.devices || 0), healthyPct: pct(cur.healthy || 0, cur.records || 0),
      openTickets: k.open || 0, criticalOpen: k.critical_open || 0, highOpen: k.high_open || 0, overdue: k.overdue || 0,
      mtta: k.mtta == null ? null : Number(k.mtta), mttr: k.mttr == null ? null : Number(k.mttr), repeat: ov.repeat_failures || 0,
    },
  }
}

// Shared report: read-only "needs attention" list built from the day's summary.
export function ReportAttention({ s }) {
  const items = []
  const seen = new Set()
  for (const i of s.incidents.open) {
    const overdue = s.incidents.overdue.some(o => o.id === i.id)
    if (!overdue && !['P1_CRITICAL', 'P2_HIGH'].includes(i.priority)) continue
    seen.add(i.id)
    items.push({ sev: i.priority === 'P1_CRITICAL' ? 0 : overdue ? 1 : 2, icon: ShieldAlert, title: `${i.number} · ${i.title}`,
      meta: [labelOf(PRIORITIES, i.priority), overdue && i.due ? `action overdue since ${istDateTime(i.due)}` : null, i.next_action && `next: ${i.next_action}`].filter(Boolean).join(' · ') })
  }
  for (const o of s.observations.filter(o => o.result === 'ATTENTION')) {
    items.push({ sev: o.severity === 'HIGH' ? 1 : 2, icon: AlertTriangle, title: `${o.device} needs attention`,
      meta: [o.failing.join(', '), o.text].filter(Boolean).join(' · ') || 'Failing check' })
  }
  if (s.stats.missing) items.push({ sev: 3, icon: CircleDashed, title: `${s.stats.missing} device${s.stats.missing === 1 ? '' : 's'} without a check`, meta: s.missingDevices.slice(0, 4).join(', ') + (s.missingDevices.length > 4 ? ` +${s.missingDevices.length - 4} more` : '') })
  items.sort((a, b) => a.sev - b.sev)
  const sevColor = [BAD, BAD, WARN, 'var(--ink-muted)']
  return (
    <div className="card gl-attn">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="card-title"><Activity size={13} /> Needs attention</div>
        <span className="gl-attn-count" style={{ background: items.length ? '#fef2f2' : '#ecfdf5', color: items.length ? BAD : GOOD }}>{items.length ? `${items.length} item${items.length === 1 ? '' : 's'}` : 'All clear'}</span>
      </div>
      <div className="gl-attn-list">
        {!items.length ? <div className="gl-attn-empty"><CheckCircle2 size={16} color={GOOD} /> No critical incidents, overdue actions or failing devices.</div>
          : items.map((it, n) => (
            <div key={n} className="gl-attn-row" style={{ cursor: 'default' }}>
              <span className="gl-attn-sev" style={{ background: sevColor[it.sev] }} />
              <it.icon size={14} color={sevColor[it.sev]} style={{ flexShrink: 0 }} />
              <span className="gl-attn-text"><b>{it.title}</b><small>{it.meta}</small></span>
            </div>
          ))}
      </div>
    </div>
  )
}
