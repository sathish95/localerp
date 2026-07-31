import { supabase, nextNum } from './supabase'
import { sendNotif, sendNotifToMany } from './notifications'
import { recomputeCampaignResult } from './marketingCampaigns'

// Lead CRUD + createLead()'s auto-assignment: applies sales_assignment_rules
// (round_robin / manual / domain_region_match) to pick assigned_rep_id, or
// on no match lands the Lead "Unassigned — Needs Coverage" and alerts the
// matching Regional Sales Head (region known, domain coverage missing) or
// the company-wide Sales Head (region itself has no coverage) — Part 8 §1's
// "hold + alert, never silently auto-dump" default.

export async function listLeads({ regionId, domain, assignedRepId, status } = {}) {
  let q = supabase.from('sales_leads')
    .select('*, region:sales_regions(region_name), rep:profiles!assigned_rep_id(full_name)')
    .order('created_at', { ascending: false })
  if (regionId) q = q.eq('region_id', regionId)
  if (domain) q = q.eq('domain', domain)
  if (assignedRepId) q = q.eq('assigned_rep_id', assignedRepId)
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function getLead(id) {
  const { data, error } = await supabase.from('sales_leads')
    .select('*, region:sales_regions(region_name), rep:profiles!assigned_rep_id(full_name)')
    .eq('id', id).single()
  if (error) throw error
  return data
}

// Picks assigned_rep_id via sales_assignment_rules for the Lead's domain
// (region-specific rule wins over a domain-wide one). round_robin cycles
// across active SalesRepAssignments matching the domain+region; manual
// always leaves it unassigned for a human to pick; domain_region_match
// (the default) picks the least-recently-assigned matching rep — same
// effect as round-robin without a separate counter table.
async function pickAssignee(domain, regionId) {
  const { data: rules } = await supabase.from('sales_assignment_rules')
    .select('*').eq('domain', domain).eq('is_active', true)
  const rule = (rules || []).find(r => r.region_id === regionId) || (rules || []).find(r => !r.region_id)
  if (!rule || rule.rule_type === 'manual') return null

  const { data: roleDefs } = await supabase.from('sales_role_definitions')
    .select('id').eq('domain', domain).eq('is_active', true).or(`region_id.eq.${regionId},region_id.is.null`)
  const roleDefIds = (roleDefs || []).map(r => r.id)
  if (roleDefIds.length === 0) return null

  const today = new Date().toISOString().slice(0, 10)
  const { data: assignments } = await supabase.from('sales_rep_assignments')
    .select('profile_id').in('sales_role_definition_id', roleDefIds)
    .lte('active_from', today).or(`active_to.is.null,active_to.gte.${today}`)
  const repIds = [...new Set((assignments || []).map(a => a.profile_id))]
  if (repIds.length === 0) return null

  // Least-recently-assigned among the matching reps (open leads count as
  // "already carrying load" — this is the round-robin/domain_region_match
  // tie-break, whichever rule_type was configured).
  const { data: existingLeads } = await supabase.from('sales_leads')
    .select('assigned_rep_id').in('assigned_rep_id', repIds).neq('status', 'Disqualified')
  const loadByRep = new Map(repIds.map(id => [id, 0]))
  ;(existingLeads || []).forEach(l => { if (loadByRep.has(l.assigned_rep_id)) loadByRep.set(l.assigned_rep_id, loadByRep.get(l.assigned_rep_id) + 1) })
  return [...loadByRep.entries()].sort((a, b) => a[1] - b[1])[0][0]
}

export async function createLead(form, userId) {
  const lead_number = await nextNum('lead')
  const assigned_rep_id = await pickAssignee(form.domain, form.region_id || null)

  const payload = {
    lead_number, source: form.source || null, domain: form.domain, region_id: form.region_id || null,
    contact_name: form.contact_name, company_name: form.company_name || null,
    product_interest_id: form.product_interest_id || null, product_launch_interest_id: form.product_launch_interest_id || null,
    campaign_id: form.campaign_id || null,  // manual attribution (e.g. trade-show sign-ups) — public-form leads get this server-side instead, see STEP77
    assigned_rep_id: assigned_rep_id || null,
    status: assigned_rep_id ? 'New' : 'Unassigned — Needs Coverage',
    coverage_alert_sent_at: assigned_rep_id ? null : new Date().toISOString(),
    created_by: userId,
  }
  const { data: lead, error } = await supabase.from('sales_leads').insert(payload).select().single()
  if (error) throw error

  if (!assigned_rep_id) await alertCoverageGap(lead, userId)
  if (form.campaign_id) await recomputeCampaignResult(form.campaign_id)
  return lead
}

// Alerts the Regional Sales Head covering this region+domain, or — if the
// region itself has no coverage at all — the company-wide Sales Head.
// Never silently dumps onto Sales Head for a gap that's actually a
// regional head's to triage (Part 8 §1).
async function alertCoverageGap(lead, senderId) {
  let regionalHeadIds = []
  if (lead.region_id) {
    const { data } = await supabase.from('profiles').select('id').eq('role', 'regional_sales_head')
    regionalHeadIds = (data || []).map(p => p.id)
  }
  const opts = {
    type: 'sales_lead_unassigned',
    title: 'Lead needs coverage',
    body: `${lead.contact_name} (${lead.domain}) has no matching sales rep assignment and needs manual triage.`,
    link: `/sales/leads?id=${lead.id}`,
    metadata: { lead_id: lead.id, domain: lead.domain, region_id: lead.region_id },
    senderId,
  }
  if (regionalHeadIds.length > 0) {
    await sendNotifToMany(regionalHeadIds, opts)
  } else {
    const { data } = await supabase.from('profiles').select('id').eq('role', 'sales_head')
    await sendNotifToMany((data || []).map(p => p.id), opts)
  }
}

export async function updateLead(id, patch) {
  const { error } = await supabase.from('sales_leads').update(patch).eq('id', id)
  if (error) throw error
}

export async function assignLead(id, repId, resolverId) {
  const { error } = await supabase.from('sales_leads').update({
    assigned_rep_id: repId, status: 'New', coverage_alert_resolved_by: resolverId,
  }).eq('id', id)
  if (error) throw error
}

// Converts a Qualified Lead into the convergence-point Opportunity.
// Actual insert lives in salesOpportunities.js so opportunity-creation
// logic has one home regardless of which track feeds it.
export async function markLeadConverted(id) {
  const { error } = await supabase.from('sales_leads').update({ status: 'Converted to Opportunity' }).eq('id', id)
  if (error) throw error
}
