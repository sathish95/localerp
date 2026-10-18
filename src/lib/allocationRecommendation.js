import { supabase } from './supabase'

// Industry-Adaptive Platform Phase 10 — deterministic allocation scoring.
// Per the master prompt: "do not overbuild predictive AI... make the data
// model ready" — this is plain arithmetic over data Phases 4/6 already
// made queryable, NOT an LLM call. Pure read + compute, zero side effects,
// zero writes. Every score comes with a human-readable reason string
// (the "explainable" requirement) rather than a bare number.
//
// Location-based scoring (master prompt: "works at/near the task's
// location") is intentionally NOT implemented — there is no existing
// column linking a person to a home/base location anywhere in this
// schema (Phase 6's `locations` table is a place, not a person
// attribute). Adding one is a real, separate, future migration decision,
// not something to slip into a scoring-function pass. `locationId` is
// accepted as a parameter for forward compatibility but currently unused.
const WEIGHTS = { skillMatch: 3, onShiftToday: 2, workloadMax: 2 }

/**
 * @param {object} opts
 * @param {string} [opts.skillHint] - free-text skill name to match against employee_skills/skills.skill_name
 * @param {string} [opts.locationId] - accepted, currently unused (see header)
 * @param {{id:string,full_name:string,role:string}[]} [opts.candidates] - pass a pre-fetched pool (e.g. a team) instead of the whole org
 * @returns {Promise<{person:object, score:number, explanation:string}[]>} top 5, highest score first
 */
export async function suggestAssignees({ skillHint = '', locationId = null, candidates = null } = {}) {
  let people = candidates
  if (!people) {
    const { data, error } = await supabase.from('profiles').select('id,full_name,role').neq('is_active', false)
    if (error) throw error
    people = data || []
  }
  if (!people.length) return []

  const ids = people.map(p => p.id)
  const today = new Date().toISOString().split('T')[0]

  const [skillsRes, shiftsRes, tasksRes] = await Promise.all([
    skillHint.trim()
      ? supabase.from('employee_skills').select('employee_id,proficiency_level,skills(skill_name)').in('employee_id', ids)
      : Promise.resolve({ data: [] }),
    supabase.from('person_shift_assignments').select('person_id,effective_from,effective_to').in('person_id', ids).lte('effective_from', today),
    supabase.from('project_tasks').select('assigned_to').in('assigned_to', ids).neq('status', 'closed'),
  ])

  const workloadByPerson = {}
  for (const t of tasksRes.data || []) {
    if (!t.assigned_to) continue
    workloadByPerson[t.assigned_to] = (workloadByPerson[t.assigned_to] || 0) + 1
  }

  const onShiftToday = new Set(
    (shiftsRes.data || [])
      .filter(s => !s.effective_to || s.effective_to >= today)
      .map(s => s.person_id)
  )

  const skillMatchByPerson = {}
  if (skillHint.trim()) {
    const needle = skillHint.trim().toLowerCase()
    for (const s of skillsRes.data || []) {
      const name = (s.skills?.skill_name || '').toLowerCase()
      if (name.includes(needle)) skillMatchByPerson[s.employee_id] = { level: s.proficiency_level, name: s.skills?.skill_name }
    }
  }

  const scored = people.map(p => {
    let score = 0
    const reasons = []

    const match = skillMatchByPerson[p.id]
    if (match) { score += WEIGHTS.skillMatch; reasons.push(`${match.level} in ${match.name}`) }

    if (onShiftToday.has(p.id)) { score += WEIGHTS.onShiftToday; reasons.push('on shift today') }

    const openCount = workloadByPerson[p.id] || 0
    // Fewer open tasks = higher workload-balancing score, floored at 0.
    score += Math.max(0, WEIGHTS.workloadMax - openCount * 0.5)
    reasons.push(`${openCount} open task${openCount === 1 ? '' : 's'}`)

    return { person: p, score: Math.round(score * 10) / 10, explanation: reasons.join(', ') }
  })

  return scored.sort((a, b) => b.score - a.score).slice(0, 5)
}
