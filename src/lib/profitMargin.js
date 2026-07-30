import { supabase } from './supabase'
import { getActualCostSnapshot, recomputeForProject } from './actualCost'

// Client-side mirror of the STEP35 RLS policy — RLS is the real enforcement;
// this constant only avoids attempting a query for roles that would get 0 rows
// back anyway.
export const MARGIN_VISIBLE_ROLES = ['admin', 'ceo', 'finance']

export async function recomputeMargin(projectId, profileId) {
  await recomputeForProject(projectId)
  const [ac, { data: invoices }] = await Promise.all([
    getActualCostSnapshot(projectId),
    supabase.from('customer_invoices').select('total_amount,status').eq('project_id', projectId).in('status', ['sent', 'partially_paid', 'paid']),
  ])
  const revenue = (invoices || []).reduce((s, i) => s + Number(i.total_amount || 0), 0)
  const cost = ac?.total_actual_cost || 0
  const margin = revenue - cost
  const marginPct = revenue > 0 ? Math.round((margin / revenue) * 10000) / 100 : 0
  await supabase.from('profit_margins').upsert({
    project_id: projectId, period_key: 'ALL',
    revenue_recognized: revenue, total_actual_cost: cost, gross_margin: margin, margin_percent: marginPct,
    computed_at: new Date().toISOString(), computed_by: profileId,
  }, { onConflict: 'project_id,period_key' })
}

export async function recomputeAllMargins(profileId) {
  const { data: projects } = await supabase.from('projects').select('id').eq('status', 'active')
  for (const p of projects || []) {
    await recomputeMargin(p.id, profileId)
  }
}

// Returns null both when no row exists AND when RLS blocks the caller — same
// graceful empty state either way, by design.
export async function getMargin(projectId) {
  const { data } = await supabase.from('profit_margins').select('*').eq('project_id', projectId).eq('period_key', 'ALL').maybeSingle()
  return data
}

export async function getAllMargins() {
  const { data } = await supabase.from('profit_margins').select('*,project:projects(name,department_id)').order('margin_percent', { ascending: true })
  return data || []
}
