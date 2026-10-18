import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, ComposedChart, Line, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'
import { RefreshCw, Download, AlertTriangle, AlertCircle, Info, Flag, ArrowUpDown } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { dateFmt, rupee } from '../lib/supabase'
import { Loader, Empty, SearchBox } from '../components/ui'
import { buildPortfolio, HEALTH_WEIGHTS } from '../lib/portfolio'
import { loadPortfolioData } from '../lib/portfolioData'
import { MARGIN_VISIBLE_ROLES } from '../lib/profitMargin'
import { ensureXLSX } from '../lib/xlsxLoader'

const C = { budget: '#cbd5e1', cost: '#6366f1', people: '#6366f1', software: '#8b5cf6', hardware: '#f59e0b', support: '#14b8a6', expenses: '#e11d48' }
const SEV = [
  { icon: Info, color: '#64748b', bg: '#f8fafc' },
  { icon: Flag, color: '#2563eb', bg: '#eff6ff' },
  { icon: AlertCircle, color: '#d97706', bg: '#fffbeb' },
  { icon: AlertTriangle, color: '#dc2626', bg: '#fef2f2' },
]
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

// ₹ in lakh / crore for tiles and chart axes
function inr(n) {
  if (n == null) return '—'
  const a = Math.abs(n), s = n < 0 ? '-' : ''
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)}Cr`
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(1)}L`
  if (a >= 1e3) return `${s}₹${(a / 1e3).toFixed(1)}K`
  return `${s}₹${Math.round(a)}`
}
const pct = v => (v == null ? '—' : `${v}%`)
const short = (s, n = 14) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s)
const monthLabel = k => new Date(`${k}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })

export default function PortfolioDashboardPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const canSeeMargin = MARGIN_VISIBLE_ROLES.includes(profile?.role)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('active')
  const [dept, setDept] = useState('')
  const [cust, setCust] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState({ key: 'health', dir: 1 })
  const today = todayISO()

  async function load() {
    setLoading(true)
    try { setData(await loadPortfolioData(profile?.organization_id)) }
    catch (e) { console.error(e) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const pf = useMemo(() => {
    if (!data) return null
    const q = search.trim().toLowerCase()
    const projects = data.raw.projects.filter(p =>
      (status === 'all' || (p.status || 'active') === status) &&
      (!dept || p.department_id === dept) && (!cust || p.customer_id === cust) &&
      (!q || p.name?.toLowerCase().includes(q) || p.code?.toLowerCase().includes(q)))
    return buildPortfolio({ ...data.raw, projects }, { today, isTaskDone: data.isTaskDone })
  }, [data, status, dept, cust, search, today])

  const rows = useMemo(() => {
    if (!pf) return []
    const v = r => { const x = r[sort.key]; return x == null ? (sort.dir > 0 ? Infinity : -Infinity) : x }
    return [...pf.rows].sort((a, b) => {
      const x = v(a), y = v(b)
      return typeof x === 'string' ? x.localeCompare(y) * sort.dir : (x - y) * sort.dir
    })
  }, [pf, sort])

  if (loading && !data) return <Loader />
  if (!pf) return <Empty icon="📊" title="Could not load projects" desc="Try refreshing the page" />

  const t = pf.totals
  const open = r => navigate(`/projects?pid=${r.id}`)
  const sortBy = key => setSort(s => ({ key, dir: s.key === key ? -s.dir : 1 }))

  async function exportExcel() {
    await ensureXLSX()
    const XLSX = window.XLSX
    const wb = XLSX.utils.book_new()
    const sheet = rows.map(r => ({
      Project: r.name, Code: r.code, Customer: r.customer, Department: r.department, Status: r.status,
      'Health score': r.health, Health: r.band.label,
      'Schedule score': r.scores.schedule, 'Budget score': r.scores.budget, 'Delivery score': r.scores.delivery, 'Quality score': r.scores.quality,
      'Start': r.start_date, 'End': r.end_date, 'Progress %': r.progress, 'Timeline elapsed %': r.elapsed,
      'Budget (₹)': r.budget, 'Cost to date (₹)': r.cost, 'Budget used %': r.spendPct,
      'People (₹)': r.costSplit.people, 'Software (₹)': r.costSplit.software, 'Hardware (₹)': r.costSplit.hardware, 'Support (₹)': r.costSplit.support, 'Expenses (₹)': r.costSplit.expenses,
      ...(canSeeMargin ? { 'Invoiced (₹)': r.invoiced, 'Collected (₹)': r.collected, 'Outstanding (₹)': r.outstanding, 'Margin (₹)': r.margin, 'Margin %': r.marginPct } : {}),
      'Tasks': r.tasksTotal, 'Tasks done': r.tasksDone, 'Overdue tasks': r.overdueTasks,
      'Milestones': r.milestonesTotal, 'Overdue milestones': r.overdueMilestones,
      'Open incidents': r.openIncidents, 'Open change requests': r.openCRs, 'Hours logged': r.hours, 'Days since last log': r.daysSinceLog,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), 'Projects')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pf.attention.map(a => ({ Project: a.project, Priority: ['Info', 'Low', 'Medium', 'High'][a.sev], Issue: a.text }))), 'Needs attention')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pf.monthly.map(m => ({ Month: m.month, 'People (₹)': m.people, 'Software/Hardware/Support (₹)': m.other, 'Expenses (₹)': m.expenses, 'Total (₹)': m.total, 'Cumulative (₹)': m.cumulative }))), 'Monthly spend')
    XLSX.writeFile(wb, `Project_Portfolio_${today}.xlsx`)
  }

  const tiles = [
    { label: 'Projects', value: status === 'active' ? t.active : t.projects, sub: `${t.onTrack} on track · ${t.atRisk} at risk · ${t.critical} critical`, accent: '#6366f1' },
    { label: 'Avg health', value: t.avgHealth ?? '—', sub: t.noData ? `${t.noData} not graded (missing data)` : 'Across graded projects', accent: t.avgHealth == null ? '#94a3b8' : t.avgHealth >= 75 ? '#059669' : t.avgHealth >= 50 ? '#d97706' : '#dc2626' },
    { label: 'Budget', value: inr(t.budget), sub: `${inr(t.cost)} spent · ${pct(t.spendPct)} used`, accent: t.spendPct > 100 ? '#dc2626' : '#0ea5e9' },
    ...(canSeeMargin ? [
      { label: 'Invoiced', value: inr(t.invoiced), sub: `${inr(t.collected)} collected · ${inr(t.outstanding)} due`, accent: '#14b8a6' },
      { label: 'Margin', value: pct(t.marginPct), sub: 'Invoiced vs cost to date', accent: t.marginPct != null && t.marginPct < 0 ? '#dc2626' : '#059669' },
    ] : []),
    { label: 'Overdue', value: t.overdueTasks, sub: `tasks · ${t.overdueMilestones} milestones`, accent: t.overdueTasks || t.overdueMilestones ? '#d97706' : '#059669' },
    { label: 'Open issues', value: t.openIncidents, sub: `incidents · ${t.openCRs} change requests`, accent: t.openIncidents ? '#dc2626' : '#059669' },
    { label: 'Hours logged', value: Math.round(t.hours).toLocaleString('en-IN'), sub: 'All time, on these projects', accent: '#8b5cf6' },
  ]

  const chartRows = rows.filter(r => r.budget || r.cost).map(r => ({ name: short(r.name), full: r.name, Budget: r.budget, Cost: r.cost, ...r.costSplit }))
  const scatter = rows.filter(r => r.progress != null && r.elapsed != null).map(r => ({ x: r.elapsed, y: r.progress, name: r.name, color: r.band.color }))
  const marginRows = canSeeMargin ? rows.filter(r => r.marginPct != null).sort((a, b) => b.marginPct - a.marginPct).map(r => ({ name: short(r.name), full: r.name, margin: r.marginPct })) : []

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Project Portfolio</div>
          <div className="page-subtitle">All projects at a glance — health, schedule, budget and delivery</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-outline" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh</button>
          <button className="btn btn-primary" onClick={exportExcel}><Download size={14} /> Export Excel</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <select className="form-select" style={{ width: 'auto' }} value={status} onChange={e => setStatus(e.target.value)}>
          {[['active', 'Active'], ['on_hold', 'On hold'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['all', 'All statuses']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="form-select" style={{ width: 'auto' }} value={dept} onChange={e => setDept(e.target.value)}>
          <option value="">All departments</option>
          {data.raw.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="form-select" style={{ width: 'auto' }} value={cust} onChange={e => setCust(e.target.value)}>
          <option value="">All customers</option>
          {data.raw.customers.filter(c => data.raw.projects.some(p => p.customer_id === c.id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <SearchBox value={search} onChange={setSearch} placeholder="Search project…" />
      </div>

      <div className="gl-kpis">
        {tiles.map(k => (
          <div key={k.label} className="gl-kpi" style={{ '--gl-accent': k.accent }}>
            <div className="gl-kpi-label">{k.label}</div>
            <div className="gl-kpi-value">{k.value}</div>
            <div className="gl-kpi-sub" title={k.sub}>{k.sub}</div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? <Empty icon="📁" title="No projects match" desc="Change the filters above" /> : <>
        <div className="pf-grid2">
          <Panel title={`Needs attention (${pf.attention.length})`}>
            {pf.attention.length === 0
              ? <div className="pf-muted">Nothing needs attention right now.</div>
              : <div className="pf-list">
                  {pf.attention.slice(0, 12).map((a, i) => {
                    const s = SEV[a.sev], Icon = s.icon
                    return (
                      <button key={i} className="pf-att" style={{ background: s.bg }} onClick={() => navigate(`/projects?pid=${a.project_id}`)}>
                        <Icon size={14} color={s.color} style={{ flexShrink: 0, marginTop: 2 }} />
                        <span><b>{a.project}</b> — {a.text}</span>
                      </button>
                    )
                  })}
                  {pf.attention.length > 12 && <div className="pf-muted">+{pf.attention.length - 12} more in the Excel export</div>}
                </div>}
          </Panel>
          <Panel title="Milestones due in the next 30 days">
            {pf.upcoming.length === 0
              ? <div className="pf-muted">No milestones due in the next 30 days.</div>
              : <div className="pf-list">
                  {pf.upcoming.slice(0, 12).map((m, i) => (
                    <button key={i} className="pf-att" onClick={() => navigate(`/projects?pid=${m.project_id}`)}>
                      <span className="pf-date">{dateFmt(m.due_date)}</span>
                      <span style={{ minWidth: 0 }}><b>{m.title}</b> <span className="pf-muted">· {m.project}</span></span>
                    </button>
                  ))}
                </div>}
          </Panel>
        </div>

        <div className="table-wrap" style={{ marginBottom: 16 }}>
          <div className="table-toolbar">
            <span style={{ fontWeight: 700, fontSize: 14 }}>Project health</span>
            <span className="pf-muted" style={{ marginLeft: 'auto' }}>
              Health = {Object.entries(HEALTH_WEIGHTS).map(([k, w]) => `${k} ${w * 100}%`).join(' · ')} · click a project to open it
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <Th k="name" sort={sort} on={sortBy}>Project</Th>
                  <Th k="health" sort={sort} on={sortBy}>Health</Th>
                  <Th k="progress" sort={sort} on={sortBy}>Progress vs time</Th>
                  <th>Timeline</th>
                  <Th k="spendPct" sort={sort} on={sortBy}>Budget used</Th>
                  <Th k="cost" sort={sort} on={sortBy}>Cost to date</Th>
                  {canSeeMargin && <Th k="marginPct" sort={sort} on={sortBy}>Margin</Th>}
                  <Th k="overdueTasks" sort={sort} on={sortBy}>Overdue</Th>
                  <Th k="openIncidents" sort={sort} on={sortBy}>Issues</Th>
                  <Th k="daysSinceLog" sort={sort} on={sortBy}>Last activity</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} onClick={() => open(r)} style={{ cursor: 'pointer' }}>
                    <td style={{ minWidth: 180 }}>
                      <div className="td-bold">{r.name}</div>
                      <div className="pf-muted">{[r.customer, r.department, r.status !== 'active' && r.status.replace('_', ' ')].filter(Boolean).join(' · ') || r.code}</div>
                    </td>
                    <td title={Object.entries(r.scores).map(([k, v]) => `${k}: ${v ?? 'n/a'}`).join('\n')}>
                      <span className="pf-chip" style={{ color: r.band.color, borderColor: r.band.color }}>
                        {r.health != null && <b>{r.health}</b>} {r.band.label}
                      </span>
                    </td>
                    <td style={{ minWidth: 150 }}><ProgressBar progress={r.progress} elapsed={r.elapsed} /></td>
                    <td className="pf-small">{r.start_date ? `${dateFmt(r.start_date)} → ${dateFmt(r.end_date)}` : <span className="pf-muted">No dates</span>}</td>
                    <td style={{ minWidth: 110 }}>{r.budget ? <Meter value={r.spendPct} /> : <span className="pf-muted">No budget</span>}</td>
                    <td className="pf-num">{rupee(r.cost)}</td>
                    {canSeeMargin && <td className="pf-num" style={{ color: r.marginPct == null ? undefined : r.marginPct < 0 ? '#dc2626' : '#059669' }}>{r.marginPct == null ? <span className="pf-muted">Not invoiced</span> : `${r.marginPct}%`}</td>}
                    <td className="pf-small">{r.overdueTasks || r.overdueMilestones ? <>{r.overdueTasks} tasks<br />{r.overdueMilestones} milestones</> : <span style={{ color: '#059669' }}>None</span>}</td>
                    <td className="pf-small">{r.openIncidents || r.openCRs ? <>{r.openIncidents} incidents{r.p1Incidents ? <b style={{ color: '#dc2626' }}> ({r.p1Incidents} P1)</b> : ''}<br />{r.openCRs} CRs</> : <span style={{ color: '#059669' }}>None</span>}</td>
                    <td className="pf-small">{r.daysSinceLog == null ? <span className="pf-muted">Never</span> : r.daysSinceLog === 0 ? 'Today' : `${r.daysSinceLog}d ago`}<div className="pf-muted">{r.team} people / 30d</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="pf-grid2">
          <Panel title="Budget vs cost to date">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
                <XAxis dataKey="name" angle={-30} textAnchor="end" interval={0} tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={inr} tick={{ fontSize: 11 }} width={64} />
                <Tooltip formatter={v => rupee(v)} labelFormatter={(_, p) => p?.[0]?.payload?.full} />
                <Legend verticalAlign="top" height={28} />
                <Bar dataKey="Budget" fill={C.budget} radius={[4, 4, 0, 0]} />
                <Bar dataKey="Cost" radius={[4, 4, 0, 0]}>
                  {chartRows.map((r, i) => <Cell key={i} fill={r.Budget && r.Cost > r.Budget ? '#dc2626' : C.cost} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>
          <Panel title="Where the money goes">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
                <XAxis dataKey="name" angle={-30} textAnchor="end" interval={0} tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={inr} tick={{ fontSize: 11 }} width={64} />
                <Tooltip formatter={v => rupee(v)} labelFormatter={(_, p) => p?.[0]?.payload?.full} />
                <Legend verticalAlign="top" height={28} />
                {['people', 'software', 'hardware', 'support', 'expenses'].map(k => (
                  <Bar key={k} dataKey={k} name={k[0].toUpperCase() + k.slice(1)} stackId="c" fill={C[k]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </Panel>
          <Panel title="Portfolio spend — last 12 months">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={pf.monthly.map(m => ({ ...m, label: monthLabel(m.month) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="m" tickFormatter={inr} tick={{ fontSize: 11 }} width={64} />
                <YAxis yAxisId="c" orientation="right" tickFormatter={inr} tick={{ fontSize: 11 }} width={64} />
                <Tooltip formatter={v => rupee(v)} />
                <Legend verticalAlign="top" height={28} />
                <Bar yAxisId="m" dataKey="people" name="People" stackId="s" fill={C.people} />
                <Bar yAxisId="m" dataKey="other" name="SW / HW / Support" stackId="s" fill={C.hardware} />
                <Bar yAxisId="m" dataKey="expenses" name="Expenses" stackId="s" fill={C.expenses} radius={[4, 4, 0, 0]} />
                <Line yAxisId="c" dataKey="cumulative" name="Cumulative" stroke="#0f172a" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </Panel>
          <Panel title="Schedule risk — progress vs time elapsed" note="Below the line = behind schedule">
            {scatter.length === 0
              ? <div className="pf-muted">Needs start/end dates and tasks or milestones on the projects.</div>
              : <ResponsiveContainer width="100%" height={280}>
                  <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis type="number" dataKey="x" name="Time elapsed" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} label={{ value: 'Time elapsed', position: 'insideBottom', offset: -8, fontSize: 11 }} />
                    <YAxis type="number" dataKey="y" name="Progress" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} width={44} />
                    <ZAxis range={[90, 90]} />
                    <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke="#94a3b8" strokeDasharray="4 4" />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ payload }) => payload?.[0] ? (
                      <div className="pf-tip"><b>{payload[0].payload.name}</b><br />{payload[0].payload.y}% done · {payload[0].payload.x}% of time used</div>
                    ) : null} />
                    <Scatter data={scatter}>{scatter.map((s, i) => <Cell key={i} fill={s.color} />)}</Scatter>
                  </ScatterChart>
                </ResponsiveContainer>}
          </Panel>
          {canSeeMargin && (
            <Panel title="Margin by project" note="Invoiced revenue vs cost to date">
              {marginRows.length === 0
                ? <div className="pf-muted">No project has a sent or paid customer invoice yet.</div>
                : <ResponsiveContainer width="100%" height={Math.max(160, marginRows.length * 30 + 40)}>
                    <BarChart data={marginRows} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef2f7" />
                      <XAxis type="number" unit="%" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                      <ReferenceLine x={0} stroke="#94a3b8" />
                      <Tooltip formatter={v => `${v}%`} labelFormatter={(_, p) => p?.[0]?.payload?.full} />
                      <Bar dataKey="margin" name="Margin" radius={[0, 4, 4, 0]}>
                        {marginRows.map((r, i) => <Cell key={i} fill={r.margin < 0 ? '#dc2626' : '#059669'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>}
            </Panel>
          )}
          <Panel title="Health distribution">
            <div className="pf-list">
              {[['On track', t.onTrack, '#059669'], ['At risk', t.atRisk, '#d97706'], ['Critical', t.critical, '#dc2626'], ['Not graded', t.noData, '#94a3b8']].map(([l, n, c]) => {
                const total = t.onTrack + t.atRisk + t.critical + t.noData || 1
                return (
                  <div key={l}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}><span>{l}</span><span>{n}</span></div>
                    <div className="pf-track"><div style={{ width: `${(n / total) * 100}%`, background: c }} /></div>
                  </div>
                )
              })}
              <div className="pf-muted" style={{ marginTop: 6 }}>
                Projects are graded from schedule, budget, delivery and quality. A project without a budget, dates or tasks is "Not graded" — fill those in on the Projects page.
              </div>
            </div>
          </Panel>
        </div>
      </>}
    </div>
  )
}

function Panel({ title, note, children }) {
  return (
    <div className="card pf-panel">
      <div className="pf-panel-h"><span>{title}</span>{note && <span className="pf-muted">{note}</span>}</div>
      <div className="pf-panel-b">{children}</div>
    </div>
  )
}

function Th({ k, sort, on, children }) {
  return (
    <th onClick={() => on(k)} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
      {children} <ArrowUpDown size={11} style={{ opacity: sort.key === k ? 1 : 0.3, verticalAlign: -1 }} />
    </th>
  )
}

// Progress bar with a tick where the timeline says it should be
function ProgressBar({ progress, elapsed }) {
  if (progress == null) return <span className="pf-muted">No tasks</span>
  const behind = elapsed != null && elapsed - progress >= 10
  return (
    <div title={elapsed != null ? `${progress}% done · ${elapsed}% of time used` : `${progress}% done`}>
      <div className="pf-track" style={{ position: 'relative' }}>
        <div style={{ width: `${progress}%`, background: behind ? '#d97706' : '#6366f1' }} />
        {elapsed != null && <span className="pf-tick" style={{ left: `${elapsed}%` }} />}
      </div>
      <div className="pf-small" style={{ marginTop: 3 }}>{progress}% done{elapsed != null && <span className="pf-muted"> · {elapsed}% time</span>}</div>
    </div>
  )
}

function Meter({ value }) {
  const c = value > 100 ? '#dc2626' : value > 85 ? '#d97706' : '#059669'
  return (
    <div>
      <div className="pf-track"><div style={{ width: `${Math.min(100, value || 0)}%`, background: c }} /></div>
      <div className="pf-small" style={{ marginTop: 3, color: c, fontWeight: 700 }}>{value}%</div>
    </div>
  )
}
