import { supabase } from './supabase'

/**
 * Send a notification to a single user.
 */
export async function sendNotif(recipientId, { type, title, body, link, metadata, senderId }) {
  if (!recipientId) return
  await supabase.from('notifications').insert({
    recipient_id: recipientId,
    sender_id:    senderId   || null,
    type, title,
    body:         body       || null,
    link:         link       || null,
    metadata:     metadata   || {},
  })
}

/**
 * Send the same notification to multiple users (deduplicates empty ids).
 */
export async function sendNotifToMany(recipientIds, opts) {
  const ids = [...new Set((recipientIds || []).filter(Boolean))]
  if (ids.length === 0) return
  await supabase.from('notifications').insert(
    ids.map(id => ({
      recipient_id: id,
      sender_id:    opts.senderId  || null,
      type:         opts.type,
      title:        opts.title,
      body:         opts.body      || null,
      link:         opts.link      || null,
      metadata:     opts.metadata  || {},
    }))
  )
}

/**
 * Notify all users with manager / hr / department_head roles.
 * Used for check-in alerts, timesheet submissions, etc.
 */
export async function notifyManagers(opts) {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .in('role', ['manager', 'department_head', 'hr', 'admin', 'ceo'])
  const ids = (data || []).map(u => u.id).filter(id => id !== opts.senderId)
  await sendNotifToMany(ids, opts)
}
