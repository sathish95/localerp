import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const Ctx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const fetching = useRef(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data:{ session } }) => {
      if (session?.user) { setUser(session.user); loadProfile(session.user) }
      else setLoading(false)
    })
    const { data:{ subscription } } = supabase.auth.onAuthStateChange((ev, session) => {
      if (!session || ev === 'SIGNED_OUT') { setUser(null); setProfile(null); setLoading(false); return }
      setUser(session.user); loadProfile(session.user)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function loadProfile(u) {
    if (fetching.current) return; fetching.current = true
    try {
      for (let i=0; i<7; i++) {
        const { data } = await supabase.from('profiles')
          .select('*, dept:departments(id,name,code)')
          .eq('id', u.id).maybeSingle()
        if (data) { setProfile(data); return }
        await new Promise(r => setTimeout(r, 700*(i+1)))
      }
      // fallback
      const fb = { id:u.id, email:u.email, full_name:u.user_metadata?.full_name||u.email?.split('@')[0]||'User', role:u.user_metadata?.role||'employee', is_active:true }
      await supabase.from('profiles').insert(fb).then(()=>{})
      setProfile(fb)
    } catch { setProfile({ id:u.id, email:u.email, full_name:u.user_metadata?.full_name||'User', role:u.user_metadata?.role||'employee' })
    } finally { fetching.current=false; setLoading(false) }
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      if (error.message?.includes('Invalid login')) throw new Error('Incorrect email or password.')
      if (error.message?.includes('not confirmed'))  throw new Error('Please confirm your email first.')
      throw error
    }
    return data
  }

  async function signUp(email, password, meta) {
    const { data, error } = await supabase.auth.signUp({ email, password, options:{ data: meta } })
    if (error) {
      if (error.status===500)                              throw new Error('Server error — run supabase-fix-signup.sql in SQL Editor.')
      if (error.message?.includes('already registered')) throw new Error('Email already registered. Please sign in.')
      throw error
    }
    return data
  }

  const signOut = () => supabase.auth.signOut()

  return (
    <Ctx.Provider value={{ user, profile, loading, signIn, signUp, signOut, refreshProfile:()=>user&&loadProfile(user) }}>
      {children}
    </Ctx.Provider>
  )
}

export const useAuth = () => { const c=useContext(Ctx); if(!c) throw new Error('useAuth outside AuthProvider'); return c }
