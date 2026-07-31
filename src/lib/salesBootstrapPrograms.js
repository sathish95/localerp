import { supabase } from './supabase'
import { createOpportunity } from './salesOpportunities'
import { findCampaignForBootstrapProgram, recomputeCampaignResult } from './marketingCampaigns'

// Bootstrap/Startup Program track (Part 3) — explicitly marketing/brand
// spend, not expected to be profitable; rolls up against
// sales_marketing_budget_lines (planned vs. actual, same pattern as
// project_planned_budget) rather than mixing into normal sales CAC math.
// Converges into sales_opportunities on conversion, tagged
// source_type='Converted Bootstrap Program'.

export async function listBootstrapPrograms() {
  const { data, error } = await supabase.from('sales_bootstrap_programs')
    .select('*, product:products(name), budget_line:sales_marketing_budget_lines(period_label, planned_amount, currency)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createBootstrapProgram(form, userId) {
  const { data, error } = await supabase.from('sales_bootstrap_programs').insert({
    program_name: form.program_name, target_segment: form.target_segment, participant_company_name: form.participant_company_name,
    product_provided: form.product_provided || null, cost_absorbed: form.cost_absorbed || 0, currency: form.currency || 'INR',
    marketing_budget_line_id: form.marketing_budget_line_id || null, program_duration: form.program_duration || null, created_by: userId,
  }).select().single()
  if (error) throw error
  return data
}

export async function updateBootstrapStatus(id, status, userId) {
  const { data: p } = await supabase.from('sales_bootstrap_programs').select('status').eq('id', id).single()
  const { error } = await supabase.from('sales_bootstrap_programs').update({ status }).eq('id', id)
  if (error) throw error
  await supabase.from('sales_status_audit_log').insert({ entity_type: 'BootstrapProgram', entity_id: id, from_status: p?.status || null, to_status: status, changed_by: userId })
}

export async function updateBootstrapProgram(id, patch) {
  const { error } = await supabase.from('sales_bootstrap_programs').update(patch).eq('id', id)
  if (error) throw error
}

export async function convertBootstrapProgram(id, opportunityForm, userId) {
  const { data: program } = await supabase.from('sales_bootstrap_programs').select('*').eq('id', id).single()
  const opp = await createOpportunity({
    domain: opportunityForm.domain || 'B2B', region_id: opportunityForm.region_id || null, assigned_rep_id: opportunityForm.assigned_rep_id || null,
    expected_value: opportunityForm.expected_value || 0, currency: program.currency, expected_close_date: opportunityForm.expected_close_date || null,
    source_type: 'Converted Bootstrap Program',
  }, userId)
  const { error } = await supabase.from('sales_bootstrap_programs').update({
    conversion_outcome: 'Converted to Paid Deal', converted_opportunity_id: opp.id,
  }).eq('id', id)
  if (error) throw error
  const campaignId = await findCampaignForBootstrapProgram(id)
  if (campaignId) await recomputeCampaignResult(campaignId)
  return opp
}

/* ── Marketing budget lines ── */
export async function listMarketingBudgetLines() {
  const { data, error } = await supabase.from('sales_marketing_budget_lines').select('*').order('period_label', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createMarketingBudgetLine(form, userId) {
  const { data, error } = await supabase.from('sales_marketing_budget_lines').insert({
    period_label: form.period_label, category: form.category || 'Marketing — Bootstrap/Startup Program',
    planned_amount: form.planned_amount || 0, currency: form.currency || 'INR',
    approved_by: form.approved ? userId : null, approved_at: form.approved ? new Date().toISOString() : null, notes: form.notes || null,
  }).select().single()
  if (error) throw error
  return data
}
