import { supabase } from './supabase'

// Email service (STEP228). The browser never sends mail itself — it only
// edits settings/preferences/schedules and queues requests through RPCs;
// the send-email Edge Function delivers everything from email_outbox.

// Keys match email_notification_category() in STEP228.
export const EMAIL_CATEGORIES = [
  { key: 'tasks', label: 'Tasks', desc: 'Assigned to you, status changes, overdue work' },
  { key: 'approvals', label: 'Approvals & timesheets', desc: 'Expenses, leave, procurement, timesheet decisions' },
  { key: 'chat', label: 'Chat & mentions', desc: 'Messages and @mentions' },
  { key: 'checkin', label: 'Check-in / check-out', desc: 'Team check-in activity' },
  { key: 'sales', label: 'Sales & CRM', desc: 'Leads, opportunities, tenders' },
  { key: 'announcements', label: 'Announcements', desc: 'Broadcasts and system messages' },
  { key: 'other', label: 'Everything else', desc: 'Any other notification' },
]
export const DEFAULT_PREFS = { mode: 'instant', muted_categories: ['checkin', 'chat'], digest_hour: 18 }

/* ── Organization settings (admin) ── */
export async function getOrgEmailSettings(organizationId) {
  const { data, error } = await supabase.from('org_email_settings').select('*').eq('organization_id', organizationId).maybeSingle()
  if (error) throw error
  return data || { organization_id: organizationId, enabled: false, from_name: '', reply_to: '', timezone: 'Asia/Kolkata', footer_text: '' }
}
export async function saveOrgEmailSettings(organizationId, patch, userId) {
  const row = {
    organization_id: organizationId,
    enabled: !!patch.enabled,
    from_name: patch.from_name?.trim() || null,
    reply_to: patch.reply_to?.trim() || null,
    timezone: patch.timezone || 'Asia/Kolkata',
    footer_text: patch.footer_text?.trim() || null,
    updated_at: new Date().toISOString(), updated_by: userId,
  }
  const { data, error } = await supabase.from('org_email_settings').upsert(row, { onConflict: 'organization_id' }).select().single()
  if (error) throw error
  return data
}
export async function sendTestEmail() {
  const { data, error } = await supabase.rpc('request_test_email')
  if (error) throw error
  return data
}

/* ── Delivery log (admin) ── */
export async function listEmailLog(organizationId, limit = 50) {
  const { data, error } = await supabase.from('email_outbox')
    .select('id, to_email, to_name, template, subject, status, attempts, last_error, created_at, sent_at')
    .eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data || []
}

/* ── Personal preferences (every user) ── */
export async function getMyEmailPrefs(userId) {
  const { data, error } = await supabase.from('email_preferences').select('mode, muted_categories, digest_hour').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data || { ...DEFAULT_PREFS }
}
export async function saveMyEmailPrefs(userId, organizationId, prefs) {
  const { error } = await supabase.from('email_preferences').upsert({
    user_id: userId, organization_id: organizationId,
    mode: prefs.mode, muted_categories: prefs.muted_categories, digest_hour: Number(prefs.digest_hour),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (error) throw error
}

/* ── Scheduled report emails (managers) ── */
// Who may create each report type — mirrors can_manage_report_type() (STEP230, enforced by RLS).
const MANAGERS = ['admin', 'ceo', 'manager', 'department_head', 'hr', 'finance']
export const REPORT_TYPES = [
  { key: 'ceo_briefing', label: 'CEO executive briefing', audience: 'Leadership', desc: 'One-page scorecard: cash, spend, pipeline, headcount, delivery with trends; project health, top risks and wins', roles: ['admin', 'ceo', 'finance'], defaults: { name: 'Weekly executive briefing', period: 'weekly', send_weekday: 1, send_hour: 8, send_minute: 30, coverage: 'previous' } },
  { key: 'monthly_summary', label: 'Monthly management report', audience: 'Leadership', desc: 'Highlights, risks, delivery by project, people and a finance snapshot', roles: ['admin', 'ceo', 'finance'], defaults: { name: 'Monthly management report', period: 'monthly', send_monthday: 1, send_hour: 9, send_minute: 0, coverage: 'previous' } },
  { key: 'financial', label: 'Financial report', audience: 'Finance', desc: 'Received, invoiced, spent, receivables ageing, spend by category, approvals pending, budget and margin by project', roles: ['admin', 'ceo', 'finance'], defaults: { name: 'Monthly financial report', period: 'monthly', send_monthday: 1, send_hour: 9, send_minute: 0, coverage: 'previous' } },
  { key: 'hr_people', label: 'HR people report', audience: 'HR', desc: 'Headcount, joiners, attendance, late arrivals, missed check-outs, leave taken / upcoming / pending, timesheets, anniversaries', roles: ['admin', 'ceo', 'hr'], defaults: { name: 'Weekly people report', period: 'weekly', send_weekday: 1, send_hour: 9, send_minute: 0, coverage: 'previous' } },
  { key: 'manager_team', label: 'Manager team report', audience: 'Managers', desc: 'Each manager gets their own: direct reports’ attendance and output, who needs work planned for the next day, and approvals waiting for them', roles: MANAGERS, defaults: { name: 'Your team', period: 'daily', send_hour: 18, send_minute: 0, coverage: 'to_date', weekdays_only: true } },
  { key: 'project_status', label: 'Project status', audience: 'Delivery', desc: 'Health, progress, budget, milestones, completed / overdue / upcoming tasks, per project', roles: MANAGERS, defaults: { name: 'Weekly project status', period: 'weekly', send_weekday: 1, send_hour: 9, send_minute: 0, coverage: 'previous' } },
  { key: 'team_performance', label: 'Team performance', audience: 'Delivery', desc: 'Attendance, time logged against tasks, delivery and attention flags per person', roles: MANAGERS, defaults: { name: 'Daily team performance', period: 'daily', send_hour: 19, send_minute: 0, coverage: 'to_date' } },
  { key: 'sales_pipeline', label: 'Sales pipeline', audience: 'Sales', desc: 'Pipeline by stage, won / lost and win rate, new leads by source, deals closing in 30 days, by owner', roles: MANAGERS, defaults: { name: 'Weekly sales pipeline', period: 'weekly', send_weekday: 1, send_hour: 9, send_minute: 0, coverage: 'previous' } },
]
export const canUseReportType = (type, role) => !!REPORT_TYPES.find(t => t.key === type)?.roles.includes(role)
export const canManageFinanceReports = role => ['admin', 'ceo', 'finance'].includes(role)
// Scope control each report type shows in the schedule editor.
export const REPORT_SCOPE = { team_performance: 'department', monthly_summary: 'department', project_status: 'project' }
export async function listReportSchedules(organizationId) {
  const { data, error } = await supabase.from('email_report_schedules').select('*').eq('organization_id', organizationId).order('created_at')
  if (error) throw error
  return data || []
}
export async function saveReportSchedule(organizationId, s, userId) {
  const row = {
    organization_id: organizationId, name: s.name.trim(), report_type: s.report_type || 'team_performance', period: s.period,
    coverage: s.coverage === 'previous' ? 'previous' : 'to_date',
    project_id: s.report_type === 'project_status' ? (s.project_id || null) : null,
    send_hour: Number(s.send_hour), send_minute: Number(s.send_minute) || 0, send_weekday: s.period === 'weekly' ? Number(s.send_weekday) : null,
    send_monthday: s.period === 'monthly' ? Number(s.send_monthday) : null,
    weekdays_only: s.period === 'daily' ? !!s.weekdays_only : true,
    department_id: REPORT_SCOPE[s.report_type || 'team_performance'] === 'department' ? (s.department_id || null) : null,
    recipient_ids: s.recipient_ids || [], recipient_group_ids: s.recipient_group_ids || [],
    extra_emails: (s.extra_emails || []).map(e => e.trim().toLowerCase()).filter(Boolean), enabled: !!s.enabled,
  }
  const q = s.id
    ? supabase.from('email_report_schedules').update(row).eq('id', s.id)
    : supabase.from('email_report_schedules').insert({ ...row, created_by: userId })
  const { error } = await q
  if (error) throw error
}
export async function deleteReportSchedule(id) {
  const { error } = await supabase.from('email_report_schedules').delete().eq('id', id)
  if (error) throw error
}
export async function sendReportPreview(scheduleId) {
  const { error } = await supabase.rpc('request_report_preview', { p_schedule_id: scheduleId })
  if (error) throw error
}

/* ── Email groups (STEP232) — reusable recipients / audiences ── */
export const EMPTY_GROUP = { name: '', description: '', member_ids: [], role_keys: [], department_ids: [], team_ids: [], extra_emails: [] }
export async function listEmailGroups(organizationId) {
  const [{ data, error }, sizes] = await Promise.all([
    supabase.from('email_groups').select('*').eq('organization_id', organizationId).order('name'),
    supabase.rpc('email_group_sizes'),
  ])
  if (error) throw error
  const by = Object.fromEntries((sizes.data || []).map(x => [x.group_id, x]))
  return (data || []).map(g => ({ ...g, size: by[g.id]?.people ?? null, outside: by[g.id]?.outside ?? g.extra_emails.length }))
}
export async function saveEmailGroup(organizationId, g, userId) {
  const row = {
    organization_id: organizationId, name: g.name.trim(), description: g.description?.trim() || null,
    member_ids: g.member_ids || [], role_keys: g.role_keys || [], department_ids: g.department_ids || [], team_ids: g.team_ids || [],
    extra_emails: (g.extra_emails || []).map(e => e.trim().toLowerCase()).filter(Boolean), updated_at: new Date().toISOString(),
  }
  const q = g.id ? supabase.from('email_groups').update(row).eq('id', g.id) : supabase.from('email_groups').insert({ ...row, created_by: userId })
  const { error } = await q
  if (error) throw /duplicate key/.test(error.message) ? new Error(`A group called "${row.name}" already exists`) : error
}
export async function deleteEmailGroup(id) {
  const { error } = await supabase.from('email_groups').delete().eq('id', id)
  if (error) throw error
}

/* ── Automatic alert rules (STEP231) — admin / CEO / HR ── */
export const ALERT_TYPES = {
  checkin_missing: { label: 'Missed check-in', desc: "People who haven't checked in by the alert time" },
  overdue_work: { label: 'Overdue work', desc: 'Overdue tasks and IT / Support tickets' },
}
// Starting points for "New alert" — every field stays editable.
export const ALERT_PRESETS = [
  { key: 'checkin', label: 'Check-in reminder', desc: 'Everyone who has not checked in by 10:30, weekdays',
    rule: { alert_type: 'checkin_missing', name: 'Check-in reminder', send_time: '10:30', send_to_person: true, send_to_manager: false } },
  { key: 'checkin2', label: 'Second reminder + managers', desc: 'Still not checked in at 11:30: the person and their manager',
    rule: { alert_type: 'checkin_missing', name: 'Second check-in reminder', send_time: '11:30', send_to_person: true, send_to_manager: true } },
  { key: 'overdue', label: 'Daily overdue list', desc: 'Each person gets their own overdue tasks and tickets at 09:30',
    rule: { alert_type: 'overdue_work', name: 'Daily overdue list', send_time: '09:30', send_to_person: true } },
  { key: 'overdue_mgr', label: 'Weekly overdue summary for managers', desc: 'Monday 09:00, each manager gets their team, 3+ days overdue',
    rule: { alert_type: 'overdue_work', name: 'Weekly overdue summary', send_time: '09:00', days_of_week: [1], send_to_person: false, send_to_manager: true, min_days_overdue: 3 } },
]
export const EMPTY_ALERT = {
  name: '', alert_type: 'checkin_missing', enabled: true, send_time: '10:30', days_of_week: [1, 2, 3, 4, 5], skip_holidays: true,
  audience_mode: 'all', department_ids: [], roles: [], people_ids: [], group_ids: [], exclude_ids: [],
  send_to_person: true, send_to_manager: false, summary_to_ids: [], summary_group_ids: [],
  include_tasks: true, include_it: true, include_support: true, min_days_overdue: 1, priorities: [],
  custom_subject: '', custom_message: '',
}
export const canManageAlerts = role => ['admin', 'ceo', 'hr'].includes(role)
export async function listAlertRules(organizationId) {
  const { data, error } = await supabase.from('email_alert_rules').select('*').eq('organization_id', organizationId).order('send_time')
  if (error) throw error
  return data || []
}
export async function saveAlertRule(organizationId, r, userId) {
  const row = {
    organization_id: organizationId, name: r.name.trim(), alert_type: r.alert_type, enabled: !!r.enabled,
    send_time: r.send_time || '10:30', days_of_week: r.days_of_week?.length ? r.days_of_week : [1, 2, 3, 4, 5], skip_holidays: !!r.skip_holidays,
    audience_mode: r.audience_mode || 'all',
    department_ids: r.audience_mode === 'departments' ? r.department_ids : [],
    roles: r.audience_mode === 'roles' ? r.roles : [],
    people_ids: r.audience_mode === 'people' ? r.people_ids : [],
    group_ids: r.audience_mode === 'groups' ? (r.group_ids || []) : [],
    exclude_ids: r.exclude_ids || [],
    send_to_person: !!r.send_to_person, send_to_manager: !!r.send_to_manager, summary_to_ids: r.summary_to_ids || [],
    summary_group_ids: r.summary_group_ids || [],
    include_tasks: !!r.include_tasks, include_it: !!r.include_it, include_support: !!r.include_support,
    min_days_overdue: Math.max(1, Number(r.min_days_overdue) || 1), priorities: (r.priorities || []).map(p => p.toLowerCase()),
    custom_subject: r.custom_subject?.trim() || null, custom_message: r.custom_message?.trim() || null,
    updated_at: new Date().toISOString(),
  }
  const q = r.id ? supabase.from('email_alert_rules').update(row).eq('id', r.id) : supabase.from('email_alert_rules').insert({ ...row, created_by: userId })
  const { error } = await q
  if (error) throw error
}
export async function deleteAlertRule(id) {
  const { error } = await supabase.from('email_alert_rules').delete().eq('id', id)
  if (error) throw error
}
export async function setAlertRuleEnabled(id, enabled) {
  const { error } = await supabase.from('email_alert_rules').update({ enabled, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}
// Run a rule now, delivering one sample of each email it produces to the caller only.
export async function sendAlertPreview(ruleId) {
  const { data, error } = await supabase.rpc('request_alert_preview', { p_rule_id: ruleId })
  if (error) throw error
  return data || 0
}

/* ── Announcements (STEP233) — maintenance / new update / general notice ──
   organizationId = null → platform-wide (super admin only, RLS-enforced). */
export const ANNOUNCEMENT_KINDS = {
  maintenance: { label: 'Maintenance', desc: 'Planned downtime or slowness, with a time window and an optional reminder', color: '#b45309' },
  update: { label: 'New update', desc: "A release note: what's new, version and a link", color: '#0284c7' },
  general: { label: 'General', desc: 'Any other notice to your team', color: '#4f46e5' },
}
export const EMPTY_ANNOUNCEMENT = {
  kind: 'maintenance', title: '', message: '', starts_at: '', ends_at: '', impact: '', version: '', items: [],
  cta_label: '', cta_url: '', audience_mode: 'all', roles: [], department_ids: [], group_ids: [], people_ids: [], org_ids: [],
  send_mode: 'now', send_at: '', remind_before_minutes: null,
}
export async function listAnnouncements(organizationId) {
  let q = supabase.from('email_announcements').select('*').order('created_at', { ascending: false }).limit(50)
  q = organizationId ? q.eq('organization_id', organizationId) : q.is('organization_id', null)
  const { data, error } = await q
  if (error) throw error
  return data || []
}
const isoOrNull = v => (v ? new Date(v).toISOString() : null)
// status: 'draft' keeps it editable; 'scheduled' hands it to the worker (sent at send_at, or within a minute).
export async function saveAnnouncement(organizationId, a, userId, status) {
  const platform = !organizationId
  const row = {
    organization_id: organizationId || null, kind: a.kind, title: a.title.trim(), message: a.message?.trim() || null,
    starts_at: a.kind === 'maintenance' ? isoOrNull(a.starts_at) : null, ends_at: a.kind === 'maintenance' ? isoOrNull(a.ends_at) : null,
    impact: a.kind === 'maintenance' ? a.impact?.trim() || null : null,
    remind_before_minutes: a.kind === 'maintenance' && a.remind_before_minutes ? Number(a.remind_before_minutes) : null,
    version: a.kind === 'update' ? a.version?.trim() || null : null,
    items: a.kind === 'update' ? (a.items || []).filter(x => x.title?.trim() || x.description?.trim()).map(x => ({ title: x.title?.trim() || '', description: x.description?.trim() || '' })) : [],
    cta_label: a.cta_url?.trim() ? a.cta_label?.trim() || null : null, cta_url: a.cta_url?.trim() || null,
    audience_mode: platform ? 'all' : a.audience_mode,
    roles: platform || a.audience_mode === 'roles' ? a.roles || [] : [],
    department_ids: !platform && a.audience_mode === 'departments' ? a.department_ids : [],
    group_ids: !platform && a.audience_mode === 'groups' ? a.group_ids : [],
    people_ids: !platform && a.audience_mode === 'people' ? a.people_ids : [],
    org_ids: platform ? a.org_ids || [] : [],
    send_at: a.send_mode === 'later' ? isoOrNull(a.send_at) : null,
    status, updated_at: new Date().toISOString(),
  }
  const q = a.id ? supabase.from('email_announcements').update(row).eq('id', a.id).select().single()
    : supabase.from('email_announcements').insert({ ...row, created_by: userId }).select().single()
  const { data, error } = await q
  if (error) throw error
  return data
}
// reminderOnly: an already-sent maintenance notice keeps its history; only its pending reminder is dropped.
export async function cancelAnnouncement(id, reminderOnly = false) {
  const patch = reminderOnly ? { remind_before_minutes: null } : { status: 'cancelled' }
  const { error } = await supabase.from('email_announcements').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}
export async function deleteAnnouncement(id) {
  const { error } = await supabase.from('email_announcements').delete().eq('id', id)
  if (error) throw error
}
export async function announcementAudienceCount(id) {
  const { data, error } = await supabase.rpc('announcement_audience_count', { p_id: id })
  if (error) throw error
  return data || 0
}
export async function previewAnnouncement(id) {
  const { error } = await supabase.rpc('preview_announcement', { p_id: id })
  if (error) throw error
}

/* ── Event rules (STEP233) — "When a record … email …" ──
   Keys / people mirror _event_entity() in STEP233. */
export const EVENT_ENTITIES = [
  { key: 'task', label: 'Task', group: 'Work', people: { assignee: 'Assignee', creator: 'Created by' }, fields: ['priority', 'task_name', 'planned_end_date'] },
  { key: 'project', label: 'Project', group: 'Work', people: { owner: 'Project manager', creator: 'Created by' }, fields: ['name', 'budget'] },
  { key: 'milestone', label: 'Milestone', group: 'Work', people: { creator: 'Created by' }, fields: ['title', 'invoice_amount', 'due_date'] },
  { key: 'timesheet', label: 'Timesheet', group: 'Work', people: { requester: 'Employee', approver: 'Approving manager' }, fields: ['period_month'] },
  { key: 'leave', label: 'Leave request', group: 'People', people: { requester: 'Employee', approver: 'Approved by' }, fields: ['leave_type', 'from_date'] },
  { key: 'user', label: 'User', group: 'People', people: { user: 'The user', manager: 'Their manager' }, fields: ['role', 'full_name'] },
  { key: 'expense', label: 'Expense claim', group: 'Finance', people: { requester: 'Requested by', approver: 'Current approver' }, fields: ['total_amount', 'title'] },
  { key: 'travel', label: 'Travel request', group: 'Finance', people: { requester: 'Requested by' }, fields: ['purpose'] },
  { key: 'purchase_request', label: 'Purchase request', group: 'Finance', people: { requester: 'Requested by', approver: 'Approved by' }, fields: ['estimated_total', 'priority', 'title'] },
  { key: 'purchase_order', label: 'Purchase order', group: 'Finance', people: { creator: 'Created by', approver: 'Approved by' }, fields: ['total_amount'] },
  { key: 'vendor_bill', label: 'Vendor bill', group: 'Finance', people: { creator: 'Created by' }, fields: ['total_amount', 'due_date'] },
  { key: 'customer_invoice', label: 'Customer invoice', group: 'Finance', people: { creator: 'Created by' }, fields: ['total_amount', 'due_date'] },
  { key: 'it_ticket', label: 'IT ticket', group: 'Support', people: { requester: 'Raised by', assignee: 'Assigned to' }, fields: ['priority', 'subject'] },
  { key: 'support_ticket', label: 'Support ticket', group: 'Support', people: { assignee: 'Assigned agent', creator: 'Created by' }, fields: ['priority', 'subject'] },
  { key: 'lead', label: 'Lead', group: 'Sales', people: { owner: 'Assigned rep', creator: 'Created by' }, fields: ['company_name', 'contact_name'] },
  { key: 'opportunity', label: 'Opportunity', group: 'Sales', people: { owner: 'Assigned rep', creator: 'Created by' }, fields: ['expected_value', 'pipeline_stage'] },
]
export const eventEntity = key => EVENT_ENTITIES.find(e => e.key === key) || EVENT_ENTITIES[0]
export const EVENT_KINDS = { created: 'is created', status_changed: 'changes status', updated: 'is updated (any change)' }
export const CONDITION_OPS = {
  equals: 'is', not_equals: 'is not', in: 'is one of', contains: 'contains', gt: '>', gte: '≥', lt: '<', lte: '≤', is_empty: 'is empty', not_empty: 'is not empty',
}
export const EVENT_PLACEHOLDERS = ['name', 'title', 'code', 'status', 'old_status', 'record', 'actor', 'amount', 'due', 'rule']
export const EMPTY_EVENT_RULE = {
  name: '', enabled: true, entity: 'task', event: 'created', status_to: [], conditions: [], recipient_roles: ['assignee'],
  people_ids: [], group_ids: [], extra_emails: [], skip_actor: true, subject: '', message: '',
}
export async function listEventRules(organizationId) {
  const { data, error } = await supabase.from('email_event_rules').select('*').eq('organization_id', organizationId).order('created_at')
  if (error) throw error
  return data || []
}
export async function saveEventRule(organizationId, r, userId) {
  const row = {
    organization_id: organizationId, name: r.name.trim(), enabled: !!r.enabled, entity: r.entity, event: r.event,
    status_to: r.event === 'status_changed' ? (r.status_to || []).map(s => s.trim()).filter(Boolean) : [],
    conditions: (r.conditions || []).filter(c => c.field?.trim() && c.op).map(c => ({ field: c.field.trim(), op: c.op, value: ['is_empty', 'not_empty'].includes(c.op) ? null : String(c.value ?? '').trim() })),
    recipient_roles: r.recipient_roles || [], people_ids: r.people_ids || [], group_ids: r.group_ids || [],
    extra_emails: (r.extra_emails || []).map(e => e.trim().toLowerCase()).filter(Boolean),
    skip_actor: !!r.skip_actor, subject: r.subject?.trim() || null, message: r.message?.trim() || null,
    updated_at: new Date().toISOString(),
  }
  const q = r.id ? supabase.from('email_event_rules').update(row).eq('id', r.id) : supabase.from('email_event_rules').insert({ ...row, created_by: userId })
  const { error } = await q
  if (error) throw error
}
export async function deleteEventRule(id) {
  const { error } = await supabase.from('email_event_rules').delete().eq('id', id)
  if (error) throw error
}
export async function setEventRuleEnabled(id, enabled) {
  const { error } = await supabase.from('email_event_rules').update({ enabled, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}
// Renders the rule against the newest record of its type and emails it to the caller only.
export async function testEventRule(id) {
  const { data, error } = await supabase.rpc('preview_event_rule', { p_rule_id: id })
  if (error) throw error
  return data
}
export async function eventStatusValues(entity) {
  const { data } = await supabase.rpc('event_status_values', { p_entity: entity })
  return data || []
}

/* ── Account emails ── */
export async function sendWelcomeEmail(userId, tempPassword) {
  const { error } = await supabase.rpc('send_welcome_email', { p_user_id: userId, p_temp_password: tempPassword || null })
  if (error) throw error
}
export async function sendInviteEmail(inviteId, email, name) {
  const { error } = await supabase.rpc('send_invite_email', { p_invite_id: inviteId, p_email: email, p_name: name || null })
  if (error) throw error
}
export async function requestPasswordReset(email) {
  // Sent by Supabase Auth itself (Dashboard → Authentication → SMTP settings).
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` })
  if (error) throw error
}

export const isValidEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim())
