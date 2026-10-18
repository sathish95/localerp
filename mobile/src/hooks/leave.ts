import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/context/AuthContext';
import { haptic } from '@/lib/haptics';
import { createLeaveRequest, getLeaveData } from '@/lib/leave';

export const lvk = {
  data: (uid?: string) => ['leave', 'data', uid] as const,
};

export function useLeaveData() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: lvk.data(profile?.id),
    queryFn: () => getLeaveData(profile!.id),
    enabled: !!profile?.id,
  });
}

export function useCreateLeaveRequest() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (input: {
      leaveType: string; fromDate: string; toDate: string; reason: string;
      permissionDate?: string; permissionHours?: number;
    }) => createLeaveRequest(profile!.id, input),
    onSuccess: () => { haptic.success(); qc.invalidateQueries({ queryKey: lvk.data(profile?.id) }); },
    onError: () => haptic.error(),
  });
}
