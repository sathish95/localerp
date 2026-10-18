// Supabase Edge Function: outlook-webhook
//
// Microsoft Graph change-notification endpoint for the Outlook email → task
// module (STEP261). Both the subscription's notificationUrl and its
// lifecycleNotificationUrl point here:
//   https://<project-ref>.supabase.co/functions/v1/outlook-webhook
//
// It only validates and records (logic in ../_shared/outlookWebhook.js):
// the validation-token echo, the per-mailbox secret clientState, then one
// queue row per new message id. The heavy work (Graph fetch, AI, task
// creation) runs in outlook-sync, which this function nudges right away
// (and which cron runs every minute anyway), so Graph gets its 202 fast.
//
// Deploy:   supabase functions deploy outlook-webhook --no-verify-jwt
//           (Graph sends no Supabase JWT — authenticity = clientState)
// Secrets:  CRON_SECRET (optional, to nudge outlook-sync immediately).
//           SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided automatically.
//
// Never logs notification bodies, tokens or clientState values.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleWebhook } from '../_shared/outlookWebhook.js'

const env = (k: string) => Deno.env.get(k) ?? ''

Deno.serve(async (req) => {
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
  const bodyText = req.method === 'POST' ? await req.text() : ''

  let out
  try {
    out = await handleWebhook({ method: req.method, url: req.url, bodyText }, {
      lookup: async (ids: string[]) => {
        const { data, error } = await admin.rpc('outlook_webhook_lookup', { p_subscription_ids: ids })
        if (error) throw new Error(error.message)
        return data ?? []
      },
      enqueue: async (mailboxId: string, graphId: string) => {
        const { data, error } = await admin.rpc('outlook_enqueue_message', { p_mailbox: mailboxId, p_graph_id: graphId, p_source: 'WEBHOOK' })
        if (error) throw new Error(error.message)
        return !!data
      },
      onLifecycle: async ({ mailboxId, event }: { mailboxId: string; event: string }) => {
        // The worker acts on these on its next run (≤ 1 min):
        //  reauthorizationRequired → renew now; subscriptionRemoved → recreate; missed → reconcile now
        const patch: Record<string, unknown> =
          event === 'subscriptionRemoved' ? { subscription_status: 'REMOVED' }
          : event === 'reauthorizationRequired' ? { subscription_expires_at: new Date().toISOString() }
          : { last_reconciled_at: null }
        await admin.from('outlook_mailboxes').update(patch).eq('id', mailboxId)
        const { data: mb } = await admin.from('outlook_mailboxes').select('organization_id').eq('id', mailboxId).maybeSingle()
        if (mb) await admin.from('outlook_email_events').insert({ organization_id: mb.organization_id, mailbox_id: mailboxId, event: 'LIFECYCLE', detail: { event } })
      },
      onRejected: async ({ mailboxId, reason }: { mailboxId: string | null; reason: string }) => {
        console.warn(`[outlook-webhook] dropped notification: ${reason}`)
        if (!mailboxId) return
        const { data: mb } = await admin.from('outlook_mailboxes').select('organization_id').eq('id', mailboxId).maybeSingle()
        if (mb) await admin.from('outlook_email_events').insert({ organization_id: mb.organization_id, mailbox_id: mailboxId, event: 'NOTIFICATION_REJECTED', detail: { reason } })
      },
      touch: async (ids: string[]) => {
        await admin.from('outlook_mailboxes').update({ last_notification_at: new Date().toISOString() }).in('id', ids)
      },
    })
  } catch (e) {
    // Database unreachable: a 5xx makes Graph redeliver later; reconciliation is the backstop.
    console.error('[outlook-webhook] failed:', (e as Error).message)
    return new Response('Temporarily unavailable', { status: 503, headers: { 'Content-Type': 'text/plain' } })
  }

  if (out.enqueued > 0 && env('CRON_SECRET')) {
    const nudge = fetch(`${env('SUPABASE_URL')}/functions/v1/outlook-sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('CRON_SECRET')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'process', mailbox_ids: out.mailboxes }),
    }).catch(() => {})
    // @ts-ignore EdgeRuntime is a Supabase global
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(nudge)
  }
  return new Response(out.body, { status: out.status, headers: { ...out.headers, 'X-Content-Type-Options': 'nosniff' } })
})
