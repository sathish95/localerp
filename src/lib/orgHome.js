import { supabase } from './supabase'

export const ORG_HOME_WIDGETS = [
  { key: 'announcements', label: 'Announcements' },
  { key: 'new_joinees', label: 'New Joinees' },
  { key: 'awards', label: 'Recent Awards & Recognition' },
]

export async function listAnnouncements() {
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('org_announcements')
    .select('*, author:created_by(full_name)')
    .eq('is_active', true)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('pinned', { ascending: false })
    .order('publish_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createAnnouncement(patch, userId) {
  const { data, error } = await supabase.from('org_announcements')
    .insert({ ...patch, created_by: userId }).select().single()
  if (error) throw error
  return data
}

export async function updateAnnouncement(id, patch) {
  const { data, error } = await supabase.from('org_announcements')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteAnnouncement(id) {
  const { error } = await supabase.from('org_announcements').delete().eq('id', id)
  if (error) throw error
}

export async function listNewJoinees({ days = 60 } = {}) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, date_joined, dept:department_id(name)')
    .gte('date_joined', since)
    .order('date_joined', { ascending: false })
  if (error) throw error
  return data
}

export async function listRecentAwardWinners({ limit = 8 } = {}) {
  const { data, error } = await supabase.rpc('list_recent_award_winners', { p_limit: limit })
  if (error) throw error
  return data
}

export async function getWidgetConfig() {
  const { data, error } = await supabase.from('org_home_widget_config').select('*')
  if (error) throw error
  const map = {}
  for (const w of ORG_HOME_WIDGETS) map[w.key] = { enabled: true, sort_order: 0 }
  for (const row of data) map[row.widget_key] = { enabled: row.enabled, sort_order: row.sort_order }
  return map
}

export async function setWidgetEnabled(widgetKey, enabled) {
  const { error } = await supabase.from('org_home_widget_config')
    .upsert({ widget_key: widgetKey, enabled }, { onConflict: 'organization_id,widget_key' })
  if (error) throw error
}
