import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const Ctx = createContext(null)

export function NotificationProvider({ children }) {
  const { profile } = useAuth()
  const [notifications, setNotifications] = useState([])
  const [loading,        setLoading]       = useState(false)
  const channelRef = useRef(null)

  const load = useCallback(async () => {
    if (!profile?.id) return
    setLoading(true)
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(60)
    setNotifications(data || [])
    setLoading(false)
  }, [profile?.id])

  useEffect(() => {
    if (!profile?.id) return
    load()

    // Real-time: new notification arrives
    const ch = supabase.channel(`notif-${profile.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
        filter: `recipient_id=eq.${profile.id}`,
      }, payload => {
        setNotifications(prev => [payload.new, ...prev])
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'notifications',
        filter: `recipient_id=eq.${profile.id}`,
      }, payload => {
        setNotifications(prev => prev.map(n => n.id === payload.new.id ? payload.new : n))
      })
      .subscribe()

    channelRef.current = ch
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current) }
  }, [profile?.id, load])

  const unreadCount = notifications.filter(n => !n.read_at).length

  async function markRead(id) {
    const ts = new Date().toISOString()
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read_at: ts } : n))
    await supabase.from('notifications').update({ read_at: ts }).eq('id', id)
  }

  async function markAllRead() {
    const ts = new Date().toISOString()
    const ids = notifications.filter(n => !n.read_at).map(n => n.id)
    if (!ids.length) return
    setNotifications(prev => prev.map(n => ({ ...n, read_at: n.read_at || ts })))
    await supabase.from('notifications').update({ read_at: ts }).in('id', ids)
  }

  async function clearAll() {
    const ids = notifications.map(n => n.id)
    if (!ids.length) return
    setNotifications([])
    await supabase.from('notifications').delete().in('id', ids)
  }

  return (
    <Ctx.Provider value={{ notifications, unreadCount, loading, markRead, markAllRead, clearAll, reload: load }}>
      {children}
    </Ctx.Provider>
  )
}

export const useNotifications = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('useNotifications outside NotificationProvider')
  return c
}
