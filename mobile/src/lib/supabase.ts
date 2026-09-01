import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export function dateFmt(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function initials(name?: string | null) {
  return (name || 'U').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export function rupee(n?: number | null) {
  const v = Number(n) || 0;
  return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

const SEQUENCE_PREFIX: Record<string, string> = { expense: 'EXP', travel: 'TRV' };

export async function nextNum(type: string): Promise<string> {
  try {
    const { data, error } = await supabase.rpc('next_sequence', { seq_name: type });
    if (!error && data) return data;
  } catch {
    // fall through to the client-side fallback below
  }
  return (SEQUENCE_PREFIX[type] ?? 'REQ') + '-' + Date.now().toString().slice(-6);
}
