/**
 * ROI PLANNING — Forecast Engine (Section 5 of the module spec).
 *
 * Pure function, no supabase import — the caller (roiProposals.js) reads the
 * proposal/snapshot/burn rows and hands them in as plain data, same reasoning
 * as roiCalcEngine.js.
 *
 * IMPORTANT: no project in this schema emits incident-level telemetry today
 * (see roiCalcEngine.js header) — realized_savings_to_date is therefore
 * ALWAYS null here, and revised figures always fall back to the original
 * scenario's total_annual_saving, flagged "unadjusted — no telemetry". Do
 * not fabricate a realized figure to make this branch look more complete —
 * the brief is explicit that a plan-derived number must never be presented
 * as measured.
 */

function round2(n) { return n == null ? null : Math.round(n * 100) / 100 }

/**
 * @param proposal { duration_months, approved_at }
 * @param snapshot the latest roi_calculation_snapshot row for the scenario being forecast
 * @param burnEntries array of { amount } — actual burn recorded against this proposal
 * @param requestedDurationMonths optional override of proposal.duration_months
 * @param realizedSavingsToDate optional — always null today (no telemetry source exists); kept as a
 *        parameter so a future telemetry-linked project can pass a real figure without an engine change
 */
export function runForecast({ proposal, snapshot, burnEntries, requestedDurationMonths, realizedSavingsToDate = null }) {
  const totalInvestment = Number(snapshot.total_investment || 0)
  const totalAnnualSaving = Number(snapshot.total_annual_saving || 0)
  const planDurationMonths = Number(proposal.duration_months || 0)

  const elapsedMonths = proposal.approved_at
    ? Math.max(0, (Date.now() - new Date(proposal.approved_at).getTime()) / (1000 * 60 * 60 * 24 * 30.4375))
    : 0

  const actualBurnToDate = round2((burnEntries || []).reduce((s, e) => s + Number(e.amount || 0), 0))
  const burnRate = elapsedMonths > 0 ? actualBurnToDate / elapsedMonths : null
  const remainingBurn = round2(totalInvestment - actualBurnToDate)
  const projectedFinalSpend = burnRate != null ? round2(burnRate * planDurationMonths) : null
  const spendVariance = projectedFinalSpend != null ? round2(totalInvestment - projectedFinalSpend) : null

  const effectiveDuration = requestedDurationMonths ?? planDurationMonths
  const remainingDuration = Math.max(0, effectiveDuration - elapsedMonths)
  const requiredBurnRateToHitTarget = remainingDuration > 0 ? round2(remainingBurn / remainingDuration) : null

  const plannedSavingsToDate = planDurationMonths > 0
    ? round2((totalAnnualSaving / planDurationMonths) * elapsedMonths)
    : null

  const hasRealized = realizedSavingsToDate != null
  const revisedAnnualSavingRate = hasRealized && elapsedMonths > 0
    ? round2((realizedSavingsToDate / elapsedMonths) * 12)
    : totalAnnualSaving

  const revisedRoiPct = remainingBurn > 0 || totalInvestment > 0
    ? (totalInvestment > 0 ? round2((revisedAnnualSavingRate / totalInvestment) * 100) : null)
    : null
  const revisedPaybackMonths = revisedAnnualSavingRate > 0
    ? round2((totalInvestment / revisedAnnualSavingRate) * 12)
    : null

  return {
    scenario: snapshot.scenario,
    proposed_investment: totalInvestment,
    burned_to_date: actualBurnToDate,
    remaining_burn: remainingBurn,
    projected_at_current_rate: projectedFinalSpend,
    spend_variance: spendVariance,
    required_burn_rate_to_hit_target: requiredBurnRateToHitTarget,
    planned_savings_to_date: plannedSavingsToDate,
    realized_savings_to_date: realizedSavingsToDate, // always null today — see header
    revised_annual_saving_rate: revisedAnnualSavingRate,
    revised_roi_pct: revisedRoiPct,
    revised_payback_months: revisedPaybackMonths,
    is_telemetry_adjusted: hasRealized, // false today, always — UI must label as "based on original plan, not actuals" when this is false
    elapsed_months: round2(elapsedMonths),
    remaining_duration_months: round2(remainingDuration),
  }
}

/** Run the forecast for every scenario's latest snapshot — used when no single `scenario` is requested. */
export function runForecastAllScenarios({ proposal, snapshotsByScenario, burnEntries, requestedDurationMonths }) {
  return Object.keys(snapshotsByScenario).map(scenario =>
    runForecast({ proposal, snapshot: snapshotsByScenario[scenario], burnEntries, requestedDurationMonths })
  )
}

/**
 * DELAY IMPACT — "if the implementation completes on schedule you get this
 * much ROI; if it's delayed by N months, here's what that costs you."
 *
 * total_annual_saving is a steady-state rate that only starts accruing once
 * the solution actually goes live. A delay doesn't change that rate — it
 * pushes out the date the clock starts, so every delayed month is saving
 * that isn't captured during a fixed evaluation window (default: the first
 * 12 months after the originally planned go-live), plus payback shifting
 * back by the same delay. This is a plain deterministic function, same
 * side-effect-free shape as calcScenario — verify by hand before trusting
 * it for a real customer-facing number, same as the calc engine.
 *
 * @param snapshot a roi_calculation_snapshot row (total_annual_saving, total_investment, roi_pct, payback_months)
 * @param delayMonths months beyond the planned go-live date (0 = on schedule)
 * @param evaluationWindowMonths the fixed window "Year 1 value" is measured over (default 12)
 */
export function calcDelayImpact({ snapshot, delayMonths = 0, evaluationWindowMonths = 12 }) {
  const totalAnnualSaving = Number(snapshot.total_annual_saving || 0)
  const totalInvestment = Number(snapshot.total_investment || 0)
  const monthlySaving = totalAnnualSaving / 12

  const capturedMonths = Math.max(0, evaluationWindowMonths - delayMonths)
  const savingCapturedInWindow = round2(monthlySaving * capturedMonths)
  const savingsLostToDelay = round2(monthlySaving * Math.min(delayMonths, evaluationWindowMonths))

  const windowRoiPct = totalInvestment > 0 ? round2((savingCapturedInWindow / totalInvestment) * 100) : null
  const delayedPaybackMonths = snapshot.payback_months != null ? round2(Number(snapshot.payback_months) + delayMonths) : null

  return {
    scenario: snapshot.scenario,
    delay_months: delayMonths,
    evaluation_window_months: evaluationWindowMonths,
    monthly_saving_rate: round2(monthlySaving),
    on_time_saving_in_window: round2(monthlySaving * evaluationWindowMonths),
    saving_captured_in_window: savingCapturedInWindow,
    savings_lost_to_delay: savingsLostToDelay,
    year1_roi_pct: windowRoiPct,
    steady_state_roi_pct: snapshot.roi_pct, // unaffected by delay — the rate itself doesn't change, only when it starts
    on_time_payback_months: snapshot.payback_months,
    delayed_payback_months: delayedPaybackMonths,
  }
}

/** Standard preset comparison for a customer-facing view: on schedule + a few common delay lengths. */
export function delayImpactPresets(snapshot, delayMonthsList = [0, 1, 3, 6]) {
  return delayMonthsList.map(m => calcDelayImpact({ snapshot, delayMonths: m }))
}
