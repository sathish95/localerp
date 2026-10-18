/**
 * ROI PLANNING — Calculation Engine.
 *
 * Pure, deterministic, no side effects (no supabase import here on purpose —
 * every input arrives as a plain object/array so this file stays independently
 * unit-testable, per the module's own acceptance-test requirement).
 *
 * NOTE ON THE ACCEPTANCE TEST: the brief that specified this module names a
 * reference workbook (Sites -> Cost Drivers -> Capture Rates -> Calculations
 * -> Summary tabs) as the ground truth to validate against. That file was not
 * available when this was built — the org confirmed to proceed strictly from
 * the written spec below. Two things the spec left ambiguous were confirmed
 * directly with the org rather than guessed:
 *   - equipment_efficiency_loss_rate_pct's split across its four sub-items
 *     (utilization/rental/operator_behavior/unauthorized_usage) is a
 *     per-proposal configurable weight (roi_efficiency_weight), seeded equal
 *     (25/25/25/25) — not a hardcoded ratio.
 *   - roi_pct = total_annual_saving / total_investment (can exceed 100%),
 *     not "(saving - investment) / investment".
 * If the reference workbook becomes available later, re-run scenarios
 * through runAllScenarios() with its inputs and diff against its Calculations
 * tab before trusting this file for anything beyond what's already shipped.
 */

const SCENARIOS = ['conservative', 'expected', 'aggressive']

function pct(rate) { return Number(rate || 0) / 100 }
function num(v) { return Number(v || 0) }
function round2(n) { return Math.round(n * 100) / 100 }

function captureRateFor(captureRates, category, scenario) {
  const row = captureRates.find(r => r.category === category)
  if (!row) return 0
  return pct(row[`${scenario}_pct`])
}

/**
 * Per-equipment savings for one scenario.
 * costDriver: the roi_cost_driver row (flat fields, see schema).
 * captureRates: array of roi_capture_rate rows (all 11 categories).
 * totalEquipmentCount: sum of roi_site.equipment_count across all sites.
 */
function calcPerEquipment(costDriver, captureRates, scenario, totalEquipmentCount) {
  const cr = (cat) => captureRateFor(captureRates, cat, scenario)

  const service_saving = num(costDriver.service_overrun_per_equipment_year) * cr('service_overrun')
  const fuel_theft_saving = num(costDriver.fuel_theft_litres_per_day) * num(costDriver.operating_days_per_year) * num(costDriver.diesel_price_per_litre) * cr('fuel_theft')
  const missed_servicing_saving = num(costDriver.missed_servicing_cost_per_equipment_year) * cr('missed_servicing')
  const parts_failure_saving = num(costDriver.parts_failure_cost_per_incident) * num(costDriver.parts_failure_frequency_per_year) * cr('parts_failure')

  const per_equipment_total = service_saving + fuel_theft_saving + missed_servicing_saving + parts_failure_saving
  const fleet_total = per_equipment_total * num(totalEquipmentCount)

  return {
    service_saving: round2(service_saving),
    fuel_theft_saving: round2(fuel_theft_saving),
    missed_servicing_saving: round2(missed_servicing_saving),
    parts_failure_saving: round2(parts_failure_saving),
    per_equipment_total: round2(per_equipment_total),
    fleet_total: round2(fleet_total),
  }
}

/**
 * Site-wide savings for one scenario — summed directly across all roi_site rows.
 * efficiencyWeight: roi_efficiency_weight row ({utilization_pct, rental_pct, operator_behavior_pct, unauthorized_usage_pct}).
 */
function calcSiteWide(sites, costDriver, captureRates, efficiencyWeight, scenario) {
  const cr = (cat) => captureRateFor(captureRates, cat, scenario)
  const efficiencyLossRate = pct(costDriver.equipment_efficiency_loss_rate_pct)
  const wUtil = pct(efficiencyWeight.utilization_pct)
  const wRental = pct(efficiencyWeight.rental_pct)
  const wOperator = pct(efficiencyWeight.operator_behavior_pct)
  const wUnauth = pct(efficiencyWeight.unauthorized_usage_pct)

  let labour_saving = 0, logistics_mismatch_saving = 0, project_loss_avoided = 0
  let equipment_utilization_saving = 0, rental_optimization_saving = 0, operator_behavior_saving = 0, unauthorized_usage_saving = 0

  for (const site of sites) {
    labour_saving += num(site.manual_labour_cost_monthly) * 12 * cr('labour')
    logistics_mismatch_saving += (num(site.logistics_mismatch_qty_per_quarter) * 4 * num(site.logistics_cost_per_mismatch)) * cr('logistics')
    project_loss_avoided += num(site.project_contract_value) * pct(costDriver.project_loss_rate_pct) * cr('project_loss')

    const efficiencyBase = num(site.equipment_replacement_value) * efficiencyLossRate
    equipment_utilization_saving += efficiencyBase * wUtil * cr('utilization')
    rental_optimization_saving += efficiencyBase * wRental * cr('rental')
    operator_behavior_saving += efficiencyBase * wOperator * cr('operator_behavior')
    unauthorized_usage_saving += efficiencyBase * wUnauth * cr('unauthorized_usage')
  }

  const site_level_total = labour_saving + logistics_mismatch_saving + project_loss_avoided
    + equipment_utilization_saving + rental_optimization_saving + operator_behavior_saving + unauthorized_usage_saving

  return {
    labour_saving: round2(labour_saving),
    logistics_mismatch_saving: round2(logistics_mismatch_saving),
    project_loss_avoided: round2(project_loss_avoided),
    equipment_utilization_saving: round2(equipment_utilization_saving),
    rental_optimization_saving: round2(rental_optimization_saving),
    operator_behavior_saving: round2(operator_behavior_saving),
    unauthorized_usage_saving: round2(unauthorized_usage_saving),
    site_level_total: round2(site_level_total),
  }
}

/**
 * Run the full engine for one scenario. Returns the shape persisted into
 * roi_calculation_snapshot.
 */
export function calcScenario({ sites, costDriver, captureRates, efficiencyWeight, scenario }) {
  if (!SCENARIOS.includes(scenario)) throw new Error(`Unknown scenario "${scenario}"`)
  const totalEquipmentCount = sites.reduce((s, site) => s + num(site.equipment_count), 0)

  const per_equipment_savings = calcPerEquipment(costDriver, captureRates, scenario, totalEquipmentCount)
  const site_wide_savings = calcSiteWide(sites, costDriver, captureRates, efficiencyWeight, scenario)

  const total_investment = round2(num(costDriver.iot_logger_unit_cost) * totalEquipmentCount + num(costDriver.software_dev_cost_onetime))
  const total_annual_saving = round2(per_equipment_savings.fleet_total + site_wide_savings.site_level_total)

  const roi_pct = total_investment > 0 ? round2((total_annual_saving / total_investment) * 100) : null
  const payback_months = total_annual_saving > 0 ? round2((total_investment / total_annual_saving) * 12) : null

  return {
    scenario,
    per_equipment_savings,
    site_wide_savings,
    total_annual_saving,
    total_investment,
    roi_pct,
    payback_months,
  }
}

/** Run all three scenarios (Conservative/Expected/Aggressive) — always all three, regardless of active_scenario. */
export function runAllScenarios(inputs) {
  return SCENARIOS.map(scenario => calcScenario({ ...inputs, scenario }))
}

export { SCENARIOS }
