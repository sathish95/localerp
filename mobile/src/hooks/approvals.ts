import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/context/AuthContext';
import { applyApproval, listApprovalItems, type ApprovalItem } from '@/lib/approvals';
import type { ApprovalAction } from '@/lib/approvalFlow';
import { haptic } from '@/lib/haptics';

export const apk = {
  items: (role?: string) => ['approvals', 'items', role] as const,
};

export function useApprovalItems() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: apk.items(profile?.role),
    queryFn: () => listApprovalItems(profile!.role),
    enabled: !!profile?.role,
  });
}

export function useApplyApproval() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (args: { item: ApprovalItem; action: ApprovalAction; note: string }) =>
      applyApproval({ ...args, approverRole: profile!.role, profileId: profile!.id }),
    onSuccess: () => {
      haptic.success();
      qc.invalidateQueries({ queryKey: ['approvals'] });
      // A decision also changes the requester-facing lists / Home counters.
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['travel'] });
    },
    onError: () => haptic.error(),
  });
}
