// Module enablement — company-wide on/off switch (STEP43 `modules.enabled`,
// applies to every role including admin/ceo) plus per-role visibility
// (`module_role_visibility`, default visible unless a row says otherwise).
// Supabase-backed (org-wide, shared across every browser/device) —
// replaces the old localStorage-only DEFAULT_TABS, which only ever
// changed the editing admin's own browser.
import { createContext, useContext, useState, useEffect, useMemo } from 'react'
import { useAuth } from './AuthContext'
import { getModules, getModuleRoleVisibility, syncModulesFromConfig } from '../lib/modules'

const Ctx = createContext(null)

export function TabVisibilityProvider({ children }) {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const orgId = profile?.organization_id || null
  const [modules, setModules] = useState([])
  const [visibility, setVisibility] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [orgId])

  async function load() {
    // No org resolved yet (e.g. a brand-new signup before the trigger
    // populates organization_id) — skip the fetch rather than querying
    // with a null org id. Empty modules/visibility state makes
    // isTabVisible() fail open (show everything) below, matching this
    // app's pre-existing "permissive by default" posture rather than
    // locking a mid-signup user out of their own account.
    if (!orgId) { setModules([]); setVisibility([]); setLoading(false); return }
    setLoading(true)
    try {
      // Self-healing seed only attempted by roles that can actually write
      // to `modules` (RLS-restricted to admin/ceo) — pointless for anyone
      // else, the insert would just be silently rejected.
      if (['admin', 'ceo'].includes(role)) await syncModulesFromConfig(orgId)
      const [mods, vis] = await Promise.all([getModules(orgId), getModuleRoleVisibility(orgId)])
      setModules(mods)
      setVisibility(vis)
    } finally {
      setLoading(false)
    }
  }

  const moduleByKey = useMemo(() => Object.fromEntries(modules.map(m => [m.key, m])), [modules])
  const visibilityByRole = useMemo(() => {
    const m = {}
    visibility.forEach(v => { (m[v.role] ||= {})[v.module_key] = v.visible })
    return m
  }, [visibility])

  function isTabVisible(tab) {
    const mod = moduleByKey[tab]
    // Company-wide kill switch — overrides everything, even admin/ceo.
    if (mod && mod.enabled === false) return false
    // Admin/CEO bypass per-role visibility (not the kill switch above).
    if (role === 'admin' || role === 'ceo') return true
    return visibilityByRole[role]?.[tab] !== false
  }

  return (
    <Ctx.Provider value={{ modules, visibility, isTabVisible, loading, refresh: load }}>
      {children}
    </Ctx.Provider>
  )
}

export const useTabVisibility = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('useTabVisibility outside provider')
  return c
}
