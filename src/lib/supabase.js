import { createClient } from '@supabase/supabase-js'

 const URL  = import.meta.env.VITE_SUPABASE_URL || 'https://zjyriyogntcyevlpitpe.supabase.co'
const KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_QHhTDrxnkPBklO8uGD9D4A_HWHkVWYk'

// Show a clear setup screen if env vars are missing (never crash)
export const MISSING_ENV = !URL || !KEY

export const supabase = MISSING_ENV
  ? { from: () => ({ select: () => ({ data: null, error: null }) }), auth: { getSession: async () => ({}), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }), signInWithPassword: async () => { throw new Error('Supabase not configured') }, signUp: async () => { throw new Error('Supabase not configured') }, signOut: async () => {} }, storage: { from: () => ({ upload: async () => ({}), getPublicUrl: () => ({ data: {} }) }) }, rpc: async () => ({}) }
  : createClient(URL, KEY, {
      auth: { autoRefreshToken:true, persistSession:true, detectSessionInUrl:true }
    })

// Admin-created users (UsersPage "Add User") — this app only has the anon
// key, never a service-role key, so there's no auth.admin.createUser()
// available. The only client-side way to create a real, loginable account
// is the same supabase.auth.signUp() the public signup page uses. Calling
// that on the MAIN `supabase` client would replace the admin's own active
// session with the newly created user's session (a well-known Supabase
// gotcha) — silently logging the admin out. This isolated client never
// persists or reads a session, so it can run signUp() without touching
// the admin's session at all.
export async function adminCreateUser(email, password, meta) {
  const isolated = MISSING_ENV ? null : createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
  if (!isolated) throw new Error('Supabase not configured')
  const { data, error } = await isolated.auth.signUp({ email, password, options: { data: meta } })
  if (error) {
    if (error.message?.includes('already registered')) throw new Error('A user with this email already exists.')
    throw error
  }
  return data
}

export async function nextNum(type) {
  try {
    const { data, error } = await supabase.rpc('next_sequence', { seq_name: type })
    if (!error && data) return data
  } catch(_) {}
  const p = { expense:'EXP', travel:'TRV', pr:'PR', po:'PO', grn:'GRN', invoice:'INV', asset:'AST', warranty:'WCL', proposal:'PROP', lead:'LEAD', opportunity:'OPP', delivery_note:'DN' }
  return (p[type]||'REQ') + '-' + Date.now().toString().slice(-6)
}

export const rupee = n => {
  n = Number(n)||0
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export const rupeeFull = n => '₹'+(Number(n)||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})

export const dateFmt = d => d ? new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—'

export const timeFmt = d => d ? new Date(d).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—'
