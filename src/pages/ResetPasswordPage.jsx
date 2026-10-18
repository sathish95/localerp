import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAppName } from '../context/BrandingContext'
import { Lock, Loader2, AlertCircle, CheckCircle2, Zap } from 'lucide-react'

// Landing page for Supabase Auth's password-reset email
// (requestPasswordReset() in src/lib/email.js). The link carries a one-time
// recovery token that supabase-js turns into a short-lived session on load
// (detectSessionInUrl); this page only lets that session set a new password.
// Routed before the auth branch in App.jsx so it renders whatever the
// session state is.

const input = { width: '100%', padding: '11px 14px 11px 40px', borderRadius: 10, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.06)', color: '#fff', fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }

export default function ResetPasswordPage() {
  const appName = useAppName()
  const navigate = useNavigate()
  const [ready, setReady] = useState(null) // null = checking, true = can reset, false = no/expired link
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (session && event === 'SIGNED_IN')) setReady(true)
    })
    // The token may already have been consumed before this effect ran.
    supabase.auth.getSession().then(({ data }) => { if (data?.session) setReady(true) })
    const t = setTimeout(() => setReady(r => r ?? false), 4000)
    return () => { sub?.subscription?.unsubscribe(); clearTimeout(t) }
  }, [])

  async function submit(e) {
    e.preventDefault(); setErr('')
    if (pw.length < 8) return setErr('Use at least 8 characters')
    if (pw !== pw2) return setErr("The two passwords don't match")
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return setErr(error.message)
    setDone(true)
    setTimeout(() => navigate('/'), 1500)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#060612', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
      <div style={{ width: '100%', maxWidth: 400, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 20, padding: '36px 32px', color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Zap size={16} color="#fff" fill="#fff" /></div>
          <span style={{ fontWeight: 800, fontSize: 16 }}>{appName}</span>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Set a new password</div>

        {ready === null && <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,.5)', fontSize: 13, marginTop: 16 }}><Loader2 size={14} className="spin" /> Checking your reset link…</div>}

        {ready === false && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.3)', color: '#fca5a5', fontSize: 13 }}>
              <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} /> This reset link is invalid or has expired. Request a new one from the sign-in page.
            </div>
            <Link to="/auth?mode=forgot" style={{ display: 'inline-block', marginTop: 16, color: '#a5b4fc', fontSize: 13, fontWeight: 700 }}>Request a new link</Link>
          </div>
        )}

        {ready && !done && (
          <form onSubmit={submit} style={{ marginTop: 16 }}>
            {err && <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.3)', color: '#fca5a5', fontSize: 13, marginBottom: 14 }}><AlertCircle size={15} style={{ flexShrink: 0 }} /> {err}</div>}
            {[['New password', pw, setPw], ['Confirm new password', pw2, setPw2]].map(([label, v, set]) => (
              <div key={label} style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.6)', marginBottom: 6 }}>{label}</label>
                <div style={{ position: 'relative' }}>
                  <Lock size={16} style={{ position: 'absolute', left: 14, top: 13, color: 'rgba(255,255,255,.35)' }} />
                  <input type="password" value={v} onChange={e => set(e.target.value)} required minLength={8} autoComplete="new-password" style={input} />
                </div>
              </div>
            ))}
            <button type="submit" disabled={busy} style={{ width: '100%', padding: 13, borderRadius: 12, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 800, fontSize: 15, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? .7 : 1, marginTop: 6 }}>
              {busy ? 'Saving…' : 'Save new password'}
            </button>
          </form>
        )}

        {done && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, color: '#86efac', fontSize: 14 }}><CheckCircle2 size={16} /> Password updated. Signing you in…</div>}
      </div>
    </div>
  )
}
