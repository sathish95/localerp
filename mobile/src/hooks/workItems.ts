import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/context/AuthContext';
import {
  createTaskForWorkItem, createWorkItem, getWorkItem, getWorkItemHoursSummary,
  listTasksForWorkItem, listWorkItems, listWorkTypeConfigs,
  type WorkItemFilters,
} from '@/lib/workItems';

export const wihk = {
  typeConfigs: () => ['work-items', 'type-configs'] as const,
  list: (filters: WorkItemFilters) => ['work-items', 'list', filters] as const,
  detail: (id: string) => ['work-items', 'detail', id] as const,
  tasks: (id: string) => ['work-items', 'tasks', id] as const,
  hours: (id: string) => ['work-items', 'hours', id] as const,
};

export function useWorkTypeConfigs() {
  return useQuery({ queryKey: wihk.typeConfigs(), queryFn: listWorkTypeConfigs, staleTime: 10 * 60_000 });
}

export function useWorkItems(filters: WorkItemFilters = {}) {
  return useQuery({ queryKey: wihk.list(filters), queryFn: () => listWorkItems(filters) });
}

export function useWorkItem(id: string) {
  return useQuery({ queryKey: wihk.detail(id), queryFn: () => getWorkItem(id), enabled: !!id });
}

export function useTasksForWorkItem(id: string) {
  return useQuery({ queryKey: wihk.tasks(id), queryFn: () => listTasksForWorkItem(id), enabled: !!id });
}

export function useWorkItemHours(id: string) {
  return useQuery({ queryKey: wihk.hours(id), queryFn: () => getWorkItemHoursSummary(id), enabled: !!id });
}

export function useCreateWorkItem() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof createWorkItem>[0]) => createWorkItem(payload, profile!.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-items', 'list'] }),
  });
}

export function useCreateTaskForWorkItem(workItemId: string) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof createTaskForWorkItem>[1]) => createTaskForWorkItem(workItemId, input, profile!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: wihk.tasks(workItemId) });
      qc.invalidateQueries({ queryKey: wihk.detail(workItemId) });
      qc.invalidateQueries({ queryKey: ['work-items', 'list'] });
    },
  });
}
