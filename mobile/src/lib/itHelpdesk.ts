import { supabase } from '@/lib/supabase';

// Mobile port of the web src/lib/itHelpdesk.js (STEP160). Single-org
// module: reads are plain selects (RLS scopes them), mutations go through
// the SECURITY DEFINER RPCs. "Agent" = admin / ceo / manager /
// department_head (see @/lib/roles isItAgent).

export const IT_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const IT_STATUSES = ['open', 'in_progress', 'waiting_on_requester', 'resolved', 'closed'] as const;

export type ItPriority = (typeof IT_PRIORITIES)[number];
export type ItStatus = (typeof IT_STATUSES)[number];

export const IT_STATUS_LABEL: Record<ItStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  waiting_on_requester: 'Waiting on Requester',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const IT_STATUS_COLOR: Record<ItStatus, string> = {
  open: '#0ea5e9',
  in_progress: '#6366f1',
  waiting_on_requester: '#f59e0b',
  resolved: '#15803d',
  closed: '#64748b',
};

export const IT_PRIORITY_COLOR: Record<ItPriority, string> = {
  low: '#64748b',
  medium: '#0ea5e9',
  high: '#f59e0b',
  urgent: '#dc2626',
};

export type ItCategory = { id: string; key: string; label: string; sort_order: number; is_active: boolean };

export type ItTicket = {
  id: string;
  ticket_number: string;
  subject: string;
  description: string;
  category: string;
  priority: ItPriority;
  status: ItStatus;
  requester_id: string;
  assigned_to: string | null;
  first_response_due_at: string | null;
  resolution_due_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  requester: { full_name: string } | null;
  assignee: { full_name: string } | null;
};

export type ItMessage = {
  id: string;
  author_id: string | null;
  body: string;
  is_internal: boolean;
  created_at: string;
  author: { full_name: string } | null;
};

export type ItAgent = { id: string; full_name: string; role: string };

export type ItStats = {
  open_count: number;
  in_progress_count: number;
  waiting_count: number;
  unassigned_count: number;
  resolved_7d: number;
  overdue_response: number;
  overdue_resolution: number;
  avg_resolution_hours: number | null;
};

const TICKET_SELECT =
  '*, requester:profiles!requester_id(full_name), assignee:profiles!assigned_to(full_name)';

export type TicketScope = 'mine' | 'assigned' | 'unassigned' | 'all';

/* ── config ── */

export async function ensureSeed() {
  const { error } = await supabase.rpc('ensure_it_helpdesk_seed');
  if (error) throw error;
}

export async function listCategories(): Promise<ItCategory[]> {
  const { data, error } = await supabase
    .from('it_helpdesk_categories')
    .select('*')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as ItCategory[];
}

/* ── tickets ── */

export async function listTickets(scope: TicketScope, userId?: string): Promise<ItTicket[]> {
  let q = supabase.from('it_helpdesk_tickets').select(TICKET_SELECT).order('created_at', { ascending: false }).limit(200);
  if (scope === 'mine' && userId) q = q.eq('requester_id', userId);
  if (scope === 'assigned' && userId) q = q.eq('assigned_to', userId);
  if (scope === 'unassigned') q = q.is('assigned_to', null).not('status', 'in', '(resolved,closed)');
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as ItTicket[];
}

export async function getTicket(id: string): Promise<ItTicket | null> {
  const { data, error } = await supabase.from('it_helpdesk_tickets').select(TICKET_SELECT).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as ItTicket | null;
}

export async function createTicket(input: { subject: string; description: string; category: string; priority: ItPriority }) {
  const { data, error } = await supabase.rpc('create_it_ticket', {
    p_subject: input.subject,
    p_description: input.description,
    p_category: input.category,
    p_priority: input.priority,
  });
  if (error) throw error;
  return data as string; // new ticket id
}

export async function assignTicket(ticketId: string, assignee: string | null) {
  const { error } = await supabase.rpc('assign_it_ticket', { p_ticket_id: ticketId, p_assignee: assignee });
  if (error) throw error;
}

export async function updateStatus(ticketId: string, status: ItStatus) {
  const { error } = await supabase.rpc('update_it_ticket_status', { p_ticket_id: ticketId, p_status: status });
  if (error) throw error;
}

export async function updatePriority(ticketId: string, priority: ItPriority) {
  const { error } = await supabase.rpc('update_it_ticket_priority', { p_ticket_id: ticketId, p_priority: priority });
  if (error) throw error;
}

/* ── messages ── */

export async function listMessages(ticketId: string): Promise<ItMessage[]> {
  const { data, error } = await supabase
    .from('it_helpdesk_ticket_messages')
    .select('*, author:profiles!author_id(full_name)')
    .eq('ticket_id', ticketId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as unknown as ItMessage[];
}

export async function postMessage(ticketId: string, body: string, isInternal = false) {
  const { data, error } = await supabase.rpc('post_it_ticket_message', {
    p_ticket_id: ticketId,
    p_body: body,
    p_is_internal: isInternal,
  });
  if (error) throw error;
  return data as string;
}

/* ── agents + stats ── */

export async function listItAgents(): Promise<ItAgent[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .in('role', ['admin', 'ceo', 'manager', 'department_head'])
    .eq('is_active', true)
    .order('full_name');
  if (error) throw error;
  return (data ?? []) as ItAgent[];
}

export async function getStats(): Promise<ItStats | null> {
  const { data, error } = await supabase.rpc('it_helpdesk_stats');
  if (error) throw error;
  return (data?.[0] ?? null) as ItStats | null;
}

/* ── helpers ── */

export function isOverdue(dueAt: string | null, alreadyMet: boolean) {
  return !!dueAt && !alreadyMet && new Date(dueAt) < new Date();
}
