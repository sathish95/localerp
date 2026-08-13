import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { listAllScenarios, listMyScenarios, listPendingApprovals, getPortfolioSummary } from '../lib/scenarios'
import { Loader, Alert, StatusBadge, Empty } from '../components/ui'
import { dateFmt, rupee } from '../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Layers, Clock, CheckCircle, Rocket, Plus, ClipboardCheck, DollarSign, AlertTriangle } from 'lucide-react'

const APPROVER_ROLES = ['admin', 'ceo', 'finance', 'department_head']
const STATUS_COLORS = { draft: '#94a3b8', simulated: '#6366f1', submitted: '#f59e0b', under_review: '#f59e0b', changes_requested: '#ec4899', approved: '#10b981', executed: '#10b981', rejected: '#dc2626', superseded: '#94a3b8' }

// Phase 15 asks for CEO/CFO/COO/PMO/Dept Head/Manager dashboards, but
// this app's real role model (CLAUDE.md) only has admin/ceo/manager/
// department_head/finance/hr/employee — no distinct CFO/COO/PMO. Rather
// than invent roles that don't exist anywhere else in the app, the
// requested audiences are mapped onto the real ones: admin/ceo get the
// full executive view (this is who CEO/COO duties fall to here),
// finance gets the financial-rollup view (the CFO-equivalent lens),
// manager/department_head get the team/approver view (PMO/Dept Head),
// everyone else gets a personal-only view — mirroring this app's own
// existing precedent of not exposing org-wide pipeline financials below
// management level (see sales_profit_attribution in CLAUDE.md).
function viewFor(role) {
  if (['admin', 'ceo'].includes(role)) return 'executive'
  if (role === 'finance') return 'financial'
  if (['manager', 'department_head'].includes(role)) return 'team'
  return 'personal'
}

function latestOf(scenario) {
  const versions = scenario.latest_version || scenario.versions || []
  return versions.slice().sort((a, b) => b.version_number - a.version_number)[0] || null
}

function statusChartData(items) {
  const statuses = items.map(latestOf).map(v => v?.status).filter(Boolean)
  const counts = statuses.reduce((acc, s) => { acc[s] = (acc[s] || 0) + 1; return acc }, {})
  return Object.entries(counts).map(([status, count]) => ({ status: status.replace(/_/g, ' '), count, fill: STATUS_COLORS[status] || '#6366f1' }))
}

export default function ScenarioDashboardPage() {
  const { profile } = useAuth()
  const view = viewFor(profile?.role)
  const isApprover = APPROVER_ROLES.includes(profile?.role)
  const showPortfolio = view === 'executive' || view === 'financial'

  const [all, setAll] = useState([])
  const [mine, setMine] = useState([])
  const [pending, setPending] = useState([])
  const [portfolio, setPortfolio] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    Promise.all([
      view === 'personal' ? Promise.resolve([]) : listAllScenarios(),
      listMyScenarios(),
      isApprover ? listPendingApprovals() : Promise.resolve([]),
      showPortfolio ? getPortfolioSummary() : Promise.resolve([]),
    ]).then(([a, m, p, ps]) => { setAll(a); setMine(m); setPending(p); setPortfolio(ps) })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, [view, isApprover, showPortfolio])

  if (loading) return <Loader />

  const committed = portfolio.filter(p => ['approved', 'executed'].includes(p.status))
  const totalCost = committed.reduce((s, p) => s + Number(p.total_projected_cost), 0)
  const totalRevenue = committed.reduce((s, p) => s + Number(p.total_projected_revenue), 0)
  const totalMargin = committed.reduce((s, p) => s + Number(p.total_projected_margin), 0)
  const avgRisk = portfolio.length ? portfolio.reduce((s, p) => s + Number(p.avg_risk_score) * Number(p.scenario_count), 0) / portfolio.reduce((s, p) => s + Number(p.scenario_count), 0) : 0

  const orgChart = statusChartData(all)
  const mineChart = statusChartData(mine)
  const recent = (view === 'personal' ? mine : all).slice(0, 6)

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Scenario Dashboard</div>
          <div className="page-subtitle">
            {view === 'executive' && 'Portfolio-wide what-if modelling overview'}
            {view === 'financial' && 'Financial rollup across all scenarios'}
            {view === 'team' && 'Your scenarios and decisions awaiting you'}
            {view === 'personal' && 'Your scenarios'}
          </div>
        </div>
        <Link to="/scenarios/new" className="btn btn-primary"><Plus size={15} /> New Scenario</Link>
      </div>

      {err && <Alert type="error" message={err} />}

      {showPortfolio && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 24 }}>
          <StatCardLink to="/scenarios?status=approved" label="Committed Cost" value={rupee(totalCost)} icon={<DollarSign size={16} />} accent="#dc2626" />
          <StatCardLink to="/scenarios?status=approved" label="Committed Revenue" value={rupee(totalRevenue)} icon={<DollarSign size={16} />} accent="#10b981" />
          <StatCardLink to="/scenarios?status=approved" label="Committed Margin" value={rupee(totalMargin)} icon={<DollarSign size={16} />} accent="#6366f1" />
          <StatCardLink to="/scenarios" label="Avg Risk Score" value={avgRisk.toFixed(1)} icon={<AlertTriangle size={16} />} accent="#f59e0b" />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 24 }}>
        {view !== 'personal' && <StatCardLink to="/scenarios" label="Total Scenarios" value={all.length} icon={<Layers size={16} />} accent="#6366f1" />}
        <StatCardLink to="/scenarios/my" label="My Scenarios" value={mine.length} icon={<Layers size={16} />} accent="#0ea5e9" />
        {isApprover && <StatCardLink to="/scenarios/approvals" label="Pending Approval" value={pending.length} icon={<Clock size={16} />} accent="#f59e0b" />}
        {view !== 'personal' && <StatCardLink to="/scenarios" label="Approved" value={all.filter(s => latestOf(s)?.status === 'approved').length} icon={<CheckCircle size={16} />} accent="#10b981" />}
        {view !== 'personal' && <StatCardLink to="/scenarios" label="Executed" value={all.filter(s => latestOf(s)?.status === 'executed').length} icon={<Rocket size={16} />} accent="#15803d" />}
      </div>

      <div className="card" style={{ padding: 18, marginBottom: 24 }}>
        <h3 style={{ fontWeight: 800, marginBottom: 12 }}>{view === 'personal' ? 'My Scenarios by Status' : 'Scenarios by Status'}</h3>
        {(view === 'personal' ? mineChart : orgChart).length === 0 ? <Empty title="No scenarios yet" /> : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={view === 'personal' ? mineChart : orgChart}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="status" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {isApprover && pending.length > 0 && (
        <div className="card" style={{ padding: 18, marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontWeight: 800, margin: 0 }}>Awaiting Your Decision</h3>
            <Link to="/scenarios/approvals" className="btn btn-ghost btn-sm"><ClipboardCheck size={13} /> View all</Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pending.slice(0, 5).map(v => (
              <Link key={v.id} to={`/scenarios/${v.id}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, textDecoration: 'none', color: 'inherit', fontSize: 13 }}>
                <span>{v.scenario?.name} <span style={{ color: 'var(--ink-muted)' }}>v{v.version_number}</span></span>
                <StatusBadge status={v.status} />
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ fontWeight: 800, marginBottom: 12 }}>{view === 'personal' ? 'My Recent Scenarios' : 'Recent Scenarios'}</h3>
        {recent.length === 0 ? <Empty title="No scenarios yet" desc="Create your first scenario to get started." /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recent.map(s => {
              const v = latestOf(s)
              return (
                <Link key={s.id} to={v ? `/scenarios/${v.id}` : '#'} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, textDecoration: 'none', color: 'inherit', fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>{s.name}</span>
                  <span style={{ color: 'var(--ink-muted)' }}>{dateFmt(s.created_at)}</span>
                  {v && <StatusBadge status={v.status} />}
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCardLink({ to, label, value, icon, accent }) {
  return (
    <Link to={to} style={{ textDecoration: 'none' }}>
      <div className="stat-card" style={{ borderTopColor: accent }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: `${accent}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent }}>{icon}</div>
        </div>
        <div className="stat-value" style={{ color: accent }}>{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </Link>
  )
}
