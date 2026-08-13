import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { listAllScenarios } from '../lib/scenarios'
import { Loader, Alert, StatusBadge, Empty, SearchBox } from '../components/ui'
import { dateFmt } from '../lib/supabase'
import { Plus, LayoutGrid, GitCompare, ClipboardCheck } from 'lucide-react'

function latestOf(scenario) {
  const versions = scenario.latest_version || scenario.versions || []
  return versions.slice().sort((a, b) => b.version_number - a.version_number)[0] || null
}

const STATUS_FILTERS = ['all', 'draft', 'simulated', 'submitted', 'under_review', 'approved', 'executed', 'rejected']

export default function AllScenariosPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [scenarios, setScenarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'all')

  useEffect(() => {
    listAllScenarios().then(setScenarios).catch(e => setErr(e.message)).finally(() => setLoading(false))
  }, [])

  const filtered = scenarios.filter(s => {
    if (q && !s.name.toLowerCase().includes(q.toLowerCase()) && !s.code?.toLowerCase().includes(q.toLowerCase())) return false
    if (statusFilter !== 'all' && latestOf(s)?.status !== statusFilter) return false
    return true
  })

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">All Scenarios</div>
          <div className="page-subtitle">Every scenario across the organisation</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/scenarios/templates" className="btn btn-ghost"><LayoutGrid size={15} /> Templates</Link>
          <Link to="/scenarios/compare" className="btn btn-ghost"><GitCompare size={15} /> Compare</Link>
          <Link to="/scenarios/approvals" className="btn btn-ghost"><ClipboardCheck size={15} /> Approvals</Link>
          <button className="btn btn-primary" onClick={() => navigate('/scenarios/new')}><Plus size={15} /> New Scenario</button>
        </div>
      </div>

      {err && <Alert type="error" message={err} />}

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ maxWidth: 320, flex: 1 }}>
          <SearchBox value={q} onChange={setQ} placeholder="Search scenarios…" />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map(s => (
            <button key={s} className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setStatusFilter(s)}>
              {s === 'all' ? 'All' : s.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty title="No scenarios found" desc="Try a different search or filter." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(s => {
            const v = latestOf(s)
            return (
              <Link key={s.id} to={v ? `/scenarios/${v.id}` : '#'} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', textDecoration: 'none', color: 'inherit' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{s.code} · {s.creator?.full_name || 'Unknown'} · v{v?.version_number || 1}</div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{dateFmt(v?.updated_at || s.created_at)}</div>
                {v && <StatusBadge status={v.status} />}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
