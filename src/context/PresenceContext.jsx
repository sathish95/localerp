import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const Ctx = createContext({ onlineIds: new Set(), isOnline: () => false })

// Site-wide "who's online right now" — same Supabase Realtime Presence
// pattern ChatPage.jsx already used, just lifted out of that one page so
// anywhere in the app (User Management, dashboards, etc.) can show an
// online/offline dot, not only the Chat page. Deliberately independent
// of ChatPage's own 'presence-chat' channel — leaving that one alone
// rather than risk touching a working feature; this tracks the same
// kind of state on a separate 'presence-site' channel.
export function PresenceProvider({ children }) {
  const { user, profile } = useAuth()
  const [onlineIds, setOnlineIds] = useState(new Set())
  const channelRef = useRef(null)

  useEffect(() => {
    if (!user || !profile?.id) {
      if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null }
      setOnlineIds(new Set())
      return
    }
    const ch = supabase.channel('presence-site', { config: { presence: { key: profile.id } } })
      .on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState()
        setOnlineIds(new Set(Object.values(state).flat().map(p => p.user_id)))
      })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') await ch.track({ user_id: profile.id, online_at: new Date().toISOString() })
      })
    channelRef.current = ch
    return () => { supabase.removeChannel(ch); channelRef.current = null }
  }, [user, profile?.id])

  return (
    <Ctx.Provider value={{ onlineIds, isOnline: id => onlineIds.has(id) }}>
      {children}
    </Ctx.Provider>
  )
}

export const usePresence = () => useContext(Ctx)
