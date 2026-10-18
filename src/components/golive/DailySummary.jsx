import { useState, useEffect, useMemo } from 'react'
import { loadDayActivity, deviceLabel, sendReportEmail } from '../../lib/goLive'
import { buildDailySummary, summaryText } from '../../lib/goLiveDailySummary'
import { istDateTime, istToday, labelOf, CATEGORIES, INCIDENT_STATUSES } from '../../lib/goLiveRules'
import { generateStructured } from '../../lib/llm'
import { dateFmt } from '../../lib/supabase'
import { Loader } from '../ui'
import { PriorityBadge, Chip, errText } from './shared'
import { FileText, Copy, Sparkles, ChevronDown, ChevronRight, Mail, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react'

const RESULT_TONE = { ATTENTION: 'red', INCOMPLETE: 'amber', HEALTHY: 'green' }
const GOOD = '#059669', WARN = '#d97706', BAD = '#dc2626'
const hm = ts => istDateTime(ts).split(', ').pop()

const AI_SYSTEM = `You are a hypercare (go-live support) lead writing the end-of-day summary for an IoT device rollout.
You get the day's raw data: daily-check results and observations, device notes/issues, and incident activity.
Reply with JSON only: {"headline": string, "summary": string, "risks": string[], "actions": string[]}.
- headline: one sentence on the overall state of the day.
- summary: 3-6 sentences in plain English covering device health, the main observations and incident movement. Group repeated problems (same site, same failing check) instead of listing every device.
- risks: up to 5 open concerns (critical/overdue incidents, repeat failures, missing checks).
- actions: up to 5 concrete next steps for tomorrow, naming the incident number or device where possible.
Use only facts in the data; do not invent devices, numbers or people.`

// Overview: everything that happened on the review date — check observations,
// device notes / issues and incidents — with a copyable digest and an optional AI write-up.
export default function DailySummary({ ctx, date, checks }) {
  const { engagement, enrollments, incidents, lookups, profile } = ctx
  const [activity, setActivity] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(true)
  const [ai, setAi] = useState(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [mailMsg, setMailMsg] = useState('')
  const [mailBusy, setMailBusy] = useState(false)
  const incidentIds = incidents.map(i => i.id).join()

  useEffect(() => {
    setActivity(null); setAi(null); setError('')
    loadDayActivity(engagement.id, incidents.map(i => i.id), date).then(setActivity).catch(e => setError(errText(e)))
  }, [engagement.id, date, incidentIds])

  const person = id => lookups.people.find(p => p.id === id)?.full_name || ''
  const s = useMemo(() => activity && buildDailySummary({ date, checks, enrollments, incidents, ...activity, person, deviceLabel }),
    [activity, checks, enrollments, incidents, date])
  const text = useMemo(() => s && summaryText(s, engagement.name || engagement.code), [s, engagement])

  async function copy() {
    const full = ai ? `${ai.headline}\n\n${ai.summary}\n\n${text}` : text
    try { await navigator.clipboard.writeText(full); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { setError('Copy failed — your browser blocked clipboard access') }
  }

  async function email(onlyMe) {
    setMailBusy(true); setError(''); setMailMsg('')
    try {
      const n = await sendReportEmail(engagement.id, date, onlyMe ? 'ME' : 'ALL')
      setMailMsg(onlyMe ? 'Full report emailed to you — arrives within a minute' : `Full report queued for ${n} recipient${n === 1 ? '' : 's'}`)
    } catch (e) { setError(`Email failed: ${errText(e)}`) }
    setMailBusy(false)
  }

  async function generate() {
    setAiBusy(true); setError('')
    try {
      const r = await generateStructured(AI_SYSTEM, text, 'deepseek-v3', '', profile?.id, 'golive_daily_summary', 1200)
      setAi({ headline: r.headline || '', summary: r.summary || '', risks: r.risks || [], actions: r.actions || [] })
    } catch (e) { setError(`AI summary failed: ${errText(e)}`) }
    setAiBusy(false)
  }

  const openInc = id => { const p = new URLSearchParams(ctx.params); p.set('tab', 'incidents'); p.set('incident', id); ctx.setParams(p, { replace: true }) }
  const isToday = date === istToday()
  return (
    <div className="card gl-ds" style={{ marginBottom: 14 }}>
      <div className="gl-ds-head">
        <button type="button" className="gl-ds-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <FileText size={15} color="var(--c1)" />
          <span>
            <span className="gl-ds-title">Daily summary</span>
            <span className="gl-ds-date">{isToday ? `Today · ${dateFmt(date)} · live, updates as checks come in` : dateFmt(date)}</span>
          </span>
        </button>
        {s && (
          <div className="gl-ds-actions">
            <button className="btn btn-ghost btn-sm" onClick={copy} title="Copy as plain text (WhatsApp / email)"><Copy size={12} /> {copied ? 'Copied' : 'Copy'}</button>
            <button className="btn btn-ghost btn-sm" disabled={mailBusy} onClick={() => email(true)} title="Email this day's complete report (overview + summary) to yourself"><Mail size={12} /> Email me</button>
            {ctx.perms?.canManage && <button className="btn btn-ghost btn-sm" disabled={mailBusy} onClick={() => email(false)} title="Email this day's complete report to the list saved in Share Report → Report email"><Mail size={12} /> Email report list</button>}
            <button className="btn btn-primary btn-sm" disabled={aiBusy} onClick={generate}><Sparkles size={12} /> {aiBusy ? 'Summarising…' : ai ? 'Regenerate' : 'AI summary'}</button>
          </div>
        )}
      </div>

      {open && (
        <div className="gl-ds-body">
          {error && <div className="gl-ds-msg" style={{ color: BAD, background: '#fef2f2' }}>{error}</div>}
          {mailMsg && <div className="gl-ds-msg" style={{ color: '#047857', background: '#ecfdf5' }}>{mailMsg}</div>}
          {!s ? (!error && <Loader />) : <>
            {ai && (
              <div className="gl-ds-ai">
                <div className="gl-ds-label"><Sparkles size={12} /> AI summary</div>
                <div style={{ fontWeight: 700, margin: '4px 0' }}>{ai.headline}</div>
                <div style={{ whiteSpace: 'pre-wrap', color: 'var(--ink-soft)' }}>{ai.summary}</div>
                {(ai.risks.length > 0 || ai.actions.length > 0) && (
                  <div className="gl-ds-cols">
                    {ai.risks.length > 0 && <div><div className="gl-ds-label" style={{ color: BAD }}>Risks</div><ul>{ai.risks.map((r, n) => <li key={n}>{r}</li>)}</ul></div>}
                    {ai.actions.length > 0 && <div><div className="gl-ds-label" style={{ color: 'var(--c1)' }}>Next actions</div><ul>{ai.actions.map((r, n) => <li key={n}>{r}</li>)}</ul></div>}
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 6 }}>AI-generated from the data below — check before sharing.</div>
              </div>
            )}

            <DailySummaryBody s={s} date={date} onOpenIncident={openInc} />
          </>}
        </div>
      )}
    </div>
  )
}

// Verdict, stats and the detail tables — shared by the Overview card and the
// public shared report (PublicGoLiveReportPage). onOpenIncident is optional:
// without it incident rows aren't clickable; owner / "by" columns are hidden
// when the data carries no names (customer view).
export function DailySummaryBody({ s, date, onOpenIncident }) {
  const [incTab, setIncTab] = useState('raised')
  const isToday = date === istToday()
  // One-line verdict, same rules as the email
  const flags = !s ? [] : [
    s.stats.attention && `${s.stats.attention} device${s.stats.attention === 1 ? ' needs' : 's need'} attention`,
    s.stats.missing && `${s.stats.missing} not checked${isToday ? ' yet' : ''}`,
    s.incidents.criticalOpen && `${s.incidents.criticalOpen} P1/P2 incident${s.incidents.criticalOpen === 1 ? '' : 's'} open`,
    s.incidents.overdue.length && `${s.incidents.overdue.length} overdue action${s.incidents.overdue.length === 1 ? '' : 's'}`,
  ].filter(Boolean)

  const incActivity = !s ? [] : [...s.incidents.statusChanges.map(c => ({ ...c, kind: 'status' })), ...s.incidents.updates.map(u => ({ ...u, kind: 'update' }))]
    .sort((a, b) => new Date(a.at) - new Date(b.at))
  const incTabs = !s ? [] : [
    { key: 'raised', label: 'Raised', n: s.incidents.raised.length },
    { key: 'resolved', label: 'Resolved / closed', n: s.incidents.resolved.length },
    { key: 'activity', label: 'Activity', n: incActivity.length },
    { key: 'overdue', label: 'Overdue', n: s.incidents.overdue.length, bad: true },
    { key: 'open', label: 'All open', n: s.incidents.open.length },
  ]

  return (
    <>
    <div className="gl-ds-verdict" style={{ borderColor: flags.length ? BAD : GOOD, background: flags.length ? '#fef2f2' : '#f0fdf4' }}>
      {flags.length ? <AlertTriangle size={16} color={BAD} /> : <CheckCircle2 size={16} color={GOOD} />}
      <span>{flags.length ? flags.join(' · ') : 'All checked devices healthy, no open critical incidents.'}</span>
    </div>

    <div className="gl-ds-stats">
      <Stat label="Checked" value={`${s.stats.checked}/${s.stats.devices}`} sub={s.stats.coveragePct != null ? `${s.stats.coveragePct}% coverage` : '—'} />
      <Stat label="Healthy" value={s.stats.healthy} color={GOOD} />
      <Stat label="Attention" value={s.stats.attention} color={s.stats.attention ? BAD : undefined} sub={s.stats.incomplete ? `${s.stats.incomplete} incomplete` : null} />
      <Stat label="Not checked" value={s.stats.missing} color={s.stats.missing ? WARN : undefined} sub={s.stats.maintenance ? `${s.stats.maintenance} in maintenance` : null} />
      <Stat label="Incidents raised" value={s.incidents.raised.length} sub={`${s.incidents.resolved.length} resolved / closed`} />
      <Stat label="Open incidents" value={s.incidents.open.length} color={s.incidents.criticalOpen ? BAD : undefined} sub={s.incidents.criticalOpen ? `${s.incidents.criticalOpen} P1/P2` : 'none critical'} />
      <Stat label="Device issues" value={s.notesToday.filter(n => n.isIssue).length} sub={`logged · ${s.openIssues} open`} />
    </div>

    <Block title="Observations from daily checks" count={s.observations.length}>
      {!s.observations.length ? <Empty text="No observations or failing checks recorded." /> : (
        <div className="gl-ds-table"><table className="gl-table">
          <thead><tr><th>Equipment / device</th><th>Site</th><th>Result</th><th>Failing</th><th>Observation / action</th></tr></thead>
          <tbody>{s.observations.map((o, n) => (
            <tr key={n}>
              <td className="gl-ds-strong">{o.device}</td>
              <td>{o.site || '—'}</td>
              <td><Chip tone={RESULT_TONE[o.result] || 'gray'}>{labelOfResult(o.result)}{o.severity && o.result === 'ATTENTION' ? ` · ${o.severity.toLowerCase()}` : ''}</Chip>{o.maintenance && <> <Chip>Maintenance</Chip></>}</td>
              <td style={{ color: o.failing.length ? BAD : 'var(--ink-muted)' }}>{o.failing.join(', ') || '—'}</td>
              <td className="gl-ds-wrap">{o.text || <span style={{ color: 'var(--ink-muted)' }}>—</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Block>

    <Block title="Incidents" count={new Set([...s.incidents.raised, ...s.incidents.resolved, ...incActivity].map(x => x.number)).size}
      extra={<div className="gl-seg">{incTabs.map(t => (
        <button key={t.key} type="button" className={incTab === t.key ? 'on' : ''} onClick={() => setIncTab(t.key)}>
          {t.label} <span className="gl-ds-n" style={t.bad && t.n ? { background: '#fef2f2', color: BAD } : null}>{t.n}</span>
        </button>
      ))}</div>}>
      {incTab === 'activity' ? (
        !incActivity.length ? <Empty text="No incident status changes or updates on this day." /> : (
          <div className="gl-ds-table"><table className="gl-table">
            <thead><tr><th style={{ width: 70 }}>Time</th><th style={{ width: 110 }}>Incident</th><th>What happened</th><th style={{ width: 160 }}>By</th></tr></thead>
            <tbody>{incActivity.map((a, n) => (
              <tr key={n}>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{hm(a.at)}</td>
                <td className="gl-ds-strong">{a.number}</td>
                <td className="gl-ds-wrap">{a.kind === 'status'
                  ? <><span style={{ color: 'var(--ink-muted)', textDecoration: 'line-through' }}>{a.from}</span> → <b>{a.to}</b></>
                  : <>{a.body}{a.hours ? <span style={{ color: 'var(--ink-muted)' }}> · {a.hours}h</span> : ''}</>}</td>
                <td>{a.by || 'System'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )
      ) : (
        <IncidentTable rows={s.incidents[incTab] || []} kind={incTab} onOpen={onOpenIncident} />
      )}
    </Block>

    <Block title="Device notes & issues" count={s.notesToday.length} sub={`${s.issuesResolvedToday} resolved on this day · ${s.openIssues} open overall`}>
      {!s.notesToday.length ? <Empty text="No device notes or issues logged." /> : (
        <div className="gl-ds-table"><table className="gl-table">
          <thead><tr><th>Equipment / device</th><th style={{ width: 170 }}>Type</th><th>Note</th>{s.notesToday.some(x => x.by) && <th style={{ width: 150 }}>By</th>}</tr></thead>
          <tbody>{s.notesToday.map((x, n) => (
            <tr key={n}>
              <td className="gl-ds-strong">{x.device}</td>
              <td>{x.isIssue
                ? <Chip tone={x.status === 'RESOLVED' ? 'green' : x.severity === 'HIGH' ? 'red' : 'amber'}>Issue{x.severity ? ` · ${x.severity.toLowerCase()}` : ''}{x.status === 'RESOLVED' ? ' · resolved' : ''}</Chip>
                : <Chip>Note</Chip>}{x.category && <div className="gl-ds-sub">{labelOf(CATEGORIES, x.category)}</div>}</td>
              <td className="gl-ds-wrap">{x.body}</td>
              {s.notesToday.some(y => y.by) && <td>{x.by || '—'}</td>}
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Block>

    {s.missingDevices.length > 0 && (
      <Block title={isToday ? 'Not checked yet' : 'No check logged'} count={s.missingDevices.length} defaultOpen={s.missingDevices.length <= 12}>
        <div className="gl-ds-chips">{s.missingDevices.map(m => <span key={m} className="gl-ds-chip">{m}</span>)}</div>
      </Block>
    )}
    </>
  )
}

const labelOfResult = r => ({ ATTENTION: 'Attention', INCOMPLETE: 'Incomplete', HEALTHY: 'Healthy' }[r] || r || '—')

const Stat = ({ label, value, sub, color }) => (
  <div className="gl-ds-stat">
    <div className="gl-ds-label">{label}</div>
    <div className="gl-ds-val" style={color ? { color } : null}>{value}</div>
    {sub && <div className="gl-ds-sub">{sub}</div>}
  </div>
)

const Empty = ({ text }) => <div className="gl-ds-empty">{text}</div>

const INC_EMPTY = { raised: 'No incidents raised on this day.', resolved: 'Nothing resolved or closed on this day.', overdue: 'No overdue actions.', open: 'No open incidents.' }

function IncidentTable({ rows, kind, onOpen }) {
  if (!rows.length) return <Empty text={INC_EMPTY[kind]} />
  const now = new Date()
  const owners = rows.some(r => r.owner)
  return (
    <div className="gl-ds-table"><table className="gl-table">
      <thead><tr><th style={{ width: 110 }}>Incident</th><th style={{ width: 100 }}>Priority</th><th>Title &amp; devices</th><th>{kind === 'resolved' ? 'Resolution' : kind === 'raised' ? 'Status' : 'Next action / due'}</th>{owners && <th style={{ width: 150 }}>Owner</th>}{onOpen && <th style={{ width: 30 }} />}</tr></thead>
      <tbody>{rows.map(i => (
        <tr key={i.id} className={onOpen ? 'gl-ds-click' : undefined} onClick={onOpen ? () => onOpen(i.id) : undefined} title={onOpen ? 'Open incident' : undefined}>
          <td className="gl-ds-strong">{i.number}</td>
          <td><PriorityBadge priority={i.priority} /></td>
          <td className="gl-ds-wrap"><div style={{ fontWeight: 600 }}>{i.title}</div><div className="gl-ds-sub">{i.devices.join(', ') || (i.scope === 'SITE' ? `Site · ${i.site || '—'}` : i.scope === 'PLATFORM' ? 'Platform' : '—')}</div></td>
          <td className="gl-ds-wrap">{kind === 'resolved' ? (i.resolution || '—')
            : kind === 'raised' ? <>{labelOf(INCIDENT_STATUSES, i.status)}<div className="gl-ds-sub">{labelOf(CATEGORIES, i.category)} · reported {hm(i.reported_at)}</div></>
            : <>{i.next_action || '—'}{i.due && <div className="gl-ds-sub" style={{ color: new Date(i.due) < now ? BAD : undefined }}>due {istDateTime(i.due)}</div>}</>}</td>
          {owners && <td>{i.owner || '—'}</td>}
          {onOpen && <td><ExternalLink size={12} color="var(--ink-muted)" /></td>}
        </tr>
      ))}</tbody>
    </table></div>
  )
}

function Block({ title, count, sub, extra, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="gl-ds-block">
      <div className="gl-ds-bhead">
        <button type="button" className="gl-ds-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="gl-ds-btitle">{title}</span><span className="gl-ds-n">{count}</span>
          {sub && <span className="gl-ds-sub" style={{ marginLeft: 6 }}>{sub}</span>}
        </button>
        {open && extra}
      </div>
      {open && children}
    </section>
  )
}
