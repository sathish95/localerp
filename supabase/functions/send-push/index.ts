// Supabase Edge Function: send-push
//
// The delivery worker for STEP164's push_delivery_outbox. On each run it:
//   1. claim_push_batch(limit)  — atomically takes up to N pending rows
//      (FOR UPDATE SKIP LOCKED) along with each recipient's live tokens
//   2. POSTs them to Expo's push API in chunks of 100
//   3. mark_push_delivered(ids) — marks the batch processed
//   4. on an Expo "DeviceNotRegistered" ticket, revokes that token via a
//      direct update (service role bypasses RLS)
//
// It talks to the DB only through the two SECURITY DEFINER RPCs, which
// are granted to `service_role`, so this needs the service role key.
//
// Deploy:
//   supabase functions deploy send-push --no-verify-jwt
//
// Schedule (pick one):
//   • pg_cron + pg_net:
//       select cron.schedule('send-push', '* * * * *', $$
//         select net.http_post(
//           url := 'https://<ref>.supabase.co/functions/v1/send-push',
//           headers := jsonb_build_object('Authorization','Bearer <SERVICE_ROLE_KEY>')
//         )$$);
//   • or an external cron (GitHub Actions / cron-job.org) hitting the URL
//     every ~60s with the same Authorization header.
//   • also run prune_push_outbox() daily to drop delivered rows.
//
// NOT TESTED end to end — written to Expo's push API docs
// (https://docs.expo.dev/push-notifications/sending-notifications/).
// Verify against a real device before relying on it.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const EXPO_URL = 'https://exp.host/--/api/v2/push/send'
const BATCH = 100

type OutboxRow = {
  id: string
  recipient_id: string
  title: string | null
  body: string | null
  link: string | null
  tokens: { platform: string; token: string }[]
}

serve(async () => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: rows, error } = await admin.rpc('claim_push_batch', { p_limit: 500 })
  if (error) return json({ error: error.message }, 500)
  const batch = (rows ?? []) as OutboxRow[]
  if (batch.length === 0) return json({ claimed: 0 })

  // Flatten to one Expo message per (row, token).
  const messages: { to: string; title: string; body: string; data: Record<string, unknown>; _rowId: string }[] = []
  for (const r of batch) {
    for (const t of r.tokens ?? []) {
      if (!t.token?.startsWith('ExponentPushToken')) continue // only Expo tokens go to this endpoint
      messages.push({
        to: t.token,
        title: r.title ?? 'ThingsAlive NeoX',
        body: r.body ?? '',
        data: { link: r.link ?? '/', notificationId: r.id },
        _rowId: r.id,
      })
    }
  }

  const deadTokens = new Set<string>()

  for (let i = 0; i < messages.length; i += BATCH) {
    const chunk = messages.slice(i, i + BATCH)
    try {
      const res = await fetch(EXPO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk.map(({ _rowId, ...m }) => m)),
      })
      const out = await res.json()
      const tickets: { status: string; details?: { error?: string } }[] = out?.data ?? []
      tickets.forEach((ticket, idx) => {
        if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
          deadTokens.add(chunk[idx].to)
        }
      })
    } catch (e) {
      console.error('[send-push] Expo POST failed', e)
    }
  }

  // Every claimed row is marked processed regardless of per-token result —
  // the notification also exists in-app, and endless retries of a bad
  // token help nobody. attempts<5 in claim_push_batch already bounds it.
  await admin.rpc('mark_push_delivered', { p_ids: batch.map((r) => r.id), p_error: null })

  if (deadTokens.size > 0) {
    await admin
      .from('push_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .in('token', [...deadTokens])
  }

  return json({ claimed: batch.length, sent: messages.length, revoked: deadTokens.size })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
