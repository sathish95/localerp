// Processing pipeline for the Outlook email → task module (STEP261).
//
//   claimed row → fetch from Graph → duplicate / date / pre-filter checks →
//   classify → match project → decide → create task (one SQL transaction)
//   or send to review / ignore → record result.
//
// Every side effect goes through the injected `graph`, `db` and `ai`
// objects, so the whole pipeline runs under node --test with mocks. The
// outlook-sync Edge Function wires the real Graph client and Supabase RPCs.

import { normalizeMessage, RENEW_BEFORE_MS } from './outlookGraph.js'
import { prefilter, classifyEmail } from './outlookClassifier.js'
import { matchProject, decide, pickAssignee, dueDateFor, taskDescription } from './outlookMatcher.js'

export const RECONCILE_EVERY_MS = 15 * 60 * 1000

// Errors stored in the database / shown in the UI: short, no bearer tokens.
export function safeError(e) {
  return String(e?.message || e || 'Unknown error')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [hidden]')
    .replace(/(client_secret|access_token|api[_-]?key)=([^&\s]+)/gi, '$1=[hidden]')
    .slice(0, 500)
}

/**
 * @param row      claimed outlook_email_messages row
 * @param deps.mailbox  outlook_mailboxes row
 * @param deps.graph    { getMessage(mailbox, id) }
 * @param deps.ai       { provider, keys, fetchImpl? }
 * @param deps.context  { projects, customers, contacts, profiles } of the org
 * @param deps.db       { findDuplicate(row, internetMessageId), history(row, conversationId),
 *                        record(id, status, fields, retryAfterSecs), createTask(args) }
 * @returns { status, reason?, taskId?, error? }
 */
export async function processMessage(row, { mailbox, graph, ai = {}, context, db, intelligence = null }) {
  try {
    const raw = await graph.getMessage(mailbox.mailbox_address, row.graph_message_id)
    if (!raw) {
      const status = await db.record(row.id, 'IGNORED', { decision_reason: 'The email no longer exists in the mailbox' })
      return { status, reason: 'deleted' }
    }
    const email = normalizeMessage(raw)
    const meta = {
      internet_message_id: email.internetMessageId, conversation_id: email.conversationId, subject: email.subject,
      sender_email: email.senderEmail, sender_name: email.senderName, to_recipients: email.to, received_at: email.receivedAt,
      web_link: email.webLink, body_excerpt: email.body.slice(0, 8000),
    }

    if (email.internetMessageId && await db.findDuplicate(row, email.internetMessageId)) {
      const { internet_message_id, ...rest } = meta   // keep the unique index free for the original
      const status = await db.record(row.id, 'IGNORED', { ...rest, decision_reason: 'Duplicate of an email already processed' })
      return { status, reason: 'duplicate' }
    }
    if (mailbox.process_since && email.receivedAt && Date.parse(email.receivedAt) < Date.parse(mailbox.process_since)) {
      const status = await db.record(row.id, 'IGNORED', { ...meta, decision_reason: 'Received before the automation was enabled' })
      return { status, reason: 'before-enable' }
    }
    const pre = prefilter(email, { mailboxAddress: mailbox.mailbox_address })
    if (pre) {
      const status = await db.record(row.id, 'IGNORED', { ...meta, decision_reason: pre.reason })
      return { status, reason: pre.reason }
    }

    // Email Intelligence (STEP263+): configured intents, attachments, invoice
    // intake. Emails it hands back (primary intent → PROJECT_ISSUE_TASK) go on
    // to the customer project-issue flow below, keeping their intents.
    let eiMeta = {}
    if (intelligence) {
      const rep = await intelligence(row, email)
      if (rep) {
        eiMeta = { intents: rep.intents, config_version: rep.version, attachment_count: rep.attachments.length, vendor_id: rep.vendor_id }
        if (rep.status !== 'DELEGATE') {
          const status = await db.record(row.id, rep.status === 'IGNORED' ? 'IGNORED' : 'PROCESSED', {
            ...meta, ...eiMeta, classifier: rep.intents.source, category: rep.intents.primary, confidence: rep.intents.confidence,
            priority: (rep.exceptions.find(e => e.priority === 'critical') && 'critical') || (rep.exceptions.find(e => e.priority === 'high') && 'high') || null,
            decision_reason: rep.summary,
          })
          return { status, reason: rep.summary, report: rep }
        }
      }
    }

    const { result: cls, classifier, injection } = await classifyEmail(email, ai)
    let match = { status: 'UNMATCHED', project: null, customer: null, method: null, confidence: 0, candidates: [], reason: '' }
    if (cls.requires_action) {
      const history = email.conversationId ? await db.history(row, email.conversationId) : []
      match = matchProject({ email, classification: cls, ...context, history })
    }
    const d = decide({ classification: cls, match, mailbox, injection })
    const fields = {
      ...meta, ...eiMeta, classifier, classification: cls, category: cls.category, priority: cls.priority || mailbox.default_priority,
      confidence: cls.confidence, decision_reason: d.reason,
      matched_project_id: match.project?.id || null, matched_customer_id: match.customer?.id || null,
      match_method: match.method, match_confidence: match.confidence, candidates: match.candidates,
    }

    if (d.action !== 'CREATE') {
      const status = await db.record(row.id, d.action === 'IGNORE' ? 'IGNORED' : 'REVIEW', fields)
      return { status, reason: d.reason }
    }

    // Save what we know first, then create the task in one transaction —
    // if anything fails after this, the retry finds the task by its email.
    await db.record(row.id, 'PROCESSING', fields)
    const taskId = await db.createTask({
      messageId: row.id,
      projectId: match.project.id,
      title: cls.title,
      description: taskDescription({ email, classification: cls }),
      priority: cls.priority || mailbox.default_priority,
      assigneeId: pickAssignee({ mailbox, project: match.project, classification: cls, profiles: context.profiles }),
      dueDate: dueDateFor({ classification: cls, mailbox, receivedAt: email.receivedAt }),
      method: match.method,
      matchConfidence: match.confidence,
      customerId: match.customer?.id || null,
    })
    return { status: 'TASK_CREATED', taskId, reason: d.reason }
  } catch (e) {
    const error = safeError(e)
    const status = await db.record(row.id, 'FAILED', { error }, Number.isFinite(e?.retryAfter) ? e.retryAfter : null)
    return { status, error }
  }
}

/* ═══ subscription upkeep ═══ */

export function subscriptionAction(mb, now = Date.now()) {
  if (!mb.enabled) return mb.subscription_id ? 'DELETE' : 'NONE'
  if (!mb.subscription_id || mb.subscription_status === 'REMOVED') return 'CREATE'
  const exp = Date.parse(mb.subscription_expires_at || '')
  if (!Number.isFinite(exp) || exp - now < RENEW_BEFORE_MS) return 'RENEW'
  return 'NONE'
}

/**
 * Create / renew / remove the Graph subscription as the mailbox needs.
 * A renewal that Graph answers with 404 (expired or removed) recreates it.
 * @returns { action, ok, error?, recreated? }
 */
export async function maintainSubscription(mb, { graph, clientState, notificationUrl, lifecycleNotificationUrl, save, log, now = () => Date.now(), force = false }) {
  const action = force ? 'CREATE' : subscriptionAction(mb, now())
  if (action === 'NONE') return { action, ok: true }
  const create = async () => {
    if (mb.subscription_id) { try { await graph.deleteSubscription(mb.subscription_id) } catch { /* already gone */ } }
    const sub = await graph.createSubscription({ mailbox: mb.mailbox_address, notificationUrl, lifecycleNotificationUrl, clientState })
    await save({ subscription_id: sub.id, subscription_status: 'ACTIVE', subscription_expires_at: sub.expirationDateTime,
      subscription_renewed_at: new Date(now()).toISOString(), last_error: null, last_error_at: null })
    await log('SUBSCRIBED', { expires: sub.expirationDateTime })
  }
  try {
    if (action === 'CREATE') { await create(); return { action, ok: true } }
    if (action === 'DELETE') {
      await graph.deleteSubscription(mb.subscription_id)
      await save({ subscription_id: null, subscription_status: 'NONE', subscription_expires_at: null })
      await log('UNSUBSCRIBED', {})
      return { action, ok: true }
    }
    const r = await graph.renewSubscription(mb.subscription_id)
    if (!r) { await create(); return { action, ok: true, recreated: true } }
    await save({ subscription_status: 'ACTIVE', subscription_expires_at: r.expirationDateTime,
      subscription_renewed_at: new Date(now()).toISOString(), last_error: null, last_error_at: null })
    await log('RENEWED', { expires: r.expirationDateTime })
    return { action, ok: true }
  } catch (e) {
    const error = safeError(e)
    const repeat = mb.last_error === error && mb.subscription_status === 'ERROR'
    await save({ subscription_status: 'ERROR', last_error: error, last_error_at: repeat ? mb.last_error_at : new Date(now()).toISOString() })
    if (!repeat) await log('SUBSCRIPTION_ERROR', { action, error })   // once per distinct problem, not every minute
    return { action, ok: false, error }
  }
}

/* ═══ reconciliation (missed notifications) ═══ */

export const reconcileDue = (mb, now = Date.now()) =>
  !!mb.enabled && (!mb.last_reconciled_at || now - Date.parse(mb.last_reconciled_at) >= RECONCILE_EVERY_MS)

/**
 * Inbox delta since the stored deltaLink (first time: since process_since)
 * → enqueue anything not seen yet. The unique index drops the ones the
 * webhook already delivered.
 */
export async function reconcileMailbox(mb, { graph, enqueue, save, log, now = () => Date.now(), maxPages = 20 }) {
  const since = mb.process_since || new Date(now() - 86400000).toISOString()
  const { ids, deltaLink, complete } = await graph.inboxDelta(mb.mailbox_address, { deltaLink: mb.delta_link, since, maxPages })
  let added = 0
  for (const id of ids) if (await enqueue(id)) added++
  await save({ delta_link: deltaLink, last_reconciled_at: new Date(now()).toISOString() })
  if (added) await log('RECONCILED', { found: ids.length, added, complete })
  return { found: ids.length, added, complete }
}
