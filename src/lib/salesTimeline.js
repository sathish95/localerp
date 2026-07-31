import { supabase } from './supabase'

// Part 5 — unified historical + pipeline view. One table, same columns
// where they overlap (region/domain/rep/value), so a viewer scrolls from
// "what we've already delivered and how it actually performed" straight
// into "what's coming" without switching screens.

export async function getSalesTimeline({ regionId, domain, status = 'both' } = {}) {
  let q = supabase.from('sales_opportunities')
    .select('*, region:sales_regions(region_name), rep:profiles!assigned_rep_id(full_name)')
    .order('expected_close_date', { ascending: false, nullsFirst: false })
  if (regionId) q = q.eq('region_id', regionId)
  if (domain) q = q.eq('domain', domain)
  if (status === 'historical') q = q.eq('status', 'Won')
  else if (status === 'pipeline') q = q.eq('status', 'Open')
  const { data, error } = await q
  if (error) throw error
  const rows = data || []

  const wonIds = rows.filter(r => r.status === 'Won').map(r => r.id)
  const attributionByOpp = {}
  if (wonIds.length > 0) {
    const { data: attribution } = await supabase.from('sales_profit_attribution').select('*').in('opportunity_id', wonIds)
    ;(attribution || []).forEach(a => { attributionByOpp[a.opportunity_id] = a })
  }

  return rows.map(r => ({
    id: r.id, kind: r.status === 'Won' ? 'delivered' : r.status === 'Open' ? 'pipeline' : 'lost',
    opportunity_number: r.opportunity_number, region: r.region?.region_name, domain: r.domain,
    rep: r.rep?.full_name, expected_close_date: r.expected_close_date, currency: r.currency,
    expected_value: r.expected_value, pipeline_stage: r.pipeline_stage, probability_percent: r.probability_percent,
    actual_profit: attributionByOpp[r.id]?.gross_margin ?? null, actual_margin_percent: attributionByOpp[r.id]?.margin_percent ?? null,
  }))
}
