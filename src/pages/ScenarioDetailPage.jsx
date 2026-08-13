import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  getVersion, listVersions, listOverrides, addOverride, deleteOverride,
  runSimulation, listSimulations, getLatestSimulationResults,
  submitVersion, decideVersion, listApprovalLog,
  previewExecution, executeVersion, getExecution,
  getVariance, createReforecast, listVariables,
} from '../lib/scenarios'
import { listLinks, addLink, removeLink, LINKABLE_TYPES } from '../lib/scenarioLinks'
import { Loader, Alert, StatusBadge, StatCard, ApprovalChain, Confirm, Empty } from '../components/ui'
import ScenarioLinkPicker from '../components/ScenarioLinkPicker'
import { rupee, dateFmt, timeFmt } from '../lib/supabase'
import {
  Link2, X, Play, Send, CheckCircle, XCircle, RotateCcw, Rocket,
  TrendingUp, TrendingDown, Edit3, History, Trash2,
} from 'lucide-react'

const TABS = ['Overview', 'Linked Data', 'Variables & Overrides', 'Simulation', 'Approval', 'Execution', 'Actuals & Variance']

const METRIC_META = {
  projected_cost:       { label: 'Projected Cost',   fmt: rupee },
  projected_revenue:    { label: 'Projected Revenue', fmt: rupee },
  projected_margin:     { label: 'Projected Margin',  fmt: rupee },
  projected_roi_percent:{ label: 'ROI %',              fmt: v => `${Number(v).toFixed(1)}%` },
  capacity_headcount:   { label: 'Headcount',          fmt: v => Number(v).toFixed(0) },
  timeline_days:        { label: 'Timeline (days)',    fmt: v => Number(v).toFixed(0) },
  risk_score:           { label: 'Risk Score',         fmt: v => Number(v).toFixed(1) },
}

const APPROVER_ROLES = ['admin', 'ceo', 'finance', 'department_head']

export default function ScenarioDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const isApprover = APPROVER_ROLES.includes(profile?.role)

  const [tab, setTab] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const [version, setVersion] = useState(null)
  const [versions, setVersions] = useState([])
  const [links, setLinks] = useState([])
  const [variables, setVariables] = useState([])
  const [overrides, setOverrides] = useState([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sims, setSims] = useState([])
  const [latestSim, setLatestSim] = useState(null)
  const [approvalLog, setApprovalLog] = useState([])
  const [decisionNote, setDecisionNote] = useState('')
  const [execution, setExecution] = useState(null)
  const [preview, setPreview] = useState(null)
  const [variance, setVariance] = useState(null)
  const [confirmExec, setConfirmExec] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const v = await getVersion(id)
      setVersion(v)
      const [vs, lk, vr, ov, sm, log] = await Promise.all([
        listVersions(v.scenario_id), listLinks(id), listVariables(id), listOverrides(id),
        listSimulations(id), listApprovalLog(id),
      ])
      setVersions(vs); setLinks(lk); setVariables(vr); setOverrides(ov); setSims(sm); setApprovalLog(log)
      setLatestSim(sm.length ? await getLatestSimulationResults(id, sm) : null)
      if (['approved', 'executed'].includes(v.status)) setExecution(await getExecution(id))
      if (v.status === 'executed') setVariance(await getVariance(id))
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [id])

  useEffect(() => { load() }, [load])

  async function handleAddLink(item, type) {
    await addLink(id, { linkedType: type, linkedId: item.id })
    setLinks(await listLinks(id))
    setPickerOpen(false)
  }

  async function handleRunSimulation() {
    setBusy(true); setErr('')
    try {
      await runSimulation(id)
      const [sm, v] = await Promise.all([listSimulations(id), getVersion(id)])
      setSims(sm); setVersion(v)
      setLatestSim(await getLatestSimulationResults(id, sm))
      setTab(3)
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function handleSubmit() {
    setBusy(true); setErr('')
    try { await submitVersion(id, decisionNote); await load(); setDecisionNote(''); setTab(4) }
    catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function handleDecide(decision) {
    setBusy(true); setErr('')
    try { await decideVersion(id, decision, decisionNote); await load(); setDecisionNote('') }
    catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function handlePreviewExecution() {
    setBusy(true); setErr('')
    try { setPreview(await previewExecution(id)) }
    catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function handleExecute() {
    setBusy(true); setErr('')
    try { await executeVersion(id); await load(); setConfirmExec(false) }
    catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function handleReforecast() {
    setBusy(true); setErr('')
    try {
      const newVersionId = await createReforecast(id)
      navigate(`/scenarios/${newVersionId}`)
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  if (loading) return <Loader />
  if (!version) return <Empty title="Scenario not found" desc="It may have been deleted." />

  const approvalSteps = [
    { label: 'Draft' },
    { label: 'Submitted' },
    { label: 'Under Review' },
    version.status === 'rejected'
      ? { label: 'Rejected', cls: 'rejected' }
      : { label: 'Approved' },
  ]
  const approvalStepIndex = { draft: 0, simulated: 0, submitted: 1, under_review: 2, changes_requested: 2, approved: 3, rejected: 3, executed: 3, superseded: 3 }[version.status] ?? 0

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {version.scenario?.name}
            <StatusBadge status={version.status} />
          </div>
          <div className="page-subtitle">{version.scenario?.code} · v{version.version_number}{version.parent_version_id && <span> · reforecast</span>}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {version.status === 'draft' && (
            <button className="btn btn-ghost" onClick={() => navigate(`/scenarios/new?version=${id}`)}><Edit3 size={14} /> Edit</button>
          )}
          <Link to={`/scenarios`} className="btn btn-ghost">All Scenarios</Link>
        </div>
      </div>

      {err && <Alert type="error" message={err} />}

      {versions.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {versions.map(v => (
            <button key={v.id} className={`btn btn-sm ${v.id === id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => navigate(`/scenarios/${v.id}`)}>
              v{v.version_number}
            </button>
          ))}
        </div>
      )}

      <div className="tabs" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 20, overflowX: 'auto' }}>
        {TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(i)}
            className={`tab-btn ${tab === i ? 'active' : ''}`}
            style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, background: 'none', border: 'none', borderBottom: tab === i ? '2px solid var(--c1)' : '2px solid transparent', color: tab === i ? 'var(--c1)' : 'var(--ink-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 0 && (
        <div className="card" style={{ padding: 24, maxWidth: 760 }}>
          <h3 style={{ fontWeight: 800, marginBottom: 4 }}>Objective</h3>
          <p style={{ color: 'var(--ink-muted)', marginBottom: 20 }}>{version.scenario?.objective || 'No objective set.'}</p>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 20 }}>
            <div><div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Timeline</div><strong>{dateFmt(version.start_date)} → {dateFmt(version.end_date)}</strong></div>
            <div><div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Created</div><strong>{dateFmt(version.created_at)}</strong></div>
          </div>
          {version.context?.background && (<><h4 style={{ fontWeight: 700, marginBottom: 4 }}>Background</h4><p style={{ color: 'var(--ink-muted)', marginBottom: 16 }}>{version.context.background}</p></>)}
          {version.context?.stakeholders && (<><h4 style={{ fontWeight: 700, marginBottom: 4 }}>Stakeholders</h4><p style={{ color: 'var(--ink-muted)', marginBottom: 16 }}>{version.context.stakeholders}</p></>)}
          {version.context?.risks && (<><h4 style={{ fontWeight: 700, marginBottom: 4 }}>Risks</h4><p style={{ color: 'var(--ink-muted)' }}>{version.context.risks}</p></>)}
          {version.status === 'draft' && (
            <button className="btn btn-primary" disabled={busy} onClick={handleRunSimulation} style={{ marginTop: 12 }}><Play size={14} /> Run Simulation</button>
          )}
        </div>
      )}

      {tab === 1 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
            <button className="btn btn-primary btn-sm" onClick={() => setPickerOpen(true)}><Link2 size={13} /> Link a Record</button>
          </div>
          {links.length === 0 ? <Empty title="No linked records" desc="Link projects, budgets or other records to simulate against." /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {links.map(l => (
                <div key={l.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
                  <span className="badge">{LINKABLE_TYPES.find(t => t.key === l.linked_type)?.label || l.linked_type}</span>
                  <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 12, color: 'var(--ink-muted)' }}>{l.linked_id}</span>
                  <span className="badge">{l.link_mode}</span>
                  <button className="btn btn-ghost btn-sm" onClick={async () => { await removeLink(l.id); setLinks(await listLinks(id)) }}><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div>
            <h3 style={{ fontWeight: 800, marginBottom: 10 }}>Assumptions</h3>
            {variables.length === 0 ? <Empty title="No assumptions" desc="Add variables from the scenario editor." /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {variables.map(v => (
                  <div key={v.id} className="card" style={{ display: 'flex', gap: 12, padding: '8px 14px', fontSize: 13 }}>
                    <strong style={{ flex: 1 }}>{v.label}</strong>
                    <span style={{ fontFamily: 'monospace', color: 'var(--ink-muted)' }}>{v.key}</span>
                    <span>{v.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ fontWeight: 800, margin: 0 }}>Overrides</h3>
              <OverrideAdder links={links} onAdd={async fields => { await addOverride(id, fields); setOverrides(await listOverrides(id)) }} />
            </div>
            {overrides.length === 0 ? <Empty title="No overrides" desc="Overrides adjust simulated cost, revenue, timeline or capacity on top of the baseline." /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {overrides.map(o => (
                  <div key={o.id} className="card" style={{ display: 'flex', gap: 12, padding: '8px 14px', fontSize: 13, alignItems: 'center' }}>
                    <span className="badge">{o.field}</span>
                    <span style={{ flex: 1 }}>{o.adjustment_type === 'percent' ? `${o.adjustment_value > 0 ? '+' : ''}${o.adjustment_value}%` : o.adjustment_type === 'flat' ? `${o.adjustment_value > 0 ? '+' : ''}${rupee(o.adjustment_value)}` : `= ${rupee(o.adjustment_value)}`}</span>
                    {o.note && <span style={{ color: 'var(--ink-muted)' }}>{o.note}</span>}
                    <button className="btn btn-ghost btn-sm" onClick={async () => { await deleteOverride(o.id); setOverrides(await listOverrides(id)) }}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 3 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <p style={{ color: 'var(--ink-muted)', fontSize: 13, margin: 0 }}>{sims.length} simulation run{sims.length === 1 ? '' : 's'}</p>
            {['draft', 'simulated', 'changes_requested'].includes(version.status) ? (
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={handleRunSimulation}><Play size={13} /> {busy ? 'Running…' : 'Run Simulation'}</button>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Locked — {version.status === 'executed' ? 'create a reforecast to re-simulate' : 'this version is past the editable stage'}</span>
            )}
          </div>
          {latestSim ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
              {Object.entries(METRIC_META).map(([key, meta]) => {
                const r = latestSim.results[key]
                if (!r) return null
                const delta = r.value - (r.baseline_value ?? r.value)
                return (
                  <StatCard key={key} label={meta.label} value={meta.fmt(r.value)}
                    icon={delta >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                    accent={key === 'risk_score' ? '#dc2626' : '#6366f1'} />
                )
              })}
            </div>
          ) : <Empty title="No simulation run yet" desc="Run a simulation to see projected outcomes." />}

          {sims.length > 0 && (
            <div>
              <h4 style={{ fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}><History size={14} /> Run History</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sims.map(s => (
                  <div key={s.id} className="card" style={{ padding: '8px 14px', fontSize: 13, display: 'flex', gap: 12 }}>
                    <span>Run #{s.run_number}</span>
                    <span style={{ color: 'var(--ink-muted)' }}>{timeFmt(s.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 4 && (
        <div>
          <div className="card" style={{ padding: 20, marginBottom: 20 }}>
            <ApprovalChain steps={approvalSteps} currentStep={approvalStepIndex} />
          </div>

          {['simulated', 'changes_requested'].includes(version.status) && (
            <div className="card" style={{ padding: 20, marginBottom: 20 }}>
              <label className="form-label">Note to reviewers (optional)</label>
              <textarea className="form-input" rows={2} value={decisionNote} onChange={e => setDecisionNote(e.target.value)} />
              <button className="btn btn-primary" disabled={busy} onClick={handleSubmit} style={{ marginTop: 10 }}><Send size={14} /> {version.status === 'changes_requested' ? 'Resubmit for Approval' : 'Submit for Approval'}</button>
            </div>
          )}
          {version.status === 'draft' && <Alert type="info" message="Run a simulation before submitting this scenario for approval." />}

          {['submitted', 'under_review'].includes(version.status) && isApprover && (
            <div className="card" style={{ padding: 20, marginBottom: 20 }}>
              <label className="form-label">Decision note</label>
              <textarea className="form-input" rows={2} value={decisionNote} onChange={e => setDecisionNote(e.target.value)} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn btn-primary" disabled={busy} onClick={() => handleDecide('approve')}><CheckCircle size={14} /> Approve</button>
                <button className="btn btn-ghost" disabled={busy} onClick={() => handleDecide('request_changes')}><RotateCcw size={14} /> Request Changes</button>
                <button className="btn btn-danger" disabled={busy} onClick={() => handleDecide('reject')}><XCircle size={14} /> Reject</button>
              </div>
            </div>
          )}

          <h4 style={{ fontWeight: 700, marginBottom: 8 }}>Log</h4>
          {approvalLog.length === 0 ? <Empty title="No activity yet" /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {approvalLog.map(a => (
                <div key={a.id} className="card" style={{ padding: '8px 14px', fontSize: 13 }}>
                  <strong>{a.actor?.full_name || 'Someone'}</strong> {a.action.replace('_', ' ')}
                  <span style={{ color: 'var(--ink-muted)' }}> · {timeFmt(a.created_at)}</span>
                  {a.note && <div style={{ color: 'var(--ink-muted)', marginTop: 2 }}>{a.note}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 5 && (
        <div>
          {version.status === 'approved' && !execution && (
            <div className="card" style={{ padding: 20, marginBottom: 20 }}>
              <p style={{ color: 'var(--ink-muted)', fontSize: 13, marginBottom: 12 }}>Executing converts this scenario's linked project data into real budget records. This never overwrites existing data — it only creates new rows.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost" disabled={busy} onClick={handlePreviewExecution}>Preview</button>
                <button className="btn btn-primary" disabled={busy} onClick={() => setConfirmExec(true)}><Rocket size={14} /> Execute</button>
              </div>
              {preview && (
                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {preview.map((p, i) => (
                    <div key={i} className="card" style={{ padding: '8px 14px', fontSize: 13 }}>
                      <span className="badge">{p.linked_type}</span> {p.action}{p.amount != null && <span> · {rupee(p.amount)}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {execution ? (
            <div>
              <Alert type="success" message={`Executed ${dateFmt(execution.executed_at)}`} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                {(execution.items || []).map(it => (
                  <div key={it.id} className="card" style={{ padding: '8px 14px', fontSize: 13 }}>
                    <span className="badge">{it.target_type}</span> {it.note}
                    {it.amount != null && <span> · {rupee(it.amount)}</span>}
                  </div>
                ))}
              </div>
            </div>
          ) : version.status !== 'approved' && <Empty title="Nothing to execute yet" desc="This scenario needs to be approved first." />}
        </div>
      )}

      {tab === 6 && (
        <div>
          {version.status !== 'executed' ? <Empty title="No actuals yet" desc="Actuals & variance appear once a scenario has been executed." /> : variance ? (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
                <StatCard label="Planned Cost" value={rupee(variance.planned_cost)} icon={<TrendingUp size={16} />} />
                <StatCard label="Actual Cost" value={rupee(variance.actual_cost)} icon={<TrendingUp size={16} />} accent="#dc2626" />
                <StatCard label="Variance %" value={`${Number(variance.variance_percent).toFixed(1)}%`} icon={variance.variance_percent >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />} />
              </div>
              {variance.root_cause && <Alert type="info" message={variance.root_cause} />}
              <button className="btn btn-primary" disabled={busy} onClick={handleReforecast} style={{ marginTop: 16 }}><RotateCcw size={14} /> Create Reforecast</button>
            </div>
          ) : <Loader />}
        </div>
      )}

      {pickerOpen && <ScenarioLinkPicker onSelect={handleAddLink} onClose={() => setPickerOpen(false)} />}
      <Confirm open={confirmExec} message="Execute this scenario? This will create new budget records from its linked projects." onConfirm={handleExecute} onCancel={() => setConfirmExec(false)} />
    </div>
  )
}

function OverrideAdder({ links, onAdd }) {
  const [open, setOpen] = useState(false)
  const [field, setField] = useState('cost')
  const [type, setType] = useState('percent')
  const [value, setValue] = useState('')
  const [linkId, setLinkId] = useState('')
  const [note, setNote] = useState('')

  if (!open) return <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}><Link2 size={13} /> Add Override</button>

  return (
    <div className="card" style={{ padding: 14, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <select className="form-input" style={{ width: 110 }} value={field} onChange={e => setField(e.target.value)}>
        <option value="cost">Cost</option><option value="revenue">Revenue</option><option value="timeline">Timeline</option><option value="capacity">Capacity</option>
      </select>
      <select className="form-input" style={{ width: 110 }} value={type} onChange={e => setType(e.target.value)}>
        <option value="percent">Percent</option><option value="flat">Flat +/-</option><option value="absolute">Absolute</option>
      </select>
      <input className="form-input" style={{ width: 100 }} type="number" value={value} onChange={e => setValue(e.target.value)} placeholder="Value" />
      <select className="form-input" style={{ width: 160 }} value={linkId} onChange={e => setLinkId(e.target.value)}>
        <option value="">Applies to all links</option>
        {links.map(l => <option key={l.id} value={l.id}>{l.linked_type} · {l.linked_id.slice(0, 8)}</option>)}
      </select>
      <input className="form-input" style={{ width: 160 }} value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" />
      <button className="btn btn-primary btn-sm" onClick={async () => { await onAdd({ field, adjustmentType: type, adjustmentValue: value, linkId: linkId || null, note }); setOpen(false); setValue(''); setNote('') }}>Add</button>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}><X size={13} /></button>
    </div>
  )
}
