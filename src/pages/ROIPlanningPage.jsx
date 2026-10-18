import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase, rupee, dateFmt } from '../lib/supabase'
import { Modal, Loader, Empty, Alert, StatusBadge, Stepper, ApprovalChain, FieldLabel } from '../components/ui'
import * as roi from '../lib/roiProposals'
import * as roiApproval from '../lib/roiApproval'
import { delayImpactPresets } from '../lib/roiForecast'
import { exportROIReportPDF } from '../lib/roiReportExport'
import * as econ from '../lib/roiEconomics'
import {
  CustomerBaselineTab, BenefitDriversTab, InvestmentLinesTab, DeliveryCostTab, PoVsActualTab,
  RoiResultTab, SensitivityTab, NpvIrrTab, AssumptionsLedgerTab, CustomerPortalTab, ExecutiveOverviewTab,
} from './ROIEnterpriseTabs'
import { Plus, Calculator, RefreshCw, TrendingUp, ArrowLeft, Download, LayoutGrid } from 'lucide-react'

const CAN_MANAGE_ROLES = ['admin', 'ceo', 'cto', 'finance', 'pm', 'manager', 'department_head']
const SCENARIOS = ['conservative', 'expected', 'aggressive']
const SCENARIO_LABEL = { conservative: 'Conservative', expected: 'Expected', aggressive: 'Aggressive' }
const SCENARIO_COLOR = { conservative: '#e11d48', expected: '#3b82f6', aggressive: '#10b981' }
const CATEGORY_LABEL = {
  service_overrun: 'Service Overrun', fuel_theft: 'Fuel Theft', missed_servicing: 'Missed Servicing', parts_failure: 'Parts Failure',
  labour: 'Labour', logistics: 'Logistics Mismatch', project_loss: 'Project Loss',
  utilization: 'Utilization', rental: 'Rental Optimization', operator_behavior: 'Operator Behavior', unauthorized_usage: 'Unauthorized Usage',
}
const COST_DRIVER_FIELDS = [
  ['diesel_price_per_litre', 'Diesel Price / Litre', 'e.g. 95 (₹/litre)'], ['operating_days_per_year', 'Operating Days / Year', 'e.g. 300 (days the fleet actually runs)'],
  ['service_overrun_per_equipment_year', 'Service Overrun / Equipment / Year', 'e.g. 60000 (₹/equipment/year in excess service cost)'], ['fuel_theft_litres_per_day', 'Fuel Theft Litres / Day', 'e.g. 2 (litres/day per equipment)'],
  ['missed_servicing_cost_per_equipment_year', 'Missed Servicing Cost / Equipment / Year', 'e.g. 30000 (₹/equipment/year)'], ['parts_failure_cost_per_incident', 'Parts Failure Cost / Incident', 'e.g. 15000 (₹ per failure incident)'],
  ['parts_failure_frequency_per_year', 'Parts Failure Frequency / Year', 'e.g. 2 (incidents/equipment/year)'], ['project_loss_rate_pct', 'Project Loss Rate % / Year', 'e.g. 2 (as an annual %, not 0.02)'],
  ['equipment_efficiency_loss_rate_pct', 'Equipment Efficiency Loss Rate % / Year', 'e.g. 5 (as an annual % of replacement value)'],
]
const SITE_FIELDS = [
  ['equipment_count', 'Equipment Count', 'e.g. 10 (units deployed at this site)'], ['manual_labour_cost_monthly', 'Manual Labour Cost / Month', 'e.g. 50000 (₹/month, this site)'],
  ['logistics_mismatch_qty_per_quarter', 'Logistics Mismatch Qty / Quarter', 'e.g. 5 (mismatch events/quarter)'], ['logistics_cost_per_mismatch', 'Logistics Cost / Mismatch', 'e.g. 2000 (₹ per mismatch event)'],
  ['project_contract_value', 'Project Contract Value', 'e.g. 5000000 (₹, this site’s share of the contract)'], ['equipment_replacement_value', 'Equipment Replacement Value', 'e.g. 2500000 (₹, total replacement cost of equipment at this site)'],
]

export default function ROIPlanningPage() {
  const { profile } = useAuth()
  const role = profile?.role
  const canManage = CAN_MANAGE_ROLES.includes(role)
  const [params, setParams] = useSearchParams()
  const projectId = params.get('project') || ''

  const [projects, setProjects] = useState([])
  const [proposals, setProposals] = useState([])
  const [selected, setSelected] = useState(null) // full proposal id
  const [showNew, setShowNew] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [view, setView] = useState('project') // 'project' | 'portfolio'

  useEffect(() => { loadProjects() }, [])
  useEffect(() => { if (projectId) loadProposals(projectId); else setProposals([]) }, [projectId])

  async function loadProjects() {
    const { data } = await supabase.from('projects').select('id,name').order('name')
    setProjects(data || [])
    setLoading(false)
  }
  async function loadProposals(pid) {
    setLoading(true)
    try { setProposals(await roi.listProposalsForProject(pid)) }
    catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  function selectProject(pid) { setParams(pid ? { project: pid } : {}); setSelected(null) }

  if (selected) {
    return <ProposalDetail proposalId={selected} onBack={() => { setSelected(null); loadProposals(projectId) }} profile={profile} role={role} canManage={canManage} />
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}><Calculator size={20} style={{ verticalAlign: -3, marginRight: 8 }} />ROI Planning &amp; Burn Forecast</h1>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>Build fleet-savings ROI cases per project, track burn against them, and forecast forward.</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <button onClick={() => setView('project')} className="btn btn-sm" style={{ borderRadius: 0, background: view === 'project' ? 'var(--c1)' : 'transparent', color: view === 'project' ? '#fff' : 'inherit' }}>By Project</button>
            <button onClick={() => setView('portfolio')} className="btn btn-sm" style={{ borderRadius: 0, background: view === 'portfolio' ? 'var(--c1)' : 'transparent', color: view === 'portfolio' ? '#fff' : 'inherit' }}><LayoutGrid size={13} style={{ marginRight: 5 }} />Portfolio</button>
          </div>
          {canManage && view === 'project' && projectId && (
            <button className="btn btn-primary" onClick={() => setShowNew(true)}><Plus size={14} style={{ marginRight: 6 }} />New Proposal</button>
          )}
        </div>
      </div>

      {err && <Alert type="danger" message={err} />}

      {view === 'portfolio' ? <PortfolioView onOpen={(pid) => setSelected(pid)} /> : (<>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12.5, fontWeight: 600 }}>Project</label>
          <select className="input" style={{ maxWidth: 320 }} value={projectId} onChange={e => selectProject(e.target.value)}>
            <option value="">Select a project…</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      {!projectId ? (
        <Empty icon="📊" title="Select a project" desc="Choose a project above to see or create ROI proposals for it" />
      ) : loading ? <Loader /> : proposals.length === 0 ? (
        <Empty icon="📈" title="No ROI proposals yet" desc="Create one from Historical Data or a manual wizard" />
      ) : (
        <div className="table-wrap"><table>
          <thead><tr>
            <th style={th}>Name</th><th style={th}>Entry Mode</th><th style={th}>Status</th>
            <th style={th}>Active Scenario</th><th style={th}>Duration</th><th style={th}>Created</th>
          </tr></thead>
          <tbody>
            {proposals.map(p => (
              <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(p.id)}>
                <td style={td}><span style={{ fontWeight: 700 }}>{p.name}</span></td>
                <td style={td}>{p.entry_mode === 'historical_map' ? 'Historical Map' : 'Manual Input'}</td>
                <td style={td}><StatusBadge status={p.status} /></td>
                <td style={td}><span style={{ textTransform: 'capitalize', color: SCENARIO_COLOR[p.active_scenario] }}>{p.active_scenario}</span></td>
                <td style={td}>{p.duration_months} mo</td>
                <td style={td}>{dateFmt(p.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      {showNew && (
        <NewProposalModal projectId={projectId} profile={profile}
          onClose={() => setShowNew(false)}
          onCreated={(id) => { setShowNew(false); loadProposals(projectId); setSelected(id) }} />
      )}
      </>)}
    </div>
  )
}

function PortfolioView({ onOpen }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { roi.getPortfolioSummary().then(setData).catch(e => setErr(e.message)) }, [])

  if (err) return <Alert type="danger" message={err} />
  if (!data) return <Loader />
  const { rows, totals } = data

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, marginBottom: 20 }}>
        <Stat label="Total Proposals" value={totals.count} />
        <Stat label="Approved" value={totals.approvedCount} accent="#10b981" />
        <Stat label="Pending Approval" value={totals.pendingCount} accent="#f59e0b" />
        <Stat label="Approved Investment" value={rupee(totals.totalInvestment)} accent="#0ea5e9" />
        <Stat label="Approved Annual Saving" value={rupee(totals.totalAnnualSaving)} accent="#6366f1" />
        <Stat label="Approved Burn to Date" value={rupee(totals.totalBurnToDate)} accent="#e11d48" />
      </div>
      {rows.length === 0 ? <Empty icon="📊" title="No ROI proposals across any project yet" desc="" /> : (
        <div className="table-wrap"><table>
          <thead><tr>
            <th style={th}>Proposal</th><th style={th}>Project</th><th style={th}>Status</th>
            <th style={th}>Scenario</th><th style={th}>Annual Saving</th><th style={th}>Investment</th><th style={th}>ROI %</th><th style={th}>Burn to Date</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(r.id)}>
                <td style={td}><span style={{ fontWeight: 700 }}>{r.name}</span></td>
                <td style={td}>{r.project_name}</td>
                <td style={td}><StatusBadge status={r.status} /></td>
                <td style={td}><span style={{ textTransform: 'capitalize', color: SCENARIO_COLOR[r.active_scenario] }}>{r.active_scenario}</span></td>
                <td style={td}>{rupee(r.total_annual_saving)}</td>
                <td style={td}>{rupee(r.total_investment)}</td>
                <td style={td}>{r.roi_pct != null ? `${r.roi_pct}%` : '—'}</td>
                <td style={td}>{rupee(r.actual_burn_to_date)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  )
}

const th = { padding: '8px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }
const td = { padding: '10px 14px', fontSize: 12.5, borderBottom: '1px solid var(--border)' }

function NewProposalModal({ projectId, profile, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [entryMode, setEntryMode] = useState('manual_input')
  const [duration, setDuration] = useState(12)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    if (!name.trim()) { setErr('Name is required'); return }
    setBusy(true); setErr('')
    try {
      const proposal = await roi.createProposal({ projectId, name, entryMode, durationMonths: Number(duration), profileId: profile?.id })
      onCreated(proposal.id)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title="New ROI Proposal" footer={
      <><button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Creating…' : 'Create'}</button></>
    }>
      {err && <Alert type="danger" message={err} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <FieldLabel style={label} example="e.g. Fleet IoT ROI — Q3 2026">Proposal Name</FieldLabel>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Fleet IoT ROI — Q3 2026" />
        </div>
        <div>
          <label style={label}>Entry Path</label>
          <div style={{ display: 'flex', gap: 12 }}>
            <label style={radioLabel}><input type="radio" checked={entryMode === 'historical_map'} onChange={() => setEntryMode('historical_map')} /> Historical Data Map (pulls from this project)</label>
            <label style={radioLabel}><input type="radio" checked={entryMode === 'manual_input'} onChange={() => setEntryMode('manual_input')} /> Manual Input (full wizard)</label>
          </div>
        </div>
        <div>
          <FieldLabel style={label} example="e.g. 12 (a typical fleet IoT rollout)">Planned Duration (months)</FieldLabel>
          <input className="input" type="number" min={1} value={duration} onChange={e => setDuration(e.target.value)} />
        </div>
      </div>
    </Modal>
  )
}

const label = { display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 5 }
const radioLabel = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }

// ─────────────────────────────────────────────────────────────────────────

function ProposalDetail({ proposalId, onBack, profile, role, canManage }) {
  const [tab, setTab] = useState('sites')
  const [full, setFull] = useState(null)
  const [snapshots, setSnapshots] = useState({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [chain, setChain] = useState(roiApproval.getChainSync())

  useEffect(() => { load() }, [proposalId])

  async function load() {
    try {
      const f = await roi.getProposalFull(proposalId)
      setFull(f)
      setSnapshots(await roi.getLatestSnapshots(proposalId))
      setChain(await roiApproval.getChain())
    } catch (e) { setErr(e.message) }
  }

  if (!full?.proposal) return <div style={{ padding: 24 }}><Loader /></div>
  const { proposal, sites, costDriver, captureRates, efficiencyWeight } = full
  const isDraft = proposal.status === 'draft' || proposal.status === 'rejected'

  async function withBusy(fn) { setBusy(true); setErr(''); try { await fn() } catch (e) { setErr(e.message) } finally { setBusy(false) } }

  return (
    <div style={{ padding: 24 }}>
      <button className="btn btn-outline btn-sm" onClick={onBack} style={{ marginBottom: 16 }}><ArrowLeft size={13} style={{ marginRight: 6 }} />Back to Proposals</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 19, fontWeight: 800, margin: 0 }}>{proposal.name}</h2>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{proposal.entry_mode === 'historical_map' ? 'Historical Data Map' : 'Manual Input'} · {proposal.duration_months} months</div>
        </div>
        <StatusBadge status={proposal.status} />
      </div>

      {err && <Alert type="danger" message={err} />}

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <RoiSectionNav active={tab} onChange={setTab} />
        <div style={{ flex: '1 1 320px', minWidth: 280 }}>
          {tab === 'executive' && <ExecutiveOverviewTab proposalId={proposalId} proposal={proposal} />}
          {tab === 'sites' && <SitesTab proposalId={proposalId} sites={sites} canEdit={canManage} onSaved={load} />}
          {tab === 'baseline' && <CustomerBaselineTab proposalId={proposalId} canEdit={canManage} />}
          {tab === 'drivers' && <CostDriversTab proposalId={proposalId} costDriver={costDriver} canEdit={canManage} onSaved={load} />}
          {tab === 'benefits' && <BenefitDriversTab proposalId={proposalId} canEdit={canManage} profile={profile} />}
          {tab === 'rates' && <CaptureRatesTab proposalId={proposalId} captureRates={captureRates} efficiencyWeight={efficiencyWeight} canEdit={canManage} onSaved={load} />}
          {tab === 'investment' && <InvestmentTab proposalId={proposalId} costDriver={costDriver} sites={sites} canEdit={canManage} onSaved={load} />}
          {tab === 'investmentLines' && <InvestmentLinesTab proposalId={proposalId} projectId={proposal.project_id} canEdit={canManage} />}
          {tab === 'deliveryCost' && <DeliveryCostTab proposalId={proposalId} projectId={proposal.project_id} canEdit={canManage} profile={profile} />}
          {tab === 'po' && <PoVsActualTab proposalId={proposalId} canEdit={canManage} profile={profile} />}
          {tab === 'roiResult' && <RoiResultTab proposalId={proposalId} canEdit={canManage} />}
          {tab === 'sensitivity' && <SensitivityTab proposalId={proposalId} profile={profile} />}
          {tab === 'npvIrr' && <NpvIrrTab proposalId={proposalId} profile={profile} />}
          {tab === 'ledger' && <AssumptionsLedgerTab proposalId={proposalId} />}
          {tab === 'portal' && <CustomerPortalTab proposalId={proposalId} profile={profile} />}
          {tab === 'scenarios' && (
            <ScenariosTab proposalId={proposalId} proposal={proposal} snapshots={snapshots} canEdit={canManage}
              onRecalculate={() => withBusy(async () => { await roi.calculate(proposalId); await load() })}
              onSetActive={(sc) => withBusy(async () => { await supabase.from('roi_proposal').update({ active_scenario: sc }).eq('id', proposalId); await load() })}
              busy={busy} />
          )}
          {tab === 'burn' && <BurnTab proposalId={proposalId} />}
          {tab === 'forecast' && <ForecastTab proposalId={proposalId} profile={profile} />}
          {tab === 'approval' && (
            <ApprovalTab proposal={proposal} chain={chain} role={role} profile={profile}
              onSubmit={() => withBusy(async () => { await roi.submitForApproval(proposalId, profile?.id); await econ.freezeApprovalSummary(proposalId); await load() })}
              onAct={(action, note) => withBusy(async () => { await roi.actOnApproval(proposalId, action, role, profile.id, note); await load() })}
              busy={busy} isDraft={isDraft} />
          )}
          {tab === 'customer' && <CustomerViewTab proposalId={proposalId} snapshots={snapshots} proposal={proposal} />}
        </div>
      </div>
    </div>
  )
}

// Grouped left-hand section nav (matches the module's Executive/Opportunity/
// Economics/Forecast/Governance information architecture) instead of one
// long horizontal tab strip — 19 items in a single row forced awkward
// horizontal scrolling; a vertical, grouped list doesn't.
const ROI_NAV_GROUPS = [
  { section: 'Executive', items: [{ id: 'executive', label: 'Executive Overview' }] },
  { section: 'Opportunity', items: [
    { id: 'sites', label: 'Sites' }, { id: 'baseline', label: 'Customer Baseline' },
    { id: 'drivers', label: 'Cost Drivers' }, { id: 'benefits', label: 'Benefit Drivers' },
  ] },
  { section: 'Economics', items: [
    { id: 'rates', label: 'Capture Rates' }, { id: 'investment', label: 'Investment' }, { id: 'investmentLines', label: 'Investment Lines' },
    { id: 'deliveryCost', label: 'Delivery Cost' }, { id: 'po', label: 'PO vs Actual Cost' }, { id: 'roiResult', label: 'ROI & Payback' },
  ] },
  { section: 'Forecast', items: [
    { id: 'scenarios', label: 'Scenarios' }, { id: 'burn', label: 'Burn' }, { id: 'forecast', label: 'Forecast' },
    { id: 'sensitivity', label: 'Sensitivity Analysis' }, { id: 'npvIrr', label: 'NPV / IRR' },
  ] },
  { section: 'Governance', items: [
    { id: 'ledger', label: 'Assumptions & Adjustments' }, { id: 'approval', label: 'Approval' },
    { id: 'customer', label: 'Customer View (Export)' }, { id: 'portal', label: 'Customer Portal Link' },
  ] },
]

function RoiSectionNav({ active, onChange }) {
  return (
    <nav style={{ width: 210, flexShrink: 0, position: 'sticky', top: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {ROI_NAV_GROUPS.map(g => (
        <div key={g.section}>
          <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)', marginBottom: 6, padding: '0 10px' }}>{g.section}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {g.items.map(item => {
              const isActive = active === item.id
              return (
                <button key={item.id} onClick={() => onChange(item.id)} style={{
                  textAlign: 'left', padding: '8px 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
                  fontSize: 12.5, fontWeight: isActive ? 700 : 500,
                  background: isActive ? 'var(--c1)' : 'transparent', color: isActive ? '#fff' : 'inherit',
                }}>{item.label}</button>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}

const SCENARIO_LABEL_C = { conservative: 'Conservative', expected: 'Expected', aggressive: 'Aggressive' }

function CustomerViewTab({ proposalId, snapshots, proposal }) {
  const [delayCustom, setDelayCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const snapshot = snapshots[proposal.active_scenario]

  async function download() {
    setBusy(true); setErr('')
    try {
      const list = [0, 1, 3, 6, ...(delayCustom ? [Number(delayCustom)] : [])]
      await exportROIReportPDF(proposalId, { delayMonthsList: [...new Set(list)].sort((a, b) => a - b) })
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  if (!snapshot) return <Empty icon="🧮" title="No snapshot yet" desc="Calculate the active scenario first (Scenarios tab) before opening the customer view" />

  const rows = delayImpactPresets(snapshot, [0, 1, 3, 6, ...(delayCustom ? [Number(delayCustom)] : [])].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b))

  return (
    <div>
      {err && <Alert type="danger" message={err} />}
      <Alert type="info" message={`Presenting the "${SCENARIO_LABEL_C[proposal.active_scenario]}" scenario. Only top-line figures below — no internal cost-driver or capture-rate assumptions are shown or exported here.`} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, margin: '16px 0' }}>
        <Stat label="Total Annual Saving" value={rupee(snapshot.total_annual_saving)} accent="#10b981" />
        <Stat label="Total Investment" value={rupee(snapshot.total_investment)} accent="#0ea5e9" />
        <Stat label="Steady-State ROI %" value={`${snapshot.roi_pct}%`} accent="#6366f1" />
        <Stat label="Payback (On Schedule)" value={`${snapshot.payback_months} months`} accent="#f59e0b" />
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">If Implementation Is Delayed…</span></div>
        <div className="card-body">
          <div className="table-wrap"><table>
            <thead><tr><th style={th}>Go-Live Timeline</th><th style={th}>Year-1 Saving Captured</th><th style={th}>Value Lost to Delay</th><th style={th}>Year-1 ROI %</th><th style={th}>Payback</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.delay_months}>
                <td style={td}><span style={{ fontWeight: r.delay_months === 0 ? 700 : 500 }}>{r.delay_months === 0 ? 'On Schedule' : `+${r.delay_months} month${r.delay_months > 1 ? 's' : ''}`}</span></td>
                <td style={td}>{rupee(r.saving_captured_in_window)}</td>
                <td style={td}>{r.delay_months === 0 ? '—' : <span style={{ color: '#e11d48', fontWeight: 600 }}>{rupee(r.savings_lost_to_delay)}</span>}</td>
                <td style={td}>{r.year1_roi_pct}%</td>
                <td style={td}>{r.delayed_payback_months} mo</td>
              </tr>
            ))}</tbody>
          </table></div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
            <div><FieldLabel style={label} example="e.g. 2 (an extra scenario beyond the standard +1/+3/+6)">Add a custom delay (months)</FieldLabel><input className="input" type="number" value={delayCustom} onChange={e => setDelayCustom(e.target.value)} style={{ maxWidth: 160 }} /></div>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={download}><Download size={13} style={{ marginRight: 6 }} />{busy ? 'Generating…' : 'Download Customer PDF'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function fieldValue(v) { return v == null ? '' : v }

function SitesTab({ proposalId, sites, canEdit, onSaved }) {
  const [rows, setRows] = useState(sites.length ? sites : [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { setRows(sites) }, [sites])

  function addRow() { setRows(r => [...r, { site_name: `Site ${r.length + 1}`, source: 'manual_override', equipment_count: 0, manual_labour_cost_monthly: 0, logistics_mismatch_qty_per_quarter: 0, logistics_cost_per_mismatch: 0, project_contract_value: 0, equipment_replacement_value: 0 }]) }
  function removeRow(i) { setRows(r => r.filter((_, idx) => idx !== i)) }
  function setField(i, key, val) { setRows(r => r.map((row, idx) => idx === i ? { ...row, [key]: val } : row)) }

  async function save() {
    setBusy(true); setErr('')
    try { await roi.updateSites(proposalId, rows); await onSaved() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="card">
      <div className="card-body">
        {err && <Alert type="danger" message={err} />}
        <div className="table-wrap"><table>
          <thead><tr>
            <th style={th}>Site Name</th>
            {SITE_FIELDS.map(([k, l, ex]) => <th key={k} style={th} title={ex}>{l}</th>)}
            <th style={th}>Source</th>{canEdit && <th style={th}></th>}
          </tr></thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td style={td}><input className="input" disabled={!canEdit} value={fieldValue(row.site_name)} onChange={e => setField(i, 'site_name', e.target.value)} style={{ minWidth: 120 }} /></td>
                {SITE_FIELDS.map(([k]) => (
                  <td key={k} style={td}><input className="input" type="number" disabled={!canEdit} value={fieldValue(row[k])} onChange={e => setField(i, k, Number(e.target.value))} style={{ minWidth: 90 }} /></td>
                ))}
                <td style={td}><span style={{ fontSize: 10, textTransform: 'capitalize', color: row.source === 'sourced' ? '#10b981' : 'var(--text-muted)' }}>{row.source?.replace('_', ' ')}</span></td>
                {canEdit && <td style={td}><button className="btn btn-outline btn-sm" onClick={() => removeRow(i)}>Remove</button></td>}
              </tr>
            ))}
          </tbody>
        </table></div>
        {rows.length === 0 && <Empty icon="🏗" title="No sites yet" desc="Add at least one site" />}
        {canEdit && (
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button className="btn btn-outline btn-sm" onClick={addRow}>+ Add Site</button>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save Sites'}</button>
          </div>
        )}
      </div>
    </div>
  )
}

function CostDriversTab({ proposalId, costDriver, canEdit, onSaved }) {
  const [form, setForm] = useState(costDriver || {})
  const [hints, setHints] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { setForm(costDriver || {}) }, [costDriver])
  useEffect(() => { supabase.from('roi_cost_driver_defaults').select('*').then(({ data }) => setHints(Object.fromEntries((data || []).map(d => [d.field_key, d.benchmark_hint])))) }, [])

  async function save() {
    setBusy(true); setErr('')
    try {
      const fields = Object.fromEntries(COST_DRIVER_FIELDS.map(([k]) => [k, Number(form[k] || 0)]))
      await roi.updateCostDrivers(proposalId, fields); await onSaved()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="card">
      <div className="card-body">
        {err && <Alert type="danger" message={err} />}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16 }}>
          {COST_DRIVER_FIELDS.map(([k, l, ex]) => (
            <div key={k}>
              <FieldLabel style={label} example={hints[k] || ex}>{l}</FieldLabel>
              <input className="input" type="number" disabled={!canEdit} value={fieldValue(form[k])}
                onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} placeholder={hints[k]} />
              {hints[k] && <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 3 }}>{hints[k]}</div>}
            </div>
          ))}
        </div>
        {canEdit && <button className="btn btn-primary btn-sm" disabled={busy} onClick={save} style={{ marginTop: 16 }}>{busy ? 'Saving…' : 'Save Cost Drivers'}</button>}
      </div>
    </div>
  )
}

function InvestmentTab({ proposalId, costDriver, sites, canEdit, onSaved }) {
  const [unitCost, setUnitCost] = useState(costDriver?.iot_logger_unit_cost || 0)
  const [devCost, setDevCost] = useState(costDriver?.software_dev_cost_onetime || 0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { setUnitCost(costDriver?.iot_logger_unit_cost || 0); setDevCost(costDriver?.software_dev_cost_onetime || 0) }, [costDriver])

  const totalEquipment = (sites || []).reduce((s, r) => s + Number(r.equipment_count || 0), 0)
  const total = Number(unitCost || 0) * totalEquipment + Number(devCost || 0)

  async function save() {
    setBusy(true); setErr('')
    try { await roi.updateInvestment(proposalId, { iotLoggerUnitCost: Number(unitCost), softwareDevCostOnetime: Number(devCost) }); await onSaved() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="card">
      <div className="card-body">
        {err && <Alert type="danger" message={err} />}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16, marginBottom: 16 }}>
          <div><FieldLabel style={label} example="e.g. 8000 (₹ per logger unit)">IoT Logger Unit Cost</FieldLabel><input className="input" type="number" disabled={!canEdit} value={fieldValue(unitCost)} onChange={e => setUnitCost(e.target.value)} /></div>
          <div><FieldLabel style={label} example="e.g. 500000 (₹, one-time platform integration cost)">Software Dev Cost (one-time)</FieldLabel><input className="input" type="number" disabled={!canEdit} value={fieldValue(devCost)} onChange={e => setDevCost(e.target.value)} /></div>
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div><div style={label}>Total Equipment</div><div style={{ fontSize: 18, fontWeight: 800 }}>{totalEquipment}</div></div>
          <div><div style={label}>Total Investment</div><div style={{ fontSize: 18, fontWeight: 800, color: 'var(--c1)' }}>{rupee(total)}</div></div>
        </div>
        {canEdit && <button className="btn btn-primary btn-sm" disabled={busy} onClick={save} style={{ marginTop: 16 }}>{busy ? 'Saving…' : 'Save Investment'}</button>}
      </div>
    </div>
  )
}

function CaptureRatesTab({ proposalId, captureRates, efficiencyWeight, canEdit, onSaved }) {
  const [rows, setRows] = useState(captureRates || [])
  const [weights, setWeights] = useState(efficiencyWeight || { utilization_pct: 25, rental_pct: 25, operator_behavior_pct: 25, unauthorized_usage_pct: 25 })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [newCat, setNewCat] = useState({ name: '', conservativePct: 40, expectedPct: 60, aggressivePct: 80 })
  useEffect(() => { setRows(captureRates || []) }, [captureRates])
  useEffect(() => { setWeights(efficiencyWeight || weights) }, [efficiencyWeight])

  function setRate(cat, col, val) { setRows(rs => rs.map(r => r.category === cat ? { ...r, [col]: Number(val) } : r)) }
  const weightSum = Number(weights.utilization_pct || 0) + Number(weights.rental_pct || 0) + Number(weights.operator_behavior_pct || 0) + Number(weights.unauthorized_usage_pct || 0)

  async function save() {
    setBusy(true); setErr('')
    try {
      await roi.updateCaptureRates(proposalId, rows)
      await roi.updateEfficiencyWeights(proposalId, weights)
      await onSaved()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  async function addCategory() {
    if (!newCat.name.trim()) { setErr('Enter a name for the new category'); return }
    setBusy(true); setErr('')
    try {
      await econ.addCustomCaptureRateCategory(proposalId, { category: newCat.name.trim(), conservativePct: Number(newCat.conservativePct), expectedPct: Number(newCat.expectedPct), aggressivePct: Number(newCat.aggressivePct) })
      setNewCat({ name: '', conservativePct: 40, expectedPct: 60, aggressivePct: 80 }); setShowAdd(false); await onSaved()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  async function removeCategory(id) {
    setBusy(true); setErr('')
    try { await econ.deleteCaptureRateCategory(id); await onSaved() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="card">
      <div className="card-body">
        {err && <Alert type="danger" message={err} />}
        <div className="table-wrap"><table>
          <thead><tr><th style={th}>Category</th><th style={th} title="e.g. 40 (worst-case % of the benefit you actually capture)">Conservative %</th><th style={th} title="e.g. 60 (expected-case %)">Expected %</th><th style={th} title="e.g. 80 (best-case %)">Aggressive %</th>{canEdit && <th style={th}></th>}</tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.category}>
              <td style={td}>
                {CATEGORY_LABEL[r.category] || r.category}
                {r.is_custom && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: '#f59e0b', border: '1px solid #f59e0b', borderRadius: 4, padding: '1px 5px' }} title="Custom category — reference/manual tracking only; the Scenario calculation engine only uses the 11 built-in categories above it">Custom</span>}
              </td>
              {['conservative_pct', 'expected_pct', 'aggressive_pct'].map(col => (
                <td key={col} style={td}><input className="input" type="number" disabled={!canEdit} value={fieldValue(r[col])} onChange={e => setRate(r.category, col, e.target.value)} style={{ maxWidth: 90 }} /></td>
              ))}
              {canEdit && <td style={td}>{r.is_custom && <button className="btn btn-outline btn-sm" onClick={() => removeCategory(r.id)}>Remove</button>}</td>}
            </tr>
          ))}</tbody>
        </table></div>

        {canEdit && (
          <div style={{ marginTop: 12 }}>
            {!showAdd ? (
              <button className="btn btn-outline btn-sm" onClick={() => setShowAdd(true)}>+ Add Custom Category</button>
            ) : (
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', padding: 12, background: 'var(--surface)', borderRadius: 10 }}>
                <div><FieldLabel style={label} example="e.g. Insurance Savings (any category not in the 11 above)">Category Name</FieldLabel><input className="input" value={newCat.name} onChange={e => setNewCat(c => ({ ...c, name: e.target.value }))} /></div>
                <div><FieldLabel style={label} example="e.g. 40">Conservative %</FieldLabel><input className="input" type="number" value={newCat.conservativePct} onChange={e => setNewCat(c => ({ ...c, conservativePct: e.target.value }))} style={{ maxWidth: 90 }} /></div>
                <div><FieldLabel style={label} example="e.g. 60">Expected %</FieldLabel><input className="input" type="number" value={newCat.expectedPct} onChange={e => setNewCat(c => ({ ...c, expectedPct: e.target.value }))} style={{ maxWidth: 90 }} /></div>
                <div><FieldLabel style={label} example="e.g. 80">Aggressive %</FieldLabel><input className="input" type="number" value={newCat.aggressivePct} onChange={e => setNewCat(c => ({ ...c, aggressivePct: e.target.value }))} style={{ maxWidth: 90 }} /></div>
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={addCategory}>Add</button>
                <button className="btn btn-outline btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
              </div>
            )}
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 6 }}>Custom categories are for reference/manual tracking — the Scenario calculation engine only reads the 11 built-in categories above.</div>
          </div>
        )}

        <div style={{ marginTop: 22 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Equipment Efficiency Split {weightSum !== 100 && <span style={{ color: '#e11d48', fontSize: 11, fontWeight: 500 }}> — must sum to 100% (currently {weightSum}%)</span>}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12 }}>
            {[
              ['utilization_pct', 'Utilization', 'e.g. 25 (share of the efficiency loss due to under-utilization)'],
              ['rental_pct', 'Rental', 'e.g. 25 (share due to avoidable rental spend)'],
              ['operator_behavior_pct', 'Operator Behavior', 'e.g. 25 (share due to operator behavior)'],
              ['unauthorized_usage_pct', 'Unauthorized Usage', 'e.g. 25 (share due to unauthorized use)'],
            ].map(([k, l, ex]) => (
              <div key={k}><FieldLabel style={label} example={ex}>{l} %</FieldLabel><input className="input" type="number" disabled={!canEdit} value={fieldValue(weights[k])} onChange={e => setWeights(w => ({ ...w, [k]: Number(e.target.value) }))} /></div>
            ))}
          </div>
        </div>
        {canEdit && <button className="btn btn-primary btn-sm" disabled={busy || weightSum !== 100} onClick={save} style={{ marginTop: 16 }}>{busy ? 'Saving…' : 'Save Capture Rates'}</button>}
      </div>
    </div>
  )
}

function ScenariosTab({ proposalId, proposal, snapshots, canEdit, onRecalculate, onSetActive, busy }) {
  return (
    <div>
      {canEdit && <button className="btn btn-primary btn-sm" disabled={busy} onClick={onRecalculate} style={{ marginBottom: 16 }}><RefreshCw size={13} style={{ marginRight: 6 }} />{busy ? 'Calculating…' : 'Recalculate All Scenarios'}</button>}
      {Object.keys(snapshots).length === 0 ? (
        <Empty icon="🧮" title="No snapshot yet" desc="Fill in Sites, Cost Drivers and Capture Rates, then Recalculate" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 16 }}>
          {SCENARIOS.map(sc => {
            const s = snapshots[sc]
            const isActive = proposal.active_scenario === sc
            return (
              <div key={sc} className="card" style={{ border: isActive ? `2px solid ${SCENARIO_COLOR[sc]}` : undefined }}>
                <div className="card-header"><span className="card-title" style={{ color: SCENARIO_COLOR[sc] }}>{SCENARIO_LABEL[sc]}</span></div>
                <div className="card-body">
                  {!s ? <Empty icon="—" title="Not calculated" desc="" /> : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <Stat label="Total Annual Saving" value={rupee(s.total_annual_saving)} />
                      <Stat label="Total Investment" value={rupee(s.total_investment)} />
                      <Stat label="ROI %" value={s.roi_pct != null ? `${s.roi_pct}%` : '—'} accent={SCENARIO_COLOR[sc]} />
                      <Stat label="Payback (months)" value={s.payback_months != null ? s.payback_months : '—'} />
                      <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Computed {dateFmt(s.computed_at)}</div>
                      {canEdit && !isActive && <button className="btn btn-outline btn-sm" onClick={() => onSetActive(sc)}>Set as Active Scenario</button>}
                      {isActive && <span style={{ fontSize: 11, fontWeight: 700, color: SCENARIO_COLOR[sc] }}>● Active Scenario</span>}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Stat({ label: l, value, accent }) {
  return <div><div style={label}>{l}</div><div style={{ fontSize: 16, fontWeight: 800, color: accent }}>{value}</div></div>
}

function BurnTab({ proposalId }) {
  const [burn, setBurn] = useState(null)
  const [budgetLines, setBudgetLines] = useState([])
  const [budgetLineId, setBudgetLineId] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { load() }, [proposalId])
  async function load() {
    try {
      const b = await roi.getBurn(proposalId)
      setBurn(b)
      const { data } = await supabase.from('budgets').select('id,category,allocated').eq('project_id', b.proposal.project_id)
      setBudgetLines(data || [])
    } catch (e) { setErr(e.message) }
  }

  async function sync() {
    if (!budgetLineId) { setErr('Select a budget line to sync against first'); return }
    setSyncing(true); setErr('')
    try { await roi.syncBurnFromBudget(proposalId, burn.proposal.project_id, budgetLineId); await load() }
    catch (e) { setErr(e.message) } finally { setSyncing(false) }
  }

  if (!burn) return <Loader />
  return (
    <div className="card">
      <div className="card-body">
        {err && <Alert type="danger" message={err} />}
        {!burn.proposal.approved_at && <Alert type="info" message="This proposal hasn't been approved yet — the burn curve and elapsed-time metrics activate once it is." />}

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 18, padding: 12, background: 'var(--surface)', borderRadius: 10 }}>
          <div style={{ flex: '1 1 240px' }}>
            <FieldLabel style={label} example="e.g. Hardware — IoT Loggers (the budgets row funding this proposal's investment)">Budget Line (Budget & Finance)</FieldLabel>
            <select className="input" value={budgetLineId} onChange={e => setBudgetLineId(e.target.value)}>
              <option value="">Select a budget line…</option>
              {budgetLines.map(b => <option key={b.id} value={b.id}>{b.category} — {rupee(b.allocated)} allocated</option>)}
            </select>
          </div>
          <button className="btn btn-primary btn-sm" disabled={syncing} onClick={sync}><RefreshCw size={13} style={{ marginRight: 6 }} />{syncing ? 'Syncing…' : 'Sync Actuals from Budget & Finance'}</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14 }}>
          <Stat label="Elapsed Months" value={burn.elapsedMonths} />
          <Stat label="Actual Burn to Date" value={rupee(burn.actualBurnToDate)} />
          <Stat label="Burn Rate / Month" value={burn.burnRate != null ? rupee(burn.burnRate) : '—'} />
          <Stat label="Remaining Burn" value={rupee(burn.remainingBurn)} />
          <Stat label="Projected Final Spend" value={burn.projectedFinalSpend != null ? rupee(burn.projectedFinalSpend) : '—'} />
          <Stat label="Spend Variance" value={burn.spendVariance != null ? rupee(burn.spendVariance) : '—'} accent={burn.spendVariance < 0 ? '#e11d48' : '#10b981'} />
        </div>

        <div style={{ marginTop: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Recorded Burn Entries</div>
          {burn.entries.length === 0 ? <Empty icon="🔥" title="No burn entries yet" desc="Actuals sync in from Budget & Finance once posted against this proposal's budget line" /> : (
            <div className="table-wrap"><table>
              <thead><tr><th style={th}>Date</th><th style={th}>Amount</th><th style={th}>Description</th></tr></thead>
              <tbody>{burn.entries.map(e => <tr key={e.id}><td style={td}>{dateFmt(e.recorded_at)}</td><td style={td}>{rupee(e.amount)}</td><td style={td}>{e.description || e.source_table || '—'}</td></tr>)}</tbody>
            </table></div>
          )}
        </div>
      </div>
    </div>
  )
}

function ForecastTab({ proposalId, profile }) {
  const [duration, setDuration] = useState('')
  const [history, setHistory] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { loadHistory() }, [proposalId])
  async function loadHistory() { setHistory(await roi.getForecastHistory(proposalId)) }

  async function run() {
    setBusy(true); setErr('')
    try { await roi.forecast(proposalId, { requestedDurationMonths: duration ? Number(duration) : undefined, profileId: profile?.id }); await loadHistory() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><FieldLabel style={label} example="e.g. 15 (if the plan changed from 12 to 15 months)">Requested Duration Override (months, optional)</FieldLabel><input className="input" type="number" value={duration} onChange={e => setDuration(e.target.value)} style={{ maxWidth: 200 }} /></div>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={run}>{busy ? 'Running…' : 'Run Forecast'}</button>
        </div>
      </div>
      {err && <Alert type="danger" message={err} />}
      {history.length === 0 ? <Empty icon="📉" title="No forecast runs yet" desc="Run one above" /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {history.map(run => {
            const r = run.results
            return (
              <div key={run.id} className="card">
                <div className="card-body">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontWeight: 700, textTransform: 'capitalize', color: SCENARIO_COLOR[run.scenario] }}>{run.scenario}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{dateFmt(run.run_at)}</span>
                  </div>
                  {!r.is_telemetry_adjusted && (
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#b45309', background: '#fef3c7', padding: '4px 8px', borderRadius: 6, display: 'inline-block', marginBottom: 10 }}>
                      Based on original plan, not actuals — no telemetry linkage for this project
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
                    <Stat label="Proposed Investment" value={rupee(r.proposed_investment)} />
                    <Stat label="Burned to Date" value={rupee(r.burned_to_date)} />
                    <Stat label="Remaining" value={rupee(r.remaining_burn)} />
                    <Stat label="Projected at Current Rate" value={r.projected_at_current_rate != null ? rupee(r.projected_at_current_rate) : '—'} />
                    <Stat label="Required Burn Rate / Mo" value={r.required_burn_rate_to_hit_target != null ? rupee(r.required_burn_rate_to_hit_target) : '—'} />
                    <Stat label="Revised ROI %" value={r.revised_roi_pct != null ? `${r.revised_roi_pct}%` : '—'} />
                    <Stat label="Revised Payback (mo)" value={r.revised_payback_months != null ? r.revised_payback_months : '—'} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const RISK_COLOR_A = { low: '#10b981', medium: '#f59e0b', high: '#e11d48' }

function ApprovalTab({ proposal, chain, role, profile, onSubmit, onAct, busy, isDraft }) {
  const [note, setNote] = useState('')
  const currentIdx = chain.findIndex(s => s.status === proposal.approval_status)
  const canAct = proposal.approval_status && (role === 'admin' || chain.find(s => s.status === proposal.approval_status)?.key === role)
  const isFinalStep = currentIdx === chain.length - 1
  const summary = proposal.approval_summary

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {summary && (
        <div className="card">
          <div className="card-header"><span className="card-title">Approval Summary (frozen at submission)</span></div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
              <div><div style={label}>Investment Requested</div><div style={{ fontWeight: 700 }}>{summary.investment_requested != null ? rupee(summary.investment_requested) : '—'}</div></div>
              <div><div style={label}>Total PO</div><div style={{ fontWeight: 700 }}>{summary.total_po != null ? rupee(summary.total_po) : '—'}</div></div>
              <div><div style={label}>Delivery Cost</div><div style={{ fontWeight: 700 }}>{summary.delivery_cost != null ? rupee(summary.delivery_cost) : '—'}</div></div>
              <div><div style={label}>Gross Profit</div><div style={{ fontWeight: 700 }}>{summary.gross_profit != null ? rupee(summary.gross_profit) : '—'} {summary.gross_margin_pct != null && `(${summary.gross_margin_pct}%)`}</div></div>
              <div><div style={label}>Customer ROI %</div><div style={{ fontWeight: 700 }}>{summary.customer_roi_pct != null ? `${summary.customer_roi_pct}%` : '—'}</div></div>
              <div><div style={label}>Payback</div><div style={{ fontWeight: 700 }}>{summary.customer_payback_months != null ? `${summary.customer_payback_months} mo` : '—'}</div></div>
              <div><div style={label}>NPV / IRR</div><div style={{ fontWeight: 700 }}>{summary.npv != null ? rupee(summary.npv) : '—'} {summary.irr_pct != null && `/ ${summary.irr_pct}%`}</div></div>
              <div><div style={label}>Risk Rating</div><div style={{ fontWeight: 800, textTransform: 'uppercase', color: RISK_COLOR_A[summary.risk_rating] }}>{summary.risk_rating || '—'}</div></div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-body">
          {proposal.status === 'rejected' && proposal.rejection_reason && <Alert type="danger" message={`Rejected: ${proposal.rejection_reason}`} />}
          {proposal.decision_outcome === 'revise' && proposal.status === 'draft' && <Alert type="warning" message={`Revisions requested${proposal.rejection_reason ? ': ' + proposal.rejection_reason : ''}`} />}
          {isDraft && (
            <div style={{ marginBottom: 16 }}>
              <button className="btn btn-primary" disabled={busy} onClick={onSubmit}>{busy ? 'Submitting…' : 'Submit for Approval'}</button>
            </div>
          )}
          {proposal.approval_status && (
            <div style={{ marginBottom: 20 }}>
              <ApprovalChain steps={chain.map(s => ({ label: s.short, name: s.label }))} currentStep={currentIdx === -1 ? chain.length : currentIdx} />
            </div>
          )}
          {proposal.status === 'pending_approval' && canAct && (
            <div>
              <textarea className="input" placeholder="Note (required if rejecting or revising; conditions text if approving with conditions)" value={note} onChange={e => setNote(e.target.value)} style={{ width: '100%', minHeight: 70, marginBottom: 10 }} />
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onAct('approve', note)}>Approve</button>
                {isFinalStep && <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => onAct('approve_with_conditions', note)}>Approve with Conditions</button>}
                <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => onAct('revise', note)}>Request Revision</button>
                <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => onAct('reject', note)}>Reject</button>
              </div>
            </div>
          )}
          {proposal.status === 'approved' && (
            <Alert type="success" message={
              proposal.decision_outcome === 'approve_with_conditions'
                ? `Approved with conditions${proposal.approved_at ? ' on ' + dateFmt(proposal.approved_at) : ''}: ${proposal.conditions_text || '—'}`
                : `Approved${proposal.approved_at ? ' on ' + dateFmt(proposal.approved_at) : ''}. Snapshots are now frozen.`
            } />
          )}
        </div>
      </div>
    </div>
  )
}
