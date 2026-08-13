import { supabase } from './supabase'

// Platform-wide branding (STEP142) — a single config row, publicly
// readable (the app name has to render before login), writable only by
// a platform super admin.
export const DEFAULT_APP_NAME = 'ThingsAlive NeoX'

export async function getAppName() {
  try {
    const { data, error } = await supabase.from('platform_settings').select('app_name').eq('singleton', true).maybeSingle()
    if (error || !data?.app_name) return DEFAULT_APP_NAME
    return data.app_name
  } catch {
    return DEFAULT_APP_NAME
  }
}

export async function updateAppName(name) {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('App name cannot be empty')
  const { error } = await supabase.from('platform_settings').update({ app_name: trimmed }).eq('singleton', true)
  if (error) throw error
}
