// Module enablement — company-wide on/off switch (STEP43 `modules.enabled`,
// applies to every role including admin/ceo) plus per-role visibility
// (`module_role_visibility`, default visible unless a row says otherwise).
// Supabase-backed (org-wide, shared across every browser/device) —
// replaces the old localStorage-only DEFAULT_TABS, which only ever
// changed the editing admin's own browser.
import { createContext, useContext, useState, useEffect, useMemo } from 'react'
import { useAuth } from './AuthContext'
import { getModules, getModuleRoleVisibility, syncModulesFromConfig } from '../lib/modules'
import { listBundles, myBundleSubscriptions, buildModuleBundleMap } from '../lib/billingBundles'
import { listRolePermissions } from '../lib/permissions'

const Ctx = createContext(null)

export function TabVisibilityProvider({ children }) {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const orgId = profile?.organization_id || null
  const isEnterprise = profile?.org?.plan_key === 'enterprise'
  const [modules, setModules] = useState([])
  const [visibility, setVisibility] = useState([])
  const [moduleBundleMap, setModuleBundleMap] = useState({})
  const [activeBundleKeys, setActiveBundleKeys] = useState(new Set())
  const [rolePermissionKeys, setRolePermissionKeys] = useState(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [orgId])

  async function load() {
    // No org resolved yet (e.g. a brand-new signup before the trigger
    // populates organization_id) — skip the fetch rather than querying
    // with a null org id. Empty modules/visibility state makes
    // isTabVisible() fail open (show everything) below, matching this
    // app's pre-existing "permissive by default" posture rather than
    // locking a mid-signup user out of their own account.
    if (!orgId) { setModules([]); setVisibility([]); setModuleBundleMap({}); setActiveBundleKeys(new Set()); setLoading(false); return }
    setLoading(true)
    try {
      // Self-healing seed only attempted by roles that can actually write
      // to `modules` (RLS-restricted to admin/ceo) — pointless for anyone
      // else, the insert would just be silently rejected.
      if (['admin', 'ceo'].includes(role)) await syncModulesFromConfig(orgId)
      const [mods, vis] = await Promise.all([getModules(orgId), getModuleRoleVisibility(orgId)])
      setModules(mods)
      setVisibility(vis)

      // Bundle billing (STEP124) is fetched separately and fails OPEN
      // (empty map = nothing gated) rather than inside the Promise.all
      // above — otherwise an org whose database hasn't had STEP124 run
      // yet would have this query reject and take the whole nav's
      // modules/visibility down with it via Promise.all's fail-fast
      // semantics, breaking every existing user's sidebar.
      try {
        const [bundles, orgBundles] = await Promise.all([listBundles(), myBundleSubscriptions(orgId)])
        setModuleBundleMap(buildModuleBundleMap(bundles))
        setActiveBundleKeys(new Set(orgBundles.map(b => b.bundle_key)))
      } catch {
        setModuleBundleMap({})
        setActiveBundleKeys(new Set())
      }

      // Fine-grained permissions (STEP125) — fails CLOSED (no
      // permissions granted) rather than open, unlike the bundle billing
      // fetch above: this is an authorization check, not a billing one,
      // so an unmigrated database or transient fetch error should hide
      // a permission-gated action rather than reveal one.
      try {
        const perms = await listRolePermissions()
        setRolePermissionKeys(new Set(perms.map(p => `${p.role_key}:${p.permission_key}`)))
      } catch {
        setRolePermissionKeys(new Set())
      }
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
    // Billing gate — a module tied to an unpurchased à-la-carte bundle
    // stays hidden even for admin/ceo, same as the company-wide kill
    // switch below: this is a billing boundary, not a permission one,
    // so role bypasses don't apply to it. Enterprise-plan orgs bypass
    // entirely (matches billing_plans' existing "All modules" meaning).
    const bundleKey = moduleBundleMap[tab]
    if (bundleKey && !isEnterprise && !activeBundleKeys.has(bundleKey)) return false

    const mod = moduleByKey[tab]
    // Company-wide kill switch — overrides everything, even admin/ceo.
    if (mod && mod.enabled === false) return false
    // Admin/CEO bypass per-role visibility (not the kill switch above).
    if (role === 'admin' || role === 'ceo') return true
    return visibilityByRole[role]?.[tab] !== false
  }

  function hasPermission(permissionKey) {
    return rolePermissionKeys.has(`${role}:${permissionKey}`)
  }

  return (
    <Ctx.Provider value={{ modules, visibility, isTabVisible, hasPermission, loading, refresh: load }}>
      {children}
    </Ctx.Provider>
  )
}

export const useTabVisibility = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('useTabVisibility outside provider')
  return c
}
