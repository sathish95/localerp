import { supabase } from './supabase'
import { resolveHourlyRate } from './actualCost'

// Activity Planner (STEP234): field activities such as installations laid
// out on a calendar, each carrying the resources involved (days × rate per
// day × quantity), other cost lines, and the number of days required.

export const ACTIVITY_TYPES = ['Installation', 'Commissioning', 'Maintenance', 'Site Survey', 'Training', 'Delivery', 'Demo', 'Other']
export const ACTIVITY_STATUSES = [
  { key: 'planned', label: 'Planned' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
]
export const RESOURCE_TYPES = [
  { key: 'person', label: 'Person' },
  { key: 'equipment', label: 'Equipment' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'subcontractor', label: 'Subcontractor' },
]
export const COST_CATEGORIES = ['Travel', 'Accommodation', 'Material', 'Equipment Hire', 'Subcontract', 'Food & Allowance', 'Other']

// One flat colour per activity type (calendar chips / legend).
export const TYPE_COLORS = {
  Installation: '#6366f1', Commissioning: '#0891b2', Maintenance: '#d97706', 'Site Survey': '#059669',
  Training: '#7c3aed', Delivery: '#db2777', Demo: '#2563eb', Other: '#64748b',
}

// Working days between two ISO dates, inclusive, skipping Sundays.
export function workingDays(start, end) {
  if (!start || !end || end < start) return 0
  let n = 0
  for (let d = new Date(`${start}T00:00:00`); d <= new Date(`${end}T00:00:00`); d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0) n++
  }
  return n
}

export const resourceCost = r => Number(r.days || 0) * Number(r.rate_per_day || 0) * Number(r.quantity || 1)

export function activityTotals(a) {
  const resources = a.resources || []
  const costs = a.costs || []
  const resourceTotal = resources.reduce((s, r) => s + resourceCost(r), 0)
  const otherTotal = costs.reduce((s, c) => s + Number(c.amount || 0), 0)
  return {
    resourceTotal,
    otherTotal,
    total: resourceTotal + otherTotal,
    people: resources.filter(r => r.resource_type === 'person').reduce((s, r) => s + Number(r.quantity || 1), 0),
    manDays: resources.filter(r => r.resource_type === 'person').reduce((s, r) => s + Number(r.days || 0) * Number(r.quantity || 1), 0),
  }
}

// Activities overlapping [from, to] (ISO dates), with resources and costs.
export async function listActivities({ from, to } = {}) {
  let q = supabase.from('planned_activities')
    .select('*, resources:planned_activity_resources(*), costs:planned_activity_costs(*)')
    .order('start_date')
  if (to) q = q.lte('start_date', to)
  if (from) q = q.gte('end_date', from)
  const { data, error } = await q
  if (error) throw error
  return (data || []).map(a => ({
    ...a,
    resources: (a.resources || []).sort((x, y) => x.sort_order - y.sort_order),
    costs: (a.costs || []).sort((x, y) => x.sort_order - y.sort_order),
  }))
}

// Saves the activity and replaces its resource/cost lines.
export async function saveActivity(activity, resources, costs) {
  const row = {
    title: activity.title.trim(),
    activity_type: activity.activity_type,
    project_id: activity.project_id || null,
    customer_id: activity.customer_id || null,
    location: activity.location || null,
    start_date: activity.start_date,
    end_date: activity.end_date,
    days_required: Number(activity.days_required || 0),
    status: activity.status,
    owner_id: activity.owner_id || null,
    notes: activity.notes || null,
    updated_at: new Date().toISOString(),
  }
  let id = activity.id
  if (id) {
    const { error } = await supabase.from('planned_activities').update(row).eq('id', id)
    if (error) throw error
  } else {
    const { data, error } = await supabase.from('planned_activities').insert(row).select('id').single()
    if (error) throw error
    id = data.id
  }

  const [delR, delC] = await Promise.all([
    supabase.from('planned_activity_resources').delete().eq('activity_id', id),
    supabase.from('planned_activity_costs').delete().eq('activity_id', id),
  ])
  if (delR.error) throw delR.error
  if (delC.error) throw delC.error

  const resRows = resources.filter(r => (r.name || '').trim()).map((r, i) => ({
    activity_id: id,
    resource_type: r.resource_type,
    person_id: r.resource_type === 'person' ? r.person_id || null : null,
    name: r.name.trim(),
    role: r.role || null,
    quantity: Number(r.quantity || 1),
    days: Number(r.days || 0),
    rate_per_day: Number(r.rate_per_day || 0),
    sort_order: i,
  }))
  const costRows = costs.filter(c => Number(c.amount) || (c.description || '').trim()).map((c, i) => ({
    activity_id: id,
    category: c.category,
    description: c.description || null,
    amount: Number(c.amount || 0),
    sort_order: i,
  }))
  const [insR, insC] = await Promise.all([
    resRows.length ? supabase.from('planned_activity_resources').insert(resRows) : { error: null },
    costRows.length ? supabase.from('planned_activity_costs').insert(costRows) : { error: null },
  ])
  if (insR.error) throw insR.error
  if (insC.error) throw insC.error
  return id
}

export async function deleteActivity(id) {
  const { error } = await supabase.from('planned_activities').delete().eq('id', id)
  if (error) throw error
}

// Lookups for the editor: people with a suggested day rate (role_rates for
// their designation, else their resource_rates row — same chain as
// actualCost.js — × 8 hours), plus projects and customers.
export async function loadPlannerLookups() {
  const [{ data: people }, { data: projects }, { data: customers }] = await Promise.all([
    supabase.from('profiles').select('id,full_name,designation,is_active').order('full_name'),
    supabase.from('projects').select('id,name').order('name'),
    supabase.from('customers').select('id,name').order('name'),
  ])
  const active = (people || []).filter(p => p.is_active !== false)
  const designations = [...new Set(active.map(p => p.designation).filter(Boolean))]
  const [{ data: roleRates }, { data: resourceRates }] = await Promise.all([
    designations.length ? supabase.from('role_rates').select('*').in('designation', designations) : Promise.resolve({ data: [] }),
    supabase.from('resource_rates').select('employee_id,hourly_rate,monthly_salary'),
  ])
  return {
    people: active.map(p => ({
      ...p,
      day_rate: Math.round(resolveHourlyRate({ designation: p.designation, employeeId: p.id, roleRates, resourceRates }) * 8),
    })),
    projects: projects || [],
    customers: customers || [],
  }
}

// People booked on two or more overlapping, non-cancelled activities.
// Returns Map<activityId, [{ name, otherTitle }]>.
export function findConflicts(activities) {
  const live = activities.filter(a => a.status !== 'cancelled')
  const out = new Map()
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j]
      if (a.start_date > b.end_date || b.start_date > a.end_date) continue
      const bPeople = new Map((b.resources || []).filter(r => r.person_id).map(r => [r.person_id, r.name]))
      for (const r of a.resources || []) {
        if (!r.person_id || !bPeople.has(r.person_id)) continue
        ;(out.get(a.id) || out.set(a.id, []).get(a.id)).push({ name: r.name, otherTitle: b.title })
        ;(out.get(b.id) || out.set(b.id, []).get(b.id)).push({ name: r.name, otherTitle: a.title })
      }
    }
  }
  return out
}
