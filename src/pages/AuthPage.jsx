import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { previewInviteCode } from '../lib/orgInvites'

export default function AuthPage() {
  const { signIn, signUp, user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [mode, setMode] = useState(params.get('mode')==='signup' ? 'signup' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Which org a new signup lands in (STEP105) — 'create' spins up a brand
  // new organization with this user as its admin; 'join' consumes an
  // invite code an existing org's admin generated from Settings ->
  // Organization. Defaults to 'create' since that's the more common first
  // touch (nobody has an invite code until an org already exists).
  const [orgMode, setOrgMode] = useState('create')
  const [orgName, setOrgName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [invitePreview, setInvitePreview] = useState(null) // { valid, org_name, role, reason }
  const [checkingInvite, setCheckingInvite] = useState(false)

  useEffect(() => { if(user) navigate('/') }, [user])

  useEffect(() => {
    setInvitePreview(null)
    if (mode !== 'signup' || orgMode !== 'join' || inviteCode.trim().length < 4) return
    const t = setTimeout(async () => {
      setCheckingInvite(true)
      try { setInvitePreview(await previewInviteCode(inviteCode.trim())) }
      catch { setInvitePreview({ valid:false, reason:'Could not check this code' }) }
      finally { setCheckingInvite(false) }
    }, 500)
    return () => clearTimeout(t)
  }, [inviteCode, orgMode, mode])

  async function handleSubmit(e) {
    e.preventDefault(); setLoading(true); setError('')
    try {
      if (mode==='login') { await signIn(email, password); navigate('/'); return }

      if (orgMode==='create' && !orgName.trim()) throw new Error('Organization name is required')
      if (orgMode==='join' && !invitePreview?.valid) throw new Error('Enter a valid invite code first')

      const meta = { full_name: name, role: 'employee', org_mode: orgMode }
      if (orgMode==='create') meta.org_name = orgName.trim()
      if (orgMode==='join') meta.invite_code = inviteCode.trim()

      await signUp(email, password, meta)
      navigate('/')
    } catch(err) { setError(err.message) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ minHeight:'100vh', background:'#060612', display:'flex', fontFamily:"'Plus Jakarta Sans',sans-serif", position:'relative', overflow:'hidden' }}>
      <style>{`@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}`}</style>

      {/* Bg */}
      <div style={{ position:'absolute', width:500, height:500, borderRadius:'50%', background:'radial-gradient(circle,rgba(99,102,241,.2) 0%,transparent 70%)', top:'-10%', left:'-10%', filter:'blur(40px)' }}/>
      <div style={{ position:'absolute', width:400, height:400, borderRadius:'50%', background:'radial-gradient(circle,rgba(139,92,246,.15) 0%,transparent 70%)', bottom:'-10%', right:'-5%', filter:'blur(30px)' }}/>
      <div style={{ position:'absolute', inset:0, backgroundImage:'radial-gradient(rgba(255,255,255,.03) 1px, transparent 1px)', backgroundSize:'28px 28px' }}/>

      {/* Left: brand */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'60px 40px' }} className="hide-mobile">
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

            {mode==='signup' && (
              <div style={{ marginBottom:14 }}>
                <label style={{ display:'block', fontSize:12, fontWeight:700, color:'rgba(255,255,255,.6)', marginBottom:6, textTransform:'uppercase', letterSpacing:'.05em' }}>Workspace</label>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10 }}>
                  {[['create','New organization'],['join','Join with invite']].map(([id,label])=>(
                    <div key={id} onClick={()=>setOrgMode(id)}
                      style={{ padding:'10px 8px', borderRadius:10, textAlign:'center', cursor:'pointer', fontSize:12.5, fontWeight:700,
                        border:`1.5px solid ${orgMode===id?'#6366f1':'rgba(255,255,255,.1)'}`,
                        background:orgMode===id?'rgba(99,102,241,.15)':'rgba(255,255,255,.03)',
                        color:orgMode===id?'#a5b4fc':'rgba(255,255,255,.5)' }}>
                      {label}
                    </div>
                  ))}
                </div>

                {orgMode==='create' ? (
                  <input value={orgName} onChange={e=>setOrgName(e.target.value)} placeholder="Your company / team name" required
                    style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:'1px solid rgba(255,255,255,.12)', background:'rgba(255,255,255,.06)', color:'#fff', fontSize:14, fontFamily:'inherit', outline:'none', boxSizing:'border-box' }}
                    onFocus={e=>e.target.style.borderColor='#6366f1'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,.12)'}/>
                ) : (
                  <>
                    <input value={inviteCode} onChange={e=>setInviteCode(e.target.value.toUpperCase())} placeholder="Invite code (e.g. AB12CD34)" required
                      style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:'1px solid rgba(255,255,255,.12)', background:'rgba(255,255,255,.06)', color:'#fff', fontSize:14, fontFamily:'inherit', outline:'none', boxSizing:'border-box', letterSpacing:'.05em' }}
                      onFocus={e=>e.target.style.borderColor='#6366f1'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,.12)'}/>
                    {checkingInvite && <div style={{ fontSize:12, color:'rgba(255,255,255,.4)', marginTop:6 }}>Checking…</div>}
                    {!checkingInvite && invitePreview?.valid && (
                      <div style={{ fontSize:12.5, color:'#86efac', marginTop:6 }}>✓ Joining <strong>{invitePreview.org_name}</strong> as {invitePreview.role}</div>
                    )}
                    {!checkingInvite && invitePreview && !invitePreview.valid && (
                      <div style={{ fontSize:12.5, color:'#fca5a5', marginTop:6 }}>{invitePreview.reason}</div>
                    )}
                  </>
                )}
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

            {/* Role is decided server-side for both signup paths — 'create'
                always makes you the new org's admin, 'join' takes the role
                the invite was issued with — so no picker is shown here. */}
            {mode==='signup' && orgMode==='create' && (
              <div style={{ marginBottom:20, padding:'10px 14px', borderRadius:10, background:'rgba(124,58,237,.12)', border:'1px solid rgba(124,58,237,.25)', color:'#c4b5fd', fontSize:12.5 }}>
                👑 You'll be the admin of this new organization.
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
