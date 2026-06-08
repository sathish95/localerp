import { createClient } from '@supabase/supabase-js'

const URL  = import.meta.env.VITE_SUPABASE_URL || ''
const KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// Show a clear setup screen if env vars are missing (never crash)
export const MISSING_ENV = !URL || !KEY

export const supabase = MISSING_ENV
  ? { from: () => ({ select: () => ({ data: null, error: null }) }), auth: { getSession: async () => ({}), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }), signInWithPassword: async () => { throw new Error('Supabase not configured') }, signUp: async () => { throw new Error('Supabase not configured') }, signOut: async () => {} }, storage: { from: () => ({ upload: async () => ({}), getPublicUrl: () => ({ data: {} }) }) }, rpc: async () => ({}) }
  : createClient(URL, KEY, {
      auth: { autoRefreshToken:true, persistSession:true, detectSessionInUrl:true }
    })

export async function nextNum(type) {
  try {
    const { data, error } = await supabase.rpc('next_sequence', { seq_name: type })
    if (!error && data) return data
  } catch(_) {}
  const p = { expense:'EXP', travel:'TRV', pr:'PR', po:'PO', invoice:'INV', asset:'AST' }
  return (p[type]||'REQ') + '-' + Date.now().toString().slice(-6)
}

export const rupee = n => {
  n = Number(n)||0
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export const rupeeFull = n => '₹'+(Number(n)||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})

export const dateFmt = d => d ? new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—'

export const timeFmt = d => d ? new Date(d).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—'
