import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { rupee } from '../lib/supabase'
import { MARGIN_VISIBLE_ROLES, recomputeAllMargins, getAllMargins } from '../lib/profitMargin'
import { Loader, Empty } from '../components/ui'
import { RefreshCw, Percent } from 'lucide-react'

export default function ProfitMarginPage() {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const canView = MARGIN_VISIBLE_ROLES.includes(role)

  const [margins, setMargins] = useState([])
  const [loading, setLoading] = useState(true)
  const [recomputing, setRecomputing] = useState(false)

  useEffect(() => { if (canView) load() }, [canView])

  async function load() {
    setLoading(true)
    // If the role check somehow doesn't match server-side (stale client state,
    // role changed elsewhere), the STEP35 RLS policy is what actually enforces
    // this — a non-permitted caller just gets an empty array back, no error.
    setMargins(await getAllMargins())
    setLoading(false)
  }

  async function recomputeAll() {
    setRecomputing(true)
    try { await recomputeAllMargins(profile.id); await load() } finally { setRecomputing(false) }
  }

  if (!canView) {
    return (
      <div>
        <div className="page-header"><div><div className="page-title">Profit Margins</div><div className="page-subtitle">Restricted to Finance & Leadership</div></div></div>
        <Empty icon={<Percent size={44} />} title="No data to show" desc="This view is limited to Finance and Leadership roles" />
      </div>
    )
  }

  if (loading) return <Loader />

  const totalRevenue = margins.reduce((s, m) => s + Number(m.revenue_recognized || 0), 0)
  const totalCost = margins.reduce((s, m) => s + Number(m.total_actual_cost || 0), 0)
  const totalMargin = totalRevenue - totalCost
  const avgMarginPct = totalRevenue > 0 ? Math.round((totalMargin / totalRevenue) * 10000) / 100 : 0

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Profit Margins</div>
          <div className="page-subtitle">Revenue vs actual cost, per project — Finance & Leadership only</div>
        </div>
        <button className="btn btn-outline" onClick={recomputeAll} disabled={recomputing}>
          <RefreshCw size={14} style={{ marginRight: 6 }} /> {recomputing ? 'Recomputing…' : 'Recompute All'}
        </button>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card"><div className="stat-value" style={{ color: '#3b82f6' }}>{rupee(totalRevenue)}</div><div className="stat-label">Total Revenue</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: '#f59e0b' }}>{rupee(totalCost)}</div><div className="stat-label">Total Actual Cost</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: totalMargin >= 0 ? '#10b981' : '#ef4444' }}>{rupee(totalMargin)}</div><div className="stat-label">Gross Margin</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: avgMarginPct >= 0 ? '#10b981' : '#ef4444' }}>{avgMarginPct}%</div><div className="stat-label">Margin %</div></div>
      </div>

      <div className="table-wrap">
        <div className="table-toolbar">
          <span style={{ fontWeight: 700, fontSize: 14 }}>By Project</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{margins.length} projects</span>
        </div>
        {margins.length === 0 ? (
          <Empty icon={<Percent size={40} />} title="No margin data yet" desc="Click Recompute All to compute margins for active projects" />
        ) : (
          <table>
            <thead><tr><th>Project</th><th>Revenue</th><th>Actual Cost</th><th>Margin</th><th>Margin %</th></tr></thead>
            <tbody>
              {margins.map(m => (
                <tr key={m.id}>
                  <td className="td-bold">{m.project?.name || '—'}</td>
                  <td>{rupee(m.revenue_recognized)}</td>
                  <td>{rupee(m.total_actual_cost)}</td>
                  <td style={{ fontWeight: 700, color: m.gross_margin >= 0 ? '#10b981' : '#ef4444' }}>{rupee(m.gross_margin)}</td>
                  <td style={{ fontWeight: 700, color: m.margin_percent >= 0 ? '#10b981' : '#ef4444' }}>{m.margin_percent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
