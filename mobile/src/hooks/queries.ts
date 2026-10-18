import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/context/AuthContext';
import { getActiveLog, getWeekLogs, listRecentLogs, type ActiveLog } from '@/lib/checkin';
import { listAnnouncements, listNewJoinees, listRecentAwardWinners } from '@/lib/orgHome';
import {
  createExpense, createTravel, listMyExpenses, listMyTravel, listProjects, type Project,
} from '@/lib/requests';
import { listMyTasks, setTaskStatus, type MyTask, type TaskStatus } from '@/lib/tasks';

// Centralised keys so screens and mutations stay in sync.
export const qk = {
  tasks: (uid?: string) => ['tasks', 'mine', uid] as const,
  expenses: (uid?: string) => ['expenses', 'mine', uid] as const,
  travel: (uid?: string) => ['travel', 'mine', uid] as const,
  projects: () => ['projects'] as const,
  checkinActive: (uid?: string) => ['checkin', 'active', uid] as const,
  checkinRecent: (uid?: string) => ['checkin', 'recent', uid] as const,
  checkinWeek: (uid?: string, weekStart?: string) => ['checkin', 'week', uid, weekStart] as const,
  announcements: () => ['org', 'announcements'] as const,
  newJoinees: () => ['org', 'new-joinees'] as const,
  awardWinners: () => ['org', 'award-winners'] as const,
};

/* ── Tasks ── */

export function useMyTasks() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: qk.tasks(profile?.id),
    queryFn: () => listMyTasks(profile!.id),
    enabled: !!profile?.id,
  });
}

export function useSetTaskStatus() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const key = qk.tasks(profile?.id);
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => setTaskStatus(id, status),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<MyTask[]>(key);
      qc.setQueryData<MyTask[]>(key, (old) => old?.map((x) => (x.id === id ? { ...x, status } : x)));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

/* ── Expense & Travel ── */

export function useMyExpenses() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: qk.expenses(profile?.id),
    queryFn: () => listMyExpenses(profile!.id),
    enabled: !!profile?.id,
  });
}

export function useMyTravel() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: qk.travel(profile?.id),
    queryFn: () => listMyTravel(profile!.id),
    enabled: !!profile?.id,
  });
}

export function useProjects() {
  return useQuery({ queryKey: qk.projects(), queryFn: listProjects, staleTime: 5 * 60_000 });
}

type ExpenseForm = Parameters<typeof createExpense>[1];
type TravelForm = Parameters<typeof createTravel>[1];

export function useCreateExpense() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (args: { form: ExpenseForm; receiptUri: string | null; projects: Project[] }) =>
      createExpense(profile!.id, args.form, args.receiptUri, args.projects),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.expenses(profile?.id) });
      qc.invalidateQueries({ queryKey: qk.projects() });
    },
  });
}

export function useCreateTravel() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (args: { form: TravelForm; projects: Project[] }) =>
      createTravel(profile!.id, args.form, args.projects),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.travel(profile?.id) });
      qc.invalidateQueries({ queryKey: qk.projects() });
    },
  });
}

/* ── Check-in ── */

export function useActiveLog() {
  const { profile } = useAuth();
  return useQuery<ActiveLog | null>({
    queryKey: qk.checkinActive(profile?.id),
    queryFn: () => getActiveLog(profile!.id),
    enabled: !!profile?.id,
  });
}

export function useRecentCheckinLogs(limit = 10) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: qk.checkinRecent(profile?.id),
    queryFn: () => listRecentLogs(profile!.id, limit),
    enabled: !!profile?.id,
  });
}

export function useWeekCheckinLogs(startDate: string, endDate: string) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: qk.checkinWeek(profile?.id, startDate),
    queryFn: () => getWeekLogs(profile!.id, startDate, endDate),
    enabled: !!profile?.id,
  });
}

// Broad ['checkin', ...] prefix invalidation — a check-in/out should
// refresh the active session, the week total, and recent history together.
export function useInvalidateCheckin() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['checkin'] });
}

/* ── Org home ── */

export function useAnnouncements() {
  return useQuery({ queryKey: qk.announcements(), queryFn: listAnnouncements });
}

export function useNewJoinees(days = 60) {
  return useQuery({ queryKey: qk.newJoinees(), queryFn: () => listNewJoinees(days) });
}

export function useAwardWinners(limit = 8) {
  return useQuery({ queryKey: qk.awardWinners(), queryFn: () => listRecentAwardWinners(limit) });
}
