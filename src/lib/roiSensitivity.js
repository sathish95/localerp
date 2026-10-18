/**
 * SENSITIVITY ANALYSIS — a 2-variable grid, reusing v1's Calculation
 * Engine (roiCalcEngine.calcScenario) per cell, per the brief: "this is a
 * batch of Calculation Engine calls, not a new formula set."
 *
 * Supports the brief's own primary example pairing — capture_rate_multiplier
 * x investment_multiplier — since those map directly onto existing engine
 * inputs (roi_capture_rate percentages, roi_cost_driver's investment
 * fields). The brief's alternative pairing (deployment_duration x
 * adoption_rate) has no "adoption_rate" input anywhere in the v1 engine to
 * multiply against, so it isn't fabricated here — this stays a
 * purpose-built 2-axis grid over the two variables that actually exist,
 * not a generic arbitrary-variable framework.
 */
import { calcScenario } from './roiCalcEngine'

function round2(n) { return n == null ? null : Math.round(n * 100) / 100 }

function applyMultiplier(costDriver, captureRates, scenario, variable, multiplier) {
  if (variable === 'capture_rate_multiplier') {
    const key = `${scenario}_pct`
    return { costDriver, captureRates: captureRates.map(r => ({ ...r, [key]: Number(r[key] || 0) * multiplier })) }
  }
  if (variable === 'investment_multiplier') {
    return {
      costDriver: { ...costDriver, iot_logger_unit_cost: Number(costDriver.iot_logger_unit_cost || 0) * multiplier, software_dev_cost_onetime: Number(costDriver.software_dev_cost_onetime || 0) * multiplier },
      captureRates,
    }
  }
  return { costDriver, captureRates }
}

/**
 * xValues/yValues: arrays of multipliers, e.g. [0.8, 1.0, 1.2] for ±20%.
 * variableX/variableY: 'capture_rate_multiplier' | 'investment_multiplier'.
 */
export function runSensitivity({ sites, costDriver, captureRates, efficiencyWeight, scenario, variableX, variableY, xValues, yValues }) {
  const cells = yValues.map(y => xValues.map(x => {
    let cd = costDriver, cr = captureRates
    ;({ costDriver: cd, captureRates: cr } = applyMultiplier(cd, cr, scenario, variableX, x))
    ;({ costDriver: cd, captureRates: cr } = applyMultiplier(cd, cr, scenario, variableY, y))
    const result = calcScenario({ sites, costDriver: cd, captureRates: cr, efficiencyWeight, scenario })
    return { roi_pct: result.roi_pct, payback_months: result.payback_months, total_annual_saving: result.total_annual_saving, total_investment: result.total_investment }
  }))

  const allRoi = cells.flat().map(c => c.roi_pct).filter(v => v != null)
  const roiSpreadPct = allRoi.length ? round2(Math.max(...allRoi) - Math.min(...allRoi)) : null

  return { variable_x: variableX, variable_y: variableY, x_values: xValues, y_values: yValues, cells, roi_spread_pct: roiSpreadPct }
}

/** Standard preset grid: ±20% on both axes, 5 points each. */
export function defaultSensitivityGrid() {
  return { xValues: [0.6, 0.8, 1.0, 1.2, 1.4], yValues: [0.6, 0.8, 1.0, 1.2, 1.4] }
}
