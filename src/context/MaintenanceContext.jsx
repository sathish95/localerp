import { createContext, useContext, useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getMaintenanceMode } from '../lib/platformSettings'

// Platform-wide maintenance mode (STEP204) — wraps the whole app (same
// level as BrandingProvider) so it's fetched once and pushed live via
// realtime to every open session the moment a super admin flips it,
// rather than only taking effect on next login.
const Ctx = createContext({ maintenanceOn: false, maintenanceMessage: '', maintenanceGifUrl: '', refresh: async () => {} })

export function MaintenanceProvider({ children }) {
  const [maintenanceOn, setMaintenanceOn] = useState(false)
  const [maintenanceMessage, setMaintenanceMessage] = useState('')
  const [maintenanceGifUrl, setMaintenanceGifUrl] = useState('')
  const chRef = useRef(null)

  async function refresh() {
    const { enabled, message, gifUrl } = await getMaintenanceMode()
    setMaintenanceOn(enabled)
    setMaintenanceMessage(message)
    setMaintenanceGifUrl(gifUrl)
  }

  useEffect(() => {
    refresh()
    const ch = supabase.channel('platform-maintenance-sync')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'platform_settings' }, payload => {
        setMaintenanceOn(!!payload.new.maintenance_enabled)
        setMaintenanceMessage(payload.new.maintenance_message || '')
        setMaintenanceGifUrl(payload.new.maintenance_gif_url || '')
      })
      .subscribe()
    chRef.current = ch
    return () => { supabase.removeChannel(ch) }
  }, [])

  return <Ctx.Provider value={{ maintenanceOn, maintenanceMessage, maintenanceGifUrl, refresh }}>{children}</Ctx.Provider>
}

export const useMaintenance = () => useContext(Ctx)
