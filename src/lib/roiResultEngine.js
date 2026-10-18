/**
 * ROI ENTERPRISE ECONOMICS — pure calculation functions (Sections 3/5/6 of
 * the v2 brief). No supabase import, same side-effect-free reasoning as
 * roiCalcEngine.js/roiForecast.js — verify by hand before trusting a new
 * formula here, same discipline as those two files.
 */
import { fvAmount } from './financialValue'

function round2(n) { return n == null ? null : Math.round(n * 100) / 100 }
const HORIZON_YEARS = { annual: 1, '3yr': 3, '5yr': 5 }

/** Total PO value — original + change orders + expansion − credits. */
export function calcTotalPo({ originalPo, changeOrders = [], expansionPo, credits }) {
  const total = fvAmount(originalPo) + changeOrders.reduce((s, c) => s + fvAmount(c.amount), 0) + fvAmount(expansionPo) - fvAmount(credits)
  return round2(total)
}

/** Gross Profit: Total PO → Actual Delivery Cost → Gross Profit → Gross Margin. */
export function calcGrossProfit({ totalPo, deliveryCostLines = [] }) {
  const breakdown = {}
  let actualDeliveryCost = 0
  for (const line of deliveryCostLines) {
    const amt = fvAmount(line.existing_amount) + fvAmount(line.manual_amount)
    breakdown[line.category] = round2((breakdown[line.category] || 0) + amt)
    actualDeliveryCost += amt
  }
  actualDeliveryCost = round2(actualDeliveryCost)
  const grossProfit = round2(totalPo - actualDeliveryCost)
  const grossMarginPct = totalPo > 0 ? round2((grossProfit / totalPo) * 100) : null
  return { total_po: round2(totalPo), actual_delivery_cost: actualDeliveryCost, gross_profit: grossProfit, gross_margin_pct: grossMarginPct, breakdown }
}

/**
 * Splits ROI into Customer (their investment vs their realized benefit) and
 * Internal (our gross profit vs our delivery cost) outputs, per horizon.
 * customer_net_benefit is realized benefit MINUS investment over the
 * horizon (traditional (gain-cost)/cost ROI convention) — deliberately NOT
 * the same "saving/investment" convention v1's roi_pct uses; the brief
 * defines this one differently on purpose (Section 3, roi_result).
 * internal_payback_months has no natural "recurring savings" meaning for a
 * one-time delivery engagement (unlike customer payback) — approximated
 * here as the point in the project's own duration at which cumulative PO
 * revenue recognized (assumed linear) would match cumulative delivery cost
 * incurred, i.e. duration_months x (actual_delivery_cost / total_po).
 * Documented as an approximation, not a measured figure.
 */
export function calcRoiResult({ investmentLines = [], benefitDrivers = [], scenario, horizon, grossProfit, actualDeliveryCost, totalPo, durationMonths }) {
  const horizonYears = HORIZON_YEARS[horizon] || 1
  // Customer ROI is what the CUSTOMER invested — party='provider' lines
  // (the service provider's own contribution) are excluded; including them
  // would overstate the customer's own investment.
  const clientLines = investmentLines.filter(l => (l.party || 'client') === 'client')
  const oneTime = clientLines.filter(l => l.timing === 'one_time').reduce((s, l) => s + fvAmount(l.amount), 0)
  const recurringAnnual = clientLines.filter(l => l.timing === 'recurring').reduce((s, l) => s + fvAmount(l.amount), 0)
  const customerInvestment = round2(oneTime + recurringAnnual * horizonYears)

  const annualRealizedBenefit = benefitDrivers.filter(b => b.scenario === scenario).reduce((s, b) => s + fvAmount(b.realized_value), 0)
  const totalRealizedBenefit = round2(annualRealizedBenefit * horizonYears)
  const customerNetBenefit = round2(totalRealizedBenefit - customerInvestment)
  const customerRoiPct = customerInvestment > 0 ? round2((customerNetBenefit / customerInvestment) * 100) : null
  const customerPaybackMonths = annualRealizedBenefit > 0 ? round2(customerInvestment / (annualRealizedBenefit / 12)) : null

  const internalRoiPct = actualDeliveryCost > 0 ? round2((grossProfit / actualDeliveryCost) * 100) : null
  const internalPaybackMonths = totalPo > 0 ? round2(durationMonths * (actualDeliveryCost / totalPo)) : null

  return {
    scenario, horizon,
    customer_investment: customerInvestment, customer_net_benefit: customerNetBenefit,
    customer_roi_pct: customerRoiPct, customer_payback_months: customerPaybackMonths,
    gross_profit: round2(grossProfit), actual_delivery_cost: round2(actualDeliveryCost),
    internal_roi_pct: internalRoiPct, internal_payback_months: internalPaybackMonths,
  }
}

/** Cost variance status — thresholds are org-configurable (roi_settings), never hardcoded. */
export function calcCostVariance({ budget, actual, atRiskPct = 10, overBudgetPct = 20 }) {
  const varianceAmount = round2(actual - budget)
  const variancePct = budget ? round2((varianceAmount / budget) * 100) : null
  let status = 'on_track'
  if (variancePct != null) {
    const abs = Math.abs(variancePct)
    if (abs >= overBudgetPct) status = 'over_budget'
    else if (abs >= atRiskPct) status = 'at_risk'
  }
  return { budget: round2(budget), actual: round2(actual), variance_amount: varianceAmount, variance_pct: variancePct, status }
}

/** Risk rating derived from the sensitivity grid's ROI% spread — never manually entered. */
export function deriveRiskRating(roiSpreadPct, { lowSpreadPct = 15, highSpreadPct = 40 } = {}) {
  if (roiSpreadPct == null) return null
  if (roiSpreadPct <= lowSpreadPct) return 'low'
  if (roiSpreadPct >= highSpreadPct) return 'high'
  return 'medium'
}
