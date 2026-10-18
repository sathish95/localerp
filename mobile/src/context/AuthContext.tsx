import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import { unregisterPush } from '@/lib/push';

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active?: boolean;
  is_super_admin?: boolean;
  date_joined?: string | null;
  walkthrough_seen_at?: string | null;
  tour_seen_at?: string | null;
  dept?: { id: string; name: string; code: string } | null;
  org?: { id: string; name: string; slug: string; is_active: boolean; deleted_at: string | null } | null;
};

type AuthCtx = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => void;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const fetching = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      if (session?.user) {
        setUser(session.user);
        loadProfile(session.user);
      } else setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((ev, session) => {
      if (!session || ev === 'SIGNED_OUT') {
        setUser(null); setProfile(null); setLoading(false); return;
      }
      setUser(session.user); loadProfile(session.user);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(u: User) {
    if (fetching.current) return;
    fetching.current = true;
    try {
      for (let i = 0; i < 7; i++) {
        // Same FK disambiguation the web app needs (profiles<->organizations
        // has two FK paths) — an unqualified embed 300s silently.
        const { data } = await supabase
          .from('profiles')
          .select('*, dept:departments(id,name,code), org:organizations!profiles_organization_id_fkey(id,name,slug,is_active,deleted_at)')
          .eq('id', u.id)
          .maybeSingle();
        if (data) { setProfile(data as Profile); return; }
        await new Promise((r) => setTimeout(r, 700 * (i + 1)));
      }
      setProfile({ id: u.id, email: u.email ?? '', full_name: (u.user_metadata?.full_name as string) || u.email?.split('@')[0] || 'User', role: (u.user_metadata?.role as string) || 'employee', is_active: true });
    } catch {
      setProfile({ id: u.id, email: u.email ?? '', full_name: 'User', role: 'employee', is_active: true });
    } finally {
      fetching.current = false;
      setLoading(false);
    }
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message?.includes('Invalid login')) throw new Error('Incorrect email or password.');
      if (error.message?.includes('not confirmed')) throw new Error('Please confirm your email first.');
      throw error;
    }
  }

  const signOut = async () => {
    await unregisterPush().catch(() => {});
    await supabase.auth.signOut();
  };

  return (
    <Ctx.Provider value={{ user, profile, loading, signIn, signOut, refreshProfile: () => user && loadProfile(user) }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
