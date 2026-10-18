import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/context/AuthContext';
import { haptic } from '@/lib/haptics';
import { isManager } from '@/lib/roles';
import {
  actOnTimesheet, getMyMonth, listPendingTimesheets, submitTimesheet, type TimeLog,
} from '@/lib/timesheet';

export const tsk = {
  month: (uid: string | undefined, m: number, y: number) => ['timesheet', 'month', uid, m, y] as const,
  pending: (role?: string) => ['timesheet', 'pending', role] as const,
};

export function useMyTimesheetMonth(month: number, year: number) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: tsk.month(profile?.id, month, year),
    queryFn: () => getMyMonth(profile!.id, month, year),
    enabled: !!profile?.id,
  });
}

export function useSubmitTimesheet(month: number, year: number) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (args: { note: string; logs: TimeLog[]; existingId?: string }) =>
      submitTimesheet({ userId: profile!.id, month, year, ...args }),
    onSuccess: () => {
      haptic.success();
      qc.invalidateQueries({ queryKey: tsk.month(profile?.id, month, year) });
      qc.invalidateQueries({ queryKey: ['timesheet', 'pending'] });
    },
    onError: () => haptic.error(),
  });
}

export function usePendingTimesheets() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: tsk.pending(profile?.role),
    queryFn: () => listPendingTimesheets(profile!.role),
    enabled: !!profile?.role && isManager(profile.role),
  });
}

export function useActOnTimesheet() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (args: { approvalId: string; status: string; action: 'approve' | 'reject'; comment: string }) =>
      actOnTimesheet({ ...args, approverId: profile!.id, approverRole: profile!.role }),
    onSuccess: () => { haptic.success(); qc.invalidateQueries({ queryKey: ['timesheet'] }); },
    onError: () => haptic.error(),
  });
}
