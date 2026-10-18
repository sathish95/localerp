/**
 * ROI PLANNING — proposal orchestration (Sections 2, 4 and the API surface
 * of Section 6 of the module spec). Thin data-access layer around the pure
 * engines in roiCalcEngine.js / roiForecast.js — every DB read/write lives
 * here, the engines themselves stay side-effect-free.
 *
 * Both entry paths (Option 1 historical_map, Option 2 manual_input) converge
 * on the same roi_proposal + child tables — everything after create() is
 * entry-mode agnostic, per the brief.
 */
import { supabase } from './supabase'
import { runAllScenarios } from './roiCalcEngine'
import { runForecast } from './roiForecast'
import { buildApprovalUpdate, getChain } from './roiApproval'
import { sendNotif, sendNotifToMany } from './notifications'

const CAPTURE_CATEGORIES = [
  'service_overrun', 'fuel_theft', 'missed_servicing', 'parts_failure',
  'labour', 'logistics', 'project_loss',
  'utilization', 'rental', 'operator_behavior', 'unauthorized_usage',
]

// ── Create (both entry paths converge here) ──────────────────────────────

/** entry_mode: 'historical_map' | 'manual_input'. Seeds defaults either way. */
export async function createProposal({ projectId, name, currency = 'INR', entryMode, durationMonths = 12, profileId }) {
  const { data: proposal, error } = await supabase.from('roi_proposal').insert({
    project_id: projectId, name, currency, entry_mode: entryMode, duration_months: durationMonths, created_by: profileId,
  }).select().single()
  if (error) throw error

  const [{ data: crDefaults }, { data: cdDefaults }] = await Promise.all([
    supabase.from('roi_capture_rate_defaults').select('*'),
    supabase.from('roi_cost_driver_defaults').select('*'),
  ])

  await Promise.all([
    supabase.from('roi_capture_rate').insert(
      (crDefaults || []).map(d => ({
        proposal_id: proposal.id, category: d.category,
        conservative_pct: d.conservative_pct, expected_pct: d.expected_pct, aggressive_pct: d.aggressive_pct,
      }))
    ),
    supabase.from('roi_efficiency_weight').insert({ proposal_id: proposal.id }), // defaults 25/25/25/25
    supabase.from('roi_cost_driver').insert({
      proposal_id: proposal.id,
      ...Object.fromEntries((cdDefaults || []).map(d => [d.field_key, d.default_value])),
    }),
  ])

  if (entryMode === 'historical_map') await mapFromHistoricalProject(proposal.id, projectId)

  return proposal
}

// ── Option 1: Historical Data Map ─────────────────────────────────────────

/**
 * Pulls what this codebase can actually source for an ongoing project:
 *   - equipment_count / equipment_replacement_value <- device_instances (status='deployed') joined to products.standard_cost
 *   - project_contract_value <- sales_opportunities.expected_value, if this project came from the Sales CRM (via proposals.linked_project_id -> sales_opportunities.linked_proposal_id, same lookup ProjectsPage.jsx's Finance tab already uses)
 *   - manual_labour_cost_monthly <- budgets rows for this project whose free-text category contains "labour" (this schema has no monthly-cost-entry granularity, so the annual allocated amount is divided by 12 — an approximation, not a measured monthly figure)
 * Logistics mismatch qty/cost-per-mismatch are NOT sourced: a `budgets` row
 * only carries a single amount, not a qty x cost breakdown, so there is no
 * historical figure to decompose it from — those two fields stay manual
 * (source stays 'manual_override', values default to 0) regardless of entry mode.
 * No telemetry ingestion exists anywhere in this schema (see roiCalcEngine.js
 * header) so cost drivers always keep the system-default benchmarks seeded
 * in createProposal() — never pre-filled from "telemetry" here.
 */
export async function mapFromHistoricalProject(proposalId, projectId) {
  const [{ data: devices }, { data: budgetsRows }, { data: proposalLink }] = await Promise.all([
    supabase.from('device_instances').select('part_number').eq('project_id', projectId).eq('status', 'deployed'),
    supabase.from('budgets').select('category,allocated').eq('project_id', projectId),
    supabase.from('proposals').select('id').eq('linked_project_id', projectId).maybeSingle(),
  ])

  const equipmentCount = (devices || []).length
  let equipmentReplacementValue = 0
  if (equipmentCount > 0) {
    const partNumbers = [...new Set((devices || []).map(d => d.part_number).filter(Boolean))]
    const { data: products } = await supabase.from('products').select('part_number,standard_cost').in('part_number', partNumbers)
    const costByPart = Object.fromEntries((products || []).map(p => [p.part_number, Number(p.standard_cost || 0)]))
    equipmentReplacementValue = (devices || []).reduce((s, d) => s + (costByPart[d.part_number] || 0), 0)
  }

  const labourTotal = (budgetsRows || [])
    .filter(b => (b.category || '').toLowerCase().includes('labour') || (b.category || '').toLowerCase().includes('labor'))
    .reduce((s, b) => s + Number(b.allocated || 0), 0)
  const manualLabourCostMonthly = Math.round((labourTotal / 12) * 100) / 100

  let projectContractValue = 0
  if (proposalLink?.id) {
    const { data: opp } = await supabase.from('sales_opportunities').select('expected_value').eq('linked_proposal_id', proposalLink.id).maybeSingle()
    projectContractValue = Number(opp?.expected_value || 0)
  }

  const { data: project } = await supabase.from('projects').select('name').eq('id', projectId).maybeSingle()

  await supabase.from('roi_site').insert({
    proposal_id: proposalId,
    site_name: project?.name || 'Site 1',
    equipment_count: equipmentCount,
    equipment_replacement_value: equipmentReplacementValue,
    manual_labour_cost_monthly: manualLabourCostMonthly,
    project_contract_value: projectContractValue,
    logistics_mismatch_qty_per_quarter: 0,
    logistics_cost_per_mismatch: 0,
    source: 'sourced',
  })
}

// ── Option 2 wizard steps (also used to edit an Option 1 proposal) ───────

/** Replaces the full site list for a proposal (the wizard owns the whole list). */
export async function updateSites(proposalId, sites) {
  await maybeReopenForApproval(proposalId)
  await supabase.from('roi_site').delete().eq('proposal_id', proposalId)
  if (sites.length) {
    await supabase.from('roi_site').insert(sites.map(s => ({
      proposal_id: proposalId,
      site_name: s.site_name,
      equipment_count: s.equipment_count,
      manual_labour_cost_monthly: s.manual_labour_cost_monthly,
      logistics_mismatch_qty_per_quarter: s.logistics_mismatch_qty_per_quarter,
      logistics_cost_per_mismatch: s.logistics_cost_per_mismatch,
      project_contract_value: s.project_contract_value,
      equipment_replacement_value: s.equipment_replacement_value,
      source: s.source || 'manual_override',
    })))
  }
}

export async function updateCostDrivers(proposalId, fields) {
  await maybeReopenForApproval(proposalId)
  const { error } = await supabase.from('roi_cost_driver').update(fields).eq('proposal_id', proposalId)
  if (error) throw error
}

export async function updateCaptureRates(proposalId, rates) {
  await maybeReopenForApproval(proposalId)
  await Promise.all(rates.map(r =>
    supabase.from('roi_capture_rate').update({
      conservative_pct: r.conservative_pct, expected_pct: r.expected_pct, aggressive_pct: r.aggressive_pct,
    }).eq('proposal_id', proposalId).eq('category', r.category)
  ))
}

export async function updateEfficiencyWeights(proposalId, weights) {
  const sum = Number(weights.utilization_pct || 0) + Number(weights.rental_pct || 0) + Number(weights.operator_behavior_pct || 0) + Number(weights.unauthorized_usage_pct || 0)
  if (Math.abs(sum - 100) > 0.1) throw new Error('Efficiency split must sum to 100%')
  await maybeReopenForApproval(proposalId)
  const { error } = await supabase.from('roi_efficiency_weight').update(weights).eq('proposal_id', proposalId)
  if (error) throw error
}

/** Investment tab: iot_logger_unit_cost x equipment_count is computed by the engine at calculate() time — this just edits the two cost_driver inputs (both directly editable per the wizard's "auto-calculated, editable override" note). */
export async function updateInvestment(proposalId, { iotLoggerUnitCost, softwareDevCostOnetime }) {
  return updateCostDrivers(proposalId, { iot_logger_unit_cost: iotLoggerUnitCost, software_dev_cost_onetime: softwareDevCostOnetime })
}

/** Any edit after a proposal has left 'draft' re-triggers approval — see brief's cross-cutting requirements. */
async function maybeReopenForApproval(proposalId) {
  const { data: proposal } = await supabase.from('roi_proposal').select('status').eq('id', proposalId).single()
  if (proposal && proposal.status !== 'draft' && proposal.status !== 'rejected') {
    await supabase.from('roi_proposal').update({ status: 'draft', approval_status: null }).eq('id', proposalId)
  }
}

// ── Calculation Engine trigger ────────────────────────────────────────────

export async function getProposalFull(proposalId) {
  const [{ data: proposal }, { data: sites }, { data: costDriver }, { data: captureRates }, { data: efficiencyWeight }] = await Promise.all([
    supabase.from('roi_proposal').select('*').eq('id', proposalId).single(),
    supabase.from('roi_site').select('*').eq('proposal_id', proposalId),
    supabase.from('roi_cost_driver').select('*').eq('proposal_id', proposalId).single(),
    supabase.from('roi_capture_rate').select('*').eq('proposal_id', proposalId),
    supabase.from('roi_efficiency_weight').select('*').eq('proposal_id', proposalId).single(),
  ])
  return { proposal, sites: sites || [], costDriver, captureRates: captureRates || [], efficiencyWeight }
}

/** Runs the engine for all 3 scenarios and writes a fresh, immutable snapshot for each. Blocked once approved. */
export async function calculate(proposalId) {
  const { proposal, sites, costDriver, captureRates, efficiencyWeight } = await getProposalFull(proposalId)
  // constrained_edit_open (set by an 'approve_with_conditions' decision — see
  // actOnApproval) is the one exception to "approved snapshots are frozen":
  // it lets the specific follow-up edit the conditions called for go through
  // without spinning up a whole new proposal, then clears itself below.
  if (proposal.status === 'approved' && !proposal.constrained_edit_open) {
    throw new Error('This proposal is approved — its snapshots are frozen. Create a new proposal for a revised case.')
  }
  if (!costDriver || !efficiencyWeight) throw new Error('Proposal is missing its cost-driver or efficiency-weight row — cannot calculate.')

  const results = runAllScenarios({ sites, costDriver, captureRates, efficiencyWeight })
  const { error } = await supabase.from('roi_calculation_snapshot').insert(
    results.map(r => ({
      proposal_id: proposalId, scenario: r.scenario,
      per_equipment_savings: r.per_equipment_savings, site_wide_savings: r.site_wide_savings,
      total_annual_saving: r.total_annual_saving, total_investment: r.total_investment,
      roi_pct: r.roi_pct, payback_months: r.payback_months,
    }))
  )
  if (error) throw error
  if (proposal.constrained_edit_open) await supabase.from('roi_proposal').update({ constrained_edit_open: false }).eq('id', proposalId)
  return results
}

export async function getLatestSnapshots(proposalId) {
  const { data } = await supabase.from('roi_calculation_snapshot').select('*').eq('proposal_id', proposalId).order('computed_at', { ascending: false })
  const latestByScenario = {}
  for (const row of data || []) if (!latestByScenario[row.scenario]) latestByScenario[row.scenario] = row
  return latestByScenario
}

/**
 * Is the active-scenario snapshot out of date relative to the current inputs?
 * True if no snapshot exists yet, or any of sites/cost-driver/capture-rates/
 * efficiency-weight was edited after the snapshot was computed. Used to block
 * submitting a proposal for approval on stale numbers.
 */
export async function isSnapshotStale(proposalId) {
  const { proposal } = await getProposalFull(proposalId)
  const snapshots = await getLatestSnapshots(proposalId)
  const snapshot = snapshots[proposal.active_scenario]
  if (!snapshot) return true

  const [{ data: sites }, { data: costDriver }, { data: rates }, { data: weight }] = await Promise.all([
    supabase.from('roi_site').select('updated_at').eq('proposal_id', proposalId),
    supabase.from('roi_cost_driver').select('updated_at').eq('proposal_id', proposalId).single(),
    supabase.from('roi_capture_rate').select('updated_at').eq('proposal_id', proposalId),
    supabase.from('roi_efficiency_weight').select('updated_at').eq('proposal_id', proposalId).single(),
  ])
  const timestamps = [
    ...(sites || []).map(r => r.updated_at), costDriver?.updated_at,
    ...(rates || []).map(r => r.updated_at), weight?.updated_at,
  ].filter(Boolean).map(t => new Date(t).getTime())
  const latestInputChange = timestamps.length ? Math.max(...timestamps) : 0
  return latestInputChange > new Date(snapshot.computed_at).getTime()
}

// ── Approval ───────────────────────────────────────────────────────────

/** Notify every user with `role` (org-scoped by RLS) that a proposal needs their review. */
async function notifyStepApprovers(role, opts) {
  const { data } = await supabase.from('profiles').select('id').eq('role', role)
  await sendNotifToMany((data || []).map(p => p.id).filter(id => id !== opts.senderId), opts)
}

export async function submitForApproval(proposalId, profileId) {
  if (await isSnapshotStale(proposalId)) {
    throw new Error('Inputs have changed since the last calculation — recalculate the active scenario before submitting for approval.')
  }
  const chain = await getChain()
  const status = chain[0].status
  const { data: proposal, error } = await supabase.from('roi_proposal')
    .update({ status: 'pending_approval', approval_status: status }).eq('id', proposalId).select('name').single()
  if (error) throw error
  await notifyStepApprovers(chain[0].key, {
    type: 'roi_proposal_submitted', title: '📈 ROI proposal awaiting your review',
    body: `"${proposal.name}" was submitted for approval.`, link: `/roi-planning`, senderId: profileId,
  })
}

/**
 * action: 'approve' | 'approve_with_conditions' | 'revise' | 'reject'
 * (extends v1's plain approve/reject with the two decision outcomes the v2
 * Approval Summary spec adds). 'approve_with_conditions' only makes sense
 * at the terminal step — it behaves exactly like 'approve' there (chain
 * complete, status='approved', snapshots frozen) but also records the
 * conditions text and opens the constrained-edit window calculate() checks
 * for. 'revise' behaves exactly like 'reject' (reset to draft) but is
 * logged as a softer decision_outcome, distinct in the audit trail from an
 * outright rejection.
 */
export async function actOnApproval(proposalId, action, approverRole, profileId, note) {
  const { data: proposal } = await supabase.from('roi_proposal').select('approval_status,created_by,name').eq('id', proposalId).single()

  if (action === 'revise') {
    const { error } = await supabase.from('roi_proposal').update({ status: 'draft', approval_status: null, rejection_reason: note || null, decision_outcome: 'revise' }).eq('id', proposalId)
    if (error) throw error
    if (proposal.created_by) await sendNotif(proposal.created_by, {
      type: 'roi_proposal_revise_requested', title: `✏️ Revisions requested on ROI proposal`,
      body: note ? `"${proposal.name}": ${note}` : `"${proposal.name}" needs revisions before it can be re-submitted.`,
      link: `/roi-planning`, senderId: profileId,
    })
    return
  }

  const engineAction = action === 'approve_with_conditions' ? 'approve' : action
  const update = await buildApprovalUpdate(engineAction, proposal.approval_status, profileId, note)
  if (action === 'approve_with_conditions' && update.status === 'approved') {
    update.decision_outcome = 'approve_with_conditions'
    update.conditions_text = note || null
    update.constrained_edit_open = true
  } else if (update.status === 'approved') {
    update.decision_outcome = 'approve'
  } else if (action === 'reject') {
    update.decision_outcome = 'reject'
  }
  const { error } = await supabase.from('roi_proposal').update(update).eq('id', proposalId)
  if (error) throw error

  if (action === 'reject') {
    if (proposal.created_by) await sendNotif(proposal.created_by, {
      type: 'roi_proposal_rejected', title: `❌ ROI proposal rejected`,
      body: note ? `"${proposal.name}": ${note}` : `"${proposal.name}" was sent back to draft.`,
      link: `/roi-planning`, senderId: profileId,
    })
    return
  }

  if (update.status === 'approved') {
    if (proposal.created_by) await sendNotif(proposal.created_by, {
      type: 'roi_proposal_approved', title: action === 'approve_with_conditions' ? `✅ ROI proposal approved with conditions` : `✅ ROI proposal approved`,
      body: action === 'approve_with_conditions'
        ? `"${proposal.name}" was approved with conditions: ${note || '(see conditions)'}`
        : `"${proposal.name}" is fully approved. Its snapshots are now frozen.`,
      link: `/roi-planning`, senderId: profileId,
    })
  } else {
    const chain = await getChain()
    const nextStep = chain.find(s => s.status === update.approval_status)
    if (nextStep) await notifyStepApprovers(nextStep.key, {
      type: 'roi_proposal_submitted', title: '📈 ROI proposal awaiting your review',
      body: `"${proposal.name}" needs ${nextStep.label} review.`, link: `/roi-planning`, senderId: profileId,
    })
  }
}

// ── Burn tracking (Section 4) ─────────────────────────────────────────────

/** Planned Burn Curve — linear distribution of total_investment across duration_months, computed on read (not stored). */
export function plannedBurnCurve(totalInvestment, durationMonths) {
  if (!durationMonths || durationMonths <= 0) return []
  const perMonth = Math.round((totalInvestment / durationMonths) * 100) / 100
  return Array.from({ length: durationMonths }, (_, i) => ({
    month: i + 1, planned_cumulative: Math.round(perMonth * (i + 1) * 100) / 100,
  }))
}

/**
 * Pulls new actual-cost rows for this proposal's project into roi_burn_entry —
 * read-only mirror of Budget & Finance's existing per-line-item actuals
 * (project_hardware_costs for the IoT logger spend, project_software_costs
 * for the one-time dev cost), never written back. Idempotent via the
 * (source_table, source_row_id) unique index — safe to call repeatedly.
 */
export async function syncBurnFromBudget(proposalId, projectId, budgetLineId) {
  const [{ data: hw }, { data: sw }] = await Promise.all([
    supabase.from('project_hardware_costs').select('id,cost_company,date').eq('project_id', projectId),
    supabase.from('project_software_costs').select('id,cost_company,date').eq('project_id', projectId),
  ])

  const rows = [
    ...(hw || []).map(r => ({ source_table: 'project_hardware_costs', source_row_id: r.id, amount: r.cost_company, recorded_at: r.date })),
    ...(sw || []).map(r => ({ source_table: 'project_software_costs', source_row_id: r.id, amount: r.cost_company, recorded_at: r.date })),
  ].filter(r => r.amount != null)

  if (!rows.length) return
  await supabase.from('roi_burn_entry').upsert(
    rows.map(r => ({ proposal_id: proposalId, budget_line_id: budgetLineId, amount: r.amount, recorded_at: r.recorded_at || new Date().toISOString().slice(0, 10), source_table: r.source_table, source_row_id: r.source_row_id })),
    { onConflict: 'source_table,source_row_id', ignoreDuplicates: true }
  )
}

export async function getBurn(proposalId) {
  const { proposal } = await getProposalFull(proposalId)
  const snapshots = await getLatestSnapshots(proposalId)
  const activeSnapshot = snapshots[proposal.active_scenario]
  const { data: entries } = await supabase.from('roi_burn_entry').select('*').eq('proposal_id', proposalId).order('recorded_at')

  const totalInvestment = Number(activeSnapshot?.total_investment || 0)
  const elapsedMonths = proposal.approved_at
    ? Math.max(0, (Date.now() - new Date(proposal.approved_at).getTime()) / (1000 * 60 * 60 * 24 * 30.4375))
    : 0
  const actualBurnToDate = Math.round((entries || []).reduce((s, e) => s + Number(e.amount || 0), 0) * 100) / 100
  const burnRate = elapsedMonths > 0 ? actualBurnToDate / elapsedMonths : null
  const remainingBurn = Math.round((totalInvestment - actualBurnToDate) * 100) / 100
  const projectedFinalSpend = burnRate != null ? Math.round(burnRate * proposal.duration_months * 100) / 100 : null
  const spendVariance = projectedFinalSpend != null ? Math.round((totalInvestment - projectedFinalSpend) * 100) / 100 : null

  return {
    proposal, entries: entries || [],
    plannedCurve: plannedBurnCurve(totalInvestment, proposal.duration_months),
    elapsedMonths: Math.round(elapsedMonths * 100) / 100,
    actualBurnToDate, burnRate: burnRate != null ? Math.round(burnRate * 100) / 100 : null,
    remainingBurn, projectedFinalSpend, spendVariance,
  }
}

// ── Forecast Engine (Section 5) ────────────────────────────────────────────

/** requestedDurationMonths/scenario both optional. Persists one immutable roi_forecast_run per scenario forecast. */
export async function forecast(proposalId, { requestedDurationMonths, scenario, profileId } = {}) {
  const { proposal } = await getProposalFull(proposalId)
  const snapshots = await getLatestSnapshots(proposalId)
  const { data: entries } = await supabase.from('roi_burn_entry').select('amount').eq('proposal_id', proposalId)

  const scenariosToRun = scenario ? [scenario] : Object.keys(snapshots)
  const runs = []
  for (const sc of scenariosToRun) {
    const snapshot = snapshots[sc]
    if (!snapshot) continue
    const result = runForecast({ proposal, snapshot, burnEntries: entries || [], requestedDurationMonths })
    const { data: row, error } = await supabase.from('roi_forecast_run').insert({
      proposal_id: proposalId, requested_duration_months: requestedDurationMonths ?? null,
      scenario: sc, results: result, triggered_by: profileId,
    }).select().single()
    if (error) throw error
    runs.push(row)
  }
  return runs
}

export async function getForecastHistory(proposalId) {
  const { data } = await supabase.from('roi_forecast_run').select('*').eq('proposal_id', proposalId).order('run_at', { ascending: false })
  return data || []
}

// ── Listing ─────────────────────────────────────────────────────────────

export async function listProposalsForProject(projectId) {
  const { data } = await supabase.from('roi_proposal').select('*').eq('project_id', projectId).order('created_at', { ascending: false })
  return data || []
}

/**
 * Org-wide rollup across every ROI proposal (RLS already scopes this to
 * the caller's organization) — for a portfolio view a CFO/CEO would use,
 * same pattern as the Sales Dashboard's aggregate rollups.
 */
export async function getPortfolioSummary() {
  const [{ data: proposals }, { data: snapshots }, { data: burns }, { data: projects }] = await Promise.all([
    supabase.from('roi_proposal').select('id,name,project_id,status,active_scenario,duration_months,approved_at,created_at'),
    supabase.from('roi_calculation_snapshot').select('proposal_id,scenario,total_annual_saving,total_investment,roi_pct,computed_at').order('computed_at', { ascending: false }),
    supabase.from('roi_burn_entry').select('proposal_id,amount'),
    supabase.from('projects').select('id,name'),
  ])

  const latestByKey = {}
  for (const s of snapshots || []) { const k = `${s.proposal_id}:${s.scenario}`; if (!latestByKey[k]) latestByKey[k] = s }
  const burnByProposal = {}
  for (const b of burns || []) burnByProposal[b.proposal_id] = (burnByProposal[b.proposal_id] || 0) + Number(b.amount || 0)
  const projectNameById = Object.fromEntries((projects || []).map(p => [p.id, p.name]))

  const rows = (proposals || []).map(p => {
    const snap = latestByKey[`${p.id}:${p.active_scenario}`]
    return {
      ...p,
      project_name: projectNameById[p.project_id] || '—',
      total_annual_saving: Number(snap?.total_annual_saving || 0),
      total_investment: Number(snap?.total_investment || 0),
      roi_pct: snap?.roi_pct ?? null,
      actual_burn_to_date: Math.round((burnByProposal[p.id] || 0) * 100) / 100,
    }
  })

  const approved = rows.filter(r => r.status === 'approved')
  return {
    rows: rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    totals: {
      count: rows.length,
      approvedCount: approved.length,
      pendingCount: rows.filter(r => r.status === 'pending_approval').length,
      totalInvestment: Math.round(approved.reduce((s, r) => s + r.total_investment, 0) * 100) / 100,
      totalAnnualSaving: Math.round(approved.reduce((s, r) => s + r.total_annual_saving, 0) * 100) / 100,
      totalBurnToDate: Math.round(approved.reduce((s, r) => s + r.actual_burn_to_date, 0) * 100) / 100,
    },
  }
}

export { CAPTURE_CATEGORIES }
