import { supabase } from './supabase'

// Admin-side CRUD for public lead-capture campaign links (STEP75).
// The public-facing read/write path lives in src/lib/publicLeadForm.js
// instead — this file assumes an authenticated admin/sales_head/etc. caller.

export function slugify(text) {
  return (text || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

// pageType: 'form' | 'meeting' — omit to get both (used by the Campaign
// channel-link picker, which treats either kind as a "Landing Page" channel).
export async function listLandingLinks(pageType) {
  let q = supabase.from('sales_landing_links').select('*, region:sales_regions(region_name)').order('created_at', { ascending: false })
  if (pageType) q = q.eq('page_type', pageType)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

// Lead counts per link, for the admin list view — one query, grouped client-side.
export async function getLandingLinkLeadCounts() {
  const { data, error } = await supabase.from('sales_leads').select('landing_link_id').not('landing_link_id', 'is', null)
  if (error) throw error
  const counts = {}
  ;(data || []).forEach(r => { counts[r.landing_link_id] = (counts[r.landing_link_id] || 0) + 1 })
  return counts
}

export async function createLandingLink(form, userId) {
  const slug = slugify(form.slug || form.campaign_name)
  if (!slug) throw new Error('Could not derive a URL slug from the campaign name')
  const { data, error } = await supabase.from('sales_landing_links').insert({
    slug, campaign_name: form.campaign_name, domain: form.domain, region_id: form.region_id || null,
    source: form.source || 'Campaign', display_headline: form.display_headline || null,
    display_subheadline: form.display_subheadline || null, featured_products: form.featured_products || [],
    landing_page_id: form.landing_page_id || null,
    page_type: form.page_type || 'form', scheduler_embed_url: form.scheduler_embed_url || null,
    created_by: userId,
  }).select().single()
  if (error) throw error
  return data
}

export async function updateLandingLink(id, patch) {
  const { error } = await supabase.from('sales_landing_links').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteLandingLink(id) {
  const { error } = await supabase.from('sales_landing_links').delete().eq('id', id)
  if (error) throw error
}

/* ── Turnstile secret (write-only) ── */
export async function getTurnstileStatus() {
  const { data, error } = await supabase.rpc('sales_public_form_secret_status')
  if (error) throw error
  return !!data
}

export async function setTurnstileSecret(secret, profileId) {
  const { error } = await supabase.rpc('set_turnstile_secret', { p_secret: secret, p_profile_id: profileId })
  if (error) throw error
}
