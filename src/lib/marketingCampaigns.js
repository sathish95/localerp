import { supabase } from './supabase'

// Campaign CRUD + budget/cost/channel-link CRUD + the ROI rollup
// (recomputeCampaignResult). JS-driven recompute, mirroring
// src/lib/salesFinance.js's pattern exactly — never a DB trigger.

/* ── Campaigns ── */
export async function listCampaigns({ status, domain } = {}) {
  let q = supabase.from('marketing_campaigns')
    .select('*, region:sales_regions(region_name), owner:profiles!owner_id(full_name)')
    .order('start_date', { ascending: false, nullsFirst: false })
  if (status) q = q.eq('status', status)
  if (domain) q = q.eq('domain', domain)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function getCampaign(id) {
  const { data, error } = await supabase.from('marketing_campaigns')
    .select('*, region:sales_regions(region_name), owner:profiles!owner_id(full_name)')
    .eq('id', id).single()
  if (error) throw error
  return data
}

export async function createCampaign(form, userId) {
  const { data, error } = await supabase.from('marketing_campaigns').insert({
    campaign_name: form.campaign_name, campaign_type: form.campaign_type,
    domain: form.domain || null, region_id: form.region_id || null,
    start_date: form.start_date || null, end_date: form.end_date || null,
    owner_id: form.owner_id || userId, linked_product_id: form.linked_product_id || null,
    linked_product_launch_id: form.linked_product_launch_id || null, created_by: userId,
  }).select().single()
  if (error) throw error
  return data
}

export async function updateCampaign(id, patch) {
  const { error } = await supabase.from('marketing_campaigns').update(patch).eq('id', id)
  if (error) throw error
}

/* ── Budget ── */
export async function listCampaignBudgets(campaignId) {
  const { data, error } = await supabase.from('marketing_campaign_budgets')
    .select('*, budget_line:sales_marketing_budget_lines(period_label, planned_amount, currency, approved_by, approved_at)')
    .eq('campaign_id', campaignId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function addCampaignBudget({ campaignId, budgetLineId, plannedSpend, currency }) {
  const { data, error } = await supabase.from('marketing_campaign_budgets').insert({
    campaign_id: campaignId, budget_line_id: budgetLineId, planned_spend: plannedSpend || 0, currency: currency || 'INR',
  }).select().single()
  if (error) throw error
  return data
}

export async function deleteCampaignBudget(id) {
  const { error } = await supabase.from('marketing_campaign_budgets').delete().eq('id', id)
  if (error) throw error
}

/* ── Cost entries ── */
export async function listCostEntries(campaignId) {
  const { data, error } = await supabase.from('marketing_campaign_cost_entries')
    .select('*').eq('campaign_id', campaignId).order('incurred_date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function addCostEntry(form, userId) {
  const { data, error } = await supabase.from('marketing_campaign_cost_entries').insert({
    campaign_id: form.campaign_id, cost_type: form.cost_type, amount: form.amount || 0,
    currency: form.currency || 'INR', incurred_date: form.incurred_date || new Date().toISOString().slice(0, 10),
    vendor_invoice_id: form.vendor_invoice_id || null, notes: form.notes || null, created_by: userId,
  }).select().single()
  if (error) throw error
  await recomputeCampaignResult(form.campaign_id)
  return data
}

export async function deleteCostEntry(id, campaignId) {
  const { error } = await supabase.from('marketing_campaign_cost_entries').delete().eq('id', id)
  if (error) throw error
  await recomputeCampaignResult(campaignId)
}

/* ── Channel links ── */
export async function listChannelLinks(campaignId) {
  const { data, error } = await supabase.from('marketing_campaign_channel_links')
    .select('*, landing_page:sales_landing_links(slug, campaign_name), bootstrap_program:sales_bootstrap_programs(program_name)')
    .eq('campaign_id', campaignId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function linkLandingPage(campaignId, landingLinkId) {
  const { error } = await supabase.from('marketing_campaign_channel_links').insert({
    campaign_id: campaignId, channel_type: 'Landing Page', linked_landing_page_id: landingLinkId,
  })
  if (error) throw error
  // Backfill any leads that already came through this link before it was
  // attached to a campaign (new leads get campaign_id set at creation
  // time going forward — STEP77's public_submit_lead() — so this only
  // ever touches pre-existing, not-yet-attributed rows).
  await supabase.from('sales_leads').update({ campaign_id: campaignId }).eq('landing_link_id', landingLinkId).is('campaign_id', null)
  await recomputeCampaignResult(campaignId)
}

export async function linkBootstrapProgram(campaignId, bootstrapProgramId) {
  const { error } = await supabase.from('marketing_campaign_channel_links').insert({
    campaign_id: campaignId, channel_type: 'Bootstrap Program', linked_bootstrap_program_id: bootstrapProgramId,
  })
  if (error) throw error
  await recomputeCampaignResult(campaignId)
}

export async function linkOther(campaignId, channelType, notes) {
  const { error } = await supabase.from('marketing_campaign_channel_links').insert({
    campaign_id: campaignId, channel_type: channelType, notes: notes || null,
  })
  if (error) throw error
}

export async function deleteChannelLink(id, campaignId) {
  const { error } = await supabase.from('marketing_campaign_channel_links').delete().eq('id', id)
  if (error) throw error
  await recomputeCampaignResult(campaignId)
}

/* ── Results (cached ROI rollup) ── */
export async function getCampaignResult(campaignId) {
  const { data } = await supabase.from('marketing_campaign_results').select('*').eq('campaign_id', campaignId).maybeSingle()
  return data
}

// Resolves the Opportunity set for a campaign as the union of: (a) leads
// tagged directly with this campaign_id, and (b) Bootstrap Programs
// channel-linked to this campaign whose conversion produced an
// Opportunity — the two attribution paths this system's Lead-vs-Bootstrap
// convergence model produces (Bootstrap conversions skip the Lead stage
// entirely). Reads sales_profit_attribution for realized revenue —
// never recomputes it; that's salesFinance.js's job.
export async function recomputeCampaignResult(campaignId) {
  if (!campaignId) return

  const [{ data: leads }, { data: channelLinks }, { count: costCount, data: costRows }] = await Promise.all([
    supabase.from('sales_leads').select('id').eq('campaign_id', campaignId),
    supabase.from('marketing_campaign_channel_links').select('linked_bootstrap_program_id').eq('campaign_id', campaignId).eq('channel_type', 'Bootstrap Program'),
    supabase.from('marketing_campaign_cost_entries').select('amount', { count: 'exact' }).eq('campaign_id', campaignId),
  ])

  const leadIds = (leads || []).map(l => l.id)
  const bootstrapIds = (channelLinks || []).map(c => c.linked_bootstrap_program_id).filter(Boolean)

  const [leadOppsRes, bootstrapOppsRes] = await Promise.all([
    leadIds.length ? supabase.from('sales_opportunities').select('id,status,expected_value,currency').in('lead_id', leadIds) : Promise.resolve({ data: [] }),
    bootstrapIds.length ? supabase.from('sales_bootstrap_programs').select('converted_opportunity_id').in('id', bootstrapIds).not('converted_opportunity_id', 'is', null) : Promise.resolve({ data: [] }),
  ])

  const bootstrapOppIds = (bootstrapOppsRes.data || []).map(b => b.converted_opportunity_id)
  let opps = [...(leadOppsRes.data || [])]
  if (bootstrapOppIds.length) {
    const { data: extra } = await supabase.from('sales_opportunities').select('id,status,expected_value,currency').in('id', bootstrapOppIds)
    const seen = new Set(opps.map(o => o.id))
    ;(extra || []).forEach(o => { if (!seen.has(o.id)) opps.push(o) })
  }

  const wonOpps = opps.filter(o => o.status === 'Won')
  const actualSpend = (costRows || []).reduce((s, c) => s + Number(c.amount || 0), 0)
  const revenueProjected = wonOpps.reduce((s, o) => s + Number(o.expected_value || 0), 0)

  let revenueRealized = 0
  if (wonOpps.length) {
    const { data: attribution } = await supabase.from('sales_profit_attribution').select('opportunity_id,gross_margin').in('opportunity_id', wonOpps.map(o => o.id))
    revenueRealized = (attribution || []).reduce((s, a) => s + Number(a.gross_margin || 0), 0)
  }

  const leadsGenerated = leadIds.length
  const dealsWon = wonOpps.length
  const currency = opps[0]?.currency || 'INR'

  const { error } = await supabase.from('marketing_campaign_results').upsert({
    campaign_id: campaignId,
    leads_generated: leadsGenerated,
    opportunities_created: opps.length,
    deals_won: dealsWon,
    actual_spend: actualSpend,
    revenue_attributed_projected: revenueProjected,
    revenue_attributed_realized: revenueRealized,
    cost_per_lead: leadsGenerated > 0 ? actualSpend / leadsGenerated : 0,
    cost_per_won_deal: dealsWon > 0 ? actualSpend / dealsWon : 0,
    roi_percent_projected: actualSpend > 0 ? Math.round(((revenueProjected - actualSpend) / actualSpend) * 10000) / 100 : 0,
    roi_percent_realized: actualSpend > 0 ? Math.round(((revenueRealized - actualSpend) / actualSpend) * 10000) / 100 : 0,
    currency, computed_at: new Date().toISOString(),
  }, { onConflict: 'campaign_id' })
  if (error) throw error
}

// Resolves which campaign (if any) a Lead/Opportunity mutation should
// recompute — via the lead's own campaign_id, or via a Bootstrap Program's
// channel link if the opportunity came from a bootstrap conversion.
export async function findCampaignForLead(leadId) {
  if (!leadId) return null
  const { data } = await supabase.from('sales_leads').select('campaign_id').eq('id', leadId).maybeSingle()
  return data?.campaign_id || null
}

export async function findCampaignForBootstrapProgram(bootstrapProgramId) {
  if (!bootstrapProgramId) return null
  const { data } = await supabase.from('marketing_campaign_channel_links').select('campaign_id').eq('linked_bootstrap_program_id', bootstrapProgramId).maybeSingle()
  return data?.campaign_id || null
}

// Given an opportunity id, resolves its campaign via either attribution path.
export async function findCampaignForOpportunity(opportunityId) {
  if (!opportunityId) return null
  const { data: opp } = await supabase.from('sales_opportunities').select('lead_id').eq('id', opportunityId).maybeSingle()
  if (opp?.lead_id) {
    const campaignId = await findCampaignForLead(opp.lead_id)
    if (campaignId) return campaignId
  }
  const { data: bp } = await supabase.from('sales_bootstrap_programs').select('id').eq('converted_opportunity_id', opportunityId).maybeSingle()
  if (bp?.id) return findCampaignForBootstrapProgram(bp.id)
  return null
}

/* ── Marketing Calendar — unions Campaign date ranges with ProductLaunch
   target dates; not a new data entity, per spec. ── */
export async function getMarketingCalendar({ domain, region, from, to } = {}) {
  let cq = supabase.from('marketing_campaigns').select('id, campaign_name, campaign_type, domain, region_id, start_date, end_date, status, region:sales_regions(region_name)')
  if (domain) cq = cq.eq('domain', domain)
  if (region) cq = cq.eq('region_id', region)
  const [{ data: campaigns }, { data: launches }] = await Promise.all([
    cq,
    supabase.from('product_launches').select('id, product_name, development_stage, target_launch_date'),
  ])

  const events = [
    ...(campaigns || []).filter(c => c.start_date).map(c => ({
      kind: 'campaign', id: c.id, title: c.campaign_name, subtitle: `${c.campaign_type} · ${c.region?.region_name || 'All Regions'}`,
      start: c.start_date, end: c.end_date || c.start_date, status: c.status,
    })),
    ...(launches || []).filter(l => l.target_launch_date).map(l => ({
      kind: 'product_launch', id: l.id, title: l.product_name, subtitle: l.development_stage,
      start: l.target_launch_date, end: l.target_launch_date, status: l.development_stage,
    })),
  ]
  const filtered = events.filter(e => (!from || e.end >= from) && (!to || e.start <= to))
  return filtered.sort((a, b) => a.start.localeCompare(b.start))
}
