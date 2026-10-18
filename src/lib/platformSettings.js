import { supabase } from './supabase'

// Platform-wide branding (STEP142) — a single config row, publicly
// readable (the app name has to render before login), writable only by
// a platform super admin.
export const DEFAULT_APP_NAME = 'ThingsAlive NeoX'

export async function getAppName() {
  try {
    const { data, error } = await supabase.from('platform_settings').select('app_name').eq('singleton', true).maybeSingle()
    if (error) { console.error('getAppName:', error); return DEFAULT_APP_NAME }
    if (!data?.app_name) return DEFAULT_APP_NAME
    return data.app_name
  } catch (err) {
    console.error('getAppName:', err)
    return DEFAULT_APP_NAME
  }
}

export async function updateAppName(name) {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('App name cannot be empty')
  const { error } = await supabase.from('platform_settings').update({ app_name: trimmed }).eq('singleton', true)
  if (error) throw error
}

// Platform-wide maintenance mode (STEP204) — same singleton row.
// Enforcement lives in App.jsx (swaps the routes tree for
// MaintenancePage); admin/ceo and platform super admins are exempt
// there so someone can always get in to turn it back off.
export async function getMaintenanceMode() {
  try {
    const { data, error } = await supabase.from('platform_settings').select('maintenance_enabled,maintenance_message,maintenance_gif_url').eq('singleton', true).maybeSingle()
    // Fails CLOSED (never blocks the whole app over a transient read
    // error) but logs — a silent catch here is exactly what made this
    // bug invisible last time: the toggle showed "ON" while every actual
    // read of the flag quietly came back empty.
    if (error) { console.error('getMaintenanceMode:', error); return { enabled: false, message: '', gifUrl: '' } }
    if (!data) { console.warn('getMaintenanceMode: no platform_settings row found for singleton=true'); return { enabled: false, message: '', gifUrl: '' } }
    return { enabled: !!data.maintenance_enabled, message: data.maintenance_message || '', gifUrl: data.maintenance_gif_url || '' }
  } catch (err) {
    console.error('getMaintenanceMode:', err)
    return { enabled: false, message: '', gifUrl: '' }
  }
}

export async function setMaintenanceMode(enabled, message, gifUrl) {
  // .select().single() so a write RLS silently filtered out (is_platform_super_admin()
  // returning false, or the row not matching for any reason) surfaces as a real
  // error instead of a false "saved" — a plain .update() with no .select() returns
  // no error even when zero rows were actually updated.
  const { data, error } = await supabase.from('platform_settings')
    .update({ maintenance_enabled: enabled, maintenance_message: message || null, maintenance_gif_url: gifUrl || null })
    .eq('singleton', true)
    .select('maintenance_enabled,maintenance_message,maintenance_gif_url')
    .single()
  if (error) throw error
  if (!data || !!data.maintenance_enabled !== enabled) {
    throw new Error('Maintenance mode did not save — the write was not applied (check you are signed in as a platform super admin).')
  }
}
