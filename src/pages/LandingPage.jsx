import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const BRAND = 'ThingsAlive NeoX'
const GRAD  = 'linear-gradient(135deg,#0f172a 0%,#1e1b4b 40%,#312e81 70%,#4c1d95 100%)'

/* ── tiny helpers ── */
const fadeIn = (delay=0) => ({ opacity:0, animation:`fadeUp .6s ease ${delay}s forwards` })

function useOnScreen(ref) {
  const [vis, setVis] = useState(false)
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if(e.isIntersecting) setVis(true) }, { threshold:.15 })
    if(ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])
  return vis
}

function FadeSection({ children, delay=0, style={} }) {
  const ref = useRef(); const vis = useOnScreen(ref)
  return (
    <div ref={ref} style={{ transition:`opacity .7s ease ${delay}s, transform .7s ease ${delay}s`, opacity:vis?1:0, transform:vis?'none':'translateY(28px)', ...style }}>
      {children}
    </div>
  )
}

/* ── pill badge ── */
const Pill = ({ color='#6366f1', children }) => (
  <span style={{ padding:'4px 14px', borderRadius:999, background:`${color}18`, color, fontSize:12, fontWeight:700, border:`1px solid ${color}30` }}>{children}</span>
)

/* ── feature card ── */
function FeatureCard({ icon, title, desc, color, delay }) {
  const ref = useRef(); const vis = useOnScreen(ref)
  return (
    <div ref={ref} style={{ background:'rgba(255,255,255,.04)', borderRadius:20, padding:'28px 24px', border:`1px solid rgba(255,255,255,.08)`, backdropFilter:'blur(10px)', transition:`all .6s ease ${delay}s`, opacity:vis?1:0, transform:vis?'none':'translateY(20px)' }}>
      <div style={{ width:52, height:52, borderRadius:16, background:`${color}22`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:26, marginBottom:18 }}>{icon}</div>
      <div style={{ fontWeight:800, fontSize:17, color:'#fff', marginBottom:8 }}>{title}</div>
      <div style={{ fontSize:14, color:'rgba(255,255,255,.55)', lineHeight:1.6 }}>{desc}</div>
    </div>
  )
}

/* ── stat counter ── */
function StatNum({ n, suffix='', label }) {
  const [count, setCount] = useState(0)
  const ref = useRef(); const vis = useOnScreen(ref)
  useEffect(() => {
    if (!vis) return
    let start = 0; const end = parseInt(n); const dur = 1500; const step = end/dur*16
    const t = setInterval(() => { start = Math.min(start+step, end); setCount(Math.floor(start)); if(start>=end) clearInterval(t) }, 16)
    return () => clearInterval(t)
  }, [vis, n])
  return (
    <div ref={ref} style={{ textAlign:'center' }}>
      <div style={{ fontSize:52, fontWeight:900, color:'#fff', fontFamily:"'Playfair Display',serif", lineHeight:1 }}>{count.toLocaleString()}{suffix}</div>
      <div style={{ fontSize:14, color:'rgba(255,255,255,.55)', marginTop:8, fontWeight:500 }}>{label}</div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════ */
export default function LandingPage() {
  const navigate = useNavigate()
  const [announcements, setAnnouncements] = useState([])
  const [awards,        setAwards]        = useState([])
  const [news,          setNews]          = useState([])
  const [hackathon,     setHackathon]     = useState([])
  const [activeAnn,     setActiveAnn]     = useState(0)
  const [activeTab,     setActiveTab]     = useState('announcements')
  const [comment,       setComment]       = useState('')
  const [commentTopic,  setCommentTopic]  = useState(null)
  const [comments,      setComments]      = useState({})
  const [expandedNews,  setExpandedNews]  = useState(null)
  const [scrolled,      setScrolled]      = useState(false)

  useEffect(() => {
    window.addEventListener('scroll', () => setScrolled(window.scrollY > 40))
    loadAll()
    const timer = setInterval(() => setActiveAnn(a => (a+1) % Math.max(1, announcements.length)), 4000)
    return () => { window.removeEventListener('scroll', () => {}); clearInterval(timer) }
  }, [announcements.length])

  async function loadAll() {
    const [ann, awd, nws, hack] = await Promise.all([
      supabase.from('announcements').select('*').eq('is_active', true).order('pinned', {ascending:false}).order('created_at', {ascending:false}),
      supabase.from('awards').select('*, recipient:profiles!awarded_to(full_name)').eq('is_active', true).order('award_date', {ascending:false}).limit(6),
      supabase.from('news_posts').select('*').eq('is_published', true).order('published_at', {ascending:false}).limit(6),
      supabase.from('hackathon_topics').select('*').eq('is_active', true).order('created_at', {ascending:false}),
    ])
    setAnnouncements(ann.data || [])
    setAwards(awd.data || [])
    setNews(nws.data || [])
    setHackathon(hack.data || [])
  }

  async function loadComments(topicId) {
    const { data } = await supabase.from('hackathon_comments')
      .select('*, user:profiles!user_id(full_name)').eq('topic_id', topicId).order('created_at')
    setComments(prev => ({ ...prev, [topicId]: data || [] }))
  }

  async function submitComment(topicId) {
    if (!comment.trim()) return
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { navigate('/auth'); return }
    await supabase.from('hackathon_comments').insert({ topic_id: topicId, user_id: session.user.id, content: comment.trim() })
    setComment('')
    loadComments(topicId)
  }

  const ANN_COLORS = { info:'#3b82f6', success:'#10b981', warning:'#f59e0b', event:'#ec4899' }
  const DIFF_COLORS = { easy:'#10b981', medium:'#f59e0b', hard:'#ef4444', expert:'#8b5cf6' }

  const curAnn = announcements[activeAnn]

  return (
    <div style={{ fontFamily:"'Plus Jakarta Sans',sans-serif", background:'#060612', minHeight:'100vh', color:'#fff', overflowX:'hidden' }}>
      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(20px) } to { opacity:1; transform:none } }
        @keyframes float { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-12px) } }
        @keyframes spin { to { transform:rotate(360deg) } }
        @keyframes pulse { 0%,100% { opacity:.4 } 50% { opacity:.8 } }
        ::selection { background:#6366f1; color:#fff }
        ::-webkit-scrollbar { width:6px } ::-webkit-scrollbar-track { background:#0f172a }
        ::-webkit-scrollbar-thumb { background:#312e81; border-radius:3px }
      `}</style>

      {/* ── NAVBAR ── */}
      <nav style={{ position:'fixed', top:0, left:0, right:0, zIndex:100, padding:'0 40px', height:68, display:'flex', alignItems:'center', justifyContent:'space-between', background: scrolled?'rgba(6,6,18,.92)':'transparent', backdropFilter:scrolled?'blur(20px)':'none', borderBottom:scrolled?'1px solid rgba(255,255,255,.07)':'none', transition:'all .3s' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:'linear-gradient(135deg,#6366f1,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>⚡</div>
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:20, fontWeight:800 }}>ThingsAlive <span style={{ color:'#818cf8' }}>NeoX</span></div>
        </div>
        <div style={{ display:'flex', gap:12 }}>
          <button onClick={()=>navigate('/auth')} style={{ padding:'8px 22px', borderRadius:10, border:'1px solid rgba(255,255,255,.18)', background:'transparent', color:'#fff', fontWeight:600, fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>Sign In</button>
          <button onClick={()=>navigate('/auth?mode=signup')} style={{ padding:'8px 22px', borderRadius:10, border:'none', background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff', fontWeight:700, fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>Get Started →</button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section style={{ minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', textAlign:'center', padding:'120px 24px 80px', position:'relative', overflow:'hidden' }}>
        {/* Bg orbs */}
        <div style={{ position:'absolute', width:600, height:600, borderRadius:'50%', background:'radial-gradient(circle,rgba(99,102,241,.25) 0%,transparent 70%)', top:'10%', left:'20%', filter:'blur(40px)', animation:'pulse 4s ease infinite' }}/>
        <div style={{ position:'absolute', width:400, height:400, borderRadius:'50%', background:'radial-gradient(circle,rgba(139,92,246,.2) 0%,transparent 70%)', top:'30%', right:'15%', filter:'blur(30px)', animation:'pulse 5s ease infinite 1s' }}/>
        <div style={{ position:'absolute', inset:0, backgroundImage:'radial-gradient(rgba(255,255,255,.04) 1px, transparent 1px)', backgroundSize:'32px 32px' }}/>

        <div style={{ position:'relative', maxWidth:900 }}>
          <div style={{ ...fadeIn(0), display:'inline-flex', alignItems:'center', gap:8, padding:'6px 18px', borderRadius:999, background:'rgba(99,102,241,.15)', border:'1px solid rgba(99,102,241,.3)', fontSize:13, fontWeight:700, color:'#a5b4fc', marginBottom:32 }}>
            <span style={{ width:8, height:8, borderRadius:'50%', background:'#6366f1', display:'inline-block', animation:'pulse 2s ease infinite' }}/>
            Unified Business Operations Platform
          </div>

          <div style={{ ...fadeIn(.1), fontFamily:"'Playfair Display',serif", fontSize:'clamp(40px,7vw,88px)', fontWeight:800, lineHeight:1.05, marginBottom:24 }}>
            <span style={{ background:'linear-gradient(135deg,#fff 0%,#c7d2fe 100%)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>Manage Everything.</span>
            <br/>
            <span style={{ background:'linear-gradient(135deg,#818cf8 0%,#a78bfa 50%,#ec4899 100%)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>From One Place.</span>
          </div>

          <div style={{ ...fadeIn(.2), fontSize:'clamp(15px,2vw,20px)', color:'rgba(255,255,255,.6)', lineHeight:1.7, maxWidth:640, margin:'0 auto 48px' }}>
            A unified platform to manage expenses, approvals, travel, budgets, invoices, projects, assets, and business operations with complete visibility and control.
          </div>

          <div style={{ ...fadeIn(.35), display:'flex', gap:16, justifyContent:'center', flexWrap:'wrap', marginBottom:64 }}>
            <button onClick={()=>navigate('/auth?mode=signup')} style={{ padding:'16px 40px', borderRadius:14, border:'none', background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff', fontWeight:800, fontSize:16, cursor:'pointer', fontFamily:'inherit', boxShadow:'0 20px 50px rgba(99,102,241,.4)', transition:'all .2s' }}
              onMouseEnter={e=>e.target.style.transform='translateY(-2px)'} onMouseLeave={e=>e.target.style.transform='none'}>
              One Platform. Every Workflow. 🚀
            </button>
            <button onClick={()=>navigate('/auth')} style={{ padding:'16px 32px', borderRadius:14, border:'1px solid rgba(255,255,255,.2)', background:'rgba(255,255,255,.05)', color:'#fff', fontWeight:600, fontSize:16, cursor:'pointer', fontFamily:'inherit', backdropFilter:'blur(10px)' }}>
              Sign In →
            </button>
          </div>

          {/* Feature pills */}
          <div style={{ ...fadeIn(.45), display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap' }}>
            {['💸 Expenses','✅ Approvals','✈️ Travel','📁 Projects','📦 Assets','👥 HR & Leave','🏪 Vendors','💰 Budget','📄 Invoices'].map(f=>(
              <div key={f} style={{ padding:'7px 16px', borderRadius:999, background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)', fontSize:13, color:'rgba(255,255,255,.75)', fontWeight:500 }}>{f}</div>
            ))}
          </div>
        </div>

        {/* Scroll hint */}
        <div style={{ position:'absolute', bottom:32, left:'50%', transform:'translateX(-50%)', display:'flex', flexDirection:'column', alignItems:'center', gap:6, opacity:.4, animation:'float 2s ease infinite' }}>
          <div style={{ width:1, height:40, background:'rgba(255,255,255,.4)' }}/>
          <div style={{ fontSize:11, letterSpacing:'.15em', fontWeight:600 }}>SCROLL</div>
        </div>
      </section>

      {/* ── STATS ── */}
      <section style={{ padding:'80px 24px', borderTop:'1px solid rgba(255,255,255,.06)', borderBottom:'1px solid rgba(255,255,255,.06)' }}>
        <div style={{ maxWidth:900, margin:'0 auto', display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:40 }}>
          <StatNum n="15" suffix="+" label="Modules Integrated"/>
          <StatNum n="6"  suffix=" Roles" label="Role-based Access"/>
          <StatNum n="100" suffix="%" label="Real-time Data"/>
          <StatNum n="3"  suffix="-step" label="Approval Flows"/>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section style={{ padding:'100px 24px' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <FadeSection>
            <div style={{ textAlign:'center', marginBottom:64 }}>
              <Pill color="#6366f1">Platform Features</Pill>
              <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'clamp(28px,4vw,48px)', fontWeight:800, marginTop:16, marginBottom:12 }}>Everything your business needs</div>
              <div style={{ fontSize:16, color:'rgba(255,255,255,.5)', maxWidth:520, margin:'0 auto' }}>One login. Every workflow. Complete control over your operations.</div>
            </div>
          </FadeSection>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:20 }}>
            {[
              { icon:'🧾', title:'Expense Management',    desc:'Multi-step role-based approval flows with budget tracking and receipt uploads.',          color:'#6366f1', delay:0 },
              { icon:'✈️', title:'Travel Requests',      desc:'Submit and approve travel requests with cost estimates linked to project budgets.',         color:'#ec4899', delay:.05 },
              { icon:'📁', title:'Project Management',    desc:'Full project lifecycle — budgets, milestones, timelines, resource allocation and forecasts.', color:'#f59e0b', delay:.1 },
              { icon:'👥', title:'HR & Leave Management', desc:'Leave policies, balance tracking, check-in/out, payroll calculation per resource.',         color:'#10b981', delay:.15 },
              { icon:'📦', title:'Asset Tracking',       desc:'Asset lifecycle from purchase to disposal. Assign, return, maintain with full audit trail.',  color:'#3b82f6', delay:.2 },
              { icon:'🏪', title:'Vendor Management',    desc:'Onboard vendors, manage ratings, track invoices, fund flow and payment status.',             color:'#8b5cf6', delay:.25 },
              { icon:'💰', title:'Budget & Finance',     desc:'Department and project budgets with real-time utilization, forecasting and alerts.',          color:'#14b8a6', delay:.3 },
              { icon:'📊', title:'Reports & Analytics',  desc:'Export any module to CSV. Role-specific dashboards with trend charts and KPIs.',              color:'#ef4444', delay:.35 },
              { icon:'⚡', title:'Approval Workflows',   desc:'Configurable multi-stage approval chains. Employee → Manager → CEO → Finance.',              color:'#a855f7', delay:.4 },
            ].map(f => <FeatureCard key={f.title} {...f}/>)}
          </div>
        </div>
      </section>

      {/* ── DYNAMIC CONTENT TABS ── */}
      <section style={{ padding:'80px 24px', background:'rgba(255,255,255,.02)', borderTop:'1px solid rgba(255,255,255,.06)' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <FadeSection>
            <div style={{ textAlign:'center', marginBottom:48 }}>
              <Pill color="#10b981">Live Updates</Pill>
              <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'clamp(24px,3.5vw,40px)', fontWeight:800, marginTop:14, marginBottom:8 }}>What's happening</div>
            </div>
          </FadeSection>

          {/* Tab bar */}
          <div style={{ display:'flex', gap:8, marginBottom:32, overflowX:'auto', paddingBottom:4, justifyContent:'center', flexWrap:'wrap' }}>
            {[
              { id:'announcements', label:'📢 Announcements', count:announcements.length },
              { id:'awards',        label:'🏆 Awards',        count:awards.length },
              { id:'news',          label:'📰 Latest News',   count:news.length },
              { id:'hackathon',     label:'💡 Hackathon',     count:hackathon.length },
            ].map(t=>(
              <button key={t.id} onClick={()=>setActiveTab(t.id)}
                style={{ padding:'10px 22px', borderRadius:12, border:'none', cursor:'pointer', fontFamily:'inherit', fontWeight:700, fontSize:13, whiteSpace:'nowrap', transition:'all .2s',
                  background:activeTab===t.id?'linear-gradient(135deg,#6366f1,#8b5cf6)':'rgba(255,255,255,.06)',
                  color:activeTab===t.id?'#fff':'rgba(255,255,255,.6)',
                  boxShadow:activeTab===t.id?'0 8px 24px rgba(99,102,241,.35)':'none' }}>
                {t.label} {t.count>0 && <span style={{ marginLeft:6, background:'rgba(255,255,255,.2)', borderRadius:999, padding:'1px 7px', fontSize:11 }}>{t.count}</span>}
              </button>
            ))}
          </div>

          {/* Announcements */}
          {activeTab==='announcements' && (
            <FadeSection style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))', gap:16 }}>
              {announcements.length===0 ? (
                <div style={{ gridColumn:'1/-1', textAlign:'center', color:'rgba(255,255,255,.3)', padding:'60px 0', fontSize:15 }}>No announcements yet</div>
              ) : announcements.map((a,i)=>{
                const ac = ANN_COLORS[a.type]||'#6366f1'
                return (
                  <div key={a.id} style={{ background:'rgba(255,255,255,.04)', borderRadius:16, border:`1px solid ${ac}25`, padding:'22px 24px', position:'relative', overflow:'hidden' }}>
                    {a.pinned && <div style={{ position:'absolute', top:14, right:14, fontSize:11, fontWeight:700, color:ac, background:`${ac}18`, padding:'2px 8px', borderRadius:999 }}>📌 PINNED</div>}
                    <div style={{ width:40, height:40, borderRadius:12, background:`${ac}18`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, marginBottom:14 }}>
                      {a.type==='info'?'ℹ️':a.type==='success'?'✅':a.type==='warning'?'⚠️':'🎉'}
                    </div>
                    <div style={{ fontWeight:700, fontSize:16, marginBottom:8 }}>{a.title}</div>
                    <div style={{ fontSize:13, color:'rgba(255,255,255,.55)', lineHeight:1.6 }}>{a.content}</div>
                    <div style={{ fontSize:11, color:'rgba(255,255,255,.3)', marginTop:14 }}>{new Date(a.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</div>
                  </div>
                )
              })}
            </FadeSection>
          )}

          {/* Awards */}
          {activeTab==='awards' && (
            <FadeSection style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))', gap:16 }}>
              {awards.length===0 ? (
                <div style={{ gridColumn:'1/-1', textAlign:'center', color:'rgba(255,255,255,.3)', padding:'60px 0', fontSize:15 }}>No awards yet — admin can add them from Settings</div>
              ) : awards.map(a=>(
                <div key={a.id} style={{ background:'rgba(255,255,255,.04)', borderRadius:16, border:`1px solid ${a.color||'#f59e0b'}25`, padding:'28px 22px', textAlign:'center' }}>
                  <div style={{ fontSize:52, marginBottom:14, animation:'float 3s ease infinite' }}>{a.icon||'🏆'}</div>
                  <div style={{ fontWeight:800, fontSize:16, marginBottom:6 }}>{a.title}</div>
                  {a.recipient?.full_name && (
                    <div style={{ fontSize:14, color:a.color||'#f59e0b', fontWeight:700, marginBottom:8 }}>🎖️ {a.recipient.full_name}</div>
                  )}
                  {a.description && <div style={{ fontSize:13, color:'rgba(255,255,255,.45)', lineHeight:1.5 }}>{a.description}</div>}
                  <div style={{ fontSize:11, color:'rgba(255,255,255,.3)', marginTop:12 }}>{new Date(a.award_date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</div>
                </div>
              ))}
            </FadeSection>
          )}

          {/* News */}
          {activeTab==='news' && (
            <FadeSection style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))', gap:20 }}>
              {news.length===0 ? (
                <div style={{ gridColumn:'1/-1', textAlign:'center', color:'rgba(255,255,255,.3)', padding:'60px 0', fontSize:15 }}>No news posts yet — admin can publish from Settings</div>
              ) : news.map(post=>(
                <div key={post.id} style={{ background:'rgba(255,255,255,.04)', borderRadius:18, border:'1px solid rgba(255,255,255,.08)', overflow:'hidden', cursor:'pointer', transition:'all .2s' }}
                  onClick={()=>setExpandedNews(expandedNews===post.id?null:post.id)}
                  onMouseEnter={e=>e.currentTarget.style.transform='translateY(-3px)'}
                  onMouseLeave={e=>e.currentTarget.style.transform='none'}>
                  {post.image_url && <img src={post.image_url} alt={post.title} style={{ width:'100%', height:180, objectFit:'cover' }}/>}
                  {!post.image_url && (
                    <div style={{ height:120, background:`linear-gradient(135deg,#1e1b4b,#312e81)`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:40 }}>
                      {post.category==='event'?'🎉':post.category==='milestone'?'🏆':post.category==='product'?'🚀':'📰'}
                    </div>
                  )}
                  <div style={{ padding:'20px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                      <span style={{ padding:'2px 10px', borderRadius:999, background:'rgba(99,102,241,.2)', color:'#a5b4fc', fontSize:11, fontWeight:700, textTransform:'capitalize' }}>{post.category}</span>
                      <span style={{ fontSize:11, color:'rgba(255,255,255,.35)' }}>{new Date(post.published_at||post.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</span>
                    </div>
                    <div style={{ fontWeight:700, fontSize:16, marginBottom:8, lineHeight:1.3 }}>{post.title}</div>
                    <div style={{ fontSize:13, color:'rgba(255,255,255,.5)', lineHeight:1.6, display: expandedNews===post.id?'block':'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
                      {post.content}
                    </div>
                    <div style={{ fontSize:12, color:'#818cf8', marginTop:10, fontWeight:600 }}>{expandedNews===post.id?'▲ Read less':'▼ Read more'}</div>
                  </div>
                </div>
              ))}
            </FadeSection>
          )}

          {/* Hackathon */}
          {activeTab==='hackathon' && (
            <FadeSection style={{ display:'flex', flexDirection:'column', gap:16 }}>
              {hackathon.length===0 ? (
                <div style={{ textAlign:'center', color:'rgba(255,255,255,.3)', padding:'60px 0', fontSize:15 }}>No hackathon topics yet</div>
              ) : hackathon.map(topic=>{
                const dc = DIFF_COLORS[topic.difficulty]||'#6366f1'
                const isOpen = commentTopic===topic.id
                return (
                  <div key={topic.id} style={{ background:'rgba(255,255,255,.04)', borderRadius:18, border:'1px solid rgba(255,255,255,.08)', padding:'24px', transition:'all .2s' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16, flexWrap:'wrap' }}>
                      <div style={{ flex:1 }}>
                        <div style={{ display:'flex', gap:8, marginBottom:10, flexWrap:'wrap' }}>
                          <span style={{ padding:'3px 10px', borderRadius:999, background:`${dc}20`, color:dc, fontSize:11, fontWeight:700, textTransform:'capitalize' }}>{topic.difficulty}</span>
                          {(topic.tags||[]).map(t=><span key={t} style={{ padding:'3px 10px', borderRadius:999, background:'rgba(255,255,255,.06)', color:'rgba(255,255,255,.5)', fontSize:11 }}>{t}</span>)}
                        </div>
                        <div style={{ fontWeight:800, fontSize:17, marginBottom:8 }}>💡 {topic.title}</div>
                        <div style={{ fontSize:14, color:'rgba(255,255,255,.5)', lineHeight:1.6 }}>{topic.description}</div>
                      </div>
                      <button onClick={async()=>{
                          const open = commentTopic===topic.id
                          setCommentTopic(open?null:topic.id)
                          if(!open && !comments[topic.id]) loadComments(topic.id)
                        }}
                        style={{ padding:'8px 20px', borderRadius:10, border:'1px solid rgba(255,255,255,.15)', background:'rgba(255,255,255,.06)', color:'#fff', fontWeight:700, fontSize:13, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>
                        {isOpen?'Close':'💬 Comment'}
                      </button>
                    </div>
                    {isOpen && (
                      <div style={{ marginTop:20, borderTop:'1px solid rgba(255,255,255,.07)', paddingTop:20 }}>
                        {(comments[topic.id]||[]).map((c,i)=>(
                          <div key={i} style={{ display:'flex', gap:12, marginBottom:14 }}>
                            <div style={{ width:32, height:32, borderRadius:10, background:'linear-gradient(135deg,#6366f1,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:800, flexShrink:0 }}>
                              {(c.user?.full_name||'?')[0]}
                            </div>
                            <div>
                              <div style={{ fontSize:12, fontWeight:700, color:'#a5b4fc', marginBottom:3 }}>{c.user?.full_name||'User'}</div>
                              <div style={{ fontSize:13, color:'rgba(255,255,255,.65)', lineHeight:1.5 }}>{c.content}</div>
                            </div>
                          </div>
                        ))}
                        <div style={{ display:'flex', gap:10, marginTop:12 }}>
                          <input value={comment} onChange={e=>setComment(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submitComment(topic.id)}
                            placeholder="Share your thoughts… (login required)"
                            style={{ flex:1, padding:'10px 14px', borderRadius:10, border:'1px solid rgba(255,255,255,.15)', background:'rgba(255,255,255,.06)', color:'#fff', fontSize:13, fontFamily:'inherit', outline:'none' }}/>
                          <button onClick={()=>submitComment(topic.id)}
                            style={{ padding:'10px 20px', borderRadius:10, border:'none', background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff', fontWeight:700, fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>
                            Post
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </FadeSection>
          )}
        </div>
      </section>

      {/* ── WORKFLOW STEPS ── */}
      <section style={{ padding:'100px 24px' }}>
        <div style={{ maxWidth:900, margin:'0 auto', textAlign:'center' }}>
          <FadeSection>
            <Pill color="#ec4899">How It Works</Pill>
            <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'clamp(26px,4vw,44px)', fontWeight:800, marginTop:16, marginBottom:60 }}>Simple. Powerful. Complete.</div>
          </FadeSection>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:24 }}>
            {[
              { n:'01', icon:'👤', title:'Sign Up', desc:'Create your account and get assigned to your role.' },
              { n:'02', icon:'📤', title:'Submit', desc:'File expenses, travel requests, or purchase requisitions.' },
              { n:'03', icon:'✅', title:'Approve', desc:'Multi-step approval flows route to the right people.' },
              { n:'04', icon:'📊', title:'Analyse', desc:'Real-time dashboards and budget tracking give full visibility.' },
            ].map((s,i)=>(
              <FadeSection key={s.n} delay={i*.1}>
                <div style={{ textAlign:'center' }}>
                  <div style={{ fontFamily:"'Playfair Display',serif", fontSize:64, fontWeight:900, color:'rgba(99,102,241,.15)', lineHeight:1, marginBottom:-20 }}>{s.n}</div>
                  <div style={{ width:64, height:64, borderRadius:18, background:'rgba(255,255,255,.05)', border:'1px solid rgba(255,255,255,.1)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:30, margin:'0 auto 16px' }}>{s.icon}</div>
                  <div style={{ fontWeight:800, fontSize:16, marginBottom:8 }}>{s.title}</div>
                  <div style={{ fontSize:13, color:'rgba(255,255,255,.45)', lineHeight:1.6 }}>{s.desc}</div>
                </div>
              </FadeSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ padding:'100px 24px', textAlign:'center', position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', inset:0, background:'linear-gradient(135deg,rgba(99,102,241,.12) 0%,rgba(139,92,246,.08) 50%,rgba(236,72,153,.06) 100%)' }}/>
        <div style={{ position:'relative', maxWidth:700, margin:'0 auto' }}>
          <FadeSection>
            <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'clamp(30px,5vw,56px)', fontWeight:800, lineHeight:1.1, marginBottom:20 }}>
              Ready to transform<br/>how you work?
            </div>
            <div style={{ fontSize:16, color:'rgba(255,255,255,.55)', marginBottom:40, lineHeight:1.7 }}>
              Join ThingsAlive NeoX and manage your entire business from one powerful platform.
            </div>
            <button onClick={()=>navigate('/auth?mode=signup')}
              style={{ padding:'18px 48px', borderRadius:16, border:'none', background:'linear-gradient(135deg,#6366f1,#8b5cf6,#ec4899)', color:'#fff', fontWeight:800, fontSize:18, cursor:'pointer', fontFamily:'inherit', boxShadow:'0 24px 60px rgba(99,102,241,.4)', transition:'all .2s' }}
              onMouseEnter={e=>{ e.target.style.transform='translateY(-3px)'; e.target.style.boxShadow='0 32px 70px rgba(99,102,241,.5)' }}
              onMouseLeave={e=>{ e.target.style.transform='none'; e.target.style.boxShadow='0 24px 60px rgba(99,102,241,.4)' }}>
              Get Started Free →
            </button>
          </FadeSection>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ borderTop:'1px solid rgba(255,255,255,.06)', padding:'40px 40px', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:16 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:30, height:30, borderRadius:8, background:'linear-gradient(135deg,#6366f1,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15 }}>⚡</div>
          <span style={{ fontFamily:"'Playfair Display',serif", fontWeight:700, fontSize:16 }}>ThingsAlive <span style={{ color:'#818cf8' }}>NeoX</span></span>
        </div>
        <div style={{ fontSize:13, color:'rgba(255,255,255,.3)' }}>© {new Date().getFullYear()} ThingsAlive NeoX. Manage Everything. From One Place.</div>
        <div style={{ display:'flex', gap:16 }}>
          <button onClick={()=>navigate('/auth')} style={{ background:'none', border:'none', color:'rgba(255,255,255,.4)', fontSize:13, cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>Sign In</button>
          <button onClick={()=>navigate('/auth?mode=signup')} style={{ background:'none', border:'none', color:'#818cf8', fontSize:13, cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>Get Started</button>
        </div>
      </footer>
    </div>
  )
}
