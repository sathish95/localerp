import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { resolveException } from '../../lib/emailIntelligence'
import { parseBankRequest, bankChangeRisk, maskAccount, BANK_CHECKS } from '../../lib/eiInsights'
import { fullTime } from './ui'
import { ShieldAlert, ShieldCheck, Phone, Building2, CheckCircle2, XOctagon, AlertTriangle, Circle, Lock, ExternalLink } from 'lucide-react'

const LEVEL = { high: ['High risk', 'red'], medium: ['Medium risk', 'amber'], low: ['Low risk', 'green'] }

// Bank-detail / vendor-master change request: a fraud control, not a form.
// Compares what is on file with what the email asks for, lists the risk
// signals, walks the reviewer through call-back verification and records the
// decision (with the call details) in the audit trail. Nothing here edits the
// vendor master — a genuine change still goes through its normal approval.
export default function BankChangeReview({ x, em, canFinance, onDone }) {
  const [vendor, setVendor] = useState(undefined)
  const [prior, setPrior] = useState(0)
  const [checks, setChecks] = useState({})
  const [call, setCall] = useState({ spokeTo: '', at: '' })
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const vendorId = x.detail?.sender_vendor_id || em?.vendor_id || null
  const open = x.status === 'OPEN'

  useEffect(() => {
    if (!vendorId) { setVendor(null); return }
    supabase.from('vendors').select('id, name, code, email, phone, bank_name, bank_account, bank_ifsc, gst_number, status').eq('id', vendorId).maybeSingle()
      .then(({ data }) => setVendor(data || null))
    supabase.from('ei_exceptions').select('id, detail').eq('kind', 'BANK_DETAIL_CHANGE').neq('id', x.id)
      .then(({ data }) => setPrior((data || []).filter(e => e.detail?.sender_vendor_id === vendorId).length))
  }, [vendorId, x.id])

  const requested = useMemo(() => parseBankRequest(`${em?.subject || ''}\n${em?.body_excerpt || ''}`), [em])
  const risk = useMemo(() => bankChangeRisk({ email: em || {}, vendor, requested, priorRequests: prior }), [em, vendor, requested, prior])
  const [lvlLabel, lvlTone] = LEVEL[risk.level]
  const all = BANK_CHECKS.every(c => checks[c.key])
  const callDone = checks.callback && call.spokeTo.trim()

  async function decide(kind) {
    setBusy(true); setErr('')
    const done = BANK_CHECKS.filter(c => checks[c.key]).map(c => c.key).join(', ') || 'none'
    const text = [
      kind === 'genuine' ? 'DECISION: Genuine request — change to be applied through the vendor master approval.' : 'DECISION: Not requested by the vendor — treated as a fraud attempt; no change made.',
      `Checks: ${done}.`,
      `Call-back: spoke to ${call.spokeTo.trim()}${vendor?.phone ? ` on ${vendor.phone} (vendor master)` : ''}${call.at ? ` at ${call.at.replace('T', ' ')}` : ''}.`,
      `Risk at review: ${risk.level} (${risk.signals.filter(s => s.level !== 'ok').map(s => s.text).join('; ') || 'no signals'}).`,
      note.trim() ? `Notes: ${note.trim()}` : null,
    ].filter(Boolean).join(' ')
    try { await resolveException(x.id, 'RESOLVED', text); await onDone() } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <div className="bcr">
      <div className={`bcr-hero ${lvlTone}`}>
        <ShieldAlert size={22} />
        <div className="bcr-hero-t">
          <div className="bcr-hero-h">Payment-redirection check <span className={`bcr-level ${lvlTone}`}>{lvlLabel}</span></div>
          <div className="bcr-hero-d">Fraudsters impersonate vendors to divert payments. Verify by calling a number you already hold — never one from the email — before anything changes.</div>
        </div>
      </div>

      <section className="bcr-sec">
        <div className="bcr-sec-h">Risk signals</div>
        <ul className="bcr-signals">
          {vendor === undefined && <li className="gl-meta">Checking the vendor master…</li>}
          {vendor !== undefined && risk.signals.map((s, i) => (
            <li key={i} className={s.level}>{s.level === 'ok' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}<span>{s.text}</span></li>
          ))}
        </ul>
      </section>

      <section className="bcr-sec">
        <div className="bcr-sec-h">On file vs requested</div>
        <div className="bcr-vendor">
          <span className="bcr-vendor-ic"><Building2 size={16} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="bcr-vendor-n">{vendor ? vendor.name : 'No vendor identified'}</div>
            <div className="gl-meta">{vendor ? [vendor.code, vendor.gst_number, vendor.email].filter(Boolean).join(' · ') : `Request came from ${em?.sender_email || 'an unknown sender'}`}</div>
          </div>
          {vendor?.phone && <a className="btn btn-ghost btn-sm" href={`tel:${vendor.phone.replace(/\s/g, '')}`}><Phone size={12} /> {vendor.phone}</a>}
        </div>
        <table className="bcr-compare">
          <thead><tr><th /><th><Lock size={11} /> On file (vendor master)</th><th>Requested in email</th></tr></thead>
          <tbody>
            {[['Bank', vendor?.bank_name, requested.bank], ['Account', maskAccount(vendor?.bank_account), maskAccount(requested.account)], ['IFSC', vendor?.bank_ifsc, requested.ifsc]].map(([k, a, b]) => {
              const diff = a && b && String(a).replace(/[•\s]/g, '').slice(-4) !== String(b).replace(/[•\s]/g, '').slice(-4)
              return <tr key={k}><td>{k}</td><td>{a || <span className="gl-st-zero">not on file</span>}</td><td className={diff ? 'diff' : ''}>{b || <span className="gl-st-zero">not stated</span>}{diff && <span className="bcr-diff">changed</span>}</td></tr>
            })}
          </tbody>
        </table>
        <div className="bcr-foot"><Lock size={11} /> Account numbers are masked. The email's details are shown only for comparison — nothing is copied into the vendor master.</div>
      </section>

      {em && <section className="bcr-sec">
        <div className="bcr-sec-h">The request <span className="gl-meta">· {em.sender_email} · {fullTime(em.received_at)}</span></div>
        <pre className="bcr-email">{em.body_excerpt || em.subject}</pre>
        {em.web_link && <a className="bcr-link" href={em.web_link} target="_blank" rel="noopener noreferrer"><ExternalLink size={11} /> Open the original in Outlook (check headers; do not click links in it)</a>}
      </section>}

      {open ? (canFinance ? (
        <section className="bcr-sec">
          <div className="bcr-sec-h">Verification</div>
          <ol className="bcr-steps">
            {BANK_CHECKS.map((c, i) => (
              <li key={c.key} className={checks[c.key] ? 'done' : ''}>
                <label>
                  <input type="checkbox" checked={!!checks[c.key]} onChange={e => setChecks(o => ({ ...o, [c.key]: e.target.checked }))} />
                  <span className="bcr-step-n">{checks[c.key] ? <CheckCircle2 size={16} /> : <Circle size={16} />}</span>
                  <span><b>{i + 1}. {c.label}</b>{c.hint && <span className="gl-meta"> {c.hint}</span>}</span>
                </label>
              </li>
            ))}
          </ol>
          <div className="form-row" style={{ marginTop: 10 }}>
            <div className="form-group"><label className="form-label">Spoke to (name, role) *</label><input className="form-input" value={call.spokeTo} onChange={e => setCall({ ...call, spokeTo: e.target.value })} placeholder="e.g. R. Kumar, Accounts Manager" /></div>
            <div className="form-group"><label className="form-label">Call time</label><input className="form-input" type="datetime-local" value={call.at} onChange={e => setCall({ ...call, at: e.target.value })} /></div>
          </div>
          <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Anything the auditor should know" /></div>
          {err && <div className="olk-msg error">{err}</div>}
          <div className="bcr-decide">
            <button className="btn bcr-fraud" disabled={busy || !callDone} title={callDone ? '' : 'Record the call-back first'} onClick={() => decide('fraud')}><XOctagon size={14} /> Not requested — fraud attempt</button>
            <button className="btn btn-primary" disabled={busy || !all || !callDone} title={all ? '' : 'Complete every verification step'} onClick={() => decide('genuine')}><ShieldCheck size={14} /> Genuine — change via approval</button>
          </div>
          <div className="bcr-foot">Both decisions are written to the audit trail with the checks and call details. The vendor master is not edited here.</div>
        </section>
      ) : (
        <div className="eic-callout"><Lock size={14} /><span>Only admin, CEO or finance can verify vendor bank changes.</span></div>
      )) : (
        <div className={`eic-callout ${/fraud/i.test(x.resolution_note || '') ? 'bad' : ''}`}><b>{/fraud/i.test(x.resolution_note || '') ? 'Fraud attempt' : 'Verified'}</b><span>{x.resolution_note}</span></div>
      )}
    </div>
  )
}
