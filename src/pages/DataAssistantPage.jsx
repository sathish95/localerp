import { useState, useRef, useEffect } from 'react'
import {
  Sparkles, Bot, RefreshCw, Send, Check, Receipt, ShoppingCart, CalendarDays, Plane,
  AlertTriangle, Wallet, TrendingUp, FileText, Building2, Users, ChevronRight,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { LLM_MODELS, isModelUsable } from '../lib/llm'
import { QUESTIONS } from '../lib/quickAnswers'
import { buildDataIndex, getCachedIndex } from '../lib/dataIndex'
import { answerQuestion, getPreferredModel, setPreferredModel } from '../lib/assistant'
import { timeFmt } from '../lib/supabase'

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

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
}

export default function DataAssistantPage() {
  const { profile } = useAuth()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [selModel, setSelModelState] = useState(getPreferredModel())
  function setSelModel(id) { setSelModelState(id); setPreferredModel(id) }
  const [ollamaModel, setOllamaModel] = useState('qwen2.5-coder:7b')
  const [indexInfo, setIndexInfo] = useState(getCachedIndex())
  const [refreshing, setRefreshing] = useState(false)
  const [keyStatus, setKeyStatus] = useState({})
  const listRef = useRef(null)
  const textareaRef = useRef(null)
  const idRef = useRef(0)

  useEffect(() => {
    if (!indexInfo) buildDataIndex().then(setIndexInfo).catch(() => {})
  }, [indexInfo])

  useEffect(() => {
    let cancelled = false
    Promise.all(LLM_MODELS.map(async m => [m.id, await isModelUsable(m)])).then(pairs => {
      if (!cancelled) setKeyStatus(Object.fromEntries(pairs))
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, busy])

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

  function autoGrow(el) {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }

  async function refreshIndex() {
    setRefreshing(true)
    try { setIndexInfo(await buildDataIndex({ force: true })) } finally { setRefreshing(false) }
  }

  async function ask(question) {
    if (busy) return
    pushMessage('user', question.label)
    setBusy(true)
    pushMessage('bot', await question.run(profile))
    setBusy(false)
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    pushMessage('user', text)
    setBusy(true)
    const botId = pushMessage('bot', '', true)
    try {
      await answerQuestion(text, profile, { modelId: selModel, ollamaModel, onToken: delta => appendToMessage(botId, delta) })
    } finally {
      finishMessage(botId)
      setBusy(false)
    }
  }

  const started = messages.length > 0

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Data Assistant</div>
          <div className="page-subtitle">Ask anything about the company's data — grounded in a live snapshot, not guesses</div>
        </div>
        <button className="btn btn-outline" onClick={refreshIndex} disabled={refreshing}>
          <RefreshCw size={14} style={{ marginRight: 6, animation: refreshing ? 'spin .7s linear infinite' : 'none' }} />
          {refreshing ? 'Refreshing…' : 'Refresh data'}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body">
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>AI MODEL</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
            {LLM_MODELS.map(m => {
              const active = selModel === m.id
              const keyMissing = keyStatus[m.id] === false
              return (
                <div key={m.id} onClick={() => !keyMissing && setSelModel(m.id)}
                  style={{
                    borderRadius: 10, border: `2px solid ${active ? m.color : 'var(--border)'}`, padding: '10px 12px',
                    cursor: keyMissing ? 'not-allowed' : 'pointer', background: active ? m.bg : 'var(--surface)',
                    opacity: keyMissing ? 0.5 : 1, transition: 'all .15s', position: 'relative',
                  }}>
                  {active && (
                    <div style={{ position: 'absolute', top: 8, right: 8, width: 16, height: 16, borderRadius: '50%', background: m.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Check size={9} style={{ color: '#fff' }} />
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div style={{ width: 24, height: 24, borderRadius: 7, background: m.bg, border: `1.5px solid ${m.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Sparkles size={11} style={{ color: m.color }} />
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 12.5 }}>{m.label}</div>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{m.description}</div>
                  {keyMissing && <div style={{ marginTop: 6, fontSize: 10, color: '#f59e0b', fontWeight: 600 }}>⚠ API key not set — configure it in Settings</div>}
                </div>
              )
            })}
          </div>
          {selModel === 'ollama-local' && (
            <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, border: '1px solid #10b98140', background: '#10b98108' }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#10b981', marginBottom: 6 }}>OLLAMA MODEL NAME</label>
              <input className="form-input" value={ollamaModel} onChange={e => setOllamaModel(e.target.value)} placeholder="qwen2.5-coder:7b" style={{ width: '100%' }} />
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
            {indexInfo ? `Data snapshot as of ${timeFmt(indexInfo.generatedAt)}` : 'Building data snapshot…'}
            {indexInfo?._errors && Object.keys(indexInfo._errors).length > 0 && (
              <span style={{ color: '#f59e0b', marginLeft: 8 }}>⚠ {Object.keys(indexInfo._errors).length} data area{Object.keys(indexInfo._errors).length === 1 ? '' : 's'} unavailable</span>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', height: 560 }}>
        <div ref={listRef} className="askbubble-scroll" style={{ flex: 1, overflowY: 'auto', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!started ? (
            <>
              <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6, marginBottom: 4 }}>
                Hi{profile?.full_name ? ` ${profile.full_name.split(' ')[0]}` : ''}! Pick a question below, or type anything about expenses, projects, invoices, leave, vendors, headcount and more.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 10 }}>
                {QUESTIONS.map((q, i) => {
                  const Icon = ICONS[q.id] || Sparkles
                  return (
                    <button key={q.id} disabled={busy} onClick={() => ask(q)} className="askbubble-card"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%',
                        border: '1px solid var(--border)', borderRadius: 12, padding: '11px 13px',
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
              </div>
            </>
          ) : (
            messages.map(m => m.from === 'user' ? (
              <div key={m.id} className="askbubble-msg" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <div style={{
                  background: 'linear-gradient(135deg, var(--c1), #8b5cf6)', color: '#fff', borderRadius: '12px 4px 12px 12px',
                  padding: '10px 14px', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-line', maxWidth: '80%',
                  boxShadow: '0 2px 8px rgba(99,102,241,.25)',
                }}>
                  {m.text}
                </div>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, marginRight: 2 }}>{fmtTime(m.ts)}</span>
              </div>
            ) : (
              <div key={m.id} className="askbubble-msg" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--surface-2)', color: 'var(--c1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                  <Bot size={14} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '80%' }}>
                  <div style={{
                    background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '4px 12px 12px 12px',
                    padding: '10px 14px', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-line',
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
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, marginLeft: 2 }}>{fmtTime(m.ts)}</span>
                </div>
              </div>
            ))
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, padding: 16, alignItems: 'flex-end', borderTop: '1px solid var(--border)' }}>
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={e => { setInput(e.target.value); autoGrow(e.target) }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder="Ask anything about the company's data…"
            disabled={busy}
            className="form-input askbubble-textarea"
            style={{ flex: 1, minHeight: 40, maxHeight: 140, lineHeight: 1.4 }}
          />
          <button onClick={handleSend} disabled={busy || !input.trim()} className="btn btn-primary askbubble-send">
            <Send size={14} style={{ marginRight: 6 }} /> Ask
          </button>
        </div>
      </div>
    </div>
  )
}
