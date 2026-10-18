import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { previewInviteCode } from '../lib/orgInvites'
import { requestPasswordReset } from '../lib/email'
import { useAppName } from '../context/BrandingContext'
import { Zap, Mail, Lock, User, Building2, Ticket, Eye, EyeOff, Loader2, AlertCircle,
  CheckCircle2, Crown, ArrowRight, ShieldCheck, FolderKanban, Users, BarChart3 } from 'lucide-react'

const FEATURES = [
  { icon: ShieldCheck,  label: 'Multi-step approval workflows' },
  { icon: FolderKanban, label: 'Project budget tracking' },
  { icon: Users,        label: 'HR & resource management' },
  { icon: BarChart3,    label: 'Role-specific dashboards' },
]

function Field({ label, icon: Icon, children }) {
  return (
    <div style={{ marginBottom:14 }}>
      <label style={{ display:'block', fontSize:12, fontWeight:700, color:'rgba(255,255,255,.6)', marginBottom:6, textTransform:'uppercase', letterSpacing:'.05em' }}>{label}</label>
      <div style={{ position:'relative', display:'flex', alignItems:'center' }}>
        <Icon size={16} style={{ position:'absolute', left:14, color:'rgba(255,255,255,.35)', pointerEvents:'none' }}/>
        {children}
      </div>
    </div>
  )
}

const inputStyle = { width:'100%', padding:'11px 14px 11px 40px', borderRadius:10, border:'1px solid rgba(255,255,255,.12)', background:'rgba(255,255,255,.06)', color:'#fff', fontSize:14, fontFamily:'inherit', outline:'none', boxSizing:'border-box', transition:'border-color .15s, background .15s' }
const onFocusIn  = e => { e.target.style.borderColor='#6366f1'; e.target.style.background='rgba(255,255,255,.09)' }
const onFocusOut = e => { e.target.style.borderColor='rgba(255,255,255,.12)'; e.target.style.background='rgba(255,255,255,.06)' }

export default function AuthPage() {
  const { signIn, signUp, user } = useAuth()
  const appName = useAppName()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // ?invite=CODE (from an invite email) opens sign-up with the code filled in;
  // ?mode=forgot opens the password-reset request form.
  const inviteParam = (params.get('invite') || '').toUpperCase()
  const [mode, setMode] = useState(inviteParam || params.get('mode')==='signup' ? 'signup' : params.get('mode')==='forgot' ? 'forgot' : 'login')
  const [resetSent, setResetSent] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Which org a new signup lands in (STEP105) — 'create' spins up a brand
  // new organization with this user as its admin; 'join' consumes an
  // invite code an existing org's admin generated from Settings ->
  // Organization. Defaults to 'create' since that's the more common first
  // touch (nobody has an invite code until an org already exists).
  const [orgMode, setOrgMode] = useState(inviteParam ? 'join' : 'create')
  const [orgName, setOrgName] = useState('')
  const [inviteCode, setInviteCode] = useState(inviteParam)
  const [invitePreview, setInvitePreview] = useState(null) // { valid, org_name, role, reason }
  const [checkingInvite, setCheckingInvite] = useState(false)

  // ?next= — an in-app path to return to after login (only same-site paths).
  const nextPath = (() => { const n = params.get('next') || ''; return /^\/(?!\/)/.test(n) ? n : '/' })()
  useEffect(() => { if(user) navigate(nextPath) }, [user])

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
      if (mode==='login') { await signIn(email, password); navigate(nextPath); return }
      if (mode==='forgot') { await requestPasswordReset(email); setResetSent(true); return }

      if (orgMode==='create' && !orgName.trim()) throw new Error('Organization name is required')
      if (orgMode==='join' && !invitePreview?.valid) throw new Error('Enter a valid invite code first')

      const meta = { full_name: name, role: 'employee', org_mode: orgMode }
      if (orgMode==='create') {
        meta.org_name = orgName.trim()
        // Landing-page estimator hand-off (STEP133) — ?plan=<key>&modules=a,b,c
        // arrives here via useSearchParams below; handle_new_user() applies
        // that plan's own price/trial_days and activates the picked modules
        // immediately, rather than the new org defaulting to 'free'.
        const intendedPlan = params.get('plan')
        const intendedModules = params.get('modules')
        if (intendedPlan) meta.intended_plan_key = intendedPlan
        if (intendedModules) meta.intended_bundle_keys = intendedModules
        // Vendor referral (STEP134) — URL param wins if present, else
        // whatever the landing page stored on first touch.
        let referralCode = params.get('ref')
        if (!referralCode) { try { referralCode = localStorage.getItem('referral_code') } catch {} }
        if (referralCode) meta.referral_code = referralCode
      }
      if (orgMode==='join') meta.invite_code = inviteCode.trim()

      await signUp(email, password, meta)
      // Estimator-driven signups land straight on Billing — their picked
      // plan/modules and trial are already applied, so this is where
      // they'd actually pay if they want to skip the trial.
      navigate(meta.intended_plan_key || meta.intended_bundle_keys ? '/settings?tab=billing' : '/')
    } catch(err) { setError(err.message) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ minHeight:'100vh', background:'#060612', display:'flex', fontFamily:"'Plus Jakarta Sans',sans-serif", position:'relative', overflow:'hidden' }}>
      <style>{`
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes shake{10%,90%{transform:translateX(-1px)}20%,80%{transform:translateX(2px)}30%,50%,70%{transform:translateX(-4px)}40%,60%{transform:translateX(4px)}}
        .auth-fade{animation:fadeUp .5s ease both}
        .auth-spin{animation:spin .9s linear infinite}
        .auth-error{animation:shake .4s ease}
        .auth-link{transition:color .15s}
        .auth-link:hover{color:#a5b4fc}
        .auth-toggle-btn{transition:background .15s,color .15s}
        .auth-submit{transition:transform .15s, box-shadow .15s, opacity .15s}
        .auth-submit:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 16px 36px rgba(99,102,241,.45)}
        .auth-eye{background:transparent;border:none;cursor:pointer;color:rgba(255,255,255,.4);padding:4px;display:flex;align-items:center}
        .auth-eye:hover{color:rgba(255,255,255,.8)}
      `}</style>

      {/* Bg */}
      <div style={{ position:'absolute', width:500, height:500, borderRadius:'50%', background:'radial-gradient(circle,rgba(99,102,241,.2) 0%,transparent 70%)', top:'-10%', left:'-10%', filter:'blur(40px)', animation:'float 9s ease-in-out infinite' }}/>
      <div style={{ position:'absolute', width:400, height:400, borderRadius:'50%', background:'radial-gradient(circle,rgba(139,92,246,.15) 0%,transparent 70%)', bottom:'-10%', right:'-5%', filter:'blur(30px)', animation:'float 11s ease-in-out infinite 1s' }}/>
      <div style={{ position:'absolute', inset:0, backgroundImage:'radial-gradient(rgba(255,255,255,.03) 1px, transparent 1px)', backgroundSize:'28px 28px' }}/>

      {/* Left: brand */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'60px 40px' }} className="hide-mobile">
        <div className="auth-fade" style={{ maxWidth:420 }}>
          <Link to="/" style={{ display:'flex', alignItems:'center', gap:10, textDecoration:'none', marginBottom:48 }}>
            <div style={{ width:42, height:42, borderRadius:12, background:'linear-gradient(135deg,#6366f1,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center' }}><Zap size={21} color="#fff" fill="#fff"/></div>
            <div style={{ fontFamily:"'Playfair Display',serif", fontSize:24, fontWeight:800, color:'#fff' }}>{appName}</div>
          </Link>
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:40, fontWeight:800, color:'#fff', lineHeight:1.15, marginBottom:20 }}>
            Manage Everything.<br/><span style={{ background:'linear-gradient(135deg,#818cf8,#a78bfa)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>From One Place.</span>
          </div>
          <div style={{ fontSize:15, color:'rgba(255,255,255,.5)', lineHeight:1.7, marginBottom:40 }}>
            A unified platform for expenses, approvals, projects, HR, and business operations.
          </div>
          {FEATURES.map((f,i)=>(
            <div key={f.label} className="auth-fade" style={{ display:'flex', alignItems:'center', gap:10, fontSize:14, color:'rgba(255,255,255,.6)', marginBottom:12, animationDelay:`${.1+i*.07}s` }}>
              <div style={{ width:24, height:24, borderRadius:6, background:'rgba(99,102,241,.25)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <f.icon size={13} color="#a5b4fc"/>
              </div>
              {f.label}
            </div>
          ))}
        </div>
      </div>

      {/* Right: form */}
      <div style={{ width:'min(480px,100%)', display:'flex', alignItems:'center', justifyContent:'center', padding:'40px 32px', position:'relative' }}>
        <div className="auth-fade" style={{ width:'100%', maxWidth:400, background:'rgba(255,255,255,.04)', borderRadius:24, border:'1px solid rgba(255,255,255,.1)', padding:'40px 36px', backdropFilter:'blur(20px)', animationDelay:'.1s' }}>

          {/* Logo for mobile */}
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:28 }}>
            <div style={{ width:34, height:34, borderRadius:10, background:'linear-gradient(135deg,#6366f1,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center' }}><Zap size={17} color="#fff" fill="#fff"/></div>
            <span style={{ fontFamily:"'Playfair Display',serif", fontSize:17, fontWeight:800, color:'#fff' }}>{appName}</span>
          </div>

          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:26, fontWeight:800, color:'#fff', marginBottom:6 }}>
            {mode==='login' ? 'Welcome back' : mode==='forgot' ? 'Reset your password' : 'Create account'}
          </div>
          <div style={{ fontSize:13, color:'rgba(255,255,255,.4)', marginBottom:28 }}>
            {mode==='login' ? 'Sign in to your workspace' : mode==='forgot' ? "Enter your email and we'll send you a reset link" : `Join ${appName}`}
          </div>

          {error && (
            <div key={error} className="auth-error" style={{ display:'flex', alignItems:'center', gap:9, padding:'10px 14px', borderRadius:10, background:'rgba(239,68,68,.15)', border:'1px solid rgba(239,68,68,.3)', color:'#fca5a5', fontSize:13, marginBottom:16 }}>
              <AlertCircle size={15} style={{ flexShrink:0 }}/> {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {mode==='signup' && (
              <Field label="Full Name" icon={User}>
                <input value={name} onChange={e=>setName(e.target.value)} placeholder="Your full name" required
                  style={inputStyle} onFocus={onFocusIn} onBlur={onFocusOut}/>
              </Field>
            )}

            {mode==='signup' && (
              <div style={{ marginBottom:14 }}>
                <label style={{ display:'block', fontSize:12, fontWeight:700, color:'rgba(255,255,255,.6)', marginBottom:6, textTransform:'uppercase', letterSpacing:'.05em' }}>Workspace</label>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10 }}>
                  {[['create','New organization'],['join','Join with invite']].map(([id,label])=>(
                    <div key={id} onClick={()=>setOrgMode(id)}
                      style={{ padding:'10px 8px', borderRadius:10, textAlign:'center', cursor:'pointer', fontSize:12.5, fontWeight:700, transition:'all .15s',
                        border:`1.5px solid ${orgMode===id?'#6366f1':'rgba(255,255,255,.1)'}`,
                        background:orgMode===id?'rgba(99,102,241,.15)':'rgba(255,255,255,.03)',
                        color:orgMode===id?'#a5b4fc':'rgba(255,255,255,.5)' }}>
                      {label}
                    </div>
                  ))}
                </div>

                {orgMode==='create' ? (
                  <Field label="" icon={Building2}>
                    <input value={orgName} onChange={e=>setOrgName(e.target.value)} placeholder="Your company / team name" required
                      style={{ ...inputStyle }} onFocus={onFocusIn} onBlur={onFocusOut}/>
                  </Field>
                ) : (
                  <>
                    <Field label="" icon={Ticket}>
                      <input value={inviteCode} onChange={e=>setInviteCode(e.target.value.toUpperCase())} placeholder="Invite code (e.g. AB12CD34)" required
                        style={{ ...inputStyle, letterSpacing:'.05em' }} onFocus={onFocusIn} onBlur={onFocusOut}/>
                    </Field>
                    {checkingInvite && <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'rgba(255,255,255,.4)', marginTop:6 }}><Loader2 size={12} className="auth-spin"/> Checking…</div>}
                    {!checkingInvite && invitePreview?.valid && (
                      <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12.5, color:'#86efac', marginTop:6 }}><CheckCircle2 size={13}/> Joining <strong>{invitePreview.org_name}</strong> as {invitePreview.role}</div>
                    )}
                    {!checkingInvite && invitePreview && !invitePreview.valid && (
                      <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12.5, color:'#fca5a5', marginTop:6 }}><AlertCircle size={13}/> {invitePreview.reason}</div>
                    )}
                  </>
                )}
              </div>
            )}

            <Field label="Email" icon={Mail}>
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com" required
                style={inputStyle} onFocus={onFocusIn} onBlur={onFocusOut}/>
            </Field>

            {mode==='forgot' && resetSent && (
              <div style={{ display:'flex', alignItems:'flex-start', gap:9, padding:'10px 14px', borderRadius:10, background:'rgba(34,197,94,.12)', border:'1px solid rgba(34,197,94,.3)', color:'#86efac', fontSize:13, marginBottom:16 }}>
                <CheckCircle2 size={15} style={{ flexShrink:0, marginTop:1 }}/> If an account exists for {email}, a reset link is on its way. Check your inbox and spam folder.
              </div>
            )}

            {mode!=='forgot' && <div style={{ marginBottom:20 }}>
              <label style={{ display:'flex', justifyContent:'space-between', fontSize:12, fontWeight:700, color:'rgba(255,255,255,.6)', marginBottom:6, textTransform:'uppercase', letterSpacing:'.05em' }}>Password
                {mode==='login' && <span className="auth-link" style={{ color:'#818cf8', cursor:'pointer', textTransform:'none', letterSpacing:0 }} onClick={()=>{setMode('forgot');setError('');setResetSent(false)}}>Forgot password?</span>}
              </label>
              <div style={{ position:'relative', display:'flex', alignItems:'center' }}>
                <Lock size={16} style={{ position:'absolute', left:14, color:'rgba(255,255,255,.35)', pointerEvents:'none' }}/>
                <input type={showPassword?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required minLength={6}
                  style={{ ...inputStyle, paddingRight:40 }} onFocus={onFocusIn} onBlur={onFocusOut}/>
                <button type="button" className="auth-eye" style={{ position:'absolute', right:10 }} onClick={()=>setShowPassword(s=>!s)} tabIndex={-1}
                  aria-label={showPassword?'Hide password':'Show password'}>
                  {showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}
                </button>
              </div>
            </div>}

            {/* Role is decided server-side for both signup paths — 'create'
                always makes you the new org's admin, 'join' takes the role
                the invite was issued with — so no picker is shown here. */}
            {mode==='signup' && orgMode==='create' && (
              <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:20, padding:'10px 14px', borderRadius:10, background:'rgba(124,58,237,.12)', border:'1px solid rgba(124,58,237,.25)', color:'#c4b5fd', fontSize:12.5 }}>
                <Crown size={15} style={{ flexShrink:0 }}/> You'll be the admin of this new organization.
              </div>
            )}

            <button type="submit" disabled={loading} className="auth-submit"
              style={{ width:'100%', padding:'13px', borderRadius:12, border:'none', background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff', fontWeight:800, fontSize:15, cursor:loading?'not-allowed':'pointer', fontFamily:'inherit', boxShadow:'0 12px 30px rgba(99,102,241,.35)', opacity:loading?.7:1, display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
              {loading
                ? <><Loader2 size={16} className="auth-spin"/> Please wait…</>
                : <>{mode==='login' ? 'Sign In' : mode==='forgot' ? (resetSent ? 'Send again' : 'Send reset link') : 'Create Account'} <ArrowRight size={16}/></>}
            </button>
          </form>

          <div style={{ textAlign:'center', marginTop:20, fontSize:13, color:'rgba(255,255,255,.4)' }}>
            {mode==='login' ? "Don't have an account? " : mode==='forgot' ? 'Remembered it? ' : 'Already have an account? '}
            <span className="auth-link" style={{ color:'#818cf8', cursor:'pointer', fontWeight:700 }} onClick={()=>{setMode(m=>m==='login'?'signup':'login');setError('')}}>
              {mode==='login' ? 'Sign up' : 'Sign in'}
            </span>
          </div>

          <div style={{ textAlign:'center', marginTop:16 }}>
            <Link to="/" className="auth-link" style={{ fontSize:12, color:'rgba(255,255,255,.3)', textDecoration:'none', fontWeight:500 }}>← Back to home</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
