import { supabase } from './supabase'
import { CATEGORIES } from '../../supabase/functions/_shared/outlookClassifier.js'

// Outlook email → project action items (STEP261). Reads go straight to the
// RLS-protected tables; every write that matters goes through a SECURITY
// DEFINER RPC (review / retry / dismiss / secret) or the outlook-sync Edge
// Function (anything that talks to Microsoft Graph).

export { CATEGORIES }

export const MESSAGE_STATUSES = {
  PENDING:      { label: 'Queued',        tone: 'gray' },
  PROCESSING:   { label: 'Processing',    tone: 'gl-st-indigo' },
  TASK_CREATED: { label: 'Task created',  tone: 'green' },
  REVIEW:       { label: 'Needs review',  tone: 'amber' },
  IGNORED:      { label: 'Ignored',       tone: 'gray' },
  FAILED:       { label: 'Retrying',      tone: 'red' },
  DEAD:         { label: 'Failed',        tone: 'red' },
  DISMISSED:    { label: 'Dismissed',     tone: 'gray' },
  PROCESSED:    { label: 'Processed',     tone: 'green' },
}

export const ASSIGN_MODES = {
  PROJECT_MANAGER: 'Project manager (fallback: default person)',
  SUGGESTED:       'Person named in the email, if they are a team member (else project manager)',
  FIXED:           'Always the default person',
  NONE:            'Leave unassigned',
}

export const AI_PROVIDERS = {
  auto:     'Automatic (first AI key configured: Claude, DeepSeek, Gemini)',
  claude:   'Claude',
  deepseek: 'DeepSeek',
  gemini:   'Gemini',
  rules:    'Keyword rules only (no AI)',
}

export const EVENT_LABELS = {
  MAILBOX_ADDED: 'Mailbox added', MAILBOX_REMOVED: 'Mailbox removed', CONFIG_CHANGED: 'Settings changed',
  SECRET_SET: 'Client secret saved', SECRET_CLEARED: 'Client secret cleared', CLIENT_STATE_ROTATED: 'Webhook secret rotated',
  CONNECTION_TEST: 'Connection test', SUBSCRIBED: 'Subscribed to new mail', RENEWED: 'Subscription renewed',
  UNSUBSCRIBED: 'Subscription removed', SUBSCRIPTION_ERROR: 'Subscription error', LIFECYCLE: 'Graph lifecycle event',
  NOTIFICATION_REJECTED: 'Notification rejected', RECONCILED: 'Missed mail recovered', SYNC_ERROR: 'Sync error',
  RECEIVED: 'Email received', CLASSIFIED: 'Classified', TASK_CREATED: 'Task created', SENT_TO_REVIEW: 'Sent to review',
  IGNORED: 'Ignored', FAILED: 'Processing failed', DEAD_LETTER: 'Gave up after retries', RETRY_REQUESTED: 'Retry requested',
  REVIEW_RESOLVED: 'Task created from review', DISMISSED: 'Dismissed', INTERNAL_REPLY: 'Internal reply',
  PROCESSED: 'Processed (Email Intelligence)', INVOICE_CREATED: 'Invoice created', EXCEPTION_RAISED: 'Sent for review', EXCEPTION_RESOLVED: 'Review resolved',
  EXCEPTION_DISMISSED: 'Review dismissed', MANUAL_CORRECTION: 'Manual correction',
}

const MAILBOX_FIELDS = ['mailbox_address', 'display_name', 'tenant_id', 'client_id', 'enabled', 'auto_create', 'categories', 'min_confidence',
  'default_priority', 'assign_mode', 'default_assignee_id', 'default_status', 'default_due_days', 'ai_provider', 'notify_user_ids', 'retention_days', 'inbox_roles']

export const NEW_MAILBOX = {
  mailbox_address: '', display_name: '', tenant_id: '', client_id: '', enabled: false, auto_create: true,
  categories: Object.keys(CATEGORIES).filter(c => c !== 'OTHER'), min_confidence: 0.75, default_priority: 'medium',
  assign_mode: 'PROJECT_MANAGER', default_assignee_id: null, default_status: 'backlog', default_due_days: null,
  ai_provider: 'auto', notify_user_ids: [], retention_days: 90,
  inbox_roles: ['admin', 'ceo', 'manager', 'department_head'],
}

const raise = error => { if (error) throw new Error(error.message) }

export async function listMailboxes() {
  const { data, error } = await supabase.from('outlook_mailboxes').select('*').order('created_at')
  raise(error)
  return data || []
}

export async function saveMailbox(mb) {
  const row = Object.fromEntries(MAILBOX_FIELDS.map(k => [k, mb[k] === '' ? null : mb[k]]))
  row.mailbox_address = String(mb.mailbox_address || '').trim()
  row.default_status = mb.default_status || 'backlog'
  if (!Array.isArray(mb.inbox_roles)) delete row.inbox_roles   // row loaded before STEP262
  const send = r => (mb.id
    ? supabase.from('outlook_mailboxes').update(r).eq('id', mb.id).select().single()
    : supabase.from('outlook_mailboxes').insert(r).select().single())
  let { data, error } = await send(row)
  if (error && /inbox_roles/.test(error.message)) {   // STEP262 not run yet — save the rest
    delete row.inbox_roles
    ;({ data, error } = await send(row))
  }
  raise(error)
  return data
}

export async function deleteMailbox(id) {
  const { error } = await supabase.from('outlook_mailboxes').delete().eq('id', id)
  raise(error)
}

export async function setClientSecret(mailboxId, secret) {
  const { error } = await supabase.rpc('outlook_set_client_secret', { p_mailbox: mailboxId, p_secret: secret })
  raise(error)
}

export async function secretStatus(mailboxId) {
  const { data, error } = await supabase.rpc('outlook_secret_status', { p_mailbox: mailboxId })
  raise(error)
  return data?.[0] || { has_secret: false }
}

export async function rotateClientState(mailboxId) {
  const { error } = await supabase.rpc('outlook_rotate_client_state', { p_mailbox: mailboxId })
  raise(error)
}

// Graph-side actions: test | subscribe | unsubscribe | reconcile | process
export async function syncAction(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('outlook-sync', { body: { action, ...payload } })
  if (error) {
    let msg = error.message
    try { const b = await error.context?.json?.(); if (b?.error) msg = b.error } catch { /* not JSON */ }
    if (/Failed to send a request|FunctionsFetchError|404/i.test(msg)) msg = 'The outlook-sync function is not deployed yet (see the setup steps).'
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

const MSG_COLS = 'id, mailbox_id, graph_message_id, conversation_id, source, status, subject, sender_email, sender_name, received_at, web_link, body_excerpt, ' +
  'classifier, classification, category, priority, confidence, decision_reason, matched_project_id, matched_customer_id, match_method, match_confidence, ' +
  'candidates, task_id, attempts, next_attempt_at, last_error, processed_at, reviewed_by, reviewed_at, created_at, intents, config_version, attachment_count, vendor_id'

export async function listMessages({ statuses, search, limit = 200 } = {}) {
  let q = supabase.from('outlook_email_messages').select(MSG_COLS).order('created_at', { ascending: false }).limit(limit)
  if (statuses?.length) q = q.in('status', statuses)
  const s = String(search || '').trim().replace(/[%,()]/g, ' ')
  if (s) q = q.or(`subject.ilike.%${s}%,sender_email.ilike.%${s}%,sender_name.ilike.%${s}%`)
  const { data, error } = await q
  raise(error)
  return data || []
}

export async function messageCounts() {
  const { data, error } = await supabase.from('outlook_email_messages').select('status, created_at').gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()).limit(5000)
  raise(error)
  const c = Object.fromEntries(Object.keys(MESSAGE_STATUSES).map(k => [k, 0]))
  for (const r of data || []) c[r.status] = (c[r.status] || 0) + 1
  return c
}

export async function listEvents({ messageId, limit = 200 } = {}) {
  let q = supabase.from('outlook_email_events').select('id, mailbox_id, message_id, event, detail, actor_id, created_at').order('created_at', { ascending: false }).limit(limit)
  if (messageId) q = q.eq('message_id', messageId)
  const { data, error } = await q
  raise(error)
  return data || []
}

export async function reviewCreateTask(messageId, { projectId, title, description, priority, assigneeId, dueDate }) {
  const { data, error } = await supabase.rpc('outlook_review_create_task', {
    p_message: messageId, p_project: projectId, p_title: title, p_description: description,
    p_priority: priority, p_assignee: assigneeId || null, p_due: dueDate || null,
  })
  raise(error)
  return data
}

export async function retryMessage(messageId) {
  const { error } = await supabase.rpc('outlook_retry_message', { p_message: messageId })
  raise(error)
  // process right away when the function is deployed; cron picks it up otherwise
  try { await syncAction('process', { message_id: messageId }) } catch { /* queued for the next run */ }
}

export async function dismissMessage(messageId, note) {
  const { error } = await supabase.rpc('outlook_dismiss_message', { p_message: messageId, p_note: note || null })
  raise(error)
}

export async function loadLookups() {
  const [projects, people] = await Promise.all([
    supabase.from('projects').select('id, code, name, status, manager_id').order('name'),
    supabase.from('profiles').select('id, full_name, email, is_active').order('full_name'),
  ])
  return { projects: projects.data || [], people: (people.data || []).filter(p => p.is_active !== false) }
}

export async function tasksByIds(ids) {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return {}
  const { data } = await supabase.from('project_tasks').select('id, task_id, status, assigned_to').in('id', uniq)
  return Object.fromEntries((data || []).map(t => [t.id, t]))
}

// Category label: STEP261 issue categories, else an Email Intelligence code made readable.
export const categoryLabel = code => CATEGORIES[code] || String(code || '').toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

export const pct = v => (v == null ? '—' : `${Math.round(Number(v) * 100)}%`)

/* ═══ Outlook Email inbox + internal replies (STEP262) ═══ */

export const INBOX_ROLES = ['admin', 'ceo', 'manager', 'department_head', 'finance', 'hr', 'employee']

export async function listInboxMailboxes() {
  const { data, error } = await supabase.rpc('outlook_inbox_mailboxes')
  raise(error)
  return data || []
}

export async function listNotes(messageId) {
  const { data, error } = await supabase.from('outlook_email_notes').select('id, message_id, author_id, body, created_at, edited_at')
    .eq('message_id', messageId).order('created_at')
  raise(error)
  return data || []
}

export async function noteCounts(messageIds) {
  if (!messageIds.length) return {}
  const { data } = await supabase.from('outlook_email_notes').select('message_id').in('message_id', messageIds)
  const c = {}
  for (const n of data || []) c[n.message_id] = (c[n.message_id] || 0) + 1
  return c
}

export async function addNote(messageId, body) {
  const { data, error } = await supabase.from('outlook_email_notes').insert({ message_id: messageId, body }).select().single()
  raise(error)
  return data
}

export async function deleteNote(id) {
  const { error } = await supabase.from('outlook_email_notes').delete().eq('id', id)
  raise(error)
}
