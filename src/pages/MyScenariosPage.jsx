import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { listMyScenarios } from '../lib/scenarios'
import { Loader, Alert, StatusBadge, Empty, SearchBox } from '../components/ui'
import { dateFmt } from '../lib/supabase'
import AIDockedPanel from '../components/AIDockedPanel'
import { ScenarioAiTab } from '../components/AIActionTabs'
import { Plus, Sparkles } from 'lucide-react'

function latestOf(scenario) {
  const versions = scenario.latest_version || scenario.versions || []
  return versions.slice().sort((a, b) => b.version_number - a.version_number)[0] || null
}

export default function MyScenariosPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [searchParams] = useSearchParams()
  const [scenarios, setScenarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [showAiPanel, setShowAiPanel] = useState(searchParams.get('ai') === '1')

  function reload() {
    listMyScenarios().then(setScenarios).catch(e => setErr(e.message)).finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [])

  const filtered = scenarios.filter(s => !q || s.name.toLowerCase().includes(q.toLowerCase()) || s.code?.toLowerCase().includes(q.toLowerCase()))

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">My Scenarios</div>
          <div className="page-subtitle">Scenarios you've created</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => setShowAiPanel(true)}><Sparkles size={15} /> Draft with AI</button>
          <button className="btn btn-primary" onClick={() => navigate('/scenarios/new')}><Plus size={15} /> New Scenario</button>
        </div>
      </div>

      {err && <Alert type="error" message={err} />}

      <div style={{ marginBottom: 16, maxWidth: 360 }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search scenarios…" />
      </div>

      {filtered.length === 0 ? (
        <Empty title="No scenarios yet" desc="Create your first scenario to start modelling outcomes." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(s => {
            const v = latestOf(s)
            return (
              <Link key={s.id} to={v ? `/scenarios/${v.id}` : '#'} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', textDecoration: 'none', color: 'inherit' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{s.code} · {s.category?.replace(/-/g, ' ')} · v{v?.version_number || 1}</div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{dateFmt(s.created_at)}</div>
                {v && <StatusBadge status={v.status} />}
              </Link>
            )
          })}
        </div>
      )}

      <AIDockedPanel open={showAiPanel} onClose={() => setShowAiPanel(false)} title="Scenario AI" subtitle="Draft a what-if scenario">
        <ScenarioAiTab profile={profile} onSaved={reload} />
      </AIDockedPanel>
    </div>
  )
}
