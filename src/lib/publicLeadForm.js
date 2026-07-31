import { supabase } from './supabase'

// Public (unauthenticated) side of the lead-capture link — called from
// src/pages/PublicLeadFormPage.jsx. Both calls hit SECURITY DEFINER
// Postgres RPCs (STEP75), never the tables directly — anon has no direct
// table grants on sales_leads/sales_landing_links.

export async function getPublicLandingLink(slug) {
  const { data, error } = await supabase.rpc('get_landing_link_public', { p_slug: slug })
  if (error) throw error
  const row = data?.[0]
  if (!row || !row.is_active) return null
  return row
}

export async function submitPublicLead({ slug, contactName, companyName, phone, email, message, productInterest, turnstileToken, customFields }) {
  const { data, error } = await supabase.rpc('public_submit_lead', {
    p_slug: slug, p_contact_name: contactName, p_company_name: companyName || null,
    p_phone: phone || null, p_email: email || null, p_message: message || null,
    p_product_interest: productInterest || null, p_turnstile_token: turnstileToken,
    p_custom_fields: customFields || {},
  })
  if (error) throw error
  return data // lead_number
}

// Landing Page Builder's public render (STEP79) — resolves the link's
// attached landing_page_id (if any) and returns its blocks. Null means
// this link has no builder page, so the caller falls back to the plain
// fixed-form render.
export async function getPublicLandingPage(slug) {
  const { data, error } = await supabase.rpc('get_landing_page_public', { p_slug: slug })
  if (error) throw error
  const row = data?.[0]
  if (!row?.page_id) return null
  return { pageId: row.page_id, pageName: row.page_name, theme: row.theme || {}, blocks: row.blocks || [] }
}

// Resolves product name/type for whichever part_numbers a page's
// ProductCard/ProductGrid blocks reference — curated, never the full
// catalog, never internal cost.
export async function getProductsPublic(partNumbers) {
  if (!partNumbers?.length) return {}
  const { data, error } = await supabase.rpc('get_products_public', { p_part_numbers: partNumbers })
  if (error) throw error
  return Object.fromEntries((data || []).map(p => [p.part_number, p]))
}
