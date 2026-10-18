import { supabase } from './supabase'

// Internal IT Helpdesk (STEP157). Single-org module: every table is
// organization_id = current_org_id() scoped, so unlike supportDesk.js
// the list/detail reads here are plain client selects with embedded
// profile joins (requester and agent are always in the caller's own org,
// so profiles' org-scoped RLS resolves them fine). Only mutations go
// through the SECURITY DEFINER RPCs, which keep status ↔ SLA stamps ↔
// notifications consistent.
//
// "Agent" = a profile whose role is admin / ceo / manager /
// department_head (it_helpdesk_is_agent() in SQL). The UI derives the
// same check from useAuth().profile.role via IT_AGENT_ROLES below.

export const IT_AGENT_ROLES = ['admin', 'ceo', 'manager', 'department_head']
export const IT_PRIORITIES  = ['low', 'medium', 'high', 'urgent']
export const IT_STATUSES    = ['open', 'in_progress', 'waiting_on_requester', 'resolved', 'closed']

export const IT_STATUS_LABELS = {
  open: 'Open', in_progress: 'In Progress', waiting_on_requester: 'Waiting on Requester',
  resolved: 'Resolved', closed: 'Closed',
}
export const IT_PRIORITY_COLORS = { low: '#64748b', medium: '#0ea5e9', high: '#f59e0b', urgent: '#dc2626' }

export const isItAgent = role => IT_AGENT_ROLES.includes(role)

/* ═══ Config ═══ */

export async function ensureSeed() {
  const { error } = await supabase.rpc('ensure_it_helpdesk_seed')
  if (error) throw error
}

export async function listCategories({ activeOnly = false } = {}) {
  let q = supabase.from('it_helpdesk_categories').select('*').order('sort_order')
  if (activeOnly) q = q.eq('is_active', true)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function upsertCategory(row) {
  const { error } = await supabase.from('it_helpdesk_categories')
    .upsert(row, { onConflict: 'organization_id,key' })
  if (error) throw error
}

export async function setCategoryActive(id, is_active) {
  const { error } = await supabase.from('it_helpdesk_categories').update({ is_active }).eq('id', id)
  if (error) throw error
}

export async function deleteCategory(id) {
  const { error } = await supabase.from('it_helpdesk_categories').delete().eq('id', id)
  if (error) throw error
}

export async function listSlaPolicies() {
  const { data, error } = await supabase.from('it_helpdesk_sla_policies').select('*')
  if (error) throw error
  const order = { urgent: 0, high: 1, medium: 2, low: 3 }
  return (data || []).sort((a, b) => order[a.priority] - order[b.priority])
}

export async function updateSlaPolicy(id, fields, userId) {
  const { error } = await supabase.from('it_helpdesk_sla_policies')
    .update({ ...fields, updated_by: userId || null, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function listAssignmentRules() {
  const { data, error } = await supabase.from('it_helpdesk_assignment_rules')
    .select('*, assignee:profiles!assigned_to(full_name)').order('sort_order')
  if (error) throw error
  return data || []
}

export async function createAssignmentRule(row) {
  const { error } = await supabase.from('it_helpdesk_assignment_rules').insert(row)
  if (error) throw error
}

export async function setAssignmentRuleActive(id, is_active) {
  const { error } = await supabase.from('it_helpdesk_assignment_rules').update({ is_active }).eq('id', id)
  if (error) throw error
}

export async function deleteAssignmentRule(id) {
  const { error } = await supabase.from('it_helpdesk_assignment_rules').delete().eq('id', id)
  if (error) throw error
}

/* ═══ Agents (assignment targets) ═══ */

export async function listItAgents() {
  const { data, error } = await supabase.from('profiles')
    .select('id, full_name, role').in('role', IT_AGENT_ROLES).eq('is_active', true).order('full_name')
  if (error) throw error
  return data || []
}

/* ═══ Tickets ═══ */

const TICKET_SELECT =
  '*, requester:profiles!requester_id(full_name), assignee:profiles!assigned_to(full_name)'

// Requesters see only their own; RLS returns everything an agent may see,
// so `scope` just narrows the agent view client-side.
export async function listTickets({ scope = 'mine', userId } = {}) {
  let q = supabase.from('it_helpdesk_tickets').select(TICKET_SELECT).order('created_at', { ascending: false }).limit(300)
  if (scope === 'mine' && userId) q = q.eq('requester_id', userId)
  if (scope === 'assigned' && userId) q = q.eq('assigned_to', userId)
  if (scope === 'unassigned') q = q.is('assigned_to', null).not('status', 'in', '(resolved,closed)')
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function getTicket(id) {
  const { data, error } = await supabase.from('it_helpdesk_tickets').select(TICKET_SELECT).eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export async function createTicket({ subject, description, category, priority }) {
  const { data, error } = await supabase.rpc('create_it_ticket', {
    p_subject: subject, p_description: description, p_category: category, p_priority: priority || 'medium',
  })
  if (error) throw error
  return data
}

export async function assignTicket(ticketId, assignee) {
  const { error } = await supabase.rpc('assign_it_ticket', { p_ticket_id: ticketId, p_assignee: assignee || null })
  if (error) throw error
}

export async function updateStatus(ticketId, status) {
  const { error } = await supabase.rpc('update_it_ticket_status', { p_ticket_id: ticketId, p_status: status })
  if (error) throw error
}

export async function updatePriority(ticketId, priority) {
  const { error } = await supabase.rpc('update_it_ticket_priority', { p_ticket_id: ticketId, p_priority: priority })
  if (error) throw error
}

/* ═══ Messages ═══ */

export async function listMessages(ticketId) {
  const { data, error } = await supabase.from('it_helpdesk_ticket_messages')
    .select('*, author:profiles!author_id(full_name)').eq('ticket_id', ticketId).order('created_at')
  if (error) throw error
  return data || []
}

export async function postMessage(ticketId, body, isInternal = false) {
  const { data, error } = await supabase.rpc('post_it_ticket_message', {
    p_ticket_id: ticketId, p_body: body, p_is_internal: isInternal,
  })
  if (error) throw error
  return data
}

/* ═══ Dashboard ═══ */

export async function getStats() {
  const { data, error } = await supabase.rpc('it_helpdesk_stats')
  if (error) throw error
  return data?.[0] || null
}

/* ═══ Helpers ═══ */

export function isOverdue(dueAt, alreadyMet) {
  return !!dueAt && !alreadyMet && new Date(dueAt) < new Date()
}
