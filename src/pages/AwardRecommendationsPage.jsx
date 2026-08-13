import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getAward, getAwardRecommendations, computeScoresForAward } from '../lib/awards'
import { Loader, Empty, StatusBadge } from '../components/ui'
import { BarChart3, RefreshCw, ArrowLeft } from 'lucide-react'

const RECOMMENDATION_COLOR = {
  'Strongly Recommended': { bg: '#dcfce7', color: '#15803d' },
  'Recommended': { bg: '#dbeafe', color: '#1d4ed8' },
  'Consider': { bg: '#fef3c7', color: '#b45309' },
  'Not Recommended': { bg: '#f1f5f9', color: '#64748b' },
}
const RecommendationPill = ({ label }) => {
  if (!label) return <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>—</span>
  const c = RECOMMENDATION_COLOR[label] || { bg: '#f1f5f9', color: '#64748b' }
  return <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: c.bg, color: c.color, whiteSpace: 'nowrap' }}>{label}</span>
}

export default function AwardRecommendationsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [award, setAward] = useState(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [calculating, setCalculating] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [id])
  async function load() {
    setLoading(true)
    const [a, r] = await Promise.all([getAward(id), getAwardRecommendations(id)])
    setAward(a); setRows(r); setLoading(false)
  }

  async function handleCalculate() {
    setCalculating(true); setErr('')
    try { await computeScoresForAward(id); await load() }
    catch (e) { setErr(e.message) }
    finally { setCalculating(false) }
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <button className="btn btn-ghost btn-sm" style={{ marginBottom: 8 }} onClick={() => navigate('/awards')}><ArrowLeft size={13} /> Back to Awards</button>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#4338ca)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <BarChart3 size={19} />
            </span>
            {award.name} — Recommendations
          </div>
          <div className="page-subtitle">Weighted score, rank and recommendation for every participant · <StatusBadge status={award.status} /></div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={handleCalculate} disabled={calculating}>
            <RefreshCw size={15} /> {calculating ? 'Calculating…' : 'Calculate Scores & Recommendations'}
          </button>
        </div>
      </div>

      {err && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{err}</div>}

      {rows.length === 0 ? (
        <Empty icon={<BarChart3 size={40} />} title="No participants yet" desc="Publish the award to snapshot eligible employees first" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Rank</th><th>Employee</th><th>Self</th><th>Manager</th><th>Peer</th><th>Performance</th><th>Final Score</th><th>Recommendation</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="td-bold">{r.rank ? `#${r.rank}` : '—'}</td>
                  <td>
                    <div className="td-bold">{r.employee?.full_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{r.employee?.designation || '—'} · {r.employee?.dept?.name || '—'}</div>
                  </td>
                  <td>{r.scoreDetail?.self_score ?? '—'}</td>
                  <td>{r.scoreDetail?.manager_score ?? '—'}</td>
                  <td>{r.scoreDetail?.peer_score ?? '—'}</td>
                  <td>{r.scoreDetail?.performance_score ?? '—'}</td>
                  <td className="td-bold">{r.final_score ?? '—'}</td>
                  <td><RecommendationPill label={r.recommendation_label} /></td>
                  <td><StatusBadge status={r.status === 'granted' ? 'approved' : r.status === 'not_selected' ? 'rejected' : 'processing'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
