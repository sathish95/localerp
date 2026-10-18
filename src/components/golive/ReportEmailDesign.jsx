import { useState, useEffect, useMemo } from 'react'
import { previewReportPayload, sendReportEmail } from '../../lib/goLive'
import { goLiveDailyEmail, GOLIVE_EMAIL_TEMPLATES } from '../../../supabase/functions/_shared/goLiveEmails.ts'
import { useAppName } from '../../context/BrandingContext'
import { dateFmt } from '../../lib/supabase'
import { Loader } from '../ui'
import { errText } from './shared'
import { LayoutTemplate, Mail, Check, Monitor, Smartphone } from 'lucide-react'

// Share Report → Daily report email → "Email design": pick one of the three
// designs and see it rendered with this engagement's real data — the same
// renderer the send-email worker uses (supabase/functions/_shared/goLiveEmails.ts),
// fed by golive_report_email_preview() (STEP257), so what you see is what is sent.
export default function ReportEmailDesign({ engagement, date, value, onChange, canEdit, toName }) {
  const appName = useAppName()
  const [view, setView] = useState('internal')
  const [width, setWidth] = useState('desktop')
  const [payload, setPayload] = useState(undefined)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    setPayload(undefined); setErr('')
    previewReportPayload(engagement.id, date, view === 'customer')
      .then(p => { if (live) setPayload(p) })
      .catch(e => { if (live) { setErr(/golive_report_email_preview|schema cache|does not exist/i.test(e?.message || '') ? 'The preview needs sql/STEP257_golive_report_email_designs.sql — run it in the Supabase SQL Editor.' : errText(e)); setPayload(null) } })
    return () => { live = false }
  }, [engagement.id, date, view])

  const rendered = useMemo(() => {
    if (!payload) return null
    try {
      const org = { orgName: appName || 'ThingsAlive', fromName: appName || 'ThingsAlive', appUrl: window.location.origin, timezone: 'Asia/Kolkata' }
      return goLiveDailyEmail(org, payload, view === 'customer' ? null : toName, value)
    } catch (e) { return { error: e.message } }
  }, [payload, value, view, appName, toName])

  async function sendMe() {
    setBusy(true); setMsg('')
    try { await sendReportEmail(engagement.id, date, 'ME', null, value); setMsg(`“${GOLIVE_EMAIL_TEMPLATES.find(t => t.key === value)?.label}” sent to you`) }
    catch (e) { setMsg(errText(e)) }
    setBusy(false)
  }

  return (
    <div className="gl-red">
      <div className="gl-re-h"><LayoutTemplate size={13} /> Email design</div>
      <div className="gl-red-grid">
        <div>
          <div className="gl-red-opts" role="radiogroup" aria-label="Email design">
            {GOLIVE_EMAIL_TEMPLATES.map(t => (
              <button key={t.key} type="button" role="radio" aria-checked={value === t.key} disabled={!canEdit && value !== t.key}
                className={`gl-red-opt${value === t.key ? ' on' : ''}`} onClick={() => canEdit && onChange(t.key)}>
                <span className="gl-red-radio">{value === t.key && <Check size={11} />}</span>
                <span><b>{t.label}{t.key === 'brief' ? <em>Recommended</em> : null}</b><small>{t.desc}</small></span>
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '10px 0 8px' }}>
            Preview uses the real data for {dateFmt(date)}. Save to use this design for scheduled and list sends.
          </div>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !payload} onClick={sendMe}><Mail size={12} /> {busy ? 'Sending…' : 'Send this design to me'}</button>
          {msg && <div style={{ fontSize: 12, marginTop: 6, color: /sent to you/.test(msg) ? '#047857' : '#b91c1c' }}>{msg}</div>}
        </div>

        <div className="gl-red-preview">
          <div className="gl-red-bar">
            <div className="gl-seg">
              <button type="button" className={view === 'internal' ? 'on' : ''} onClick={() => setView('internal')}>Team copy</button>
              <button type="button" className={view === 'customer' ? 'on' : ''} onClick={() => setView('customer')}>Customer copy</button>
            </div>
            <div className="gl-seg">
              <button type="button" className={width === 'desktop' ? 'on' : ''} onClick={() => setWidth('desktop')} aria-label="Desktop width"><Monitor size={12} /></button>
              <button type="button" className={width === 'mobile' ? 'on' : ''} onClick={() => setWidth('mobile')} aria-label="Phone width"><Smartphone size={12} /></button>
            </div>
          </div>
          {rendered?.subject && <div className="gl-red-subject"><span>Subject</span>{rendered.subject}</div>}
          <div className="gl-red-frame">
            {payload === undefined ? <div style={{ padding: 40 }}><Loader /></div>
              : err ? <div className="gl-re-empty" style={{ margin: 16 }}>{err}</div>
              : rendered?.error ? <div className="gl-re-empty" style={{ margin: 16 }}>Preview failed: {rendered.error}</div>
              : <iframe title="Email preview" sandbox="" srcDoc={rendered.html} style={{ width: width === 'mobile' ? 390 : '100%' }} />}
          </div>
        </div>
      </div>
    </div>
  )
}
