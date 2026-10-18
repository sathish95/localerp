import { useState } from 'react'
import { FileSignature, Mail, ShieldCheck } from 'lucide-react'
import { publicSendCode, publicSign, publicDecline } from '../../lib/esign'
import SignaturePad from './SignaturePad'

// Signature + email code + consent + decline, by signer token. Used by the
// public page /sign/:token and by the Agreements & e-Sign tab (STEP274).
export default function SignPanel({ token, doc, me, onDone }) {
  const [sig, setSig] = useState(null)
  const [typedName, setTypedName] = useState(me.name || '')
  const [consent, setConsent] = useState(false)
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')

  const sendCode = async () => {
    setBusy('code'); setMsg(null)
    try { const r = await publicSendCode(token); setCodeSent(r.sent_to); setMsg({ ok: true, text: `Code sent to ${r.sent_to}. It can take up to a minute to arrive.` }) }
    catch (e) { setMsg({ ok: false, text: e.message }) }
    setBusy('')
  }
  const sign = async () => {
    setMsg(null)
    if (!sig?.png) return setMsg({ ok: false, text: 'Add your signature first' })
    if (!consent) return setMsg({ ok: false, text: 'Tick the box to agree to sign electronically' })
    if (doc.require_otp && !/^\d{6}$/.test(code.trim())) return setMsg({ ok: false, text: 'Enter the 6-digit code from your email' })
    setBusy('sign')
    try {
      const r = await publicSign(token, { code: code.trim(), typedName, png: sig.png, kind: sig.kind, consent })
      if (!r.ok) { setMsg({ ok: false, text: r.error }); setBusy(''); return }
      setBusy('')
      onDone?.(r.completed ? 'Signed. Everyone has now signed — you can download the signed PDF.' : 'Signed. The other parties have been notified.')
    } catch (e) { setMsg({ ok: false, text: e.message }); setBusy('') }
  }
  const decline = async () => {
    setBusy('decline'); setMsg(null)
    try { await publicDecline(token, reason); setBusy(''); onDone?.('You declined this document. The sender has been told.') }
    catch (e) { setMsg({ ok: false, text: e.message }); setBusy('') }
  }

  if (declining) return (
    <div className="esg-public-card">
      <h3>Decline to sign</h3>
      <textarea className="form-input form-textarea" placeholder="Tell the sender why" value={reason} onChange={e => setReason(e.target.value)} />
      {msg && <div className={`olk-msg ${msg.ok ? 'success' : 'error'}`}>{msg.text}</div>}
      <div className="esg-row" style={{ marginTop: 8 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setDeclining(false)}>Back</button>
        <button className="btn btn-danger btn-sm" disabled={!!busy} onClick={decline}>Decline</button>
      </div>
    </div>
  )
  return (
    <div className="esg-public-card">
      <h3><FileSignature size={15} /> Sign as {me.name}</h3>
      <label className="form-label">Full name</label>
      <input className="form-input" value={typedName} onChange={e => setTypedName(e.target.value)} />
      <label className="form-label" style={{ marginTop: 10 }}>Signature</label>
      <SignaturePad name={typedName} onChange={setSig} />
      {doc.require_otp && (
        <div className="esg-otp">
          <label className="form-label"><ShieldCheck size={13} /> Email code</label>
          <div className="esg-otp-row">
            <input className="form-input" inputMode="numeric" maxLength={6} placeholder="6-digit code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
            <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={sendCode}><Mail size={13} /> {codeSent ? 'Send again' : 'Email me a code'}</button>
          </div>
        </div>
      )}
      <label className="esg-consent">
        <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
        <span>I have read this document and agree to sign it electronically. My electronic signature is legally binding, the same as a handwritten one.</span>
      </label>
      {msg && <div className={`olk-msg ${msg.ok ? 'success' : 'error'}`}>{msg.text}</div>}
      <button className="btn btn-primary esg-wide" disabled={!!busy} onClick={sign}>{busy === 'sign' ? 'Signing…' : 'Sign document'}</button>
      <button className="btn btn-ghost btn-sm esg-wide" onClick={() => { setDeclining(true); setMsg(null) }}>Decline to sign</button>
    </div>
  )
}
