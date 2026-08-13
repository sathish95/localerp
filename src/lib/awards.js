import { supabase } from './supabase'
import { sendNotif, sendNotifToMany } from './notifications'
import { generateCertificate } from './certificates'

/* ═══ Configurable constants — all of these are HR-editable data, never
 * a hardcoded sequence. The arrays below are only used to seed sensible
 * defaults and to drive picker UIs; nothing in the scoring/eligibility
 * logic branches on a fixed order. ═══ */

export const AWARD_STATUSES = ['draft', 'active', 'evaluation', 'completed', 'cancelled']
export const FREQUENCY_SUGGESTIONS = ['One-Time', 'Monthly', 'Quarterly', 'Half-Yearly', 'Annual']

export const WORKFLOW_STEP_DEFS = [
  { key: 'self_feedback', label: 'Employee Self Feedback' },
  { key: 'manager_feedback', label: 'Manager / Lead Feedback' },
  { key: 'peer_nomination', label: 'Colleague / Peer Nomination' },
  { key: 'additional_evaluation', label: 'Additional Evaluation' },
  { key: 'final_approval', label: 'Final Manager Approval' },
]

export const QUESTION_TYPES = [
  { key: 'text', label: 'Short Text' },
  { key: 'long_text', label: 'Long Text' },
  { key: 'rating', label: 'Rating' },
  { key: 'number', label: 'Number' },
  { key: 'yes_no', label: 'Yes / No' },
  { key: 'attachment', label: 'Attachment' },
]

export const ELIGIBILITY_RULE_TYPES = [
  { key: 'department', label: 'Department' },
  { key: 'designation', label: 'Designation' },
  { key: 'employment_type', label: 'Employment Type' },
  { key: 'location', label: 'Location' },
  { key: 'min_tenure_months', label: 'Minimum Tenure (months)' },
  { key: 'min_performance_rating', label: 'Minimum Performance Score' },
  { key: 'employment_status', label: 'Employment Status' },
  { key: 'specific_employees', label: 'Specific Employees' },
]

// `location` has no backing column on profiles today — flagged so the UI
// can tell HR the rule is saved but not yet enforced in the eligible-count
// preview, instead of silently pretending to filter on it.
export const UNENFORCED_RULE_TYPES = ['location']

export const DEFAULT_SCORING_WEIGHTS = {
  self_feedback_weight: 20, manager_feedback_weight: 40, peer_feedback_weight: 20, performance_weight: 20,
}
export const DEFAULT_RATING_SCALE = [
  { value: 1, label: 'Needs Improvement' },
  { value: 2, label: 'Below Expectations' },
  { value: 3, label: 'Meets Expectations' },
  { value: 4, label: 'Exceeds Expectations' },
  { value: 5, label: 'Outstanding' },
]
export const DEFAULT_RECOMMENDATION_THRESHOLDS = [
  { min_score: 90, label: 'Strongly Recommended' },
  { min_score: 80, label: 'Recommended' },
  { min_score: 70, label: 'Consider' },
  { min_score: 0, label: 'Not Recommended' },
]
export const DEFAULT_TIE_BREAK_ORDER = ['manager_score', 'peer_score', 'performance_score']

export function totalScoringWeight(w) {
  return (Number(w.self_feedback_weight) || 0) + (Number(w.manager_feedback_weight) || 0)
    + (Number(w.peer_feedback_weight) || 0) + (Number(w.performance_weight) || 0)
}

/* ═══ Award Categories ═══════════════════════════════════════════ */

export async function listCategories({ includeInactive = true } = {}) {
  let q = supabase.from('award_categories').select('*').order('name')
  if (!includeInactive) q = q.eq('is_active', true)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function createCategory(patch, userId) {
  const { data, error } = await supabase.from('award_categories').insert({ ...patch, created_by: userId }).select().single()
  if (error) throw error
  return data
}

export async function updateCategory(id, patch) {
  const { error } = await supabase.from('award_categories').update(patch).eq('id', id)
  if (error) throw error
}

export async function setCategoryActive(id, isActive) {
  const { error } = await supabase.from('award_categories').update({ is_active: isActive }).eq('id', id)
  if (error) throw error
}

// Blocks deletion (suggesting disable instead) when any award still
// references this category — a hard DB delete would only SET NULL those
// awards' category_id, which silently orphans them, so "safe" is enforced
// here in app code rather than left to the FK's ON DELETE behavior.
export async function deleteCategory(id) {
  const { count, error: countErr } = await supabase.from('performance_awards').select('id', { count: 'exact', head: true }).eq('category_id', id)
  if (countErr) throw countErr
  if (count > 0) throw new Error(`This category is used by ${count} award(s). Disable it instead of deleting.`)
  const { error } = await supabase.from('award_categories').delete().eq('id', id)
  if (error) throw error
}

/* ═══ Awards ══════════════════════════════════════════════════════ */

export async function listAwards({ status, categoryId, search } = {}) {
  let q = supabase.from('performance_awards').select('*, category:award_categories(id,name)').order('created_at', { ascending: false })
  if (status) q = q.eq('status', status)
  if (categoryId) q = q.eq('category_id', categoryId)
  const { data, error } = await q
  if (error) throw error
  let rows = data || []
  if (search) {
    const s = search.toLowerCase()
    rows = rows.filter(r => r.name?.toLowerCase().includes(s) || r.code?.toLowerCase().includes(s))
  }
  return rows
}

export async function getAward(id) {
  const [{ data: award, error: awardErr }, rules, steps, scoring] = await Promise.all([
    supabase.from('performance_awards').select('*, category:award_categories(id,name)').eq('id', id).single(),
    listEligibilityRules(id),
    listWorkflowSteps(id),
    getScoringConfig(id),
  ])
  if (awardErr) throw awardErr
  const questions = await listQuestions(id)
  return { ...award, eligibilityRules: rules, workflowSteps: steps, questions, scoringConfig: scoring }
}

export async function createAward(patch, userId) {
  const { data, error } = await supabase.from('performance_awards').insert({ ...patch, created_by: userId }).select().single()
  if (error) throw error
  return data
}

export async function updateAward(id, patch) {
  const { error } = await supabase.from('performance_awards').update(patch).eq('id', id)
  if (error) throw error
}

export async function updateAwardStatus(id, status) {
  const { error } = await supabase.from('performance_awards').update({ status }).eq('id', id)
  if (error) throw error
}

// Only a Draft award (nothing has been evaluated against it yet) is safe
// to remove outright — anything past Draft should be Cancelled instead so
// history/audit stays intact.
export async function deleteAward(id) {
  const { data: award, error: getErr } = await supabase.from('performance_awards').select('status').eq('id', id).single()
  if (getErr) throw getErr
  if (award.status !== 'draft') throw new Error('Only awards in Draft status can be deleted. Cancel this award instead.')
  const { error } = await supabase.from('performance_awards').delete().eq('id', id)
  if (error) throw error
}

/* ═══ Eligibility Rules ══════════════════════════════════════════ */

export async function listEligibilityRules(awardId) {
  const { data, error } = await supabase.from('award_eligibility_rules').select('*').eq('award_id', awardId).order('created_at')
  if (error) throw error
  return data || []
}

// Replace-all: the wizard step edits the whole rule set at once, so
// clearing and re-inserting is simpler and just as safe as a diff (same
// pattern as saveQuestions below).
export async function saveEligibilityRules(awardId, rules) {
  const { error: delErr } = await supabase.from('award_eligibility_rules').delete().eq('award_id', awardId)
  if (delErr) throw delErr
  if (!rules.length) return
  const { error } = await supabase.from('award_eligibility_rules').insert(
    rules.map(r => ({ award_id: awardId, rule_type: r.rule_type, rule_value: r.rule_value }))
  )
  if (error) throw error
}

/* ═══ Eligibility preview — evaluates the configured rules against
 * profiles/departments/performance_scores directly in the client, the
 * same way performance.js's getDashboardRows() filters a joined result
 * set in JS rather than pushing every filter into SQL. Rules the current
 * employee schema can't back (see UNENFORCED_RULE_TYPES) are skipped here
 * and flagged in the return value instead of silently mis-counting. ═══ */

export async function previewEligibleEmployees(rules) {
  const { data: profiles, error } = await supabase.from('profiles')
    .select('id, full_name, designation, department_id, employment_type, date_joined, is_active, dept:departments(id,name)')
  if (error) throw error
  let rows = profiles || []
  const skippedRuleTypes = []

  const specificIds = rules.find(r => r.rule_type === 'specific_employees')
  if (specificIds) {
    const ids = new Set(specificIds.rule_value?.employee_ids || [])
    rows = rows.filter(r => ids.has(r.id))
  }
  const dept = rules.find(r => r.rule_type === 'department')
  if (dept) {
    const ids = new Set(dept.rule_value?.department_ids || [])
    if (ids.size) rows = rows.filter(r => ids.has(r.department_id))
  }
  const desig = rules.find(r => r.rule_type === 'designation')
  if (desig) {
    const set = new Set((desig.rule_value?.designations || []).map(d => d.toLowerCase()))
    if (set.size) rows = rows.filter(r => r.designation && set.has(r.designation.toLowerCase()))
  }
  const empType = rules.find(r => r.rule_type === 'employment_type')
  if (empType) {
    const set = new Set(empType.rule_value?.employment_types || [])
    if (set.size) rows = rows.filter(r => set.has(r.employment_type))
  }
  const empStatus = rules.find(r => r.rule_type === 'employment_status')
  if (empStatus) {
    const wantActive = (empStatus.rule_value?.statuses || []).includes('active')
    const wantInactive = (empStatus.rule_value?.statuses || []).includes('inactive')
    if (wantActive && !wantInactive) rows = rows.filter(r => r.is_active)
    if (wantInactive && !wantActive) rows = rows.filter(r => !r.is_active)
  }
  const tenure = rules.find(r => r.rule_type === 'min_tenure_months')
  if (tenure?.rule_value?.months) {
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - Number(tenure.rule_value.months))
    rows = rows.filter(r => r.date_joined && new Date(r.date_joined) <= cutoff)
  }
  const minRating = rules.find(r => r.rule_type === 'min_performance_rating')
  if (minRating?.rule_value?.min_score != null && rows.length) {
    const { data: scores } = await supabase.from('performance_scores')
      .select('employee_id, composite_score, computed_at').in('employee_id', rows.map(r => r.id)).order('computed_at', { ascending: false })
    const latestByEmployee = new Map()
    for (const s of (scores || [])) if (!latestByEmployee.has(s.employee_id)) latestByEmployee.set(s.employee_id, s.composite_score)
    rows = rows.filter(r => (latestByEmployee.get(r.id) || 0) >= Number(minRating.rule_value.min_score))
  }
  if (rules.some(r => UNENFORCED_RULE_TYPES.includes(r.rule_type))) {
    skippedRuleTypes.push(...rules.filter(r => UNENFORCED_RULE_TYPES.includes(r.rule_type)).map(r => r.rule_type))
  }

  return { count: rows.length, employees: rows, skippedRuleTypes }
}

export async function getEligibleEmployeesForAward(awardId) {
  const rules = await listEligibilityRules(awardId)
  return previewEligibleEmployees(rules)
}

// Distinct department/designation/employment-type lists to build the
// eligibility rule pickers from real data instead of a hardcoded list.
export async function getEmployeeFilterOptions() {
  const [{ data: departments }, { data: profiles }] = await Promise.all([
    supabase.from('departments').select('id,name').order('name'),
    supabase.from('profiles').select('designation, employment_type'),
  ])
  const designations = [...new Set((profiles || []).map(p => p.designation).filter(Boolean))].sort()
  const employmentTypes = [...new Set((profiles || []).map(p => p.employment_type).filter(Boolean))].sort()
  return { departments: departments || [], designations, employmentTypes }
}

/* ═══ Workflow Steps ══════════════════════════════════════════════ */

export async function listWorkflowSteps(awardId) {
  const { data, error } = await supabase.from('award_workflow_steps').select('*').eq('award_id', awardId).order('step_order')
  if (error) throw error
  return data || []
}

export async function saveWorkflowSteps(awardId, steps) {
  const { error } = await supabase.from('award_workflow_steps').upsert(
    steps.map((s, i) => ({ award_id: awardId, step_key: s.step_key, is_enabled: s.is_enabled, step_order: s.step_order ?? i, config: s.config || {} })),
    { onConflict: 'award_id,step_key' }
  )
  if (error) throw error
}

/* ═══ Feedback / Nomination Questions ═══════════════════════════ */

export async function listQuestions(awardId, stepKey) {
  let q = supabase.from('award_questions').select('*').eq('award_id', awardId).order('sort_order')
  if (stepKey) q = q.eq('step_key', stepKey)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function saveQuestions(awardId, stepKey, questions) {
  const { error: delErr } = await supabase.from('award_questions').delete().eq('award_id', awardId).eq('step_key', stepKey)
  if (delErr) throw delErr
  if (!questions.length) return
  const { error } = await supabase.from('award_questions').insert(
    questions.map((qn, i) => ({
      award_id: awardId, step_key: stepKey, question_text: qn.question_text,
      question_type: qn.question_type || 'text', is_required: qn.is_required !== false, sort_order: i,
    }))
  )
  if (error) throw error
}

/* ═══ Scoring Config ══════════════════════════════════════════════ */

export async function getScoringConfig(awardId) {
  const { data } = await supabase.from('award_scoring_config').select('*').eq('award_id', awardId).maybeSingle()
  return data || {
    ...DEFAULT_SCORING_WEIGHTS,
    rating_scale: DEFAULT_RATING_SCALE,
    recommendation_thresholds: DEFAULT_RECOMMENDATION_THRESHOLDS,
    tie_break_order: DEFAULT_TIE_BREAK_ORDER,
  }
}

export async function saveScoringConfig(awardId, config) {
  if (Math.round(totalScoringWeight(config) * 100) / 100 !== 100) {
    throw new Error('Scoring weights must add up to exactly 100%.')
  }
  const { error } = await supabase.from('award_scoring_config').upsert({ award_id: awardId, ...config }, { onConflict: 'award_id' })
  if (error) throw error
}

/* ═══ Publish — snapshots the eligibility rules into award_participants
 * ONCE (see STEP116's header note on why this isn't re-evaluated live),
 * notifies every eligible employee, then flips the award to Active.
 * upsert+ignoreDuplicates makes this safe to call again (e.g. HR widens
 * eligibility and re-publishes) without clobbering participants who
 * already have progress recorded against them. ═══ */

export async function publishAward(awardId) {
  const [award, rules] = await Promise.all([
    supabase.from('performance_awards').select('name').eq('id', awardId).single().then(r => { if (r.error) throw r.error; return r.data }),
    listEligibilityRules(awardId),
  ])
  const { employees } = await previewEligibleEmployees(rules)
  if (employees.length) {
    const { error } = await supabase.from('award_participants').upsert(
      employees.map(e => ({ award_id: awardId, employee_id: e.id })),
      { onConflict: 'award_id,employee_id', ignoreDuplicates: true }
    )
    if (error) throw error
    await sendNotifToMany(employees.map(e => e.id), {
      type: 'award_cycle_started',
      title: `New award open: ${award.name}`,
      body: `You're eligible for the "${award.name}" award. Check My Awards for pending feedback.`,
      link: '/my-awards',
    })
  }
  await updateAwardStatus(awardId, 'active')
  return employees.length
}

export async function listParticipants(awardId) {
  const { data, error } = await supabase.from('award_participants')
    .select('*, employee:profiles!employee_id(id,full_name,designation,department_id,dept:departments(name))')
    .eq('award_id', awardId).order('created_at')
  if (error) throw error
  return data || []
}

/* ═══ Employee-facing — "My Awards" / Self Feedback ═══════════════ */

export async function listMyParticipation(employeeId) {
  const { data, error } = await supabase.from('award_participants')
    .select('*, award:performance_awards(id,name,code,description,objective,start_date,end_date,evaluation_end_date,nomination_end_date,announcement_date,status,category:award_categories(name))')
    .eq('employee_id', employeeId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// "Pending feedback" = self_feedback step is enabled for the award AND
// this employee hasn't submitted yet. Two extra lookups (workflow steps,
// existing feedback rows) scoped to just this employee's award ids —
// cheap, and keeps the filtering logic out of the page component.
export async function getMyPendingSelfFeedback(employeeId) {
  const participation = await listMyParticipation(employeeId)
  const openAwardIds = participation.filter(p => ['active', 'evaluation'].includes(p.award?.status)).map(p => p.award_id)
  if (!openAwardIds.length) return []
  const [{ data: steps }, { data: feedbacks }] = await Promise.all([
    supabase.from('award_workflow_steps').select('award_id, is_enabled').eq('step_key', 'self_feedback').in('award_id', openAwardIds),
    supabase.from('award_self_feedback').select('award_id, status').eq('employee_id', employeeId).in('award_id', openAwardIds),
  ])
  const enabledSet = new Set((steps || []).filter(s => s.is_enabled).map(s => s.award_id))
  const submittedSet = new Set((feedbacks || []).filter(f => f.status === 'submitted').map(f => f.award_id))
  return participation.filter(p => enabledSet.has(p.award_id) && !submittedSet.has(p.award_id))
}

export async function getSelfFeedbackContext(awardId, employeeId) {
  const [{ data: award, error: awardErr }, questions, { data: feedback }] = await Promise.all([
    supabase.from('performance_awards').select('*, category:award_categories(name)').eq('id', awardId).single(),
    listQuestions(awardId, 'self_feedback'),
    supabase.from('award_self_feedback').select('*').eq('award_id', awardId).eq('employee_id', employeeId).maybeSingle(),
  ])
  if (awardErr) throw awardErr
  return { award, questions, feedback: feedback || null }
}

export async function upsertSelfFeedback(awardId, employeeId, answers, submit) {
  const payload = { award_id: awardId, employee_id: employeeId, answers }
  if (submit) {
    payload.status = 'submitted'
    payload.submitted_at = new Date().toISOString()
  }
  const { error } = await supabase.from('award_self_feedback').upsert(payload, { onConflict: 'award_id,employee_id' })
  if (error) throw error
}

/* ═══ Manager / Lead Feedback ═══════════════════════════════════ */

// One row per (award, employee) across every award the manager's direct
// reports are participating in — a table shaped like the spec's manager
// dashboard (§6: Employee | Award | Self Feedback | Manager Feedback |
// Status), built from award_participants + the per-award workflow-step
// config rather than a bespoke view.
export async function listTeamAwardParticipation(managerId, { allEmployees = false } = {}) {
  let repQuery = supabase.from('profiles').select('id,full_name,designation,dept:departments(name)')
  if (!allEmployees) repQuery = repQuery.eq('reporting_manager_id', managerId)
  const { data: reports, error: repErr } = await repQuery
  if (repErr) throw repErr
  const reportIds = reports.map(r => r.id)
  if (!reportIds.length) return []
  const reportById = new Map(reports.map(r => [r.id, r]))

  const { data: participants, error } = await supabase.from('award_participants')
    .select('*, award:performance_awards(id,name,status)').in('employee_id', reportIds)
  if (error) throw error
  const open = participants.filter(p => ['active', 'evaluation'].includes(p.award?.status))
  if (!open.length) return []

  const awardIds = [...new Set(open.map(p => p.award_id))]
  const [{ data: selfFeedbacks }, { data: managerFeedbacks }, { data: steps }] = await Promise.all([
    supabase.from('award_self_feedback').select('award_id,employee_id,status').in('award_id', awardIds).in('employee_id', reportIds),
    supabase.from('award_manager_feedback').select('award_id,employee_id,status,rating').in('award_id', awardIds).in('employee_id', reportIds),
    supabase.from('award_workflow_steps').select('award_id,step_key,is_enabled').in('award_id', awardIds),
  ])
  const selfMap = new Map((selfFeedbacks || []).map(f => [`${f.award_id}:${f.employee_id}`, f.status]))
  const mgrMap = new Map((managerFeedbacks || []).map(f => [`${f.award_id}:${f.employee_id}`, f]))
  const enabledStepsByAward = new Map()
  ;(steps || []).forEach(s => {
    if (!enabledStepsByAward.has(s.award_id)) enabledStepsByAward.set(s.award_id, new Set())
    if (s.is_enabled) enabledStepsByAward.get(s.award_id).add(s.step_key)
  })

  return open.map(p => {
    const key = `${p.award_id}:${p.employee_id}`
    const enabled = enabledStepsByAward.get(p.award_id) || new Set()
    return {
      ...p,
      employee: reportById.get(p.employee_id),
      selfFeedbackStatus: enabled.has('self_feedback') ? (selfMap.get(key) || 'pending') : 'not_required',
      managerFeedbackRequired: enabled.has('manager_feedback'),
      managerFeedback: mgrMap.get(key) || null,
    }
  })
}

export async function getManagerFeedbackContext(awardId, employeeId) {
  const [{ data: award, error: awardErr }, questions, { data: selfFeedback }, { data: feedback }, scoringConfig] = await Promise.all([
    supabase.from('performance_awards').select('*, category:award_categories(name)').eq('id', awardId).single(),
    listQuestions(awardId, 'manager_feedback'),
    supabase.from('award_self_feedback').select('*').eq('award_id', awardId).eq('employee_id', employeeId).maybeSingle(),
    supabase.from('award_manager_feedback').select('*').eq('award_id', awardId).eq('employee_id', employeeId).maybeSingle(),
    getScoringConfig(awardId),
  ])
  if (awardErr) throw awardErr
  const selfQuestions = await listQuestions(awardId, 'self_feedback')
  return {
    award, questions, ratingScale: scoringConfig.rating_scale,
    selfFeedback: selfFeedback || null, selfQuestions,
    feedback: feedback || null,
  }
}

export async function upsertManagerFeedback(awardId, employeeId, reviewerId, patch, submit) {
  const payload = { award_id: awardId, employee_id: employeeId, reviewer_id: reviewerId, ...patch }
  if (submit) {
    payload.status = 'submitted'
    payload.submitted_at = new Date().toISOString()
  }
  const { error } = await supabase.from('award_manager_feedback').upsert(payload, { onConflict: 'award_id,employee_id' })
  if (error) throw error
}

/* ═══ Peer / Colleague Nomination ═══════════════════════════════ */

export async function getNominationContext(awardId, employeeId) {
  const [{ data: award, error: awardErr }, { data: step }, questions, { data: myNominations }, { data: participants }] = await Promise.all([
    supabase.from('performance_awards').select('*, category:award_categories(name)').eq('id', awardId).single(),
    supabase.from('award_workflow_steps').select('config').eq('award_id', awardId).eq('step_key', 'peer_nomination').maybeSingle(),
    listQuestions(awardId, 'peer_nomination'),
    supabase.from('award_peer_nominations').select('*, nominee:profiles!nominee_id(full_name)').eq('award_id', awardId).eq('nominator_id', employeeId).order('created_at', { ascending: false }),
    supabase.from('award_participants').select('employee_id, employee:profiles!employee_id(id,full_name,designation)').eq('award_id', awardId),
  ])
  if (awardErr) throw awardErr
  return {
    award, questions, config: step?.config || {},
    myNominations: myNominations || [],
    peers: (participants || []).map(p => p.employee).filter(Boolean),
  }
}

// Re-fetches the step config itself (rather than trusting a value the
// caller already has) so self-nomination/anonymity/max-count rules are
// always checked against what HR currently has configured.
export async function submitNomination(awardId, nominatorId, { nomineeId, reason, comments, evidence, answers, isAnonymous }) {
  const [{ data: step }, { data: award }] = await Promise.all([
    supabase.from('award_workflow_steps').select('config').eq('award_id', awardId).eq('step_key', 'peer_nomination').maybeSingle(),
    supabase.from('performance_awards').select('nomination_start_date, nomination_end_date').eq('id', awardId).single(),
  ])
  const config = step?.config || {}
  const today = new Date().toISOString().slice(0, 10)
  if (award?.nomination_start_date && today < award.nomination_start_date) throw new Error('The nomination window for this award has not opened yet.')
  if (award?.nomination_end_date && today > award.nomination_end_date) throw new Error('The nomination window for this award has closed.')
  if (!config.allow_self_nomination && nomineeId === nominatorId) throw new Error('Self-nomination is not allowed for this award.')
  if (config.max_nominations_per_employee) {
    const { count, error: countErr } = await supabase.from('award_peer_nominations').select('id', { count: 'exact', head: true }).eq('award_id', awardId).eq('nominator_id', nominatorId)
    if (countErr) throw countErr
    if (count >= config.max_nominations_per_employee) throw new Error(`You've already made the maximum of ${config.max_nominations_per_employee} nomination(s) for this award.`)
  }
  const { error } = await supabase.from('award_peer_nominations').insert({
    award_id: awardId, nominator_id: nominatorId, nominee_id: nomineeId, reason, comments, evidence,
    answers: answers || {}, is_anonymous: !!(config.allow_anonymous_nomination && isAnonymous),
  })
  if (error) {
    if (error.code === '23505') throw new Error('You have already nominated this colleague for this award.')
    throw error
  }
}

// Redacted read via the SECURITY DEFINER RPC (STEP118) — the nominee/
// their manager never see the base table directly, so anonymity is
// enforced even if a screen forgets to hide the field itself.
export async function getPeerNominationsForNominee(awardId, nomineeId) {
  const { data, error } = await supabase.rpc('get_award_peer_nominations', { p_award_id: awardId, p_nominee_id: nomineeId })
  if (error) throw error
  return data || []
}

export async function getMyNominationAwards(employeeId) {
  const participation = await listMyParticipation(employeeId)
  const openAwardIds = participation.filter(p => ['active', 'evaluation'].includes(p.award?.status)).map(p => p.award_id)
  if (!openAwardIds.length) return []
  const { data: steps } = await supabase.from('award_workflow_steps').select('award_id, is_enabled').eq('step_key', 'peer_nomination').in('award_id', openAwardIds)
  const enabledIds = new Set((steps || []).filter(s => s.is_enabled).map(s => s.award_id))
  return participation.filter(p => enabledIds.has(p.award_id))
}

/* ═══ Scoring Engine ══════════════════════════════════════════════
 * Self/Manager scores are the average of that step's numeric "rating"
 * answers, rescaled from the award's configured rating_scale max value
 * onto 0-100. Peer score has no numeric rating in the nomination form
 * (spec's nomination fields are reason/comments/evidence, not a 1-5
 * score) — computed instead as this employee's nomination count
 * relative to the most-nominated participant in the same award
 * ((count / max count) * 100), a documented choice rather than a hidden
 * default, since the spec doesn't define a nomination rating mechanism.
 * Performance score is read straight from the existing performance
 * module's cached composite_score (STEP66) — never recomputed here. ═══ */

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100 }

// Ties that survive every configured tie-break key (identical on all of
// them, not just the final score) share the same rank.
function rankParticipants(rows, tieBreakOrder) {
  const sorted = [...rows].sort((a, b) => {
    if (b.final_score !== a.final_score) return b.final_score - a.final_score
    for (const key of tieBreakOrder) {
      if (b[key] !== a[key]) return (b[key] || 0) - (a[key] || 0)
    }
    return 0
  })
  let rank = 0
  return sorted.map((r, i) => {
    const tiedWithPrev = i > 0 && sorted[i - 1].final_score === r.final_score && tieBreakOrder.every(key => sorted[i - 1][key] === r[key])
    if (!tiedWithPrev) rank = i + 1
    return { ...r, rank }
  })
}

export async function computeScoresForAward(awardId) {
  const [participants, scoringConfig, selfQuestions] = await Promise.all([
    listParticipants(awardId),
    getScoringConfig(awardId),
    listQuestions(awardId, 'self_feedback'),
  ])
  if (!participants.length) return { scored: 0 }
  const employeeIds = participants.map(p => p.employee_id)
  const ratingQuestionIds = new Set(selfQuestions.filter(q => q.question_type === 'rating').map(q => q.id))
  const maxRating = Math.max(...(scoringConfig.rating_scale || []).map(r => Number(r.value)), 1)

  const [{ data: selfFeedbacks }, { data: managerFeedbacks }, { data: nominations }, { data: perfScores }] = await Promise.all([
    supabase.from('award_self_feedback').select('employee_id, answers').eq('award_id', awardId).in('employee_id', employeeIds),
    supabase.from('award_manager_feedback').select('employee_id, rating').eq('award_id', awardId).in('employee_id', employeeIds),
    supabase.from('award_peer_nominations').select('nominee_id').eq('award_id', awardId).in('nominee_id', employeeIds),
    supabase.from('performance_scores').select('employee_id, composite_score, computed_at').in('employee_id', employeeIds).order('computed_at', { ascending: false }),
  ])

  const selfByEmployee = new Map((selfFeedbacks || []).map(f => [f.employee_id, f.answers || {}]))
  const managerByEmployee = new Map((managerFeedbacks || []).map(f => [f.employee_id, f.rating]))
  const nominationCounts = new Map()
  ;(nominations || []).forEach(n => nominationCounts.set(n.nominee_id, (nominationCounts.get(n.nominee_id) || 0) + 1))
  const maxNominations = Math.max(0, ...nominationCounts.values())
  const perfByEmployee = new Map()
  ;(perfScores || []).forEach(s => { if (!perfByEmployee.has(s.employee_id)) perfByEmployee.set(s.employee_id, s.composite_score) })

  const weights = {
    self: Number(scoringConfig.self_feedback_weight) || 0, manager: Number(scoringConfig.manager_feedback_weight) || 0,
    peer: Number(scoringConfig.peer_feedback_weight) || 0, performance: Number(scoringConfig.performance_weight) || 0,
  }

  const rows = participants.map(p => {
    const answers = selfByEmployee.get(p.employee_id) || {}
    const ratingAnswers = [...ratingQuestionIds].map(qid => Number(answers[qid])).filter(v => Number.isFinite(v))
    const selfScore = ratingAnswers.length ? (ratingAnswers.reduce((s, v) => s + v, 0) / ratingAnswers.length / maxRating) * 100 : 0
    const managerRating = managerByEmployee.get(p.employee_id)
    const managerScore = managerRating != null ? (Number(managerRating) / maxRating) * 100 : 0
    const nomCount = nominationCounts.get(p.employee_id) || 0
    const peerScore = maxNominations > 0 ? (nomCount / maxNominations) * 100 : 0
    const performanceScore = Number(perfByEmployee.get(p.employee_id)) || 0
    const finalScore = (selfScore * weights.self + managerScore * weights.manager + peerScore * weights.peer + performanceScore * weights.performance) / 100
    return {
      employee_id: p.employee_id,
      self_score: round2(selfScore), manager_score: round2(managerScore), peer_score: round2(peerScore),
      performance_score: round2(performanceScore), final_score: round2(finalScore),
    }
  })

  const ranked = rankParticipants(rows, scoringConfig.tie_break_order || DEFAULT_TIE_BREAK_ORDER)
  const thresholds = [...(scoringConfig.recommendation_thresholds || DEFAULT_RECOMMENDATION_THRESHOLDS)].sort((a, b) => b.min_score - a.min_score)

  const { error: scoresErr } = await supabase.from('award_scores').upsert(
    ranked.map(r => ({
      award_id: awardId, employee_id: r.employee_id, self_score: r.self_score, manager_score: r.manager_score,
      peer_score: r.peer_score, performance_score: r.performance_score, final_score: r.final_score,
      weights_snapshot: weights,
    })),
    { onConflict: 'award_id,employee_id' }
  )
  if (scoresErr) throw scoresErr

  await Promise.all(ranked.map(r => {
    const recommendation = thresholds.find(t => r.final_score >= Number(t.min_score))?.label || null
    return supabase.from('award_participants').update({
      final_score: r.final_score, rank: r.rank, recommendation_label: recommendation, status: 'recommended',
    }).eq('award_id', awardId).eq('employee_id', r.employee_id)
  }))

  return { scored: ranked.length }
}

export async function getAwardRecommendations(awardId) {
  const [participants, { data: scores }] = await Promise.all([
    listParticipants(awardId),
    supabase.from('award_scores').select('*').eq('award_id', awardId),
  ])
  const scoreByEmployee = new Map((scores || []).map(s => [s.employee_id, s]))
  return participants
    .map(p => ({ ...p, scoreDetail: scoreByEmployee.get(p.employee_id) || null }))
    .sort((a, b) => (a.rank || 999999) - (b.rank || 999999))
}

/* ═══ Manager Final Decision — Approve & Grant / Reject / Request Review ═══ */

export async function getApprovalQueue(managerId, { allEmployees = false } = {}) {
  let repQuery = supabase.from('profiles').select('id,full_name,designation,dept:departments(name)')
  if (!allEmployees) repQuery = repQuery.eq('reporting_manager_id', managerId)
  const { data: reports, error: repErr } = await repQuery
  if (repErr) throw repErr
  const reportIds = reports.map(r => r.id)
  if (!reportIds.length) return []
  const reportById = new Map(reports.map(r => [r.id, r]))

  const { data: participants, error } = await supabase.from('award_participants')
    .select('*, award:performance_awards(id,name,category:award_categories(name))')
    .in('employee_id', reportIds).in('status', ['recommended', 'review_requested'])
  if (error) throw error
  if (!participants.length) return []

  const awardIds = [...new Set(participants.map(p => p.award_id))]
  const { data: scores } = await supabase.from('award_scores').select('*').in('award_id', awardIds).in('employee_id', reportIds)
  const scoreByKey = new Map((scores || []).map(s => [`${s.award_id}:${s.employee_id}`, s]))

  return participants.map(p => ({
    ...p, employee: reportById.get(p.employee_id), scoreDetail: scoreByKey.get(`${p.award_id}:${p.employee_id}`) || null,
  }))
}

export async function decideAward(awardId, employeeId, managerId, { decision, comments, awardDate }) {
  const { data: participant } = await supabase.from('award_participants').select('final_score').eq('award_id', awardId).eq('employee_id', employeeId).single()
  const payload = {
    award_id: awardId, employee_id: employeeId, decided_by: managerId, decision,
    final_score: participant?.final_score ?? null, comments: comments || null,
    award_date: decision === 'granted' ? (awardDate || new Date().toISOString().slice(0, 10)) : null,
    decided_at: new Date().toISOString(),
  }
  const { error: approvalErr } = await supabase.from('award_approvals').upsert(payload, { onConflict: 'award_id,employee_id' })
  if (approvalErr) throw approvalErr

  const newStatus = decision === 'granted' ? 'granted' : decision === 'rejected' ? 'not_selected' : 'review_requested'
  const { error: statusErr } = await supabase.from('award_participants').update({ status: newStatus }).eq('award_id', awardId).eq('employee_id', employeeId)
  if (statusErr) throw statusErr

  if (decision === 'granted') {
    const { data: award } = await supabase.from('performance_awards').select('name').eq('id', awardId).single()
    await sendNotif(employeeId, {
      type: 'award_granted',
      title: `Congratulations! You've been awarded "${award?.name}"`,
      body: 'Check My Awards to view your award.',
      link: '/my-awards',
      senderId: managerId,
    })
    // Best-effort: a missing/unpublished certificate template must never
    // block the grant itself, which has already been recorded above.
    try { await generateCertificate(awardId, employeeId, managerId) }
    catch (e) { console.error('[awards:generateCertificate]', e) }
  }
}

// Awarded-by / award-date detail for the employee-facing "My Awards"
// history view — approvals the employee themself is allowed to read
// under award_approvals' RLS (their own rows only).
export async function getMyApprovals(employeeId) {
  const { data, error } = await supabase.from('award_approvals')
    .select('*, decided_by_profile:profiles!decided_by(full_name)').eq('employee_id', employeeId)
  if (error) throw error
  return data || []
}
