import { supabase } from './supabase'
import { getRevenueForecast, getProfitAttribution } from './salesFinance'
import { getMarketingCalendar } from './marketingCampaigns'

// Part 6 — one query function per executive persona, all reading the
// cached rollups (sales_revenue_forecast / sales_profit_attribution) plus
// the track-specific tables, never recomputing profit/margin live.

/* ── CFO ── */
export async function getCFODashboard({ role, profileId, regionId } = {}) {
  const [forecast, attribution, bootstrapLines] = await Promise.all([
    getRevenueForecast({}),
    getProfitAttribution({ role, profileId, regionId }),
    supabase.from('sales_marketing_budget_lines').select('*').then(r => r.data || []),
  ])
  const bootstrapActual = await supabase.from('sales_bootstrap_programs').select('cost_absorbed,currency').then(r => (r.data || []).reduce((s, b) => s + Number(b.cost_absorbed || 0), 0))
  return {
    forecast: forecast || { pipeline_value: 0, weighted_forecast: 0, closed_won_value: 0, closed_lost_value: 0 },
    profitAttribution: attribution,
    bootstrapPlanned: bootstrapLines.reduce((s, b) => s + Number(b.planned_amount || 0), 0),
    bootstrapActual,
  }
}

/* ── CMO ── */
export async function getCMODashboard() {
  const [
    { data: leads }, { data: opps }, { data: bootstrap }, { data: interest }, { data: launches },
    { data: campaigns }, { data: results }, { data: budgets }, calendar,
  ] = await Promise.all([
    supabase.from('sales_leads').select('source, status, region_id, campaign_id, landing_link_id, region:sales_regions(region_name)'),
    supabase.from('sales_opportunities').select('status, region_id, region:sales_regions(region_name), expected_value'),
    supabase.from('sales_bootstrap_programs').select('*, budget_line:sales_marketing_budget_lines(planned_amount)'),
    supabase.from('product_launch_interest').select('product_launch_id, lead_id'),
    supabase.from('product_launches').select('id, product_name, development_stage'),
    supabase.from('marketing_campaigns').select('id, campaign_name, campaign_type, domain, region:sales_regions(region_name), status'),
    supabase.from('marketing_campaign_results').select('*'),
    supabase.from('marketing_campaign_budgets').select('planned_spend'),
    getMarketingCalendar({ from: new Date().toISOString().slice(0, 10) }),
  ])

  const bySource = {}
  ;(leads || []).forEach(l => {
    const s = l.source || 'Unspecified'
    bySource[s] = bySource[s] || { source: s, leads: 0, converted: 0 }
    bySource[s].leads++
    if (l.status === 'Converted to Opportunity') bySource[s].converted++
  })

  const byRegion = {}
  ;(opps || []).forEach(o => {
    const r = o.region?.region_name || 'Unassigned'
    byRegion[r] = byRegion[r] || { region: r, won: 0, pipeline: 0, pipelineValue: 0 }
    if (o.status === 'Won') byRegion[r].won++
    if (o.status === 'Open') { byRegion[r].pipeline++; byRegion[r].pipelineValue += Number(o.expected_value || 0) }
  })

  // Product interest heatmap, cut by which campaign the interested lead came from.
  const leadCampaignById = Object.fromEntries((leads || []).map(l => [l.id, l.campaign_id]))
  const campaignNameById = Object.fromEntries((campaigns || []).map(c => [c.id, c.campaign_name]))
  const interestCounts = {}
  const interestByCampaign = {}
  ;(interest || []).forEach(i => {
    interestCounts[i.product_launch_id] = (interestCounts[i.product_launch_id] || 0) + 1
    const campaignName = campaignNameById[leadCampaignById[i.lead_id]] || 'Uncampaigned'
    ;(interestByCampaign[i.product_launch_id] ||= {})[campaignName] = (interestByCampaign[i.product_launch_id]?.[campaignName] || 0) + 1
  })
  const productHeatmap = (launches || []).map(l => ({
    ...l, interest_count: interestCounts[l.id] || 0,
    byCampaign: Object.entries(interestByCampaign[l.id] || {}).map(([campaign, count]) => ({ campaign, count })),
  })).sort((a, b) => b.interest_count - a.interest_count)

  // Campaign performance — ranked by realized ROI, with campaign metadata joined in.
  const campaignById = Object.fromEntries((campaigns || []).map(c => [c.id, c]))
  const campaignPerformance = (results || [])
    .map(r => ({ ...r, campaign: campaignById[r.campaign_id] }))
    .filter(r => r.campaign)
    .sort((a, b) => b.roi_percent_realized - a.roi_percent_realized)

  // Channel effectiveness — Landing Page conversion measured directly off
  // sales_leads.landing_link_id (precise per-link), Bootstrap Program off
  // its own conversion_outcome — the two attribution paths this system's
  // Lead-vs-Bootstrap model actually produces. Per-channel cost isn't
  // tracked (CampaignCostEntry is per-campaign, not per-channel), so this
  // shows conversion rate only, not a fabricated per-channel cost figure.
  const landingLeads = (leads || []).filter(l => l.landing_link_id)
  const landingConverted = landingLeads.filter(l => l.status === 'Converted to Opportunity').length
  const bootstrapConverted = (bootstrap || []).filter(b => b.conversion_outcome === 'Converted to Paid Deal').length
  const channelEffectiveness = [
    { channel_type: 'Landing Page', total: landingLeads.length, converted: landingConverted, conversion_rate: landingLeads.length ? Math.round((landingConverted / landingLeads.length) * 100) : 0 },
    { channel_type: 'Bootstrap Program', total: (bootstrap || []).length, converted: bootstrapConverted, conversion_rate: (bootstrap || []).length ? Math.round((bootstrapConverted / (bootstrap || []).length) * 100) : 0 },
  ]

  return {
    leadSourceEffectiveness: Object.values(bySource),
    bootstrapPrograms: bootstrap || [],
    regionalPenetration: Object.values(byRegion),
    productInterestHeatmap: productHeatmap,
    campaignPerformance,
    channelEffectiveness,
    plannedVsActualSpend: {
      planned: (budgets || []).reduce((s, b) => s + Number(b.planned_spend || 0), 0),
      actual: (results || []).reduce((s, r) => s + Number(r.actual_spend || 0), 0),
    },
    upcomingCalendar: (calendar || []).slice(0, 6),
  }
}

/* ── CTO ── */
export async function getCTODashboard() {
  const [{ data: launches }, { data: interest }, { data: pilots }, warrantyByProduct] = await Promise.all([
    supabase.from('product_launches').select('*'),
    supabase.from('product_launch_interest').select('product_launch_id, notes, created_at'),
    supabase.from('sales_pilot_projects').select('*, product:products(name)'),
    getWarrantyCostByProductType(),
  ])
  const interestByLaunch = {}
  ;(interest || []).forEach(i => { (interestByLaunch[i.product_launch_id] ||= []).push(i) })

  return {
    productLaunches: (launches || []).map(l => ({ ...l, interest_signals: interestByLaunch[l.id] || [] })),
    pilotFeedback: (pilots || []).filter(p => p.conversion_outcome === 'Not Converted' && p.conversion_reason),
    warrantyByProductType: warrantyByProduct,
  }
}

// Best-effort cross-reference into the Warranty module — device_instances
// (no tracked schema file, columns confirmed via existing usage elsewhere
// in this codebase) has part_number, which resolves to products.
async function getWarrantyCostByProductType() {
  const { data: costEntries } = await supabase.from('warranty_cost_entries').select('warranty_claim_id, amount')
  if (!costEntries?.length) return []
  const claimIds = [...new Set(costEntries.map(c => c.warranty_claim_id))]
  const { data: claims } = await supabase.from('warranty_claims').select('id, device_id').in('id', claimIds)
  const deviceIds = [...new Set((claims || []).map(c => c.device_id))]
  if (!deviceIds.length) return []
  const { data: devices } = await supabase.from('device_instances').select('id, part_number').in('id', deviceIds)
  const partByDevice = Object.fromEntries((devices || []).map(d => [d.id, d.part_number]))
  const partNumbers = [...new Set(Object.values(partByDevice).filter(Boolean))]
  const { data: products } = await supabase.from('products').select('part_number, name, device_type').in('part_number', partNumbers)
  const productByPart = Object.fromEntries((products || []).map(p => [p.part_number, p]))
  const claimToDevice = Object.fromEntries((claims || []).map(c => [c.id, c.device_id]))

  const totals = {}
  costEntries.forEach(entry => {
    const deviceId = claimToDevice[entry.warranty_claim_id]
    const part = partByDevice[deviceId]
    const product = productByPart[part]
    const key = product?.name || part || 'Unknown'
    totals[key] = (totals[key] || 0) + Number(entry.amount || 0)
  })
  return Object.entries(totals).map(([product, total_cost]) => ({ product, total_cost })).sort((a, b) => b.total_cost - a.total_cost)
}

/* ── Sales Head ── */
export async function getSalesHeadDashboard({ regionId } = {}) {
  let oppQ = supabase.from('sales_opportunities').select('*, rep:profiles!assigned_rep_id(full_name), region:sales_regions(region_name)')
  if (regionId) oppQ = oppQ.eq('region_id', regionId)
  let actQ = supabase.from('sales_activities').select('performed_by, outcome, activity_date')
  let taskQ = supabase.from('sales_tasks').select('assigned_to, status, due_date, priority')

  const [{ data: opps }, { data: activities }, { data: tasks }] = await Promise.all([oppQ, actQ, taskQ])

  const repStats = {}
  ;(opps || []).forEach(o => {
    const rep = o.rep?.full_name || 'Unassigned'
    repStats[rep] = repStats[rep] || { rep, open: 0, won: 0, lost: 0, pipelineValue: 0 }
    if (o.status === 'Open') { repStats[rep].open++; repStats[rep].pipelineValue += Number(o.expected_value || 0) }
    if (o.status === 'Won') repStats[rep].won++
    if (o.status === 'Lost') repStats[rep].lost++
  })
  const today = new Date().toISOString().slice(0, 10)
  const overdueTasks = (tasks || []).filter(t => t.status !== 'Completed' && t.due_date < today)

  const stageHealth = {}
  ;(opps || []).filter(o => o.status === 'Open').forEach(o => {
    stageHealth[o.pipeline_stage] = (stageHealth[o.pipeline_stage] || 0) + 1
  })

  return {
    repPerformance: Object.values(repStats),
    totalActivities: (activities || []).length,
    overdueTasks: overdueTasks.length,
    overdueByPriority: { High: overdueTasks.filter(t => t.priority === 'High').length, Medium: overdueTasks.filter(t => t.priority === 'Medium').length, Low: overdueTasks.filter(t => t.priority === 'Low').length },
    pipelineByStage: Object.entries(stageHealth).map(([stage, count]) => ({ stage, count })),
    winRate: (() => {
      const closed = (opps || []).filter(o => ['Won', 'Lost'].includes(o.status))
      const won = closed.filter(o => o.status === 'Won').length
      return closed.length ? Math.round((won / closed.length) * 100) : 0
    })(),
  }
}
