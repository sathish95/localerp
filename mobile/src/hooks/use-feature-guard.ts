import { useEffectiveModules } from '@/context/ModulesContext';

// Screen-level defence in depth for /feature/* routes: even though a
// locked module's Discover card is hidden, a deep link or stale nav
// could still land here. `blocked` is true only once the resolver has
// answered AND says no — while it's still resolving (or failed open) we
// let the screen render.
export function useFeatureGuard(moduleKey: string) {
  const { ready, isAllowed } = useEffectiveModules();
  return { blocked: ready && !isAllowed(moduleKey) };
}
