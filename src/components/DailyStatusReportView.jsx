import { useState } from 'react'
import { dateFmt } from '../lib/supabase'
import { StatCard } from './ui'
import { ArrowRightLeft, CalendarClock, CheckCircle2, AlertTriangle, Users, Gauge, Timer, ChevronRight } from 'lucide-react'

// The single rendering of a computed Daily Status report — shared verbatim
// by the authenticated page (DailyStatusPage.jsx) and the external/public
// link (PublicDailyStatusPage.jsx) so "what I'm seeing internally" and
// "what the external link shows" can never quietly drift apart into two
// different UIs. Only the surrounding page chrome (header, period/date
// controls, export/share buttons, auth) differs between the two callers.

const SOURCE_COLOR = { Task: '#6366f1', 'IT Helpdesk': '#f59e0b', 'Support Desk': '#0ea5e9' }
export const SourceTag = ({ source }) => (
  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: `${SOURCE_COLOR[source]}18`, color: SOURCE_COLOR[source] }}>{source}</span>
)

// Green >= 80%, amber 50-79%, red < 50% — same 3-band read at a glance
// whether it's a completion rate or an on-time rate.
export function rateColor(pct) {
  if (pct == null) return '#94a3b8'
  if (pct >= 80) return '#15803d'
  if (pct >= 50) return '#b45309'
  return '#dc2626'
}
function RateBadge({ pct }) {
  if (pct == null) return <span style={{ color: '#94a3b8' }}>—</span>
  return <span style={{ fontWeight: 700, color: rateColor(pct) }}>{pct}%</span>
}

function ReportSection({ title, icon, desc, accent = 'var(--c1)', children }) {
  return (
    <div className="card" style={{ padding: 16, marginBottom: 16, borderWidth: 1, borderRadius: 10, boxShadow: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14, marginBottom: 2, color: 'var(--text)' }}>
        <span style={{ color: accent === '#dc2626' ? accent : '#94a3b8', display: 'inline-flex' }}>{icon}</span>{title}
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>{desc}</div>
      {children}
    </div>
  )
}

function EmptyRow({ text }) {
  return <div style={{ fontSize: 12, color: '#94a3b8', padding: '10px 0' }}>{text}</div>
}

function DataTable({ cols, rows }) {
  return (
    <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr>{cols.map(c => <th key={c} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, textTransform: 'uppercase', color: '#94a3b8', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, background: '#fff' }}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>{row.map((cell, j) => <td key={j} style={{ padding: '7px 8px', borderBottom: '1px solid #f1f5f9' }}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Deterministic avatar color per name — a fixed hue set indexed by a hash
// of the name, not random, so a person's color stays stable across reloads.
const AVATAR_PALETTE = ['#6366f1', '#0ea5e9', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#14b8a6', '#f43f5e', '#0891b2', '#d946ef']
function avatarColor(name) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length]
}
function initialsOf(name) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

// Workload read at a glance — green under 4 open items, amber 4-7, red 8+.
// Purely a visibility signal (nothing is blocked), so a manager scanning
// the grid immediately sees who's stacked vs who has headroom.
function workloadTier(count) {
  if (count >= 8) return { label: 'Heavy load', color: '#dc2626', bg: '#fee2e2' }
  if (count >= 4) return { label: 'Busy', color: '#b45309', bg: '#fef3c7' }
  if (count > 0) return { label: 'Active', color: '#15803d', bg: '#dcfce7' }
  return { label: 'No active work', color: '#64748b', bg: '#f1f5f9' }
}

function ItemLine({ it }) {
  return (
    <div style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', padding: '3px 0' }}>
      <SourceTag source={it.source} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{it.title}</span>
      {it.status && <span style={{ color: '#94a3b8', fontSize: 11, flexShrink: 0 }}>{it.status}</span>}
      {it.dueDate && <span style={{ color: '#94a3b8', fontSize: 11, flexShrink: 0 }}>due {dateFmt(it.dueDate)}</span>}
      {it.completedAt && <span style={{ color: '#15803d', fontSize: 11, flexShrink: 0 }}>done {dateFmt(it.completedAt)}</span>}
    </div>
  )
}

// "In Progress" is the point of the card design — always visible on the
// card face, capped with a "+N more" toggle rather than hidden behind a
// click, since the point is showing at a glance what someone is doing
// right now. Planned/Completed stay collapsed (secondary detail).
function CurrentWork({ items }) {
  const [showAll, setShowAll] = useState(false)
  const CAP = 4
  if (items.length === 0) {
    return <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic', padding: '6px 0' }}>Nothing currently in progress.</div>
  }
  const visible = showAll ? items : items.slice(0, CAP)
  return (
    <div>
      {visible.map(it => <ItemLine key={it.id} it={it} />)}
      {items.length > CAP && (
        <button type="button" onClick={() => setShowAll(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c1)', fontSize: 11, fontWeight: 700, padding: '4px 0 0' }}>
          {showAll ? 'Show less' : `+${items.length - CAP} more`}
        </button>
      )}
    </div>
  )
}

function CollapsibleList({ title, items }) {
  const [open, setOpen] = useState(false)
  if (items.length === 0) return null
  return (
    <div style={{ marginTop: 8, borderTop: '1px solid #f1f5f9', paddingTop: 6 }}>
      <button type="button" onClick={() => setOpen(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
        <ChevronRight size={11} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .1s' }} /> {title} ({items.length})
      </button>
      {open && <div style={{ marginTop: 4 }}>{items.map(it => <ItemLine key={it.id} it={it} />)}</div>}
    </div>
  )
}

function ResourceCard({ r }) {
  const tier = workloadTier(r.inProgress)
  const color = avatarColor(r.name)
  return (
    <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, borderTop: `3px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 800, flexShrink: 0 }}>
          {initialsOf(r.name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
          <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', padding: '1px 7px', borderRadius: 999, background: tier.bg, color: tier.color }}>{tier.label}</span>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#334155', textTransform: 'uppercase', marginBottom: 4 }}>Currently Working On</div>
        <CurrentWork items={r.inProgressItems} />
      </div>

      <CollapsibleList title="Planned" items={r.plannedItems} />
      <CollapsibleList title="Completed" items={r.completedItems} />

      <div style={{ display: 'flex', gap: 10, borderTop: '1px solid #f1f5f9', paddingTop: 8, marginTop: 2 }}>
        {[['In Progress', r.inProgress], ['Completed', r.completed], ['Task Hrs', r.hoursLogged], ['Total Hrs', r.totalHoursLogged]].map(([l, v]) => (
          <div key={l} style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>{v}</div>
            <div style={{ fontSize: 8.5, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ResourceGrid({ rows }) {
  const activeCount = rows.filter(r => r.inProgress > 0).length
  return (
    <div>
      <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 12 }}>
        {activeCount} of {rows.length} resources have active work right now · {rows.length - activeCount} idle
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {rows.map(r => <ResourceCard key={r.name} r={r} />)}
      </div>
    </div>
  )
}

export default function DailyStatusReportView({ report }) {
  return (
    <>
      <div className="stats-grid" style={{ marginBottom: 12 }}>
        <StatCard label="Moved" value={report.totals.moved} icon={<ArrowRightLeft size={17} />} accent="#6366f1" />
        <StatCard label="Planned (Due This Period)" value={report.totals.planned} icon={<CalendarClock size={17} />} accent="#f59e0b" />
        <StatCard label="Completed" value={report.totals.completed} icon={<CheckCircle2 size={17} />} accent="#15803d" />
        <StatCard label="Overdue" value={report.totals.overdue} icon={<AlertTriangle size={17} />} accent="#dc2626" />
      </div>
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <StatCard label="Completion Rate" value={report.totals.completionRate != null ? `${report.totals.completionRate}%` : '—'} icon={<Gauge size={17} />} accent={rateColor(report.totals.completionRate)} />
        <StatCard label="On-Time Rate" value={report.totals.onTimeRate != null ? `${report.totals.onTimeRate}%` : '—'} icon={<Timer size={17} />} accent={rateColor(report.totals.onTimeRate)} />
        <StatCard label="Hours Logged (Period)" value={report.totals.hoursLogged} icon={<Users size={17} />} accent="#0ea5e9" />
      </div>

      <ReportSection title="By Resource" icon={<Users size={14} />} desc="Current open-item count (snapshot) vs completed, task-linked hours (work_logs), and total logged hours (time_logs check-in/checkout) — all period-scoped. Cards show what each person is currently working on.">
        {report.byResource.length === 0 ? <EmptyRow text="No activity to summarize." /> : <ResourceGrid rows={report.byResource} />}
      </ReportSection>

      <ReportSection title="Department Efficiency" icon={<Gauge size={14} />} desc="Tasks only (tickets carry no department). Completion Rate = completed ÷ (completed + currently open). On-Time Rate = of what was completed this period, the share finished on or before its own due date — the real pace signal, not just volume.">
        {report.byDepartment.length === 0 ? <EmptyRow text="No department activity to summarize." /> : (
          <DataTable cols={['Department', 'Open', 'Completed', 'Overdue', 'Completion Rate', 'On-Time Rate', 'Hours Logged']} rows={report.byDepartment.map(d => [
            d.name, d.open, d.completed,
            d.overdue > 0 ? <span style={{ color: '#dc2626', fontWeight: 700 }}>{d.overdue}</span> : 0,
            <RateBadge pct={d.completionRate} />, <RateBadge pct={d.onTimeRate} />, d.hoursLogged,
          ])} />
        )}
      </ReportSection>

      <ReportSection title="Moved" icon={<ArrowRightLeft size={14} />} desc="Every status change within the selected period, newest first.">
        {report.moved.length === 0 ? <EmptyRow text="Nothing moved in this period." /> : (
          <DataTable cols={['Source', 'Item', 'Change', 'Resource', 'When']} rows={report.moved.map(m => [
            <SourceTag source={m.source} />, m.title, m.from ? `${m.from} → ${m.to}` : m.to, m.resource, dateFmt(m.changedAt),
          ])} />
        )}
      </ReportSection>

      <ReportSection title="Planned — Due This Period, Still Open" icon={<CalendarClock size={14} />} desc="Due date falls inside the selected period and the item hasn't reached a closed status yet.">
        {report.planned.length === 0 ? <EmptyRow text="Nothing due and open in this period." /> : (
          <DataTable cols={['Source', 'Item', 'Status', 'Due', 'Resource']} rows={report.planned.map(p => [
            <SourceTag source={p.source} />, p.title, p.status, dateFmt(p.dueDate), p.resource,
          ])} />
        )}
      </ReportSection>

      <ReportSection title="Completed" icon={<CheckCircle2 size={14} />} desc="Reached a closed status within the selected period.">
        {report.completed.length === 0 ? <EmptyRow text="Nothing completed in this period." /> : (
          <DataTable cols={['Source', 'Item', 'Resource', 'Completed']} rows={report.completed.map(c => [
            <SourceTag source={c.source} />, c.title, c.resource, dateFmt(c.completedAt),
          ])} />
        )}
      </ReportSection>

      <ReportSection title="Overdue" icon={<AlertTriangle size={14} />} accent="#dc2626" desc="Due today or earlier and not yet closed/done, as of today — independent of the period tab above. Anything already marked closed/done is never shown here, even if it was due today.">
        {report.overdue.length === 0 ? <EmptyRow text="Nothing overdue." /> : (
          <DataTable cols={['Source', 'Item', 'Status', 'Due', 'Resource']} rows={report.overdue.map(o => [
            <SourceTag source={o.source} />, o.title, o.status, <span style={{ color: '#dc2626', fontWeight: 700 }}>{dateFmt(o.dueDate)}</span>, o.resource,
          ])} />
        )}
      </ReportSection>
    </>
  )
}
