import { createContext, useContext, useEffect, useState } from 'react'
import { getAppName, DEFAULT_APP_NAME } from '../lib/platformSettings'

// Wraps the whole app (above AuthProvider, in App.jsx) so the platform
// name is available on pre-login pages too — landing page, auth page,
// public lead/meeting forms all render before any session exists.
// Starts at the hardcoded default and swaps in the real value once
// fetched, so nothing ever renders blank while loading or if the fetch
// fails (e.g. platform_settings not yet migrated).
const TAGLINE = 'Manage Everything. From One Place.'
const Ctx = createContext({ appName: DEFAULT_APP_NAME, refresh: async () => {} })

export function BrandingProvider({ children }) {
  const [appName, setAppName] = useState(DEFAULT_APP_NAME)

  async function refresh() {
    const name = await getAppName()
    setAppName(name)
    document.title = `${name} — ${TAGLINE}`
  }

  useEffect(() => { refresh() }, [])

  return <Ctx.Provider value={{ appName, refresh }}>{children}</Ctx.Provider>
}

export const useAppName = () => useContext(Ctx).appName
// For the super-admin settings screen that changes it — every other
// page just reads useAppName() and re-renders whenever this fires.
export const useRefreshAppName = () => useContext(Ctx).refresh
