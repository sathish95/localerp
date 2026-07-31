import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { rupee, dateFmt } from '../lib/supabase'
import { listOpportunities, getOpportunity, changeStage, markWon, markLost, convertToProposal } from '../lib/salesOpportunities'
import { listPipelineStages } from '../lib/salesAdmin'
import { listActivities } from '../lib/salesActivities'
import { listTasks } from '../lib/salesTasks'
import { ActivityModal, TaskModal } from './LeadsPage'
import { SearchBox, StatusBadge, Loader, Empty, StatCard } from '../components/ui'
import { ArrowLeft, Plus, TrendingUp, CheckCircle, XCircle, FileText } from 'lucide-react'

export default function OpportunitiesPage() {
  const { profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('id') || ''
  const [opportunities, setOpportunities] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('Open')

  useEffect(() => { load() }, [])
  async function load() { setLoading(true); setOpportunities(await listOpportunities()); setLoading(false) }
  function select(id) { setSearchParams(id ? { id } : {}) }

  const filtered = opportunities.filter(o =>
    (!search || o.opportunity_number?.toLowerCase().includes(search.toLowerCase())) &&
    (!statusFilter || o.status === statusFilter)
  )

  if (loading) return <Loader />
  if (selectedId) return <OpportunityDetail opportunityId={selectedId} profile={profile} onBack={() => select('')} onChanged={load} />

  const pipelineValue = opportunities.filter(o => o.status === 'Open').reduce((s, o) => s + Number(o.expected_value || 0), 0)
  const weighted = opportunities.filter(o => o.status === 'Open').reduce((s, o) => s + Number(o.expected_value || 0) * (Number(o.probability_percent || 0) / 100), 0)

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Opportunities</div>
          <div className="page-subtitle">The single pipeline every entry track converges into, before Convert to Proposal</div>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Pipeline Value" value={rupee(pipelineValue)} icon={<TrendingUp size={17} />} accent="#0ea5e9" />
        <StatCard label="Weighted Forecast" value={rupee(weighted)} icon={<TrendingUp size={17} />} accent="#4338ca" />
        <StatCard label="Won" value={opportunities.filter(o => o.status === 'Won').length} icon={<CheckCircle size={17} />} accent="#15803d" />
        <StatCard label="Lost" value={opportunities.filter(o => o.status === 'Lost').length} icon={<XCircle size={17} />} accent="#dc2626" />
      </div>

      <div className="card" style={{ padding: 12, marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: '1 1 260px', minWidth: 220 }}><SearchBox value={search} onChange={setSearch} placeholder="Search by opportunity number…" /></div>
        <select className="form-select" style={{ fontSize: 12, width: 180 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="Open">Open</option><option value="Won">Won</option><option value="Lost">Lost</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ padding: '20px 24px' }}><Empty icon="📈" title="No opportunities found" desc="Opportunities are created by converting a Lead, Tender, Pilot or Bootstrap Program" /></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Opp #</th><th>Domain</th><th>Region</th><th>Rep</th><th>Stage</th><th>Value</th><th>Prob.</th><th>Close Date</th><th>Source</th></tr></thead>
            <tbody>
              {filtered.map(o => (
                <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => select(o.id)}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{o.opportunity_number}</td>
                  <td>{o.domain}</td>
                  <td>{o.region?.region_name || '—'}</td>
                  <td>{o.rep?.full_name || '—'}</td>
                  <td>{o.pipeline_stage}</td>
                  <td className="td-bold">{rupee(o.expected_value)}</td>
                  <td>{o.probability_percent}%</td>
                  <td style={{ fontSize: 12, color: '#94a3b8' }}>{o.expected_close_date ? dateFmt(o.expected_close_date) : '—'}</td>
                  <td style={{ fontSize: 11 }}>{o.source_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function OpportunityDetail({ opportunityId, profile, onBack, onChanged }) {
  const navigate = useNavigate()
  const [opp, setOpp] = useState(null)
  const [stages, setStages] = useState([])
  const [activities, setActivities] = useState([])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [showActivity, setShowActivity] = useState(false)
  const [showTask, setShowTask] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const o = await getOpportunity(opportunityId)
    const [st, act, tsk] = await Promise.all([listPipelineStages(o.domain), listActivities('Opportunity', opportunityId), listTasks('Opportunity', opportunityId)])
    setOpp(o); setStages(st); setActivities(act); setTasks(tsk)
    setLoading(false)
  }, [opportunityId])
  useEffect(() => { load() }, [load])

  async function handleStageChange(e) {
    const stage = e.target.value
    const stageDef = stages.find(s => s.stage_name === stage)
    setBusy(true)
    try { await changeStage(opportunityId, stage, stageDef?.default_probability_percent, profile.id); await load() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  async function handleWon() { setBusy(true); try { await markWon(opportunityId, profile.id); await load(); onChanged?.() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  async function handleLost() { setBusy(true); try { await markLost(opportunityId, profile.id); await load(); onChanged?.() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  async function handleConvert() {
    setBusy(true); setErr('')
    try { const p = await convertToProposal(opportunityId, profile.id); await load(); navigate(`/proposals?id=${p.id}`) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  if (loading || !opp) return <Loader />

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 10 }}><ArrowLeft size={14} /> Back to Opportunities</button>
      <div className="page-header" style={{ marginBottom: 14 }}>
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {opp.opportunity_number} <StatusBadge status={opp.status === 'Won' ? 'approved' : opp.status === 'Lost' ? 'rejected' : 'draft'} />
          </div>
          <div className="page-subtitle">{opp.domain} · {opp.region?.region_name || 'No region'} · {opp.rep?.full_name || 'Unassigned'}</div>
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 8 }}>
          {opp.status === 'Open' && !opp.linked_proposal_id && <button className="btn btn-outline" disabled={busy} onClick={handleConvert}><FileText size={14} /> Convert to Proposal</button>}
          {opp.linked_proposal_id && <button className="btn btn-outline" onClick={() => navigate(`/proposals?id=${opp.linked_proposal_id}`)}><FileText size={14} /> View Proposal</button>}
          {opp.status === 'Open' && <button className="btn btn-primary" disabled={busy} onClick={handleWon}>Mark Won</button>}
          {opp.status === 'Open' && <button className="btn btn-danger" disabled={busy} onClick={handleLost}>Mark Lost</button>}
        </div>
      </div>

      {err && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{err}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginBottom: 20 }}>
        <StatCard label="Expected Value" value={rupee(opp.expected_value)} icon={<TrendingUp size={16} />} accent="#0ea5e9" />
        <StatCard label="Probability" value={`${opp.probability_percent}%`} icon={<TrendingUp size={16} />} accent="#4338ca" />
        <StatCard label="Source" value={opp.source_type} icon={<FileText size={16} />} accent="#64748b" />
      </div>

      {opp.status === 'Open' && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Pipeline Stage</div>
          <select className="form-select" style={{ maxWidth: 320 }} value={opp.pipeline_stage} disabled={busy} onChange={handleStageChange}>
            {stages.map(s => <option key={s.id} value={s.stage_name}>{s.stage_name} ({s.default_probability_percent}%)</option>)}
            {!stages.some(s => s.stage_name === opp.pipeline_stage) && <option value={opp.pipeline_stage}>{opp.pipeline_stage}</option>}
          </select>
        </div>
      )}

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Activity Log</div>
          <button className="btn btn-outline btn-sm" onClick={() => setShowActivity(true)}><Plus size={12} /> Log Activity</button>
        </div>
        {activities.length === 0 ? <Empty icon="📞" title="No activity logged yet" desc="Log the first call, email or meeting" /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activities.map(a => (
              <div key={a.id} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12.5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="td-bold">{a.activity_type} ({a.direction})</span>
                  <span style={{ color: '#94a3b8' }}>{dateFmt(a.activity_date)}</span>
                </div>
                <div style={{ color: '#64748b', marginTop: 2 }}>{a.outcome && <>Outcome: {a.outcome} · </>}{a.performer?.full_name}</div>
                {a.notes && <div style={{ marginTop: 4 }}>{a.notes}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Tasks</div>
          <button className="btn btn-outline btn-sm" onClick={() => setShowTask(true)}><Plus size={12} /> Add Task</button>
        </div>
        {tasks.length === 0 ? <Empty icon="✅" title="No tasks yet" desc="Add a follow-up task" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Type</th><th>Assignee</th><th>Due</th><th>Priority</th><th>Status</th></tr></thead>
              <tbody>{tasks.map(t => (
                <tr key={t.id}><td>{t.task_type}</td><td>{t.assignee?.full_name}</td><td>{dateFmt(t.due_date)}</td><td>{t.priority}</td><td><StatusBadge status={t.status} /></td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

      <ActivityModal open={showActivity} onClose={() => setShowActivity(false)} relatedToType="Opportunity" relatedToId={opportunityId} profile={profile} onSaved={load} />
      <TaskModal open={showTask} onClose={() => setShowTask(false)} relatedToType="Opportunity" relatedToId={opportunityId} profile={profile} onSaved={load} />
    </div>
  )
}
