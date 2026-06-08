import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'

const ROLES = [
  { id:'admin',    label:'Admin',    emoji:'👑', color:'#7c3aed' },
  { id:'ceo',      label:'CEO',      emoji:'🏛️', color:'#dc2626' },
  { id:'manager',  label:'Manager',  emoji:'📋', color:'#0284c7' },
  { id:'finance',  label:'Finance',  emoji:'💰', color:'#16a34a' },
  { id:'hr',       label:'HR',       emoji:'🧑‍💼', color:'#0891b2' },
  { id:'employee', label:'Employee', emoji:'👤', color:'#d97706' },
]

export default function AuthPage() {
  const { signIn, signUp, user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [mode, setMode] = useState(params.get('mode')==='signup' ? 'signup' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('employee')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if(user) navigate('/') }, [user])

  async function handleSubmit(e) {
    e.preventDefault(); setLoading(true); setError('')
    try {
      if (mode==='login') await signIn(email, password)
      else await signUp(email, password, { full_name: name, role })
      navigate('/')
    } catch(err) { setError(err.message) }
    finally { setLoading(false) }
  }

  const sel = ROLES.find(r=>r.id===role)

  return (
    <div style={{ minHeight:'100vh', background:'#060612', display:'flex', fontFamily:"'Plus Jakarta Sans',sans-serif", position:'relative', overflow:'hidden' }}>
      <style>{`@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}`}</style>

      {/* Bg */}
      <div style={{ position:'absolute', width:500, height:500, borderRadius:'50%', background:'radial-gradient(circle,rgba(99,102,241,.2) 0%,transparent 70%)', top:'-10%', left:'-10%', filter:'blur(40px)' }}/>
      <div style={{ position:'absolute', width:400, height:400, borderRadius:'50%', background:'radial-gradient(circle,rgba(139,92,246,.15) 0%,transparent 70%)', bottom:'-10%', right:'-5%', filter:'blur(30px)' }}/>
      <div style={{ position:'absolute', inset:0, backgroundImage:'radial-gradient(rgba(255,255,255,.03) 1px, transparent 1px)', backgroundSize:'28px 28px' }}/>

      {/* Left: brand */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'60px 40px', display:'flex' }} className="hide-mobile">
        <div style={{ maxWidth:420 }}>
          <Link to="/" style={{ display:'flex', alignItems:'center', gap:10, textDecoration:'none', marginBottom:48 }}>
            <div style={{ width:42, height:42, borderRadius:12, background:'linear-gradient(135deg,#6366f1,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22 }}>⚡</div>
            <div style={{ fontFamily:"'Playfair Display',serif", fontSize:24, fontWeight:800, color:'#fff' }}>ThingsAlive <span style={{ color:'#818cf8' }}>NeoX</span></div>
          </Link>
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:40, fontWeight:800, color:'#fff', lineHeight:1.15, marginBottom:20 }}>
            Manage Everything.<br/><span style={{ background:'linear-gradient(135deg,#818cf8,#a78bfa)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>From One Place.</span>
          </div>
          <div style={{ fontSize:15, color:'rgba(255,255,255,.5)', lineHeight:1.7, marginBottom:40 }}>
            A unified platform for expenses, approvals, projects, HR, and business operations.
          </div>
          {['✅ Multi-step approval workflows','📁 Project budget tracking','👥 HR & resource management','📊 Role-specific dashboards'].map(f=>(
            <div key={f} style={{ display:'flex', alignItems:'center', gap:10, fontSize:14, color:'rgba(255,255,255,.6)', marginBottom:12 }}>
              <div style={{ width:24, height:24, borderRadius:6, background:'rgba(99,102,241,.25)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, flexShrink:0 }}>✓</div>
              {f}
            </div>
          ))}
        </div>
      </div>

      {/* Right: form */}
      <div style={{ width:'min(480px,100%)', display:'flex', alignItems:'center', justifyContent:'center', padding:'40px 32px', position:'relative' }}>
        <div style={{ width:'100%', maxWidth:400, background:'rgba(255,255,255,.04)', borderRadius:24, border:'1px solid rgba(255,255,255,.1)', padding:'40px 36px', backdropFilter:'blur(20px)' }}>

          {/* Logo for mobile */}
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:28 }}>
            <div style={{ width:34, height:34, borderRadius:10, background:'linear-gradient(135deg,#6366f1,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:17 }}>⚡</div>
            <span style={{ fontFamily:"'Playfair Display',serif", fontSize:17, fontWeight:800, color:'#fff' }}>ThingsAlive <span style={{ color:'#818cf8' }}>NeoX</span></span>
          </div>

          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:26, fontWeight:800, color:'#fff', marginBottom:6 }}>
            {mode==='login' ? 'Welcome back' : 'Create account'}
          </div>
          <div style={{ fontSize:13, color:'rgba(255,255,255,.4)', marginBottom:28 }}>
            {mode==='login' ? 'Sign in to your workspace' : 'Join ThingsAlive NeoX'}
          </div>

          {error && <div style={{ padding:'10px 14px', borderRadius:10, background:'rgba(239,68,68,.15)', border:'1px solid rgba(239,68,68,.3)', color:'#fca5a5', fontSize:13, marginBottom:16 }}>{error}</div>}

          <form onSubmit={handleSubmit}>
            {mode==='signup' && (
              <div style={{ marginBottom:14 }}>
                <label style={{ display:'block', fontSize:12, fontWeight:700, color:'rgba(255,255,255,.6)', marginBottom:6, textTransform:'uppercase', letterSpacing:'.05em' }}>Full Name</label>
                <input value={name} onChange={e=>setName(e.target.value)} placeholder="Your full name" required
                  style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:'1px solid rgba(255,255,255,.12)', background:'rgba(255,255,255,.06)', color:'#fff', fontSize:14, fontFamily:'inherit', outline:'none', boxSizing:'border-box' }}
                  onFocus={e=>e.target.style.borderColor='#6366f1'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,.12)'}/>
              </div>
            )}

            <div style={{ marginBottom:14 }}>
              <label style={{ display:'block', fontSize:12, fontWeight:700, color:'rgba(255,255,255,.6)', marginBottom:6, textTransform:'uppercase', letterSpacing:'.05em' }}>Email</label>
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com" required
                style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:'1px solid rgba(255,255,255,.12)', background:'rgba(255,255,255,.06)', color:'#fff', fontSize:14, fontFamily:'inherit', outline:'none', boxSizing:'border-box' }}
                onFocus={e=>e.target.style.borderColor='#6366f1'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,.12)'}/>
            </div>

            <div style={{ marginBottom:20 }}>
              <label style={{ display:'block', fontSize:12, fontWeight:700, color:'rgba(255,255,255,.6)', marginBottom:6, textTransform:'uppercase', letterSpacing:'.05em' }}>Password</label>
              <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required minLength={6}
                style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:'1px solid rgba(255,255,255,.12)', background:'rgba(255,255,255,.06)', color:'#fff', fontSize:14, fontFamily:'inherit', outline:'none', boxSizing:'border-box' }}
                onFocus={e=>e.target.style.borderColor='#6366f1'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,.12)'}/>
            </div>

            {mode==='signup' && (
              <div style={{ marginBottom:24 }}>
                <label style={{ display:'block', fontSize:12, fontWeight:700, color:'rgba(255,255,255,.6)', marginBottom:10, textTransform:'uppercase', letterSpacing:'.05em' }}>Your Role</label>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
                  {ROLES.map(r=>(
                    <div key={r.id} onClick={()=>setRole(r.id)}
                      style={{ padding:'10px 6px', borderRadius:12, textAlign:'center', cursor:'pointer', border:`1.5px solid ${role===r.id?r.color:'rgba(255,255,255,.1)'}`, background:role===r.id?`${r.color}18`:'rgba(255,255,255,.03)', transition:'all .15s' }}>
                      <div style={{ fontSize:20, marginBottom:4 }}>{r.emoji}</div>
                      <div style={{ fontSize:10, fontWeight:700, color:role===r.id?r.color:'rgba(255,255,255,.45)', textTransform:'uppercase', letterSpacing:'.04em' }}>{r.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button type="submit" disabled={loading}
              style={{ width:'100%', padding:'13px', borderRadius:12, border:'none', background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff', fontWeight:800, fontSize:15, cursor:'pointer', fontFamily:'inherit', boxShadow:'0 12px 30px rgba(99,102,241,.35)', opacity:loading?.7:1 }}>
              {loading ? '⏳ Please wait...' : mode==='login' ? 'Sign In →' : 'Create Account →'}
            </button>
          </form>

          <div style={{ textAlign:'center', marginTop:20, fontSize:13, color:'rgba(255,255,255,.4)' }}>
            {mode==='login' ? "Don't have an account? " : 'Already have an account? '}
            <span style={{ color:'#818cf8', cursor:'pointer', fontWeight:700 }} onClick={()=>{setMode(m=>m==='login'?'signup':'login');setError('')}}>
              {mode==='login' ? 'Sign up' : 'Sign in'}
            </span>
          </div>

          <div style={{ textAlign:'center', marginTop:16 }}>
            <Link to="/" style={{ fontSize:12, color:'rgba(255,255,255,.3)', textDecoration:'none', fontWeight:500 }}>← Back to home</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
