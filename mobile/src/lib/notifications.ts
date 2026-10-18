import { supabase } from '@/lib/supabase';

// Mobile mirror of src/context/NotificationContext.jsx's data access —
// same `notifications` table (STEP23), same shape, same query pattern.

export type AppNotification = {
  id: string;
  recipient_id: string;
  sender_id: string | null;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export async function listNotifications(userId: string, limit = 60): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('recipient_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AppNotification[];
}

export async function markNotificationRead(id: string) {
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
}

export async function markAllNotificationsRead(ids: string[]) {
  if (!ids.length) return;
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids);
}

// Mobile mirror of src/lib/notifications.js's sendNotifToMany — mobile
// couldn't previously WRITE notifications, only read/mark-read them.
// Needed so a wiki comment/mention authored on mobile notifies people the
// same way one authored on web does.
export async function sendNotifToMany(recipientIds: (string | null | undefined)[], opts: {
  type: string; title: string; body?: string; link?: string; metadata?: Record<string, unknown>; senderId?: string;
}) {
  const ids = [...new Set(recipientIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return;
  await supabase.from('notifications').insert(
    ids.map(id => ({
      recipient_id: id, sender_id: opts.senderId ?? null, type: opts.type, title: opts.title,
      body: opts.body ?? null, link: opts.link ?? null, metadata: opts.metadata ?? {},
    })),
  );
}
