// Graph change-notification endpoint logic for the Outlook email → task
// module (STEP261). Pure request → response, with lookups/writes injected,
// so node --test covers it; supabase/functions/outlook-webhook wires it up.
//
//  • ?validationToken=… (subscription create / lifecycle URL check): echo
//    the token as text/plain within Graph's 10-second window.
//  • Notifications: each item must name a subscription we created AND carry
//    that mailbox's secret clientState (constant-time compare) — anything
//    else is dropped. Valid ones are only *recorded* (message id → queue);
//    fetching, AI and task creation happen in outlook-sync, so Graph gets
//    its 202 immediately.
//  • Lifecycle events (reauthorizationRequired / subscriptionRemoved /
//    missed) are passed to onLifecycle for the worker to act on.

export const MAX_BODY_BYTES = 1024 * 1024
export const MAX_ITEMS = 200

export function safeEqual(a, b) {
  const x = String(a ?? ''), y = String(b ?? '')
  let diff = x.length ^ y.length
  const n = Math.max(x.length, y.length)
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0)
  return diff === 0 && x.length > 0
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const text = (status, body = '') => ({ status, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body })

/**
 * @param req  { method, url, bodyText }
 * @param deps { lookup(subscriptionIds) → [{subscription_id, mailbox_id, enabled, tenant_id, client_state}],
 *               enqueue(mailboxId, graphMessageId) → boolean,
 *               onLifecycle({ mailboxId, event }), onRejected?({ subscriptionId, mailboxId, reason }),
 *               touch?(mailboxIds) }
 * @returns { status, headers, body, enqueued, rejected, mailboxes }
 */
export async function handleWebhook(req, deps) {
  const url = new URL(req.url)
  const token = url.searchParams.get('validationToken')
  if (token != null) {
    // URLSearchParams has already decoded it; echo verbatim, plain text only
    return { ...text(200, token.slice(0, 4096)), enqueued: 0, rejected: 0, mailboxes: [] }
  }
  if (req.method !== 'POST') return { ...text(405, 'Method not allowed'), enqueued: 0, rejected: 0, mailboxes: [] }
  const raw = String(req.bodyText ?? '')
  if (raw.length > MAX_BODY_BYTES) return { ...text(413, 'Too large'), enqueued: 0, rejected: 0, mailboxes: [] }
  let payload
  try { payload = JSON.parse(raw) } catch { return { ...text(400, 'Bad JSON'), enqueued: 0, rejected: 0, mailboxes: [] } }
  const items = Array.isArray(payload?.value) ? payload.value.slice(0, MAX_ITEMS) : null
  if (!items) return { ...text(400, 'No notifications'), enqueued: 0, rejected: 0, mailboxes: [] }

  const subIds = [...new Set(items.map(n => n?.subscriptionId).filter(s => typeof s === 'string' && s.length <= 200))]
  const rows = subIds.length ? await deps.lookup(subIds) : []
  const bySub = new Map(rows.map(r => [r.subscription_id, r]))

  let enqueued = 0, rejected = 0
  const touched = new Set()
  for (const n of items) {
    const mb = bySub.get(n?.subscriptionId)
    const reject = async reason => { rejected++; await deps.onRejected?.({ subscriptionId: n?.subscriptionId || null, mailboxId: mb?.mailbox_id || null, reason }) }
    if (!mb) { await reject('Unknown subscription'); continue }
    if (!safeEqual(n.clientState, mb.client_state)) { await reject('clientState mismatch'); continue }
    if (mb.tenant_id && GUID.test(mb.tenant_id) && n.tenantId && String(n.tenantId).toLowerCase() !== mb.tenant_id.toLowerCase()) {
      await reject('Tenant mismatch'); continue
    }
    if (!mb.enabled) continue
    touched.add(mb.mailbox_id)
    if (n.lifecycleEvent) {
      await deps.onLifecycle({ mailboxId: mb.mailbox_id, event: String(n.lifecycleEvent) })
      continue
    }
    const id = n?.resourceData?.id
    if (n.changeType && n.changeType !== 'created') continue
    if (typeof id !== 'string' || !id || id.length > 512) { await reject('Missing message id'); continue }
    if (await deps.enqueue(mb.mailbox_id, id)) enqueued++
  }
  if (touched.size) await deps.touch?.([...touched])
  // 202 even when items were dropped: an error status only makes Graph retry them.
  return { ...text(202, ''), enqueued, rejected, mailboxes: [...touched] }
}
