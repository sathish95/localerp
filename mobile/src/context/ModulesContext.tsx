import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { useAuth } from '@/context/AuthContext';
import {
  fetchEffectiveModules,
  TAB_MODULE_GATES,
  type EffectiveModule,
  type ModuleReason,
} from '@/lib/modules';

type ModulesCtx = {
  /** false until the first resolve attempt finishes — render a splash meanwhile. */
  ready: boolean;
  loading: boolean;
  /** non-null when the resolver call failed; the context then fails OPEN. */
  error: string | null;
  modules: EffectiveModule[];
  /** allowed on mobile for this user right now. Fails open on `error`. */
  isAllowed: (moduleKey: string) => boolean;
  reasonFor: (moduleKey: string) => ModuleReason | null;
  /** a bottom-tab route name (see TAB_MODULE_GATES); unlisted routes are always true. */
  isTabAllowed: (routeName: string) => boolean;
  refresh: () => void;
};

const Ctx = createContext<ModulesCtx | null>(null);

export function ModulesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [modules, setModules] = useState<EffectiveModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setModules([]);
      setError(null);
      setReady(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setModules(await fetchEffectiveModules());
    } catch (e) {
      // Fail open — same posture as the web TabVisibilityContext — so a
      // not-yet-migrated backend (missing RPC) or a transient network
      // error never bricks navigation.
      setError(e instanceof Error ? e.message : String(e));
      setModules([]);
    } finally {
      setLoading(false);
      setReady(true);
    }
  }, [user]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-resolve only when the signed-in user changes
  useEffect(() => { load(); }, [user?.id]);

  const isAllowed = useCallback(
    (moduleKey: string) => {
      if (error) return true; // fail open
      const m = modules.find((x) => x.module_key === moduleKey);
      return m ? m.allowed : false;
    },
    [modules, error],
  );

  const reasonFor = useCallback(
    (moduleKey: string) => modules.find((x) => x.module_key === moduleKey)?.reason ?? null,
    [modules],
  );

  const isTabAllowed = useCallback(
    (routeName: string) => {
      const gates = TAB_MODULE_GATES[routeName];
      if (!gates) return true; // foundational route
      return gates.some((k) => isAllowed(k));
    },
    [isAllowed],
  );

  return (
    <Ctx.Provider value={{ ready, loading, error, modules, isAllowed, reasonFor, isTabAllowed, refresh: load }}>
      {children}
    </Ctx.Provider>
  );
}

export function useEffectiveModules() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useEffectiveModules outside ModulesProvider');
  return c;
}
