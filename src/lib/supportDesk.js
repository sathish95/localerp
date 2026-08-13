import { supabase } from './supabase'

// Platform Support Desk — thin wrappers matching every other domain
// file in src/lib/: RLS (STEP153/154) + the SECURITY DEFINER functions
// (STEP155) do the real validation/authorization work. Any employee can
// create a ticket; only platform staff (is_platform_super_admin) can
// assign/reassign, change status/priority, or post an internal note.
//
// Every list/detail read below goes through an RPC rather than a plain
// embedded-join select (e.g. `.select('*, agent:profiles(...)')`) —
// profiles' own RLS (organization_id = current_org_id() OR id =
// auth.uid()) has no cross-org bypass for platform staff, so an
// embedded join would silently return null for any joined profile
// outside the viewer's own org. That's true on BOTH sides here: an org
// employee's ticket has an agent from a different org, and a platform
// agent's queue has creators from every org but their own. The RPCs in
// STEP155 resolve names server-side instead of widening profiles' RLS
// for the whole app just to fix this one join.

export const CATEGORIES = ['billing', 'technical', 'feature_request', 'account', 'onboarding', 'general']
export const PRIORITIES = ['low', 'medium', 'high', 'urgent']
export const STATUSES = ['open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed']

/* ═══ Tickets ═══ */

export async function listMyOrgTickets() {
  const { data, error } = await supabase.rpc('list_my_org_tickets')
  if (error) throw error
  return data || []
}

export async function listAllTickets() {
  const { data, error } = await supabase.rpc('list_all_support_tickets')
  if (error) throw error
  return data || []
}

export async function getTicket(id) {
  const { data, error } = await supabase.rpc('get_ticket_detail', { p_ticket_id: id })
  if (error) throw error
  return data?.[0] || null
}

export async function createTicket({ subject, description, category, priority, projectId }) {
  const { data, error } = await supabase.rpc('create_support_ticket', {
    p_subject: subject, p_description: description, p_category: category || 'general', p_priority: priority || 'medium',
    p_project_id: projectId || null,
  })
  if (error) throw error
  return data
}

export async function assignTicket(ticketId, agentId) {
  const { error } = await supabase.rpc('assign_ticket', { p_ticket_id: ticketId, p_agent_id: agentId })
  if (error) throw error
}

export async function updateTicketStatus(ticketId, status) {
  const { error } = await supabase.rpc('update_ticket_status', { p_ticket_id: ticketId, p_status: status })
  if (error) throw error
}

export async function updateTicketPriority(ticketId, priority) {
  const { error } = await supabase.rpc('update_ticket_priority', { p_ticket_id: ticketId, p_priority: priority })
  if (error) throw error
}

/* ═══ Messages ═══ */

export async function listMessages(ticketId) {
  const { data, error } = await supabase.rpc('list_ticket_messages', { p_ticket_id: ticketId })
  if (error) throw error
  return data || []
}

export async function postMessage(ticketId, body, isInternalNote = false) {
  const { data, error } = await supabase.rpc('post_ticket_message', { p_ticket_id: ticketId, p_body: body, p_is_internal_note: isInternalNote })
  if (error) throw error
  return data
}

/* ═══ Platform config: SLA policies, agents, assignment rules ═══ */

export async function listSlaPolicies() {
  const { data, error } = await supabase.from('support_sla_policies').select('*').order('first_response_minutes')
  if (error) throw error
  return data || []
}

export async function updateSlaPolicy(id, fields) {
  const { error } = await supabase.from('support_sla_policies').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function listAgents() {
  const { data, error } = await supabase.rpc('list_support_agents')
  if (error) throw error
  return data || []
}

export async function addAgent(profileId) {
  const { error } = await supabase.from('support_agents').insert({ profile_id: profileId })
  if (error) throw error
}

export async function setAgentActive(id, isActive) {
  const { error } = await supabase.from('support_agents').update({ is_active: isActive }).eq('id', id)
  if (error) throw error
}

export async function removeAgent(id) {
  const { error } = await supabase.from('support_agents').delete().eq('id', id)
  if (error) throw error
}

export async function listAssignmentRules() {
  const { data, error } = await supabase.rpc('list_support_assignment_rules')
  if (error) throw error
  return data || []
}

export async function createAssignmentRule({ category, priority, ruleType, assignedAgentId, sortOrder }) {
  const { error } = await supabase.from('support_assignment_rules').insert({
    category: category || null, priority: priority || null, rule_type: ruleType || 'least_loaded',
    assigned_agent_id: ruleType === 'manual_default' ? assignedAgentId : null, sort_order: sortOrder || 0,
  })
  if (error) throw error
}

export async function setAssignmentRuleActive(id, isActive) {
  const { error } = await supabase.from('support_assignment_rules').update({ is_active: isActive }).eq('id', id)
  if (error) throw error
}

export async function deleteAssignmentRule(id) {
  const { error } = await supabase.from('support_assignment_rules').delete().eq('id', id)
  if (error) throw error
}

/* ═══ Platform staff candidate list (for "make this account an agent") ═══ */

export async function listSuperAdmins() {
  const { data, error } = await supabase.rpc('list_platform_staff')
  if (error) throw error
  return data || []
}

/* ═══ "Tag with project" — platform-wide toggle + per-role override,
   mirroring this app's own modules/module_role_visibility pattern:
   a global kill switch plus a per-role table where absence of a row
   means visible. Lives on Support Desk Settings since it's a
   platform-super-admin concern (STEP156). ═══ */

export const ROLE_KEYS = ['admin', 'ceo', 'manager', 'department_head', 'finance', 'hr', 'employee']

export async function getProjectTagConfig() {
  const [{ data: settings, error: e1 }, { data: overrides, error: e2 }] = await Promise.all([
    supabase.from('support_settings').select('project_tag_enabled').eq('singleton', true).single(),
    supabase.from('support_project_tag_role_visibility').select('*'),
  ])
  if (e1) throw e1
  if (e2) throw e2
  return { enabled: settings?.project_tag_enabled !== false, overrides: overrides || [] }
}

export function isProjectTagVisibleForRole(config, role) {
  if (!config?.enabled) return false
  const row = config.overrides?.find(o => o.role_key === role)
  return row ? row.visible : true
}

export async function setProjectTagEnabled(enabled, userId) {
  const { error } = await supabase.from('support_settings').update({ project_tag_enabled: enabled, updated_by: userId, updated_at: new Date().toISOString() }).eq('singleton', true)
  if (error) throw error
}

export async function setProjectTagRoleVisibility(roleKey, visible) {
  const { error } = await supabase.from('support_project_tag_role_visibility').upsert({ role_key: roleKey, visible }, { onConflict: 'role_key' })
  if (error) throw error
}

export async function listOrgProjects() {
  const { data, error } = await supabase.from('projects').select('id, name').eq('status', 'active').order('name')
  if (error) throw error
  return data || []
}
