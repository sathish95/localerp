import { supabase, nextNum } from './supabase'
import { createProposal } from './proposals'
import { markLeadConverted } from './salesLeads'
import { recomputeSalesRevenueForecast } from './salesFinance'
import { findCampaignForOpportunity, recomputeCampaignResult } from './marketingCampaigns'

// Opportunity CRUD — the single convergence point every entry track
// (direct Lead, Won Tender, Converted Pilot, Converted Bootstrap Program)
// lands in before Convert to Proposal hands off to the EXISTING Proposal
// Builder (src/lib/proposals.js's createProposal()) — no proposal/cost
// logic duplicated here, this module only ever sets linked_proposal_id.

export async function listOpportunities({ regionId, domain, assignedRepId, status } = {}) {
  let q = supabase.from('sales_opportunities')
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

export async function getOpportunity(id) {
  const { data, error } = await supabase.from('sales_opportunities')
    .select('*, region:sales_regions(region_name), rep:profiles!assigned_rep_id(full_name), lead:sales_leads(contact_name, company_name)')
    .eq('id', id).single()
  if (error) throw error
  return data
}

// Shared by every convergence path (Lead conversion, Tender win, Pilot
// conversion, Bootstrap conversion) so "how does this become an
// Opportunity" has one implementation regardless of entry track.
export async function createOpportunity(form, userId) {
  const opportunity_number = await nextNum('opportunity')
  const { data: firstStage } = await supabase.from('sales_pipeline_stages')
    .select('stage_name, default_probability_percent').eq('domain', form.domain).eq('is_active', true)
    .order('sort_order').limit(1).maybeSingle()

  const payload = {
    opportunity_number, lead_id: form.lead_id || null, domain: form.domain, region_id: form.region_id || null,
    assigned_rep_id: form.assigned_rep_id || null,
    pipeline_stage: form.pipeline_stage || firstStage?.stage_name || 'Prospecting',
    expected_close_date: form.expected_close_date || null, expected_value: form.expected_value || 0,
    currency: form.currency || 'INR', probability_percent: form.probability_percent ?? firstStage?.default_probability_percent ?? 0,
    source_type: form.source_type || 'Direct', created_by: userId,
  }
  const { data: opp, error } = await supabase.from('sales_opportunities').insert(payload).select().single()
  if (error) throw error

  await supabase.from('sales_stage_audit_log').insert({ opportunity_id: opp.id, from_stage: null, to_stage: opp.pipeline_stage, changed_by: userId })
  if (form.lead_id) await markLeadConverted(form.lead_id)
  await recomputeSalesRevenueForecast({ region: opp.region_id, domain: opp.domain, repId: opp.assigned_rep_id })
  return opp
}

export async function updateOpportunity(id, patch) {
  const { error } = await supabase.from('sales_opportunities').update(patch).eq('id', id)
  if (error) throw error
}

export async function changeStage(id, newStage, probabilityPercent, userId) {
  const { data: opp } = await supabase.from('sales_opportunities').select('pipeline_stage, region_id, domain, assigned_rep_id').eq('id', id).single()
  const { error } = await supabase.from('sales_opportunities').update({
    pipeline_stage: newStage, probability_percent: probabilityPercent ?? undefined,
  }).eq('id', id)
  if (error) throw error
  await supabase.from('sales_stage_audit_log').insert({ opportunity_id: id, from_stage: opp?.pipeline_stage || null, to_stage: newStage, changed_by: userId })
  const campaignId = await findCampaignForOpportunity(id)
  if (campaignId) await recomputeCampaignResult(campaignId)
}

export async function markWon(id, userId) {
  const { data: opp } = await supabase.from('sales_opportunities').select('*').eq('id', id).single()
  const { error } = await supabase.from('sales_opportunities').update({ status: 'Won', probability_percent: 100 }).eq('id', id)
  if (error) throw error
  await supabase.from('sales_stage_audit_log').insert({ opportunity_id: id, from_stage: opp.pipeline_stage, to_stage: `${opp.pipeline_stage} (Won)`, changed_by: userId })
  await recomputeSalesRevenueForecast({ region: opp.region_id, domain: opp.domain, repId: opp.assigned_rep_id })
  const campaignId = await findCampaignForOpportunity(id)
  if (campaignId) await recomputeCampaignResult(campaignId)
}

export async function markLost(id, userId) {
  const { data: opp } = await supabase.from('sales_opportunities').select('*').eq('id', id).single()
  const { error } = await supabase.from('sales_opportunities').update({ status: 'Lost' }).eq('id', id)
  if (error) throw error
  await supabase.from('sales_stage_audit_log').insert({ opportunity_id: id, from_stage: opp.pipeline_stage, to_stage: `${opp.pipeline_stage} (Lost)`, changed_by: userId })
  await recomputeSalesRevenueForecast({ region: opp.region_id, domain: opp.domain, repId: opp.assigned_rep_id })
  const campaignId = await findCampaignForOpportunity(id)
  if (campaignId) await recomputeCampaignResult(campaignId)
}

// Convert to Proposal — calls the EXISTING createProposal() (src/lib/proposals.js)
// prefilled from the Opportunity/Lead, then links back. This is the exact
// seam the spec asks for: "feeds into" the Proposal Builder, doesn't
// reimplement it.
export async function convertToProposal(opportunityId, userId) {
  const opp = await getOpportunity(opportunityId)
  if (opp.linked_proposal_id) throw new Error('This opportunity is already linked to a proposal.')

  const proposal = await createProposal({
    proposal_name: `${opp.lead?.company_name || opp.lead?.contact_name || opp.opportunity_number} — ${opp.domain}`,
    customer_name: opp.lead?.company_name || opp.lead?.contact_name || 'Unknown',
    customer_contact: null,
    validity_until_date: opp.expected_close_date,
    overall_margin_percent: 20,
    currency: opp.currency,
  }, userId)

  const { error } = await supabase.from('sales_opportunities').update({ linked_proposal_id: proposal.id }).eq('id', opportunityId)
  if (error) throw error
  return proposal
}
