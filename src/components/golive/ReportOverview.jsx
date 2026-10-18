import { useState, useEffect, useMemo } from 'react'
import { getPublicReportOverview } from '../../lib/goLiveHours'
import { fromPayload } from '../../lib/goLiveDailySummary'
import { addDays, istToday } from '../../lib/goLiveRules'
import { dateFmt } from '../../lib/supabase'
import { ExecHeader, KpiTiles, SiteTable, ReportAttention, reportKpis } from './ExecutiveOverview'
import { DailySummaryBody } from './DailySummary'
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react'

const fmtMins = m => (m == null ? '—' : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${(m / 60).toFixed(1)}h` : `${(m / 1440).toFixed(1)}d`)

// Public shared report (/golive-report/:token): the 'overview' and 'daily'
// sections — the same executive overview and daily summary as the app's
// Overview tab, served by get_golive_report_overview() (STEP255). The viewer
// can step through the days of the report period.
export default function ReportOverview({ token, showOverview, showDaily }) {
  const [date, setDate] = useState(null)
  const [ov, setOv] = useState(undefined)
  const [err, setErr] = useState('')

  useEffect(() => {
    let live = true
    setErr('')
    getPublicReportOverview(token, date).then(v => { if (live) setOv(v) }).catch(e => { if (live) { setErr(e.message); setOv(null) } })
    return () => { live = false }
  }, [token, date])

  const s = useMemo(() => ov?.summary && fromPayload(ov.summary), [ov])
  const n = useMemo(() => ov && reportKpis(ov), [ov])

  if (ov === undefined) return <section className="card" style={{ padding: 24, marginBottom: 16, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></section>
  // Older databases (STEP255 not run) simply don't show these sections.
  if (!ov || !s) return err && /does not exist|schema cache/i.test(err) ? null : err ? <section className="card" style={{ padding: 16, marginBottom: 16, color: '#b91c1c', fontSize: 13 }}>{err}</section> : null

  const cur = ov.date
  const { from, to } = ov.period
  const series = n.series
  const k = n.k
  const step = d => { const v = addDays(cur, d); if (v >= from && v <= to) setDate(v) }

  return (
    <>
      {showOverview && (
        <section style={{ marginBottom: 16, breakInside: 'avoid' }}>
          <div className="gl-ro-title">Executive overview <span>as of {dateFmt(cur)}</span></div>
          <ExecHeader engagement={{ ...ov.engagement, pm_user_id: null }} k={k} readiness={ov.readiness?.criteria ? ov.readiness : null} date={cur} pm={ov.engagement?.pm ?? null} />
          <KpiTiles tiles={[
            { label: 'Check coverage', value: k.coveragePct, unit: '%', series: series.map(d => (d.devices ? Math.round((d.checked * 1000) / d.devices) / 10 : null)), goodUp: true, sub: `${k.checksLogged} checks · ${k.activeDevices} active devices`, accent: '#0891b2' },
            { label: 'Healthy rate', value: k.healthyPct, unit: '%', series: series.map(d => (d.records ? Math.round((d.healthy * 1000) / d.records) / 10 : null)), goodUp: true, sub: `${k.healthy} healthy of ${k.checksLogged} checked`, accent: '#059669' },
            { label: 'Needing attention', value: k.attention, series: series.map(d => d.attention), goodUp: false, sub: `${k.incomplete} incomplete`, accent: '#dc2626' },
            { label: 'Not checked', value: k.missingCount, series: series.map(d => Math.max(0, d.devices - d.checked)), goodUp: false, sub: 'Active devices with no check', accent: '#d97706' },
            { label: 'Open incidents', value: k.openTickets, series: series.map(d => d.open_incidents), goodUp: false, sub: `${k.highOpen} P1/P2`, accent: '#6366f1' },
            { label: 'Overdue actions', value: k.overdue, sub: 'Incident next actions past due', accent: k.overdue ? '#dc2626' : '#94a3b8' },
            { label: 'Mean time to resolve', value: k.mttr == null ? null : fmtMins(k.mttr), sub: `MTTA ${fmtMins(k.mtta)} · all priorities`, accent: '#7c3aed' },
            { label: 'Repeat-failure devices', value: k.repeat, sub: '3+ attention results in 7 days', accent: k.repeat ? '#dc2626' : '#94a3b8' },
          ]} />
          <div className="gl-exec-grid">
            <SiteTable rows={ov.sites || []} />
            <ReportAttention s={s} />
          </div>
        </section>
      )}

      {showDaily && (
        <section className="card gl-ds" style={{ marginBottom: 16 }}>
          <div className="gl-ds-head">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <FileText size={15} color="var(--c1)" />
              <span>
                <span className="gl-ds-title">Daily summary</span>
                <span className="gl-ds-date">{cur === istToday() ? `Today · ${dateFmt(cur)} · live` : dateFmt(cur)}</span>
              </span>
            </span>
            <div className="gl-ds-actions no-print">
              <button className="btn btn-ghost btn-sm" disabled={cur <= from} onClick={() => step(-1)} aria-label="Previous day"><ChevronLeft size={13} /> Previous day</button>
              <input type="date" className="form-input" style={{ width: 150, height: 32, fontSize: 12.5 }} min={from} max={to} value={cur} onChange={e => e.target.value && setDate(e.target.value)} aria-label="Report day" />
              <button className="btn btn-ghost btn-sm" disabled={cur >= to} onClick={() => step(1)} aria-label="Next day">Next day <ChevronRight size={13} /></button>
            </div>
          </div>
          <div className="gl-ds-body">
            <DailySummaryBody s={s} date={cur} />
          </div>
        </section>
      )}
    </>
  )
}
