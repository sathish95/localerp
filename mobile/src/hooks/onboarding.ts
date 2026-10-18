import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/context/AuthContext';
import { listTourSteps, markTourSeen } from '@/lib/appWalkthrough';

// The pre-login walkthrough (Splash -> Walkthrough -> Login) is
// hardcoded, device-local content — see lib/preLoginWalkthrough.ts — and
// has no react-query hook of its own. Only the post-login, org-scoped
// guided tour is server-fetched.
export const obhk = {
  tour: (orgId?: string) => ['onboarding', 'tour', orgId] as const,
};

export function useTourSteps() {
  const { profile } = useAuth();
  const orgId = profile?.org?.id;
  return useQuery({
    queryKey: obhk.tour(orgId),
    queryFn: () => listTourSteps(orgId!),
    enabled: !!orgId,
    staleTime: 5 * 60_000,
  });
}

export function useMarkTourSeen() {
  const { profile, refreshProfile } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => markTourSeen(profile!.id),
    onSuccess: () => { refreshProfile(); qc.invalidateQueries({ queryKey: ['onboarding'] }); },
  });
}
