/**
 * NPV / IRR — uses the `financial` npm package's standard DCF/iterative-
 * solve implementations (per the brief: "use a library, don't hand-roll
 * Newton's method"). Verified empirically before use — see the session
 * that built this: financial.npv(0.10, [-1000,500,500,500]) === 243.43
 * (hand-computable) and financial.irr(...) on the same series solves back
 * to a rate that zeroes NPV, confirming standard semantics: values[0] is
 * the undiscounted initial outlay, values[1..] are discounted future flows.
 */
import { npv as npvFn, irr as irrFn } from 'financial'

function round2(n) { return n == null ? null : Math.round(n * 100) / 100 }

/**
 * annualCashFlows: array of future-year net cash flows (length = horizonYears),
 * NOT including the initial investment — that's passed separately and
 * prepended internally as the negative t0 outlay.
 */
export function calcNpvIrr({ initialInvestment, annualCashFlows, discountRatePct }) {
  const series = [-Math.abs(Number(initialInvestment) || 0), ...annualCashFlows.map(Number)]
  const rate = Number(discountRatePct || 0) / 100
  const npv = round2(npvFn(rate, series))
  let irrPct = null
  try {
    const solved = irrFn(series)
    if (Number.isFinite(solved)) irrPct = round2(solved * 100)
  } catch { /* no real root in range — flat/negative cash flows can do this; leave irrPct null rather than throw */ }

  return {
    initial_investment: round2(initialInvestment), annual_cash_flows: annualCashFlows,
    discount_rate_pct: discountRatePct, npv, irr_pct: irrPct,
  }
}

/** Flat annual cash flow projection from a steady-state annual net benefit rate — the simplest defensible model absent a ramp-up schedule. */
export function flatCashFlowSeries(annualNetBenefit, horizonYears) {
  return Array.from({ length: horizonYears }, () => Number(annualNetBenefit) || 0)
}
