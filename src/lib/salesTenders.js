import { supabase } from './supabase'
import { createOpportunity } from './salesOpportunities'

// Government Tender track (Part 3) — converges into sales_opportunities
// on Won via markWon(), tagged source_type='Won Tender'.

export async function listTenders() {
  const { data, error } = await supabase.from('sales_tenders').select('*').order('submission_deadline', { ascending: true, nullsFirst: false })
  if (error) throw error
  return data || []
}

export async function createTender(form, userId) {
  const { data, error } = await supabase.from('sales_tenders').insert({
    tender_number: form.tender_number, issuing_body: form.issuing_body,
    submission_deadline: form.submission_deadline || null,
    eligibility_criteria_checklist: form.eligibility_criteria_checklist || [],
    document_uploads: form.document_uploads || [],
    bid_amount: form.bid_amount || null, currency: form.currency || 'INR', created_by: userId,
  }).select().single()
  if (error) throw error
  return data
}

export async function updateTenderStatus(id, status, userId) {
  const { data: t } = await supabase.from('sales_tenders').select('status').eq('id', id).single()
  const { error } = await supabase.from('sales_tenders').update({ status }).eq('id', id)
  if (error) throw error
  await supabase.from('sales_status_audit_log').insert({ entity_type: 'Tender', entity_id: id, from_status: t?.status || null, to_status: status, changed_by: userId })
}

export async function updateTender(id, patch) {
  const { error } = await supabase.from('sales_tenders').update(patch).eq('id', id)
  if (error) throw error
}

export async function markTenderWon(id, opportunityForm, userId) {
  const { data: tender } = await supabase.from('sales_tenders').select('*').eq('id', id).single()
  const opp = await createOpportunity({
    domain: 'Government', region_id: opportunityForm.region_id || null, assigned_rep_id: opportunityForm.assigned_rep_id || null,
    expected_value: tender.bid_amount, currency: tender.currency, expected_close_date: opportunityForm.expected_close_date || null,
    source_type: 'Won Tender',
  }, userId)
  await updateTenderStatus(id, 'Won', userId)
  const { error } = await supabase.from('sales_tenders').update({ won_opportunity_id: opp.id }).eq('id', id)
  if (error) throw error
  return opp
}
