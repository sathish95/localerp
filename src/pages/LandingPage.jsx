import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, rupee } from '../lib/supabase'
import { checkPromoCode, submitPromoterApplication } from '../lib/vendors'
import { useAppName } from '../context/BrandingContext'

/* ── design tokens ── */
const C = {
  bg: '#030304',
  ink: '#f5f5f7',
  muted: 'rgba(245,245,247,.56)',
  faint: 'rgba(245,245,247,.34)',
  border: 'rgba(255,255,255,.09)',
  panel: 'rgba(255,255,255,.035)',
  violet: '#8b5cf6',
  violetSoft: '#c4b5fd',
  cyan: '#22d3ee',
  cyanSoft: '#a5f3fc',
  pink: '#ec4899',
  mono: "'JetBrains Mono', ui-monospace, monospace",
  sans: "'Plus Jakarta Sans', sans-serif",
}
const GRAD_TEXT = `linear-gradient(100deg, ${C.ink} 0%, ${C.violetSoft} 35%, ${C.cyanSoft} 65%, ${C.pink} 100%)`

/* ── helpers ── */
const fadeIn = (delay=0) => ({ opacity:0, animation:`fadeUp .7s cubic-bezier(.16,1,.3,1) ${delay}s forwards` })

function useOnScreen(ref) {
  const [vis, setVis] = useState(false)
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if(e.isIntersecting) setVis(true) }, { threshold:.15 })
    if(ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])
  return vis
}

function FadeSection({ children, delay=0, style={}, className }) {
  const ref = useRef(); const vis = useOnScreen(ref)
  return (
    <div ref={ref} className={className} style={{ transition:`opacity .8s cubic-bezier(.16,1,.3,1) ${delay}s, transform .8s cubic-bezier(.16,1,.3,1) ${delay}s`, opacity:vis?1:0, transform:vis?'none':'translateY(24px)', ...style }}>
      {children}
    </div>
  )
}

function scrollTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior:'smooth', block:'start' })
}

/* ── mono eyebrow label ── */
const Eyebrow = ({ children, color=C.violetSoft, style={} }) => (
  <div style={{ fontFamily:C.mono, fontSize:11, fontWeight:600, letterSpacing:'.16em', textTransform:'uppercase', color, marginBottom:14, display:'flex', alignItems:'center', gap:8, ...style }}>{children}</div>
)

const Pill = ({ color=C.violet, children }) => (
  <span style={{ padding:'5px 14px', borderRadius:8, background:`${color}16`, color, fontSize:12.5, fontWeight:700, border:`1px solid ${color}30`, fontFamily:C.mono, letterSpacing:'.02em' }}>{children}</span>
)

/* ── feature card (glass, glow-on-hover via CSS class) ── */
function FeatureCard({ icon, title, desc, color, delay=0, wide=false }) {
  const ref = useRef(); const vis = useOnScreen(ref)
  return (
    <div ref={ref} className="nx-card" style={{ gridColumn: wide ? 'span 2' : 'span 1', '--glow':color, padding:'26px 24px', transition:`opacity .6s ease ${delay}s, transform .6s ease ${delay}s`, opacity:vis?1:0, transform:vis?'none':'translateY(18px)' }}>
      <div style={{ width:44, height:44, borderRadius:12, background:`${color}1f`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, marginBottom:16 }}>{icon}</div>
      <div style={{ fontWeight:800, fontSize:16.5, color:C.ink, marginBottom:7, letterSpacing:'-.01em' }}>{title}</div>
      <div style={{ fontSize:13.5, color:C.muted, lineHeight:1.6 }}>{desc}</div>
    </div>
  )
}

/* ── stat counter ── */
function StatNum({ n, suffix='', label }) {
  const [count, setCount] = useState(0)
  const ref = useRef(); const vis = useOnScreen(ref)
  useEffect(() => {
    if (!vis) return
    let start = 0; const end = parseInt(n); const dur = 1400; const step = end/dur*16
    const t = setInterval(() => { start = Math.min(start+step, end); setCount(Math.floor(start)); if(start>=end) clearInterval(t) }, 16)
    return () => clearInterval(t)
  }, [vis, n])
  return (
    <div ref={ref} style={{ textAlign:'center' }}>
      <div style={{ fontSize:44, fontWeight:800, color:C.ink, fontFamily:C.sans, letterSpacing:'-.03em', lineHeight:1 }}>{count.toLocaleString()}{suffix}</div>
      <div style={{ fontSize:12.5, color:C.faint, marginTop:9, fontWeight:600, fontFamily:C.mono, letterSpacing:'.04em', textTransform:'uppercase' }}>{label}</div>
    </div>
  )
}

/* ── FAQ accordion item ── */
function FAQItem({ q, a, open, onClick }) {
  return (
    <div style={{ borderBottom:`1px solid ${C.border}` }}>
      <button onClick={onClick} style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', gap:16, padding:'21px 2px', background:'none', border:'none', cursor:'pointer', textAlign:'left', fontFamily:'inherit' }}>
        <span style={{ fontWeight:700, fontSize:15.5, color:C.ink, letterSpacing:'-.01em' }}>{q}</span>
        <span style={{ fontSize:18, color:C.cyan, flexShrink:0, transition:'transform .25s', transform:open?'rotate(45deg)':'none', fontFamily:C.mono }}>+</span>
      </button>
      <div style={{ maxHeight:open?300:0, overflow:'hidden', transition:'max-height .35s ease' }}>
        <div style={{ padding:'0 2px 21px', fontSize:14, color:C.muted, lineHeight:1.7 }}>{a}</div>
      </div>
    </div>
  )
}

/* ── interactive AI demos — client-side simulation only, for every one of
   the five REAL AI features shipped in the authenticated app (Neo Task AI,
   BOM Generator, Product Catalog AI, prompt-based Task Actions, Scenario AI
   — all live in src/lib/{llm,bomAI,productAI,workflowAI,scenarioAI}.js). No
   real DeepSeek/Gemini
   call happens here: those API keys are only ever used server-side inside
   the authenticated app, never exposed to an anonymous landing-page
   visitor. Every panel is labeled "Simulated preview" so this never reads
   as a live model call — but unlike a mockup, it's simulating something
   that genuinely ships, not a roadmap promise. ── */
const AI_CAPS = [
  {
    id:'neo-task', label:'Neo Task AI', icon:'✨', color:'#8b5cf6',
    eyebrow:'01 // NEO TASK AI',
    heading:'Upload a requirement doc.\nWalk away with a sprint plan.',
    description:'Neo Task AI reads your requirement document and generates user stories, a prioritized backlog, task breakdowns, test cases, API specs and a ready sprint plan — powered by DeepSeek V3 and Gemini 2.5 Pro.',
    tags:['Stories','Backlog','Tasks','Test Cases','APIs','Sprint Plan'],
    prompts:['Add a customer loyalty points system','Build a vendor performance scorecard','Create a warranty claim self-service flow'],
    steps:['Parsing requirement…','Extracting user stories…','Prioritizing backlog…','Breaking down tasks…','Drafting test cases…','Building sprint plan…'],
    placeholder:'Describe a feature to add…',
    resultKind:'counts',
    resultItems:[
      { label:'User Stories generated', icon:'◎', base:18 },
      { label:'Backlog items prioritized', icon:'☰', base:32 },
      { label:'Tasks broken down', icon:'⊞', base:54 },
      { label:'Test cases drafted', icon:'✓', base:27 },
      { label:'API endpoints specified', icon:'⌁', base:11 },
    ],
  },
  {
    id:'bom-ai', label:'BOM Generator', icon:'🧩', color:'#22d3ee',
    eyebrow:'02 // BOM GENERATOR',
    heading:'Describe the product.\nGet a matched Bill of Materials.',
    description:'The BOM Generator matches your description against your real Products & Components catalog and drafts quantities. It only ever selects parts that already exist — anything it can’t match is flagged separately, never invented.',
    tags:['Catalog Match Only','Quantities','Version Draft','Zero Invented Parts'],
    prompts:['A WiFi temperature & humidity sensor with enclosure and battery','A 4-port industrial PoE gateway','A solar-powered soil moisture logger'],
    steps:['Reading description…','Matching catalog parts…','Estimating quantities…','Flagging unmatched parts…'],
    placeholder:'Describe what the product is made of…',
    resultKind:'list',
    resultItems:[
      { name:'Microcontroller Module', qty:1 },
      { name:'Humidity & Temp Sensor', qty:1 },
      { name:'ABS Enclosure (IP65)', qty:1 },
      { name:'Li-ion Battery Pack 3.7V', qty:1 },
      { name:'Antenna, WiFi 2.4GHz', qty:1 },
    ],
  },
  {
    id:'product-ai', label:'Product Catalog AI', icon:'📦', color:'#f59e0b',
    eyebrow:'03 // PRODUCT CATALOG AI',
    heading:'Describe the product.\nGet a ready catalog entry.',
    description:'Product Catalog AI drafts a full catalog entry — device type, warranty, reorder thresholds and an estimated cost — pre-filling the same form you’d fill in by hand, ready to review before it saves.',
    tags:['Device Type','Warranty','Reorder Levels','Est. Cost'],
    prompts:['A rugged outdoor GPS tracker for fleet vehicles','An indoor air-quality monitor with CO2 sensing','A smart water flow meter for irrigation'],
    steps:['Reading description…','Classifying device type…','Estimating cost & warranty…','Drafting catalog entry…'],
    placeholder:'Describe the product…',
    resultKind:'fields',
    resultItems:[
      { label:'Device Type', value:'GPS Tracker' },
      { label:'Warranty', value:'24 months' },
      { label:'Reorder Level / Qty', value:'5 / 10' },
      { label:'Est. Standard Cost', value:'₹3,200' },
    ],
  },
  {
    id:'task-actions', label:'Task Actions', icon:'⚡', color:'#ec4899',
    eyebrow:'04 // PROMPT-BASED TASK ACTIONS',
    heading:'Type an instruction.\nReview it, then confirm.',
    description:'Create tasks or update their status with a plain-language instruction. The AI only ever proposes an action — nothing is created or changed in your workspace until you review a confirm card and click.',
    tags:['Create Task','Status Update','Confirm Required','Zero Silent Writes'],
    prompts:['Create a task to fix the login bug, assign to Priya, high priority, due Friday','Mark "Fix login bug" as done'],
    steps:['Parsing instruction…','Resolving assignee…','Matching existing task…','Preparing confirm card…'],
    placeholder:'Type an instruction…',
    resultKind:'confirm',
    resultItems:[
      { label:'Task', value:'Fix login bug' },
      { label:'Assignee', value:'Priya Sharma' },
      { label:'Priority', value:'High' },
      { label:'Due', value:'Fri, 7 Aug' },
    ],
  },
  {
    id:'scenario-ai', label:'Scenario AI', icon:'🧭', color:'#a78bfa',
    eyebrow:'05 // SCENARIO AI',
    heading:'Describe the decision.\nGet a drafted what-if scenario.',
    description:'Scenario AI reads a plain-English description of a business decision and drafts the objective, category, starting assumptions and key risks — ready for you to link real projects and budgets, run a simulation, and route through approval before anything is final.',
    tags:['Objective','Category','Assumptions','Key Risks'],
    prompts:['Expand into APAC next quarter with a 4-person local sales team','Cut cloud infrastructure spend by 20% this year','Launch a new subscription tier for enterprise customers'],
    steps:['Reading the situation…','Drafting objective…','Suggesting starting assumptions…','Flagging key risks…'],
    placeholder:'Describe a business situation…',
    resultKind:'fields',
    resultItems:[
      { label:'Objective', value:'Evaluate APAC market entry ROI' },
      { label:'Category', value:'Expansion' },
      { label:'Key Assumption', value:'Expected Revenue: ₹50L' },
      { label:'Top Risk', value:'Local hiring timeline' },
    ],
  },
]

function AIDemoPanel({ cap }) {
  const [input, setInput] = useState('')
  const [stage, setStage] = useState('idle') // idle | thinking | done
  const [stepIdx, setStepIdx] = useState(0)
  const [results, setResults] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => () => clearInterval(timerRef.current), [])
  useEffect(() => { clearInterval(timerRef.current); setStage('idle'); setInput(''); setStepIdx(0); setResults(null) }, [cap.id])

  function run(text) {
    const val = (text ?? input).trim()
    if (!val || stage === 'thinking') return
    setInput(val)
    setStage('thinking')
    setStepIdx(0)
    let i = 0
    timerRef.current = setInterval(() => {
      i++
      if (i >= cap.steps.length) {
        clearInterval(timerRef.current)
        if (cap.resultKind === 'counts') {
          setResults(cap.resultItems.map(r => ({ ...r, n: Math.max(3, r.base + Math.floor(Math.random()*7)-3) })))
        } else {
          setResults(cap.resultItems)
        }
        setStage('done')
      } else {
        setStepIdx(i)
      }
    }, 480)
  }

  function reset() {
    clearInterval(timerRef.current)
    setStage('idle'); setInput(''); setStepIdx(0); setResults(null)
  }

  const statusLabel = stage==='thinking' ? 'GENERATING…' : stage==='done' ? 'RESULT' : `TRY_${cap.id.replace(/-/g,'_').toUpperCase()}`

  return (
    <div className="nx-card" style={{ '--glow':cap.color, padding:22 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16, fontSize:11, color:C.faint, fontWeight:700, fontFamily:C.mono, letterSpacing:'.06em' }}>
        <span style={{ width:7, height:7, borderRadius:'50%', background: stage==='thinking' ? '#f59e0b' : '#10b981', boxShadow:`0 0 6px ${stage==='thinking'?'#f59e0b':'#10b981'}` }}/>
        {statusLabel}
      </div>

      {stage !== 'done' && (
        <>
          <div style={{ display:'flex', gap:7, flexWrap:'wrap', marginBottom:13 }}>
            {cap.prompts.map(p => (
              <button key={p} disabled={stage==='thinking'} onClick={()=>run(p)}
                style={{ padding:'6px 12px', borderRadius:8, border:`1px solid ${cap.color}40`, background:`${cap.color}14`, color:cap.color, fontSize:11, fontWeight:600, cursor: stage==='thinking'?'default':'pointer', fontFamily:'inherit' }}>
                {p}
              </button>
            ))}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <input value={input} disabled={stage==='thinking'} onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>e.key==='Enter' && run()}
              placeholder={cap.placeholder}
              style={{ flex:1, padding:'11px 14px', borderRadius:10, border:`1px solid ${C.border}`, background:'rgba(255,255,255,.04)', color:C.ink, fontSize:13, fontFamily:'inherit', outline:'none' }}/>
            <button className="nx-btn-primary" disabled={stage==='thinking' || !input.trim()} onClick={()=>run()} style={{ padding:'11px 18px', fontSize:13, opacity: (stage==='thinking'||!input.trim())?.6:1 }}>
              {stage==='thinking' ? '···' : 'Run'}
            </button>
          </div>
          {stage==='thinking' && (
            <div style={{ marginTop:18 }}>
              {cap.steps.map((s,i) => (
                <div key={s} style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 0', fontSize:12.5, color: i<stepIdx ? '#6ee7b7' : i===stepIdx ? C.ink : C.faint, transition:'color .2s' }}>
                  <span style={{ width:14, textAlign:'center', flexShrink:0 }}>{i<stepIdx ? '✓' : i===stepIdx ? '◐' : '·'}</span>
                  {s}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {stage==='done' && results && (
        <>
          <div style={{ fontSize:12, color:C.muted, marginBottom:14, fontStyle:'italic', lineHeight:1.5 }}>"{input}"</div>

          {cap.resultKind==='counts' && results.map((r,i)=>(
            <div key={r.label} style={{ display:'flex', alignItems:'center', gap:13, padding:'10px 0', borderTop:i>0?`1px solid ${C.border}`:'none' }}>
              <div style={{ width:32, height:32, borderRadius:9, background:`${cap.color}22`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, color:cap.color, flexShrink:0 }}>{r.icon}</div>
              <div style={{ flex:1, fontSize:12.5, color:C.muted }}>{r.label}</div>
              <div style={{ fontWeight:800, fontSize:14.5, color:C.ink, fontFamily:C.mono }}>{r.n}</div>
            </div>
          ))}

          {cap.resultKind==='list' && (
            <>
              <div style={{ fontSize:10.5, color:C.faint, fontFamily:C.mono, marginBottom:8, letterSpacing:'.04em' }}>MATCHED FROM YOUR CATALOG</div>
              {results.map((r,i)=>(
                <div key={r.name} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 0', borderTop:i>0?`1px solid ${C.border}`:'none' }}>
                  <span style={{ color:'#6ee7b7', fontWeight:800, fontSize:13, flexShrink:0 }}>✓</span>
                  <span style={{ flex:1, fontSize:12.5, color:C.muted }}>{r.name}</span>
                  <span style={{ fontWeight:800, fontSize:12.5, color:C.ink, fontFamily:C.mono }}>×{r.qty}</span>
                </div>
              ))}
            </>
          )}

          {cap.resultKind==='fields' && results.map((r,i)=>(
            <div key={r.label} style={{ display:'flex', alignItems:'center', gap:13, padding:'9px 0', borderTop:i>0?`1px solid ${C.border}`:'none' }}>
              <div style={{ flex:1, fontSize:12, color:C.faint, fontFamily:C.mono, textTransform:'uppercase', letterSpacing:'.03em' }}>{r.label}</div>
              <div style={{ fontWeight:700, fontSize:13, color:C.ink }}>{r.value}</div>
            </div>
          ))}

          {cap.resultKind==='confirm' && (
            <div style={{ border:`1px dashed ${cap.color}50`, borderRadius:10, padding:14 }}>
              {results.map((r,i)=>(
                <div key={r.label} style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 0', fontSize:12.5 }}>
                  <span style={{ color:C.faint, fontFamily:C.mono, fontSize:11, width:70, flexShrink:0 }}>{r.label.toUpperCase()}</span>
                  <span style={{ fontWeight:700, color:C.ink }}>{r.value}</span>
                </div>
              ))}
              <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid ${C.border}`, fontSize:11, color:'#6ee7b7', display:'flex', alignItems:'center', gap:6 }}>
                <span>🔒</span> Nothing is created until a human clicks Confirm
              </div>
            </div>
          )}

          <button className="nx-btn-ghost" onClick={reset} style={{ marginTop:16, padding:'9px 16px', fontSize:12, width:'100%' }}>↻ Try another prompt</button>
        </>
      )}

      <div style={{ marginTop:15, fontSize:9.5, color:C.faint, textAlign:'center', fontFamily:C.mono, letterSpacing:'.02em' }}>SIMULATED PREVIEW · SIGN UP TO RUN THIS FOR REAL</div>
    </div>
  )
}

function AISuiteDemo() {
  const [activeCap, setActiveCap] = useState(AI_CAPS[0].id)
  const cap = AI_CAPS.find(c => c.id === activeCap) || AI_CAPS[0]

  return (
    <div>
      <div style={{ display:'flex', gap:9, marginBottom:36, overflowX:'auto', paddingBottom:4, justifyContent:'center', flexWrap:'wrap' }}>
        {AI_CAPS.map(c => {
          const on = c.id === activeCap
          return (
            <button key={c.id} onClick={()=>setActiveCap(c.id)}
              style={{ display:'flex', alignItems:'center', gap:9, padding:'8px 18px 8px 8px', borderRadius:12, border:`1px solid ${on?c.color+'80':C.border}`, cursor:'pointer', fontFamily:'inherit', fontWeight:700, fontSize:12.5, whiteSpace:'nowrap',
                background:on?`${c.color}14`:'rgba(255,255,255,.02)', boxShadow:on?`0 0 0 1px ${c.color}30, 0 12px 30px -14px ${c.color}70`:'none',
                color:on?C.ink:C.muted }}>
              <span style={{ width:26, height:26, borderRadius:8, background:on?`linear-gradient(135deg,${c.color},${c.color}99)`:'rgba(255,255,255,.05)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13 }}>{c.icon}</span>
              {c.label}
            </button>
          )
        })}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1.1fr 1fr', gap:56, alignItems:'center' }} className="nx-split-grid">
        <FadeSection key={cap.id}>
          <Eyebrow color={cap.color}>{cap.eyebrow}</Eyebrow>
          <Pill color={cap.color}>{cap.icon} {cap.label}</Pill>
          <div style={{ fontSize:'clamp(24px,3.4vw,38px)', fontWeight:800, marginTop:18, marginBottom:18, lineHeight:1.12, letterSpacing:'-.03em', whiteSpace:'pre-line' }}>
            {cap.heading}
          </div>
          <div style={{ fontSize:15, color:C.muted, lineHeight:1.75, marginBottom:26 }}>
            {cap.description}
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:22 }}>
            {cap.tags.map(t=>(
              <span key={t} style={{ padding:'5px 13px', borderRadius:7, background:`${cap.color}1a`, border:`1px solid ${cap.color}40`, fontSize:11.5, fontWeight:700, color:cap.color, fontFamily:C.mono }}>{t}</span>
            ))}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:12.5, color:C.faint, fontFamily:C.mono }}>
            <span style={{ animation:'float 2s ease infinite' }}>↴</span> TRY IT — TYPE A PROMPT
          </div>
        </FadeSection>
        <FadeSection key={cap.id+'-demo'} delay={.1}>
          <AIDemoPanel cap={cap} />
        </FadeSection>
      </div>
    </div>
  )
}

/* ── floating AI chat bubble — a persistent launcher (bottom-right, every
   scroll position) that maps to the exact same 4 capabilities as the
   inline AI Suite section above, via the same AI_CAPS config and
   AIDemoPanel component. Two entry points into identical content by
   design: a visitor who scrolls past the inline section still has the
   bubble as a standing invitation to try it. ── */
// Simple client-side keyword-overlap match against the real FAQS content
// below — not a model call (no AI is reachable for an anonymous visitor),
// so this is framed as "Search our FAQ", never as an AI answering freely.
function matchFAQ(query) {
  const q = query.toLowerCase().trim()
  if (!q) return null
  const qWords = q.split(/\s+/).filter(w => w.length > 2)
  let best = null, bestScore = 0
  FAQS.forEach(f => {
    const hay = (f.q + ' ' + f.a).toLowerCase()
    const score = qWords.filter(w => hay.includes(w)).length
    if (score > bestScore) { bestScore = score; best = f }
  })
  return bestScore > 0 ? best : null
}

function AskPanel() {
  const [q, setQ] = useState('')
  const [asked, setAsked] = useState('')
  const [answer, setAnswer] = useState(null)

  function ask(text) {
    const val = (text ?? q).trim()
    if (!val) return
    setAsked(val); setQ('')
    setAnswer(matchFAQ(val))
  }

  return (
    <div>
      <div style={{ fontSize:12.5, color:C.muted, lineHeight:1.6, marginBottom:14 }}>
        Ask about pricing, security, trials, or anything about the platform — or pick a question below.
      </div>
      <div style={{ display:'flex', gap:8, marginBottom:14 }}>
        <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter' && ask()}
          placeholder="e.g. Is my data isolated from other companies?"
          style={{ flex:1, padding:'11px 14px', borderRadius:10, border:`1px solid ${C.border}`, background:'rgba(255,255,255,.04)', color:C.ink, fontSize:13, fontFamily:'inherit', outline:'none' }}/>
        <button className="nx-btn-primary" disabled={!q.trim()} onClick={()=>ask()} style={{ padding:'11px 16px', fontSize:13, opacity:q.trim()?1:.6 }}>Ask</button>
      </div>

      {asked && (
        <div className="nx-card" style={{ '--glow':answer?'#10b981':'#f59e0b', padding:14, marginBottom:14 }}>
          <div style={{ fontSize:11.5, color:C.faint, fontStyle:'italic', marginBottom:8 }}>"{asked}"</div>
          {answer ? (
            <>
              <div style={{ fontWeight:700, fontSize:13, marginBottom:6 }}>{answer.q}</div>
              <div style={{ fontSize:12.5, color:C.muted, lineHeight:1.6 }}>{answer.a}</div>
            </>
          ) : (
            <div style={{ fontSize:12.5, color:C.muted, lineHeight:1.6 }}>
              Couldn't find a close match in our FAQ — try one of the questions below, or <button onClick={()=>scrollTo('faq')} style={{ background:'none', border:'none', color:C.cyan, fontWeight:700, cursor:'pointer', fontFamily:'inherit', padding:0, fontSize:12.5 }}>browse the full FAQ</button>.
            </div>
          )}
        </div>
      )}

      <div style={{ fontSize:10.5, color:C.faint, fontFamily:C.mono, letterSpacing:'.04em', marginBottom:8 }}>COMMON QUESTIONS</div>
      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
        {FAQS.map(f => (
          <button key={f.q} onClick={()=>ask(f.q)}
            style={{ textAlign:'left', padding:'9px 12px', borderRadius:9, border:`1px solid ${C.border}`, background:'rgba(255,255,255,.03)', color:C.muted, fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>
            {f.q}
          </button>
        ))}
      </div>
    </div>
  )
}

const BUBBLE_TABS = [{ id:'ask', label:'Ask', icon:'💬', color:'#10b981' }, ...AI_CAPS]

function AIChatBubble() {
  const [open, setOpen] = useState(false)
  const [activeCap, setActiveCap] = useState('ask')
  const cap = AI_CAPS.find(c => c.id === activeCap) || null

  return (
    <>
      <button onClick={()=>setOpen(o=>!o)} aria-label={open ? 'Close AI chat' : 'Open AI chat'}
        style={{ position:'fixed', bottom:24, right:24, zIndex:310, width:58, height:58, borderRadius:'50%', cursor:'pointer',
          background: open ? 'rgba(20,20,26,.95)' : 'linear-gradient(135deg,#8b5cf6,#22d3ee)', border: open ? `1px solid ${C.border}` : 'none',
          display:'flex', alignItems:'center', justifyContent:'center', fontSize:22,
          boxShadow: open ? 'none' : '0 12px 34px -8px rgba(139,92,246,.6)', transition:'all .25s' }}>
        {open ? <span style={{ color:C.ink }}>✕</span> : '✨'}
        {!open && <span style={{ position:'absolute', top:-2, right:-2, width:13, height:13, borderRadius:'50%', background:'#10b981', border:'2px solid #030304' }}/>}
      </button>

      {open && (
        <div style={{ position:'fixed', bottom:92, right:16, left:16, zIndex:305, width:380, maxWidth:'calc(100vw - 32px)', marginLeft:'auto', maxHeight:'min(640px, 75vh)', display:'flex', flexDirection:'column',
          background:'rgba(8,8,12,.92)', backdropFilter:'blur(20px)', border:`1px solid ${C.border}`, borderRadius:20, boxShadow:'0 30px 80px -20px rgba(0,0,0,.7)', overflow:'hidden' }}>

          <div style={{ padding:'16px 18px', borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:3 }}>
              <div style={{ width:26, height:26, borderRadius:8, background:'linear-gradient(135deg,#8b5cf6,#22d3ee)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, flexShrink:0 }}>✨</div>
              <div style={{ fontWeight:800, fontSize:14.5 }}>NeoX AI</div>
            </div>
            <div style={{ fontSize:11.5, color:C.faint, marginLeft:35 }}>Ask about the platform, or try a real feature.</div>
          </div>

          <div style={{ display:'flex', gap:6, padding:'12px 14px', borderBottom:`1px solid ${C.border}`, overflowX:'auto', flexShrink:0 }}>
            {BUBBLE_TABS.map(c => {
              const on = c.id === activeCap
              return (
                <button key={c.id} onClick={()=>setActiveCap(c.id)}
                  style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 11px', borderRadius:9, border:`1px solid ${on?c.color+'80':C.border}`, cursor:'pointer', fontFamily:'inherit', fontWeight:700, fontSize:11, whiteSpace:'nowrap', flexShrink:0,
                    background:on?`${c.color}1c`:'rgba(255,255,255,.03)', color:on?C.ink:C.muted }}>
                  <span>{c.icon}</span>{c.label}
                </button>
              )
            })}
          </div>

          <div style={{ padding:16, overflowY:'auto', flex:1 }}>
            {activeCap==='ask' ? <AskPanel /> : (
              <>
                <div style={{ fontSize:12, color:C.muted, lineHeight:1.55, marginBottom:14 }}>{cap.description}</div>
                <AIDemoPanel cap={cap} />
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

/* ── the real feature suites ── */
const SUITES = [
  {
    id:'finance', label:'Finance & Expenses', icon:'💰', color:'#8b5cf6',
    blurb:'Every rupee tracked from request to reconciliation.',
    features:[
      { icon:'🧾', title:'Expense Management', desc:'Multi-step role-based approval chains with budget tracking and receipt uploads.', wide:true },
      { icon:'✈️', title:'Travel Requests', desc:'Submit and approve travel with cost estimates linked to project budgets.' },
      { icon:'📊', title:'Budget & Revisions', desc:'Department and project budgets with real-time utilization and revision history.' },
      { icon:'📄', title:'Customer Invoicing', desc:'Invoice customers, track payments, and monitor aging receivables.' },
      { icon:'🏦', title:'Fund Flow', desc:'Vendor payment tracking with full cash-flow visibility.' },
      { icon:'📈', title:'Profit Margins', desc:'Actual-vs-planned profit attribution per project and per sale.' },
    ],
    ai:'Ask the Data Assistant "what\'s pending?" or "spend this month?" — live answers, no report to run.',
  },
  {
    id:'procurement', label:'Procurement & Inventory', icon:'📦', color:'#22d3ee',
    blurb:'From purchase request to warranty claim — one continuous chain.',
    features:[
      { icon:'🛒', title:'Purchase Requisitions', desc:'Structured PR → PO → GRN workflow with multi-step approvals.', wide:true },
      { icon:'🏪', title:'Vendor Management', desc:'Onboard vendors, track ratings, and manage component-vendor mapping.' },
      { icon:'🧩', title:'BOM Generator (AI)', desc:'Describe a product and the AI drafts its Bill of Materials, matched only against parts you already have.' },
      { icon:'📦', title:'Product Catalog AI', desc:'Describe a product and get a ready catalog entry — device type, warranty, reorder levels, cost estimate.' },
      { icon:'🏭', title:'Inventory Ledger', desc:'Component and device stock, with serialized device records.' },
      { icon:'🛡️', title:'Warranty & Claims', desc:'Depreciation tiers, claim approval chains, finance integration.' },
      { icon:'🔎', title:'Spend Analyzer', desc:'Category, vendor, product and department spend with forecasting.' },
    ],
    ai:'The BOM Generator and Product Catalog AI draft from a description — matched to your real catalog, never invented — plus the Data Assistant for pending PRs and spend, on demand.',
  },
  {
    id:'projects', label:'Projects, Tasks & AI', icon:'🚀', color:'#f59e0b',
    blurb:'Plan, execute, and let AI handle the requirement analysis.',
    features:[
      { icon:'✨', title:'Neo Task AI', desc:'Upload a requirement doc — AI generates stories, tasks, test cases, APIs and a sprint plan.', wide:true },
      { icon:'📁', title:'Project Management', desc:'Milestones, timelines, planned budgets and resource forecasts.' },
      { icon:'⊞', title:'Task & Sprint Boards', desc:'Kanban, sprints, stories and backlog — the full agile toolkit.' },
      { icon:'⚡', title:'Prompt-Based Task Actions', desc:'Create a task or change its status with plain language — always a confirm step before anything saves.' },
      { icon:'👥', title:'Resource Allocation', desc:'Skill matrix, capacity and bench utilization across every project.' },
      { icon:'💬', title:'Team Chat', desc:'Direct and group messaging built into the same workspace.' },
      { icon:'📚', title:'Knowledge Base', desc:'Searchable internal documentation with AI-assisted answers.' },
    ],
    ai:'Neo Task AI turns a requirement doc into a full plan; prompt-based Task Actions create or update tasks from plain language — you confirm before anything saves.',
  },
  {
    id:'sales', label:'Sales & Marketing CRM', icon:'📣', color:'#ec4899',
    blurb:'Every lead, tender and campaign — one funnel to close.',
    features:[
      { icon:'🎯', title:'Leads & Opportunities', desc:'Public lead-capture forms feed a pipeline that converts straight into proposals.', wide:true },
      { icon:'📝', title:'Proposal Builder', desc:'Cost-linked proposals with an approval chain, tied to real project budgets.' },
      { icon:'🏛️', title:'Tenders & Pilots', desc:'Track tenders, pilot projects and bootstrap programs through to conversion.' },
      { icon:'📅', title:'Meeting Booking', desc:'Shareable public booking pages for prospects to self-schedule.' },
      { icon:'📣', title:'Campaigns', desc:'Marketing campaigns with lead attribution back to the sales pipeline.' },
      { icon:'🖼️', title:'Landing Page Builder', desc:'Drag-and-drop landing pages with a live theme editor.' },
    ],
  },
  {
    id:'people', label:'People & Performance', icon:'👥', color:'#10b981',
    blurb:'From leave requests to calibrated performance reviews.',
    features:[
      { icon:'🗓️', title:'Leave Management', desc:'Policies, balances, and check-in/out tracking per employee.', wide:true },
      { icon:'⏱️', title:'Timesheets', desc:'Time entry with a manager approval workflow.' },
      { icon:'🎯', title:'Performance Cycles', desc:'Review cycles, team reviews and calibration sessions.' },
      { icon:'🏆', title:'Awards & Recognition', desc:'Celebrate wins with awards surfaced right on the company homepage.' },
      { icon:'📈', title:'Skill Matrix', desc:'Track skills and certifications against project resourcing needs.' },
      { icon:'📊', title:'Performance Dashboard', desc:'Manager and HR-level rollups of every review cycle.' },
    ],
    ai:'Headcount, pending leave, active employees — the Data Assistant answers HR questions in plain language.',
  },
  {
    id:'platform', label:'Platform & Governance', icon:'🛡️', color:'#818cf8',
    blurb:'Multi-tenant by design, with the controls to prove it.',
    features:[
      { icon:'🏢', title:'Multi-Tenant Workspaces', desc:'Every organization’s data is isolated at the database layer via row-level security.', wide:true },
      { icon:'🔑', title:'Role-Based Access', desc:'Built-in roles plus unlimited custom roles, with configurable module visibility.' },
      { icon:'🧩', title:'Module Enablement', desc:'Turn entire modules on or off per organization — a real kill switch.' },
      { icon:'📡', title:'App & LLM Monitor', desc:'Live usage analytics and AI cost/usage tracking for admins.' },
      { icon:'🔔', title:'Realtime Notifications', desc:'Instant updates on approvals, assignments and mentions.' },
      { icon:'💳', title:'Plans & Billing', desc:'Transparent seat-based plans with self-serve upgrade requests.' },
    ],
  },
]

/* module -> owning suite color, so the wall's chips carry real category
   signal instead of being flat/uniform text */
const MODULE_WALL = [
  ['Expenses','#8b5cf6'],['Travel Requests','#8b5cf6'],['Approvals','#8b5cf6'],['Budget & Revisions','#8b5cf6'],
  ['Customer Invoicing','#8b5cf6'],['Fund Flow','#8b5cf6'],['Profit Margins','#8b5cf6'],
  ['Purchase Requisitions','#22d3ee'],['Vendor Management','#22d3ee'],['BOM & Versioning','#22d3ee'],
  ['Inventory Ledger','#22d3ee'],['Warranty & Claims','#22d3ee'],['Spend Analyzer','#22d3ee'],['GRN','#22d3ee'],
  ['Project Management','#f59e0b'],['Kanban Boards','#f59e0b'],['Sprints & Backlog','#f59e0b'],['Neo Task AI','#f59e0b'],
  ['Resource Allocation','#f59e0b'],['Team Chat','#f59e0b'],['Knowledge Base','#f59e0b'],
  ['Leads & Opportunities','#ec4899'],['Proposal Builder','#ec4899'],['Tenders & Pilots','#ec4899'],
  ['Meeting Booking','#ec4899'],['Campaigns','#ec4899'],['Landing Page Builder','#ec4899'],
  ['Leave Management','#10b981'],['Timesheets','#10b981'],['Performance Cycles','#10b981'],
  ['Awards & Recognition','#10b981'],['Skill Matrix','#10b981'],['Performance Dashboard','#10b981'],
  ['Multi-Tenant Workspaces','#818cf8'],['Role-Based Access','#818cf8'],['Module Enablement','#818cf8'],
  ['App & LLM Monitor','#818cf8'],['Realtime Notifications','#818cf8'],['Plans & Billing','#818cf8'],
]
const CATEGORY_ICON = { '#8b5cf6':'💰', '#22d3ee':'📦', '#f59e0b':'🚀', '#ec4899':'📣', '#10b981':'👥', '#818cf8':'🛡️' }

const FAQS = [
  { q:'Is my organization’s data isolated from other companies on the platform?', a:'Yes. This is a true multi-tenant platform — every table is scoped by organization at the database (row-level security) layer, not just filtered in the app. One organization can never query another’s data.' },
  { q:'Is there a free plan?', a:'Yes — the Free plan supports up to 3 seats across the core modules at no cost, no card required.' },
  { q:'How long is the trial?', a:'New organizations start on a 14-day trial. You can request a plan change any time from Settings → Billing, actioned by our team — no surprise charges.' },
  { q:'Can I invite my team?', a:'Yes. Once your organization exists, generate an invite code from Settings → Organization and share it — teammates join at the role you choose, scoped to your workspace only.' },
  { q:'What powers Neo Task AI?', a:'Neo Task AI runs on DeepSeek V3 and Gemini 2.5 Pro — upload a requirement document and it generates user stories, a backlog, tasks, test cases, API specs and a sprint plan.' },
  { q:'Can I turn off modules we don’t need?', a:'Yes — every module (Sales CRM, Warranty, Performance Management, and more) can be enabled or disabled per organization from Settings, with per-role visibility on top.' },
  { q:'Can AI change my data without me knowing?', a:'No. Every AI feature — Neo Task AI, the BOM Generator, Product Catalog AI, prompt-based Task Actions, and Scenario AI — only ever drafts a proposal. Nothing is created, changed, or saved until you review it and click confirm. There is no standalone AI write access anywhere in the platform.' },
  { q:'Do you have a referral or partner program?', a:'Yes — our promoter partners get their own dashboard, a unique referral link, and commission on every payment from organizations they refer. Some also offer a signup discount out of a seat pool we allocate them, applied automatically to whoever signs up through their link. Apply from the "Become a Promoter" section below — our team reviews every application before it goes live.' },
  { q:'I have a promo code — how do I use it?', a:'Enter it in the estimator above before signing up, or just open your signup link with ?ref=YOURCODE in the URL — the discount is tied to your organization automatically once you’re in, no extra steps.' },
]

// Public "Become a Promoter" application form — module-scope component
// (not defined inside LandingPage's body) so it never gets recreated
// on LandingPage's own re-renders, which would remount its inputs and
// drop focus mid-typing (the exact bug already fixed once in
// GlobalSearchModal this session). Plain insert into
// promoter_applications (STEP138); a super admin reviews it and, on
// approval, sets seats/discount and creates the login — nothing here
// grants any access by itself.
function PromoterApplyPanel() {
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', companyName: '', message: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.fullName.trim() || !form.email.trim()) return
    setSubmitting(true); setError('')
    try {
      await submitPromoterApplication(form)
      setSubmitted(true)
    } catch (err) { setError(err.message || 'Something went wrong — please try again.') }
    finally { setSubmitting(false) }
  }

  if (submitted) {
    return (
      <div className="nx-card" style={{ '--glow':'#10b981', padding:28, textAlign:'center' }}>
        <div style={{ fontSize:20, fontWeight:800, marginBottom:8 }}>Application received</div>
        <div style={{ fontSize:13.5, color:C.muted }}>Our team will review it and reach out at {form.email} once it's approved, with your referral link and login.</div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="nx-card" style={{ '--glow':'#8b5cf6', padding:'28px 26px', display:'grid', gap:14 }}>
      {error && <div style={{ fontSize:12.5, color:'#f59e0b' }}>{error}</div>}
      <div className="nx-signup-grid" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
        <div>
          <label style={{ fontSize:11.5, fontWeight:700, color:C.faint, display:'block', marginBottom:6 }}>Full Name *</label>
          <input value={form.fullName} onChange={e=>setForm(f=>({...f, fullName:e.target.value}))} required
            style={{ width:'100%', padding:'10px 12px', borderRadius:8, border:`1px solid ${C.border}`, background:'rgba(255,255,255,.03)', color:C.ink, fontFamily:'inherit', fontSize:13.5 }} />
        </div>
        <div>
          <label style={{ fontSize:11.5, fontWeight:700, color:C.faint, display:'block', marginBottom:6 }}>Email *</label>
          <input type="email" value={form.email} onChange={e=>setForm(f=>({...f, email:e.target.value}))} required
            style={{ width:'100%', padding:'10px 12px', borderRadius:8, border:`1px solid ${C.border}`, background:'rgba(255,255,255,.03)', color:C.ink, fontFamily:'inherit', fontSize:13.5 }} />
        </div>
      </div>
      <div className="nx-signup-grid" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
        <div>
          <label style={{ fontSize:11.5, fontWeight:700, color:C.faint, display:'block', marginBottom:6 }}>Phone</label>
          <input value={form.phone} onChange={e=>setForm(f=>({...f, phone:e.target.value}))}
            style={{ width:'100%', padding:'10px 12px', borderRadius:8, border:`1px solid ${C.border}`, background:'rgba(255,255,255,.03)', color:C.ink, fontFamily:'inherit', fontSize:13.5 }} />
        </div>
        <div>
          <label style={{ fontSize:11.5, fontWeight:700, color:C.faint, display:'block', marginBottom:6 }}>Company / Brand</label>
          <input value={form.companyName} onChange={e=>setForm(f=>({...f, companyName:e.target.value}))}
            style={{ width:'100%', padding:'10px 12px', borderRadius:8, border:`1px solid ${C.border}`, background:'rgba(255,255,255,.03)', color:C.ink, fontFamily:'inherit', fontSize:13.5 }} />
        </div>
      </div>
      <div>
        <label style={{ fontSize:11.5, fontWeight:700, color:C.faint, display:'block', marginBottom:6 }}>How do you plan to promote us?</label>
        <textarea rows={3} value={form.message} onChange={e=>setForm(f=>({...f, message:e.target.value}))}
          placeholder="Your audience, channels, expected volume…"
          style={{ width:'100%', padding:'10px 12px', borderRadius:8, border:`1px solid ${C.border}`, background:'rgba(255,255,255,.03)', color:C.ink, fontFamily:'inherit', fontSize:13.5, resize:'vertical' }} />
      </div>
      <button className="nx-btn-primary" disabled={submitting || !form.fullName.trim() || !form.email.trim()} style={{ padding:'13px 18px', fontSize:13.5, justifySelf:'start' }}>
        {submitting ? 'Submitting…' : 'Apply to Become a Promoter'}
      </button>
    </form>
  )
}

/* ══════════════════════════════════════════════════════════ */
export default function LandingPage() {
  const navigate = useNavigate()
  const appName = useAppName()
  const [announcements, setAnnouncements] = useState([])
  const [awards,        setAwards]        = useState([])
  const [news,          setNews]          = useState([])
  const [hackathon,     setHackathon]     = useState([])
  const [activeTab,     setActiveTab]     = useState('announcements')
  const [comment,       setComment]       = useState('')
  const [commentTopic,  setCommentTopic]  = useState(null)
  const [comments,      setComments]      = useState({})
  const [expandedNews,  setExpandedNews]  = useState(null)
  const [scrolled,      setScrolled]      = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [activeSuite,   setActiveSuite]   = useState(SUITES[0].id)
  const [plans,         setPlans]         = useState([])
  const [billingCycle,  setBillingCycle]  = useState('monthly')
  const [bundles,       setBundles]       = useState([])
  const [estPlanKey,    setEstPlanKey]    = useState('')
  const [estSeats,      setEstSeats]      = useState(10)
  const [estModuleKeys, setEstModuleKeys] = useState(new Set())
  const [promoCode, setPromoCode] = useState('')
  const [promoStatus, setPromoStatus] = useState(null) // { valid, discount_percent, seats_remaining, reason }
  const [promoChecking, setPromoChecking] = useState(false)
  const [openFAQ,       setOpenFAQ]       = useState(0)
  const heroRef = useRef(null)
  const [spot, setSpot] = useState({ x:50, y:40 })

  useEffect(() => {
    // Vendor referral capture (STEP134) — first-touch attribution: a
    // visitor may browse before signing up, so this is stored rather
    // than only trusting whatever URL they eventually land on /auth
    // from. AuthPage reads this same key as a fallback.
    const ref = new URLSearchParams(window.location.search).get('ref')
    if (ref) { try { localStorage.setItem('referral_code', ref) } catch {} }
    // Pre-fill the estimator's promo field with whatever ref code is
    // active (URL now, or a prior visit stored in localStorage), so a
    // visitor arriving via a partner's link sees the discount applied
    // immediately rather than needing to re-type their own code.
    let storedRef = ref
    if (!storedRef) { try { storedRef = localStorage.getItem('referral_code') } catch {} }
    if (storedRef) setPromoCode(storedRef)
    window.addEventListener('scroll', () => setScrolled(window.scrollY > 40))
    loadAll()
    return () => { window.removeEventListener('scroll', () => {}) }
  }, [])

  function onHeroMove(e) {
    const r = heroRef.current?.getBoundingClientRect()
    if (!r) return
    setSpot({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 })
  }

  async function loadAll() {
    const [ann, awd, nws, hack, pln, bnd] = await Promise.all([
      supabase.from('announcements').select('*').eq('is_active', true).order('pinned', {ascending:false}).order('created_at', {ascending:false}),
      supabase.from('awards').select('*, recipient:profiles!awarded_to(full_name)').eq('is_active', true).order('award_date', {ascending:false}).limit(6),
      supabase.from('news_posts').select('*').eq('is_published', true).order('published_at', {ascending:false}).limit(6),
      supabase.from('hackathon_topics').select('*').eq('is_active', true).order('created_at', {ascending:false}),
      supabase.from('billing_plans').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('billing_bundles').select('*').eq('is_active', true).order('sort_order'),
    ])
    setAnnouncements(ann.data || [])
    setAwards(awd.data || [])
    setNews(nws.data || [])
    setHackathon(hack.data || [])
    setPlans(pln.data || [])
    setBundles(bnd.data || [])
  }

  function toggleEstModule(key) {
    setEstModuleKeys(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  useEffect(() => {
    if (!promoCode.trim()) { setPromoStatus(null); return }
    setPromoChecking(true)
    const t = setTimeout(async () => {
      try { setPromoStatus(await checkPromoCode(promoCode.trim())) }
      catch { setPromoStatus({ valid: false, reason: 'Could not check this code' }) }
      finally { setPromoChecking(false) }
    }, 450)
    return () => clearTimeout(t)
  }, [promoCode])

  function startEstimatorSignup() {
    const p = new URLSearchParams({ mode: 'signup' })
    if (estPlanKey) p.set('plan', estPlanKey)
    if (estModuleKeys.size > 0) p.set('modules', [...estModuleKeys].join(','))
    if (promoStatus?.valid && promoCode.trim()) p.set('ref', promoCode.trim())
    navigate(`/auth?${p.toString()}`)
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

  const ANN_COLORS = { info:'#22d3ee', success:'#10b981', warning:'#f59e0b', event:'#ec4899' }
  const DIFF_COLORS = { easy:'#10b981', medium:'#f59e0b', hard:'#ef4444', expert:'#8b5cf6' }
  const suite = SUITES.find(s => s.id === activeSuite) || SUITES[0]

  const NAV_LINKS = [
    { id:'suites', label:'Features' },
    { id:'ai-spotlight', label:'AI' },
    { id:'pricing', label:'Pricing' },
    { id:'estimate', label:'Estimate' },
    { id:'become-promoter', label:'Partner With Us' },
    { id:'faq', label:'FAQ' },
  ]

  return (
    <div style={{ fontFamily:C.sans, background:C.bg, minHeight:'100vh', color:C.ink, overflowX:'hidden' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap');
        @keyframes fadeUp { from { opacity:0; transform:translateY(18px) } to { opacity:1; transform:none } }
        @keyframes float { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-10px) } }
        @keyframes pulse { 0%,100% { opacity:.35 } 50% { opacity:.7 } }
        @keyframes drift1 { 0%,100% { transform:translate(0,0) scale(1) } 50% { transform:translate(60px,-40px) scale(1.15) } }
        @keyframes drift2 { 0%,100% { transform:translate(0,0) scale(1) } 50% { transform:translate(-50px,50px) scale(1.1) } }
        @keyframes drift3 { 0%,100% { transform:translate(0,0) scale(1) } 50% { transform:translate(40px,60px) scale(.95) } }
        @keyframes shimmer { to { background-position:200% center } }
        @keyframes marquee-l { to { transform:translateX(-50%) } }
        @keyframes marquee-r { from { transform:translateX(-50%) } to { transform:translateX(0) } }
        .nx-marquee-row { display:flex; gap:10px; width:max-content; }
        .nx-marquee-row.l { animation:marquee-l 42s linear infinite; }
        .nx-marquee-row.r { animation:marquee-r 42s linear infinite; }
        .nx-marquee-viewport:hover .nx-marquee-row { animation-play-state:paused; }
        .nx-marquee-mask { mask-image:linear-gradient(90deg, transparent, black 8%, black 92%, transparent); -webkit-mask-image:linear-gradient(90deg, transparent, black 8%, black 92%, transparent); }
        ::selection { background:#8b5cf6; color:#fff }
        ::-webkit-scrollbar { width:6px } ::-webkit-scrollbar-track { background:#050507 }
        ::-webkit-scrollbar-thumb { background:#2e2a45; border-radius:3px }

        .nx-grain { position:fixed; inset:0; z-index:200; pointer-events:none; opacity:.05; mix-blend-mode:overlay;
          background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='90' height='90'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }

        .nx-card { background:${C.panel}; border-radius:18px; border:1px solid ${C.border}; backdrop-filter:blur(14px);
          transition:border-color .25s, box-shadow .25s, transform .25s; position:relative; }
        .nx-card:hover { border-color:color-mix(in srgb, var(--glow) 45%, transparent); box-shadow:0 0 0 1px color-mix(in srgb, var(--glow) 20%, transparent), 0 20px 45px -20px color-mix(in srgb, var(--glow) 55%, transparent); transform:translateY(-3px); }

        .nx-btn-primary { position:relative; overflow:hidden; background:linear-gradient(115deg,#8b5cf6,#6366f1 45%,#22d3ee); background-size:200% auto;
          border:none; border-radius:11px; color:#fff; font-weight:700; cursor:pointer; font-family:inherit; transition:box-shadow .25s, background-position .6s; }
        .nx-btn-primary:hover { background-position:100% center; box-shadow:0 14px 40px -10px rgba(139,92,246,.55); }
        .nx-btn-ghost { border-radius:11px; border:1px solid ${C.border}; background:rgba(255,255,255,.03); color:${C.ink}; font-weight:600; cursor:pointer; font-family:inherit; transition:all .2s; }
        .nx-btn-ghost:hover { border-color:rgba(255,255,255,.22); background:rgba(255,255,255,.06); }

        .nx-gradtext { background:${GRAD_TEXT}; background-size:200% auto; -webkit-background-clip:text; -webkit-text-fill-color:transparent; animation:shimmer 6s linear infinite alternate; }

        .nx-suite-tab { transition:all .2s; }
        .nx-chip:hover { background:rgba(255,255,255,.08) !important; color:${C.ink} !important; border-color:rgba(255,255,255,.16) !important; }

        @media (max-width: 860px) {
          .nx-nav-links { display:none !important }
          .nx-nav-actions { display:none !important }
          .nx-mobile-menu-btn { display:flex !important }
          .nx-split-grid { grid-template-columns:1fr !important }
          .nx-footer-grid { grid-template-columns:1fr 1fr !important }
          .nx-estimator-grid { grid-template-columns:1fr !important }
          .nx-estimator-summary { border-left:none !important; padding-left:0 !important; border-top:1px solid ${C.border}; padding-top:24px; margin-top:8px }
          .nx-signup-grid { grid-template-columns:1fr !important }
        }
        @media (max-width: 520px) {
          .nx-footer-grid { grid-template-columns:1fr !important }
        }
        @media (max-width: 640px) {
          nav { padding:0 16px !important }
        }
      `}</style>
      <div className="nx-grain" />

      {/* ── NAVBAR ── */}
      <nav style={{ position:'fixed', top:0, left:0, right:0, zIndex:100, padding:'0 40px', height:64, display:'flex', alignItems:'center', justifyContent:'space-between', background: scrolled?'rgba(3,3,4,.75)':'transparent', backdropFilter:scrolled?'blur(20px)':'none', borderBottom:scrolled?`1px solid ${C.border}`:'1px solid transparent', transition:'all .3s' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer' }} onClick={()=>window.scrollTo({top:0,behavior:'smooth'})}>
          <div style={{ width:30, height:30, borderRadius:8, background:'linear-gradient(135deg,#8b5cf6,#22d3ee)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15 }}>⚡</div>
          <div style={{ fontSize:16.5, fontWeight:800, letterSpacing:'-.02em' }}>{appName}</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:26 }}>
          <div className="nx-nav-links" style={{ display:'flex', gap:22 }}>
            {NAV_LINKS.map(l => (
              <button key={l.id} onClick={()=>scrollTo(l.id)} style={{ background:'none', border:'none', color:C.muted, fontSize:13.5, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>{l.label}</button>
            ))}
          </div>
          <div className="nx-nav-actions" style={{ display:'flex', gap:10 }}>
            <button className="nx-btn-ghost" onClick={()=>navigate('/auth')} style={{ padding:'7px 18px', fontSize:13 }}>Sign In</button>
            <button className="nx-btn-primary" onClick={()=>navigate('/auth?mode=signup')} style={{ padding:'7px 18px', fontSize:13 }}>Get Started →</button>
          </div>
          <button className="nx-mobile-menu-btn" onClick={()=>setMobileMenuOpen(o=>!o)} aria-label="Menu"
            style={{ display:'none', width:38, height:38, borderRadius:9, border:`1px solid ${C.border}`, background:'rgba(255,255,255,.03)', color:C.ink, fontSize:16, cursor:'pointer', alignItems:'center', justifyContent:'center' }}>
            {mobileMenuOpen ? '✕' : '☰'}
          </button>
        </div>
      </nav>

      {mobileMenuOpen && (
        <div className="nx-mobile-menu" style={{ position:'fixed', top:64, left:0, right:0, zIndex:99, background:'rgba(3,3,4,.97)', backdropFilter:'blur(20px)', borderBottom:`1px solid ${C.border}`, padding:'10px 20px 20px', display:'flex', flexDirection:'column', gap:2 }}>
          {NAV_LINKS.map(l => (
            <button key={l.id} onClick={()=>{ setMobileMenuOpen(false); scrollTo(l.id) }}
              style={{ textAlign:'left', background:'none', border:'none', borderBottom:`1px solid ${C.border}`, color:C.muted, fontSize:15, fontWeight:600, cursor:'pointer', fontFamily:'inherit', padding:'14px 4px' }}>
              {l.label}
            </button>
          ))}
          <div style={{ display:'flex', gap:10, marginTop:16 }}>
            <button className="nx-btn-ghost" onClick={()=>navigate('/auth')} style={{ flex:1, padding:'11px 18px', fontSize:14 }}>Sign In</button>
            <button className="nx-btn-primary" onClick={()=>navigate('/auth?mode=signup')} style={{ flex:1, padding:'11px 18px', fontSize:14 }}>Get Started →</button>
          </div>
        </div>
      )}

      {/* ── HERO ── */}
      <section ref={heroRef} onMouseMove={onHeroMove} style={{ minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', textAlign:'center', padding:'110px 24px 70px', position:'relative', overflow:'hidden' }}>
        {/* Aurora field */}
        <div style={{ position:'absolute', width:620, height:620, borderRadius:'50%', background:'radial-gradient(circle,rgba(139,92,246,.28) 0%,transparent 68%)', top:'6%', left:'12%', filter:'blur(50px)', animation:'drift1 16s ease-in-out infinite' }}/>
        <div style={{ position:'absolute', width:480, height:480, borderRadius:'50%', background:'radial-gradient(circle,rgba(34,211,238,.22) 0%,transparent 68%)', top:'32%', right:'8%', filter:'blur(45px)', animation:'drift2 20s ease-in-out infinite' }}/>
        <div style={{ position:'absolute', width:420, height:420, borderRadius:'50%', background:'radial-gradient(circle,rgba(236,72,153,.16) 0%,transparent 68%)', bottom:'4%', left:'38%', filter:'blur(45px)', animation:'drift3 18s ease-in-out infinite' }}/>
        {/* Cursor spotlight */}
        <div style={{ position:'absolute', inset:0, pointerEvents:'none', background:`radial-gradient(500px circle at ${spot.x}% ${spot.y}%, rgba(139,92,246,.10), transparent 45%)`, transition:'background .1s' }}/>
        <div style={{ position:'absolute', inset:0, backgroundImage:'radial-gradient(rgba(255,255,255,.035) 1px, transparent 1px)', backgroundSize:'34px 34px', maskImage:'radial-gradient(ellipse 70% 60% at 50% 40%, black 40%, transparent 90%)' }}/>

        <div style={{ position:'relative', maxWidth:920 }}>
          <div style={{ ...fadeIn(0), display:'inline-flex', alignItems:'center', gap:9, padding:'6px 16px 6px 8px', borderRadius:999, background:'rgba(255,255,255,.04)', border:`1px solid ${C.border}`, fontSize:12, fontWeight:600, color:C.muted, marginBottom:30, fontFamily:C.mono, letterSpacing:'.03em' }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background:C.cyan, display:'inline-block', boxShadow:`0 0 8px ${C.cyan}`, animation:'pulse 2s ease infinite' }}/>
            MULTI-TENANT · AI-NATIVE · v3.0
          </div>

          <div style={{ ...fadeIn(.08), fontSize:'clamp(38px,6.6vw,80px)', fontWeight:800, lineHeight:1.02, marginBottom:22, letterSpacing:'-.045em' }}>
            <span className="nx-gradtext">Run your whole business.</span>
            <br/>
            <span style={{ color:C.ink }}>Not a spreadsheet in sight.</span>
          </div>

          <div style={{ ...fadeIn(.16), fontSize:'clamp(14.5px,1.7vw,18px)', color:C.muted, lineHeight:1.7, maxWidth:640, margin:'0 auto 42px' }}>
            Finance, procurement, projects, sales &amp; marketing CRM, HR and performance — six integrated suites and
            an AI copilot, on a workspace isolated to your organization by design.
          </div>

          <div style={{ ...fadeIn(.28), display:'flex', gap:14, justifyContent:'center', flexWrap:'wrap', marginBottom:20 }}>
            <button className="nx-btn-primary" onClick={()=>navigate('/auth?mode=signup')} style={{ padding:'14px 30px', fontSize:15 }}>
              Start Free — No Card Required
            </button>
            <button className="nx-btn-ghost" onClick={()=>scrollTo('suites')} style={{ padding:'14px 26px', fontSize:15 }}>
              Explore Features ↓
            </button>
          </div>

          <div style={{ ...fadeIn(.34), fontFamily:C.mono, fontSize:11.5, color:C.faint, letterSpacing:'.05em', marginBottom:44 }}>
            NEO TASK AI RUNS ON DEEPSEEK V3 + GEMINI 2.5 PRO
          </div>

          <div style={{ ...fadeIn(.4), display:'flex', gap:9, justifyContent:'center', flexWrap:'wrap' }}>
            {['Expenses','Procurement','Projects','Neo Task AI','BOM Generator','Task Actions','Sales CRM','HR & Leave','Billing'].map(f=>(
              <div key={f} style={{ padding:'6px 14px', borderRadius:8, background:'rgba(255,255,255,.035)', border:`1px solid ${C.border}`, fontSize:12.5, color:C.muted, fontWeight:600 }}>{f}</div>
            ))}
          </div>
        </div>

        <div style={{ position:'absolute', bottom:28, left:'50%', transform:'translateX(-50%)', display:'flex', flexDirection:'column', alignItems:'center', gap:6, opacity:.3, animation:'float 2s ease infinite' }}>
          <div style={{ width:1, height:36, background:'rgba(255,255,255,.4)' }}/>
        </div>
      </section>

      {/* ── STATS ── */}
      <section style={{ padding:'70px 24px', borderTop:`1px solid ${C.border}`, borderBottom:`1px solid ${C.border}` }}>
        <div style={{ maxWidth:900, margin:'0 auto', display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:36 }}>
          <StatNum n="6"  label="Business Suites"/>
          <StatNum n="50" suffix="+" label="Modules & Workflows"/>
          <StatNum n="14" suffix="d" label="Free Trial"/>
          <StatNum n="5"  label="AI Features, Human-Confirmed"/>
        </div>
      </section>

      {/* ── FEATURE SUITES (bento) ── */}
      <section id="suites" style={{ padding:'110px 24px', position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', width:800, height:500, borderRadius:'50%', background:`radial-gradient(ellipse,${suite.color}14 0%,transparent 70%)`, top:'0%', left:'50%', transform:'translateX(-50%)', filter:'blur(60px)', transition:'background 0.5s ease', pointerEvents:'none' }}/>
        <div style={{ maxWidth:1100, margin:'0 auto', position:'relative' }}>
          <FadeSection>
            <div style={{ textAlign:'center', marginBottom:44 }}>
              <Eyebrow style={{ justifyContent:'center' }}>PLATFORM_FEATURES</Eyebrow>
              <div style={{ fontSize:'clamp(26px,3.6vw,42px)', fontWeight:800, marginBottom:12, letterSpacing:'-.03em' }}>Six suites. One workspace.</div>
              <div style={{ fontSize:15.5, color:C.muted, maxWidth:540, margin:'0 auto' }}>Every function your business runs on, connected — not stitched together with exports and spreadsheets.</div>
            </div>
          </FadeSection>

          <div style={{ display:'flex', gap:9, marginBottom:36, overflowX:'auto', paddingBottom:4, justifyContent:'center', flexWrap:'wrap' }}>
            {SUITES.map(s => {
              const on = activeSuite===s.id
              return (
                <button key={s.id} className="nx-suite-tab" onClick={()=>setActiveSuite(s.id)}
                  style={{ display:'flex', alignItems:'center', gap:9, padding:'8px 18px 8px 8px', borderRadius:12, border:`1px solid ${on?s.color+'80':C.border}`, cursor:'pointer', fontFamily:'inherit', fontWeight:700, fontSize:12.5, whiteSpace:'nowrap',
                    background:on?`${s.color}14`:'rgba(255,255,255,.02)', boxShadow:on?`0 0 0 1px ${s.color}30, 0 12px 30px -14px ${s.color}70`:'none',
                    color:on?C.ink:C.muted }}>
                  <span style={{ width:26, height:26, borderRadius:8, background:on?`linear-gradient(135deg,${s.color},${s.color}99)`:'rgba(255,255,255,.05)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13 }}>{s.icon}</span>
                  {s.label}
                </button>
              )
            })}
          </div>

          <FadeSection key={suite.id}>
            <div style={{ textAlign:'center', marginBottom:14 }}>
              <div style={{ fontSize:14, color:C.faint, fontFamily:C.mono }}>{suite.blurb}</div>
            </div>
            {suite.ai && (
              <div style={{ maxWidth:620, margin:'0 auto 36px', display:'flex', alignItems:'center', gap:12, padding:'13px 20px', borderRadius:13, background:`linear-gradient(90deg,${suite.color}14,transparent)`, border:`1px solid ${suite.color}30` }}>
                <span style={{ width:30, height:30, borderRadius:9, background:`${suite.color}22`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, flexShrink:0, position:'relative' }}>
                  🤖
                  <span style={{ position:'absolute', top:-2, right:-2, width:8, height:8, borderRadius:'50%', background:'#10b981', boxShadow:'0 0 6px #10b981', border:'2px solid #030304' }}/>
                </span>
                <span style={{ fontSize:12.5, color:C.muted, lineHeight:1.5, textAlign:'left' }}><strong style={{ color:C.ink, fontFamily:C.mono, fontSize:11, letterSpacing:'.04em' }}>AI-ASSISTED · </strong>{suite.ai}</span>
              </div>
            )}
          </FadeSection>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16 }} className="nx-split-grid">
            {suite.features.map((f,i) => <FeatureCard key={suite.id+f.title} {...f} color={suite.color} delay={i*.04}/>)}
          </div>
        </div>
      </section>

      {/* ── FEATURE WALL — infinite dual-row marquee, category-colored ── */}
      <section style={{ padding:'80px 0 120px', borderTop:`1px solid ${C.border}`, overflow:'hidden', position:'relative' }}>
        <div style={{ position:'absolute', width:700, height:500, borderRadius:'50%', background:'radial-gradient(ellipse,rgba(139,92,246,.10) 0%,transparent 70%)', top:'-10%', left:'8%', filter:'blur(60px)', pointerEvents:'none' }}/>
        <div style={{ position:'absolute', width:600, height:450, borderRadius:'50%', background:'radial-gradient(ellipse,rgba(34,211,238,.08) 0%,transparent 70%)', bottom:'-15%', right:'8%', filter:'blur(60px)', pointerEvents:'none' }}/>
        <div style={{ maxWidth:960, margin:'0 auto 44px', textAlign:'center', padding:'0 24px', position:'relative' }}>
          <FadeSection>
            <Eyebrow color="#93c5fd" style={{ justifyContent:'center' }}>FULL_MODULE_INDEX</Eyebrow>
            <div style={{ fontSize:'clamp(24px,3.2vw,36px)', fontWeight:800, marginBottom:10, letterSpacing:'-.03em' }}>Everything included. Nothing bolted on.</div>
            <div style={{ fontSize:14.5, color:C.faint }}>Every module below ships with every plan — enable only what your team actually needs.</div>
          </FadeSection>
        </div>

        <FadeSection delay={.1} style={{ position:'relative' }}>
          {[0,1].map(row => {
            const half = Math.ceil(MODULE_WALL.length/2)
            const items = row===0 ? MODULE_WALL.slice(0,half) : MODULE_WALL.slice(half)
            const loop = [...items, ...items]
            return (
              <div key={row} className="nx-marquee-viewport nx-marquee-mask" style={{ marginBottom: row===0?14:0, overflow:'hidden' }}>
                <div className={`nx-marquee-row ${row===0?'l':'r'}`}>
                  {loop.map((m,i) => (
                    <span key={m[0]+i} className="nx-card nx-chip" style={{ '--glow':m[1], padding:'10px 18px 10px 10px', borderRadius:12, fontSize:13, color:C.muted, fontWeight:600, display:'flex', alignItems:'center', gap:10, whiteSpace:'nowrap', flexShrink:0 }}>
                      <span style={{ width:24, height:24, borderRadius:7, background:`${m[1]}22`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, flexShrink:0 }}>{CATEGORY_ICON[m[1]]}</span>
                      {m[0]}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </FadeSection>
      </section>

      {/* ── AI SUITE — four real, shipped AI features, each with a live-feeling demo ── */}
      <section id="ai-spotlight" style={{ padding:'110px 24px', background:'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(139,92,246,.06), transparent)', borderTop:`1px solid ${C.border}`, borderBottom:`1px solid ${C.border}`, position:'relative', overflow:'hidden' }}>
        <div style={{ maxWidth:1100, margin:'0 auto', position:'relative' }}>
          <FadeSection>
            <div style={{ textAlign:'center', marginBottom:40 }}>
              <Eyebrow color={C.violetSoft} style={{ justifyContent:'center' }}>AI_ACROSS_THE_WORKSPACE</Eyebrow>
              <div style={{ fontSize:'clamp(26px,3.6vw,42px)', fontWeight:800, marginBottom:12, letterSpacing:'-.03em' }}>Five AI features. Zero blind writes.</div>
              <div style={{ fontSize:15.5, color:C.muted, maxWidth:600, margin:'0 auto' }}>Every AI capability in {appName} drafts, never dictates — a human reviews and confirms before anything saves. Try each one below.</div>
            </div>
          </FadeSection>

          <AISuiteDemo />
        </div>
      </section>

      {/* ── PLATFORM DEEP DIVE ── */}
      <section style={{ padding:'110px 24px', position:'relative', overflow:'hidden' }}>
        <div style={{ maxWidth:1100, margin:'0 auto', position:'relative', display:'grid', gridTemplateColumns:'1fr 1.1fr', gap:56, alignItems:'center' }} className="nx-split-grid">
          <FadeSection delay={.1}>
            <div className="nx-card" style={{ '--glow':'#22d3ee', padding:22 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16, fontSize:11, color:C.faint, fontWeight:700, fontFamily:C.mono, letterSpacing:'.06em' }}>
                <span style={{ width:7, height:7, borderRadius:'50%', background:C.cyan, boxShadow:`0 0 6px ${C.cyan}` }}/> TENANT_ISOLATION
              </div>
              {[
                { label:'Row-level security policies', n:'100+', icon:'🔒' },
                { label:'Cross-org data ever visible', n:'0', icon:'🚫' },
                { label:'Custom roles supported', n:'∞', icon:'🔑' },
                { label:'Modules toggled per org', n:'50+', icon:'🧩' },
                { label:'Approval steps fully logged', n:'100%', icon:'📋' },
              ].map((r,i)=>(
                <div key={r.label} style={{ display:'flex', alignItems:'center', gap:13, padding:'11px 0', borderTop:i>0?`1px solid ${C.border}`:'none' }}>
                  <div style={{ width:32, height:32, borderRadius:9, background:'rgba(34,211,238,.12)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, color:C.cyanSoft, flexShrink:0 }}>{r.icon}</div>
                  <div style={{ flex:1, fontSize:12.5, color:C.muted }}>{r.label}</div>
                  <div style={{ fontWeight:800, fontSize:14.5, color:C.ink, fontFamily:C.mono }}>{r.n}</div>
                </div>
              ))}
            </div>
          </FadeSection>
          <FadeSection>
            <Eyebrow color={C.cyanSoft}>02 // DEEP DIVE</Eyebrow>
            <Pill color="#22d3ee">🛡️ Platform & Governance</Pill>
            <div style={{ fontSize:'clamp(24px,3.4vw,38px)', fontWeight:800, marginTop:18, marginBottom:18, lineHeight:1.12, letterSpacing:'-.03em' }}>
              Multi-tenant from day one.<br/>Not bolted on after.
            </div>
            <div style={{ fontSize:15, color:C.muted, lineHeight:1.75, marginBottom:26 }}>
              Every table is scoped to your organization at the database layer — row-level security, not app-side
              filtering. Turn modules on or off per organization, assign unlimited custom roles, and every approval
              step leaves an audit trail. Your data is yours; no other organization can ever query it.
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {['Row-Level Security','Unlimited Roles','Module Kill-Switch','Full Audit Trail','Soft-Delete & Restore'].map(t=>(
                <span key={t} style={{ padding:'5px 13px', borderRadius:7, background:'rgba(34,211,238,.1)', border:'1px solid rgba(34,211,238,.25)', fontSize:11.5, fontWeight:700, color:C.cyanSoft, fontFamily:C.mono }}>{t}</span>
              ))}
            </div>
          </FadeSection>
        </div>
      </section>

      {/* ── PRICING ── */}
      {plans.length > 0 && (
        <section id="pricing" style={{ padding:'110px 24px', borderTop:`1px solid ${C.border}` }}>
          <div style={{ maxWidth:1100, margin:'0 auto' }}>
            <FadeSection>
              <div style={{ textAlign:'center', marginBottom:40 }}>
                <Eyebrow color="#6ee7b7">SIMPLE_PRICING</Eyebrow>
                <div style={{ fontSize:'clamp(26px,3.6vw,42px)', fontWeight:800, marginBottom:12, letterSpacing:'-.03em' }}>Pay for seats, not surprises</div>
                <div style={{ fontSize:15.5, color:C.muted, maxWidth:500, margin:'0 auto' }}>Every plan includes every module. Upgrades are a request away — reviewed by a real person, never an auto-charge.</div>
              </div>
            </FadeSection>

            {plans.some(p => p.price_monthly > 0) && (
              <FadeSection style={{ display:'flex', justifyContent:'center', marginBottom:32 }}>
                <div style={{ display:'inline-flex', padding:4, borderRadius:11, background:'rgba(255,255,255,.03)', border:`1px solid ${C.border}` }}>
                  {['monthly','yearly'].map(c=>(
                    <button key={c} onClick={()=>setBillingCycle(c)}
                      style={{ padding:'8px 18px', borderRadius:8, border:'none', cursor:'pointer', fontFamily:'inherit', fontWeight:700, fontSize:12.5, transition:'all .2s',
                        background:billingCycle===c?'linear-gradient(115deg,#8b5cf6,#22d3ee)':'transparent',
                        color:billingCycle===c?'#fff':C.muted }}>
                      {c==='monthly'?'Monthly':'Yearly'} {c==='yearly' && <span style={{ marginLeft:6, fontSize:10.5, color:billingCycle==='yearly'?'#ecfdf5':'#6ee7b7', fontWeight:800 }}>SAVE ~17%</span>}
                    </button>
                  ))}
                </div>
              </FadeSection>
            )}

            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))', gap:18 }}>
              {plans.map((p,i) => {
                const popular = p.key === 'pro'
                const yearly = billingCycle === 'yearly'
                const effectiveMonthly = p.price_monthly > 0 ? (yearly ? p.price_yearly / 12 : p.price_monthly) : p.price_monthly
                return (
                  <FadeSection key={p.key} delay={i*.06}>
                    <div className="nx-card" style={{ '--glow': popular ? '#8b5cf6' : '#666', position:'relative', height:'100%', display:'flex', flexDirection:'column', background: popular ? 'linear-gradient(165deg,rgba(139,92,246,.1),rgba(34,211,238,.05))' : C.panel, padding:'28px 24px', borderColor: popular ? 'rgba(139,92,246,.4)' : C.border }}>
                      {popular && <div style={{ position:'absolute', top:-12, left:'50%', transform:'translateX(-50%)', padding:'4px 14px', borderRadius:999, background:'linear-gradient(115deg,#8b5cf6,#22d3ee)', fontSize:10.5, fontWeight:800, letterSpacing:'.06em', fontFamily:C.mono }}>MOST POPULAR</div>}
                      <div style={{ fontWeight:800, fontSize:17.5, marginBottom:8, letterSpacing:'-.01em' }}>{p.name}</div>
                      <div style={{ marginBottom:6 }}>
                        {p.price_monthly == null ? (
                          <span style={{ fontWeight:800, fontSize:24, letterSpacing:'-.02em' }}>Contact Sales</span>
                        ) : p.price_monthly === 0 ? (
                          <span style={{ fontWeight:800, fontSize:34, letterSpacing:'-.02em' }}>Free</span>
                        ) : (
                          <>
                            <span style={{ fontWeight:800, fontSize:34, letterSpacing:'-.02em' }}>{rupee(Math.round(effectiveMonthly))}</span>
                            <span style={{ fontSize:12.5, color:C.faint }}>/mo{yearly && ', billed yearly'}</span>
                          </>
                        )}
                      </div>
                      <div style={{ fontSize:12.5, color:C.faint, marginBottom:20, fontFamily:C.mono }}>{p.seat_limit ? `UP TO ${p.seat_limit} SEATS` : 'UNLIMITED SEATS'}</div>
                      <ul style={{ margin:'0 0 24px', padding:0, listStyle:'none', flex:1 }}>
                        {(p.features||[]).map((f,fi) => (
                          <li key={fi} style={{ display:'flex', alignItems:'flex-start', gap:8, fontSize:12.5, color:C.muted, marginBottom:9, lineHeight:1.5 }}>
                            <span style={{ color:'#6ee7b7', fontWeight:800, flexShrink:0 }}>✓</span>{f}
                          </li>
                        ))}
                      </ul>
                      <button className={popular ? 'nx-btn-primary' : 'nx-btn-ghost'} onClick={()=>navigate('/auth?mode=signup')} style={{ padding:'12px 18px', fontSize:13.5 }}>
                        {p.price_monthly === 0 ? 'Start Free' : p.price_monthly == null ? 'Contact Sales' : 'Start Free Trial'}
                      </button>
                    </div>
                  </FadeSection>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── ESTIMATOR: pick modules + seats, see the price, sign up already configured ── */}
      {bundles.length > 0 && (
        <section id="estimate" style={{ padding:'90px 24px', borderTop:`1px solid ${C.border}`, background:'rgba(255,255,255,.015)' }}>
          <div style={{ maxWidth:900, margin:'0 auto' }}>
            <FadeSection>
              <div style={{ textAlign:'center', marginBottom:36 }}>
                <Eyebrow color="#22d3ee">ESTIMATE_YOUR_COST</Eyebrow>
                <div style={{ fontSize:'clamp(24px,3.2vw,38px)', fontWeight:800, marginBottom:12, letterSpacing:'-.03em' }}>Build your own plan</div>
                <div style={{ fontSize:15, color:C.muted, maxWidth:480, margin:'0 auto' }}>Pick a plan, add the modules you need, set your team size — see the real number before you sign up.</div>
              </div>
            </FadeSection>

            {(() => {
              const seats = Math.max(1, Number(estSeats) || 0)
              const plan = plans.find(pl => pl.key === estPlanKey)
              // Preview only — the real, authoritative math (including
              // the pool boundary check against every OTHER org this
              // promoter has referred) runs server-side in
              // create-payment-order at actual checkout time.
              const discountPct = promoStatus?.valid ? Number(promoStatus.discount_percent) : 0
              const discountedSeats = promoStatus?.valid ? (promoStatus.seats_remaining == null ? seats : Math.min(seats, promoStatus.seats_remaining)) : 0
              const rows = []
              if (plan) {
                const planPrice = billingCycle === 'yearly' ? plan.price_yearly : plan.price_monthly
                const discounted = planPrice != null && discountedSeats > 0 ? planPrice * (1 - discountPct / 100) : planPrice
                rows.push({ label: `${plan.name} plan`, price: discounted, originalPrice: planPrice, flat: true })
              }
              bundles.filter(b => estModuleKeys.has(b.key)).forEach(b => {
                const perSeat = billingCycle === 'yearly' ? b.price_per_seat_yearly : b.price_per_seat_monthly
                const fullPriceSeats = Math.max(0, seats - discountedSeats)
                const price = perSeat * fullPriceSeats + perSeat * discountedSeats * (1 - discountPct / 100)
                rows.push({ label: b.name, price, originalPrice: perSeat * seats, perSeat, flat: false })
              })
              const total = rows.reduce((s, r) => s + (r.price || 0), 0)
              const originalTotal = rows.reduce((s, r) => s + (r.originalPrice ?? r.price ?? 0), 0)
              const hasQuote = rows.some(r => r.price == null)
              const trialDays = plan?.trial_days || 0

              return (
                <FadeSection>
                  <div className="nx-card nx-estimator-grid" style={{ '--glow':'#22d3ee', padding:'32px 28px', display:'grid', gridTemplateColumns:'1.3fr 1fr', gap:32 }}>
                    <div>
                      <div style={{ marginBottom:20 }}>
                        <div style={{ fontSize:11.5, fontWeight:800, letterSpacing:'.06em', color:C.faint, fontFamily:C.mono, marginBottom:8 }}>1. PLAN</div>
                        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                          {plans.map(pl => (
                            <button key={pl.key} onClick={() => setEstPlanKey(pl.key)}
                              style={{ padding:'8px 16px', borderRadius:8, border:`1px solid ${estPlanKey===pl.key?'#8b5cf6':C.border}`, cursor:'pointer', fontFamily:'inherit', fontWeight:700, fontSize:12.5,
                                background: estPlanKey===pl.key ? 'rgba(139,92,246,.15)' : 'transparent', color: estPlanKey===pl.key ? '#fff' : C.muted }}>
                              {pl.name}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div style={{ marginBottom:20 }}>
                        <div style={{ fontSize:11.5, fontWeight:800, letterSpacing:'.06em', color:C.faint, fontFamily:C.mono, marginBottom:8 }}>2. TEAM SIZE</div>
                        <input type="number" min={1} value={estSeats} onChange={e=>setEstSeats(e.target.value)}
                          style={{ width:120, padding:'9px 12px', borderRadius:8, border:`1px solid ${C.border}`, background:'rgba(255,255,255,.03)', color:C.ink, fontFamily:'inherit', fontSize:14 }} />
                        <span style={{ marginLeft:8, fontSize:12.5, color:C.faint }}>seats</span>
                      </div>

                      <div>
                        <div style={{ fontSize:11.5, fontWeight:800, letterSpacing:'.06em', color:C.faint, fontFamily:C.mono, marginBottom:8 }}>3. MODULES</div>
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:8 }}>
                          {bundles.map(b => (
                            <label key={b.key} style={{ display:'flex', alignItems:'center', gap:8, fontSize:12.5, padding:'8px 10px', borderRadius:8, border:`1px solid ${C.border}`, cursor:'pointer', color:C.muted }}>
                              <input type="checkbox" checked={estModuleKeys.has(b.key)} onChange={()=>toggleEstModule(b.key)} />
                              {b.name}
                            </label>
                          ))}
                        </div>
                      </div>

                      <div style={{ marginTop:20 }}>
                        <div style={{ fontSize:11.5, fontWeight:800, letterSpacing:'.06em', color:C.faint, fontFamily:C.mono, marginBottom:8 }}>4. PROMO CODE (OPTIONAL)</div>
                        <input value={promoCode} onChange={e=>setPromoCode(e.target.value.toUpperCase())}
                          placeholder="Have a partner's code?"
                          style={{ width:'100%', maxWidth:280, boxSizing:'border-box', padding:'9px 12px', borderRadius:8, border:`1px solid ${promoStatus?.valid ? '#10b981' : C.border}`, background:'rgba(255,255,255,.03)', color:C.ink, fontFamily:'monospace', fontSize:13.5, letterSpacing:'.03em' }} />
                        {promoChecking && <div style={{ fontSize:11.5, color:C.faint, marginTop:6 }}>Checking…</div>}
                        {!promoChecking && promoStatus && (
                          promoStatus.valid
                            ? <div style={{ fontSize:11.5, color:'#6ee7b7', marginTop:6, fontWeight:700 }}>✓ {promoStatus.discount_percent}% off applied{promoStatus.seats_remaining != null && ` — ${promoStatus.seats_remaining} discounted seats left`}</div>
                            : <div style={{ fontSize:11.5, color:'#f59e0b', marginTop:6 }}>{promoStatus.reason || 'Invalid code'}</div>
                        )}
                      </div>
                    </div>

                    <div className="nx-estimator-summary" style={{ borderLeft:`1px solid ${C.border}`, paddingLeft:28, display:'flex', flexDirection:'column' }}>
                      <div style={{ fontSize:11.5, fontWeight:800, letterSpacing:'.06em', color:C.faint, fontFamily:C.mono, marginBottom:14 }}>ESTIMATE</div>
                      {rows.length === 0 ? (
                        <div style={{ fontSize:13, color:C.faint, flex:1 }}>Pick a plan or a module to see a price.</div>
                      ) : (
                        <div style={{ flex:1 }}>
                          {rows.map((r,i) => (
                            <div key={i} style={{ display:'flex', justifyContent:'space-between', fontSize:12.5, color:C.muted, marginBottom:8 }}>
                              <span>{r.label}{!r.flat && <span style={{ color:C.faint }}> ×{seats}</span>}</span>
                              <span>
                                {r.originalPrice != null && r.originalPrice !== r.price && <span style={{ textDecoration:'line-through', color:C.faint, marginRight:6 }}>{rupee(r.originalPrice)}</span>}
                                {r.price==null ? 'Custom' : rupee(r.price)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ borderTop:`1px solid ${C.border}`, marginTop:14, paddingTop:14 }}>
                        <div style={{ fontSize:11, color:C.faint, marginBottom:4 }}>Estimated {billingCycle}</div>
                        <div style={{ fontSize:30, fontWeight:800, letterSpacing:'-.02em', marginBottom:4 }}>{hasQuote ? `${rupee(total)}+` : rupee(total)}</div>
                        {total < originalTotal && <div style={{ fontSize:12, color:'#6ee7b7', fontWeight:700, marginBottom:10 }}>You save {rupee(originalTotal - total)} with this code</div>}
                        {trialDays > 0 && <div style={{ fontSize:11.5, color:'#6ee7b7', marginBottom:14, fontWeight:700 }}>Includes a {trialDays}-day free trial</div>}
                        <button className="nx-btn-primary" onClick={startEstimatorSignup} disabled={rows.length===0} style={{ width:'100%', padding:'13px 18px', fontSize:13.5, opacity: rows.length===0?.5:1 }}>
                          {trialDays > 0 ? 'Start Free Trial' : 'Get Started'}
                        </button>
                      </div>
                    </div>
                  </div>
                </FadeSection>
              )
            })()}
          </div>
        </section>
      )}

      {/* ── BECOME A PROMOTER: public application, super admin approves + allocates seats ── */}
      <section id="become-promoter" style={{ padding:'90px 24px', borderTop:`1px solid ${C.border}` }}>
        <div style={{ maxWidth:640, margin:'0 auto' }}>
          <FadeSection>
            <div style={{ textAlign:'center', marginBottom:32 }}>
              <Eyebrow color="#8b5cf6">PARTNER_PROGRAM</Eyebrow>
              <div style={{ fontSize:'clamp(24px,3.2vw,38px)', fontWeight:800, marginBottom:12, letterSpacing:'-.03em' }}>Become a promoter</div>
              <div style={{ fontSize:15, color:C.muted }}>Bring us customers, earn commission, and offer your own audience a discount from a seat pool we allocate you. Apply below — our team reviews every application before anything goes live.</div>
            </div>
          </FadeSection>
          <FadeSection><PromoterApplyPanel /></FadeSection>
        </div>
      </section>

      {/* ── DYNAMIC CONTENT TABS ── */}
      <section style={{ padding:'70px 24px', background:'rgba(255,255,255,.015)', borderTop:`1px solid ${C.border}` }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <FadeSection>
            <div style={{ textAlign:'center', marginBottom:44 }}>
              <Eyebrow color="#6ee7b7">LIVE_UPDATES</Eyebrow>
              <div style={{ fontSize:'clamp(22px,3.2vw,36px)', fontWeight:800, letterSpacing:'-.03em' }}>What's happening</div>
            </div>
          </FadeSection>

          <div style={{ display:'flex', gap:8, marginBottom:32, overflowX:'auto', paddingBottom:4, justifyContent:'center', flexWrap:'wrap' }}>
            {[
              { id:'announcements', label:'📢 Announcements', count:announcements.length },
              { id:'awards',        label:'🏆 Awards',        count:awards.length },
              { id:'news',          label:'📰 Latest News',   count:news.length },
              { id:'hackathon',     label:'💡 Hackathon',     count:hackathon.length },
            ].map(t=>(
              <button key={t.id} onClick={()=>setActiveTab(t.id)}
                style={{ padding:'9px 20px', borderRadius:10, border:'none', cursor:'pointer', fontFamily:'inherit', fontWeight:700, fontSize:12.5, whiteSpace:'nowrap', transition:'all .2s',
                  background:activeTab===t.id?'linear-gradient(115deg,#8b5cf6,#22d3ee)':'rgba(255,255,255,.05)',
                  color:activeTab===t.id?'#fff':C.muted }}>
                {t.label} {t.count>0 && <span style={{ marginLeft:6, background:'rgba(255,255,255,.2)', borderRadius:999, padding:'1px 7px', fontSize:10.5 }}>{t.count}</span>}
              </button>
            ))}
          </div>

          {activeTab==='announcements' && (
            <FadeSection style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))', gap:14 }}>
              {announcements.length===0 ? (
                <div style={{ gridColumn:'1/-1', textAlign:'center', color:C.faint, padding:'50px 0', fontSize:14 }}>No announcements yet</div>
              ) : announcements.map((a,i)=>{
                const ac = ANN_COLORS[a.type]||'#8b5cf6'
                return (
                  <div key={a.id} className="nx-card" style={{ '--glow':ac, padding:'20px 22px' }}>
                    {a.pinned && <div style={{ position:'absolute', top:14, right:14, fontSize:10, fontWeight:700, color:ac, background:`${ac}18`, padding:'2px 8px', borderRadius:999, fontFamily:C.mono }}>PINNED</div>}
                    <div style={{ width:36, height:36, borderRadius:10, background:`${ac}18`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:17, marginBottom:13 }}>
                      {a.type==='info'?'ℹ️':a.type==='success'?'✅':a.type==='warning'?'⚠️':'🎉'}
                    </div>
                    <div style={{ fontWeight:700, fontSize:15, marginBottom:7 }}>{a.title}</div>
                    <div style={{ fontSize:12.5, color:C.muted, lineHeight:1.6 }}>{a.content}</div>
                    <div style={{ fontSize:10.5, color:C.faint, marginTop:13, fontFamily:C.mono }}>{new Date(a.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</div>
                  </div>
                )
              })}
            </FadeSection>
          )}

          {activeTab==='awards' && (
            <FadeSection style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))', gap:14 }}>
              {awards.length===0 ? (
                <div style={{ gridColumn:'1/-1', textAlign:'center', color:C.faint, padding:'50px 0', fontSize:14 }}>No awards yet — admin can add them from Settings</div>
              ) : awards.map(a=>(
                <div key={a.id} className="nx-card" style={{ '--glow':a.color||'#f59e0b', padding:'26px 20px', textAlign:'center' }}>
                  <div style={{ fontSize:46, marginBottom:12, animation:'float 3s ease infinite' }}>{a.icon||'🏆'}</div>
                  <div style={{ fontWeight:800, fontSize:15, marginBottom:6 }}>{a.title}</div>
                  {a.recipient?.full_name && (
                    <div style={{ fontSize:13, color:a.color||'#f59e0b', fontWeight:700, marginBottom:8 }}>🎖️ {a.recipient.full_name}</div>
                  )}
                  {a.description && <div style={{ fontSize:12.5, color:C.faint, lineHeight:1.5 }}>{a.description}</div>}
                  <div style={{ fontSize:10.5, color:C.faint, marginTop:11, fontFamily:C.mono }}>{new Date(a.award_date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</div>
                </div>
              ))}
            </FadeSection>
          )}

          {activeTab==='news' && (
            <FadeSection style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))', gap:18 }}>
              {news.length===0 ? (
                <div style={{ gridColumn:'1/-1', textAlign:'center', color:C.faint, padding:'50px 0', fontSize:14 }}>No news posts yet — admin can publish from Settings</div>
              ) : news.map(post=>(
                <div key={post.id} className="nx-card" style={{ '--glow':'#8b5cf6', overflow:'hidden', cursor:'pointer' }}
                  onClick={()=>setExpandedNews(expandedNews===post.id?null:post.id)}>
                  {post.image_url && <img src={post.image_url} alt={post.title} style={{ width:'100%', height:170, objectFit:'cover' }}/>}
                  {!post.image_url && (
                    <div style={{ height:110, background:'linear-gradient(135deg,#1a1530,#0f0a1f)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:36 }}>
                      {post.category==='event'?'🎉':post.category==='milestone'?'🏆':post.category==='product'?'🚀':'📰'}
                    </div>
                  )}
                  <div style={{ padding:'18px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:9 }}>
                      <span style={{ padding:'2px 9px', borderRadius:999, background:'rgba(139,92,246,.18)', color:C.violetSoft, fontSize:10, fontWeight:700, textTransform:'uppercase', fontFamily:C.mono }}>{post.category}</span>
                      <span style={{ fontSize:10.5, color:C.faint }}>{new Date(post.published_at||post.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</span>
                    </div>
                    <div style={{ fontWeight:700, fontSize:15, marginBottom:7, lineHeight:1.3 }}>{post.title}</div>
                    <div style={{ fontSize:12.5, color:C.muted, lineHeight:1.6, display: expandedNews===post.id?'block':'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
                      {post.content}
                    </div>
                    <div style={{ fontSize:11.5, color:C.cyanSoft, marginTop:9, fontWeight:600 }}>{expandedNews===post.id?'▲ Read less':'▼ Read more'}</div>
                  </div>
                </div>
              ))}
            </FadeSection>
          )}

          {activeTab==='hackathon' && (
            <FadeSection style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {hackathon.length===0 ? (
                <div style={{ textAlign:'center', color:C.faint, padding:'50px 0', fontSize:14 }}>No hackathon topics yet</div>
              ) : hackathon.map(topic=>{
                const dc = DIFF_COLORS[topic.difficulty]||'#8b5cf6'
                const isOpen = commentTopic===topic.id
                return (
                  <div key={topic.id} className="nx-card" style={{ '--glow':dc, padding:'22px' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16, flexWrap:'wrap' }}>
                      <div style={{ flex:1 }}>
                        <div style={{ display:'flex', gap:8, marginBottom:10, flexWrap:'wrap' }}>
                          <span style={{ padding:'3px 10px', borderRadius:999, background:`${dc}20`, color:dc, fontSize:10.5, fontWeight:700, textTransform:'uppercase', fontFamily:C.mono }}>{topic.difficulty}</span>
                          {(topic.tags||[]).map(t=><span key={t} style={{ padding:'3px 10px', borderRadius:999, background:'rgba(255,255,255,.06)', color:C.faint, fontSize:10.5 }}>{t}</span>)}
                        </div>
                        <div style={{ fontWeight:800, fontSize:16, marginBottom:8 }}>💡 {topic.title}</div>
                        <div style={{ fontSize:13.5, color:C.muted, lineHeight:1.6 }}>{topic.description}</div>
                      </div>
                      <button className="nx-btn-ghost" onClick={async()=>{
                          const open = commentTopic===topic.id
                          setCommentTopic(open?null:topic.id)
                          if(!open && !comments[topic.id]) loadComments(topic.id)
                        }}
                        style={{ padding:'7px 18px', fontSize:12.5, whiteSpace:'nowrap' }}>
                        {isOpen?'Close':'💬 Comment'}
                      </button>
                    </div>
                    {isOpen && (
                      <div style={{ marginTop:18, borderTop:`1px solid ${C.border}`, paddingTop:18 }}>
                        {(comments[topic.id]||[]).map((c,i)=>(
                          <div key={i} style={{ display:'flex', gap:11, marginBottom:13 }}>
                            <div style={{ width:29, height:29, borderRadius:9, background:'linear-gradient(135deg,#8b5cf6,#22d3ee)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, flexShrink:0 }}>
                              {(c.user?.full_name||'?')[0]}
                            </div>
                            <div>
                              <div style={{ fontSize:11.5, fontWeight:700, color:C.violetSoft, marginBottom:3 }}>{c.user?.full_name||'User'}</div>
                              <div style={{ fontSize:12.5, color:C.muted, lineHeight:1.5 }}>{c.content}</div>
                            </div>
                          </div>
                        ))}
                        <div style={{ display:'flex', gap:10, marginTop:11 }}>
                          <input value={comment} onChange={e=>setComment(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submitComment(topic.id)}
                            placeholder="Share your thoughts… (login required)"
                            style={{ flex:1, padding:'10px 13px', borderRadius:9, border:`1px solid ${C.border}`, background:'rgba(255,255,255,.04)', color:C.ink, fontSize:12.5, fontFamily:'inherit', outline:'none' }}/>
                          <button className="nx-btn-primary" onClick={()=>submitComment(topic.id)} style={{ padding:'10px 18px', fontSize:12.5 }}>Post</button>
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

      {/* ── HOW IT WORKS ── */}
      <section style={{ padding:'110px 24px' }}>
        <div style={{ maxWidth:900, margin:'0 auto', textAlign:'center' }}>
          <FadeSection>
            <Eyebrow color="#f9a8d4">HOW_IT_WORKS</Eyebrow>
            <div style={{ fontSize:'clamp(24px,3.6vw,40px)', fontWeight:800, marginBottom:56, letterSpacing:'-.03em' }}>Simple. Powerful. Complete.</div>
          </FadeSection>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:20 }}>
            {[
              { n:'01', icon:'🏢', title:'Create or Join', desc:'Spin up a new organization, or join an existing one with a teammate’s invite code.' },
              { n:'02', icon:'🧩', title:'Configure', desc:'Enable the modules your team needs and assign roles — everything else stays off.' },
              { n:'03', icon:'⚡', title:'Work', desc:'Expenses, projects, sales pipeline, HR — submit, approve, and track in one place.' },
              { n:'04', icon:'📊', title:'Analyze', desc:'Real-time dashboards, spend analysis and AI insights keep leadership in control.' },
            ].map((s,i)=>(
              <FadeSection key={s.n} delay={i*.1}>
                <div style={{ textAlign:'center' }}>
                  <div style={{ fontFamily:C.mono, fontSize:13, fontWeight:700, color:'rgba(139,92,246,.4)', marginBottom:12 }}>{s.n}</div>
                  <div style={{ width:56, height:56, borderRadius:14, background:'rgba(255,255,255,.035)', border:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:26, margin:'0 auto 16px' }}>{s.icon}</div>
                  <div style={{ fontWeight:800, fontSize:15.5, marginBottom:8 }}>{s.title}</div>
                  <div style={{ fontSize:12.5, color:C.faint, lineHeight:1.6 }}>{s.desc}</div>
                </div>
              </FadeSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" style={{ padding:'110px 24px', background:'rgba(255,255,255,.015)', borderTop:`1px solid ${C.border}` }}>
        <div style={{ maxWidth:740, margin:'0 auto' }}>
          <FadeSection>
            <div style={{ textAlign:'center', marginBottom:44 }}>
              <Eyebrow color="#93c5fd">FAQ</Eyebrow>
              <div style={{ fontSize:'clamp(24px,3.6vw,38px)', fontWeight:800, letterSpacing:'-.03em' }}>Common questions</div>
            </div>
          </FadeSection>
          <FadeSection delay={.1}>
            <div>
              {FAQS.map((f,i)=>(
                <FAQItem key={f.q} q={f.q} a={f.a} open={openFAQ===i} onClick={()=>setOpenFAQ(openFAQ===i?-1:i)}/>
              ))}
            </div>
          </FadeSection>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ padding:'110px 24px', textAlign:'center', position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', width:700, height:700, borderRadius:'50%', background:'radial-gradient(circle,rgba(139,92,246,.16) 0%,transparent 65%)', top:'-30%', left:'50%', transform:'translateX(-50%)', filter:'blur(50px)' }}/>
        <div style={{ position:'relative', maxWidth:680, margin:'0 auto' }}>
          <FadeSection>
            <div style={{ fontSize:'clamp(28px,4.6vw,52px)', fontWeight:800, lineHeight:1.08, marginBottom:20, letterSpacing:'-.03em' }}>
              Ready to transform<br/>how you work?
            </div>
            <div style={{ fontSize:15, color:C.muted, marginBottom:36, lineHeight:1.7 }}>
              Join {appName} and manage your entire business — finance, projects, sales and people — from one secure platform.
            </div>
            <button className="nx-btn-primary" onClick={()=>navigate('/auth?mode=signup')} style={{ padding:'16px 42px', fontSize:16 }}>
              Get Started Free →
            </button>
          </FadeSection>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ borderTop:`1px solid ${C.border}`, padding:'50px 40px 30px' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr 1fr 1fr', gap:32, marginBottom:36 }} className="nx-footer-grid">
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
                <div style={{ width:28, height:28, borderRadius:8, background:'linear-gradient(135deg,#8b5cf6,#22d3ee)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}>⚡</div>
                <span style={{ fontWeight:700, fontSize:15 }}>{appName}</span>
              </div>
              <div style={{ fontSize:12.5, color:C.faint, lineHeight:1.6, maxWidth:280 }}>The unified, multi-tenant operations platform for finance, procurement, projects, sales and people — with AI built in.</div>
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:800, color:C.faint, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:14, fontFamily:C.mono }}>Product</div>
              {NAV_LINKS.map(l => (
                <div key={l.id} style={{ marginBottom:10 }}>
                  <button onClick={()=>scrollTo(l.id)} style={{ background:'none', border:'none', color:C.muted, fontSize:13, cursor:'pointer', fontFamily:'inherit', padding:0 }}>{l.label}</button>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:800, color:C.faint, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:14, fontFamily:C.mono }}>Suites</div>
              {SUITES.slice(0,5).map(s => (
                <div key={s.id} style={{ marginBottom:10 }}>
                  <button onClick={()=>{ setActiveSuite(s.id); scrollTo('suites') }} style={{ background:'none', border:'none', color:C.muted, fontSize:13, cursor:'pointer', fontFamily:'inherit', padding:0 }}>{s.label}</button>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:800, color:C.faint, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:14, fontFamily:C.mono }}>Get Started</div>
              <div style={{ marginBottom:10 }}><button onClick={()=>navigate('/auth')} style={{ background:'none', border:'none', color:C.muted, fontSize:13, cursor:'pointer', fontFamily:'inherit', padding:0 }}>Sign In</button></div>
              <div><button onClick={()=>navigate('/auth?mode=signup')} style={{ background:'none', border:'none', color:C.violetSoft, fontSize:13, cursor:'pointer', fontFamily:'inherit', padding:0, fontWeight:700 }}>Create Account</button></div>
            </div>
          </div>
          <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:22, fontSize:12, color:C.faint, textAlign:'center', fontFamily:C.mono }}>
            © {new Date().getFullYear()} THINGSALIVE NEOX — RUN YOUR WHOLE BUSINESS. FROM ONE WORKSPACE.
          </div>
        </div>
      </footer>

      <AIChatBubble />
    </div>
  )
}
