import { useState, useEffect, useRef } from 'react'

// Matches typed free text against a select step's chip options, so
// answering "which project?" doesn't require scrolling/tapping a long
// chip list — the user can type a few letters instead. Still only ever
// resolves to one of the real options (a startsWith/includes match),
// never free-text-guessed: ambiguous or no-match input is rejected
// rather than silently picking something.
function matchChipOption(query, options) {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const starts = options.filter(o => o.label.toLowerCase().startsWith(q))
  if (starts.length === 1) return starts[0]
  if (starts.length > 1) return null
  const includes = options.filter(o => o.label.toLowerCase().includes(q))
  if (includes.length === 1) return includes[0]
  return null
}

// Shared conversational engine behind every AI capability tab in the app
// chat bubble (AskBubble.jsx via AIActionTabs.jsx). Replaces the old
// per-capability form (all fields visible at once, one Generate button)
// with a real message thread: the bot asks one thing at a time, the
// user answers via tappable chips (for a real selection like "which
// project" — deliberately NOT free-text-guessed by the model, same
// safety principle the old forms already had) or free text (for
// descriptive content), and the drafted result appears as a message in
// the thread with Confirm/Start Over actions before anything saves.
//
// `steps`: static, ordered questions asked up front — each
//   { key, botMessage, type:'select'|'text', options?, placeholder?, optional? }
//   options is either an array of {value,label} or an async fn(answers).
// `onGenerate(answers)`: called once all static steps are answered.
//   Return one of:
//     { status:'ready', draft }                                    — show the draft, move to review
//     { status:'need-input', key, botMessage, type, options }       — ask ONE more dynamic question
//       (answering it calls onGenerate again with the merged answers — for
//       cases like Task Actions' "which of these 3 matching tasks?")
//     { status:'error', message }
// `renderDraft(draft, setDraft)`: renders the draft as the bot's message body.
// `onSave(answers, draft)`: called on Confirm — the actual write.
// `savedMessage`, `viewLabel`, `onView`: shown after a successful save.
export default function AIChatFlow({ steps, onGenerate, renderDraft, onSave, savedMessage, viewLabel, onView }) {
  const [messages, setMessages] = useState([])
  const [answers, setAnswers] = useState({})
  const [stepIdx, setStepIdx] = useState(0)
  const [dynamicQuestion, setDynamicQuestion] = useState(null) // set while onGenerate is asking a follow-up
  const [phase, setPhase] = useState('asking') // asking | generating | reviewing | saving | done | error
  const [draft, setDraft] = useState(null)
  const [textValue, setTextValue] = useState('')
  const [chipQuery, setChipQuery] = useState('')
  const [chipMatchError, setChipMatchError] = useState(false)
  const [busy, setBusy] = useState(false)
  const listRef = useRef(null)
  const idRef = useRef(0)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    askStep(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, busy])

  function nextId() { idRef.current += 1; return idRef.current }
  function pushBot(msg) { setMessages(m => [...m, { id: nextId(), from: 'bot', ...msg }]) }
  function pushUser(content) { setMessages(m => [...m, { id: nextId(), from: 'user', content }]) }

  // currentAnswers defaults to the `answers` state, but callers that just
  // called setAnswers() in this same tick must pass the merged value
  // explicitly — setState doesn't update the local `answers` binding
  // until the next render, so relying on the default here right after a
  // setAnswers() call would silently drop whatever was just submitted
  // (both from the options-for-a-dependent-step case, e.g. Vendor
  // Invoice's PO list needing the just-picked vendorId, and from the
  // final step -> onGenerate handoff).
  async function askStep(idx, currentAnswers = answers) {
    const step = steps[idx]
    if (!step) { await runGenerate(currentAnswers); return }
    let options = step.options
    if (typeof options === 'function') {
      setBusy(true)
      try { options = await options(currentAnswers) } finally { setBusy(false) }
    }
    pushBot({ kind: step.type, content: step.botMessage, options, optional: step.optional, placeholder: step.placeholder })
  }

  async function runGenerate(finalAnswers) {
    setPhase('generating'); setBusy(true)
    pushBot({ kind: 'typing' })
    try {
      const result = await onGenerate(finalAnswers)
      setMessages(m => m.filter(msg => msg.kind !== 'typing'))
      if (result.status === 'need-input') {
        setDynamicQuestion({ key: result.key })
        pushBot({ kind: result.type || 'select', content: result.botMessage, options: result.options })
        setPhase('asking')
      } else if (result.status === 'error') {
        pushBot({ kind: 'error', content: result.message })
        setPhase('error')
      } else {
        setDraft(result.draft)
        pushBot({ kind: 'draft', draft: result.draft })
        setPhase('reviewing')
      }
    } catch (e) {
      setMessages(m => m.filter(msg => msg.kind !== 'typing'))
      pushBot({ kind: 'error', content: e.message || 'Something went wrong.' })
      setPhase('error')
    } finally {
      setBusy(false)
    }
  }

  async function submitAnswer(value, label) {
    pushUser(label ?? (value === '' ? '(skipped)' : String(value)))
    const key = dynamicQuestion ? dynamicQuestion.key : steps[stepIdx].key
    const merged = { ...answers, [key]: value }
    setAnswers(merged)
    setTextValue('')
    setChipQuery(''); setChipMatchError(false)

    if (dynamicQuestion) {
      setDynamicQuestion(null)
      await runGenerate(merged)
      return
    }
    const next = stepIdx + 1
    setStepIdx(next)
    await askStep(next, merged)
  }

  async function retryLastStep() {
    // 'error' phase from onGenerate — re-ask the same dynamic question or
    // step rather than restarting the whole conversation.
    setPhase('asking')
    if (dynamicQuestion) { await runGenerate(answers); return }
    await askStep(stepIdx)
  }

  async function confirmSave() {
    setPhase('saving'); setBusy(true)
    pushBot({ kind: 'typing' })
    try {
      await onSave(answers, draft)
      setMessages(m => m.filter(msg => msg.kind !== 'typing'))
      pushBot({ kind: 'success', content: savedMessage || 'Saved.' })
      setPhase('done')
    } catch (e) {
      setMessages(m => m.filter(msg => msg.kind !== 'typing'))
      pushBot({ kind: 'error', content: `Couldn't save: ${e.message}` })
      setPhase('reviewing')
    } finally {
      setBusy(false)
    }
  }

  function startOver() {
    setMessages([]); setAnswers({}); setStepIdx(0); setDynamicQuestion(null)
    setDraft(null); setTextValue(''); setChipQuery(''); setChipMatchError(false); setPhase('asking')
    askStep(0, {})
  }

  function tryMatchChip() {
    const match = matchChipOption(chipQuery, activeMsg.options || [])
    if (match) { setChipQuery(''); setChipMatchError(false); submitAnswer(match.value, match.label) }
    else setChipMatchError(true)
  }

  const activeMsg = messages[messages.length - 1]
  const awaitingSelect = phase === 'asking' && activeMsg?.from === 'bot' && activeMsg.kind === 'select' && !busy
  const awaitingText = phase === 'asking' && activeMsg?.from === 'bot' && activeMsg.kind === 'text' && !busy

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 8 }}>
        {messages.map(m => <ChatMessage key={m.id} msg={m} liveDraft={draft} renderDraft={renderDraft} setDraft={setDraft} />)}
      </div>

      {awaitingSelect && (
        <div style={{ paddingTop: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(activeMsg.options || []).map(opt => (
              <button key={opt.value} onClick={() => submitAnswer(opt.value, opt.label)}
                style={{ padding: '7px 13px', borderRadius: 999, border: '1px solid var(--c1)', background: 'rgba(99,102,241,.08)', color: 'var(--c1)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                {opt.label}
              </button>
            ))}
            {activeMsg.optional && (
              <button onClick={() => submitAnswer('', 'Skip')}
                style={{ padding: '7px 13px', borderRadius: 999, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Skip
              </button>
            )}
          </div>
          {(activeMsg.options || []).length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={chipQuery} onChange={e => { setChipQuery(e.target.value); setChipMatchError(false) }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); tryMatchChip() } }}
                  placeholder="Or type to search the list above…"
                  style={{ flex: 1, padding: '7px 11px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12.5, fontFamily: 'inherit', outline: 'none' }} />
                <button onClick={tryMatchChip} disabled={!chipQuery.trim()}
                  style={{ padding: '7px 14px', borderRadius: 10, border: 'none', background: 'var(--c1)', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', opacity: chipQuery.trim() ? 1 : .5 }}>
                  Go
                </button>
              </div>
              {chipMatchError && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>No single match for that — try a different term or tap an option above.</div>}
            </div>
          )}
        </div>
      )}

      {awaitingText && (
        <div style={{ display: 'flex', gap: 8, paddingTop: 10 }}>
          <textarea autoFocus value={textValue} onChange={e => setTextValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (textValue.trim()) submitAnswer(textValue.trim()) } }}
            placeholder={activeMsg.placeholder || 'Type your answer…'}
            style={{ flex: 1, minHeight: 40, maxHeight: 100, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'vertical' }} />
          <button onClick={() => textValue.trim() && submitAnswer(textValue.trim())} disabled={!textValue.trim()}
            style={{ padding: '9px 16px', borderRadius: 10, border: 'none', background: 'var(--c1)', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', opacity: textValue.trim() ? 1 : .5, alignSelf: 'flex-end' }}>
            Send
          </button>
          {activeMsg.optional && (
            <button onClick={() => submitAnswer('', 'Skip')} style={{ alignSelf: 'flex-end', padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
              Skip
            </button>
          )}
        </div>
      )}

      {phase === 'reviewing' && (
        <div style={{ display: 'flex', gap: 8, paddingTop: 10 }}>
          <button onClick={confirmSave} style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: 'none', background: 'var(--c1)', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>
            ✓ Confirm
          </button>
          <button onClick={startOver} style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>
            Start Over
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div style={{ display: 'flex', gap: 8, paddingTop: 10 }}>
          <button onClick={retryLastStep} style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid var(--c1)', background: 'rgba(99,102,241,.08)', color: 'var(--c1)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>
            Try Again
          </button>
          <button onClick={startOver} style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>
            Start Over
          </button>
        </div>
      )}

      {phase === 'done' && (
        <div style={{ display: 'flex', gap: 8, paddingTop: 10 }}>
          {onView && <button onClick={onView} style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: 'none', background: 'var(--c1)', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>{viewLabel || 'View'}</button>}
          <button onClick={startOver} style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>
            ↻ New Request
          </button>
        </div>
      )}
    </div>
  )
}

function ChatMessage({ msg, liveDraft, renderDraft, setDraft }) {
  if (msg.from === 'user') {
    return (
      <div className="askbubble-msg" style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ background: 'linear-gradient(135deg, var(--c1), #8b5cf6)', color: '#fff', borderRadius: '12px 4px 12px 12px', padding: '9px 12px', fontSize: 12.5, lineHeight: 1.5, maxWidth: '85%' }}>
          {msg.content}
        </div>
      </div>
    )
  }

  // bot message
  return (
    <div className="askbubble-msg" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <div style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--surface-2)', color: 'var(--c1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1, fontSize: 12 }}>✨</div>
      <div style={{ maxWidth: '88%', minWidth: 0 }}>
        {msg.kind === 'typing' && (
          <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '4px 12px 12px 12px', padding: '10px 14px', display: 'inline-flex', gap: 4 }}>
            <span className="askbubble-dot" /><span className="askbubble-dot" /><span className="askbubble-dot" />
          </div>
        )}
        {(msg.kind === 'select' || msg.kind === 'text' || msg.kind === 'error' || msg.kind === 'success') && (
          <div style={{
            background: msg.kind === 'error' ? 'rgba(239,68,68,.08)' : msg.kind === 'success' ? 'rgba(16,185,129,.08)' : 'var(--surface-2)',
            border: `1px solid ${msg.kind === 'error' ? 'rgba(239,68,68,.3)' : msg.kind === 'success' ? 'rgba(16,185,129,.3)' : 'var(--border)'}`,
            borderRadius: '4px 12px 12px 12px', padding: '9px 12px', fontSize: 12.5, lineHeight: 1.5,
            color: msg.kind === 'error' ? '#ef4444' : msg.kind === 'success' ? '#10b981' : 'var(--text)',
          }}>
            {msg.content}
          </div>
        )}
        {msg.kind === 'draft' && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px 12px 12px 12px', padding: 12 }}>
            {renderDraft(liveDraft ?? msg.draft, setDraft)}
          </div>
        )}
      </div>
    </div>
  )
}
