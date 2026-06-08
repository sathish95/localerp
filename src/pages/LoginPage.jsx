import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'

const ROLES = [
  { id: 'admin',    label: 'Admin',    emoji: '👑', color: '#7c3aed' },
  { id: 'ceo',      label: 'CEO',      emoji: '🏛️', color: '#dc2626' },
  { id: 'manager',  label: 'Manager',  emoji: '📋', color: '#0284c7' },
  { id: 'finance',  label: 'Finance',  emoji: '💰', color: '#16a34a' },
  { id: 'hr',       label: 'HR',       emoji: '🧑‍💼', color: '#0891b2' },
  { id: 'employee', label: 'Employee', emoji: '👤', color: '#d97706' },
]

export default function LoginPage() {
  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('employee')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      if (mode === 'login') {
        await signIn(email, password)
      } else {
        await signUp(email, password, { full_name: name, role })
      }
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const selectedRole = ROLES.find(r => r.id === role)

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', background: '#f8fafc',
      fontFamily: "'Plus Jakarta Sans', sans-serif"
    }}>
      {/* Left Panel */}
      <div style={{
        flex: 1, background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #312e81 100%)',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
        padding: 60, position: 'relative', overflow: 'hidden'
      }}>
        {/* Decorative circles */}
        {[[400, -100, -100, 'rgba(99,102,241,.15)'], [300, 'auto', -80, 'rgba(139,92,246,.1)'], [200, 100, 300, 'rgba(236,72,153,.08)']].map(([s, t, l, bg], i) => (
          <div key={i} style={{ position: 'absolute', width: s, height: s, borderRadius: '50%', background: bg, top: t !== 'auto' ? t : 'auto', bottom: l < 0 ? undefined : l, left: l < 0 ? l : undefined, right: t === 'auto' ? 0 : undefined }} />
        ))}
        <div style={{ position: 'relative', textAlign: 'center', color: 'white' }}>
          <div style={{ fontSize: 56, marginBottom: 20 }}>🏢</div>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 42, fontWeight: 700, marginBottom: 8 }}>ThingsAlive NeoX</div>
          <div style={{ fontSize: 16, opacity: .7, maxWidth: 300, lineHeight: 1.6 }}>Enterprise Finance & Procurement Management Platform</div>
          <div style={{ marginTop: 48, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {['Multi-role approval workflows', 'Real-time budget tracking', 'Vendor & procurement management', 'Asset lifecycle management'].map(f => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, opacity: .8 }}>
                <span style={{ background: 'rgba(99,102,241,.4)', borderRadius: 6, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>✓</span>
                {f}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Panel */}
      <div style={{ width: 480, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, fontWeight: 700, marginBottom: 4 }}>
            {mode === 'login' ? 'Welcome back' : 'Create account'}
          </div>
          <div style={{ fontSize: 14, color: 'var(--ink-muted)', marginBottom: 28 }}>
            {mode === 'login' ? 'Sign in to continue to ThingsAlive NeoX' : 'Set up your ThingsAlive NeoX account'}
          </div>

          {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>}

          <form onSubmit={handleSubmit}>
            {mode === 'signup' && (
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" required />
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} />
            </div>

            {mode === 'signup' && (
              <div className="form-group">
                <label className="form-label">Role</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 4 }}>
                  {ROLES.map(r => (
                    <div
                      key={r.id}
                      onClick={() => setRole(r.id)}
                      style={{
                        padding: '10px 6px', borderRadius: 10, textAlign: 'center', cursor: 'pointer',
                        border: `2px solid ${role === r.id ? r.color : 'var(--border)'}`,
                        background: role === r.id ? `${r.color}12` : 'white',
                        transition: 'all .15s'
                      }}
                    >
                      <div style={{ fontSize: 20, marginBottom: 4 }}>{r.emoji}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: role === r.id ? r.color : 'var(--ink-muted)' }}>{r.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{ width: '100%', justifyContent: 'center', padding: '11px 0', fontSize: 14, marginTop: 8 }}
            >
              {loading ? '⏳ Please wait...' : mode === 'login' ? 'Sign In →' : 'Create Account →'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--ink-muted)' }}>
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <span style={{ color: 'var(--c1)', cursor: 'pointer', fontWeight: 600 }} onClick={() => setMode(m => m === 'login' ? 'signup' : 'login')}>
              {mode === 'login' ? 'Create one' : 'Sign in'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
