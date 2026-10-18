import { supabase } from './supabase'

// Organization onboarding — every step's "done" state is DERIVED live
// from data that already exists, not tracked in a separate checklist
// table (see STEP126's header comment for why: a stateful tracker can
// drift from reality; this can't).
export async function computeOnboardingStatus(orgId) {
  const [{ data: org }, deptRes, adminRes, employeeRes, managedRes, cycleRes, awardRes] = await Promise.all([
    supabase.from('organizations').select('*').eq('id', orgId).single(),
    supabase.from('departments').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).in('role', ['admin', 'hr', 'finance', 'ceo']),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).not('reporting_manager_id', 'is', null),
    supabase.from('performance_cycles').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
    supabase.from('performance_awards').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
  ])

  const counts = {
    departments: deptRes.count || 0,
    admins: adminRes.count || 0,
    employees: employeeRes.count || 0,
    managed: managedRes.count || 0,
    cycles: cycleRes.count || 0,
    awards: awardRes.count || 0,
  }

  const steps = [
    { id: 'profile', label: 'Organization Profile', done: !!(org?.industry && org?.country) },
    { id: 'structure', label: 'Departments', done: counts.departments > 0 },
    { id: 'admins', label: 'Admins Invited', done: counts.admins >= 2 },
    { id: 'employees', label: 'Employees Added', done: counts.employees > 1 },
    { id: 'hierarchy', label: 'Manager Hierarchy', done: counts.managed > 0 },
    { id: 'performance', label: 'Performance / Award Configuration', done: counts.cycles > 0 || counts.awards > 0 },
  ]

  return { org, steps, counts, doneCount: steps.filter(s => s.done).length, total: steps.length, allDone: steps.every(s => s.done) }
}

export async function updateOrgProfile(patch) {
  const { error } = await supabase.rpc('update_org_profile', {
    p_name: patch.name ?? null, p_industry: patch.industry ?? null, p_country: patch.country ?? null,
    p_timezone: patch.timezone ?? null, p_currency: patch.currency ?? null, p_address: patch.address ?? null, p_logo: patch.logo ?? null,
    p_company_size: patch.companySize ?? null,
  })
  if (error) throw error
}

export async function listDepartments(orgId) {
  const { data, error } = await supabase.from('departments').select('*').eq('organization_id', orgId).order('name')
  if (error) throw error
  return data || []
}

export async function createDepartment(orgId, name, code) {
  const { error } = await supabase.from('departments').insert({ organization_id: orgId, name, code: code || null })
  if (error) throw error
}

export async function updateDepartment(id, name, code) {
  const { error } = await supabase.from('departments').update({ name, code: code || null }).eq('id', id)
  if (error) throw error
}

export async function deleteDepartment(id) {
  const { error } = await supabase.from('departments').delete().eq('id', id)
  if (error) throw error
}

export async function listOrgAdmins(orgId) {
  const { data, error } = await supabase.from('profiles').select('id,full_name,email,role').eq('organization_id', orgId).in('role', ['admin', 'hr', 'finance', 'ceo'])
  if (error) throw error
  return data || []
}
