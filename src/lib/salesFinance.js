import { supabase } from './supabase'
import { getConfigFlag } from './salesAdmin'

// Part 4 — Finance integration. Both rollup tables are cached snapshots,
// recomputed by explicit calls after the relevant mutation (never live on
// every dashboard request), same pattern as src/lib/profitMargin.js's
// recomputeMargin(). sales_profit_attribution reads profit_margins
// directly — no new profit-computation logic, just attribution.

// sales_revenue_forecast has a nullable-dimension UNIQUE index (region_id/
// domain/sales_rep_id can each be null to represent a broader rollup
// grain) that Postgres enforces via a COALESCE'd expression index — that
// shape isn't compatible with supabase-js's upsert(onConflict=...)
// shorthand (which needs a plain-column unique constraint), so this does
// a manual find-then-update-or-insert instead.
async function upsertForecastRow({ region_id, domain, sales_rep_id, period_key = 'ALL' }, totals) {
  let q = supabase.from('sales_revenue_forecast').select('id').eq('period_key', period_key)
  q = region_id ? q.eq('region_id', region_id) : q.is('region_id', null)
  q = domain ? q.eq('domain', domain) : q.is('domain', null)
  q = sales_rep_id ? q.eq('sales_rep_id', sales_rep_id) : q.is('sales_rep_id', null)
  const { data: existing } = await q.maybeSingle()

  const row = { region_id: region_id || null, domain: domain || null, sales_rep_id: sales_rep_id || null, period_key, ...totals, computed_at: new Date().toISOString() }
  if (existing) {
    const { error } = await supabase.from('sales_revenue_forecast').update(row).eq('id', existing.id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('sales_revenue_forecast').insert(row)
    if (error) throw error
  }
}

async function computeTotals(filters) {
  let q = supabase.from('sales_opportunities').select('status,expected_value,probability_percent')
  if (filters.region_id) q = q.eq('region_id', filters.region_id)
  if (filters.domain) q = q.eq('domain', filters.domain)
  if (filters.sales_rep_id) q = q.eq('assigned_rep_id', filters.sales_rep_id)
  const { data } = await q
  const rows = data || []
  return {
    pipeline_value: rows.filter(r => r.status === 'Open').reduce((s, r) => s + Number(r.expected_value || 0), 0),
    weighted_forecast: rows.filter(r => r.status === 'Open').reduce((s, r) => s + Number(r.expected_value || 0) * (Number(r.probability_percent || 0) / 100), 0),
    closed_won_value: rows.filter(r => r.status === 'Won').reduce((s, r) => s + Number(r.expected_value || 0), 0),
    closed_lost_value: rows.filter(r => r.status === 'Lost').reduce((s, r) => s + Number(r.expected_value || 0), 0),
  }
}

// Recomputes the affected rollup rows after an Opportunity mutation, at
// four drill-down grains: exact (rep+domain+region), region+domain,
// domain-only (company-wide by domain), and company-wide total.
export async function recomputeSalesRevenueForecast({ region, domain, repId } = {}) {
  const grains = [
    { region_id: region, domain, sales_rep_id: repId },
    { region_id: region, domain, sales_rep_id: null },
    { region_id: null, domain, sales_rep_id: null },
    { region_id: null, domain: null, sales_rep_id: null },
  ]
  const seen = new Set()
  for (const g of grains) {
    const key = `${g.region_id}|${g.domain}|${g.sales_rep_id}`
    if (seen.has(key)) continue
    seen.add(key)
    await upsertForecastRow(g, await computeTotals(g))
  }
}

export async function getRevenueForecast({ regionId, domain, repId } = {}) {
  let q = supabase.from('sales_revenue_forecast').select('*').eq('period_key', 'ALL')
  q = regionId ? q.eq('region_id', regionId) : q.is('region_id', null)
  q = domain ? q.eq('domain', domain) : q.is('domain', null)
  q = repId ? q.eq('sales_rep_id', repId) : q.is('sales_rep_id', null)
  const { data } = await q.maybeSingle()
  return data
}

// Reverse lookup: project -> proposal -> opportunity. Used by
// ProjectsPage.jsx's finance recompute so it can call
// recomputeSalesProfitAttribution() right alongside recomputeMargin(),
// only when this project actually originated from the Sales CRM.
export async function findOpportunityForProject(projectId) {
  const { data: proposal } = await supabase.from('proposals').select('id').eq('linked_project_id', projectId).maybeSingle()
  if (!proposal) return null
  const { data: opp } = await supabase.from('sales_opportunities').select('id').eq('linked_proposal_id', proposal.id).maybeSingle()
  return opp?.id || null
}

// Attributes a Won Opportunity's linked project's ACTUAL profit
// (profit_margins.gross_margin/margin_percent — computed elsewhere by
// recomputeMargin(), never recomputed here) back to the rep/region/domain
// that sourced it.
export async function recomputeSalesProfitAttribution(opportunityId) {
  const { data: opp } = await supabase.from('sales_opportunities').select('*').eq('id', opportunityId).single()
  if (!opp?.linked_proposal_id) return null

  const { data: proposal } = await supabase.from('proposals').select('linked_project_id').eq('id', opp.linked_proposal_id).single()
  if (!proposal?.linked_project_id) return null

  const { data: margin } = await supabase.from('profit_margins').select('gross_margin,margin_percent')
    .eq('project_id', proposal.linked_project_id).eq('period_key', 'ALL').maybeSingle()
  if (!margin) return null

  const { error } = await supabase.from('sales_profit_attribution').upsert({
    region_id: opp.region_id, domain: opp.domain, sales_rep_id: opp.assigned_rep_id,
    opportunity_id: opportunityId, project_id: proposal.linked_project_id,
    gross_margin: margin.gross_margin, margin_percent: margin.margin_percent, currency: opp.currency,
    computed_at: new Date().toISOString(),
  }, { onConflict: 'opportunity_id' })
  if (error) throw error
}

// RLS already floors SELECT to admin/ceo/finance/sales_head. On top of
// that: a Regional Sales Head is scoped to their own region here, and an
// individual rep only sees their own row when the config flag is on.
export async function getProfitAttribution({ role, profileId, regionId } = {}) {
  let q = supabase.from('sales_profit_attribution').select('*, rep:profiles!sales_rep_id(full_name), region:sales_regions(region_name)')
  if (role === 'regional_sales_head' && regionId) q = q.eq('region_id', regionId)
  if (role === 'sales_rep') {
    const allowed = await getConfigFlag('view_sales_profit_attribution_individual')
    if (!allowed) return []
    q = q.eq('sales_rep_id', profileId)
  }
  const { data, error } = await q.order('computed_at', { ascending: false })
  if (error) throw error
  return data || []
}
