/**
 * ROI ENTERPRISE ECONOMICS — data-access/orchestration layer (STEP213).
 * Same relationship to roiResultEngine.js/roiSensitivity.js/npvIrr.js as
 * roiProposals.js has to roiCalcEngine.js/roiForecast.js: every DB read/
 * write lives here, the pure engines stay side-effect-free.
 *
 * benefit_driver runs ALONGSIDE v1's per-equipment/site-wide breakdown
 * (org decision — nothing about v1's calculate()/roi_calculation_snapshot
 * is touched). syncBenefitDriversFromSnapshot() is the explicit bridge:
 * call it after roi.calculate() to mirror v1's latest snapshot into this
 * table's uniform shape for Executive Overview/Sensitivity/Customer View
 * to aggregate over.
 */
import { supabase } from './supabase'
import { fv, fvAmount, FV_SOURCE } from './financialValue'
import { calcTotalPo, calcGrossProfit, calcRoiResult, calcCostVariance, deriveRiskRating } from './roiResultEngine'
import { runSensitivity } from './roiSensitivity'
import { calcNpvIrr, flatCashFlowSeries } from './npvIrr'
import { getProposalFull, getLatestSnapshots } from './roiProposals'

const SCENARIOS = ['conservative', 'expected', 'aggressive']

// ── Settings ──────────────────────────────────────────────────────────
export async function getRoiSettings() {
  const { data } = await supabase.from('roi_settings').select('*').maybeSingle()
  return data || { default_discount_rate_pct: 12, cost_variance_at_risk_pct: 10, cost_variance_over_budget_pct: 20, risk_low_spread_pct: 15, risk_high_spread_pct: 40 }
}
export async function updateRoiSettings(fields) {
  const { data: existing } = await supabase.from('roi_settings').select('id').maybeSingle()
  if (existing) return supabase.from('roi_settings').update(fields).eq('id', existing.id)
  return supabase.from('roi_settings').insert(fields)
}

// ── Aggregate loader ──────────────────────────────────────────────────
export async function getEconomicsFull(proposalId) {
  const [{ data: customerBaseline }, { data: benefitDrivers }, { data: investmentLines }, { data: deliveryCostLines },
    { data: poRecord }, { data: manualAdjustments }] = await Promise.all([
    supabase.from('roi_customer_baseline').select('*').eq('proposal_id', proposalId).maybeSingle(),
    supabase.from('roi_benefit_driver').select('*').eq('proposal_id', proposalId),
    supabase.from('roi_investment_line').select('*').eq('proposal_id', proposalId),
    supabase.from('roi_delivery_cost_line').select('*').eq('proposal_id', proposalId),
    supabase.from('roi_po_record').select('*').eq('proposal_id', proposalId).maybeSingle(),
    supabase.from('roi_manual_adjustment').select('*').eq('proposal_id', proposalId).order('created_at', { ascending: false }),
  ])
  let changeOrders = []
  if (poRecord) {
    const { data } = await supabase.from('roi_po_change_order').select('*').eq('po_record_id', poRecord.id).order('date')
    changeOrders = data || []
  }
  return {
    customerBaseline, benefitDrivers: benefitDrivers || [], investmentLines: investmentLines || [],
    deliveryCostLines: deliveryCostLines || [], poRecord, changeOrders, manualAdjustments: manualAdjustments || [],
  }
}

// ── Manual adjustment ledger — every hand override anywhere writes here ──
export async function logManualAdjustment(proposalId, { category, type, amount, currency = 'INR', reason, ownerId, date, comment }) {
  if (!reason) throw new Error('A reason is required for every manual adjustment.')
  const { error } = await supabase.from('roi_manual_adjustment').insert({
    proposal_id: proposalId, category, type, amount: fv(amount, { currency, source: FV_SOURCE.MANUAL }),
    reason, owner: ownerId, date: date || new Date().toISOString().slice(0, 10), comment,
  })
  if (error) throw error
}

// ── Customer Baseline ──────────────────────────────────────────────────
const BASELINE_FIELDS = ['labor_cost', 'energy_cost', 'maintenance_cost', 'operating_cost', 'current_revenue', 'waste_cost', 'productivity_metric', 'technology_spend']
export async function updateCustomerBaseline(proposalId, values, currency = 'INR') {
  const payload = Object.fromEntries(BASELINE_FIELDS.map(k => [k, values[k] != null ? fv(values[k], { currency, source: FV_SOURCE.MANUAL }) : null]))
  const { data: existing } = await supabase.from('roi_customer_baseline').select('id').eq('proposal_id', proposalId).maybeSingle()
  if (existing) return supabase.from('roi_customer_baseline').update(payload).eq('id', existing.id)
  return supabase.from('roi_customer_baseline').insert({ proposal_id: proposalId, ...payload })
}

// ── Benefit Drivers ─────────────────────────────────────────────────────
/** Mirrors v1's latest roi_calculation_snapshot breakdown into roi_benefit_driver, source='calculated'. Call after roi.calculate(). Replaces only the auto-populated (source_line_key not null) rows — hand-added lines are untouched. */
export async function syncBenefitDriversFromSnapshot(proposalId) {
  const snapshots = await getLatestSnapshots(proposalId)
  const { proposal } = await getProposalFull(proposalId)
  const rows = []
  for (const scenario of SCENARIOS) {
    const s = snapshots[scenario]
    if (!s) continue
    const perEq = s.per_equipment_savings, site = s.site_wide_savings
    const LINE_LABELS = {
      service_saving: ['cost_saving', 'Service Overrun Reduction'], fuel_theft_saving: ['cost_saving', 'Fuel Theft Reduction'],
      missed_servicing_saving: ['cost_saving', 'Missed Servicing Reduction'], parts_failure_saving: ['cost_saving', 'Parts Failure Reduction'],
      labour_saving: ['cost_saving', 'Labour Efficiency'], logistics_mismatch_saving: ['cost_saving', 'Logistics Mismatch Reduction'],
      project_loss_avoided: ['revenue_uplift', 'Project Loss Avoided'], equipment_utilization_saving: ['productivity', 'Equipment Utilization'],
      rental_optimization_saving: ['cost_saving', 'Rental Optimization'], operator_behavior_saving: ['productivity', 'Operator Behavior'],
      unauthorized_usage_saving: ['cost_saving', 'Unauthorized Usage Reduction'],
    }
    for (const [key, [category, name]] of Object.entries(LINE_LABELS)) {
      const value = perEq[key] ?? site[key]
      if (value == null) continue
      rows.push({
        proposal_id: proposalId, scenario, category, name,
        potential_value: fv(value, { currency: proposal.currency, source: FV_SOURCE.CALCULATED, sourceRef: `roi_calculation_snapshot.${key}` }),
        capture_rate_pct: 100, // v1's engine already applies the capture rate internally — this mirrors the POST-capture realized figure
        realized_value: fv(value, { currency: proposal.currency, source: FV_SOURCE.CALCULATED, sourceRef: `roi_calculation_snapshot.${key}` }),
        source_line_key: key,
      })
    }
  }
  await supabase.from('roi_benefit_driver').delete().eq('proposal_id', proposalId).not('source_line_key', 'is', null)
  if (rows.length) await supabase.from('roi_benefit_driver').insert(rows)
}

export async function addBenefitDriver(proposalId, { scenario, category, name, potentialValue, capturePct, currency = 'INR' }) {
  const realized = Number(potentialValue) * (Number(capturePct) / 100)
  const { error } = await supabase.from('roi_benefit_driver').insert({
    proposal_id: proposalId, scenario, category, name,
    potential_value: fv(potentialValue, { currency, source: FV_SOURCE.MANUAL }),
    capture_rate_pct: capturePct,
    realized_value: fv(realized, { currency, source: FV_SOURCE.CALCULATED, sourceRef: 'manual_benefit_driver' }),
  })
  if (error) throw error
}
export async function deleteBenefitDriver(id) { await supabase.from('roi_benefit_driver').delete().eq('id', id).is('source_line_key', null) }

// ── Investment Lines — split Client-Side (party='client', customer pays,
// manual only) vs Service-Provided (party='provider', the provider's own
// contribution — can be manual or mapped in from the project's actual
// cost records). qty x unit_cost auto-computes amount, same "auto-
// calculated, editable" pattern as v1's IoT-unit-cost x equipment-count
// Investment tab — leave unit_cost blank to just enter a flat amount. ──
export async function updateInvestmentLines(proposalId, lines, currency = 'INR') {
  await supabase.from('roi_investment_line').delete().eq('proposal_id', proposalId)
  if (lines.length) await supabase.from('roi_investment_line').insert(lines.map(l => {
    const qty = Number(l.qty) || 1
    const computedAmount = l.unitCost != null && l.unitCost !== '' ? qty * Number(l.unitCost) : Number(l.amount) || 0
    return {
      proposal_id: proposalId, timing: l.timing, category: l.category, name: l.name,
      party: l.party || 'client', qty, unit_cost: l.unitCost != null && l.unitCost !== '' ? Number(l.unitCost) : null,
      amount: fv(computedAmount, { currency, source: l.source || FV_SOURCE.MANUAL }),
    }
  }))
}

/**
 * Maps Service-Provided Investment lines in from the project's actual cost
 * records — the same source tables Delivery Cost's sync reads (this is a
 * different lens on the same underlying project spend: Delivery Cost is
 * "what it costs us to execute," Service-Provided Investment is "what we're
 * contributing as part of this deal's investment stack" — related, tracked
 * separately, not double-counted into any single formula automatically).
 * Client-Side Investment has no such source — this app has no record of
 * what a customer paid outside their own books, so it stays manual-only.
 */
export async function syncProviderInvestmentFromProject(proposalId, projectId, currency = 'INR') {
  const [{ data: hw }, { data: sw }, { data: sup }] = await Promise.all([
    supabase.from('project_hardware_costs').select('category,cost_company').eq('project_id', projectId),
    supabase.from('project_software_costs').select('category,cost_company').eq('project_id', projectId),
    supabase.from('project_support_costs').select('category,cost_company').eq('project_id', projectId),
  ])
  const CATEGORY_MAP = { component: 'hardware', iot_device: 'hardware', logistics: 'other', assembly: 'hardware',
    server: 'infrastructure', third_party: 'other', saas: 'subscription', license: 'other',
    device_logger: 'hardware', support_expense: 'support', maintenance: 'support' }
  const INVESTMENT_CATEGORIES = ['hardware', 'software', 'implementation', 'integration', 'training', 'deployment', 'support', 'subscription', 'other']
  const totals = {}
  for (const r of [...(hw || []), ...(sw || []), ...(sup || [])]) {
    const cat = INVESTMENT_CATEGORIES.includes(CATEGORY_MAP[r.category]) ? CATEGORY_MAP[r.category] : 'other'
    totals[cat] = (totals[cat] || 0) + Number(r.cost_company || 0)
  }
  const { data: existingLines } = await supabase.from('roi_investment_line').select('id,category').eq('proposal_id', proposalId).eq('party', 'provider').eq('timing', 'one_time')
  const existingByCat = Object.fromEntries((existingLines || []).map(l => [l.category, l.id]))
  for (const [category, amount] of Object.entries(totals)) {
    const amt = fv(amount, { currency, source: FV_SOURCE.EXISTING, sourceRef: 'project_hardware_costs/project_software_costs/project_support_costs' })
    if (existingByCat[category]) await supabase.from('roi_investment_line').update({ amount: amt, qty: 1, unit_cost: null }).eq('id', existingByCat[category])
    else await supabase.from('roi_investment_line').insert({ proposal_id: proposalId, timing: 'one_time', party: 'provider', category, name: `${category} (mapped from project)`, qty: 1, amount: amt })
  }
}

// ── Capture Rates: custom categories (v1's 11 built-ins stay untouched
// and keep driving the Scenario Calculation Engine — a custom row here has
// no formula slot to plug into; it's for reference/manual tracking only,
// the UI says so explicitly). ──
export async function addCustomCaptureRateCategory(proposalId, { category, conservativePct = 0, expectedPct = 0, aggressivePct = 0 }) {
  const { error } = await supabase.from('roi_capture_rate').insert({
    proposal_id: proposalId, category, is_custom: true,
    conservative_pct: conservativePct, expected_pct: expectedPct, aggressive_pct: aggressivePct,
  })
  if (error) throw error
}
export async function deleteCaptureRateCategory(id) { await supabase.from('roi_capture_rate').delete().eq('id', id).eq('is_custom', true) }

// ── Delivery Cost (internal-side — never surfaced to Customer View) ────
const DELIVERY_SOURCE_TABLES = ['project_hardware_costs', 'project_software_costs', 'project_support_costs']
/** Pulls existing project actual-cost rows in as existing_amount (refresh-only, never hand-edited). */
export async function syncDeliveryCostFromProject(proposalId, projectId, currency = 'INR') {
  const [{ data: hw }, { data: sw }, { data: sup }] = await Promise.all([
    supabase.from('project_hardware_costs').select('category,cost_company').eq('project_id', projectId),
    supabase.from('project_software_costs').select('category,cost_company').eq('project_id', projectId),
    supabase.from('project_support_costs').select('category,cost_company').eq('project_id', projectId),
  ])
  const CATEGORY_MAP = { component: 'hardware', iot_device: 'hardware', logistics: 'travel', assembly: 'hardware',
    server: 'infrastructure', third_party: 'licenses', saas: 'cloud', license: 'licenses',
    device_logger: 'hardware', support_expense: 'support', maintenance: 'support' }
  const totals = {}
  for (const r of [...(hw || []), ...(sw || []), ...(sup || [])]) {
    const cat = CATEGORY_MAP[r.category] || 'miscellaneous'
    totals[cat] = (totals[cat] || 0) + Number(r.cost_company || 0)
  }
  const { data: existingLines } = await supabase.from('roi_delivery_cost_line').select('id,category').eq('proposal_id', proposalId)
  const existingByCat = Object.fromEntries((existingLines || []).map(l => [l.category, l.id]))
  for (const [category, amount] of Object.entries(totals)) {
    const existingAmount = fv(amount, { currency, source: FV_SOURCE.EXISTING, sourceRef: 'project_hardware_costs/project_software_costs/project_support_costs' })
    if (existingByCat[category]) await supabase.from('roi_delivery_cost_line').update({ existing_amount: existingAmount }).eq('id', existingByCat[category])
    else await supabase.from('roi_delivery_cost_line').insert({ proposal_id: proposalId, category, name: `${category} (synced)`, existing_amount: existingAmount })
  }
}
export async function addManualDeliveryCostLine(proposalId, { category, name, amount, currency = 'INR', reason, ownerId }) {
  const { error } = await supabase.from('roi_delivery_cost_line').insert({
    proposal_id: proposalId, category, name, manual_amount: fv(amount, { currency, source: FV_SOURCE.MANUAL }),
  })
  if (error) throw error
  await logManualAdjustment(proposalId, { category: `delivery_cost:${category}`, type: 'cost', amount, currency, reason, ownerId })
}

// ── PO Record ────────────────────────────────────────────────────────
export async function updatePoRecord(proposalId, { originalPo, expansionPo, credits, currency = 'INR' }) {
  const payload = {
    original_po: fv(originalPo, { currency, source: FV_SOURCE.MANUAL }),
    expansion_po: expansionPo != null ? fv(expansionPo, { currency, source: FV_SOURCE.MANUAL }) : null,
    credits: credits != null ? fv(credits, { currency, source: FV_SOURCE.MANUAL }) : null,
  }
  const { data: existing } = await supabase.from('roi_po_record').select('id').eq('proposal_id', proposalId).maybeSingle()
  if (existing) return supabase.from('roi_po_record').update(payload).eq('id', existing.id)
  return supabase.from('roi_po_record').insert({ proposal_id: proposalId, ...payload })
}
export async function addChangeOrder(proposalId, { description, amount, currency = 'INR', date, reason, ownerId }) {
  const { data: po } = await supabase.from('roi_po_record').select('id').eq('proposal_id', proposalId).maybeSingle()
  if (!po) throw new Error('Set up the base PO record before adding a change order.')
  const { error } = await supabase.from('roi_po_change_order').insert({
    po_record_id: po.id, description, amount: fv(amount, { currency, source: FV_SOURCE.MANUAL }),
    date: date || new Date().toISOString().slice(0, 10), created_by: ownerId,
  })
  if (error) throw error
  await logManualAdjustment(proposalId, { category: 'po_record:change_order', type: 'revenue', amount, currency, reason, ownerId, date })
}

// ── Gross Profit ────────────────────────────────────────────────────────
export async function computeGrossProfit(proposalId) {
  const { poRecord, changeOrders, deliveryCostLines } = await getEconomicsFull(proposalId)
  if (!poRecord) throw new Error('Set up the PO record before computing gross profit.')
  const totalPo = calcTotalPo({ originalPo: poRecord.original_po, changeOrders, expansionPo: poRecord.expansion_po, credits: poRecord.credits })
  const result = calcGrossProfit({ totalPo, deliveryCostLines })
  const { error } = await supabase.from('roi_gross_profit_snapshot').insert({
    proposal_id: proposalId, total_po: result.total_po, actual_delivery_cost: result.actual_delivery_cost,
    gross_profit: result.gross_profit, gross_margin_pct: result.gross_margin_pct, breakdown: result.breakdown,
  })
  if (error) throw error
  return result
}
export async function getLatestGrossProfit(proposalId) {
  const { data } = await supabase.from('roi_gross_profit_snapshot').select('*').eq('proposal_id', proposalId).order('computed_at', { ascending: false }).limit(1).maybeSingle()
  return data
}

// ── ROI Result (Customer + Internal split) ─────────────────────────────
export async function computeRoiResult(proposalId, horizon = 'annual') {
  const { proposal } = await getProposalFull(proposalId)
  const { investmentLines, benefitDrivers } = await getEconomicsFull(proposalId)
  const grossProfit = await getLatestGrossProfit(proposalId)
  if (!grossProfit) throw new Error('Compute Gross Profit before running the ROI Result.')

  const rows = []
  for (const scenario of SCENARIOS) {
    const result = calcRoiResult({
      investmentLines, benefitDrivers, scenario, horizon,
      grossProfit: grossProfit.gross_profit, actualDeliveryCost: grossProfit.actual_delivery_cost,
      totalPo: grossProfit.total_po, durationMonths: proposal.duration_months,
    })
    rows.push({ proposal_id: proposalId, ...result })
  }
  const { error } = await supabase.from('roi_result_snapshot').insert(rows)
  if (error) throw error
  return rows
}
export async function getLatestRoiResults(proposalId, horizon = 'annual') {
  const { data } = await supabase.from('roi_result_snapshot').select('*').eq('proposal_id', proposalId).eq('horizon', horizon).order('computed_at', { ascending: false })
  const byScenario = {}
  for (const row of data || []) if (!byScenario[row.scenario]) byScenario[row.scenario] = row
  return byScenario
}

// ── Cost Variance (pure view, no storage — reads PO + delivery cost + v1 burn) ──
export async function getCostVariance(proposalId) {
  const [{ deliveryCostLines }, settings, grossProfit] = await Promise.all([
    getEconomicsFull(proposalId), getRoiSettings(), getLatestGrossProfit(proposalId),
  ])
  if (!grossProfit) return []
  return deliveryCostLines.map(l => {
    const budget = fvAmount(l.existing_amount) // "budget" side approximated by the existing/sourced figure
    const actual = fvAmount(l.existing_amount) + fvAmount(l.manual_amount)
    return { category: l.category, ...calcCostVariance({ budget, actual, atRiskPct: settings.cost_variance_at_risk_pct, overBudgetPct: settings.cost_variance_over_budget_pct }) }
  })
}

// ── Sensitivity Analysis ────────────────────────────────────────────────
export async function runSensitivityAnalysis(proposalId, { scenario, variableX, variableY, xValues, yValues, profileId }) {
  const { sites, costDriver, captureRates, efficiencyWeight } = await getProposalFull(proposalId)
  const grid = runSensitivity({ sites, costDriver, captureRates, efficiencyWeight, scenario, variableX, variableY, xValues, yValues })
  const { data, error } = await supabase.from('roi_sensitivity_run').insert({
    proposal_id: proposalId, scenario, variable_x: variableX, variable_y: variableY,
    grid: { x_values: grid.x_values, y_values: grid.y_values, cells: grid.cells }, roi_spread_pct: grid.roi_spread_pct, triggered_by: profileId,
  }).select().single()
  if (error) throw error
  return data
}
export async function getSensitivityHistory(proposalId) {
  const { data } = await supabase.from('roi_sensitivity_run').select('*').eq('proposal_id', proposalId).order('run_at', { ascending: false })
  return data || []
}
export async function getLatestRiskRating(proposalId) {
  const { data } = await supabase.from('roi_sensitivity_run').select('roi_spread_pct').eq('proposal_id', proposalId).order('run_at', { ascending: false }).limit(1).maybeSingle()
  if (!data) return null
  const settings = await getRoiSettings()
  return deriveRiskRating(data.roi_spread_pct, { lowSpreadPct: settings.risk_low_spread_pct, highSpreadPct: settings.risk_high_spread_pct })
}

// ── NPV / IRR ────────────────────────────────────────────────────────────
export async function computeNpvIrr(proposalId, { scenario, horizonYears = 3, discountRatePct }) {
  const { investmentLines, benefitDrivers } = await getEconomicsFull(proposalId)
  // Customer-facing NPV/IRR — only the customer's own (party='client') investment.
  // A provider-funded line was never money the customer put in.
  const clientLines = investmentLines.filter(l => (l.party || 'client') === 'client')
  const oneTime = clientLines.filter(l => l.timing === 'one_time').reduce((s, l) => s + fvAmount(l.amount), 0)
  const recurringAnnual = clientLines.filter(l => l.timing === 'recurring').reduce((s, l) => s + fvAmount(l.amount), 0)
  const annualBenefit = benefitDrivers.filter(b => b.scenario === scenario).reduce((s, b) => s + fvAmount(b.realized_value), 0)

  const settings = await getRoiSettings()
  const rate = discountRatePct ?? settings.default_discount_rate_pct
  const cashFlows = flatCashFlowSeries(annualBenefit - recurringAnnual, horizonYears)
  const result = calcNpvIrr({ initialInvestment: oneTime, annualCashFlows: cashFlows, discountRatePct: rate })

  const { data, error } = await supabase.from('roi_npv_irr_result').insert({
    proposal_id: proposalId, scenario, horizon_years: horizonYears, discount_rate_pct: rate,
    initial_investment: result.initial_investment, annual_cash_flows: result.annual_cash_flows, npv: result.npv, irr_pct: result.irr_pct,
  }).select().single()
  if (error) throw error
  return data
}
export async function getLatestNpvIrr(proposalId) {
  const { data } = await supabase.from('roi_npv_irr_result').select('*').eq('proposal_id', proposalId).order('computed_at', { ascending: false })
  const byScenario = {}
  for (const row of data || []) if (!byScenario[row.scenario]) byScenario[row.scenario] = row
  return byScenario
}

// ── Approval Summary extension ───────────────────────────────────────────
/** Computed at submission time and frozen into roi_proposal.approval_summary — see roiProposals.submitForApproval's caller. */
export async function buildApprovalSummary(proposalId) {
  const grossProfit = await getLatestGrossProfit(proposalId)
  const results = await getLatestRoiResults(proposalId, 'annual')
  const npvIrr = await getLatestNpvIrr(proposalId)
  const riskRating = await getLatestRiskRating(proposalId)
  const { proposal } = await getProposalFull(proposalId)
  const active = results[proposal.active_scenario]
  const activeNpvIrr = npvIrr[proposal.active_scenario]

  return {
    investment_requested: active?.customer_investment ?? null,
    total_po: grossProfit?.total_po ?? null,
    delivery_cost: grossProfit?.actual_delivery_cost ?? null,
    gross_profit: grossProfit?.gross_profit ?? null,
    gross_margin_pct: grossProfit?.gross_margin_pct ?? null,
    customer_roi_pct: active?.customer_roi_pct ?? null,
    customer_payback_months: active?.customer_payback_months ?? null,
    npv: activeNpvIrr?.npv ?? null,
    irr_pct: activeNpvIrr?.irr_pct ?? null,
    risk_rating: riskRating,
    computed_at: new Date().toISOString(),
  }
}

/** Call right after roiProposals.submitForApproval() succeeds — freezes the extended summary onto roi_proposal.approval_summary. */
export async function freezeApprovalSummary(proposalId) {
  const summary = await buildApprovalSummary(proposalId)
  await supabase.from('roi_proposal').update({ approval_summary: summary }).eq('id', proposalId)
  return summary
}

// ── Customer Portal (tokenized public link) ─────────────────────────────
export async function getOrCreatePortalLink(proposalId, profileId) {
  const { data: existing } = await supabase.from('roi_customer_portal_link').select('*').eq('proposal_id', proposalId).maybeSingle()
  if (existing) return existing
  const { data, error } = await supabase.from('roi_customer_portal_link').insert({ proposal_id: proposalId, created_by: profileId }).select().single()
  if (error) throw error
  return data
}
export async function setPortalLinkActive(linkId, isActive) {
  await supabase.from('roi_customer_portal_link').update({ is_active: isActive }).eq('id', linkId)
}
export async function regeneratePortalLink(linkId) {
  const { data, error } = await supabase.rpc('regenerate_roi_portal_token', { p_link_id: linkId })
  if (error) throw error
  return data
}

/** Public read — anon-safe, no auth, used by the external /roi-view/:token route. */
export async function getPublicCustomerView(token) {
  const { data, error } = await supabase.rpc('get_roi_customer_view_public', { p_token: token })
  if (error) throw error
  return data
}
