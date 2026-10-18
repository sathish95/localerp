import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { useAuth } from '@/context/AuthContext';
import { getWorkspaceProfile, type WorkspaceProfile } from '@/lib/workspace';
import { TERMINOLOGY_DEFAULTS } from '@/lib/terminologyDefaults';

// Industry-Adaptive Platform — mobile port of src/context/WorkspaceContext.jsx.
// Mirrors ModulesContext.tsx's shape (load-on-user-change, fail-open on
// error/missing org) rather than reinventing a pattern. Read-only: no
// mutate/refresh-after-write path is needed since mobile never writes a
// workspace_profiles row.
type WorkspaceCtx = {
  workspace: WorkspaceProfile | null;
  isLegacyDefault: boolean;
  loading: boolean;
  term: (key: string, fallback: string) => string;
  refresh: () => void;
};

const Ctx = createContext<WorkspaceCtx | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const orgId = profile?.org?.id ?? null;
  const [workspace, setWorkspace] = useState<WorkspaceProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // No org resolved yet — same fail-open posture as ModulesContext and
    // the web WorkspaceContext: skip the fetch, leave workspace null so
    // term() safely falls back to its `fallback` argument everywhere.
    if (!orgId) {
      setWorkspace(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setWorkspace(await getWorkspaceProfile(orgId));
    } catch {
      // Fails open — an unmigrated database (STEP180 not yet run) or a
      // transient error must never block the app shell around this
      // provider. Every screen this feeds treats `workspace: null`
      // identically to "no workspace configured."
      setWorkspace(null);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-resolve only when the signed-in org changes
  useEffect(() => { load(); }, [orgId]);

  const isLegacyDefault = workspace?.is_legacy_default !== false;

  // Same resolution order as web: org's own override -> industry default
  // -> fallback (today's hardcoded label). Every existing org has
  // industry_profile: null and terminology_overrides: {}, so both
  // lookups miss and this unconditionally returns `fallback` — a no-op.
  const term = useCallback(
    (key: string, fallback: string): string => {
      const orgOverride = workspace?.terminology_overrides?.[key];
      if (orgOverride) return orgOverride;
      const industryKey = workspace?.industry_profile?.key;
      const industryDefault = industryKey ? TERMINOLOGY_DEFAULTS[industryKey]?.[key] : undefined;
      return industryDefault ?? fallback;
    },
    [workspace],
  );

  return (
    <Ctx.Provider value={{ workspace, isLegacyDefault, loading, term, refresh: load }}>
      {children}
    </Ctx.Provider>
  );
}

export function useWorkspace() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useWorkspace outside WorkspaceProvider');
  return c;
}
