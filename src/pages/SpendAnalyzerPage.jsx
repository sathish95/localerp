import { useState, useEffect, Fragment } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase, rupee } from '../lib/supabase'
import {
  getCompanySummary, getSpendTrend, getSpendByCategory, getSpendByDepartment, getSpendByProject,
  getSpendByVendor, getSpendByProduct, getDeviceFleetStats, getFindings, updateFindingStatus, getForecast, getBenchmark,
  recomputeCompanyRollup, recomputeVendorSpendSummary, generateFindings,
  getProjectDrilldown, getVendorDrilldown, getProductDrilldown, getCategoryDrilldown, getDepartmentDrilldown,
} from '../lib/spendAnalyzer'
import { getFundFlowStages, getFundFlowRecordsForStage } from '../lib/fundFlow'
import { getBomInventoryBreakdown } from '../lib/bom'
import { getResourceFlow, getResourceFlowSummary } from '../lib/resourceFlow'
import { getInventoryList } from '../lib/inventory'
import { Loader, Empty } from '../components/ui'
import { RefreshCw, TrendingUp, AlertTriangle, Package, Building2, FolderOpen, Truck, Lightbulb, Radar, Scale, Wallet, Users, DollarSign, Percent, Cpu, Code2, LifeBuoy, ShieldCheck, Boxes, ShoppingCart } from 'lucide-react'
import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

const FUND_STAGE_COLORS = ['#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#f59e0b', '#10b981']

// Premium tile/panel idiom lifted from DashboardPage.jsx's KPI/ChartCard —
// the app's most polished existing page — rather than inventing a new
// visual language for Spend Analyzer alone.
function Kpi({ label, value, icon, color = '#6366f1' }) {
  const [hover, setHover] = useState(false)
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        background: '#fff', borderRadius: 16, padding: '16px 18px', border: `1.5px solid ${color}18`, borderTop: `4px solid ${color}`,
        boxShadow: hover ? '0 10px 24px rgba(0,0,0,.09)' : '0 1px 6px rgba(0,0,0,.05)', height: '100%', minWidth: 0, overflow: 'hidden',
        transform: hover ? 'translateY(-3px)' : 'none', transition: 'transform .18s, box-shadow .18s',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: `${color}12`, display: 'flex', alignItems: 'center', justifyContent: 'center', color, flexShrink: 0 }}>{icon}</div>
      </div>
      <div style={{ fontSize: 'clamp(16px,3vw,24px)', fontWeight: 800, color, lineHeight: 1.2, marginBottom: 4, overflowWrap: 'break-word', wordBreak: 'break-word' }}>{value}</div>
      <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{label}</div>
    </div>
  )
}

function ChartCard({ title, sub, children, action }) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
          {sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
        </div>
        {action}
      </div>
      <div style={{ padding: '16px 20px' }}>{children}</div>
    </div>
  )
}

const FINDING_LABELS = {
  RecurringOverrun: 'Recurring Overrun', ContingencyPattern: 'Contingency Pattern', UnderutilizedBudget: 'Underutilized Budget',
  VendorConsolidation: 'Vendor Consolidation', AllocationInefficiency: 'Allocation Inefficiency', ChangeCostCreep: 'Change Cost Creep',
}
const STATUS_C = { new: '#3b82f6', acknowledged: '#f59e0b', actioned: '#10b981', dismissed: '#94a3b8' }
const HEALTH_C = { over: '#ef4444', risk: '#f59e0b', healthy: '#10b981', unknown: '#94a3b8' }
const HEALTH_L = { over: 'Over Budget', risk: 'At Risk', healthy: 'Healthy', unknown: 'No Budget' }
const CATEGORY_META = {
  Resource: { icon: Users, color: '#6366f1' },
  Hardware: { icon: Cpu, color: '#3b82f6' },
  Software: { icon: Code2, color: '#8b5cf6' },
  Support: { icon: LifeBuoy, color: '#f59e0b' },
  Warranty: { icon: ShieldCheck, color: '#10b981' },
  Change: { icon: TrendingUp, color: '#ec4899' },
}

/* ── Shared "world-class" building blocks reused across every tab so the
   whole page reads as one consistent design language rather than each
   view inventing its own. ── */
function IconTile({ icon: Icon, color, size = 24 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', color, flexShrink: 0 }}>
      <Icon size={Math.round(size * 0.55)} />
    </div>
  )
}

function Avatar({ name, size = 26, color = '#6366f1' }) {
  const initials = (name || '?').split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: `${color}18`, color, fontSize: Math.round(size * 0.42), fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {initials || '?'}
    </div>
  )
}

function ProgressBar({ pct, color, height = 6 }) {
  return (
    <div style={{ height, borderRadius: height / 2, background: '#f1f5f9', overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(100, Math.max(0, pct || 0))}%`, height: '100%', background: color, borderRadius: height / 2, transition: 'width .3s' }} />
    </div>
  )
}

function HealthBadge({ health }) {
  return <span style={{ padding: '2px 9px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: `${HEALTH_C[health]}18`, color: HEALTH_C[health] }}>{HEALTH_L[health]}</span>
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.04em' }}>{children}</div>
}

// Compact colored-circle-avatar-style category icon used inline in table rows.
function CategoryIcon({ category, size = 24 }) {
  const meta = CATEGORY_META[category] || { icon: Package, color: '#94a3b8' }
  return <IconTile icon={meta.icon} color={meta.color} size={size} />
}

// PMO Head has no dedicated role in this app's role enum — 'manager' stands in
// for it here (closest existing cross-project oversight role). Department Head
// gets full access too (per stakeholder decision "both enterprise + project
// mirror") rather than a hard department-scoped default; the project-scoped
// mirror inside ProjectsPage.jsx's Finance subtab covers the "just my
// department" use case for anyone who'd rather not open this page at all.
const FULL_ACCESS_ROLES = ['admin', 'ceo', 'finance', 'manager']

export default function SpendAnalyzerPage() {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const canView = FULL_ACCESS_ROLES.includes(role) || role === 'department_head'
  const [searchParams] = useSearchParams()
  const view = searchParams.get('view') || 'overview'
  const [loading, setLoading] = useState(true)
  const [recomputing, setRecomputing] = useState(false)
  const [data, setData] = useState({})
  // Lightweight lists loaded once, used by Fund Flow / Resource Flow's
  // department+project filter dropdowns — not tied to the tab dispatcher
  // below since both views manage their own filtered re-fetching.
  const [departments, setDepartments] = useState([])
  const [projects, setProjects] = useState([])

  useEffect(() => {
    if (!canView) return
    supabase.from('departments').select('id,name').order('name').then(({ data }) => setDepartments(data || []))
    supabase.from('projects').select('id,name').order('name').then(({ data }) => setProjects(data || []))
  }, [canView])

  useEffect(() => { if (canView) load(view) }, [view, canView])

  async function load(v) {
    setLoading(true)
    try {
      if (v === 'overview') {
        const [summary, trend, fundStages] = await Promise.all([getCompanySummary(), getSpendTrend(12), getFundFlowStages()])
        setData(d => ({ ...d, summary, trend, fundStages }))
      }
      if (v === 'category') { const c = await getSpendByCategory(); setData(d => ({ ...d, category: c })) }
      if (v === 'department') { const dep = await getSpendByDepartment(); setData(d => ({ ...d, department: dep })) }
      if (v === 'project') { const p = await getSpendByProject({ sortBy: 'spend', limit: 200 }); setData(d => ({ ...d, project: p })) }
      if (v === 'vendor') { const ven = await getSpendByVendor({ limit: 20 }); setData(d => ({ ...d, vendor: ven })) }
      if (v === 'product') { const prod = await getSpendByProduct({ limit: 30 }); setData(d => ({ ...d, product: prod })) }
      if (v === 'component') {
        const [spend, list] = await Promise.all([getSpendByProduct({ limit: 1000 }), getInventoryList()])
        setData(d => ({ ...d, componentSpend: spend.filter(r => !r.is_serialized), componentList: list.filter(i => !i.is_serialized) }))
      }
      if (v === 'device') {
        const [spend, fleet] = await Promise.all([getSpendByProduct({ limit: 1000 }), getDeviceFleetStats()])
        setData(d => ({ ...d, deviceSpend: spend.filter(r => r.is_serialized), deviceFleet: fleet }))
      }
      if (v === 'findings') { const f = await getFindings(); setData(d => ({ ...d, findings: f })) }
      if (v === 'forecast') { const fc = await getForecast(); setData(d => ({ ...d, forecast: fc })) }
      if (v === 'benchmark') { const b = await getBenchmark(); setData(d => ({ ...d, benchmark: b })) }
      // 'fundflow' and 'resource' tabs manage their own filtered fetching internally
    } finally { setLoading(false) }
  }

  async function recomputeAll() {
    setRecomputing(true)
    try {
      await recomputeCompanyRollup(role)
      await recomputeVendorSpendSummary()
      await generateFindings()
      await load(view)
    } finally { setRecomputing(false) }
  }

  async function markStatus(id, status) {
    await updateFindingStatus(id, status, profile.id)
    setData(d => ({ ...d, findings: d.findings.map(f => f.id === id ? { ...f, status } : f) }))
  }

  if (!canView) {
    return (
      <div>
        <div className="page-header"><div><div className="page-title">Spend Analyzer</div><div className="page-subtitle">Restricted to Finance & Leadership</div></div></div>
        <Empty icon={<TrendingUp size={44} />} title="No access" desc="This company-wide view is limited to Finance, PMO and Leadership roles" />
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Enterprise Spend Analyzer</div>
          <div className="page-subtitle">Where the money is going, company-wide — and where planning can improve</div>
        </div>
        <button className="btn btn-outline" onClick={recomputeAll} disabled={recomputing}>
          <RefreshCw size={14} style={{ marginRight: 6 }} /> {recomputing ? 'Recomputing…' : 'Recompute All'}
        </button>
      </div>

      {loading ? <Loader /> : (
        <>
          {view === 'overview' && <OverviewView summary={data.summary} trend={data.trend} fundStages={data.fundStages} />}
          {view === 'fundflow' && <FundFlowView departments={departments} projects={projects} />}
          {view === 'resource' && <ResourceFlowView departments={departments} projects={projects} />}
          {view === 'category' && <CategoryView rows={data.category} />}
          {view === 'department' && <DepartmentView rows={data.department} />}
          {view === 'project' && <ProjectView rows={data.project} />}
          {view === 'vendor' && <VendorView rows={data.vendor} />}
          {view === 'product' && <ProductView rows={data.product} />}
          {view === 'component' && <ComponentView spend={data.componentSpend} list={data.componentList} />}
          {view === 'device' && <DeviceView spend={data.deviceSpend} fleet={data.deviceFleet} />}
          {view === 'findings' && <FindingsView rows={data.findings} onStatus={markStatus} />}
          {view === 'forecast' && <ForecastView data={data.forecast} />}
          {view === 'benchmark' && <BenchmarkView rows={data.benchmark} />}
        </>
      )}
    </div>
  )
}

/* ── Section 1 — company-wide executive summary ── */
function OverviewView({ summary, trend, fundStages }) {
  if (!summary) return <Empty icon={<TrendingUp size={40} />} title="No data yet" desc="Click Recompute All to build the company rollup" />
  const stageByName = Object.fromEntries((fundStages || []).map(s => [s.stage, s]))
  return (
    <div>
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <Kpi label="Total Budget" value={rupee(summary.totalBudget)} color="#3b82f6" icon={<Wallet size={18} />} />
        <Kpi label="Total Actual Spend" value={rupee(summary.totalActual)} color="#f59e0b" icon={<TrendingUp size={18} />} />
        <Kpi label="Total Revenue" value={rupee(summary.totalRevenue)} color="#8b5cf6" icon={<DollarSign size={18} />} />
        <Kpi label="Profit / Loss" value={rupee(summary.totalProfit)} color={summary.totalProfit >= 0 ? '#10b981' : '#ef4444'} icon={<TrendingUp size={18} />} />
        <Kpi label="Overall Margin" value={`${summary.marginPct}%`} color={summary.marginPct >= 0 ? '#10b981' : '#ef4444'} icon={<Percent size={18} />} />
      </div>

      {fundStages && (
        <div style={{ marginBottom: 20 }}>
          <ChartCard title="💸 Commit → Spend → Pay (company-wide)" sub="See the Fund Flow tab for the full breakdown and drill-down">
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Committed</div><div style={{ fontSize: 18, fontWeight: 800, color: '#6366f1' }}>{rupee(stageByName['Committed']?.amount)}</div></div>
              <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Invoiced (Actual)</div><div style={{ fontSize: 18, fontWeight: 800, color: '#f59e0b' }}>{rupee(stageByName['Invoiced']?.amount)}</div></div>
              <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Paid</div><div style={{ fontSize: 18, fontWeight: 800, color: '#10b981' }}>{rupee(stageByName['Paid']?.amount)}</div></div>
            </div>
          </ChartCard>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {['red', 'amber', 'green'].map(k => (
          <div key={k} className="hover-lift" style={{ flex: 1, background: '#fff', border: `1.5px solid ${HEALTH_C[k === 'red' ? 'over' : k === 'amber' ? 'risk' : 'healthy']}30`, borderTop: `4px solid ${HEALTH_C[k === 'red' ? 'over' : k === 'amber' ? 'risk' : 'healthy']}`, borderRadius: 14, padding: '14px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: HEALTH_C[k === 'red' ? 'over' : k === 'amber' ? 'risk' : 'healthy'] }}>{summary.flags[k]}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>{k === 'red' ? 'Over Budget' : k === 'amber' ? 'At Risk' : 'Healthy'} Projects</div>
          </div>
        ))}
      </div>

      <ChartCard title="📈 Spend Trend — Last 12 Months">
        {!trend?.length ? <Empty icon={<TrendingUp size={36} />} title="No trend data" desc="Recompute after some projects have month-level actual cost snapshots" /> : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₹${Math.round(v / 1000)}k`} />
              <Tooltip formatter={v => rupee(v)} />
              <Legend />
              <Line type="monotone" dataKey="planned" name="Planned" stroke="#94a3b8" strokeWidth={2} strokeDasharray="4 4" dot={false} />
              <Line type="monotone" dataKey="actual" name="Actual" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  )
}

/* ── Fund Flow — Budget Allocated -> Committed -> PO Issued -> GRN Received
   -> Invoiced -> Paid, assembled from budgets/purchase_requisitions/
   purchase_orders/grn/invoices/payments (src/lib/fundFlow.js). Click a
   stage pill to see its underlying records. ── */
function FundFlowView({ departments, projects }) {
  const [filter, setFilter] = useState({ departmentId: '', projectId: '' })
  const [stages, setStages] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeStage, setActiveStage] = useState(null)
  const [stageRecords, setStageRecords] = useState(null)
  const [stageLoading, setStageLoading] = useState(false)

  useEffect(() => { load() }, [filter.departmentId, filter.projectId])

  async function load() {
    setLoading(true)
    setActiveStage(null); setStageRecords(null)
    const f = { departmentId: filter.departmentId || undefined, projectId: filter.projectId || undefined }
    setStages(await getFundFlowStages(f))
    setLoading(false)
  }

  async function openStage(stage) {
    if (activeStage === stage) { setActiveStage(null); setStageRecords(null); return }
    setActiveStage(stage); setStageLoading(true)
    const f = { departmentId: filter.departmentId || undefined, projectId: filter.projectId || undefined }
    setStageRecords(await getFundFlowRecordsForStage(stage, f))
    setStageLoading(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <select className="form-select" style={{ width: 'auto' }} value={filter.departmentId}
          onChange={e => setFilter(f => ({ ...f, departmentId: e.target.value, projectId: '' }))}>
          <option value="">All Departments</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="form-select" style={{ width: 'auto' }} value={filter.projectId}
          onChange={e => setFilter(f => ({ ...f, projectId: e.target.value }))}>
          <option value="">All Projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {loading || !stages ? <Loader /> : (
        <>
          {(() => {
            const byStage = Object.fromEntries(stages.map(s => [s.stage, s.amount]))
            const allocated = byStage['Budget Allocated'] || 0
            const paid = byStage['Paid'] || 0
            const committedPct = allocated ? Math.round(((byStage['Committed'] || 0) / allocated) * 100) : 0
            const paidPct = allocated ? Math.round((paid / allocated) * 100) : 0
            return (
              <div className="stats-grid" style={{ marginBottom: 20 }}>
                <Kpi label="Budget Allocated" value={rupee(allocated)} color="#3b82f6" icon={<Wallet size={18} />} />
                <Kpi label="Committed" value={rupee(byStage['Committed'])} color="#6366f1" icon={<TrendingUp size={18} />} />
                <Kpi label="Invoiced" value={rupee(byStage['Invoiced'])} color="#f59e0b" icon={<DollarSign size={18} />} />
                <Kpi label="Paid" value={rupee(paid)} color="#10b981" icon={<DollarSign size={18} />} />
                <Kpi label="% Budget Converted to Paid" value={`${paidPct}%`} color={paidPct > 90 ? '#ef4444' : '#8b5cf6'} icon={<Percent size={18} />} />
              </div>
            )
          })()}

          <div style={{ marginBottom: 20 }}>
            <ChartCard title={<><Wallet size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} /> Commit → Spend → Pay</>} sub="Click a stage for its underlying records">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {stages.map((s, i) => (
                  <FundStagePill key={s.stage} stage={s} active={activeStage === s.stage} onClick={() => openStage(s.stage)} showConnector={i < stages.length - 1} />
                ))}
              </div>
              <div style={{ marginTop: 18, height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stages} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tickFormatter={v => `₹${Math.round(v / 1000)}k`} tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="stage" width={110} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={v => rupee(v)} />
                    <Bar dataKey="amount" radius={[0, 6, 6, 0]}>
                      {stages.map((s, i) => <Cell key={s.stage} fill={FUND_STAGE_COLORS[i % FUND_STAGE_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          </div>

          {activeStage && (
            <ChartCard title={`${activeStage} — records`}>
              <div style={{ overflowX: 'auto' }}>
                {stageLoading ? <Loader /> : <FundFlowStageTable stage={activeStage} rows={stageRecords || []} />}
              </div>
            </ChartCard>
          )}
        </>
      )}
    </div>
  )
}

function FundStagePill({ stage: s, active, onClick, showConnector }) {
  const [hover, setHover] = useState(false)
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{
        cursor: 'pointer', textAlign: 'left', minWidth: 130,
        border: active ? '2px solid #6366f1' : '1px solid var(--border)',
        borderRadius: 12, padding: '10px 14px', background: active ? '#eef2ff' : '#fff',
        boxShadow: hover && !active ? '0 6px 16px rgba(0,0,0,.08)' : 'none',
        transform: hover && !active ? 'translateY(-2px)' : 'none', transition: 'transform .15s, box-shadow .15s',
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>{s.stage}</div>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#1e293b' }}>{rupee(s.amount)}</div>
        <div style={{ fontSize: 10, color: '#94a3b8' }}>{s.count} record{s.count === 1 ? '' : 's'}</div>
      </button>
      {showConnector && <div style={{ width: 14, height: 2, background: '#e2e8f0', margin: '0 4px' }} />}
    </div>
  )
}

function FundFlowStageTable({ stage, rows }) {
  if (!rows.length) return <Empty icon={<Wallet size={30} />} title="No records" desc="Nothing in this stage for the current filter" />
  if (stage === 'Budget Allocated' || stage === 'Committed') {
    return <table style={{ minWidth: 480 }}><thead><tr><th>Category</th><th>Allocated</th><th>Committed</th><th>Fiscal Year</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><td>{r.category || '—'}</td><td>{rupee(r.allocated)}</td><td>{rupee(r.committed_amount)}</td><td>{r.fiscal_year || '—'}</td></tr>)}</tbody>
    </table>
  }
  if (stage === 'PO Issued') {
    return <table style={{ minWidth: 480 }}><thead><tr><th>PO Number</th><th>Vendor</th><th>Status</th><th>Amount</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><td className="td-bold">{r.po_number}</td><td>{r.vendor?.name || '—'}</td><td>{r.status}</td><td>{rupee(r.total_amount)}</td></tr>)}</tbody>
    </table>
  }
  if (stage === 'GRN Received') {
    return <table style={{ minWidth: 480 }}><thead><tr><th>GRN Number</th><th>PO</th><th>Vendor</th><th>Status</th><th>Received Amount</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><td className="td-bold">{r.grn_number}</td><td>{r.po?.po_number || '—'}</td><td>{r.po?.vendor?.name || '—'}</td><td>{r.status}</td><td>{rupee(r.received_amount)}</td></tr>)}</tbody>
    </table>
  }
  return <table style={{ minWidth: 480 }}><thead><tr><th>Date</th><th>Vendor</th><th>Project</th><th>Status</th><th>Amount</th></tr></thead>
    <tbody>{rows.map(r => <tr key={r.id}><td>{r.invoice_date}</td><td>{r.vendor?.name || '—'}</td><td>{r.project?.name || '—'}</td><td>{r.status}</td><td>{rupee(r.total_amount)}</td></tr>)}</tbody>
  </table>
}

/* ── Resource Flow — joins allocation/utilization with people cost at the
   per-employee level (src/lib/resourceFlow.js), which neither capacity.js
   nor actualCost.js exposes on their own. ── */
function ResourceFlowView({ departments, projects }) {
  const [filter, setFilter] = useState({ departmentId: '', projectId: '' })
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedEmp, setExpandedEmp] = useState(null)

  useEffect(() => { load() }, [filter.departmentId, filter.projectId])

  async function load() {
    setLoading(true)
    setExpandedEmp(null)
    setRows(await getResourceFlow({ departmentId: filter.departmentId || undefined, projectId: filter.projectId || undefined }))
    setLoading(false)
  }

  if (loading || !rows) return <Loader />
  const summary = getResourceFlowSummary(rows)
  const deptNameMap = Object.fromEntries(departments.map(d => [d.id, d.name]))
  const utilColor = pct => pct == null ? '#94a3b8' : pct > 100 ? '#ef4444' : pct < 50 ? '#f59e0b' : '#10b981'

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <select className="form-select" style={{ width: 'auto' }} value={filter.departmentId}
          onChange={e => setFilter(f => ({ ...f, departmentId: e.target.value, projectId: '' }))}>
          <option value="">All Departments</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="form-select" style={{ width: 'auto' }} value={filter.projectId}
          onChange={e => setFilter(f => ({ ...f, projectId: e.target.value }))}>
          <option value="">All Projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {rows.length === 0 ? <Empty icon={<Users size={40} />} title="No allocations found" desc="No approved/active allocations match this filter" /> : (
        <>
          <div className="stats-grid" style={{ marginBottom: 20 }}>
            <Kpi label="Allocated Headcount" value={summary.headcount} color="#6366f1" icon={<Users size={18} />} />
            <Kpi label="Allocated Hrs / Week" value={`${Math.round(summary.totalHours)}h`} color="#3b82f6" icon={<TrendingUp size={18} />} />
            <Kpi label="Weekly People Cost" value={rupee(summary.totalWeeklyCost)} color="#8b5cf6" icon={<DollarSign size={18} />} />
            <Kpi label="Avg Utilization" value={summary.avgUtilizationPercent != null ? summary.avgUtilizationPercent + '%' : '—'} color={utilColor(summary.avgUtilizationPercent)} icon={<Percent size={18} />} />
          </div>

          <div style={{ marginBottom: 20 }}>
            <ChartCard title="Weekly Cost by Designation">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={summary.byDesignation}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="designation" tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={v => `₹${Math.round(v / 1000)}k`} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={v => rupee(v)} />
                  <Bar dataKey="cost" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="table-wrap hover-lift">
            <div className="table-toolbar"><span style={{ fontWeight: 700, fontSize: 14 }}>By Employee — click a row for their project split</span></div>
            <table>
              <thead><tr><th>Employee</th><th>Designation</th><th>Department</th><th>Allocated Hrs/wk</th><th>Utilization</th><th>Rate/hr</th><th>Weekly Cost</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <Fragment key={r.employeeId}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => setExpandedEmp(expandedEmp === r.employeeId ? null : r.employeeId)}>
                      <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar name={r.name} /><span className="td-bold">{r.name}</span></div></td>
                      <td>{r.designation}</td>
                      <td>{deptNameMap[r.departmentId] || '—'}</td>
                      <td>{r.allocatedHoursPerWeek}h</td>
                      <td style={{ fontWeight: 700, color: utilColor(r.utilizationPercent) }}>{r.utilizationPercent != null ? r.utilizationPercent + '%' : '—'}</td>
                      <td>{rupee(r.hourlyRate)}</td>
                      <td style={{ fontWeight: 700 }}>{rupee(r.computedWeeklyCost)}</td>
                    </tr>
                    {expandedEmp === r.employeeId && (
                      <tr><td colSpan={7} style={{ background: 'var(--surface-2)', padding: '10px 16px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 420 }}>
                          {r.projectBreakdown.map((p, i) => (
                            <div key={i} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                              <span>{p.projectName}{p.roleOnProject ? ` — ${p.roleOnProject}` : ''}</span>
                              <span style={{ fontWeight: 700 }}>{p.hours}h · {rupee(p.cost)}</span>
                            </div>
                          ))}
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

/* ── Section 2 — descriptive cuts ── */
function CategoryView({ rows }) {
  const [expanded, setExpanded] = useState(null)
  const [detail, setDetail] = useState(null)
  const [drillLoading, setDrillLoading] = useState(false)

  async function toggle(category) {
    if (expanded === category) { setExpanded(null); setDetail(null); return }
    setExpanded(category); setDetail(null); setDrillLoading(true)
    setDetail(await getCategoryDrilldown(category))
    setDrillLoading(false)
  }

  if (!rows?.length) return <Empty icon={<Package size={40} />} title="No category data" desc="Recompute All to build the rollup" />

  const totalPlanned = rows.reduce((s, r) => s + r.planned, 0)
  const totalActual = rows.reduce((s, r) => s + r.actual, 0)
  const totalVariance = totalActual - totalPlanned
  const overCount = rows.filter(r => r.variance_percent > 0).length
  const actualMax = Math.max(...rows.map(r => r.actual), 1)

  return (
    <div>
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <Kpi label="Total Planned" value={rupee(totalPlanned)} color="#3b82f6" icon={<Wallet size={18} />} />
        <Kpi label="Total Actual" value={rupee(totalActual)} color="#f59e0b" icon={<TrendingUp size={18} />} />
        <Kpi label="Total Variance" value={rupee(totalVariance)} color={totalVariance > 0 ? '#ef4444' : '#10b981'} icon={<AlertTriangle size={18} />} />
        <Kpi label="Categories Over Plan" value={overCount} color="#ef4444" icon={<AlertTriangle size={18} />} />
      </div>

      <div className="table-wrap hover-lift">
        <div className="table-toolbar"><span style={{ fontWeight: 700, fontSize: 14 }}>By Category — click a row for contributing departments &amp; projects</span></div>
        <table>
          <thead><tr><th>Category</th><th>Planned</th><th>Actual</th><th>Variance</th><th>Variance %</th></tr></thead>
          <tbody>{rows.map(r => (
            <Fragment key={r.category}>
              <tr style={{ cursor: 'pointer' }} onClick={() => toggle(r.category)}>
                <td><div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 220 }}>
                  <CategoryIcon category={r.category} />
                  <div style={{ flex: 1 }}>
                    <div className="td-bold">{r.category}</div>
                    <div style={{ marginTop: 3 }}><ProgressBar pct={(r.actual / actualMax) * 100} color={(CATEGORY_META[r.category] || {}).color || '#94a3b8'} height={4} /></div>
                  </div>
                </div></td>
                <td>{rupee(r.planned)}</td>
                <td>{rupee(r.actual)}</td>
                <td style={{ color: r.actual - r.planned > 0 ? '#ef4444' : '#10b981', fontWeight: 700 }}>{rupee(r.actual - r.planned)}</td>
                <td style={{ color: r.variance_percent > 0 ? '#ef4444' : '#10b981', fontWeight: 700 }}>{r.variance_percent}%</td>
              </tr>
              {expanded === r.category && (
                <tr><td colSpan={5} style={{ background: 'var(--surface-2)', padding: '18px 20px' }}>
                  {drillLoading ? <Loader /> : detail && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 28 }}>
                      <div>
                        <SectionLabel>Top Departments</SectionLabel>
                        {!detail.byDepartment.length ? <div style={{ fontSize: 12, color: '#94a3b8' }}>No department data</div> : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {detail.byDepartment.map(d => (
                              <div key={d.department_id || 'unassigned'} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <IconTile icon={Building2} color="#3b82f6" size={22} />
                                <span style={{ fontSize: 12, flex: 1 }}>{d.department?.name || 'Unassigned'}</span>
                                <span style={{ fontSize: 12, fontWeight: 800 }}>{rupee(d.actual_amount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div>
                        <SectionLabel>Top Projects</SectionLabel>
                        {!detail.byProject.length ? <div style={{ fontSize: 12, color: '#94a3b8' }}>No project-level breakdown for this category</div> : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {detail.byProject.map(p => (
                              <div key={p.project_id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <IconTile icon={FolderOpen} color="#8b5cf6" size={22} />
                                <span style={{ fontSize: 12, flex: 1 }}>{p.name}</span>
                                <span style={{ fontSize: 12, fontWeight: 800 }}>{rupee(p.amount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </td></tr>
              )}
            </Fragment>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}

function DepartmentView({ rows }) {
  const [expanded, setExpanded] = useState(null)
  const [detail, setDetail] = useState(null)
  const [drillLoading, setDrillLoading] = useState(false)

  async function toggle(deptId) {
    if (!deptId) return
    if (expanded === deptId) { setExpanded(null); setDetail(null); return }
    setExpanded(deptId); setDetail(null); setDrillLoading(true)
    setDetail(await getDepartmentDrilldown(deptId))
    setDrillLoading(false)
  }

  if (!rows?.length) return <Empty icon={<Building2 size={40} />} title="No department data" desc="Recompute All to build the rollup" />

  const totalPlanned = rows.reduce((s, r) => s + r.planned, 0)
  const totalActual = rows.reduce((s, r) => s + r.actual, 0)
  const overCount = rows.filter(r => r.variance_percent > 0).length
  const actualMax = Math.max(...rows.map(r => r.actual), 1)

  return (
    <div>
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <Kpi label="Total Planned" value={rupee(totalPlanned)} color="#3b82f6" icon={<Wallet size={18} />} />
        <Kpi label="Total Actual" value={rupee(totalActual)} color="#f59e0b" icon={<TrendingUp size={18} />} />
        <Kpi label="Departments" value={rows.length} color="#8b5cf6" icon={<Building2 size={18} />} />
        <Kpi label="Over Plan" value={overCount} color="#ef4444" icon={<AlertTriangle size={18} />} />
      </div>

      <div className="table-wrap hover-lift">
        <div className="table-toolbar"><span style={{ fontWeight: 700, fontSize: 14 }}>By Department — highest spend first, click for detail</span></div>
        <table>
          <thead><tr><th>Department</th><th>Planned</th><th>Actual</th><th>Variance %</th></tr></thead>
          <tbody>{rows.map(r => (
            <Fragment key={r.department_id || 'unassigned'}>
              <tr style={{ cursor: r.department_id ? 'pointer' : 'default' }} onClick={() => toggle(r.department_id)}>
                <td><div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 200 }}>
                  <IconTile icon={Building2} color="#3b82f6" />
                  <div style={{ flex: 1 }}>
                    <div className="td-bold">{r.name}</div>
                    <div style={{ marginTop: 3 }}><ProgressBar pct={(r.actual / actualMax) * 100} color="#3b82f6" height={4} /></div>
                  </div>
                </div></td>
                <td>{rupee(r.planned)}</td>
                <td>{rupee(r.actual)}</td>
                <td style={{ color: r.variance_percent > 0 ? '#ef4444' : '#10b981', fontWeight: 700 }}>{r.variance_percent}%</td>
              </tr>
              {expanded === r.department_id && (
                <tr><td colSpan={4} style={{ background: 'var(--surface-2)', padding: '18px 20px' }}>
                  {drillLoading ? <Loader /> : detail && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 28 }}>
                      <div>
                        <SectionLabel>Projects ({detail.projects.length})</SectionLabel>
                        {!detail.projects.length ? <div style={{ fontSize: 12, color: '#94a3b8' }}>No projects</div> : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {detail.projects.slice(0, 8).map(p => (
                              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <IconTile icon={FolderOpen} color={HEALTH_C[p.health]} size={22} />
                                <span style={{ fontSize: 12, flex: 1 }}>{p.name}</span>
                                <HealthBadge health={p.health} />
                                <span style={{ fontSize: 12, fontWeight: 800, minWidth: 70, textAlign: 'right' }}>{rupee(p.spent)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div>
                        <SectionLabel>Category Mix</SectionLabel>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {detail.categoryMix.map(c => {
                            const meta = CATEGORY_META[c.category] || { icon: Package, color: '#94a3b8' }
                            return (
                              <div key={c.category} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <IconTile icon={meta.icon} color={meta.color} size={22} />
                                <span style={{ fontSize: 12, flex: 1 }}>{c.category}</span>
                                <span style={{ fontSize: 12, fontWeight: 800 }}>{rupee(c.actual)}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                      <div>
                        <SectionLabel>Resource Utilization</SectionLabel>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <DetailStat icon={Users} color="#6366f1" label="Headcount" value={detail.resourceSummary.headcount} />
                          <DetailStat icon={DollarSign} color="#8b5cf6" label="Weekly Cost" value={rupee(detail.resourceSummary.totalWeeklyCost)} />
                          <DetailStat icon={Percent} color="#10b981" label="Avg Utilization" value={detail.resourceSummary.avgUtilizationPercent != null ? detail.resourceSummary.avgUtilizationPercent + '%' : '—'} />
                        </div>
                      </div>
                    </div>
                  )}
                </td></tr>
              )}
            </Fragment>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}

function DetailStat({ icon: Icon, color, label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <IconTile icon={Icon} color={color} size={22} />
      <span style={{ fontSize: 12, color: '#64748b', flex: 1 }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 800 }}>{value}</span>
    </div>
  )
}

function ProjectView({ rows }) {
  const [filterId, setFilterId] = useState('')
  const [detail, setDetail] = useState(null)
  const [drillLoading, setDrillLoading] = useState(false)

  useEffect(() => {
    if (!filterId) { setDetail(null); return }
    let cancelled = false
    setDrillLoading(true); setDetail(null)
    getProjectDrilldown(filterId).then(d => { if (!cancelled) { setDetail(d); setDrillLoading(false) } })
    return () => { cancelled = true }
  }, [filterId])

  if (!rows?.length) return <Empty icon={<FolderOpen size={40} />} title="No project data" desc="No projects with a budget yet" />

  const totalBudget = rows.reduce((s, r) => s + r.budget, 0)
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0)
  const totalOverrun = rows.reduce((s, r) => s + r.overrun, 0)
  const avgBurn = rows.length ? Math.round(rows.reduce((s, r) => s + r.burnPct, 0) / rows.length) : 0
  const overCount = rows.filter(r => r.health === 'over').length
  const selected = rows.find(r => r.id === filterId)

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="form-select" style={{ width: 'auto', minWidth: 280 }} value={filterId} onChange={e => setFilterId(e.target.value)}>
          <option value="">— Select a project for full detail —</option>
          {rows.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        {filterId && <button className="btn btn-outline btn-sm" onClick={() => setFilterId('')}>← Back to all projects</button>}
      </div>

      {filterId ? (
        drillLoading || !detail ? <Loader /> : <ProjectFullDetail project={selected} detail={detail} />
      ) : (
        <>
          <div className="stats-grid" style={{ marginBottom: 20 }}>
            <Kpi label="Total Budget" value={rupee(totalBudget)} color="#3b82f6" icon={<Wallet size={18} />} />
            <Kpi label="Total Spent" value={rupee(totalSpent)} color="#f59e0b" icon={<TrendingUp size={18} />} />
            <Kpi label="Avg Burn %" value={`${avgBurn}%`} color={avgBurn > 100 ? '#ef4444' : avgBurn > 80 ? '#f59e0b' : '#10b981'} icon={<Percent size={18} />} />
            <Kpi label="Total Overrun" value={totalOverrun > 0 ? rupee(totalOverrun) : '—'} color={totalOverrun > 0 ? '#ef4444' : '#94a3b8'} icon={<AlertTriangle size={18} />} />
            <Kpi label="Over Budget" value={overCount} color="#ef4444" icon={<AlertTriangle size={18} />} />
          </div>

          <div className="table-wrap hover-lift">
            <div className="table-toolbar"><span style={{ fontWeight: 700, fontSize: 14 }}>By Project — top {rows.length} by spend, click for full detail</span></div>
            <table>
              <thead><tr><th>Project</th><th>Budget</th><th>Spent</th><th>Burn %</th><th>Overrun</th><th>Health</th></tr></thead>
              <tbody>{rows.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setFilterId(r.id)}>
                  <td className="td-bold">{r.name}</td>
                  <td>{rupee(r.budget)}</td>
                  <td>{rupee(r.spent)}</td>
                  <td>{r.burnPct}%</td>
                  <td style={{ color: r.overrun > 0 ? '#ef4444' : '#94a3b8', fontWeight: 700 }}>{r.overrun > 0 ? rupee(r.overrun) : '—'}</td>
                  <td><HealthBadge health={r.health} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function ProjectFullDetail({ project: r, detail }) {
  const [activeStage, setActiveStage] = useState(null)
  const [stageRecords, setStageRecords] = useState(null)
  const [stageLoading, setStageLoading] = useState(false)

  async function openStage(stage) {
    if (activeStage === stage) { setActiveStage(null); setStageRecords(null); return }
    setActiveStage(stage); setStageLoading(true)
    setStageRecords(await getFundFlowRecordsForStage(stage, { projectId: r.id }))
    setStageLoading(false)
  }

  const catTotal = detail.categorySplit.reduce((s, c) => s + c.amount, 0) || 1

  return (
    <div>
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e2e8f0', borderTop: `5px solid ${HEALTH_C[r.health]}`, padding: '20px 24px', marginBottom: 20, boxShadow: '0 1px 6px rgba(0,0,0,.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
          <IconTile icon={FolderOpen} color={HEALTH_C[r.health]} size={42} />
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{r.name}</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Project spend profile</div>
          </div>
          <HealthBadge health={r.health} />
        </div>
        <div className="stats-grid">
          <Kpi label="Budget" value={rupee(r.budget)} color="#3b82f6" icon={<Wallet size={18} />} />
          <Kpi label="Spent" value={rupee(r.spent)} color="#f59e0b" icon={<TrendingUp size={18} />} />
          <Kpi label="Burn %" value={`${r.burnPct}%`} color={r.burnPct > 100 ? '#ef4444' : r.burnPct > 80 ? '#f59e0b' : '#10b981'} icon={<Percent size={18} />} />
          <Kpi label="Overrun" value={r.overrun > 0 ? rupee(r.overrun) : '—'} color={r.overrun > 0 ? '#ef4444' : '#94a3b8'} icon={<AlertTriangle size={18} />} />
          <Kpi label="Remaining" value={rupee(Math.max(0, r.budget - r.spent))} color="#10b981" icon={<DollarSign size={18} />} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 20, marginBottom: 20 }}>
        <ChartCard title="📦 Cost by Category">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {detail.categorySplit.map(c => {
              const meta = CATEGORY_META[c.category] || { icon: Package, color: '#94a3b8' }
              const pct = Math.round((c.amount / catTotal) * 100)
              return (
                <div key={c.category}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 5 }}>
                    <IconTile icon={meta.icon} color={meta.color} size={26} />
                    <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{c.category}</span>
                    <span style={{ fontSize: 13, fontWeight: 800 }}>{rupee(c.amount)}</span>
                    <span style={{ fontSize: 11, color: '#94a3b8', width: 34, textAlign: 'right' }}>{pct}%</span>
                  </div>
                  <ProgressBar pct={pct} color={meta.color} />
                </div>
              )
            })}
          </div>
        </ChartCard>

        <ChartCard title="💸 Fund Flow" sub="Click a stage for its underlying records">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {detail.fundFlow.map((s, i) => (
              <FundStagePill key={s.stage} stage={s} active={activeStage === s.stage} onClick={() => openStage(s.stage)} showConnector={i < detail.fundFlow.length - 1} />
            ))}
          </div>
          {activeStage && (
            <div style={{ overflowX: 'auto', borderTop: '1px solid #f1f5f9', marginTop: 16, paddingTop: 14 }}>
              {stageLoading ? <Loader /> : <FundFlowStageTable stage={activeStage} rows={stageRecords || []} />}
            </div>
          )}
        </ChartCard>
      </div>

      <ChartCard title="👥 Resource Allocations" sub={`${detail.resourceAllocations.length} employee${detail.resourceAllocations.length === 1 ? '' : 's'} allocated`}>
        {!detail.resourceAllocations.length ? (
          <Empty icon={<Users size={32} />} title="No allocations" desc="No approved/active allocations on this project" />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Employee</th><th>Designation</th><th>Allocated Hrs/wk</th><th>Utilization</th><th>Rate/hr</th><th>Weekly Cost</th></tr></thead>
              <tbody>{detail.resourceAllocations.map(a => (
                <tr key={a.employeeId}>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar name={a.name} /><span className="td-bold">{a.name}</span></div></td>
                  <td>{a.designation}</td>
                  <td>{a.allocatedHoursPerWeek}h</td>
                  <td style={{ fontWeight: 700, color: a.utilizationPercent == null ? '#94a3b8' : a.utilizationPercent > 100 ? '#ef4444' : a.utilizationPercent < 50 ? '#f59e0b' : '#10b981' }}>{a.utilizationPercent != null ? a.utilizationPercent + '%' : '—'}</td>
                  <td>{rupee(a.hourlyRate)}</td>
                  <td style={{ fontWeight: 700 }}>{rupee(a.computedWeeklyCost)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  )
}

function VendorView({ rows }) {
  const [expanded, setExpanded] = useState(null)
  const [detail, setDetail] = useState(null)
  const [drillLoading, setDrillLoading] = useState(false)

  async function toggle(vendorId) {
    if (!vendorId) return
    if (expanded === vendorId) { setExpanded(null); setDetail(null); return }
    setExpanded(vendorId); setDetail(null); setDrillLoading(true)
    setDetail(await getVendorDrilldown(vendorId))
    setDrillLoading(false)
  }

  if (!rows?.length) return <Empty icon={<Truck size={40} />} title="No vendor spend yet" desc="Recompute All after vendor invoices exist" />

  const totalSpend = rows.reduce((s, r) => s + Number(r.total_spend || 0), 0)
  const totalInvoices = rows.reduce((s, r) => s + Number(r.invoice_count || 0), 0)
  const spendMax = Math.max(...rows.map(r => Number(r.total_spend || 0)), 1)

  return (
    <div>
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <Kpi label="Total Vendor Spend" value={rupee(totalSpend)} color="#3b82f6" icon={<Wallet size={18} />} />
        <Kpi label="Vendors" value={rows.length} color="#8b5cf6" icon={<Truck size={18} />} />
        <Kpi label="Total Invoices" value={totalInvoices} color="#f59e0b" icon={<DollarSign size={18} />} />
        <Kpi label="Avg Spend / Vendor" value={rupee(rows.length ? totalSpend / rows.length : 0)} color="#10b981" icon={<TrendingUp size={18} />} />
      </div>

      <div className="table-wrap hover-lift">
        <div className="table-toolbar"><span style={{ fontWeight: 700, fontSize: 14 }}>By Vendor — top {rows.length} by spend, click for the PO → GRN → Invoice → Payment chain</span></div>
        <table>
          <thead><tr><th>Vendor</th><th>Category</th><th>Total Spend</th><th>Invoices</th><th>Projects</th></tr></thead>
          <tbody>{rows.map(r => (
            <Fragment key={r.id}>
              <tr style={{ cursor: r.vendor_id ? 'pointer' : 'default' }} onClick={() => toggle(r.vendor_id)}>
                <td><div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 200 }}>
                  <IconTile icon={Truck} color="#3b82f6" />
                  <div style={{ flex: 1 }}>
                    <div className="td-bold">{r.vendor?.name || '—'}</div>
                    <div style={{ marginTop: 3 }}><ProgressBar pct={(Number(r.total_spend || 0) / spendMax) * 100} color="#3b82f6" height={4} /></div>
                  </div>
                </div></td>
                <td>{r.vendor?.category || '—'}</td>
                <td>{rupee(r.total_spend)}</td>
                <td>{r.invoice_count}</td>
                <td>{r.project_count}</td>
              </tr>
              {expanded === r.vendor_id && (
                <tr><td colSpan={5} style={{ background: 'var(--surface-2)', padding: '18px 20px' }}>
                  {drillLoading ? <Loader /> : detail && (
                    <div>
                      <SectionLabel>PO → GRN → Invoice → Paid</SectionLabel>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 22, maxWidth: 360 }}>
                        {[
                          { stage: 'PO Issued', amount: detail.totals.poTotal },
                          { stage: 'GRN Received', amount: detail.totals.grnTotal },
                          { stage: 'Invoiced', amount: detail.totals.invoicedTotal },
                          { stage: 'Paid', amount: detail.totals.paidTotal },
                        ].map((s, i, arr) => (
                          <div key={s.stage} style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative', paddingBottom: i < arr.length - 1 ? 14 : 0 }}>
                            {i < arr.length - 1 && <div style={{ position: 'absolute', left: 5, top: 14, bottom: -2, width: 2, background: '#e2e8f0' }} />}
                            <div style={{ width: 12, height: 12, borderRadius: '50%', background: FUND_STAGE_COLORS[(i + 2) % FUND_STAGE_COLORS.length], flexShrink: 0, zIndex: 1, boxShadow: '0 0 0 3px #fff' }} />
                            <span style={{ fontSize: 12, flex: 1, color: '#64748b', fontWeight: 600 }}>{s.stage}</span>
                            <span style={{ fontSize: 12.5, fontWeight: 800 }}>{rupee(s.amount)}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 28 }}>
                        <div>
                          <SectionLabel>Purchase Orders ({detail.purchaseOrders.length})</SectionLabel>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {detail.purchaseOrders.slice(0, 6).map(po => (
                              <div key={po.id} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', maxWidth: 260 }}>
                                <span>{po.po_number}</span><span style={{ fontWeight: 700 }}>{rupee(po.total_amount)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <SectionLabel>Invoices ({detail.invoices.length})</SectionLabel>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {detail.invoices.slice(0, 6).map(inv => (
                              <div key={inv.id} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', maxWidth: 260 }}>
                                <span>{inv.project?.name || 'Unassigned'}</span><span style={{ fontWeight: 700 }}>{rupee(inv.total_amount)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </td></tr>
              )}
            </Fragment>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}

// Recursive BOM tree rows — indented by depth, each row clickable to jump
// straight into that component's own row in this same tab (its full
// requisitioned -> PO -> GRN -> deployed -> warranty picture), rather than
// duplicating that heavier per-part computation inside the tree itself.
function BomTreeRows({ node, depth, onJump }) {
  return (
    <>
      {(node.children || []).map(child => (
        <div key={child.id}>
          <div
            onClick={() => onJump(child.partNumber)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0',
              paddingLeft: depth * 18, cursor: 'pointer', borderRadius: 6,
            }}>
            <span style={{ color: '#cbd5e1' }}>{'└'.padStart(1, ' ')}</span>
            <span style={{ flex: 1, fontWeight: 600, color: 'var(--c1)' }}>{child.name}</span>
            <span style={{ color: '#94a3b8' }}>× {child.quantity}</span>
            <span style={{ fontWeight: 700, minWidth: 80, textAlign: 'right' }}>{rupee(child.lineCost)}</span>
            <span style={{ color: '#94a3b8', fontSize: 11, minWidth: 140, textAlign: 'right' }}>
              {child.inventory?.type === 'serialized'
                ? `${child.inventory.deployedCount} deployed / ${child.inventory.inStorageCount} in stock`
                : `reorder @ ${child.inventory?.reorderLevel ?? '—'}`}
            </span>
          </div>
          {child.children?.length > 0 && <BomTreeRows node={child} depth={depth + 1} onJump={onJump} />}
        </div>
      ))}
    </>
  )
}

function ProductView({ rows }) {
  const [expanded, setExpanded] = useState(null)
  const [detail, setDetail] = useState(null)
  const [bom, setBom] = useState(null)
  const [drillLoading, setDrillLoading] = useState(false)

  async function toggle(partNumber) {
    if (!partNumber) return
    if (expanded === partNumber) { setExpanded(null); setDetail(null); setBom(null); return }
    setExpanded(partNumber); setDetail(null); setBom(null); setDrillLoading(true)
    const [d, b] = await Promise.all([getProductDrilldown(partNumber), getBomInventoryBreakdown(partNumber)])
    setDetail(d); setBom(b)
    setDrillLoading(false)
  }

  if (!rows?.length) return <Empty icon={<Cpu size={40} />} title="No product requisition history yet" desc="Products show up here once they appear on a purchase requisition line item" />

  const totalRequisitioned = rows.reduce((s, r) => s + Number(r.requisitionedTotal || 0), 0)
  const totalDeployed = rows.reduce((s, r) => s + Number(r.deployedCount || 0), 0)
  const totalWarrantyCost = rows.reduce((s, r) => s + Number(r.warrantyCostTotal || 0), 0)
  const spendMax = Math.max(...rows.map(r => Number(r.requisitionedTotal || 0)), 1)

  return (
    <div>
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <Kpi label="Total Requisitioned" value={rupee(totalRequisitioned)} color="#3b82f6" icon={<Wallet size={18} />} />
        <Kpi label="Products Tracked" value={rows.length} color="#8b5cf6" icon={<Cpu size={18} />} />
        <Kpi label="Total Deployed Units" value={totalDeployed} color="#10b981" icon={<Package size={18} />} />
        <Kpi label="Warranty Cost" value={rupee(totalWarrantyCost)} color="#ef4444" icon={<ShieldCheck size={18} />} />
      </div>

      <div className="table-wrap hover-lift">
        <div className="table-toolbar"><span style={{ fontWeight: 700, fontSize: 14 }}>By Product — top {rows.length} by requisitioned spend, click for the requisitioned → PO → GRN → deployed → warranty chain</span></div>
        <table>
          <thead><tr><th>Product</th><th>Part #</th><th>Requisitioned</th><th>Qty</th><th>Deployed</th></tr></thead>
          <tbody>{rows.map(r => (
            <Fragment key={r.part_number}>
              <tr style={{ cursor: 'pointer' }} onClick={() => toggle(r.part_number)}>
                <td><div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 200 }}>
                  <IconTile icon={Cpu} color="#3b82f6" />
                  <div style={{ flex: 1 }}>
                    <div className="td-bold">{r.name}</div>
                    <div style={{ marginTop: 3 }}><ProgressBar pct={(Number(r.requisitionedTotal || 0) / spendMax) * 100} color="#3b82f6" height={4} /></div>
                  </div>
                </div></td>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.part_number}</td>
                <td>{rupee(r.requisitionedTotal)}</td>
                <td>{r.requisitionedQty}</td>
                <td>{r.deployedCount}</td>
              </tr>
              {expanded === r.part_number && (
                <tr><td colSpan={5} style={{ background: 'var(--surface-2)', padding: '18px 20px' }}>
                  {drillLoading ? <Loader /> : detail && (
                    <div>
                      <SectionLabel>Requisitioned → PO Issued → GRN Received → Deployed</SectionLabel>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 10, maxWidth: 360 }}>
                        {[
                          { stage: 'Requisitioned', amount: detail.totals.requisitionedTotal },
                          { stage: 'PO Issued', amount: detail.totals.poTotal },
                          { stage: 'GRN Received', amount: detail.totals.grnTotal },
                        ].map((s, i, arr) => (
                          <div key={s.stage} style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative', paddingBottom: i < arr.length - 1 ? 14 : 0 }}>
                            {i < arr.length - 1 && <div style={{ position: 'absolute', left: 5, top: 14, bottom: -2, width: 2, background: '#e2e8f0' }} />}
                            <div style={{ width: 12, height: 12, borderRadius: '50%', background: FUND_STAGE_COLORS[i % FUND_STAGE_COLORS.length], flexShrink: 0, zIndex: 1, boxShadow: '0 0 0 3px #fff' }} />
                            <span style={{ fontSize: 12, flex: 1, color: '#64748b', fontWeight: 600 }}>{s.stage}</span>
                            <span style={{ fontSize: 12.5, fontWeight: 800 }}>{rupee(s.amount)}</span>
                          </div>
                        ))}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4 }}>
                          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#10b981', flexShrink: 0, boxShadow: '0 0 0 3px #fff' }} />
                          <span style={{ fontSize: 12, flex: 1, color: '#64748b', fontWeight: 600 }}>Deployed</span>
                          <span style={{ fontSize: 12.5, fontWeight: 800 }}>{detail.deployedCount} unit{detail.deployedCount === 1 ? '' : 's'}</span>
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 22, maxWidth: 420 }}>
                        PO/GRN figures are requisition-level — a PO or GRN total may include other line items from the same requisition, not just this product. Invoiced/Paid can't be traced to a single product line item with the current schema, so they're not shown here.
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 28 }}>
                        <div>
                          <SectionLabel>
                            <ShieldCheck size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
                            Warranty
                          </SectionLabel>
                          {detail.warranty ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, maxWidth: 260 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Claims</span><span style={{ fontWeight: 700 }}>{detail.warranty.claims_count}</span></div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Claim rate</span><span style={{ fontWeight: 700 }}>{detail.warranty.claim_rate_per_100}%</span></div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Actual cost</span><span style={{ fontWeight: 700 }}>{rupee(detail.warranty.actual_cost_total)}</span></div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Planned reserve</span><span style={{ fontWeight: 700 }}>{rupee(detail.warranty.planned_reserve_total)}</span></div>
                            </div>
                          ) : <div style={{ fontSize: 12, color: '#94a3b8' }}>No warranty claims recorded for this product.</div>}
                        </div>
                        <div>
                          <SectionLabel>Devices ({detail.devices.length})</SectionLabel>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {detail.devices.slice(0, 8).map(dv => (
                              <div key={dv.id} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', maxWidth: 260 }}>
                                <span style={{ fontFamily: 'monospace' }}>{dv.serial_number}</span><span style={{ fontWeight: 700, textTransform: 'capitalize' }}>{dv.status}</span>
                              </div>
                            ))}
                            {detail.devices.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>No devices deployed yet.</div>}
                          </div>
                        </div>
                      </div>

                      {bom?.tree?.children?.length > 0 && (
                        <div style={{ marginTop: 22 }}>
                          <SectionLabel>
                            <Boxes size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
                            Bill of Materials — rolled-up {rupee(bom.rolledUpCost)} vs. standard cost {rupee(bom.standardCost)}
                          </SectionLabel>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 520 }}>
                            <BomTreeRows node={bom.tree} depth={0} onJump={toggle} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </td></tr>
              )}
            </Fragment>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}

/* ── Section 3 — prescriptive findings ── */
function FindingsView({ rows, onStatus }) {
  if (!rows?.length) return <Empty icon={<Lightbulb size={40} />} title="No findings yet" desc="Click Recompute All to scan for planning-improvement opportunities" />

  const countByStatus = s => rows.filter(f => f.status === s).length
  const totalImpact = rows.reduce((s, f) => s + Number(f.impact_amount || 0), 0)

  return (
    <div>
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <Kpi label="New" value={countByStatus('new')} color={STATUS_C.new} icon={<Lightbulb size={18} />} />
        <Kpi label="Acknowledged" value={countByStatus('acknowledged')} color={STATUS_C.acknowledged} icon={<Lightbulb size={18} />} />
        <Kpi label="Actioned" value={countByStatus('actioned')} color={STATUS_C.actioned} icon={<Lightbulb size={18} />} />
        <Kpi label="Dismissed" value={countByStatus('dismissed')} color={STATUS_C.dismissed} icon={<Lightbulb size={18} />} />
        <Kpi label="Total Estimated Impact" value={rupee(totalImpact)} color="#ef4444" icon={<AlertTriangle size={18} />} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map(f => (
        <div key={f.id} className="card hover-lift">
          <div className="card-body" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ padding: '2px 9px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: '#6366f118', color: '#6366f1' }}>{FINDING_LABELS[f.finding_type]}</span>
                <span style={{ padding: '2px 9px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: `${STATUS_C[f.status]}18`, color: STATUS_C[f.status], textTransform: 'capitalize' }}>{f.status}</span>
              </div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{f.title}</div>
              <div style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.5 }}>{f.description}</div>
              {f.impact_amount > 0 && <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: '#ef4444' }}>Estimated impact: {rupee(f.impact_amount)}</div>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
              {f.status === 'new' && <button className="btn btn-outline btn-sm" onClick={() => onStatus(f.id, 'acknowledged')}>Acknowledge</button>}
              {f.status !== 'actioned' && <button className="btn btn-primary btn-sm" onClick={() => onStatus(f.id, 'actioned')}>Mark Actioned</button>}
              {f.status !== 'dismissed' && <button className="btn btn-outline btn-sm" onClick={() => onStatus(f.id, 'dismissed')}>Dismiss</button>}
            </div>
          </div>
        </div>
      ))}
      </div>
    </div>
  )
}

/* ── Section 4 — forecast ── */
function ForecastView({ data }) {
  if (!data) return <Empty icon={<Radar size={40} />} title="No forecast data" desc="Recompute All to build the forecast" />
  return (
    <div>
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <Kpi label="Projected Company Spend (if nothing changes)" value={rupee(data.companyProjectedTotal)} color="#6366f1" icon={<TrendingUp size={18} />} />
        <Kpi label="Projects At Risk of Overrun" value={data.atRiskCount} color="#ef4444" icon={<AlertTriangle size={18} />} />
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>v1 simple linear projection from current burn pace — not a statistical forecast.</div>
      {!data.atRisk.length ? <Empty icon={<Radar size={36} />} title="No projects currently at risk" desc="No active project's burn pace projects an overrun" /> : (
        <div className="table-wrap hover-lift">
          <div className="table-toolbar"><span style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={14} style={{ color: '#ef4444' }} /> At risk of overrun before completion</span></div>
          <table>
            <thead><tr><th>Project</th><th>Budget</th><th>Spent to Date</th><th>Projected Final Spend</th><th>Projected Overrun</th></tr></thead>
            <tbody>{data.atRisk.map(r => {
              const pct = r.budgetAllocated > 0 ? Math.round((r.projectedFinalSpend / r.budgetAllocated) * 100) : 0
              return (
                <tr key={r.project_id}>
                  <td><div style={{ minWidth: 180 }}>
                    <div className="td-bold">{r.name}</div>
                    <div style={{ marginTop: 4 }}><ProgressBar pct={Math.min(100, pct)} color={pct > 100 ? '#ef4444' : '#f59e0b'} height={4} /></div>
                  </div></td>
                  <td>{rupee(r.budgetAllocated)}</td>
                  <td>{rupee(r.spendToDate)}</td>
                  <td style={{ fontWeight: 700 }}>{rupee(r.projectedFinalSpend)} <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>({pct}%)</span></td>
                  <td style={{ color: '#ef4444', fontWeight: 700 }}>{rupee(r.overBy)}</td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ── Section 5 — benchmarking ── */
function BenchmarkView({ rows }) {
  if (!rows?.length) return <Empty icon={<Scale size={40} />} title="No benchmark data" desc="Set a Project Type on projects (Projects → Edit) to enable peer comparison" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 11, color: '#94a3b8' }}>"Similar" = same Project Type — set on each project's edit form. Feeds the Budget Wizard's "copy from similar project" suggestions.</div>
      {rows.map(g => (
        <div key={g.project_type} className="card hover-lift">
          <div className="card-header"><span className="card-title">{g.project_type} <span style={{ color: '#94a3b8', fontWeight: 500 }}>({g.projectCount} projects)</span></span></div>
          <div className="card-body">
            <div style={{ display: 'flex', gap: 24, marginBottom: 14, flexWrap: 'wrap' }}>
              <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Avg Budget Utilization</div><div style={{ fontSize: 18, fontWeight: 800 }}>{g.avgBudgetUtilPct}%</div></div>
              <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Avg Margin</div><div style={{ fontSize: 18, fontWeight: 800, color: g.avgMarginPct >= 0 ? '#10b981' : '#ef4444' }}>{g.avgMarginPct != null ? g.avgMarginPct + '%' : '—'}</div></div>
            </div>
            <table>
              <thead><tr><th>Project</th><th>Budget Util %</th><th>Burn Pace</th><th>Margin %</th></tr></thead>
              <tbody>{g.projects.map(p => (
                <tr key={p.id}>
                  <td><div style={{ minWidth: 160 }}>
                    <div className="td-bold">{p.name}</div>
                    <div style={{ marginTop: 4 }}><ProgressBar pct={p.budgetUtilPct} color={p.budgetUtilPct > 100 ? '#ef4444' : p.budgetUtilPct > 80 ? '#f59e0b' : '#10b981'} height={4} /></div>
                  </div></td>
                  <td>{p.budgetUtilPct}%</td>
                  <td>{p.burnPaceRatio != null ? p.burnPaceRatio : '—'}</td>
                  <td style={{ color: p.marginPct != null ? (p.marginPct >= 0 ? '#10b981' : '#ef4444') : undefined, fontWeight: 700 }}>{p.marginPct != null ? p.marginPct + '%' : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

// Component-only view — a Component is a BOM ingredient (raw/bulk part),
// never a BOM subject itself (see BomManagementPage.jsx / ProductsPage.jsx,
// which now restrict BOM assignment to is_serialized products only). Spend
// comes from the same getSpendByProduct() the By Product tab uses, filtered
// to !is_serialized; stock comes from the same getInventoryList() the
// Inventory → Components tab uses — neither number is re-derived here.
function ComponentView({ spend, list }) {
  if (!spend || !list) return <Loader />
  if (list.length === 0) return <Empty icon={<Boxes size={40} />} title="No components in the catalog yet" desc="Add components under Inventory → Components, or import a batch" />

  const spendByPart = Object.fromEntries(spend.map(r => [r.part_number, r]))
  const totalSpend = spend.reduce((s, r) => s + r.requisitionedTotal, 0)
  const totalStockValue = list.reduce((s, i) => s + i.totalValue, 0)
  const lowStock = list.filter(i => i.lowStock).sort((a, b) => (a.onHand / (a.reorder_level || 1)) - (b.onHand / (b.reorder_level || 1)))
  const byValue = [...list].sort((a, b) => b.totalValue - a.totalValue).slice(0, 15)

  return (
    <div>
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <Kpi label="Components Tracked" value={list.length} color="#6366f1" icon={<Boxes size={18} />} />
        <Kpi label="Total Stock Value" value={rupee(totalStockValue)} color="#10b981" icon={<Wallet size={18} />} />
        <Kpi label="Low Stock Alerts" value={lowStock.length} color="#ef4444" icon={<AlertTriangle size={18} />} />
        <Kpi label="Requisitioned Spend" value={rupee(totalSpend)} color="#f59e0b" icon={<ShoppingCart size={18} />} />
      </div>

      {lowStock.length > 0 && (
        <ChartCard title="⚠️ Below Reorder Level" sub="Sorted by most critical shortfall first">
          <table>
            <thead><tr><th>Part #</th><th>Name</th><th>Family</th><th>On Hand</th><th>Reorder Level</th></tr></thead>
            <tbody>{lowStock.map(i => (
              <tr key={i.part_number}>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{i.part_number}</td>
                <td className="td-bold">{i.name}</td>
                <td style={{ fontSize: 11, color: '#64748b' }}>{i.device_type || '—'}</td>
                <td style={{ fontWeight: 700, color: '#dc2626' }}>{i.onHand}</td>
                <td>{i.reorder_level}</td>
              </tr>
            ))}</tbody>
          </table>
        </ChartCard>
      )}

      <div style={{ marginTop: lowStock.length > 0 ? 20 : 0 }}>
        <ChartCard title="📦 Component Stock & Spend" sub="Top 15 by total value on hand" action={<Link to="/inventory?view=components" style={{ fontSize: 12, color: 'var(--c1)', fontWeight: 700, textDecoration: 'none' }}>Manage Components →</Link>}>
          <table>
            <thead><tr><th>Part #</th><th>Name</th><th>Family</th><th>On Hand</th><th>Unit Cost</th><th>Total Value</th><th>Requisitioned Spend</th></tr></thead>
            <tbody>{byValue.map(i => (
              <tr key={i.part_number}>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{i.part_number}</td>
                <td className="td-bold">{i.name}</td>
                <td style={{ fontSize: 11, color: '#64748b' }}>{i.device_type || '—'}</td>
                <td>{i.onHand}</td>
                <td>{rupee(i.unitCost)}</td>
                <td style={{ fontWeight: 700 }}>{rupee(i.totalValue)}</td>
                <td style={{ color: '#f59e0b', fontWeight: 600 }}>{rupee(spendByPart[i.part_number]?.requisitionedTotal || 0)}</td>
              </tr>
            ))}</tbody>
          </table>
        </ChartCard>
      </div>
    </div>
  )
}

// Device-only view — a Device is a serialized Product with real registered
// units (device_instances). Fleet health comes from getDeviceFleetStats()
// (same status/warranty logic DashboardPage.jsx and DevicesPage.jsx use);
// spend comes from the same getSpendByProduct() the By Product tab uses,
// filtered to is_serialized.
function DeviceView({ spend, fleet }) {
  if (!spend || !fleet) return <Loader />
  if (spend.length === 0) return <Empty icon={<Cpu size={40} />} title="No devices requisitioned yet" desc="Serialized products show up here once they appear on a purchase requisition line item" />

  const totalSpend = spend.reduce((s, r) => s + r.requisitionedTotal, 0)
  const totals = Object.values(fleet).reduce((acc, f) => ({
    deployed: acc.deployed + f.deployedCount, inStorage: acc.inStorage + f.inStorageCount,
    attention: acc.attention + f.attentionCount, warrantySoon: acc.warrantySoon + f.warrantySoonCount,
  }), { deployed: 0, inStorage: 0, attention: 0, warrantySoon: 0 })
  const byValue = [...spend].sort((a, b) => b.requisitionedTotal - a.requisitionedTotal)

  return (
    <div>
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <Kpi label="Devices Tracked" value={spend.length} color="#6366f1" icon={<Cpu size={18} />} />
        <Kpi label="Total Requisitioned" value={rupee(totalSpend)} color="#3b82f6" icon={<Wallet size={18} />} />
        <Kpi label="Deployed Units" value={totals.deployed} color="#10b981" icon={<Package size={18} />} />
        <Kpi label="Needing Attention" value={totals.attention} color="#ef4444" icon={<AlertTriangle size={18} />} />
      </div>

      {totals.warrantySoon > 0 && (
        <div style={{ marginBottom: 20, padding: '12px 16px', borderRadius: 12, background: 'linear-gradient(135deg,#fff7ed,#ffedd5)', border: '1px solid #fed7aa', fontSize: 13, color: '#9a3412', fontWeight: 600 }}>
          ⏰ {totals.warrantySoon} unit{totals.warrantySoon !== 1 ? 's' : ''} across the fleet have warranty expiring within 30 days.
        </div>
      )}

      <ChartCard title="📟 Device Fleet & Spend" sub="Sorted by total requisitioned spend" action={<Link to="/devices" style={{ fontSize: 12, color: 'var(--c1)', fontWeight: 700, textDecoration: 'none' }}>Manage Devices →</Link>}>
        <table>
          <thead><tr><th>Part #</th><th>Name</th><th>Requisitioned Spend</th><th>Deployed</th><th>In Storage</th><th>Attention</th><th>Warranty ≤30d</th></tr></thead>
          <tbody>{byValue.map(r => {
            const f = fleet[r.part_number] || {}
            return (
              <tr key={r.part_number}>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.part_number}</td>
                <td className="td-bold">{r.name}</td>
                <td style={{ fontWeight: 700 }}>{rupee(r.requisitionedTotal)}</td>
                <td style={{ color: '#10b981', fontWeight: 700 }}>{f.deployedCount || 0}</td>
                <td>{f.inStorageCount || 0}</td>
                <td style={{ color: f.attentionCount ? '#dc2626' : 'inherit', fontWeight: f.attentionCount ? 700 : 400 }}>{f.attentionCount || 0}</td>
                <td style={{ color: f.warrantySoonCount ? '#f97316' : 'inherit', fontWeight: f.warrantySoonCount ? 700 : 400 }}>{f.warrantySoonCount || 0}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </ChartCard>
    </div>
  )
}
