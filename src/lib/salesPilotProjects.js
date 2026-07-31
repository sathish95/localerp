import { supabase } from './supabase'
import { createOpportunity } from './salesOpportunities'

// Non-Government Pilot track (Part 3) — near-zero-cost pilots absorbed as
// BD cost; converges into sales_opportunities on conversion, tagged
// source_type='Converted Pilot'. Non-conversion + reason is technical
// feedback worth routing to CTO (Part 6 CTO view reads this directly).

export async function listPilotProjects() {
  const { data, error } = await supabase.from('sales_pilot_projects').select('*, product:products(name)').order('start_date', { ascending: false, nullsFirst: false })
  if (error) throw error
  return data || []
}

export async function createPilotProject(form, userId) {
  const { data, error } = await supabase.from('sales_pilot_projects').insert({
    prospect_name: form.prospect_name, product_piloted: form.product_piloted || null,
    pilot_cost: form.pilot_cost || 0, currency: form.currency || 'INR', pilot_duration: form.pilot_duration || null,
    start_date: form.start_date || null, end_date: form.end_date || null, created_by: userId,
  }).select().single()
  if (error) throw error
  return data
}

export async function updatePilotProject(id, patch) {
  const { error } = await supabase.from('sales_pilot_projects').update(patch).eq('id', id)
  if (error) throw error
}

export async function convertPilotProject(id, opportunityForm, userId) {
  const { data: pilot } = await supabase.from('sales_pilot_projects').select('*').eq('id', id).single()
  const opp = await createOpportunity({
    domain: 'Non-Government', region_id: opportunityForm.region_id || null, assigned_rep_id: opportunityForm.assigned_rep_id || null,
    expected_value: opportunityForm.expected_value || 0, currency: pilot.currency, expected_close_date: opportunityForm.expected_close_date || null,
    source_type: 'Converted Pilot',
  }, userId)
  const { error } = await supabase.from('sales_pilot_projects').update({
    conversion_outcome: 'Converted', converted_opportunity_id: opp.id,
  }).eq('id', id)
  if (error) throw error
  return opp
}

export async function markPilotNotConverted(id, reason) {
  const { error } = await supabase.from('sales_pilot_projects').update({ conversion_outcome: 'Not Converted', conversion_reason: reason || null }).eq('id', id)
  if (error) throw error
}
