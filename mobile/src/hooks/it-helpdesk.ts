import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/context/AuthContext';
import { haptic } from '@/lib/haptics';
import { isItAgent } from '@/lib/roles';
import {
  assignTicket, createTicket, getStats, getTicket, listCategories, listItAgents, listMessages,
  listTickets, postMessage, updatePriority, updateStatus,
  type ItPriority, type ItStatus, type TicketScope,
} from '@/lib/itHelpdesk';

export const ithk = {
  tickets: (scope: TicketScope, uid?: string) => ['it-helpdesk', 'tickets', scope, uid] as const,
  ticket: (id: string) => ['it-helpdesk', 'ticket', id] as const,
  messages: (id: string) => ['it-helpdesk', 'messages', id] as const,
  categories: () => ['it-helpdesk', 'categories'] as const,
  agents: () => ['it-helpdesk', 'agents'] as const,
  stats: () => ['it-helpdesk', 'stats'] as const,
};

export function useItTickets(scope: TicketScope) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ithk.tickets(scope, profile?.id),
    queryFn: () => listTickets(scope, profile?.id),
    enabled: !!profile?.id,
  });
}

export function useItTicket(id: string) {
  return useQuery({ queryKey: ithk.ticket(id), queryFn: () => getTicket(id), enabled: !!id });
}

export function useItMessages(id: string) {
  return useQuery({ queryKey: ithk.messages(id), queryFn: () => listMessages(id), enabled: !!id });
}

export function useItCategories() {
  return useQuery({ queryKey: ithk.categories(), queryFn: listCategories, staleTime: 10 * 60_000 });
}

export function useItAgents() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ithk.agents(),
    queryFn: listItAgents,
    enabled: isItAgent(profile?.role),
    staleTime: 10 * 60_000,
  });
}

export function useItStats() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ithk.stats(),
    queryFn: getStats,
    enabled: isItAgent(profile?.role),
  });
}

// Invalidate every ticket list + the stats after a mutation, regardless
// of which scope/user key is cached.
function useInvalidateItLists() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['it-helpdesk', 'tickets'] });
    qc.invalidateQueries({ queryKey: ithk.stats() });
  };
}

export function useCreateItTicket() {
  const invalidate = useInvalidateItLists();
  return useMutation({
    mutationFn: (input: { subject: string; description: string; category: string; priority: ItPriority }) =>
      createTicket(input),
    onSuccess: () => { haptic.success(); invalidate(); },
    onError: () => haptic.error(),
  });
}

export function usePostItMessage(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { body: string; isInternal?: boolean }) =>
      postMessage(ticketId, args.body, args.isInternal ?? false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ithk.messages(ticketId) });
      qc.invalidateQueries({ queryKey: ithk.ticket(ticketId) });
    },
  });
}

export function useItTicketActions(ticketId: string) {
  const qc = useQueryClient();
  const invalidateLists = useInvalidateItLists();
  const refreshOne = () => {
    qc.invalidateQueries({ queryKey: ithk.ticket(ticketId) });
    invalidateLists();
  };

  const assign = useMutation({
    mutationFn: (assignee: string | null) => assignTicket(ticketId, assignee),
    onSuccess: refreshOne,
  });
  const setStatus = useMutation({
    mutationFn: (status: ItStatus) => updateStatus(ticketId, status),
    onSuccess: refreshOne,
  });
  const setPriority = useMutation({
    mutationFn: (priority: ItPriority) => updatePriority(ticketId, priority),
    onSuccess: refreshOne,
  });

  return { assign, setStatus, setPriority };
}
