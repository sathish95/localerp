import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  listNotifications, markAllNotificationsRead, markNotificationRead, type AppNotification,
} from '@/lib/notifications';

type NotificationsCtx = {
  notifications: AppNotification[];
  unreadCount: number;
  loading: boolean;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  reload: () => Promise<void>;
};

const Ctx = createContext<NotificationsCtx | null>(null);

// Realtime mirror of src/context/NotificationContext.jsx — same table,
// same subscription shape, so a row inserted from any platform (web
// action, mobile check-in, server trigger) shows up here live.
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      setNotifications(await listNotifications(profile.id));
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) {
      setNotifications([]);
      return;
    }
    load();

    const ch = supabase
      .channel(`notif-${profile.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${profile.id}`,
      }, (payload) => {
        setNotifications((prev) => [payload.new as AppNotification, ...prev]);
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${profile.id}`,
      }, (payload) => {
        const updated = payload.new as AppNotification;
        setNotifications((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      })
      .subscribe();

    channelRef.current = ch;
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [profile?.id, load]);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  async function markRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n)));
    await markNotificationRead(id);
  }

  async function markAllRead() {
    const ids = notifications.filter((n) => !n.read_at).map((n) => n.id);
    if (!ids.length) return;
    const ts = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? ts })));
    await markAllNotificationsRead(ids);
  }

  return (
    <Ctx.Provider value={{ notifications, unreadCount, loading, markRead, markAllRead, reload: load }}>
      {children}
    </Ctx.Provider>
  );
}

export function useNotifications() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useNotifications outside NotificationsProvider');
  return c;
}
