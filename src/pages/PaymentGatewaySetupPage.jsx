import { useState, useEffect } from 'react'
import { getSecretStatus, setSecret } from '../lib/paymentGatewaySecrets'
import { timeFmt } from '../lib/supabase'
import { Loader, Alert } from '../components/ui'
import { KeyRound, CheckCircle2, Save, X, ShieldAlert } from 'lucide-react'

const PROVIDERS = [
  { key: 'razorpay', label: 'Razorpay', fields: [
    { key: 'key_id', label: 'Key ID', placeholder: 'rzp_test_xxxxxxxxxxxx' },
    { key: 'key_secret', label: 'Key Secret', placeholder: 'paste secret', secret: true },
    { key: 'webhook_secret', label: 'Webhook Secret', placeholder: 'from Razorpay webhook settings', secret: true },
  ] },
  { key: 'stripe', label: 'Stripe', fields: [
    { key: 'secret_key', label: 'Secret Key', placeholder: 'sk_test_xxxxxxxxxxxx', secret: true },
    { key: 'webhook_secret', label: 'Webhook Secret', placeholder: 'whsec_xxxxxxxxxxxx', secret: true },
  ] },
  { key: 'cashfree', label: 'Cashfree', fields: [
    { key: 'client_id', label: 'Client ID', placeholder: 'paste client ID' },
    { key: 'client_secret', label: 'Client Secret', placeholder: 'paste secret', secret: true },
    { key: 'webhook_secret', label: 'Webhook Secret', placeholder: 'from Cashfree webhook settings', secret: true },
    { key: 'env', label: 'Environment', select: ['TEST', 'PROD'], placeholder: 'TEST' },
  ] },
  { key: 'general', label: 'General', fields: [
    { key: 'app_url', label: 'App URL', placeholder: 'https://your-app-domain.com' },
  ] },
]

// Super-admin-only credential entry for the three payment gateways
// (STEP132) — replaces the `supabase secrets set ...` CLI step. Values
// are write-only: once saved, this screen (and every other query path)
// can never read them back, only report that a key IS set and when —
// same posture the app already uses for the Turnstile secret. Fields
// always render empty; typing something and clicking Save overwrites
// whatever was there, Clear removes it.
export default function PaymentGatewaySetupPage() {
  const [status, setStatus] = useState({}) // "provider:key" -> updated_at
  const [values, setValues] = useState({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [savingField, setSavingField] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setErr('')
    try {
      const rows = await getSecretStatus()
      const map = {}
      rows.forEach(r => { map[`${r.provider}:${r.key_name}`] = r.updated_at })
      setStatus(map)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  function fieldKey(provider, field) { return `${provider}:${field}` }

  async function handleSave(provider, field) {
    const fk = fieldKey(provider, field)
    const value = (values[fk] || '').trim()
    if (!value) return
    setSavingField(fk); setErr('')
    try {
      await setSecret(provider, field, value)
      setValues(v => ({ ...v, [fk]: '' }))
      await load()
    } catch (e) { setErr(e.message) }
    finally { setSavingField(null) }
  }

  async function handleClear(provider, field) {
    const fk = fieldKey(provider, field)
    setSavingField(fk); setErr('')
    try { await setSecret(provider, field, null); await load() }
    catch (e) { setErr(e.message) }
    finally { setSavingField(null) }
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><KeyRound size={22} /> Payment Gateway Setup</div>
          <div className="page-subtitle">Live API credentials for Razorpay, Stripe, and Cashfree — read only by the payment Edge Functions.</div>
        </div>
      </div>

      <Alert type="warning" message={<span><ShieldAlert size={13} style={{ verticalAlign: -2, marginRight: 4 }} />These are live credentials capable of creating real charges. Values are write-only — once saved, they can't be viewed again here or anywhere else, only replaced or cleared.</span>} />

      {err && <Alert type="error" message={err} />}

      <div style={{ display: 'grid', gap: 20, marginTop: 20 }}>
        {PROVIDERS.map(p => (
          <div key={p.key} className="card" style={{ padding: '18px 20px' }}>
            <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: 12 }}>{p.label}</div>
            <div style={{ display: 'grid', gap: 12 }}>
              {p.fields.map(f => {
                const fk = fieldKey(p.key, f.key)
                const isSet = !!status[fk]
                const saving = savingField === fk
                return (
                  <div key={f.key} style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 260px', minWidth: 220 }}>
                      <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {f.label}
                        {isSet ? (
                          <span style={{ fontSize: 11, color: '#16a34a', display: 'flex', alignItems: 'center', gap: 3 }}>
                            <CheckCircle2 size={12} /> Set · updated {timeFmt(status[fk])}
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Not set</span>
                        )}
                      </label>
                      {f.select ? (
                        <select className="form-input" value={values[fk] || ''} onChange={e => setValues(v => ({ ...v, [fk]: e.target.value }))}>
                          <option value="">{isSet ? '(unchanged)' : f.placeholder}</option>
                          {f.select.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      ) : (
                        <input className="form-input" type={f.secret ? 'password' : 'text'} autoComplete="off"
                          placeholder={isSet ? '••••••••  (enter a new value to replace)' : f.placeholder}
                          value={values[fk] || ''} onChange={e => setValues(v => ({ ...v, [fk]: e.target.value }))} />
                      )}
                    </div>
                    <button className="btn btn-primary btn-sm" disabled={saving || !(values[fk] || '').trim()} onClick={() => handleSave(p.key, f.key)}>
                      <Save size={13} /> {saving ? 'Saving…' : 'Save'}
                    </button>
                    {isSet && (
                      <button className="btn btn-ghost btn-sm" disabled={saving} onClick={() => handleClear(p.key, f.key)} title="Remove this credential">
                        <X size={13} /> Clear
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
