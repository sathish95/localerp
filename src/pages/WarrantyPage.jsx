import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { dateFmt, rupee } from '../lib/supabase'
import {
  getWarrantySettings, upsertWarrantySettings, listWarrantyPolicies, createWarrantyPolicy, updateWarrantyPolicy,
  searchDeviceBySerial, getActiveWarrantyForDevice, getWarrantyTrace, listClaims, createWarrantyClaim,
  canActOnClaim, approveClaimStep, resolveClaimReplace, resolveClaimRepair, resolveClaimRemoteFix, rejectClaim,
  isDeviceUnderWarranty, listWarrantyBudgets, createWarrantyBudget, updateWarrantyBudget, deleteWarrantyBudget,
  listDepreciationTiers, listAllDepreciationTiers, saveDepreciationTiers, computeDeviceAgeMonths,
  getDeviceWarrantyById,
} from '../lib/warranty'
import { recomputeWarrantyAnalyticsRollup, getWarrantyAnalyticsRollup, generateWarrantyFindings } from '../lib/warrantyAnalytics'
import * as warrantyApproval from '../lib/warrantyApproval'
import { Modal, SearchBox, Loader, Empty, Tabs, Confirm, ApprovalChain } from '../components/ui'
import { RefreshCw, ShieldCheck, ShieldAlert, Plus, ArrowRightLeft } from 'lucide-react'

const Kpi = ({ label, value, color }) => (
  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, borderTop: `2px solid ${color}`, padding: '10px 14px' }}>
    <div style={{ fontWeight: 800, fontSize: 22, color, lineHeight: 1 }}>{value}</div>
    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 4 }}>{label}</div>
  </div>
)

const CLAIM_STATUS_COLOR = {
  Reported: '#3b82f6', 'Under Review': '#f59e0b',
  'PM Review': '#f59e0b', 'CEO Review': '#fb923c', 'Finance Review': '#a855f7',
  Approved: '#8b5cf6', Resolved: '#10b981', Rejected: '#e11d48',
}
const StatusPill = ({ status }) => (
  <span style={{ padding: '2px 9px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: `${CLAIM_STATUS_COLOR[status] || '#94a3b8'}18`, color: CLAIM_STATUS_COLOR[status] || '#94a3b8', border: `1px solid ${CLAIM_STATUS_COLOR[status] || '#94a3b8'}30`, whiteSpace: 'nowrap' }}>{status}</span>
)

const initClaimForm = () => ({ deviceId: '', serial: '', issueType: 'Hardware Failure', issueDescription: '', estimatedCost: '' })

// Chain is DB-configurable (see warrantyApproval.js) — read from the sync
// cache at render time, warmed once by WarrantyPage's init() via getChain().
function chainCurrentStep(statusOrder, status) {
  const idx = statusOrder.indexOf(status)
  if (idx !== -1) return idx
  return (status === 'Approved' || status === 'Resolved') ? statusOrder.length : 0
}

export default function WarrantyPage() {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const [searchParams] = useSearchParams()

  const isFieldTech = role === 'field_technician'
  const canEditConfig = ['admin', 'ceo', 'finance'].includes(role)
  const canApprove = ['admin', 'ceo', 'pm', 'finance'].includes(role)
  const canResolve = ['admin', 'ceo', 'finance', 'manager', 'department_head', 'procurement_lead'].includes(role)
  const canViewCostFigures = ['admin', 'ceo', 'finance'].includes(role) // matches warranty_cost_entries/warranty_budgets RLS

  const [tab, setTab] = useState(isFieldTech ? 'claims' : (searchParams.get('tab') || 'overview'))
  const [loading, setLoading] = useState(true)
  const [recomputing, setRecomputing] = useState(false)
  const [chainVer, setChainVer] = useState(0)
  const chainSteps = useMemo(() => warrantyApproval.getChainSync().map(s => ({ label: s.label })), [chainVer])
  const chainStatusOrder = useMemo(() => warrantyApproval.getChainSync().map(s => s.status), [chainVer])

  const [policies, setPolicies] = useState([])
  const [allTiers, setAllTiers] = useState([])
  const [claims, setClaims] = useState([])
  const [rollup, setRollup] = useState([])
  const [budgets, setBudgets] = useState([])
  const [settings, setSettings] = useState({ claimAutoApproveThreshold: 25000, nearExpiryAlertDays: 30, defaultFreshWarrantyOnReplacement: true })

  const [claimStatusFilter, setClaimStatusFilter] = useState('')
  const [showClaimModal, setShowClaimModal] = useState(false)
  const [claimForm, setClaimForm] = useState(initClaimForm())
  const [serialResults, setSerialResults] = useState([])
  const [selectedDeviceWarranty, setSelectedDeviceWarranty] = useState(null)
  const [claimEstimatePreview, setClaimEstimatePreview] = useState(null)
  const [claimErr, setClaimErr] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [resolveClaim, setResolveClaimModal] = useState(null)
  const [resolveForm, setResolveForm] = useState({ action: 'Replace', replacementSerial: '', replacementDeviceId: '', replacementStandardCost: null, amount: '', claimAmount: '', costBreakdown: '', reason: '', rejectionReason: '' })
  const [replacementResults, setReplacementResults] = useState([])

  const [traceDeviceId, setTraceDeviceId] = useState(searchParams.get('device') || null)
  const [trace, setTrace] = useState(null)

  const [showPolicyModal, setShowPolicyModal] = useState(false)
  const [policyForm, setPolicyForm] = useState({ id: null, part_number: '', policy_name: '', warranty_duration_months: 12, coverage_type: 'Both', hardware_covered: true, software_covered: false, fresh_warranty_on_replacement: true, terms_notes: '', is_active: true })
  const [policyTierRows, setPolicyTierRows] = useState([])

  // ── Resolve modal: live Age / Claim % / Suggested Value preview ──
  const [resolveDeviceWarranty, setResolveDeviceWarranty] = useState(null)
  const [resolvePreview, setResolvePreview] = useState(null)

  const initBudgetForm = () => ({ id: null, scope_type: 'product_type', part_number: '', project_id: '', period_key: String(new Date().getFullYear()), planned_warranty_reserve: '', planning_method: 'flat_per_unit', planning_param: '' })
  const [showBudgetModal, setShowBudgetModal] = useState(false)
  const [budgetForm, setBudgetForm] = useState(initBudgetForm())
  const [deleteBudgetConfirm, setDeleteBudgetConfirm] = useState(null)

  useEffect(() => { if (profile?.id) init() }, [profile?.id])
  useEffect(() => { if (traceDeviceId) openTrace(traceDeviceId) }, [traceDeviceId])

  async function init() {
    setLoading(true)
    // Recompute is only meaningful (and safe) for roles that can read
    // warranty_cost_entries — otherwise RLS blocks the cost side and a
    // recompute would silently overwrite good numbers with zeros.
    if (canViewCostFigures) {
      setRecomputing(true)
      await recomputeWarrantyAnalyticsRollup()
      await generateWarrantyFindings()
      setRecomputing(false)
    }
    const pol = await loadAll()
    await warrantyApproval.getChain()
    setChainVer(v => v + 1)

    // Deep link from Inventory → Component's "Manage Warranty Policy" —
    // opens straight into that part's existing policy, or a blank one
    // pre-filled with its part_number if none exists yet.
    const linkedPart = searchParams.get('part_number')
    if (linkedPart && tab === 'policies') {
      const existing = pol.find(p => p.part_number === linkedPart)
      if (existing) await openEditPolicy(existing)
      else {
        setPolicyForm({ id: null, part_number: linkedPart, policy_name: '', warranty_duration_months: 12, coverage_type: 'Both', hardware_covered: true, software_covered: false, fresh_warranty_on_replacement: true, terms_notes: '', is_active: true })
        setPolicyTierRows([])
        setShowPolicyModal(true)
      }
    }
    setLoading(false)
  }

  async function loadAll() {
    const [pol, cl, roll, sett, budg, tiers] = await Promise.all([
      listWarrantyPolicies(), listClaims(), getWarrantyAnalyticsRollup(), getWarrantySettings(),
      canEditConfig ? listWarrantyBudgets().catch(() => []) : Promise.resolve([]),
      listAllDepreciationTiers(),
    ])
    setPolicies(pol); setClaims(cl); setRollup(roll); setSettings(sett); setBudgets(budg); setAllTiers(tiers)
    return pol
  }
  const tiersByPolicy = useMemo(() => {
    const m = {}
    allTiers.forEach(t => { (m[t.warranty_policy_id] ||= []).push(t) })
    return m
  }, [allTiers])

  async function recomputeNow() {
    setRecomputing(true)
    await recomputeWarrantyAnalyticsRollup()
    await generateWarrantyFindings()
    setRecomputing(false)
    loadAll()
  }

  // ── Claims: intake ──
  async function searchSerial(v) {
    setClaimForm(f => ({ ...f, serial: v, deviceId: '' }))
    setSelectedDeviceWarranty(null)
    setClaimEstimatePreview(null)
    if (v.length < 2) { setSerialResults([]); return }
    setSerialResults(await searchDeviceBySerial(v))
  }
  // Selecting a device computes its age-based claim value right away
  // (standard cost x the applied policy's depreciation % for its current
  // age) and pre-fills Estimated Cost with it — still a plain editable
  // field, this is just the system's starting suggestion, not a lock.
  async function pickDevice(d) {
    setClaimForm(f => ({ ...f, deviceId: d.id, serial: d.serial_number }))
    setSerialResults([])
    const warranty = await getActiveWarrantyForDevice(d.id)
    setSelectedDeviceWarranty(warranty)
    if (warranty && isDeviceUnderWarranty(warranty)) {
      const ageMonths = computeDeviceAgeMonths(warranty.deployment_date)
      const tiers = warranty.warranty_policy_id ? tiersByPolicy[warranty.warranty_policy_id] : null
      const claimPct = claimPctFromTiers(tiers, ageMonths)
      const standardCost = Number(d.product?.standard_cost || 0)
      const claimValue = Math.round(standardCost * (claimPct / 100) * 100) / 100
      setClaimEstimatePreview({ ageMonths, claimPct, claimValue, standardCost })
      setClaimForm(f => ({ ...f, estimatedCost: claimValue }))
    } else {
      setClaimEstimatePreview(null)
    }
  }
  function openNewClaim() { setClaimForm(initClaimForm()); setClaimErr(''); setSelectedDeviceWarranty(null); setClaimEstimatePreview(null); setShowClaimModal(true) }

  async function submitClaim(e) {
    e.preventDefault()
    if (!claimForm.deviceId) { setClaimErr('Search and select a device by serial number.'); return }
    setSubmitting(true); setClaimErr('')
    try {
      await createWarrantyClaim({
        deviceId: claimForm.deviceId, issueDescription: claimForm.issueDescription, issueType: claimForm.issueType,
        estimatedCost: Number(claimForm.estimatedCost) || 0, raisedBy: profile.id,
      })
      setShowClaimModal(false); loadAll()
    } catch (e) { setClaimErr(e.message) }
    finally { setSubmitting(false) }
  }

  // ── Claims: approve / reject — walks the fixed PM -> CEO -> Finance chain
  // (src/lib/warrantyApproval.js); which step is "next" is derived from the
  // claim's current status, not chosen here. ──
  async function handleApprove(claim, approve) {
    const rejectionReason = approve ? null : window.prompt('Reason for rejecting this claim?') || ''
    if (!approve && !rejectionReason) return
    try {
      await approveClaimStep(claim.id, role, profile.id, { approve, rejectionReason })
    } catch (e) { alert(e.message) }
    loadAll()
  }

  // ── Claims: resolution ──
  async function openResolve(claim) {
    setResolveClaimModal(claim)
    setResolveForm({ action: 'Replace', replacementSerial: '', replacementDeviceId: '', replacementStandardCost: null, amount: '', costBreakdown: '', reason: '', rejectionReason: '' })
    setReplacementResults([])
    setResolveDeviceWarranty(claim.device_warranty_id ? await getDeviceWarrantyById(claim.device_warranty_id) : null)
  }
  async function searchReplacement(v) {
    setResolveForm(f => ({ ...f, replacementSerial: v, replacementDeviceId: '', replacementStandardCost: null }))
    if (v.length < 2) { setReplacementResults([]); return }
    const results = await searchDeviceBySerial(v)
    setReplacementResults(results.filter(d => d.status === 'in_storage'))
  }

  // Pure age->% lookup mirroring src/lib/warranty.js's getClaimPercentageForAge,
  // but against the already-loaded `allTiers` so this preview updates
  // instantly as the user types/picks, with no extra DB round-trip.
  function claimPctFromTiers(tiers, ageMonths) {
    if (!tiers?.length) return 100
    const match = tiers.find(t => ageMonths >= Number(t.min_age_months) && (t.max_age_months == null || ageMonths < Number(t.max_age_months)))
    return match ? Number(match.claim_percentage) : 0
  }
  useEffect(() => {
    if (resolveForm.action !== 'Replace' || !resolveDeviceWarranty || resolveForm.replacementStandardCost == null) { setResolvePreview(null); return }
    const ageMonths = computeDeviceAgeMonths(resolveDeviceWarranty.deployment_date)
    const tiers = resolveDeviceWarranty.warranty_policy_id ? tiersByPolicy[resolveDeviceWarranty.warranty_policy_id] : null
    const claimPct = claimPctFromTiers(tiers, ageMonths)
    const standardCost = Number(resolveForm.replacementStandardCost)
    const claimValue = Math.round(standardCost * (claimPct / 100) * 100) / 100
    setResolvePreview({ ageMonths, claimPct, claimValue, standardCost })
    // Pre-fill the editable Claim Amount with the freshly computed value —
    // same "system-calculated but editable" pattern as the New Claim modal.
    setResolveForm(f => ({ ...f, claimAmount: claimValue }))
  }, [resolveForm.action, resolveForm.replacementStandardCost, resolveDeviceWarranty, tiersByPolicy])
  async function submitResolve(e) {
    e.preventDefault()
    setSubmitting(true); setClaimErr('')
    try {
      const claimId = resolveClaim.id
      if (resolveForm.action === 'Replace') {
        if (!resolveForm.replacementDeviceId) throw new Error('Select an in-storage replacement device by serial number.')
        await resolveClaimReplace({
          claimId, replacementDeviceId: resolveForm.replacementDeviceId, movedBy: profile.id, reason: resolveForm.reason,
          amountOverride: resolveForm.claimAmount === '' ? null : Number(resolveForm.claimAmount),
        })
      } else if (resolveForm.action === 'Repair') {
        await resolveClaimRepair({ claimId, amount: Number(resolveForm.amount) || 0, costBreakdown: resolveForm.costBreakdown, profileId: profile.id })
      } else if (resolveForm.action === 'Remote Fix') {
        await resolveClaimRemoteFix({ claimId, amount: Number(resolveForm.amount) || 0, costBreakdown: resolveForm.costBreakdown, profileId: profile.id })
      } else if (resolveForm.action === 'Reject') {
        await rejectClaim({ claimId, rejectionReason: resolveForm.rejectionReason })
      }
      // Best-effort, immediate refresh so the Budgets/Overview cost figures
      // reflect this resolution right away instead of waiting for the next
      // page load's auto-recompute. Only Replace/Repair/Remote Fix actually
      // book a cost entry (Reject doesn't, nothing to refresh for that path).
      // Gated on canViewCostFigures: warranty_cost_entries/warranty_budgets
      // are RLS-readable only by admin/ceo/finance, so a manager/department_head/
      // procurement_lead session would recompute against an empty dataset and
      // overwrite good numbers with wrong (zeroed) ones — worse than not
      // recomputing at all. Their resolutions still get picked up correctly
      // the next time a cost-visible role opens the page.
      if (resolveForm.action !== 'Reject' && canViewCostFigures) {
        try {
          await recomputeWarrantyAnalyticsRollup()
          await generateWarrantyFindings()
        } catch (err) { console.error('[WarrantyPage:submitResolve] recompute failed', err) }
      }
      setResolveClaimModal(null); loadAll()
    } catch (e) { setClaimErr(e.message) }
    finally { setSubmitting(false) }
  }

  // ── Device trace ──
  async function openTrace(deviceId) {
    setTraceDeviceId(deviceId)
    setTrace(await getWarrantyTrace(deviceId))
  }

  // ── Policies ──
  function openNewPolicy() { setPolicyForm({ id: null, part_number: '', policy_name: '', warranty_duration_months: 12, coverage_type: 'Both', hardware_covered: true, software_covered: false, fresh_warranty_on_replacement: true, terms_notes: '', is_active: true }); setPolicyTierRows([]); setShowPolicyModal(true) }
  async function openEditPolicy(p) { setPolicyForm({ ...p }); setPolicyTierRows(await listDepreciationTiers(p.id)); setShowPolicyModal(true) }

  function addTierRow() { setPolicyTierRows(rows => [...rows, { min_age_months: rows.length ? (rows[rows.length - 1].max_age_months ?? '') : 0, max_age_months: '', claim_percentage: '' }]) }
  function updateTierRow(i, patch) { setPolicyTierRows(rows => rows.map((r, ix) => ix === i ? { ...r, ...patch } : r)) }
  function removeTierRow(i) { setPolicyTierRows(rows => rows.filter((_, ix) => ix !== i)) }

  async function submitPolicy(e) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const { id, ...payload } = policyForm
      let policyId = id
      if (id) await updateWarrantyPolicy(id, payload)
      else { const created = await createWarrantyPolicy(payload, profile.id); policyId = created.id }
      await saveDepreciationTiers(policyId, policyTierRows)
      setShowPolicyModal(false); loadAll()
    } catch (e) { alert(e.message) }
    finally { setSubmitting(false) }
  }

  // ── Budgets ──
  function openNewBudget() { setBudgetForm(initBudgetForm()); setShowBudgetModal(true) }
  function openEditBudget(b) { setBudgetForm({ ...b, planned_warranty_reserve: b.planned_warranty_reserve ?? '', planning_param: b.planning_param ?? '' }); setShowBudgetModal(true) }
  async function submitBudget(e) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const { id, ...rest } = budgetForm
      const payload = {
        ...rest,
        part_number: budgetForm.scope_type === 'product_type' ? budgetForm.part_number : null,
        project_id: budgetForm.scope_type === 'project' ? budgetForm.project_id : null,
        planned_warranty_reserve: Number(budgetForm.planned_warranty_reserve) || 0,
        planning_param: Number(budgetForm.planning_param) || 0,
      }
      if (id) await updateWarrantyBudget(id, payload)
      else await createWarrantyBudget(payload, profile.id)
      setShowBudgetModal(false); loadAll()
    } catch (e) { alert(e.message) }
    finally { setSubmitting(false) }
  }
  async function handleDeleteBudget(id) { await deleteWarrantyBudget(id); setDeleteBudgetConfirm(null); loadAll() }

  // ── Settings ──
  async function saveSettings() { await upsertWarrantySettings({
    claim_auto_approve_threshold: settings.claimAutoApproveThreshold, near_expiry_alert_days: settings.nearExpiryAlertDays,
    default_fresh_warranty_on_replacement: settings.defaultFreshWarrantyOnReplacement,
  }, profile.id) }

  const filteredClaims = useMemo(() => claims.filter(c => !claimStatusFilter || c.status === claimStatusFilter), [claims, claimStatusFilter])
  const companyRow = rollup.find(r => r.part_number === 'ALL' && r.issue_type === 'ALL')
  const byProduct = rollup.filter(r => r.part_number !== 'ALL' && r.issue_type === 'ALL')

  const overviewKpis = {
    activeClaims: claims.filter(c => ['Reported', 'Under Review', 'PM Review', 'CEO Review', 'Finance Review', 'Approved'].includes(c.status)).length,
    claimsThisMonth: claims.filter(c => { const d = new Date(c.claim_date); const n = new Date(); return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear() }).length,
    claimRate: companyRow?.claim_rate_per_100 ?? 0,
    avgCostPerClaim: companyRow?.avg_cost_per_claim ?? 0,
    plannedReserve: companyRow?.planned_reserve_total ?? 0,
    actualCost: companyRow?.actual_cost_total ?? 0,
  }

  const tabList = isFieldTech ? [{ id: 'claims', label: 'Claims' }] : [
    { id: 'overview', label: 'Overview' },
    { id: 'claims', label: `Claims${overviewKpis.activeClaims ? ` (${overviewKpis.activeClaims})` : ''}` },
    ...(canEditConfig ? [{ id: 'policies', label: 'Policies' }, { id: 'budgets', label: 'Budgets' }, { id: 'settings', label: 'Settings' }] : []),
  ]

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Warranty Management</div>
          <div className="page-subtitle">Claim tracking, cost consumption & profit impact</div>
        </div>
        {canViewCostFigures && (
          <button className="btn btn-outline" onClick={recomputeNow} disabled={recomputing}>
            <RefreshCw size={14} style={{ animation: recomputing ? 'spin 1s linear infinite' : 'none' }} /> {recomputing ? 'Recomputing…' : 'Recompute Now'}
          </button>
        )}
      </div>

      <Tabs tabs={tabList} active={tab} onChange={setTab} />

      {/* ── OVERVIEW ── */}
      {tab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!canViewCostFigures && <div className="alert alert-info">Cost figures are visible to Finance, Admin and CEO only. You're seeing claim counts and rates only.</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
            <Kpi label="Active Claims" value={overviewKpis.activeClaims} color="#3b82f6" />
            <Kpi label="Claims This Month" value={overviewKpis.claimsThisMonth} color="#f59e0b" />
            <Kpi label="Claim Rate /100 Units" value={`${overviewKpis.claimRate}%`} color="#8b5cf6" />
            {canViewCostFigures && <>
              <Kpi label="Avg Cost / Claim" value={rupee(overviewKpis.avgCostPerClaim)} color="#e11d48" />
              <Kpi label="Planned Reserve" value={rupee(overviewKpis.plannedReserve)} color="#10b981" />
              <Kpi label="Actual Warranty Cost" value={rupee(overviewKpis.actualCost)} color="#e11d48" />
            </>}
          </div>

          <div className="card">
            <div className="card-header"><span className="card-title">By Product Type</span></div>
            <div style={{ overflowX: 'auto' }}>
              {byProduct.length === 0 ? <Empty icon="🛡" title="No data yet" desc="Deploy devices and log claims, then Recompute Now" /> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                  <thead><tr style={{ background: 'var(--surface-2)' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11 }}>Product</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11 }}>Units Deployed</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11 }}>Claims</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11 }}>Claim Rate</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11 }}>Avg Time-to-Failure</th>
                    {canViewCostFigures && <>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11 }}>Hardware Cost</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11 }}>Software Cost</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11 }}>Planned vs Actual</th>
                    </>}
                  </tr></thead>
                  <tbody>
                    {byProduct.map(r => (
                      <tr key={r.id}>
                        <td style={{ padding: '8px 12px', fontWeight: 700 }}>{r.part_number}</td>
                        <td style={{ padding: '8px 12px' }}>{r.units_deployed}</td>
                        <td style={{ padding: '8px 12px' }}>{r.claims_count}</td>
                        <td style={{ padding: '8px 12px', fontWeight: 700, color: r.claim_rate_per_100 > 10 ? '#e11d48' : 'inherit' }}>{r.claim_rate_per_100}%</td>
                        <td style={{ padding: '8px 12px' }}>{r.avg_time_to_failure_days ? `${r.avg_time_to_failure_days}d` : '—'}</td>
                        {canViewCostFigures && <>
                          <td style={{ padding: '8px 12px' }}>{rupee(r.hardware_cost_total)}</td>
                          <td style={{ padding: '8px 12px' }}>{rupee(r.software_cost_total)}</td>
                          <td style={{ padding: '8px 12px', color: r.variance_amount > 0 ? '#e11d48' : '#10b981', fontWeight: 700 }}>{rupee(r.planned_reserve_total)} / {rupee(r.actual_cost_total)}</td>
                        </>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── CLAIMS ── */}
      {tab === 'claims' && (
        <div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={openNewClaim}><Plus size={15} /> New Claim</button>
            <select className="form-select" style={{ width: 'auto' }} value={claimStatusFilter} onChange={e => setClaimStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              {['Reported', 'PM Review', 'CEO Review', 'Finance Review', 'Approved', 'Resolved', 'Rejected'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {filteredClaims.length === 0 ? <Empty icon="🛡" title="No claims found" desc="Log a claim by searching a device's serial number" /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Claim #</th><th>Date</th><th>Issue</th><th>Type</th><th>Status</th><th>Resolution</th><th>Actions</th></tr></thead>
                <tbody>
                  {filteredClaims.map(c => (
                    <tr key={c.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--c1)', cursor: 'pointer' }} onClick={() => openTrace(c.device_id)}>{c.claim_number}</td>
                      <td style={{ fontSize: 12 }}>{dateFmt(c.claim_date)}</td>
                      <td style={{ fontSize: 12, maxWidth: 220 }}>{c.issue_description}</td>
                      <td style={{ fontSize: 12 }}>{c.issue_type}</td>
                      <td><StatusPill status={c.status} /></td>
                      <td style={{ fontSize: 12 }}>{c.resolution_type || '—'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {canApprove && canActOnClaim(role, c) && <>
                            <button className="btn btn-ghost btn-sm" onClick={() => handleApprove(c, true)}>Approve</button>
                            <button className="btn btn-ghost btn-sm" style={{ color: '#e11d48' }} onClick={() => handleApprove(c, false)}>Reject</button>
                          </>}
                          {canResolve && c.status === 'Approved' && <button className="btn btn-outline btn-sm" onClick={() => openResolve(c)}>Resolve</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {trace && (
            <div className="card" style={{ marginTop: 20 }}>
              <div className="card-header"><span className="card-title">Device Warranty Trace</span></div>
              <div className="card-body">
                {trace.map((link, i) => (
                  <div key={link.device?.id || i} style={{ borderLeft: '2px solid var(--border)', paddingLeft: 14, paddingBottom: 16, position: 'relative' }}>
                    <div style={{ fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {i > 0 && <ArrowRightLeft size={12} style={{ color: 'var(--text-muted)' }} />}
                      {link.device?.serial_number} — {link.device?.product?.name || link.device?.part_number}
                    </div>
                    {link.warranties.map(w => (
                      <div key={w.id} style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                        Deployed {dateFmt(w.deployment_date)} · Warranty {dateFmt(w.warranty_start_date)} → {dateFmt(w.warranty_end_date)}
                        {isDeviceUnderWarranty(w) ? <ShieldCheck size={12} style={{ color: '#10b981', marginLeft: 6, verticalAlign: '-2px' }} /> : <ShieldAlert size={12} style={{ color: '#e11d48', marginLeft: 6, verticalAlign: '-2px' }} />}
                      </div>
                    ))}
                    {link.claims.map(c => (
                      <div key={c.id} style={{ fontSize: 12, marginTop: 6 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <StatusPill status={c.status} /> <span>{c.issue_type}</span> <span style={{ color: 'var(--text-muted)' }}>{dateFmt(c.claim_date)}</span>
                          {c.resolution_type && <span>→ {c.resolution_type}</span>}
                          {canViewCostFigures && c.costEntries?.length > 0 && <span style={{ color: '#e11d48', fontWeight: 700 }}>{rupee(c.costEntries.reduce((s, e) => s + Number(e.amount || 0), 0))}</span>}
                        </div>
                        {c.chain_type === 'full' && c.status !== 'Rejected' && (
                          <div style={{ marginTop: 6, maxWidth: 260 }}>
                            <ApprovalChain steps={chainSteps} currentStep={chainCurrentStep(chainStatusOrder, c.status)} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── POLICIES ── */}
      {tab === 'policies' && canEditConfig && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button className="btn btn-primary" onClick={openNewPolicy}><Plus size={15} /> New Policy</button>
          </div>
          {policies.length === 0 ? <Empty icon="📋" title="No warranty policies" desc="Devices fall back to their product's default warranty_months until a policy is defined" /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Policy</th><th>Part Number</th><th>Duration</th><th>Coverage</th><th>HW/SW</th><th>Fresh on Replace</th><th>Depreciation</th><th></th></tr></thead>
                <tbody>
                  {policies.map(p => (
                    <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => openEditPolicy(p)}>
                      <td className="td-bold">{p.policy_name}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.part_number || '—'}</td>
                      <td>{p.warranty_duration_months}mo</td>
                      <td>{p.coverage_type}</td>
                      <td>{p.hardware_covered ? 'HW' : ''}{p.hardware_covered && p.software_covered ? ' + ' : ''}{p.software_covered ? 'SW' : ''}</td>
                      <td>{p.fresh_warranty_on_replacement ? 'Yes' : 'No'}</td>
                      <td style={{ fontSize: 12 }}>{tiersByPolicy[p.id]?.length ? `${tiersByPolicy[p.id].length} tier(s)` : 'Flat 100%'}</td>
                      <td>{p.is_active ? '' : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Inactive</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── BUDGETS ── */}
      {tab === 'budgets' && canEditConfig && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <button className="btn btn-primary" onClick={openNewBudget}><Plus size={15} /> New Warranty Budget</button>
            </div>
            {budgets.length === 0 ? <Empty icon="🧮" title="No warranty budgets configured" desc="Set a planned reserve per product type or project (% of unit cost, % of revenue, or flat per unit)" /> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Scope</th><th>Period</th><th>Planned Reserve</th><th>Method</th><th></th></tr></thead>
                  <tbody>
                    {budgets.map(b => (
                      <tr key={b.id}>
                        <td className="td-bold" style={{ cursor: 'pointer' }} onClick={() => openEditBudget(b)}>{b.scope_type === 'project' ? `Project ${b.project_id}` : b.part_number}</td>
                        <td>{b.period_key}</td>
                        <td>{rupee(b.planned_warranty_reserve)}</td>
                        <td style={{ fontSize: 12 }}>{b.planning_method}{b.planning_param ? ` (${b.planning_param})` : ''}</td>
                        <td><button className="btn btn-ghost btn-sm" style={{ color: '#e11d48' }} onClick={() => setDeleteBudgetConfirm(b.id)}>Delete</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-header"><span className="card-title">Planned vs Actual Reserve (by Product)</span></div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
                <thead><tr style={{ background: 'var(--surface-2)' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11 }}>Product</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11 }}>Planned Reserve</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11 }}>Actual Cost</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11 }}>Variance</th>
                </tr></thead>
                <tbody>
                  {byProduct.map(r => (
                    <tr key={r.id}>
                      <td style={{ padding: '8px 12px', fontWeight: 700 }}>{r.part_number}</td>
                      <td style={{ padding: '8px 12px' }}>{rupee(r.planned_reserve_total)}</td>
                      <td style={{ padding: '8px 12px' }}>{rupee(r.actual_cost_total)}</td>
                      <td style={{ padding: '8px 12px', fontWeight: 700, color: r.variance_amount > 0 ? '#e11d48' : '#10b981' }}>{rupee(r.variance_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── SETTINGS ── */}
      {tab === 'settings' && canEditConfig && (
        <div className="card" style={{ maxWidth: 480 }}>
          <div className="card-header"><span className="card-title">Warranty Settings</span></div>
          <div className="card-body">
            <div className="form-group">
              <label className="form-label">Claim auto-approve threshold (₹)</label>
              <input className="form-input" type="number" value={settings.claimAutoApproveThreshold} onChange={e => setSettings(s => ({ ...s, claimAutoApproveThreshold: Number(e.target.value) }))} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Claims estimated below this amount are auto-approved; at/above it, the claim goes through PM → CEO → Finance review before it can be resolved.</div>
            </div>
            <div className="form-group">
              <label className="form-label">Near-expiry alert (days)</label>
              <input className="form-input" type="number" value={settings.nearExpiryAlertDays} onChange={e => setSettings(s => ({ ...s, nearExpiryAlertDays: Number(e.target.value) }))} />
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={settings.defaultFreshWarrantyOnReplacement} onChange={e => setSettings(s => ({ ...s, defaultFreshWarrantyOnReplacement: e.target.checked }))} />
              <label className="form-label" style={{ margin: 0 }}>Default: replacement gets a fresh warranty window</label>
            </div>
            <button className="btn btn-primary" onClick={saveSettings}>Save Settings</button>
          </div>
        </div>
      )}

      {/* ── New Claim Modal ── */}
      <Modal open={showClaimModal} onClose={() => setShowClaimModal(false)} title="Log Warranty Claim" size="md"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowClaimModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={submitClaim} disabled={submitting}>{submitting ? 'Submitting...' : 'Submit Claim'}</button>
        </>}>
        <form onSubmit={submitClaim}>
          {claimErr && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{claimErr}</div>}
          <div className="form-group">
            <label className="form-label">Device Serial Number *</label>
            <SearchBox value={claimForm.serial} onChange={searchSerial} placeholder="Search serial number..." />
            {serialResults.length > 0 && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, marginTop: 4, maxHeight: 160, overflowY: 'auto' }}>
                {serialResults.map(d => (
                  <div key={d.id} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid var(--border)' }} onClick={() => pickDevice(d)}>
                    <strong>{d.serial_number}</strong> — {d.product?.name || d.part_number} ({d.status})
                  </div>
                ))}
              </div>
            )}
            {claimForm.deviceId && selectedDeviceWarranty !== null && (
              <div style={{ marginTop: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                {selectedDeviceWarranty && isDeviceUnderWarranty(selectedDeviceWarranty)
                  ? <><ShieldCheck size={14} style={{ color: '#10b981' }} /> Under warranty until {dateFmt(selectedDeviceWarranty.warranty_end_date)}</>
                  : <><ShieldAlert size={14} style={{ color: '#e11d48' }} /> Out of warranty — claim will be logged as Rejected for record-keeping</>}
              </div>
            )}
            {claimEstimatePreview && (
              <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', marginTop: 8, fontSize: 12 }}>
                Device age <strong>{claimEstimatePreview.ageMonths}mo</strong> → <strong>{claimEstimatePreview.claimPct}%</strong> of {rupee(claimEstimatePreview.standardCost)} standard cost ={' '}
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: '#e11d48' }}>{rupee(claimEstimatePreview.claimValue)}</span> — pre-filled into Estimated Cost below, edit as needed.
              </div>
            )}
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Issue Type</label>
              <select className="form-select" value={claimForm.issueType} onChange={e => setClaimForm(f => ({ ...f, issueType: e.target.value }))}>
                {['Hardware Failure', 'Software-Firmware Issue', 'Sensor Drift', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Estimated Cost (₹) {claimEstimatePreview ? '— system-calculated, editable' : ''}</label><input className="form-input" type="number" value={claimForm.estimatedCost} onChange={e => setClaimForm(f => ({ ...f, estimatedCost: e.target.value }))} /></div>
          </div>
          <div className="form-group"><label className="form-label">Issue Description *</label><textarea className="form-textarea" value={claimForm.issueDescription} onChange={e => setClaimForm(f => ({ ...f, issueDescription: e.target.value }))} required /></div>
        </form>
      </Modal>

      {/* ── Resolve Claim Modal ── */}
      <Modal open={!!resolveClaim} onClose={() => setResolveClaimModal(null)} title={`Resolve Claim — ${resolveClaim?.claim_number || ''}`} size="md"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setResolveClaimModal(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={submitResolve} disabled={submitting}>{submitting ? 'Saving...' : 'Confirm Resolution'}</button>
        </>}>
        {resolveClaim && <form onSubmit={submitResolve}>
          {claimErr && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{claimErr}</div>}
          <div className="form-group">
            <label className="form-label">Resolution</label>
            <select className="form-select" value={resolveForm.action} onChange={e => setResolveForm(f => ({ ...f, action: e.target.value }))}>
              <option value="Replace">Replace — issue a new unit from storage</option>
              <option value="Repair">Repair — fix in place, warranty clock unchanged</option>
              <option value="Remote Fix">Remote Fix — firmware/support, no truck roll</option>
              <option value="Reject">Reject — out of warranty / not covered</option>
            </select>
          </div>

          {resolveForm.action === 'Replace' && <div className="form-group">
            <label className="form-label">Replacement Device (in storage) *</label>
            <SearchBox value={resolveForm.replacementSerial} onChange={searchReplacement} placeholder="Search serial number..." />
            {replacementResults.length > 0 && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, marginTop: 4, maxHeight: 160, overflowY: 'auto' }}>
                {replacementResults.map(d => (
                  <div key={d.id} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid var(--border)' }}
                    onClick={() => { setResolveForm(f => ({ ...f, replacementDeviceId: d.id, replacementSerial: d.serial_number, replacementStandardCost: d.product?.standard_cost ?? 0 })); setReplacementResults([]) }}>
                    <strong>{d.serial_number}</strong> — {d.product?.name || d.part_number}
                  </div>
                ))}
              </div>
            )}
            <div className="form-group" style={{ marginTop: 8 }}><label className="form-label">Reason</label><input className="form-input" value={resolveForm.reason} onChange={e => setResolveForm(f => ({ ...f, reason: e.target.value }))} placeholder="Why is this device being deployed?" /></div>
            {resolvePreview && (
              <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                <div>Device age at claim: <strong>{resolvePreview.ageMonths}mo</strong></div>
                <div>Depreciation-adjusted claim: <strong>{resolvePreview.claimPct}%</strong> of {rupee(resolvePreview.standardCost)} standard cost</div>
                <div className="form-group" style={{ marginTop: 4, marginBottom: 0 }}>
                  <label className="form-label">Claim Amount (₹) — system-calculated, editable</label>
                  <input className="form-input" type="number" value={resolveForm.claimAmount} onChange={e => setResolveForm(f => ({ ...f, claimAmount: e.target.value }))} />
                  {Number(resolveForm.claimAmount) !== resolvePreview.claimValue && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Edited from system-calculated {rupee(resolvePreview.claimValue)}</div>
                  )}
                </div>
              </div>
            )}
          </div>}

          {(resolveForm.action === 'Repair' || resolveForm.action === 'Remote Fix') && <>
            <div className="form-group"><label className="form-label">{resolveForm.action === 'Repair' ? 'Repair Cost (₹)' : 'Support Cost (₹, may be 0)'}</label><input className="form-input" type="number" value={resolveForm.amount} onChange={e => setResolveForm(f => ({ ...f, amount: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Cost Breakdown</label><textarea className="form-textarea" value={resolveForm.costBreakdown} onChange={e => setResolveForm(f => ({ ...f, costBreakdown: e.target.value }))} placeholder="e.g. technician time, parts, support hours" /></div>
          </>}

          {resolveForm.action === 'Reject' && <div className="form-group"><label className="form-label">Rejection Reason</label><textarea className="form-textarea" value={resolveForm.rejectionReason} onChange={e => setResolveForm(f => ({ ...f, rejectionReason: e.target.value }))} /></div>}
        </form>}
      </Modal>

      {/* ── Policy Modal ── */}
      <Modal open={showPolicyModal} onClose={() => setShowPolicyModal(false)} title={policyForm.id ? 'Edit Policy' : 'New Warranty Policy'} size="md"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowPolicyModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={submitPolicy} disabled={submitting}>{submitting ? 'Saving...' : 'Save Policy'}</button>
        </>}>
        <form onSubmit={submitPolicy}>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Policy Name *</label><input className="form-input" value={policyForm.policy_name} onChange={e => setPolicyForm(f => ({ ...f, policy_name: e.target.value }))} required /></div>
            <div className="form-group"><label className="form-label">Part Number</label><input className="form-input" value={policyForm.part_number} onChange={e => setPolicyForm(f => ({ ...f, part_number: e.target.value }))} placeholder="Matches products.part_number" /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Duration (months)</label><input className="form-input" type="number" value={policyForm.warranty_duration_months} onChange={e => setPolicyForm(f => ({ ...f, warranty_duration_months: Number(e.target.value) }))} /></div>
            <div className="form-group"><label className="form-label">Coverage Type</label>
              <select className="form-select" value={policyForm.coverage_type} onChange={e => setPolicyForm(f => ({ ...f, coverage_type: e.target.value }))}>
                {['Replacement', 'Repair', 'Both'].map(t => <option key={t} value={t}>{t}</option>)}
              </select></div>
          </div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}><input type="checkbox" checked={policyForm.hardware_covered} onChange={e => setPolicyForm(f => ({ ...f, hardware_covered: e.target.checked }))} /> Hardware covered</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}><input type="checkbox" checked={policyForm.software_covered} onChange={e => setPolicyForm(f => ({ ...f, software_covered: e.target.checked }))} /> Software covered</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}><input type="checkbox" checked={policyForm.fresh_warranty_on_replacement} onChange={e => setPolicyForm(f => ({ ...f, fresh_warranty_on_replacement: e.target.checked }))} /> Fresh warranty on replacement</label>
          </div>
          <div className="form-group"><label className="form-label">Terms / Notes</label><textarea className="form-textarea" value={policyForm.terms_notes} onChange={e => setPolicyForm(f => ({ ...f, terms_notes: e.target.value }))} /></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 14 }}><input type="checkbox" checked={policyForm.is_active} onChange={e => setPolicyForm(f => ({ ...f, is_active: e.target.checked }))} /> Active</label>

          <div className="form-group">
            <label className="form-label">Age-Based Claim Depreciation</label>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
              How much of standard cost a Replace claim pays out, by device age at time of claim. No tiers = always 100% (flat).
            </div>
            {policyTierRows.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 6, fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                  <span>From (mo)</span><span>To (mo, blank = ∞)</span><span>Claim %</span><span></span>
                </div>
                {policyTierRows.map((t, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 6, alignItems: 'center' }}>
                    <input className="form-input" type="number" value={t.min_age_months} onChange={e => updateTierRow(i, { min_age_months: e.target.value })} />
                    <input className="form-input" type="number" value={t.max_age_months ?? ''} onChange={e => updateTierRow(i, { max_age_months: e.target.value })} placeholder="∞" />
                    <input className="form-input" type="number" value={t.claim_percentage} onChange={e => updateTierRow(i, { claim_percentage: e.target.value })} placeholder="%" />
                    <button type="button" className="btn btn-ghost btn-sm btn-icon" style={{ color: '#e11d48' }} onClick={() => removeTierRow(i)}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <button type="button" className="btn btn-outline btn-sm" onClick={addTierRow}><Plus size={13} /> Add Age Band</button>
          </div>
        </form>
      </Modal>

      {/* ── Budget Modal ── */}
      <Modal open={showBudgetModal} onClose={() => setShowBudgetModal(false)} title={budgetForm.id ? 'Edit Warranty Budget' : 'New Warranty Budget'} size="md"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowBudgetModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={submitBudget} disabled={submitting}>{submitting ? 'Saving...' : 'Save Budget'}</button>
        </>}>
        <form onSubmit={submitBudget}>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Scope</label>
              <select className="form-select" value={budgetForm.scope_type} onChange={e => setBudgetForm(f => ({ ...f, scope_type: e.target.value }))}>
                <option value="product_type">Product Type</option>
                <option value="project">Project</option>
              </select></div>
            <div className="form-group"><label className="form-label">Period *</label><input className="form-input" value={budgetForm.period_key} onChange={e => setBudgetForm(f => ({ ...f, period_key: e.target.value }))} placeholder="e.g. 2026 or 2026-Q1" required /></div>
          </div>
          {budgetForm.scope_type === 'product_type'
            ? <div className="form-group"><label className="form-label">Part Number *</label><input className="form-input" value={budgetForm.part_number} onChange={e => setBudgetForm(f => ({ ...f, part_number: e.target.value }))} required /></div>
            : <div className="form-group"><label className="form-label">Project ID *</label><input className="form-input" value={budgetForm.project_id} onChange={e => setBudgetForm(f => ({ ...f, project_id: e.target.value }))} required /></div>}
          <div className="form-row">
            <div className="form-group"><label className="form-label">Planned Warranty Reserve (₹) *</label><input className="form-input" type="number" value={budgetForm.planned_warranty_reserve} onChange={e => setBudgetForm(f => ({ ...f, planned_warranty_reserve: e.target.value }))} required /></div>
            <div className="form-group"><label className="form-label">Planning Method</label>
              <select className="form-select" value={budgetForm.planning_method} onChange={e => setBudgetForm(f => ({ ...f, planning_method: e.target.value }))}>
                <option value="flat_per_unit">Flat estimate per unit shipped</option>
                <option value="pct_unit_cost">% of unit cost</option>
                <option value="pct_revenue">% of revenue</option>
              </select></div>
          </div>
          <div className="form-group"><label className="form-label">Planning Parameter</label><input className="form-input" type="number" value={budgetForm.planning_param} onChange={e => setBudgetForm(f => ({ ...f, planning_param: e.target.value }))} placeholder="The % (e.g. 5) or flat amount, per the method above" /></div>
        </form>
      </Modal>

      <Confirm open={!!deleteBudgetConfirm} message="Delete this warranty budget row? This cannot be undone." danger
        onConfirm={() => handleDeleteBudget(deleteBudgetConfirm)} onCancel={() => setDeleteBudgetConfirm(null)} />
    </div>
  )
}
