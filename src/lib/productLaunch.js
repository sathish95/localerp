import { supabase } from './supabase'

// ProductLaunch — tracks upcoming/new products before they're in the live
// catalog; logInterest() turns sales pipeline chatter into real
// pre-launch demand signal for CTO/Product (Part 2, Part 6 CTO view).

export async function listProductLaunches() {
  const { data, error } = await supabase.from('product_launches').select('*').order('target_launch_date', { ascending: true, nullsFirst: false })
  if (error) throw error
  return data || []
}

export async function createProductLaunch(form, userId) {
  const { data, error } = await supabase.from('product_launches').insert({
    product_name: form.product_name, description: form.description || null,
    target_launch_date: form.target_launch_date || null, development_stage: form.development_stage || 'Concept',
    created_by: userId,
  }).select().single()
  if (error) throw error
  return data
}

export async function updateProductLaunch(id, patch) {
  const { error } = await supabase.from('product_launches').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteProductLaunch(id) {
  const { error } = await supabase.from('product_launches').delete().eq('id', id)
  if (error) throw error
}

export async function logInterest({ leadId, opportunityId, productLaunchId, notes }) {
  const { error } = await supabase.from('product_launch_interest').insert({
    lead_id: leadId || null, opportunity_id: opportunityId || null, product_launch_id: productLaunchId, notes: notes || null,
  })
  if (error) throw error
}

export async function getInterestCounts() {
  const { data, error } = await supabase.from('product_launch_interest').select('product_launch_id')
  if (error) throw error
  const counts = {}
  ;(data || []).forEach(r => { counts[r.product_launch_id] = (counts[r.product_launch_id] || 0) + 1 })
  return counts
}
