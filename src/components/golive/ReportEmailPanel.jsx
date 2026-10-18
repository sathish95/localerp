import { useState, useEffect } from 'react'
import {
  reportEmailSettings, saveReportEmailSettings, sendReportEmail, previewReportRecipients, listReportEmailLog,
} from '../../lib/goLive'
import { istToday, istDateTime } from '../../lib/goLiveRules'
import { dateFmt } from '../../lib/supabase'
import { Loader } from '../ui'
import { Field, PersonSelect, errText } from './shared'
import { Mail, Send, Clock, Users, X, CheckCircle2, History, Save } from 'lucide-react'
import ReportEmailDesign from './ReportEmailDesign'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const splitEmails = t => [...new Set(t.split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean))]

// Share Report tab → "Report email": the engagement's stored recipient list,
// the daily schedule, send-now and the send history (STEP256). The email body
// is the complete report — executive overview + the day's summary.
export default function ReportEmailPanel({ ctx }) {
  const { engagement, lookups, perms, reloadEngagement } = ctx
  const [form, setForm] = useState(() => reportEmailSettings(engagement))
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [rcpt, setRcpt] = useState(null)
  const [log, setLog] = useState(null)
  const [date, setDate] = useState(istToday())
  const [adhoc, setAdhoc] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)
  const can = perms.canManage
  const person = id => lookups.people.find(p => p.id === id)?.full_name

  useEffect(() => { setForm(reportEmailSettings(engagement)); setDirty(false) }, [engagement.id, engagement.version])
  const loadSide = () => {
    previewReportRecipients(engagement.id).then(setRcpt).catch(() => setRcpt([]))
    listReportEmailLog(engagement.id).then(setLog).catch(() => setLog([]))
  }
  useEffect(loadSide, [engagement.id, engagement.version])

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setDirty(true) }
  const addEmails = () => {
    const list = splitEmails(draft)
    const bad = list.filter(e => !EMAIL_RE.test(e))
    const good = list.filter(e => EMAIL_RE.test(e) && !form.emails.includes(e))
    if (good.length) set('emails', [...form.emails, ...good])
    setDraft(bad.join(', '))
    setMsg(bad.length ? { error: `Not a valid email: ${bad.join(', ')}` } : null)
  }

  async function save() {
    if (draft.trim()) { setMsg({ error: 'Press Add for the email address you typed, or clear it, before saving' }); return }
    setBusy('save'); setMsg(null)
    try {
      await saveReportEmailSettings(engagement, form)
      await reloadEngagement(); setDirty(false)
      setMsg({ ok: form.enabled ? `Saved — the report goes out every day at ${form.send_time} IST` : 'Saved — daily sending is off; you can still send manually' })
    } catch (e) { setMsg({ error: errText(e) }) }
    setBusy('')
  }

  async function send(mode) {
    const emails = mode === 'LIST' ? splitEmails(adhoc) : null
    if (mode === 'LIST' && (!emails.length || emails.some(e => !EMAIL_RE.test(e)))) { setMsg({ error: 'Enter valid email addresses to send to' }); return }
    if (mode === 'ALL' && dirty) { setMsg({ error: 'Save the recipient list first — "Send to list" uses the saved list' }); return }
    setBusy(mode); setMsg(null)
    try {
      const n = await sendReportEmail(engagement.id, date, mode, emails)
      setMsg({ ok: `Report for ${dateFmt(date)} queued for ${n} recipient${n === 1 ? '' : 's'} — it arrives within a minute` })
      if (mode === 'LIST') setAdhoc('')
      loadSide()
    } catch (e) { setMsg({ error: errText(e) }) }
    setBusy('')
  }

  const lastSched = (log || []).find(l => l.kind === 'SCHEDULED')
  const internal = (rcpt || []).filter(r => r.id), external = (rcpt || []).filter(r => !r.id)

  return (
    <div className="card gl-re" style={{ marginBottom: 14 }}>
      <div className="gl-re-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="gl-re-icon"><Mail size={16} /></span>
          <div>
            <div className="gl-re-title">Daily report email</div>
            <div className="gl-re-sub">The complete report — executive overview and the day's summary — to a saved list, every day and on demand.</div>
          </div>
        </div>
        <span className="gl-pill" style={engagement.config?.report_email?.enabled ? { color: '#047857', background: '#ecfdf5' } : { color: 'var(--ink-muted)', background: '#f1f5f9' }}>
          {engagement.config?.report_email?.enabled ? `Daily at ${engagement.config.report_email.send_time || '19:00'} IST` : 'Daily sending off'}
        </span>
      </div>

      {msg && <div className="gl-re-msg" style={msg.error ? { color: '#b91c1c', background: '#fef2f2' } : { color: '#047857', background: '#ecfdf5' }}>{msg.error || msg.ok}</div>}

      <div className="gl-re-grid">
        {/* ── Settings ── */}
        <div className="gl-re-col">
          <div className="gl-re-h"><Clock size={13} /> Schedule</div>
          <label className="gl-re-check"><input type="checkbox" disabled={!can} checked={form.enabled} onChange={e => set('enabled', e.target.checked)} /> Send automatically every day while hypercare is active</label>
          <div className="form-row">
            <Field label="Send time (IST)"><input type="time" className="form-input" disabled={!can} value={form.send_time} onChange={e => set('send_time', e.target.value || '19:00')} /></Field>
            <Field label="Report covers">
              <select className="form-select" disabled={!can} value={form.report_day} onChange={e => set('report_day', e.target.value)}>
                <option value="TODAY">Today (as of send time)</option>
                <option value="YESTERDAY">Yesterday (full day)</option>
              </select>
            </Field>
          </div>

          <div className="gl-re-h" style={{ marginTop: 6 }}><Users size={13} /> Recipients</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
            <label className="gl-re-check"><input type="checkbox" disabled={!can} checked={form.to_pm} onChange={e => set('to_pm', e.target.checked)} /> Project manager</label>
            <label className="gl-re-check"><input type="checkbox" disabled={!can} checked={form.to_roster} onChange={e => set('to_roster', e.target.checked)} /> Support roster (primary + backup)</label>
          </div>
          <Field label="People in the app">
            {form.user_ids.length > 0 && (
              <div className="gl-re-chips">{form.user_ids.map(id => (
                <span key={id} className="gl-re-chip">{person(id) || 'Unknown'}{can && <button type="button" aria-label="Remove" onClick={() => set('user_ids', form.user_ids.filter(x => x !== id))}><X size={11} /></button>}</span>
              ))}</div>
            )}
            {can && <PersonSelect people={lookups.people.filter(p => !form.user_ids.includes(p.id))} value="" onChange={v => v && set('user_ids', [...form.user_ids, v])} placeholder="Add a person…" />}
          </Field>
          <Field label="Email addresses" hint="Customer contacts, site leads, anyone outside the app. Paste several separated by commas.">
            {form.emails.length > 0 && (
              <div className="gl-re-chips">{form.emails.map(e => (
                <span key={e} className="gl-re-chip ext">{e}{can && <button type="button" aria-label="Remove" onClick={() => set('emails', form.emails.filter(x => x !== e))}><X size={11} /></button>}</span>
              ))}</div>
            )}
            {can && (
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="form-input" value={draft} placeholder="name@customer.com" onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEmails() } }} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={addEmails} disabled={!draft.trim()}>Add</button>
              </div>
            )}
          </Field>
          <Field label="Email addresses receive">
            <select className="form-select" disabled={!can} value={form.external_view} onChange={e => set('external_view', e.target.value)}>
              <option value="CUSTOMER">Customer view — customer-visible incidents only, no internal names or comments</option>
              <option value="FULL">Full internal report</option>
            </select>
          </Field>
        </div>

        {/* ── Send now + who gets it + history ── */}
        <div className="gl-re-col">
          <div className="gl-re-h"><Send size={13} /> Send now</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Report for</span>
            <input type="date" className="form-input" style={{ width: 160, height: 34 }} max={istToday()} value={date} onChange={e => setDate(e.target.value || istToday())} />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => send('ME')}><Mail size={12} /> {busy === 'ME' ? 'Sending…' : 'Send to me'}</button>
            {can && <button className="btn btn-primary btn-sm" disabled={!!busy || !(rcpt || []).length} onClick={() => send('ALL')}><Send size={12} /> {busy === 'ALL' ? 'Sending…' : `Send to list${rcpt ? ` (${rcpt.length})` : ''}`}</button>}
          </div>
          {can && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              <input className="form-input" value={adhoc} placeholder="Or send once to: a@x.com, b@y.com" onChange={e => setAdhoc(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send('LIST') }} />
              <button className="btn btn-ghost btn-sm" disabled={!!busy || !adhoc.trim()} onClick={() => send('LIST')}>{busy === 'LIST' ? 'Sending…' : 'Send'}</button>
            </div>
          )}

          <div className="gl-re-h"><CheckCircle2 size={13} /> Saved list resolves to {rcpt ? `· ${rcpt.length}` : ''}</div>
          {!rcpt ? <Loader /> : !rcpt.length ? <div className="gl-re-empty">Nobody yet — tick PM / roster or add people and addresses, then Save.</div> : (
            <div className="gl-re-list">
              {internal.map(r => <div key={r.email}><span>{r.full_name || r.email}</span><small>{r.email} · full report</small></div>)}
              {external.map(r => <div key={r.email}><span>{r.email}</span><small>external · {form.external_view === 'FULL' ? 'full report' : 'customer view'}</small></div>)}
            </div>
          )}

          <div className="gl-re-h" style={{ marginTop: 14 }}><History size={13} /> Send history{lastSched ? ` · last scheduled ${dateFmt(lastSched.report_date)}` : ''}</div>
          {!log ? <Loader /> : !log.length ? <div className="gl-re-empty">No reports sent yet.</div> : (
            <div className="gl-re-list">
              {log.map(l => (
                <div key={l.id} title={(l.emails || []).join('\n')}>
                  <span>{dateFmt(l.report_date)} · {l.kind === 'SCHEDULED' ? 'Scheduled' : 'Manual'} · {l.recipients} recipient{l.recipients === 1 ? '' : 's'}</span>
                  <small>{istDateTime(l.created_at)}{l.sent_by ? ` · ${person(l.sent_by) || ''}` : ''}</small>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ReportEmailDesign engagement={engagement} date={date} value={form.template || 'brief'} onChange={v => set('template', v)} canEdit={can} toName={ctx.profile?.full_name} />

      {can && (
        <div className="gl-re-foot">
          <span>{dirty ? 'You have unsaved changes to the schedule, recipients or design.' : 'Schedule, recipients and design are saved.'}</span>
          <button className="btn btn-primary btn-sm" disabled={busy === 'save' || !dirty} onClick={save}><Save size={12} /> {busy === 'save' ? 'Saving…' : 'Save settings'}</button>
        </div>
      )}
    </div>
  )
}
