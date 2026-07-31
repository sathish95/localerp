import { useState, useEffect, useRef } from 'react'
import { submitPublicLead } from '../lib/publicLeadForm'
import { CheckCircle } from 'lucide-react'

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''
const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
const DEFAULT_STANDARD_FIELDS = { company: true, phone: true, email: true, message: true }

// The actual Turnstile-verified lead-capture form — extracted out of
// PublicLeadFormPage.jsx (STEP75/77's public_submit_lead() flow) so both
// the plain fixed-form page AND the Landing Page Builder's LeadForm block
// (src/components/landing-blocks/renderers.jsx) render the identical,
// already-verified submission flow instead of duplicating it.
//
// `formConfig` (STEP80) makes this config-driven: {standard_fields, custom_fields}
// from a LeadForm block. Omitted entirely on the plain-form path
// (PublicLeadFormPage.jsx's fallback for links with no builder page) —
// defaults to every standard field shown, no custom questions, matching
// the original behavior exactly.
export function PublicLeadCaptureForm({ slug, featuredProducts, formConfig }) {
  const std = { ...DEFAULT_STANDARD_FIELDS, ...(formConfig?.standard_fields || {}) }
  const customDefs = formConfig?.custom_fields || []

  const [form, setForm] = useState({ contact_name: '', company_name: '', phone: '', email: '', message: '', product_interest: '' })
  const [customValues, setCustomValues] = useState({})
  const [token, setToken] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const widgetRef = useRef(null)
  const widgetId = useRef(null)

  // Load the Turnstile script once, then render the widget into widgetRef.
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return
    function render() {
      if (widgetId.current != null || !window.turnstile || !widgetRef.current) return
      widgetId.current = window.turnstile.render(widgetRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (t) => setToken(t),
        'expired-callback': () => setToken(''),
      })
    }
    if (window.turnstile) { render(); return }
    let script = document.querySelector(`script[src="${TURNSTILE_SCRIPT_SRC}"]`)
    if (!script) {
      script = document.createElement('script')
      script.src = TURNSTILE_SCRIPT_SRC
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
    script.addEventListener('load', render)
    return () => script.removeEventListener('load', render)
  }, [])

  function setCustom(key, v) { setCustomValues(prev => ({ ...prev, [key]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setErr('')
    if (!form.contact_name.trim()) { setErr('Please enter your name.'); return }
    const phoneShown = std.phone, emailShown = std.email
    if ((phoneShown || emailShown) && !form.phone.trim() && !form.email.trim()) {
      setErr('Please enter a phone number or email so we can reach you.'); return
    }
    for (const f of customDefs) {
      if (f.required && !String(customValues[f.key] || '').trim()) { setErr(`Please fill in "${f.label}".`); return }
    }
    if (!token) { setErr('Please complete the verification challenge.'); return }
    setSubmitting(true)
    try {
      await submitPublicLead({
        slug, contactName: form.contact_name, companyName: std.company ? form.company_name : '',
        phone: std.phone ? form.phone : '', email: std.email ? form.email : '',
        message: std.message ? form.message : '',
        productInterest: form.product_interest, turnstileToken: token,
        customFields: customValues,
      })
      setDone(true)
    } catch (e) {
      setErr(e.message || 'Something went wrong — please try again.')
      if (window.turnstile && widgetId.current != null) window.turnstile.reset(widgetId.current)
      setToken('')
    } finally { setSubmitting(false) }
  }

  if (done) {
    return (
      <div style={{ textAlign: 'center', padding: 20 }}>
        <CheckCircle size={40} color="#15803d" style={{ marginBottom: 12 }} />
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 6 }}>Thanks, {form.contact_name.split(' ')[0]}!</div>
        <div style={{ color: '#64748b', fontSize: 14 }}>We've received your details and someone from our team will be in touch shortly.</div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit}>
      {err && <div style={{ background: '#fee2e2', color: '#dc2626', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, marginBottom: 14 }}>{err}</div>}
      <div className="form-group"><label className="form-label">Name *</label>
        <input className="form-input" value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} required /></div>
      {std.company && <div className="form-group"><label className="form-label">Company</label>
        <input className="form-input" value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} /></div>}
      {(std.phone || std.email) && (
        <div className="form-row">
          {std.phone && <div className="form-group"><label className="form-label">Phone</label>
            <input className="form-input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>}
          {std.email && <div className="form-group"><label className="form-label">Email</label>
            <input className="form-input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>}
        </div>
      )}
      {featuredProducts?.length > 0 && (
        <div className="form-group"><label className="form-label">What are you interested in?</label>
          <select className="form-select" value={form.product_interest} onChange={e => setForm(f => ({ ...f, product_interest: e.target.value }))}>
            <option value="">Select…</option>
            {featuredProducts.map(p => <option key={p.part_number} value={p.part_number}>{p.name}</option>)}
          </select></div>
      )}
      {std.message && <div className="form-group"><label className="form-label">Message</label>
        <textarea className="form-textarea" value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))} placeholder="Tell us a bit about what you need" /></div>}

      {customDefs.map(f => (
        <div className="form-group" key={f.key}>
          <label className="form-label">{f.label}{f.required ? ' *' : ''}</label>
          {f.type === 'textarea' ? (
            <textarea className="form-textarea" value={customValues[f.key] || ''} onChange={e => setCustom(f.key, e.target.value)} />
          ) : f.type === 'select' ? (
            <select className="form-select" value={customValues[f.key] || ''} onChange={e => setCustom(f.key, e.target.value)}>
              <option value="">Select…</option>
              {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : f.type === 'checkbox' ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={!!customValues[f.key]} onChange={e => setCustom(f.key, e.target.checked)} /> Yes
            </label>
          ) : (
            <input className="form-input" type={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text'} value={customValues[f.key] || ''} onChange={e => setCustom(f.key, e.target.value)} />
          )}
        </div>
      ))}

      {TURNSTILE_SITE_KEY ? (
        <div ref={widgetRef} style={{ margin: '14px 0' }} />
      ) : (
        <div style={{ fontSize: 11, color: '#dc2626', margin: '14px 0' }}>Form verification isn't configured (VITE_TURNSTILE_SITE_KEY missing).</div>
      )}

      <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: '100%' }}>
        {submitting ? 'Submitting…' : 'Submit'}
      </button>
    </form>
  )
}
