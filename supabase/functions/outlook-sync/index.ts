// Supabase Edge Function: outlook-sync
//
// Worker + admin actions for the Outlook email → task module (STEP261).
//
//   action 'run'         (cron, every minute) for each mailbox: create /
//                        renew / remove the Graph subscription, reconcile
//                        missed mail every 15 min (inbox delta), then
//                        process due queue rows.
//   action 'process'     process due queue rows now (webhook nudge, or a
//                        user's "Retry" with message_id).
//   action 'reconcile'   inbox delta for one mailbox now, then process.
//   action 'test'        sign in to Entra ID and read the mailbox's Inbox.
//   action 'subscribe'   (re)create the subscription now.
//   action 'unsubscribe' remove it.
//   action 'dry_run'     Email Intelligence test: sample email (+ attachments as
//                        base64) through the DRAFT configuration, read-only:
//                        nothing is stored, created or sent (admin/ceo/finance).
//   action 'simulate'    run a sample email (sender / subject / body given in
//                        the request) through the real pipeline — classify,
//                        match, create task / review — with only the Graph
//                        fetch stubbed. For trying the flow before Microsoft
//                        Entra ID is set up; stored with source = 'MANUAL'.
//
// Callers: cron with "Authorization: Bearer <CRON_SECRET>" (any action, all
// orgs), or a signed-in user (supabase.functions.invoke): admin/ceo for
// test/subscribe/unsubscribe, admin/ceo/manager/department_head for
// process/reconcile — always limited to the caller's own organization.
//
// Pipeline logic lives in ../_shared/outlook*.js (tested with node --test).
//
// Deploy:   supabase functions deploy outlook-sync --no-verify-jwt
// Secrets:  CRON_SECRET (shared with send-email)
//           MS_GRAPH_TENANT_ID / MS_GRAPH_CLIENT_ID / MS_GRAPH_CLIENT_SECRET
//             — optional defaults when a mailbox doesn't carry its own
//           OUTLOOK_WEBHOOK_URL — optional, defaults to <SUPABASE_URL>/functions/v1/outlook-webhook
//           ANTHROPIC_API_KEY / DEEPSEEK_API_KEY / GEMINI_API_KEY — optional
//             fallbacks when the org has no key in Settings → AI / LLM Keys
//
// The service role bypasses RLS, so every query filters explicitly.

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createGraphClient } from '../_shared/outlookGraph.js'
import { processMessage, maintainSubscription, reconcileMailbox, reconcileDue, safeError } from '../_shared/outlookProcessor.js'
import { pickProvider } from '../_shared/outlookClassifier.js'
import { runEmailIntelligence } from '../_shared/eiPipeline.js'
import { extractAttachmentText, expandContainer, sha256Hex, toBase64, fromBase64 } from '../_shared/eiText.ts'

const env = (k: string, d = '') => Deno.env.get(k) ?? d
const TIME_BUDGET_MS = 110_000
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

type Caller = { system: true; orgId: null; role: null } | { system: false; orgId: string; role: string; userId: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const started = Date.now()
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

  // ── who is calling ──
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  let caller: Caller
  if (env('CRON_SECRET') && bearer === env('CRON_SECRET')) {
    caller = { system: true, orgId: null, role: null }
  } else {
    const { data: u } = bearer ? await admin.auth.getUser(bearer) : { data: { user: null } }
    if (!u?.user) return json({ error: 'Unauthorized' }, 401)
    const { data: p } = await admin.from('profiles').select('role, organization_id, is_active').eq('id', u.user.id).maybeSingle()
    if (!p || p.is_active === false || !['admin', 'ceo', 'manager', 'department_head', 'finance'].includes(p.role)) return json({ error: 'Forbidden' }, 403)
    caller = { system: false, orgId: p.organization_id, role: p.role, userId: u.user.id }
  }

  let body: any = {}
  try { body = await req.json() } catch { /* empty body = run */ }
  const action = String(body.action || 'run')
  if (!caller.system) {
    if (['test', 'subscribe', 'unsubscribe', 'simulate'].includes(action) && !['admin', 'ceo'].includes(caller.role)) return json({ error: 'Only admins can do this' }, 403)
    if (action === 'dry_run' && !['admin', 'ceo', 'finance'].includes(caller.role)) return json({ error: 'Only admin, CEO or finance can test the configuration' }, 403)
    if (!['test', 'subscribe', 'unsubscribe', 'reconcile', 'process', 'simulate', 'dry_run'].includes(action)) return json({ error: 'Unknown action' }, 400)
  }

  // ── shared helpers ──
  const log = (mb: any, event: string, detail: Record<string, unknown> = {}, messageId: string | null = null) =>
    admin.from('outlook_email_events').insert({
      organization_id: mb.organization_id, mailbox_id: mb.id, message_id: messageId, event, detail,
      actor_id: caller.system ? null : caller.userId,
    }).then(() => {})
  const saveMb = (mb: any) => async (patch: Record<string, unknown>) => {
    Object.assign(mb, patch)
    const { error } = await admin.from('outlook_mailboxes').update(patch).eq('id', mb.id)
    if (error) console.error('[outlook-sync] mailbox save:', error.message)
  }

  const graphs = new Map<string, any>()
  const states = new Map<string, string>()
  async function graphFor(mb: any) {
    if (graphs.has(mb.id)) return graphs.get(mb.id)
    const { data } = await admin.rpc('outlook_mailbox_credentials', { p_mailbox: mb.id })
    const cred = (data ?? [])[0] || {}
    states.set(mb.id, cred.client_state || '')
    const g = createGraphClient({
      tenantId: mb.tenant_id || env('MS_GRAPH_TENANT_ID'),
      clientId: mb.client_id || env('MS_GRAPH_CLIENT_ID'),
      clientSecret: cred.client_secret || env('MS_GRAPH_CLIENT_SECRET'),
    })
    graphs.set(mb.id, g)
    return g
  }

  const aiCache = new Map<string, any>()
  async function aiFor(mb: any) {
    if (!aiCache.has(mb.organization_id)) {
      const { data } = await admin.from('llm_settings').select('claude_api_key, deepseek_api_key, gemini_api_key').eq('organization_id', mb.organization_id).maybeSingle()
      aiCache.set(mb.organization_id, {
        claude: data?.claude_api_key || env('ANTHROPIC_API_KEY'),
        deepseek: data?.deepseek_api_key || env('DEEPSEEK_API_KEY'),
        gemini: data?.gemini_api_key || env('GEMINI_API_KEY'),
      })
    }
    return { provider: mb.ai_provider, keys: aiCache.get(mb.organization_id) }
  }

  const ctxCache = new Map<string, any>()
  async function contextFor(orgId: string) {
    if (ctxCache.has(orgId)) return ctxCache.get(orgId)
    const [projects, customers, contacts, profiles] = await Promise.all([
      admin.from('projects').select('id, code, name, status, customer_id, client_name, manager_id, department_id').eq('organization_id', orgId),
      admin.from('customers').select('id, name, email, status').eq('organization_id', orgId),
      admin.from('contacts').select('email, customer_id, status').eq('organization_id', orgId).not('customer_id', 'is', null),
      admin.from('profiles').select('id, full_name, email, is_active').eq('organization_id', orgId),
    ])
    if (projects.error) throw new Error(`projects: ${projects.error.message}`)
    const ctx = {
      projects: projects.data ?? [], customers: customers.data ?? [],
      contacts: contacts.error ? [] : (contacts.data ?? []),   // contacts (STEP258) is optional
      profiles: profiles.data ?? [],
    }
    ctxCache.set(orgId, ctx)
    return ctx
  }

  async function loadMailboxes(filter: { id?: string; ids?: string[]; activeOnly?: boolean }) {
    let q = admin.from('outlook_mailboxes').select('*')
    if (!caller.system) q = q.eq('organization_id', caller.orgId)
    if (filter.id) q = q.eq('id', filter.id)
    if (filter.ids?.length) q = q.in('id', filter.ids)
    if (filter.activeOnly) q = q.or('enabled.eq.true,subscription_id.not.is.null')
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return data ?? []
  }

  const webhookUrl = env('OUTLOOK_WEBHOOK_URL') || `${env('SUPABASE_URL')}/functions/v1/outlook-webhook`
  async function subscription(mb: any, force = false) {
    const graph = await graphFor(mb)
    return maintainSubscription(mb, {
      graph, clientState: states.get(mb.id), notificationUrl: webhookUrl, lifecycleNotificationUrl: webhookUrl,
      save: saveMb(mb), log: (e: string, d: any) => log(mb, e, d), force,
    })
  }
  async function reconcile(mb: any) {
    const graph = await graphFor(mb)
    return reconcileMailbox(mb, {
      graph, save: saveMb(mb), log: (e: string, d: any) => log(mb, e, d),
      enqueue: async (id: string) => {
        const { data, error } = await admin.rpc('outlook_enqueue_message', { p_mailbox: mb.id, p_graph_id: id, p_source: 'RECONCILE' })
        if (error) throw new Error(error.message)
        return !!data
      },
    })
  }

  // ── Email Intelligence (STEP263–265) ──
  const cfgCache = new Map<string, any>()
  async function configFor(orgId: string, draft = false) {
    const key = `${orgId}|${draft}`
    if (!cfgCache.has(key)) {
      const { data, error } = await admin.rpc(draft ? 'ei_draft_config' : 'ei_active_config', { p_org: orgId })
      cfgCache.set(key, error ? null : (data ?? [])[0] || null)   // NULL = not set up → STEP261 behaviour only
    }
    return cfgCache.get(key)
  }
  const lookCache = new Map<string, any>()
  function lookupFor(orgId: string, settings: any) {
    if (lookCache.has(orgId)) return lookCache.get(orgId)
    const days = Number(settings?.matching?.duplicate_window_days ?? 730)
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
    let vendors: any = null, contacts: any = null
    const l = {
      vendors: async () => (vendors ??= (await admin.from('vendors').select('id, name, code, gst_number, email, status').eq('organization_id', orgId).limit(5000)).data ?? []),
      contacts: async () => (contacts ??= await (async () => { const r = await admin.from('contacts').select('email, vendor_id, status').eq('organization_id', orgId).not('vendor_id', 'is', null); return r.error ? [] : r.data ?? [] })()),
      posByNumbers: async (nums: string[]) => {
        const out: any[] = []
        for (const n of nums.slice(0, 5)) {
          const { data } = await admin.from('purchase_orders').select('id, po_number, vendor_id, project_id, status, total_amount').eq('organization_id', orgId).ilike('po_number', n.replace(/[%_]/g, ''))
          out.push(...(data ?? []))
        }
        return out
      },
      posByVendor: async (v: string) => (await admin.from('purchase_orders').select('id, po_number, vendor_id, project_id, status, total_amount').eq('organization_id', orgId).eq('vendor_id', v).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(200)).data ?? [],
      grnsByPo: async (po: string) => (await admin.from('grn').select('id, po_id, status, received_amount, grn_number').eq('organization_id', orgId).eq('po_id', po)).data ?? [],
      invoicesByVendor: async (v: string) => (await admin.from('invoices').select('id, invoice_number, vendor_id, po_id, total_amount, status, source_attachment_id').eq('organization_id', orgId).eq('vendor_id', v).gte('created_at', since).limit(2000)).data ?? [],
      invoicesByPo: async (po: string) => (await admin.from('invoices').select('id, invoice_number, vendor_id, po_id, total_amount, status, source_attachment_id').eq('organization_id', orgId).eq('po_id', po).neq('status', 'rejected')).data ?? [],
      // STEP268 — file every document on its project
      projectContext: () => contextFor(orgId),
      conversationProjects: async (conv: string) => {
        const [m, d] = await Promise.all([
          admin.from('outlook_email_messages').select('conversation_id, matched_project_id').eq('organization_id', orgId).eq('conversation_id', conv).not('matched_project_id', 'is', null).limit(20),
          admin.from('ei_attachments').select('conversation_id, project_id').eq('organization_id', orgId).eq('conversation_id', conv).in('project_status', ['MATCHED', 'CONFIRMED']).limit(20),
        ])
        return [...(m.data ?? []), ...(d.error ? [] : (d.data ?? []).map((x: any) => ({ conversation_id: x.conversation_id, matched_project_id: x.project_id })))]
      },
      attachmentsBySha: async (sha: string) => sha ? (await admin.from('ei_attachments').select('id, sha256, invoice_id, message_id').eq('organization_id', orgId).eq('sha256', sha).limit(20)).data ?? [] : [],
    }
    lookCache.set(orgId, l)
    return l
  }
  // Document register columns exist once sql/STEP268 has run — until then the
  // pipeline keeps writing only the STEP265 columns.
  let registerReady: boolean | null = null
  async function documentRegisterReady() {
    if (registerReady === null) registerReady = !(await admin.from('ei_attachments').select('review_state').limit(1)).error
    return registerReady
  }
  // Revision chains (STEP271)
  let versionsReady: boolean | null = null
  async function versionsReadyFor() {
    if (versionsReady === null) versionsReady = !(await admin.from('ei_attachments').select('version_link_state').limit(1)).error
    return versionsReady
  }
  const normNo = (n: string | null) => String(n || '').toUpperCase().replace(/^(NO|NUMBER|REF)[\s.:#-]+/, '').replace(/[^A-Z0-9]/g, '') || null
  function relatedDocumentsFor(orgId: string) {
    return async (d: any) => {
      const cols = 'id, sha256, document_number, revision, doc_type_code, project_id, title, file_name, message_id, version_group_id, created_at'
      const base = () => admin.from('ei_attachments').select(cols).eq('organization_id', orgId).eq('status', 'PROCESSED').neq('id', d.id)
      const since = new Date(Date.now() - 180 * 86400000).toISOString()
      const qs = [
        d.sha256 ? base().eq('sha256', d.sha256).limit(5) : null,
        normNo(d.document_number) && normNo(d.document_number)!.length >= 3 ? base().eq('doc_number_norm', normNo(d.document_number)).limit(30) : null,
        d.doc_type_code && d.doc_type_code !== 'UNKNOWN_DOCUMENT' ? base().eq('doc_type_code', d.doc_type_code).gte('created_at', since).order('created_at', { ascending: false }).limit(40) : null,
        d.conversation_id ? base().eq('conversation_id', d.conversation_id).limit(20) : null,
      ].filter(Boolean) as any[]
      const rows = new Map<string, any>()
      for (const r of await Promise.all(qs)) for (const x of r.data ?? []) rows.set(x.id, x)
      const msgIds = [...new Set([...rows.values()].map((x: any) => x.message_id))]
      const msgs = msgIds.length ? (await admin.from('outlook_email_messages').select('id, sender_email, received_at').in('id', msgIds)).data ?? [] : []
      const byMsg = new Map(msgs.map((m: any) => [m.id, m]))
      return [...rows.values()].map((x: any) => ({ ...x, sender_email: byMsg.get(x.message_id)?.sender_email || null, received_at: byMsg.get(x.message_id)?.received_at || x.created_at }))
        .sort((a: any, b: any) => String(b.received_at).localeCompare(String(a.received_at)))
    }
  }
  // New-type suggestions (STEP270)
  let suggestionsReady: boolean | null = null
  async function typeSuggestionsReady() {
    if (suggestionsReady === null) suggestionsReady = !(await admin.from('ei_attachments').select('suggested_type_code').limit(1)).error
    return suggestionsReady
  }
  type AttSource = { graph: any; mailbox: string; messageId: string } | { samples: { name: string; content_type?: string; base64: string }[] }
  function eiDeps(orgId: string, settings: any, source: AttSource, ai: any) {
    const attachments = 'graph' in source
      ? { list: () => source.graph.listAttachments(source.mailbox, source.messageId),
          fetchBytes: (a: any) => source.graph.attachmentBytes(source.mailbox, source.messageId, a.id, Number(settings?.attachments?.max_mb ?? 15) * 1048576) }
      : { list: async () => source.samples.slice(0, 20).map((x, i) => ({ id: `sample-${i}`, name: String(x.name || `file-${i}`).slice(0, 200), contentType: x.content_type || 'application/octet-stream', size: Math.floor(String(x.base64 || '').length * 0.75), isInline: false, kind: 'file' })),
          fetchBytes: async (a: any) => fromBase64(source.samples[Number(a.id.split('-')[1])].base64) }
    return {
      attachments, ai, toBase64,
      sha256: sha256Hex,
      text: { extract: (bytes: Uint8Array, ext: string, ct: string) => extractAttachmentText(bytes, ext, ct), expand: (bytes: Uint8Array, ext: string, ct: string) => expandContainer(bytes, ext, ct) },
      storage: { put: async (path: string, bytes: Uint8Array, ct: string) => {
        const { error } = await admin.storage.from('email-attachments').upload(path, bytes, { contentType: ct || 'application/octet-stream', upsert: true })
        if (error) throw new Error(`storage: ${error.message}`)
      } },
      lookup: lookupFor(orgId, settings),
      db: {
        upsertAttachment: async (row: any, rec: any) => {
          await admin.from('ei_attachments').upsert({ organization_id: row.organization_id, message_id: row.id, ...rec }, { onConflict: 'message_id,graph_attachment_id', ignoreDuplicates: true })
          const { data, error } = await admin.from('ei_attachments').select('id, storage_path, sha256, invoice_id').eq('message_id', row.id).eq('graph_attachment_id', rec.graph_attachment_id).single()
          if (error) throw new Error(error.message)
          return { ...rec, ...data }
        },
        updateAttachment: async (id: string, patch: any) => {
          const { error } = await admin.from('ei_attachments').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
          if (error) throw new Error(error.message)
        },
        createInvoice: async (attId: string, payload: any) => {
          const { data, error } = await admin.rpc('ei_create_invoice', { p_attachment: attId, p: payload })
          if (error) throw new Error(error.message)
          return data
        },
        raiseException: async (e: any) => {
          const { data, error } = await admin.rpc('ei_raise_exception', {
            p_org: orgId, p_message: e.messageId, p_attachment: e.attachmentId || null, p_kind: e.kind, p_summary: e.summary,
            p_detail: e.detail || {}, p_priority: e.priority || 'medium', p_role: e.role || null, p_department: e.departmentId || null,
            p_due_hours: null, p_version: e.version ?? null,
          })
          if (error) throw new Error(error.message)
          return data
        },
      },
    }
  }
  async function eiAiFor(mb: any) {
    const a = await aiFor(mb)
    const provider = pickProvider(a.provider, a.keys)
    return provider ? { provider, apiKey: a.keys[provider] } : null
  }
  async function intelligenceFor(mb: any, source: AttSource) {
    const cfg = await configFor(mb.organization_id)
    if (!cfg) return null
    const ai = await eiAiFor(mb)
    return async (row: any, email: any) => {
      const deps: any = eiDeps(mb.organization_id, cfg.snapshot?.settings, source, ai)
      deps.documentRegister = await documentRegisterReady()
      if (deps.documentRegister && await versionsReadyFor()) {
        deps.lookup = { ...deps.lookup, relatedDocuments: relatedDocumentsFor(mb.organization_id) }
        deps.db.linkVersion = async (id: string, v: any) => {
          const { error } = await admin.rpc('ei_link_document_version', { p_id: id, p_relation: v.relation, p_related: v.related_id, p_group: v.group_id, p_confidence: v.confidence, p_reason: v.reason })
          if (error) throw new Error(error.message)
        }
      }
      if (deps.documentRegister && await typeSuggestionsReady()) {
        deps.db.suggestType = async (s: any) => {
          const { error } = await admin.rpc('ei_suggest_document_type', {
            p_org: mb.organization_id, p_code: s.code, p_name: s.name, p_family: s.family, p_aliases: s.aliases || [],
            p_description: s.description, p_rationale: s.rationale, p_attachment: s.attachmentId, p_version: s.version ?? null,
          })
          if (error) throw new Error(error.message)
        }
      }
      const raise = deps.db.raiseException
      deps.db.raiseException = (e: any) => raise({ ...e, messageId: row.id })
      return runEmailIntelligence({ row, email, config: cfg.snapshot, version: cfg.version, deps })
    }
  }

  async function processQueue(messageId: string | null = null) {
    const results: any[] = []
    const mbCache = new Map<string, any>()
    while (Date.now() - started < TIME_BUDGET_MS) {
      const { data: rows, error } = await admin.rpc('outlook_claim_messages', { p_limit: 5, p_message: messageId })
      if (error) throw new Error(error.message)
      if (!rows?.length) break
      for (const row of rows) {
        let mb = mbCache.get(row.mailbox_id)
        if (!mb) { mb = (await admin.from('outlook_mailboxes').select('*').eq('id', row.mailbox_id).maybeSingle()).data; mbCache.set(row.mailbox_id, mb) }
        let res
        try {
          const graph = await graphFor(mb)
          res = await processMessage(row, {
            mailbox: mb, graph, ai: await aiFor(mb), context: await contextFor(mb.organization_id), db: db(),
            intelligence: await intelligenceFor(mb, { graph, mailbox: mb.mailbox_address, messageId: row.graph_message_id }),
          })
        } catch (e) {
          // setup problems (credentials missing…) before the pipeline could record anything
          const err = safeError(e)
          await admin.rpc('outlook_record_result', { p_message: row.id, p_status: 'FAILED', p_fields: { error: err }, p_retry_after_secs: null })
          res = { status: 'FAILED', error: err }
        }
        if (res.error && /sign-in failed|not configured|HTTP 40[13]/i.test(res.error)) {
          await saveMb(mb)({ last_error: res.error, last_error_at: new Date().toISOString() })
        }
        results.push({ id: row.id, status: res.status, error: res.error })
      }
      if (messageId) break
    }
    return results
  }

  function db() {
    return {
      findDuplicate: async (row: any, imid: string) => {
        const { data } = await admin.from('outlook_email_messages').select('id')
          .eq('mailbox_id', row.mailbox_id).eq('internet_message_id', imid).neq('id', row.id).limit(1)
        return !!data?.length
      },
      history: async (row: any, conversationId: string) => {
        const { data } = await admin.from('outlook_email_messages').select('conversation_id, matched_project_id')
          .eq('mailbox_id', row.mailbox_id).eq('conversation_id', conversationId).eq('status', 'TASK_CREATED').neq('id', row.id).limit(20)
        return data ?? []
      },
      record: async (id: string, status: string, fields: Record<string, unknown>, retryAfter: number | null = null) => {
        const { data, error } = await admin.rpc('outlook_record_result', { p_message: id, p_status: status, p_fields: fields, p_retry_after_secs: retryAfter })
        if (error) throw new Error(error.message)
        return data
      },
      createTask: async (a: any) => {
        const { data, error } = await admin.rpc('outlook_create_task', {
          p_message: a.messageId, p_project: a.projectId, p_title: a.title, p_description: a.description, p_priority: a.priority,
          p_assignee: a.assigneeId, p_due: a.dueDate, p_method: a.method, p_match_conf: a.matchConfidence, p_customer: a.customerId,
        })
        if (error) throw new Error(error.message)
        return data
      },
    }
  }

  // ── actions ──
  try {
    if (action === 'run') {
      const boxes = await loadMailboxes({ activeOnly: true })
      const summary: any[] = []
      for (const mb of boxes) {
        const s: any = { mailbox: mb.mailbox_address }
        try {
          s.subscription = await subscription(mb)
          if (reconcileDue(mb)) s.reconcile = await reconcile(mb)
        } catch (e) {
          const err = safeError(e)
          if (mb.last_error !== err) {   // log a problem once, not every minute
            await saveMb(mb)({ last_error: err, last_error_at: new Date().toISOString() })
            await log(mb, 'SYNC_ERROR', { error: err })
          }
          s.error = err
        }
        summary.push(s)
      }
      const processed = await processQueue()
      return json({ mailboxes: summary, processed: processed.length })
    }

    if (action === 'process') {
      let messageId: string | null = body.message_id || null
      if (messageId && !caller.system) {
        const { data } = await admin.from('outlook_email_messages').select('id').eq('id', messageId).eq('organization_id', caller.orgId).maybeSingle()
        if (!data) return json({ error: 'Not found' }, 404)
      }
      const r = await processQueue(messageId)
      // the queue is shared: a user only sees results for their own message
      return json(caller.system ? { processed: r } : { ok: true, processed: messageId ? r : undefined })
    }

    if (action === 'dry_run') {
      const orgId = caller.system ? String(body.organization_id || '') : caller.orgId
      if (!orgId) return json({ error: 'organization_id required' }, 400)
      const cfg = await configFor(orgId, body.use_published !== true)
      if (!cfg) return json({ error: 'Email Intelligence is not set up for this organization. Load the defaults first.' }, 400)
      const e = body.email || {}
      const email = {
        subject: String(e.subject || '').slice(0, 500), body: String(e.body || '').slice(0, 20000),
        senderEmail: String(e.from_email || '').trim().toLowerCase(), senderName: String(e.from_name || '').slice(0, 200), receivedAt: new Date().toISOString(),
      }
      const [anyMb] = await loadMailboxes({})
      const ai = anyMb ? await eiAiFor(anyMb) : null
      const deps = eiDeps(orgId, cfg.snapshot?.settings, { samples: Array.isArray(body.attachments) ? body.attachments : [] }, ai)
      const report = await runEmailIntelligence({ row: { id: 'dry-run', organization_id: orgId }, email, config: cfg.snapshot, version: cfg.version, deps, simulate: true })
      return json({ ok: true, draft: body.use_published !== true, version: cfg.version, report })
    }

    const [mb] = await loadMailboxes({ id: body.mailbox_id })
    if (!mb) return json({ error: 'Mailbox not found' }, 404)

    if (action === 'test') {
      try {
        const inbox = await (await graphFor(mb)).testMailbox(mb.mailbox_address)
        await saveMb(mb)({ last_test_at: new Date().toISOString(), last_test_ok: true, last_error: null, last_error_at: null })
        await log(mb, 'CONNECTION_TEST', { ok: true })
        return json({ ok: true, inbox: { name: inbox.displayName, total: inbox.totalItemCount, unread: inbox.unreadItemCount } })
      } catch (e) {
        const err = safeError(e)
        await saveMb(mb)({ last_test_at: new Date().toISOString(), last_test_ok: false, last_error: err, last_error_at: new Date().toISOString() })
        await log(mb, 'CONNECTION_TEST', { ok: false, error: err })
        return json({ ok: false, error: err })
      }
    }
    if (action === 'subscribe') {
      if (!mb.enabled) return json({ ok: false, error: 'Turn the mailbox on first' })
      const r = await subscription(mb, true)
      return json({ ok: r.ok, error: r.error, expires: mb.subscription_expires_at })
    }
    if (action === 'unsubscribe') {
      if (mb.subscription_id) { try { await (await graphFor(mb)).deleteSubscription(mb.subscription_id) } catch { /* gone */ } }
      await saveMb(mb)({ subscription_id: null, subscription_status: 'NONE', subscription_expires_at: null })
      await log(mb, 'UNSUBSCRIBED', {})
      return json({ ok: true })
    }
    if (action === 'simulate') {
      const e = body.email || {}
      const subject = String(e.subject || '').slice(0, 500), text = String(e.body || '').slice(0, 20000)
      const fromEmail = String(e.from_email || '').trim().toLowerCase()
      if (!subject || !text || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fromEmail)) return json({ error: 'Sender email, subject and body are required' }, 400)
      const graphId = `sample-${crypto.randomUUID()}`
      const { data: row, error } = await admin.from('outlook_email_messages').insert({
        organization_id: mb.organization_id, mailbox_id: mb.id, graph_message_id: graphId, source: 'MANUAL',
        status: 'PROCESSING', attempts: 1, locked_at: new Date().toISOString(),
      }).select().single()
      if (error) throw new Error(error.message)
      await log(mb, 'RECEIVED', { source: 'SAMPLE' }, row.id)
      const sample = {
        id: graphId, internetMessageId: `<${graphId}@sample.invalid>`, conversationId: e.conversation_id || `sample-conv-${graphId}`,
        subject, from: { emailAddress: { address: fromEmail, name: String(e.from_name || '').slice(0, 200) } },
        toRecipients: [{ emailAddress: { address: mb.mailbox_address } }], body: { contentType: 'text', content: text },
        receivedDateTime: new Date().toISOString(), webLink: null, internetMessageHeaders: [],
      }
      const res: any = await processMessage(row, {
        mailbox: { ...mb, process_since: null }, graph: { getMessage: async () => sample },
        ai: await aiFor(mb), context: await contextFor(mb.organization_id), db: db(),
        intelligence: await intelligenceFor(mb, { samples: Array.isArray(body.attachments) ? body.attachments : [] }),
      })
      const { data: after } = await admin.from('outlook_email_messages').select('id, status, decision_reason, matched_project_id, task_id, category, confidence, classifier, intents').eq('id', row.id).single()
      return json({ ok: true, result: { status: res.status, reason: res.reason, error: res.error, taskId: res.taskId }, message: after, report: res.report || null })
    }
    if (action === 'reconcile') {
      if (!mb.enabled) return json({ ok: false, error: 'Turn the mailbox on first' })
      const r = await reconcile(mb)
      await processQueue()
      return json({ ok: true, ...r })
    }
    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    console.error('[outlook-sync]', action, safeError(e))
    return json({ error: safeError(e) }, 500)
  }
})
