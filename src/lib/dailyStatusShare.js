import { supabase } from './supabase'
import { getPublicDailyStatusReport } from './dailyStatus'

export function shareLinkUrl(token) {
  return `${window.location.origin}/daily-status-view/${token}`
}

export async function getOrCreateShareLink(organizationId, profileId) {
  const { data: existing, error: findErr } = await supabase.from('daily_status_share_links')
    .select('*').eq('organization_id', organizationId).is('revoked_at', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (findErr) throw findErr
  if (existing) return existing
  const { data, error } = await supabase.from('daily_status_share_links')
    .insert({ organization_id: organizationId, created_by: profileId }).select().single()
  if (error) throw error
  return data
}

export async function listShareLinks(organizationId) {
  const { data, error } = await supabase.from('daily_status_share_links')
    .select('*').eq('organization_id', organizationId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function setShareLinkExpiry(linkId, expiresAt) {
  const { error } = await supabase.from('daily_status_share_links').update({ expires_at: expiresAt || null }).eq('id', linkId)
  if (error) throw error
}

export async function revokeShareLink(linkId) {
  const { error } = await supabase.from('daily_status_share_links').update({ revoked_at: new Date().toISOString() }).eq('id', linkId)
  if (error) throw error
}

// Public (anon) side — used only by PublicDailyStatusPage.
export { getPublicDailyStatusReport }
