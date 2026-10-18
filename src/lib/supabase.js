import { createClient } from '@supabase/supabase-js'

 const URL  = import.meta.env.VITE_SUPABASE_URL || 'https://zjyriyogntcyevlpitpe.supabase.co'
const KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_QHhTDrxnkPBklO8uGD9D4A_HWHkVWYk'

// Show a clear setup screen if env vars are missing (never crash)
export const MISSING_ENV = !URL || !KEY

/* ── Fallback route for networks that can't reach *.supabase.co ──
   Some ISPs / office networks block or drop supabase.co (ERR_NAME_NOT_RESOLVED,
   ERR_CONNECTION_CLOSED). Every call goes direct first; on a network failure it
   is retried through this site's own /sb proxy (netlify.toml, vite.config.js)
   and the browser stays on the proxy for 6 hours before trying direct again.
   Realtime (websockets) always goes direct — if that is blocked, pages still
   work but live updates need a refresh. VITE_SUPABASE_PROXY=off disables it. */
const BASE = URL.replace(/\/$/, '')
const PROXY_ON = typeof window !== 'undefined' && import.meta.env.VITE_SUPABASE_PROXY !== 'off'
const PROXY_BASE = PROXY_ON ? `${window.location.origin}/sb` : null
const ROUTE_KEY = 'neox.supabaseRoute'
const ROUTE_TTL = 6 * 3600 * 1000
function proxyActive() {
  if (!PROXY_BASE) return false
  try { const r = JSON.parse(localStorage.getItem(ROUTE_KEY) || 'null'); return !!r && Date.now() - r.at < ROUTE_TTL } catch { return false }
}
function useProxyRoute() { try { localStorage.setItem(ROUTE_KEY, JSON.stringify({ at: Date.now() })) } catch { /* private mode */ } }
const viaProxy = u => (PROXY_BASE && typeof u === 'string' && u.startsWith(BASE) ? PROXY_BASE + u.slice(BASE.length) : u)
// A Supabase file / storage URL, rewritten when this browser is on the proxy.
export const routeUrl = u => (proxyActive() ? viaProxy(u) : u)

async function routedFetch(input, init) {
  const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
  if (!PROXY_BASE || !url.startsWith(BASE)) return fetch(input, init)
  const proxied = (req) => (req instanceof Request ? new Request(viaProxy(url), req) : viaProxy(url))
  if (proxyActive()) return fetch(proxied(input), init)
  const spare = input instanceof Request ? input.clone() : input
  try {
    return await fetch(input, init)
  } catch (e) {
    if (init?.signal?.aborted || e?.name === 'AbortError') throw e
    const res = await fetch(proxied(spare), init)      // network-level failure → try the proxy
    useProxyRoute()
    return res
  }
}

function withRoutedStorage(client) {
  const from = client.storage.from.bind(client.storage)
  client.storage.from = bucket => {
    const api = from(bucket)
    const pub = api.getPublicUrl.bind(api), one = api.createSignedUrl.bind(api), many = api.createSignedUrls.bind(api)
    api.getPublicUrl = (...a) => { const r = pub(...a); if (r?.data?.publicUrl) r.data.publicUrl = routeUrl(r.data.publicUrl); return r }
    api.createSignedUrl = async (...a) => { const r = await one(...a); if (r?.data?.signedUrl) r.data.signedUrl = routeUrl(r.data.signedUrl); return r }
    api.createSignedUrls = async (...a) => { const r = await many(...a); (r?.data || []).forEach(x => { if (x?.signedUrl) x.signedUrl = routeUrl(x.signedUrl) }); return r }
    return api
  }
  return client
}

export const supabase = MISSING_ENV
  ? { from: () => ({ select: () => ({ data: null, error: null }) }), auth: { getSession: async () => ({}), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }), signInWithPassword: async () => { throw new Error('Supabase not configured') }, signUp: async () => { throw new Error('Supabase not configured') }, signOut: async () => {} }, storage: { from: () => ({ upload: async () => ({}), getPublicUrl: () => ({ data: {} }) }) }, rpc: async () => ({}) }
  : withRoutedStorage(createClient(URL, KEY, {
      auth: { autoRefreshToken:true, persistSession:true, detectSessionInUrl:true },
      global: { fetch: routedFetch },
    }))

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
  const isolated = MISSING_ENV ? null : createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }, global: { fetch: routedFetch } })
  if (!isolated) throw new Error('Supabase not configured')
  const { data, error } = await isolated.auth.signUp({ email, password, options: { data: meta } })
  if (error) {
    if (error.message?.includes('already registered')) throw new Error('A user with this email already exists.')
    throw error
  }
  return data
}

// Admin/HR password reset (User Management "Edit" -> Reset Password) — the
// client never holds a service-role key, so this goes through the
// admin_reset_user_password SECURITY DEFINER RPC (STEP190) instead of any
// supabase.auth.admin API, which isn't reachable from the browser.
export async function adminResetPassword(userId, newPassword) {
  const { error } = await supabase.rpc('admin_reset_user_password', { p_user_id: userId, p_new_password: newPassword })
  if (error) throw error
}

// Finalizes a profile right after adminCreateUser()'s signUp() call
// (STEP196) — that signUp() passes no org_mode metadata, so
// handle_new_user()'s trigger falls back to assigning the new profile to
// the 'default-org' organization, not the admin's real one. A plain
// `.update()` from the admin's own session can't fix that afterwards —
// RLS blocks it, since the row's organization_id doesn't match the
// admin's yet, silently affecting 0 rows. This SECURITY DEFINER RPC
// reassigns it to the caller's org (only when the target is currently in
// default-org or has no org at all) and applies the rest of the profile
// fields in the same call.
export async function adminFinalizeNewProfile(userId, fields) {
  const { error } = await supabase.rpc('admin_finalize_new_profile', {
    p_user_id: userId,
    p_designation: fields.designation ?? null,
    p_phone: fields.phone ?? null,
    p_department_id: fields.department_id ?? null,
    p_is_active: fields.is_active ?? null,
    p_reporting_manager_id: fields.reporting_manager_id ?? null,
    p_employment_type: fields.employment_type ?? null,
    p_default_weekly_capacity_hours: fields.default_weekly_capacity_hours ?? null,
    p_date_joined: fields.date_joined ?? null,
  })
  if (error) throw error
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
