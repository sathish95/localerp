import { supabase } from './supabase'
import { slugify, listLandingLinks, createLandingLink, updateLandingLink, deleteLandingLink } from './salesLandingLinks'

// Meeting Booking Pages (STEP81) — a distinct admin surface and public
// URL (/book/:slug) from plain Landing Links, but the SAME underlying
// sales_landing_links table (page_type='meeting'), so it inherits
// campaign attribution, lead capture, Turnstile protection and RLS for
// free rather than duplicating any of that.
export { slugify }

export async function listMeetingPages() {
  return listLandingLinks('meeting')
}

export async function getMeetingPageLeadCounts() {
  const { data, error } = await supabase.from('sales_leads').select('landing_link_id').not('landing_link_id', 'is', null)
  if (error) throw error
  const counts = {}
  ;(data || []).forEach(r => { counts[r.landing_link_id] = (counts[r.landing_link_id] || 0) + 1 })
  return counts
}

export async function createMeetingPage(form, userId) {
  return createLandingLink({ ...form, page_type: 'meeting' }, userId)
}

export const updateMeetingPage = updateLandingLink
export const deleteMeetingPage = deleteLandingLink
