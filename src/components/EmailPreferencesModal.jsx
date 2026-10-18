import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { Modal, Loader } from './ui'
import { EMAIL_CATEGORIES, getMyEmailPrefs, saveMyEmailPrefs } from '../lib/email'

// Each user's own notification-email preferences (STEP228 email_preferences).
// Opened from the notification bell.

const MODES = [
  { key: 'instant', label: 'As they happen', desc: 'One email for each notification' },
  { key: 'digest', label: 'Daily summary', desc: 'One email a day with everything since the last one' },
  { key: 'off', label: 'Off', desc: 'In-app notifications only' },
]
const hourLabel = h => new Date(2000, 0, 1, h).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

export default function EmailPreferencesModal({ onClose }) {
  const { profile } = useAuth()
  const [prefs, setPrefs] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => { getMyEmailPrefs(profile.id).then(setPrefs).catch(e => setErr(e.message)) }, [profile.id])

  const toggle = key => setPrefs(p => ({ ...p, muted_categories: p.muted_categories.includes(key) ? p.muted_categories.filter(k => k !== key) : [...p.muted_categories, key] }))

  async function save() {
    setSaving(true); setErr('')
    try { await saveMyEmailPrefs(profile.id, profile.organization_id, prefs); setSaved(true); setTimeout(onClose, 700) }
    catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  const row = { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', marginBottom: 8 }
  return (
    <Modal open onClose={onClose} title="Email preferences">
      {!prefs ? (err ? <div className="alert alert-danger">{err}</div> : <Loader />) : (
        <div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 14 }}>
            Emails go to <b style={{ color: 'var(--text)' }}>{profile.email}</b>. Your organization's admin also has to turn email on.
          </div>

          <div style={{ fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 8 }}>Send notification emails</div>
          {MODES.map(m => (
            <label key={m.key} style={{ ...row, borderColor: prefs.mode === m.key ? '#a5b4fc' : 'var(--border)', background: prefs.mode === m.key ? '#f5f7ff' : '#fff' }}>
              <input type="radio" name="mode" checked={prefs.mode === m.key} onChange={() => setPrefs(p => ({ ...p, mode: m.key }))} style={{ accentColor: 'var(--c1)', marginTop: 3 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{m.label}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{m.desc}</div>
              </div>
              {m.key === 'digest' && prefs.mode === 'digest' && (
                <select className="form-select" style={{ width: 'auto', fontSize: 12.5, height: 32, padding: '0 28px 0 10px' }} value={prefs.digest_hour}
                  onClick={e => e.preventDefault()} onChange={e => setPrefs(p => ({ ...p, digest_hour: Number(e.target.value) }))} aria-label="Summary time">
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                </select>
              )}
            </label>
          ))}

          {prefs.mode !== 'off' && (
            <>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: '#334155', margin: '16px 0 8px' }}>Include</div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
                {EMAIL_CATEGORIES.map((c, i) => (
                  <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: i ? '1px solid #f1f5f9' : 'none', cursor: 'pointer' }}>
                    <input type="checkbox" checked={!prefs.muted_categories.includes(c.key)} onChange={() => toggle(c.key)} style={{ accentColor: 'var(--c1)' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{c.label}</div>
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>{c.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}

          {err && <div className="alert alert-danger" style={{ marginTop: 12 }}>{err}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saved ? 'Saved' : saving ? 'Saving…' : 'Save preferences'}</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
