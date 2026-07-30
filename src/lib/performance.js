import { supabase } from './supabase'

// Banded rating scale, per stakeholder decision — stored as text everywhere,
// never a raw number. The 1-4 mapping below exists ONLY for averaging/trend
// math in this file and in recompute_performance_score() on the DB side;
// it is never shown to a user as a number.
export const RATING_BANDS = ['Unsatisfactory', 'Needs Improvement', 'Meets Expectations', 'Exceeds Expectations']
const BAND_SCORE = { 'Unsatisfactory': 1, 'Needs Improvement': 2, 'Meets Expectations': 3, 'Exceeds Expectations': 4 }
export const bandToScore = band => BAND_SCORE[band] ?? null

export const GOAL_STATUSES = ['Not Started', 'In Progress', 'Completed', 'Missed']
export const CYCLE_TYPES = ['Quarterly', 'Half-Yearly', 'Annual']
export const CYCLE_STATUSES = ['Planning', 'Goal-Setting Open', 'In Progress', 'Feedback Open', 'Manager Review', 'Calibration', 'Closed']
export const DEV_PLAN_STATUSES = ['Open', 'In Progress', 'Achieved', 'Not Achieved']

/* ═══ Performance Cycles ═══════════════════════════════════════ */

export async function listCycles() {
  const { data, error } = await supabase.from('performance_cycles').select('*').order('start_date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getCycle(id) {
  const { data, error } = await supabase.from('performance_cycles').select('*').eq('id', id).single()
  if (error) throw error
  return data
}

export async function createCycle(patch, userId) {
  const { data, error } = await supabase.from('performance_cycles').insert({ ...patch, created_by: userId }).select().single()
  if (error) throw error
  return data
}

export async function updateCycle(id, patch) {
  const { error } = await supabase.from('performance_cycles').update(patch).eq('id', id)
  if (error) throw error
}

/* ═══ Goals — weight_percent summing to 100% per employee per cycle is
 * validated here in app code, not a DB constraint (goals are entered one
 * at a time; a partial state mid-entry is normal, same reasoning as
 * proposal_cost_sections not enforcing category totals in SQL). ═══ */

export async function listGoals(employeeId, cycleId) {
  const { data, error } = await supabase.from('goals').select('*, project:projects(id,name)')
    .eq('employee_id', employeeId).eq('cycle_id', cycleId).order('created_at')
  if (error) throw error
  return data || []
}

export function totalGoalWeight(goals, excludeId = null) {
  return goals.filter(g => g.id !== excludeId).reduce((s, g) => s + (Number(g.weight_percent) || 0), 0)
}

export async function addGoal(patch) {
  const { error } = await supabase.from('goals').insert(patch)
  if (error) throw error
}

export async function updateGoal(id, patch) {
  const { error } = await supabase.from('goals').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteGoal(id) {
  const { error } = await supabase.from('goals').delete().eq('id', id)
  if (error) throw error
}

/* ═══ Self-Appraisal ═══════════════════════════════════════════ */

export async function getSelfAppraisal(employeeId, cycleId) {
  const { data } = await supabase.from('self_appraisals').select('*').eq('employee_id', employeeId).eq('cycle_id', cycleId).maybeSingle()
  return data || null
}

export async function upsertSelfAppraisal(employeeId, cycleId, patch, submit = false) {
  const payload = { employee_id: employeeId, cycle_id: cycleId, ...patch }
  if (submit) payload.submitted_at = new Date().toISOString()
  const { error } = await supabase.from('self_appraisals').upsert(payload, { onConflict: 'employee_id,cycle_id' })
  if (error) throw error
}

/* ═══ 360 Feedback — feedback_requests + peer_feedback.
 * Reads for the SUBJECT/their manager MUST go through get_peer_feedback()
 * (a SECURITY DEFINER RPC) so anonymous-provider redaction is enforced
 * server-side, not just by the UI hiding a column. Providers/HR can read
 * the base tables directly (see STEP66 RLS) — used for "requests I owe"
 * and HR oversight views. ═══ */

export async function listFeedbackRequestsForProvider(providerId) {
  const { data, error } = await supabase.from('feedback_requests')
    .select('*, subject:profiles!subject_employee_id(full_name), cycle:performance_cycles(cycle_name)')
    .eq('feedback_provider_id', providerId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function listFeedbackRequestsRequestedBy(requestedBy, cycleId) {
  let q = supabase.from('feedback_requests')
    .select('*, provider:profiles!feedback_provider_id(full_name), subject:profiles!subject_employee_id(full_name)')
    .eq('requested_by', requestedBy).order('created_at', { ascending: false })
  if (cycleId) q = q.eq('cycle_id', cycleId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function createFeedbackRequest({ cycleId, subjectEmployeeId, feedbackProviderId, requestedBy, isAnonymous = true }) {
  const { error } = await supabase.from('feedback_requests').insert({
    cycle_id: cycleId, subject_employee_id: subjectEmployeeId, feedback_provider_id: feedbackProviderId,
    requested_by: requestedBy, is_anonymous: isAnonymous,
  })
  if (error) throw error
}

export async function declineFeedbackRequest(id) {
  const { error } = await supabase.from('feedback_requests').update({ status: 'Declined' }).eq('id', id)
  if (error) throw error
}

export async function submitPeerFeedback(feedbackRequestId, { strengthsNoted, improvementAreasNoted, rating }) {
  const { error: insertErr } = await supabase.from('peer_feedback').insert({
    feedback_request_id: feedbackRequestId, strengths_noted: strengthsNoted,
    improvement_areas_noted: improvementAreasNoted, rating: rating || null,
  })
  if (insertErr) throw insertErr
  const { error: updateErr } = await supabase.from('feedback_requests').update({ status: 'Submitted' }).eq('id', feedbackRequestId)
  if (updateErr) throw updateErr
}

// Redacted read — the only path the app should use to show a subject (or
// their manager) their own 360 feedback. HR/admin/ceo see real identities
// even through this call; everyone else gets provider_id/provider_name = null
// whenever the underlying request was anonymous.
export async function getPeerFeedbackForSubject(subjectEmployeeId, cycleId) {
  const { data, error } = await supabase.rpc('get_peer_feedback', { p_subject_employee_id: subjectEmployeeId, p_cycle_id: cycleId })
  if (error) throw error
  return data || []
}

/* ═══ Manager Review ═══════════════════════════════════════════ */

export async function getManagerReview(employeeId, cycleId) {
  const { data } = await supabase.from('manager_reviews').select('*, reviewer:profiles!reviewer_id(full_name)')
    .eq('employee_id', employeeId).eq('cycle_id', cycleId).maybeSingle()
  return data || null
}

export async function upsertManagerReview(employeeId, cycleId, reviewerId, patch, submit = false) {
  const goals = await listGoals(employeeId, cycleId)
  const goalRatingsSummary = goals.map(g => ({ goal_title: g.goal_title, weight_percent: g.weight_percent, manager_rating: g.manager_rating }))
  const payload = { employee_id: employeeId, cycle_id: cycleId, reviewer_id: reviewerId, goal_ratings_summary: goalRatingsSummary, ...patch }
  if (submit) payload.submitted_at = new Date().toISOString()
  const { error } = await supabase.from('manager_reviews').upsert(payload, { onConflict: 'employee_id,cycle_id' })
  if (error) throw error
}

/* ═══ Live context panel — utilization, leave, skill growth, project
 * contribution for the cycle window, shown alongside the Manager Review
 * form so a reviewer never has to leave the screen to look this up
 * elsewhere. Reuses the SAME tables the Resource Allocation and Skill
 * Matrix modules already query — nothing new is computed or duplicated. ═══ */

export async function getContextPanel(employeeId, cycle) {
  const [{ data: snapshots }, { data: skills }, { data: leaves }, { data: allocations }] = await Promise.all([
    supabase.from('capacity_snapshots').select('*').eq('employee_id', employeeId)
      .gte('week_start_date', cycle.start_date).lte('week_start_date', cycle.end_date).order('week_start_date'),
    // Bounded on both ends to match recompute_performance_score()'s
    // skill_growth_count window exactly — otherwise this panel could show
    // a different "skills updated" count than what actually fed the score.
    supabase.from('employee_skills').select('*, skill:skills(skill_name, category)').eq('employee_id', employeeId)
      .gte('last_updated', cycle.start_date).lte('last_updated', `${cycle.end_date}T23:59:59`).order('last_updated', { ascending: false }),
    supabase.from('leave_requests').select('*').eq('employee_id', employeeId).eq('status', 'approved')
      .gte('from_date', cycle.start_date).lte('to_date', cycle.end_date),
    supabase.from('allocations').select('*, project:projects(id,name,status)').eq('employee_id', employeeId)
      .in('status', ['active', 'completed', 'approved'])
      .lte('start_date', cycle.end_date).or(`end_date.is.null,end_date.gte.${cycle.start_date}`),
  ])

  const utilRows = snapshots || []
  const avgUtilization = utilRows.length ? Math.round((utilRows.reduce((s, r) => s + (Number(r.utilization_percent) || 0), 0) / utilRows.length) * 10) / 10 : 0
  const totalLeaveDays = (leaves || []).reduce((s, l) => s + (Math.round((new Date(l.to_date) - new Date(l.from_date)) / 86400000) + 1), 0)

  return {
    utilizationTrend: utilRows,
    avgUtilization,
    skillsUpdated: skills || [],
    leaves: leaves || [],
    totalLeaveDays,
    projects: allocations || [],
  }
}

/* ═══ Calibration ═══════════════════════════════════════════════ */

export async function listCalibrationSessions(cycleId) {
  let q = supabase.from('calibration_sessions').select('*, department:departments(name)').order('created_at', { ascending: false })
  if (cycleId) q = q.eq('cycle_id', cycleId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function createCalibrationSession(patch, userId) {
  const { data, error } = await supabase.from('calibration_sessions').insert({ ...patch, created_by: userId }).select().single()
  if (error) throw error
  return data
}

export async function updateCalibrationSession(id, patch) {
  const { error } = await supabase.from('calibration_sessions').update(patch).eq('id', id)
  if (error) throw error
}

export async function listCalibrationAdjustments(calibrationSessionId) {
  const { data, error } = await supabase.from('calibration_adjustments')
    .select('*, employee:profiles!employee_id(full_name)').eq('calibration_session_id', calibrationSessionId).order('adjusted_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Records the adjustment AND settles final_ratings in one call — a
// calibration adjustment IS the final rating for that employee/cycle,
// there's no separate step where someone re-enters the number.
export async function addCalibrationAdjustment({ calibrationSessionId, employeeId, cycleId, originalManagerRating, calibratedFinalRating, adjustmentReason, adjustedBy }) {
  const { error: adjErr } = await supabase.from('calibration_adjustments').insert({
    calibration_session_id: calibrationSessionId, employee_id: employeeId, cycle_id: cycleId,
    original_manager_rating: originalManagerRating, calibrated_final_rating: calibratedFinalRating,
    adjustment_reason: adjustmentReason, adjusted_by: adjustedBy,
  })
  if (adjErr) throw adjErr
  await setFinalRating(employeeId, cycleId, calibratedFinalRating, 'Calibrated', adjustedBy)
}

/* ═══ Final Rating ═══════════════════════════════════════════════ */

export async function getFinalRating(employeeId, cycleId) {
  const { data } = await supabase.from('final_ratings').select('*').eq('employee_id', employeeId).eq('cycle_id', cycleId).maybeSingle()
  return data || null
}

export async function setFinalRating(employeeId, cycleId, finalRating, ratingSource, finalizedBy) {
  const { error } = await supabase.from('final_ratings').upsert({
    employee_id: employeeId, cycle_id: cycleId, final_rating: finalRating,
    rating_source: ratingSource, finalized_by: finalizedBy, finalized_at: new Date().toISOString(),
  }, { onConflict: 'employee_id,cycle_id' })
  if (error) throw error
  await recomputeScore(employeeId, cycleId)
}

/* ═══ Development Plan — this cycle's plan is shown as context when the
 * NEXT cycle's Goals are set (closing the "what to improve -> did we"
 * loop); callers fetch the prior cycle's plans by passing that cycle's id. ═══ */

export async function listDevelopmentPlans(employeeId, cycleId) {
  let q = supabase.from('development_plans').select('*, skill:skills(skill_name)').eq('employee_id', employeeId).order('created_at', { ascending: false })
  if (cycleId) q = q.eq('cycle_id', cycleId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function addDevelopmentPlan(patch) {
  const { error } = await supabase.from('development_plans').insert(patch)
  if (error) throw error
}

export async function updateDevelopmentPlan(id, patch) {
  const { error } = await supabase.from('development_plans').update(patch).eq('id', id)
  if (error) throw error
}

/* ═══ Composite Score Weights (HR-editable settings, singleton row) ═══ */

export async function getScoreWeights() {
  const { data } = await supabase.from('performance_score_weights').select('*').eq('id', 1).maybeSingle()
  return data || { goal_achievement_weight_percent: 60, manager_rating_weight_percent: 30, utilization_weight_percent: 10 }
}

export async function saveScoreWeights(weights, updatedBy) {
  const { error } = await supabase.from('performance_score_weights').update({ ...weights, updated_by: updatedBy }).eq('id', 1)
  if (error) throw error
}

/* ═══ Performance Score (cached rollup) ═══════════════════════════ */

export async function getPerformanceScore(employeeId, cycleId) {
  const { data } = await supabase.from('performance_scores').select('*').eq('employee_id', employeeId).eq('cycle_id', cycleId).maybeSingle()
  return data || null
}

// Triggers the DB-side recompute (SECURITY DEFINER — see STEP66) rather
// than computing the rollup in JS, so the cached row is always produced
// by the exact same formula regardless of which screen asked for it.
export async function recomputeScore(employeeId, cycleId) {
  const { error } = await supabase.rpc('recompute_performance_score', { p_employee_id: employeeId, p_cycle_id: cycleId })
  if (error) throw error
}

/* ═══ Dashboard ═══════════════════════════════════════════════════
 * One query surface, filtered every way the dashboard needs — department,
 * project, designation, cycle, rating band, tenure. Returns raw joined
 * rows; department/employee-wise aggregation happens in the page itself
 * (small enough dataset per cycle that client-side grouping is fine,
 * matching this app's existing dashboard pages). ═══ */

export async function getDashboardRows({ cycleId, departmentId, projectId, designation, ratingBand, tenureMaxYears }) {
  let q = supabase.from('performance_scores')
    .select('*, employee:profiles!employee_id(id,full_name,designation,department_id,date_joined,dept:departments(id,name)), cycle:performance_cycles(cycle_name,start_date,end_date)')
  if (cycleId) q = q.eq('cycle_id', cycleId)
  const { data, error } = await q
  if (error) throw error
  let rows = data || []

  if (departmentId) rows = rows.filter(r => r.employee?.department_id === departmentId)
  if (designation) rows = rows.filter(r => r.employee?.designation === designation)
  if (ratingBand) rows = rows.filter(r => r.final_rating === ratingBand)
  if (tenureMaxYears) {
    const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - tenureMaxYears)
    rows = rows.filter(r => r.employee?.date_joined && new Date(r.employee.date_joined) >= cutoff)
  }
  if (projectId) {
    const { data: allocs } = await supabase.from('allocations').select('employee_id').eq('project_id', projectId)
    const ids = new Set((allocs || []).map(a => a.employee_id))
    rows = rows.filter(r => ids.has(r.employee_id))
  }
  return rows
}

// Aggregated improvement themes across DevelopmentPlans in a set of
// employees — naive keyword bucket by improvement_area text, good enough
// to surface "communication keeps coming up in Engineering" without needing
// NLP; HR can always drill into the raw list for the real detail.
export function summarizeImprovementThemes(developmentPlans) {
  const counts = new Map()
  developmentPlans.forEach(p => {
    const key = (p.improvement_area || '').trim().toLowerCase()
    if (!key) return
    counts.set(key, (counts.get(key) || 0) + 1)
  })
  return [...counts.entries()].map(([theme, count]) => ({ theme, count })).sort((a, b) => b.count - a.count)
}
