import { supabase } from './supabase'

// First-run product walkthrough (onboarding_slides) + guided in-app tour
// (tour_steps) — STEP179. Both are per-organization, admin/ceo-editable
// content tables; see that migration's header for the RLS shape.

export async function listSlides(orgId, platform) {
  const { data, error } = await supabase
    .from('onboarding_slides')
    .select('*')
    .eq('organization_id', orgId)
    .eq('active', true)
    .in('platform', platform === 'web' ? ['web', 'both'] : platform === 'mobile' ? ['mobile', 'both'] : ['web', 'mobile', 'both'])
    .order('order_index')
  if (error) throw error
  return data || []
}

// Unfiltered-by-active-state listing for the Settings admin UI, which
// needs to show and let admins re-enable inactive rows too.
export async function listAllSlides(orgId) {
  const { data, error } = await supabase.from('onboarding_slides').select('*').eq('organization_id', orgId).order('order_index')
  if (error) throw error
  return data || []
}

export async function createSlide(orgId, patch) {
  const { data: existing } = await supabase.from('onboarding_slides').select('order_index').eq('organization_id', orgId).order('order_index', { ascending: false }).limit(1)
  const nextOrder = (existing?.[0]?.order_index ?? -1) + 1
  const { error } = await supabase.from('onboarding_slides').insert({
    organization_id: orgId, order_index: nextOrder,
    title: patch.title, body: patch.body || null, icon: patch.icon || null, platform: patch.platform || 'both',
  })
  if (error) throw error
}

export async function updateSlide(id, patch) {
  const { error } = await supabase.from('onboarding_slides').update({
    title: patch.title, body: patch.body || null, icon: patch.icon || null, platform: patch.platform, active: patch.active,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw error
}

export async function deleteSlide(id) {
  const { error } = await supabase.from('onboarding_slides').delete().eq('id', id)
  if (error) throw error
}

export async function reorderSlide(rows, id, direction) {
  const idx = rows.findIndex(r => r.id === id)
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1
  if (idx === -1 || swapIdx < 0 || swapIdx >= rows.length) return
  const a = rows[idx], b = rows[swapIdx]
  await Promise.all([
    supabase.from('onboarding_slides').update({ order_index: b.order_index }).eq('id', a.id),
    supabase.from('onboarding_slides').update({ order_index: a.order_index }).eq('id', b.id),
  ])
}

export async function listTourSteps(orgId, platform) {
  const { data, error } = await supabase
    .from('tour_steps')
    .select('*')
    .eq('organization_id', orgId)
    .eq('platform', platform)
    .eq('active', true)
    .order('order_index')
  if (error) throw error
  return data || []
}

export async function listAllTourSteps(orgId, platform) {
  const { data, error } = await supabase.from('tour_steps').select('*').eq('organization_id', orgId).eq('platform', platform).order('order_index')
  if (error) throw error
  return data || []
}

export async function createTourStep(orgId, platform, patch) {
  const { data: existing } = await supabase.from('tour_steps').select('order_index').eq('organization_id', orgId).eq('platform', platform).order('order_index', { ascending: false }).limit(1)
  const nextOrder = (existing?.[0]?.order_index ?? -1) + 1
  const { error } = await supabase.from('tour_steps').insert({
    organization_id: orgId, platform, order_index: nextOrder,
    target_key: patch.target_key, title: patch.title, body: patch.body || null,
  })
  if (error) throw error
}

export async function updateTourStep(id, patch) {
  const { error } = await supabase.from('tour_steps').update({
    target_key: patch.target_key, title: patch.title, body: patch.body || null, active: patch.active,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw error
}

export async function deleteTourStep(id) {
  const { error } = await supabase.from('tour_steps').delete().eq('id', id)
  if (error) throw error
}

export async function reorderTourStep(rows, id, direction) {
  const idx = rows.findIndex(r => r.id === id)
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1
  if (idx === -1 || swapIdx < 0 || swapIdx >= rows.length) return
  const a = rows[idx], b = rows[swapIdx]
  await Promise.all([
    supabase.from('tour_steps').update({ order_index: b.order_index }).eq('id', a.id),
    supabase.from('tour_steps').update({ order_index: a.order_index }).eq('id', b.id),
  ])
}

export async function markWalkthroughSeen(userId) {
  const { error } = await supabase.from('profiles').update({ walkthrough_seen_at: new Date().toISOString() }).eq('id', userId)
  if (error) throw error
}

export async function markTourSeen(userId) {
  const { error } = await supabase.from('profiles').update({ tour_seen_at: new Date().toISOString() }).eq('id', userId)
  if (error) throw error
}
