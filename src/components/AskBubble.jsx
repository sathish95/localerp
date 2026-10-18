import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Sparkles, X, Send, Receipt, ShoppingCart, CalendarDays, Plane, AlertTriangle, Wallet, TrendingUp, FileText, Building2, Users, ChevronRight, ChevronDown, Bot, Maximize2, Check, Boxes, Package, Zap, FileCheck, Truck, ArrowLeft, Radar, ClipboardList, Clock, Database } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { questionsForRole, matchQuestion } from '../lib/quickAnswers'
import { LLM_MODELS, isModelUsable } from '../lib/llm'
import { answerQuestion, getPreferredModel, setPreferredModel, getAskMode, setAskMode } from '../lib/assistant'
import { getEnabledCapabilities } from '../lib/aiCapabilities'

// Capability picker (STEP: AI capabilities added alongside the original
// Quick Answers chat). 'ask' is this component's original behavior,
// opening the popover chat unchanged. Every other capability is tied to
// one real module page, so clicking it navigates there instead of
// opening a popover — the docked AI panel that lives on that page (see
// AIDockedPanel.jsx + the module pages) is the real chat surface,
// alongside the actual data instead of floating disconnected from it.
// This popover only ever hosts 'ask' now.
const AI_TABS = [
  { id:'ask', label:'Ask', icon:Bot, color:'var(--c1)', title:'Quick Answers', subtitle:"Ask me about the company's data", link:'/data-assistant' },
  { id:'neo-task-ai', label:'Neo Task', icon:Sparkles, color:'#6366f1', title:'Neo Task AI', subtitle:'Requirement doc → full plan', link:'/neo-task-ai' },
  { id:'bom-ai', label:'BOM AI', icon:Boxes, color:'#0891b2', title:'BOM AI', subtitle:'Draft a Bill of Materials', link:'/bom' },
  { id:'product-ai', label:'Product AI', icon:Package, color:'#d97706', title:'Product AI', subtitle:'Draft a catalog entry', link:'/products' },
  { id:'task-actions', label:'Tasks', icon:Zap, color:'#db2777', title:'Task Actions', subtitle:'Create or update tasks', link:'/tasks' },
  { id:'customer-invoice-ai', label:'Cust. Invoice', icon:FileCheck, color:'#059669', title:'Customer Invoice AI', subtitle:'Draft a customer invoice', link:'/customer-invoices' },
  { id:'vendor-invoice-ai', label:'Vendor Invoice', icon:FileText, color:'#7c3aed', title:'Vendor Invoice AI', subtitle:'Draft a vendor invoice', link:'/invoices' },
  { id:'delivery-note-ai', label:'Delivery Note', icon:Truck, color:'#0d9488', title:'Delivery Note AI', subtitle:'Draft an outbound shipment', link:'/delivery-notes' },
  { id:'scenario-ai', label:'Scenario AI', icon:Radar, color:'#6d28d9', title:'Scenario AI', subtitle:'Draft a what-if scenario', link:'/scenarios/my' },
]

const ICONS = {
  'pending-expenses': Receipt,
  'pending-pr': ShoppingCart,
  'pending-leave': CalendarDays,
  'pending-travel': Plane,
  'over-budget-projects': AlertTriangle,
  'budget-vs-spent': Wallet,
  'spend-this-month': TrendingUp,
  'pending-invoices': FileText,
  'department-budget-health': Building2,
  'active-employees': Users,
  'my-open-tasks': ClipboardList,
  'my-hours-this-month': Clock,
  'my-pending-expenses': Receipt,
  'my-pending-travel': Plane,
  'pending-po': ShoppingCart,
  'pending-grn': Truck,
  'total-payments': Wallet,
  'active-vendors': Building2,
  'assets-summary': Boxes,
  'pending-warranty': AlertTriangle,
  'open-tasks-org': ClipboardList,
  'pending-customer-invoices': FileCheck,
  'products-customers-devices': Package,
}

const NUDGE_SEEN_KEY = 'nx_askbubble_nudge_seen'
const CLOSE_ANIM_MS = 180

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function AskBubble() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [capMenuOpen, setCapMenuOpen] = useState(false) // fan-out capability picker, shown before the panel opens
  // Step aside while a drawer / modal / full-screen view is open, so the
  // floating button never covers their footer buttons (Save, Send, …).
  const [overlayOpen, setOverlayOpen] = useState(false)
  useEffect(() => {
    const SEL = '.modal-backdrop, .drawer-backdrop, .esg-overlay'
    const check = () => setOverlayOpen(!!document.querySelector(SEL))
    check()
    const mo = new MutationObserver(check)
    mo.observe(document.body, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [])
  const [enabledCaps, setEnabledCaps] = useState(null) // null while loading — treated as "show all" so nothing flashes hidden
  const [tab, setTab] = useState('ask')
  const [closing, setClosing] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [modelId, setModelId] = useState(getPreferredModel())
  const [usableModels, setUsableModels] = useState(LLM_MODELS.filter(m => !m.envKey))
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [mode, setMode] = useState(getAskMode()) // 'llm' | 'db' — typed-text answer source
  const [showNudge, setShowNudge] = useState(false)
  const ref = useRef(null)
  const menuRef = useRef(null)
  const listRef = useRef(null)
  const textareaRef = useRef(null)
  const idRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    Promise.all(LLM_MODELS.map(async m => [m, await isModelUsable(m)])).then(pairs => {
      if (!cancelled) setUsableModels(pairs.filter(([, ok]) => ok).map(([m]) => m))
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    getEnabledCapabilities().then(caps => { if (!cancelled) setEnabledCaps(caps) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // One-time proactive nudge — a subtle "ask me anything" bubble that shows
  // once per browser, matching the pattern established chat widgets (Intercom,
  // Crisp, Drift) use to invite a first interaction without being pushy.
  useEffect(() => {
    let seen = true
    try { seen = localStorage.getItem(NUDGE_SEEN_KEY) === '1' } catch {}
    if (seen) return
    const showT = setTimeout(() => setShowNudge(true), 3500)
    const hideT = setTimeout(() => dismissNudge(), 12000)
    return () => { clearTimeout(showT); clearTimeout(hideT) }
  }, [])

  function dismissNudge() {
    setShowNudge(false)
    try { localStorage.setItem(NUDGE_SEEN_KEY, '1') } catch {}
  }

  const activeModel = usableModels.find(m => m.id === modelId) || usableModels[0]

  function selectModel(id) {
    setModelId(id)
    setPreferredModel(id)
    setModelMenuOpen(false)
  }

  function selectMode(m) {
    setMode(m)
    setAskMode(m)
    setModelMenuOpen(false)
  }

  function openPanel() {
    setOpen(true)
    setClosing(false)
    dismissNudge()
  }

  function closePanel() {
    setClosing(true)
    setModelMenuOpen(false)
    setTimeout(() => { setOpen(false); setClosing(false) }, CLOSE_ANIM_MS)
  }

  useEffect(() => {
    function onClickOut(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setModelMenuOpen(false)
      if (ref.current && !ref.current.contains(e.target)) { closePanel(); setCapMenuOpen(false) }
    }
    document.addEventListener('mousedown', onClickOut)
    return () => document.removeEventListener('mousedown', onClickOut)
  }, [])

  function selectCapability(tabId) {
    setCapMenuOpen(false)
    if (tabId === 'ask') { setTab('ask'); openPanel(); return }
    // Every other capability is tied to one real module page — navigate
    // there instead of opening this popover; ?ai=1 tells the page to
    // auto-open its own docked AI panel (AIDockedPanel.jsx) on arrival.
    dismissNudge()
    const t = AI_TABS.find(x => x.id === tabId)
    navigate(t.id === 'neo-task-ai' ? t.link : `${t.link}?ai=1`)
  }

  // Only 'ask' opens in this popover now — the back-arrow returns to the
  // fan-out picker in case the user wants a different capability instead.
  function goBackToMenu() {
    closePanel()
    setTimeout(() => setCapMenuOpen(true), CLOSE_ANIM_MS)
  }

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, busy])

  useEffect(() => {
    if (open) setTimeout(() => textareaRef.current?.focus(), 320)
  }, [open])

  function autoGrow(el) {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 110) + 'px'
  }

  function pushMessage(from, text, streaming = false) {
    idRef.current += 1
    const id = idRef.current
    setMessages(m => [...m, { id, from, text, ts: Date.now(), streaming }])
    return id
  }

  function appendToMessage(id, delta) {
    setMessages(m => m.map(msg => msg.id === id ? { ...msg, text: msg.text + delta } : msg))
  }

  function finishMessage(id) {
    setMessages(m => m.map(msg => msg.id === id ? { ...msg, streaming: false } : msg))
  }

  async function ask(question) {
    if (busy) return
    pushMessage('user', question.label)
    setBusy(true)
    const answer = await question.run(profile)
    pushMessage('bot', answer)
    setBusy(false)
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    pushMessage('user', text)
    setBusy(true)

    if (mode === 'db') {
      // Non-LLM mode — never calls the AI. Matches typed text against the
      // same canned question set as the starter chips (personal + org-wide,
      // role-gated) and answers straight from Supabase, or says plainly
      // that nothing matched rather than guessing.
      const match = matchQuestion(text, questionsForRole(profile?.role))
      const answer = match
        ? await match.run(profile)
        : "I don't have a database answer for that — try one of the suggested questions, rephrase it closer to one of them, or switch to LLM mode for open-ended questions."
      pushMessage('bot', answer)
      setBusy(false)
      return
    }

    const botId = pushMessage('bot', '', true)
    try {
      await answerQuestion(text, profile, { modelId: activeModel?.id, ollamaModel: 'qwen2.5-coder:7b', onToken: delta => appendToMessage(botId, delta) })
    } finally {
      finishMessage(botId)
      setBusy(false)
    }
  }

  const started = messages.length > 0
  const activeTab = AI_TABS.find(t => t.id === tab) || AI_TABS[0]
  // 'ask' (Data Assistant) isn't part of the per-org AI capability toggle
  // (STEP110) — it's a distinct, longer-standing feature with its own
  // access model, not one of the new module-AI features admins can turn
  // off. The other four are filtered by the org's saved settings.
  const visibleTabs = AI_TABS.filter(t => t.id === 'ask' || enabledCaps === null || enabledCaps[t.id] !== false)

  if (overlayOpen && !open && !capMenuOpen) return null

  return (
    <div ref={ref}>
      {showNudge && !open && !capMenuOpen && (
        <div className="askbubble-nudge" style={{
          position: 'fixed', bottom: 90, right: 24, zIndex: 9999, maxWidth: 230,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px 14px 4px 14px',
          boxShadow: '0 10px 30px rgba(0,0,0,.16)', padding: '12px 14px', display: 'flex', gap: 8, alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: 16 }}>👋</span>
          <div style={{ flex: 1, fontSize: 12, lineHeight: 1.5, color: 'var(--ink-soft)' }}>
            Ask me anything about your expenses, projects, budgets or invoices.
          </div>
          <button onClick={dismissNudge} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, flexShrink: 0 }}>
            <X size={13} />
          </button>
        </div>
      )}

      <button
        className="askbubble-fab"
        onClick={() => {
          if (open) { closePanel(); return }
          if (capMenuOpen) { setCapMenuOpen(false); return }
          setCapMenuOpen(true)
          dismissNudge()
        }}
        title="Ask NeoX AI"
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          width: 54, height: 54, borderRadius: '50%', border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg, var(--c1), #8b5cf6)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,.25)',
        }}>
        <span className="askbubble-fab-icon" style={{ display: 'flex', transform: (open || capMenuOpen) ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          {(open || capMenuOpen) ? <X size={22} /> : <Sparkles size={22} />}
        </span>
      </button>

      {capMenuOpen && !open && (
        <div style={{ position: 'fixed', bottom: 90, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column-reverse', alignItems: 'flex-end', gap: 10 }}>
          {visibleTabs.map((t, i) => {
            const Icon = t.icon
            return (
              <div key={t.id} className="askbubble-mini" style={{ display: 'flex', alignItems: 'center', gap: 10, animationDelay: `${i * 70}ms` }}>
                <span style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 11px', fontSize: 12, fontWeight: 700, color: 'var(--text)', boxShadow: '0 4px 14px rgba(0,0,0,.14)', whiteSpace: 'nowrap' }}>
                  {t.title}
                </span>
                <button onClick={() => selectCapability(t.id)} title={t.title}
                  style={{
                    width: 46, height: 46, borderRadius: '50%', border: '1px solid var(--border)', cursor: 'pointer',
                    background: 'var(--surface)', color: t.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 8px 22px rgba(0,0,0,.18)', flexShrink: 0,
                  }}>
                  <Icon size={19} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {open && (
        <div className={`askbubble-panel${closing ? ' closing' : ''}`} style={{
          position: 'fixed', bottom: 90, right: 24, zIndex: 9999, width: 380, maxHeight: 'min(640px, 78vh)',
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18,
          boxShadow: '0 20px 60px rgba(0,0,0,.22), 0 4px 16px rgba(0,0,0,.08)', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            padding: '16px 18px', background: 'linear-gradient(135deg, var(--c1), #8b5cf6)', color: '#fff',
            display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
          }}>
            <button onClick={goBackToMenu} title="Back to all AI features"
              style={{ background: 'rgba(255,255,255,.15)', border: 'none', borderRadius: 8, cursor: 'pointer', color: '#fff', width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <ArrowLeft size={14} />
            </button>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(255,255,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Bot size={17} />
              </div>
              <span style={{ position: 'absolute', bottom: -1, right: -1, width: 9, height: 9, borderRadius: '50%', background: '#22c55e', border: '2px solid #6366f1' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 14.5 }}>{activeTab.title}</div>
              <div style={{ fontSize: 11, opacity: .85 }}>{activeTab.subtitle}</div>
            </div>
            <Link to={activeTab.link} onClick={closePanel} title={`Open ${activeTab.title}`}
              style={{ background: 'rgba(255,255,255,.15)', border: 'none', borderRadius: 8, cursor: 'pointer', color: '#fff', width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Maximize2 size={12} />
            </Link>
            <button onClick={closePanel} style={{ background: 'rgba(255,255,255,.15)', border: 'none', borderRadius: 8, cursor: 'pointer', color: '#fff', width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <X size={13} />
            </button>
          </div>

          <div ref={listRef} className="askbubble-scroll" style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {!started ? (
              <>
                <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.5, marginBottom: 2 }}>
                  Hi{profile?.full_name ? ` ${profile.full_name.split(' ')[0]}` : ''}! Pick a question to get an instant answer:
                </div>
                {questionsForRole(profile?.role).map((q, i) => {
                  const Icon = ICONS[q.id] || Sparkles
                  return (
                    <button key={q.id} disabled={busy} onClick={() => ask(q)} className="askbubble-card"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%',
                        border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px',
                        background: 'var(--surface)', cursor: busy ? 'default' : 'pointer',
                        animationDelay: `${i * 35}ms`,
                      }}>
                      <div style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--surface-2)', color: 'var(--c1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon size={15} />
                      </div>
                      <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, lineHeight: 1.4 }}>{q.label}</span>
                      <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    </button>
                  )
                })}
              </>
            ) : (
              <>
                {messages.map(m => m.from === 'user' ? (
                  <div key={m.id} className="askbubble-msg" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    <div style={{
                      background: 'linear-gradient(135deg, var(--c1), #8b5cf6)', color: '#fff', borderRadius: '12px 4px 12px 12px',
                      padding: '9px 12px', fontSize: 12.5, lineHeight: 1.55, whiteSpace: 'pre-line', maxWidth: '85%',
                      boxShadow: '0 2px 8px rgba(99,102,241,.25)',
                    }}>
                      {m.text}
                    </div>
                    <span style={{ fontSize: 9.5, color: 'var(--text-muted)', marginTop: 3, marginRight: 2 }}>{fmtTime(m.ts)}</span>
                  </div>
                ) : (
                  <div key={m.id} className="askbubble-msg" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ width: 26, height: 26, borderRadius: 8, background: 'var(--surface-2)', color: 'var(--c1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                      <Bot size={13} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '85%' }}>
                      <div style={{
                        background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '4px 12px 12px 12px',
                        padding: '9px 12px', fontSize: 12.5, lineHeight: 1.55, whiteSpace: 'pre-line',
                        boxShadow: '0 1px 3px rgba(0,0,0,.04)',
                      }}>
                        {m.streaming && !m.text ? (
                          <span style={{ display: 'flex', gap: 4 }}>
                            <span className="askbubble-dot" /><span className="askbubble-dot" /><span className="askbubble-dot" />
                          </span>
                        ) : (
                          <>{m.text}{m.streaming && <span className="askbubble-cursor" />}</>
                        )}
                      </div>
                      <span style={{ fontSize: 9.5, color: 'var(--text-muted)', marginTop: 3, marginLeft: 2 }}>{fmtTime(m.ts)}</span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          {tab === 'ask' && (
            <div style={{ display: 'flex', gap: 6, padding: '8px 12px 0', borderTop: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
              <button onClick={() => selectMode('llm')} title="Answers come from the AI, grounded in a live data snapshot" style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, border: 'none', cursor: 'pointer',
                background: mode === 'llm' ? 'var(--c1)' : 'var(--surface-2)', color: mode === 'llm' ? '#fff' : 'var(--text-muted)',
                fontSize: 10.5, fontWeight: 700,
              }}><Sparkles size={11} /> LLM</button>
              <button onClick={() => selectMode('db')} title="Answers come straight from the database — no AI call at all" style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, border: 'none', cursor: 'pointer',
                background: mode === 'db' ? 'var(--c1)' : 'var(--surface-2)', color: mode === 'db' ? '#fff' : 'var(--text-muted)',
                fontSize: 10.5, fontWeight: 700,
              }}><Database size={11} /> DB Only</button>
            </div>
          )}

          {tab === 'ask' && mode === 'llm' && usableModels.length > 1 && (
            <div ref={menuRef} style={{ position: 'relative', padding: '8px 12px 0', background: 'var(--surface)', flexShrink: 0 }}>
              <button onClick={() => setModelMenuOpen(o => !o)} title="Switch AI model" style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px 4px 10px',
                borderRadius: 999, border: `1px solid ${activeModel?.color}40`, background: activeModel?.bg,
                color: activeModel?.color, fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: activeModel?.color }} />
                {activeModel?.label}
                <ChevronDown size={11} style={{ transition: 'transform .15s', transform: modelMenuOpen ? 'rotate(180deg)' : 'none' }} />
              </button>

              {modelMenuOpen && (
                <div className="askbubble-nudge" style={{
                  position: 'absolute', bottom: '100%', left: 12, marginBottom: 6, minWidth: 180, zIndex: 10,
                  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
                  boxShadow: '0 10px 30px rgba(0,0,0,.16)', overflow: 'hidden', padding: 4,
                }}>
                  {usableModels.map(m => (
                    <button key={m.id} onClick={() => selectModel(m.id)} className="askbubble-menu-item" style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px',
                      border: 'none', background: 'none', cursor: 'pointer', borderRadius: 8, textAlign: 'left',
                    }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{m.label}</span>
                      {m.id === activeModel?.id && <Check size={13} style={{ color: 'var(--c1)' }} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'ask' && (
            <div style={{ display: 'flex', gap: 8, padding: 12, alignItems: 'flex-end', borderTop: 'none', background: 'var(--surface)', flexShrink: 0 }}>
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={e => { setInput(e.target.value); autoGrow(e.target) }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                placeholder={mode === 'db' ? 'Ask a question (DB answers only)…' : 'Ask a question…'}
                disabled={busy}
                className="askbubble-textarea"
                style={{
                  flex: 1, border: '1px solid var(--border)', borderRadius: 10, padding: '9px 12px',
                  fontSize: 12.5, background: 'var(--surface)', color: 'inherit', fontFamily: 'inherit', outline: 'none',
                  lineHeight: 1.4, minHeight: 36, maxHeight: 110,
                }}
              />
              <button onClick={handleSend} disabled={busy || !input.trim()} className="askbubble-send"
                style={{
                  width: 36, height: 36, borderRadius: 10, border: 'none', cursor: busy ? 'default' : 'pointer',
                  background: 'linear-gradient(135deg, var(--c1), #8b5cf6)', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  opacity: busy || !input.trim() ? 0.5 : 1,
                }}>
                <Send size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
