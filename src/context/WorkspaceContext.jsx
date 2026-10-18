// Industry-Adaptive Platform — Phase 1 (STEP180). Loads this org's
// workspace_profiles row and exposes it + a terminology lookup helper.
// Deliberately inert in this phase: nothing in the app calls useWorkspace()
// yet, so this provider fetches and stores state but changes no rendered
// output anywhere. Phase 3 wires term()/workspace into navigation and
// forms; Phase 2 wires the onboarding flow that actually sets
// industry/business type for new orgs. Mirrors TabVisibilityContext.jsx's
// provider/hook shape (load-on-org-change, fail-open on missing org).
import { createContext, useContext, useState, useEffect } from 'react'
import { useAuth } from './AuthContext'
import { getWorkspaceProfile } from '../lib/workspace'
import { TERMINOLOGY_DEFAULTS } from '../lib/terminologyDefaults'

const Ctx = createContext(null)

export function WorkspaceProvider({ children }) {
  const { profile } = useAuth()
  const orgId = profile?.organization_id || null
  const [workspace, setWorkspace] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [orgId])

  async function load() {
    // No org resolved yet (mid-signup) — same fail-open posture as
    // TabVisibilityContext: skip the fetch rather than querying with a
    // null org id, leave workspace null (term() below falls back safely).
    if (!orgId) { setWorkspace(null); setLoading(false); return }
    setLoading(true)
    try {
      const ws = await getWorkspaceProfile(orgId)
      setWorkspace(ws)
    } catch {
      // Fails open — an unmigrated database (STEP180 not yet run) or a
      // transient error must not break the app shell that renders around
      // this provider; every existing org's UI is unaffected either way
      // since nothing reads `workspace` yet in this phase.
      setWorkspace(null)
    } finally {
      setLoading(false)
    }
  }

  const isLegacyDefault = workspace?.is_legacy_default !== false

  // Terminology lookup — presentation-only override, never renames a
  // database table/column (see TARGET_ARCHITECTURE.md's Experience vs.
  // Domain layer split). Resolution order: this org's own explicit
  // override (terminology_overrides, empty '{}' for every org that
  // hasn't set one via Settings) -> this org's industry's default label
  // (TERMINOLOGY_DEFAULTS, only populated for industries the master
  // prompt gives explicit examples for) -> `fallback`, the current
  // hardcoded English label already in the JSX. Every existing org has
  // industry_profile = null and terminology_overrides = {}, so both
  // lookups miss and this unconditionally returns `fallback` — a no-op.
  function term(key, fallback) {
    const orgOverride = workspace?.terminology_overrides?.[key]
    if (orgOverride) return orgOverride
    const industryKey = workspace?.industry_profile?.key
    const industryDefault = industryKey ? TERMINOLOGY_DEFAULTS[industryKey]?.[key] : undefined
    return industryDefault ?? fallback
  }

  return (
    <Ctx.Provider value={{ workspace, isLegacyDefault, term, loading, refresh: load }}>
      {children}
    </Ctx.Provider>
  )
}

export const useWorkspace = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('useWorkspace outside provider')
  return c
}
