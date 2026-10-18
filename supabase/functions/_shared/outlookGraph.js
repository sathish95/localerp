// Microsoft Graph client for the Outlook email → task module (STEP261).
//
// Plain JS, import-free, `fetch` injectable — used by the outlook-webhook /
// outlook-sync Edge Functions and by node --test (src/lib/outlookEmail.test.mjs).
//
// Auth: OAuth 2.0 client credentials against Microsoft Entra ID (app-only,
// application permission Mail.Read, scoped to the mailbox with an Exchange
// Online application access policy / RBAC for Applications).
// Throttling: 429 / 503 / 504 honour Retry-After — short waits are slept
// inline, longer ones surface as GraphError.retryAfter so the caller can
// reschedule the job instead of blocking the worker.
// Tokens and secrets never appear in thrown errors.

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
export const SUBSCRIPTION_MINUTES = 4200          // Outlook messages allow < 7 days; renew well before
export const RENEW_BEFORE_MS = 24 * 3600 * 1000   // renew when < 24 h left
const MESSAGE_SELECT = 'id,subject,from,sender,toRecipients,ccRecipients,body,bodyPreview,receivedDateTime,conversationId,internetMessageId,webLink,isDraft,internetMessageHeaders,parentFolderId'

export class GraphError extends Error {
  constructor(message, { status = 0, code = '', retryAfter = null, retryable = false } = {}) {
    super(message)
    this.name = 'GraphError'
    this.status = status
    this.code = code
    this.retryAfter = retryAfter   // seconds, when Graph said so
    this.retryable = retryable
  }
}

// Retry-After is seconds or an HTTP date.
export function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === '') return null
  const n = Number(value)
  if (Number.isFinite(n)) return Math.max(0, Math.ceil(n))
  const t = Date.parse(value)
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - now) / 1000)) : null
}

const enc = encodeURIComponent

export function createGraphClient({
  tenantId, clientId, clientSecret,
  fetchImpl = globalThis.fetch, sleep = ms => new Promise(r => setTimeout(r, ms)),
  maxInlineWaitSecs = 10, maxRetries = 3, now = () => Date.now(),
} = {}) {
  const missing = [['tenant id', tenantId], ['client id', clientId], ['client secret', clientSecret]].filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) throw new GraphError(`Microsoft Graph is not configured: missing ${missing.join(', ')}`, { code: 'not_configured' })

  let token = null
  let tokenExp = 0

  async function getToken(force = false) {
    if (!force && token && now() < tokenExp - 60000) return token
    const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
    let res
    try {
      res = await fetchImpl(`https://login.microsoftonline.com/${enc(tenantId)}/oauth2/v2.0/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
      })
    } catch (e) {
      throw new GraphError(`Could not reach Microsoft Entra ID: ${e?.message || e}`, { code: 'network', retryable: true })
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.access_token) {
      // error_description can be long; its first line names the problem (bad secret, unknown tenant…)
      const desc = String(data.error_description || '').split(/\r?\n/)[0].slice(0, 300)
      throw new GraphError(`Microsoft Entra ID sign-in failed (${data.error || res.status})${desc ? `: ${desc}` : ''}`, {
        status: res.status, code: data.error || 'auth_failed', retryable: res.status >= 500 || res.status === 429,
        retryAfter: parseRetryAfter(res.headers?.get?.('retry-after'), now()),
      })
    }
    token = data.access_token
    tokenExp = now() + (Number(data.expires_in) || 3600) * 1000
    return token
  }

  async function request(method, pathOrUrl, { body, headers = {}, allow404 = false } = {}) {
    const url = /^https:\/\//.test(pathOrUrl) ? pathOrUrl : `${GRAPH_BASE}${pathOrUrl}`
    if (!url.startsWith('https://graph.microsoft.com/')) throw new GraphError('Refusing to call a non-Graph URL', { code: 'bad_url' })
    let authRetried = false
    for (let attempt = 0; ; attempt++) {
      const t = await getToken()
      let res
      try {
        res = await fetchImpl(url, {
          method,
          headers: { Authorization: `Bearer ${t}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
          body: body ? JSON.stringify(body) : undefined,
        })
      } catch (e) {
        if (attempt < maxRetries) { await sleep(Math.min(8000, 500 * 2 ** attempt)); continue }
        throw new GraphError(`Microsoft Graph unreachable: ${e?.message || e}`, { code: 'network', retryable: true })
      }
      if (res.status === 401 && !authRetried) { authRetried = true; await getToken(true); continue }
      if (res.status === 404 && allow404) return null
      if (res.status === 204) return {}
      if ([429, 503, 504].includes(res.status)) {
        const wait = parseRetryAfter(res.headers?.get?.('retry-after'), now())
        const secs = wait ?? Math.min(30, 2 ** attempt)
        if (attempt < maxRetries && secs <= maxInlineWaitSecs) { await sleep(secs * 1000); continue }
        throw new GraphError(`Microsoft Graph throttled the request (HTTP ${res.status})`, { status: res.status, code: 'throttled', retryAfter: wait ?? 60, retryable: true })
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const code = data?.error?.code || ''
        const msg = String(data?.error?.message || '').slice(0, 300)
        throw new GraphError(`Microsoft Graph ${method} failed (HTTP ${res.status}${code ? ` ${code}` : ''})${msg ? `: ${msg}` : ''}`, {
          status: res.status, code, retryable: res.status >= 500,
        })
      }
      return data
    }
  }

  const userPath = mailbox => `/users/${enc(mailbox)}`

  return {
    getToken,
    request,

    // Plain-text body + immutable ids. null when the message no longer exists.
    getMessage(mailbox, id) {
      return request('GET', `${userPath(mailbox)}/messages/${enc(id)}?$select=${MESSAGE_SELECT}`, {
        headers: { Prefer: 'outlook.body-content-type="text", IdType="ImmutableId"' }, allow404: true,
      })
    },

    // Attachment metadata only (bytes come from attachmentBytes). @odata.type tells
    // file attachments from attached emails (item) and cloud links (reference).
    async listAttachments(mailbox, messageId) {
      const data = await request('GET', `${userPath(mailbox)}/messages/${enc(messageId)}/attachments?$select=id,name,contentType,size,isInline`, {
        headers: { Prefer: 'IdType="ImmutableId"' },
      })
      return (data?.value || []).map(a => ({
        id: a.id, name: a.name, contentType: a.contentType, size: a.size, isInline: !!a.isInline,
        kind: /fileAttachment/i.test(a['@odata.type'] || '') ? 'file' : /itemAttachment/i.test(a['@odata.type'] || '') ? 'item' : /referenceAttachment/i.test(a['@odata.type'] || '') ? 'reference' : 'file',
      }))
    },

    // Raw bytes of one file attachment ($value), with the same retry / throttling rules.
    async attachmentBytes(mailbox, messageId, attachmentId, maxBytes = 26214400) {
      const url = `${GRAPH_BASE}${userPath(mailbox)}/messages/${enc(messageId)}/attachments/${enc(attachmentId)}/$value`
      for (let attempt = 0; ; attempt++) {
        const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${await getToken()}` } })
        if ([429, 503, 504].includes(res.status)) {
          const wait = parseRetryAfter(res.headers?.get?.('retry-after'), now()) ?? Math.min(30, 2 ** attempt)
          if (attempt < maxRetries && wait <= maxInlineWaitSecs) { await sleep(wait * 1000); continue }
          throw new GraphError(`Microsoft Graph throttled the attachment download (HTTP ${res.status})`, { status: res.status, code: 'throttled', retryAfter: wait, retryable: true })
        }
        if (!res.ok) throw new GraphError(`Attachment download failed (HTTP ${res.status})`, { status: res.status, retryable: res.status >= 500 })
        const len = Number(res.headers?.get?.('content-length') || 0)
        if (len && len > maxBytes) throw new GraphError('Attachment is larger than the configured limit', { code: 'too_large' })
        const buf = new Uint8Array(await res.arrayBuffer())
        if (buf.length > maxBytes) throw new GraphError('Attachment is larger than the configured limit', { code: 'too_large' })
        return buf
      }
    },

    testMailbox(mailbox) {
      return request('GET', `${userPath(mailbox)}/mailFolders/inbox?$select=id,displayName,totalItemCount,unreadItemCount`)
    },

    createSubscription({ mailbox, notificationUrl, lifecycleNotificationUrl, clientState, minutes = SUBSCRIPTION_MINUTES }) {
      return request('POST', '/subscriptions', {
        headers: { Prefer: 'IdType="ImmutableId"' },
        body: {
          changeType: 'created',
          notificationUrl,
          lifecycleNotificationUrl,
          resource: `users/${mailbox}/mailFolders('inbox')/messages`,
          expirationDateTime: new Date(now() + minutes * 60000).toISOString(),
          clientState,
          latestSupportedTlsVersion: 'v1_2',
        },
      })
    },

    renewSubscription(id, minutes = SUBSCRIPTION_MINUTES) {
      return request('PATCH', `/subscriptions/${enc(id)}`, { body: { expirationDateTime: new Date(now() + minutes * 60000).toISOString() }, allow404: true })
    },

    deleteSubscription(id) {
      return request('DELETE', `/subscriptions/${enc(id)}`, { allow404: true })
    },

    // Inbox delta: every message id added since the stored deltaLink (or,
    // first time, received since `since`). Follows @odata.nextLink pages.
    // Returns { ids, deltaLink, complete } — complete=false when maxPages ran
    // out (the nextLink is returned as deltaLink so the next run resumes).
    async inboxDelta(mailbox, { deltaLink, since, maxPages = 20 } = {}) {
      const headers = { Prefer: 'odata.maxpagesize=50, IdType="ImmutableId"' }
      let url = deltaLink || `${userPath(mailbox)}/mailFolders('inbox')/messages/delta?$select=id,receivedDateTime` +
        (since ? `&$filter=${enc(`receivedDateTime ge ${new Date(since).toISOString().replace(/\.\d{3}Z$/, 'Z')}`)}` : '')
      const ids = []
      for (let page = 0; page < maxPages; page++) {
        let data
        try {
          data = await request('GET', url, { headers })
        } catch (e) {
          // expired / unknown sync state → start over from `since`
          if (deltaLink && url === deltaLink && (e.status === 410 || /syncState|resyncRequired/i.test(e.code))) {
            return this.inboxDelta(mailbox, { since, maxPages })
          }
          throw e
        }
        for (const m of data.value || []) if (m?.id && !m['@removed']) ids.push(m.id)
        if (data['@odata.deltaLink']) return { ids, deltaLink: data['@odata.deltaLink'], complete: true }
        if (!data['@odata.nextLink']) return { ids, deltaLink: null, complete: true }
        url = data['@odata.nextLink']
      }
      return { ids, deltaLink: url, complete: false }
    },
  }
}

// Graph message → the fields the processor uses. Defensive: any part of a
// malformed message may be missing.
export function normalizeMessage(m) {
  const addr = r => String(r?.emailAddress?.address || '').trim().toLowerCase()
  const from = m?.from || m?.sender || {}
  const headers = Object.fromEntries((Array.isArray(m?.internetMessageHeaders) ? m.internetMessageHeaders : [])
    .filter(h => h && h.name).map(h => [String(h.name).toLowerCase(), String(h.value ?? '')]))
  const bodyText = m?.body?.contentType === 'html' ? htmlToText(m.body.content) : String(m?.body?.content ?? m?.bodyPreview ?? '')
  return {
    graphId: m?.id || null,
    internetMessageId: m?.internetMessageId || null,
    conversationId: m?.conversationId || null,
    subject: String(m?.subject ?? '').trim().slice(0, 500),
    senderEmail: addr(from) || null,
    senderName: String(from?.emailAddress?.name || '').trim().slice(0, 200) || null,
    to: [...(m?.toRecipients || []), ...(m?.ccRecipients || [])].map(addr).filter(Boolean).slice(0, 50),
    receivedAt: m?.receivedDateTime || null,
    webLink: /^https:\/\/[^\s]+$/.test(m?.webLink || '') ? m.webLink : null,
    body: cleanBody(bodyText),
    headers,
    isDraft: !!m?.isDraft,
  }
}

export function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

// Trim quoted history and signatures-ish noise, collapse whitespace, cap size.
export function cleanBody(text, max = 8000) {
  let t = String(text || '').replace(/\r\n?/g, '\n')
  const cut = t.search(/\n(-{2,}\s*Original Message\s*-{2,}|From:\s.+\nSent:\s|On .{5,80}wrote:\s*\n|_{10,})/i)
  if (cut > 40) t = t.slice(0, cut)
  t = t.split('\n').filter(l => !/^\s*>/.test(l)).join('\n')
  return t.replace(/[ \t\f\v]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
}
