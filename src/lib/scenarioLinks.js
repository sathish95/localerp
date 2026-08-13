import { supabase } from './supabase'

// Universal Link Picker (Phase 6) — every table/column below was
// verified directly against existing usage in this codebase before
// writing this file (grep across src/pages, src/lib) rather than
// assumed. 'contract' is intentionally NOT included: this app has no
// contracts table anywhere — inventing one here would mean the picker
// silently returns nothing forever. Wire it in once that module exists.
export const LINKABLE_TYPES = [
  { key: 'project', label: 'Projects' },
  { key: 'customer', label: 'Customers' },
  { key: 'task', label: 'Tasks' },
  { key: 'budget', label: 'Budgets' },
  { key: 'employee', label: 'Employees' },
  { key: 'resource', label: 'Resources' }, // same table as employee — this app has no distinct "resource" entity, see ResourcePage.jsx
  { key: 'vendor', label: 'Vendors' },
  { key: 'sales_opportunity', label: 'Sales Opportunities' },
]

async function searchProjects(q) {
  let query = supabase.from('projects').select('id, name, code, status, budget').order('name').limit(20)
  if (q) query = query.ilike('name', `%${q}%`)
  const { data, error } = await query
  if (error) throw error
  return (data || []).map(r => ({ id: r.id, label: r.name, sublabel: `${r.code || ''} · ${r.status}`.trim(), amount: r.budget }))
}
async function searchCustomers(q) {
  let query = supabase.from('customers').select('id, name, city').eq('status', 'active').order('name').limit(20)
  if (q) query = query.ilike('name', `%${q}%`)
  const { data, error } = await query
  if (error) throw error
  return (data || []).map(r => ({ id: r.id, label: r.name, sublabel: r.city || '' }))
}
async function searchTasks(q) {
  let query = supabase.from('project_tasks').select('id, task_name, status, project:projects(name)').order('task_name').limit(20)
  if (q) query = query.ilike('task_name', `%${q}%`)
  const { data, error } = await query
  if (error) throw error
  return (data || []).map(r => ({ id: r.id, label: r.task_name, sublabel: `${r.project?.name || ''} · ${r.status}` }))
}
async function searchBudgets(q) {
  let query = supabase.from('budgets').select('id, category, fiscal_year, allocated, project:projects(name)').order('fiscal_year', { ascending: false }).limit(20)
  if (q) query = query.ilike('category', `%${q}%`)
  const { data, error } = await query
  if (error) throw error
  return (data || []).map(r => ({ id: r.id, label: `${r.category} (${r.fiscal_year})`, sublabel: r.project?.name || '', amount: r.allocated }))
}
async function searchEmployees(q) {
  let query = supabase.from('profiles').select('id, full_name, role, is_active').eq('is_active', true).order('full_name').limit(20)
  if (q) query = query.ilike('full_name', `%${q}%`)
  const { data, error } = await query
  if (error) throw error
  return (data || []).map(r => ({ id: r.id, label: r.full_name, sublabel: r.role }))
}
async function searchVendors(q) {
  let query = supabase.from('vendors').select('id, name, category').eq('status', 'active').order('name').limit(20)
  if (q) query = query.ilike('name', `%${q}%`)
  const { data, error } = await query
  if (error) throw error
  return (data || []).map(r => ({ id: r.id, label: r.name, sublabel: r.category || '' }))
}
async function searchSalesOpportunities(q) {
  let query = supabase.from('sales_opportunities').select('id, opportunity_number, domain, expected_value, status').order('created_at', { ascending: false }).limit(20)
  if (q) query = query.ilike('opportunity_number', `%${q}%`)
  const { data, error } = await query
  if (error) throw error
  return (data || []).map(r => ({ id: r.id, label: r.opportunity_number, sublabel: `${r.domain} · ${r.status}`, amount: r.expected_value }))
}

const SEARCHERS = {
  project: searchProjects, customer: searchCustomers, task: searchTasks, budget: searchBudgets,
  employee: searchEmployees, resource: searchEmployees, vendor: searchVendors, sales_opportunity: searchSalesOpportunities,
}

export async function searchLinkable(type, query) {
  const fn = SEARCHERS[type]
  if (!fn) return []
  return fn(query)
}

/* ═══ scenario_links CRUD ═══ */

export async function listLinks(versionId) {
  const { data, error } = await supabase.from('scenario_links').select('*').eq('scenario_version_id', versionId).order('created_at')
  if (error) throw error
  return data || []
}

export async function addLink(versionId, { linkedType, linkedId, linkMode, snapshot }) {
  const { error } = await supabase.from('scenario_links').insert({
    scenario_version_id: versionId, linked_type: linkedType, linked_id: linkedId,
    link_mode: linkMode || 'live', snapshot: snapshot || null,
  })
  if (error) throw error
}

export async function removeLink(id) {
  const { error } = await supabase.from('scenario_links').delete().eq('id', id)
  if (error) throw error
}
