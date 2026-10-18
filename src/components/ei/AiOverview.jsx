import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { listMessages } from '../../lib/outlookEmail'
import { listAttachments, listExceptions, exceptionLabel } from '../../lib/emailIntelligence'
import { buildInsights } from '../../lib/eiInsights'
import { Sparkles, ArrowRight, AlertOctagon, AlertTriangle, Info, Lightbulb, Gauge, Mail, Zap, FileCheck2, UserCheck, CheckCircle2, Target } from 'lucide-react'

const SEV = { critical: ['#dc2626', AlertOctagon], high: ['#ea580c', AlertTriangle], medium: ['#6366f1', Lightbulb], low: ['#64748b', Info] }
const pctTxt = v => (v == null ? '—' : `${Math.round(v * 100)}%`)

// AI Overview: a briefing of what the automation did and where people are needed,
// computed from the real emails, documents and open items of the last 30 days.
export default function AiOverview({ categories = [], mailboxLive, onGo }) {
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    Promise.all([
      listMessages({ limit: 500 }),
      listAttachments({ limit: 500 }),
      listExceptions({ status: 'OPEN', limit: 1000 }),
      supabase.from('llm_settings').select('id').or('claude_api_key.not.is.null,deepseek_api_key.not.is.null,gemini_api_key.not.is.null').limit(1),
    ]).then(([emails, attachments, exceptions, ai]) => {
      const since = Date.now() - 30 * 86400000
      setData({ exceptions, ins: buildInsights({
        emails: emails.filter(e => new Date(e.created_at).getTime() >= since), attachments: attachments.filter(a => new Date(a.created_at).getTime() >= since), exceptions,
        context: { aiConfigured: !!ai.data?.length, mailboxLive, categoryNames: Object.fromEntries(categories.map(c => [c.code, c.name])) },
      }) })
    }).catch(e => setErr(e.message))
  }, [mailboxLive, categories])

  if (err) return <div className="olk-msg error">{err}</div>
  if (!data) return <div className="card" style={{ padding: 24 }}>Preparing the briefing…</div>
  const { ins } = data
  const t = ins.totals
  const cats = Object.fromEntries(categories.map(c => [c.code, c]))
  const go = a => (a.href ? nav(a.href) : onGo(a.tab))
  const high = data.exceptions.filter(x => ['critical', 'high'].includes(x.priority)).length
  const maxIntent = Math.max(1, ...ins.intentMix.map(x => x.count))
  const others = ins.recommendations.filter(r => r !== ins.blocker && r !== ins.quickWin)
  const docCount = ins.docMix.reduce((sum, d) => sum + d.count, 0)
  const spark = ins.series
  const flowMax = Math.max(1, ...ins.flow.map(f => f.count))
  const maxExc = Math.max(1, ...ins.exceptionMix.map(x => x.count))
  const maxDoc = Math.max(1, ...ins.docMix.map(x => x.count))

  return (
    <div className="aio">
      <section className="card aib">
        <div className="aib-top">
          <div className="aib-title"><span className="aib-icon"><Sparkles size={16} /></span><div><div className="aib-h">AI briefing</div><div className="aib-sub">Last 30 days · computed from your processed emails and documents</div></div></div>
          <div className={`aib-headline ${ins.headline.tone}`}>{ins.headline.text}</div>
        </div>

        <div className="aib-readout">
          <div className="aib-signals">
            <Signal icon={Mail} label="Volume" value={`${t.emails} emails · ${docCount} documents`} detail={`${t.processed} processed · ${t.emails - t.processed} in progress`} />
            <Signal icon={Zap} label="Automation" value={`${pctTxt(t.automationRate)} end-to-end`} detail={`${t.automatic} of ${t.processed} without a person`} bar={t.automationRate} barColor="#16a34a" />
            <Signal icon={FileCheck2} label="Invoices" value={`${t.invoicesCreated} of ${t.invoiceDocs} straight to register`} bar={t.touchless} barColor="#0ea5e9"
              detail={ins.holds.length ? <span className="aib-holds">Held: {ins.holds.map(h => <span key={h.label}>{h.label} <b>{h.count}</b></span>)}</span> : t.invoiceDocs ? 'None held' : 'No invoices yet'} />
            <Signal icon={UserCheck} label="Attention" value={`${t.openExceptions} open · ${high} high`} tone={high ? 'bad' : t.openExceptions ? 'warn' : 'good'}
              detail={t.oldestOpenHours == null ? 'Queue is empty' : `Oldest waiting ${t.oldestOpenHours >= 48 ? `${Math.floor(t.oldestOpenHours / 24)} days` : `${t.oldestOpenHours} hours`}`} onClick={() => onGo('exceptions')} />
          </div>
          <div className="aib-calls">
            {ins.blocker && <Callout kind="blocker" title="Biggest blocker" rec={ins.blocker} onGo={go} />}
            {ins.quickWin && <Callout kind="win" title="Quick win" rec={ins.quickWin} onGo={go} />}
            {!ins.blocker && <div className="aib-call win"><div className="aib-call-h"><CheckCircle2 size={13} /> All clear</div><div className="aib-call-t">No blockers right now.</div></div>}
          </div>
        </div>
        <div className="aib-sec-h" style={{ marginBottom: -6 }}>14-day trend</div>
        <div className="aib-kpis">
          <Kpi label="Emails read" value={t.emails} sub={`${spark.at(-1)?.emails || 0} today`} series={spark.map(d => d.emails)} color="#6366f1" />
          <Kpi label="Automation rate" value={pctTxt(t.automationRate)} sub={`${t.automatic} handled without a person`} series={spark.map(d => (d.emails ? d.automatic / d.emails : 0))} color="#16a34a" ring={t.automationRate} />
          <Kpi label="Touchless invoices" value={pctTxt(t.touchless)} sub={`${t.invoicesCreated} created · ${t.invoiceDocs} received`} series={spark.map(d => d.invoices)} color="#0ea5e9" ring={t.touchless} />
        </div>

        <div className="aib-split">
          <div className="aib-outcomes">
            <div className="aib-sec-h">Where every email ended up</div>
            <div className="aib-stack">{ins.outcomes.filter(o => o.count).map(o => <span key={o.label} style={{ flex: o.count, background: o.color }} title={`${o.label}: ${o.count}`} />)}{!t.emails && <span style={{ flex: 1, background: '#eef2f7' }} />}</div>
            <div className="aib-legend">{ins.outcomes.map(o => <span key={o.label} className={o.count ? '' : 'zero'}><i style={{ background: o.color }} />{o.label}<b>{o.count}</b></span>)}</div>
          </div>
          <div className="aib-flow">
            <div className="aib-sec-h">Processing flow</div>
            <div className="aib-flow-row">{ins.flow.map((f, i) => (
              <div key={f.label} className="aib-step">
                <div className="aib-step-bar"><span style={{ height: `${Math.max(6, (f.count / flowMax) * 100)}%` }} /></div>
                <b>{f.count}</b><span>{f.label}</span>{i < ins.flow.length - 1 && <em>›</em>}
              </div>))}</div>
          </div>
        </div>
      </section>

      <section className="card aio-recs">
        <div className="aio-h"><Lightbulb size={14} /> More recommended steps</div>
        {!others.length && <div className="aio-empty">Nothing else — the blocker and quick win above are the priorities.</div>}
        {others.map((r, i) => {
          const [color, Icon] = SEV[r.severity]
          return (
            <div key={i} className="aio-rec" style={{ '--sev': color }}>
              <Icon size={16} style={{ color }} />
              <div className="aio-rec-body"><div className="aio-rec-t">{r.title}</div><div className="aio-rec-d">{r.detail}</div></div>
              <button className="btn btn-ghost btn-sm" onClick={() => go(r.action)}>{r.action.label} <ArrowRight size={12} /></button>
            </div>
          )
        })}
      </section>

      <div className="aio-grid">
        <section className="card aio-panel">
          <div className="aio-h"><Gauge size={14} /> Confidence by stage</div>
          {ins.stages.map(s => (
            <div key={s.key} className="aio-bar">
              <span className="aio-bar-l">{s.key}</span>
              <span className="aio-bar-track"><span style={{ width: `${Math.round((s.value || 0) * 100)}%`, background: s.value == null ? 'transparent' : s.value >= 0.8 ? '#16a34a' : s.value >= 0.6 ? '#f59e0b' : '#dc2626' }} /></span>
              <span className="aio-bar-v">{s.value == null ? '—' : pctTxt(s.value)}<em>{s.n ? ` · ${s.n}` : ''}</em></span>
            </div>
          ))}
          <div className="aio-foot">Average confidence where each stage ran. Below the configured thresholds, items go to review.</div>
        </section>
        <section className="card aio-panel">
          <div className="aio-h">What's arriving</div>
          {!ins.intentMix.length && <div className="aio-empty">No emails yet.</div>}
          {ins.intentMix.slice(0, 7).map(x => <Bar key={x.key} label={x.label} n={x.count} max={maxIntent} color="#6366f1" />)}
        </section>
        <section className="card aio-panel">
          <div className="aio-h">Where it gets stuck</div>
          {!ins.exceptionMix.length && <div className="aio-empty">No open items.</div>}
          {ins.exceptionMix.slice(0, 7).map(x => <Bar key={x.key} label={x.key === 'CATEGORY_REVIEW' ? 'Category reviews' : exceptionLabel(x.key, cats)} n={x.count} max={maxExc} color="#f59e0b" onClick={() => onGo('exceptions')} />)}
        </section>
        <section className="card aio-panel">
          <div className="aio-h">Documents read</div>
          {!ins.docMix.length && <div className="aio-empty">No attachments yet.</div>}
          {ins.docMix.slice(0, 7).map(x => <Bar key={x.key} label={x.label} n={x.count} max={maxDoc} color="#0ea5e9" onClick={() => onGo('documents')} />)}
        </section>
      </div>
    </div>
  )
}

function Signal({ icon: Icon, label, value, detail, bar, barColor, tone, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} className={`aib-signal ${tone || ''}${onClick ? ' click' : ''}`} onClick={onClick}>
      <span className="aib-signal-ic"><Icon size={14} /></span>
      <div className="aib-signal-b">
        <div className="aib-signal-l">{label}</div>
        <div className="aib-signal-v">{value}</div>
        {bar !== undefined && <div className="aib-signal-bar"><span style={{ width: `${Math.round((bar || 0) * 100)}%`, background: barColor }} /></div>}
        <div className="aib-signal-d">{detail}</div>
      </div>
    </Tag>
  )
}
function Callout({ kind, title, rec, onGo }) {
  return (
    <div className={`aib-call ${kind}`}>
      <div className="aib-call-h">{kind === 'blocker' ? <Target size={13} /> : <Lightbulb size={13} />} {title}</div>
      <div className="aib-call-t">{rec.title}</div>
      <div className="aib-call-d">{rec.detail}</div>
      <button className="btn btn-ghost btn-sm" onClick={() => onGo(rec.action)}>{rec.action.label} <ArrowRight size={12} /></button>
    </div>
  )
}
function Sparkline({ values, color }) {
  const w = 120, h = 34, max = Math.max(1e-9, ...values)
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * w, h - 3 - (v / max) * (h - 6)])
  const line = pts.map(p => p.join(',')).join(' ')
  return (
    <svg className="aib-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polygon points={`0,${h} ${line} ${w},${h}`} fill={color} opacity=".1" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
function Kpi({ label, value, sub, series, color, ring, tone, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} className={`aib-kpi ${tone || ''}${onClick ? ' click' : ''}`} onClick={onClick}>
      <div className="aib-kpi-l">{label}</div>
      <div className="aib-kpi-row">
        <div className="aib-kpi-v">{value ?? '—'}</div>
        {ring !== undefined && <MiniRing value={ring} color={color} />}
      </div>
      <div className="aib-kpi-s">{sub}</div>
      {series && <Sparkline values={series} color={color} />}
    </Tag>
  )
}
function MiniRing({ value, color }) {
  const n = value == null ? 0 : Math.round(value * 100)
  return <span className="aib-mring" style={{ background: `conic-gradient(${color} ${n * 3.6}deg, #eef2f7 0deg)` }}><span /></span>
}
function Ring({ label, value }) {
  const n = value == null ? 0 : Math.round(value * 100)
  const color = value == null ? '#e2e8f0' : n >= 70 ? '#16a34a' : n >= 40 ? '#f59e0b' : '#dc2626'
  return (
    <div className="aio-ring">
      <div className="aio-ring-c" style={{ background: `conic-gradient(${color} ${n * 3.6}deg, #eef2f7 0deg)` }}><span>{value == null ? '—' : `${n}%`}</span></div>
      <span className="aio-ring-l">{label}</span>
    </div>
  )
}
function Bar({ label, n, max, color, onClick }) {
  return (
    <button type="button" className="aio-bar as-btn" onClick={onClick} disabled={!onClick}>
      <span className="aio-bar-l">{label}</span>
      <span className="aio-bar-track"><span style={{ width: `${Math.max(4, (n / max) * 100)}%`, background: color }} /></span>
      <span className="aio-bar-v">{n}</span>
    </button>
  )
}
