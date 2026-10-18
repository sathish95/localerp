import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { Toggle, Confirm } from '../ui'
import {
  CATEGORIES, ASSIGN_MODES, AI_PROVIDERS, NEW_MAILBOX, listMailboxes, saveMailbox, deleteMailbox, setClientSecret, secretStatus,
  rotateClientState, syncAction, loadLookups, INBOX_ROLES,
} from '../../lib/outlookEmail'
import { Plus, PlugZap, RefreshCw, Inbox, Unplug, Save, Trash2, KeyRound, Copy } from 'lucide-react'

const when = t => (t ? new Date(t).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—')
const WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL || 'https://<project-ref>.supabase.co'}/functions/v1/outlook-webhook`
const SUB_TONE = { ACTIVE: 'green', ERROR: 'red', REMOVED: 'amber', NONE: 'gray' }

// Settings → Outlook Email (and the Mailbox tab of NeoX Email Intelligence): the
// mailbox connection, its Graph subscription and the processing rules.
// Admin/ceo edit; managers see the status read-only (RLS enforces the same).
export default function OutlookSettings() {
  const { profile } = useAuth()
  const canEdit = ['admin', 'ceo'].includes(profile?.role)
  const [boxes, setBoxes] = useState(null)
  const [selId, setSelId] = useState(null)
  const [form, setForm] = useState(null)
  const [lookups, setLookups] = useState({ projects: [], people: [] })
  const [secret, setSecret] = useState('')
  const [hasSecret, setHasSecret] = useState(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function load(keepId) {
    try {
      const list = await listMailboxes()
      setBoxes(list)
      const pick = list.find(b => b.id === (keepId ?? selId)) || list[0] || null
      setSelId(pick?.id || null)
      setForm(pick ? { ...pick } : (canEdit ? { ...NEW_MAILBOX } : null))
    } catch (e) {
      setBoxes([]); setMsg({ type: 'error', text: /outlook_mailboxes/.test(e.message) ? 'Run sql/STEP261_outlook_email_automation.sql first.' : e.message })
    }
  }
  useEffect(() => { load(); loadLookups().then(setLookups).catch(() => {}) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSecret(''); setHasSecret(null)
    if (form?.id && canEdit) secretStatus(form.id).then(s => setHasSecret(!!s.has_secret)).catch(() => setHasSecret(null))
  }, [form?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const run = async (key, fn, okText) => {
    setBusy(key); setMsg(null)
    try { const r = await fn(); if (okText) setMsg({ type: 'success', text: typeof okText === 'function' ? okText(r) : okText }) } catch (e) { setMsg({ type: 'error', text: e.message }) }
    setBusy('')
  }

  async function save() {
    await run('save', async () => {
      const saved = await saveMailbox(form)
      if (secret.trim()) { await setClientSecret(saved.id, secret.trim()); setSecret('') }
      await load(saved.id)
    }, 'Saved.')
  }

  if (boxes === null) return <div className="card" style={{ padding: 20 }}>Loading…</div>
  const sel = boxes.find(b => b.id === selId)
  const dirty = form && sel && JSON.stringify(Object.keys(NEW_MAILBOX).map(k => form[k])) !== JSON.stringify(Object.keys(NEW_MAILBOX).map(k => sel[k]))

  return (
    <div className="olk">
      {msg && <div className={`olk-msg ${msg.type}`}>{msg.text}</div>}

      {boxes.length > 0 && (
        <div className="olk-boxes">
          {boxes.map(b => (
            <button key={b.id} type="button" className={`chip-toggle ${b.id === selId ? 'on' : ''}`} onClick={() => { setSelId(b.id); setForm({ ...b }); setMsg(null) }}>
              <Inbox size={12} /> {b.display_name || b.mailbox_address}{!b.enabled && ' · off'}
            </button>
          ))}
          {canEdit && <button type="button" className={`chip-toggle ${!form?.id ? 'on' : ''}`} onClick={() => { setSelId(null); setForm({ ...NEW_MAILBOX }); setMsg(null) }}><Plus size={12} /> Add mailbox</button>}
        </div>
      )}

      {!form && <div className="card" style={{ padding: 20, color: 'var(--ink-muted)' }}>No mailbox is connected yet. An admin can add one here.</div>}

      {form && sel && (
        <div className="card olk-status">
          <Stat label="Processing" value={<span className={`gl-pill ${sel.enabled ? 'green' : 'gray'}`}>{sel.enabled ? (sel.auto_create ? 'On · creates tasks' : 'On · review only') : 'Off'}</span>} />
          <Stat label="Connection" value={sel.last_test_at ? <span className={`gl-pill ${sel.last_test_ok ? 'green' : 'red'}`}>{sel.last_test_ok ? 'OK' : 'Failed'}</span> : <span className="gl-pill gray">Not tested</span>} sub={sel.last_test_at ? `tested ${when(sel.last_test_at)}` : null} />
          <Stat label="New-mail subscription" value={<span className={`gl-pill ${SUB_TONE[sel.subscription_status] || 'gray'}`}>{sel.subscription_status === 'NONE' ? 'Not subscribed' : sel.subscription_status.toLowerCase()}</span>}
            sub={sel.subscription_expires_at ? `expires ${when(sel.subscription_expires_at)} · renewed ${when(sel.subscription_renewed_at)}` : 'renewed automatically'} />
          <Stat label="Last notification" value={when(sel.last_notification_at)} sub={`missed-mail check ${when(sel.last_reconciled_at)}`} />
          {sel.last_error && <div className="olk-error"><b>Last error</b> {when(sel.last_error_at)} — {sel.last_error}</div>}
          <div className="olk-actions">
            {canEdit && <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => run('test', async () => { const r = await syncAction('test', { mailbox_id: sel.id }); await load(sel.id); if (!r.ok) throw new Error(r.error); return r }, r => `Connected — Inbox has ${r.inbox?.total ?? '?'} emails.`)}><PlugZap size={13} /> {busy === 'test' ? 'Testing…' : 'Test connection'}</button>}
            {canEdit && <button className="btn btn-ghost btn-sm" disabled={!!busy || !sel.enabled} title={sel.enabled ? '' : 'Turn processing on first'} onClick={() => run('sub', async () => { const r = await syncAction('subscribe', { mailbox_id: sel.id }); await load(sel.id); if (!r.ok) throw new Error(r.error) }, 'Subscribed to new mail.')}><RefreshCw size={13} /> {sel.subscription_id ? 'Re-subscribe' : 'Subscribe'}</button>}
            <button className="btn btn-ghost btn-sm" disabled={!!busy || !sel.enabled} onClick={() => run('rec', async () => { const r = await syncAction('reconcile', { mailbox_id: sel.id }); await load(sel.id); return r }, r => `Checked the Inbox: ${r.found} email(s) since the last check, ${r.added} new.`)}><Inbox size={13} /> {busy === 'rec' ? 'Checking…' : 'Check for missed mail'}</button>
            {canEdit && sel.subscription_id && <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => run('unsub', async () => { await syncAction('unsubscribe', { mailbox_id: sel.id }); await load(sel.id) }, 'Subscription removed.')}><Unplug size={13} /> Unsubscribe</button>}
          </div>
        </div>
      )}

      {form && (
        <fieldset className="olk-form" disabled={!canEdit}>
          <section className="card">
            <h3>Microsoft 365 connection</h3>
            <p className="olk-hint">An app registration in Microsoft Entra ID with the <b>Mail.Read</b> application permission (admin-consented), limited to this mailbox with an Exchange Online application access policy. Leave tenant / client blank to use the MS_GRAPH_* function secrets.</p>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Mailbox address *</label><input className="form-input" value={form.mailbox_address || ''} onChange={e => set('mailbox_address', e.target.value)} placeholder="support@yourcompany.com" /></div>
              <div className="form-group"><label className="form-label">Display name</label><input className="form-input" value={form.display_name || ''} onChange={e => set('display_name', e.target.value)} placeholder="Customer support" /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Directory (tenant) ID</label><input className="form-input" value={form.tenant_id || ''} onChange={e => set('tenant_id', e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" /></div>
              <div className="form-group"><label className="form-label">Application (client) ID</label><input className="form-input" value={form.client_id || ''} onChange={e => set('client_id', e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" /></div>
            </div>
            {canEdit && (
              <div className="form-group">
                <label className="form-label">Client secret {hasSecret && <span className="gl-pill green" style={{ marginLeft: 6 }}>saved</span>}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="form-input" type="password" autoComplete="new-password" value={secret} onChange={e => setSecret(e.target.value)}
                    placeholder={hasSecret ? 'Saved — type a new value to replace it' : 'Paste the secret value (never shown again)'} />
                  {form.id && hasSecret && <button type="button" className="btn btn-ghost btn-sm" onClick={() => run('clr', async () => { await setClientSecret(form.id, ''); setHasSecret(false) }, 'Secret cleared — the MS_GRAPH_CLIENT_SECRET function secret is used instead.')}>Clear</button>}
                </div>
                <div className="olk-hint">Stored server-side only; nobody can read it back. Saved together with the form.</div>
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Notification URL (set automatically on Subscribe)</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="form-input" readOnly value={WEBHOOK_URL} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(WEBHOOK_URL)}><Copy size={13} /></button>
              </div>
            </div>
          </section>

          <section className="card">
            <h3>Processing</h3>
            <label className="olk-switch"><Toggle checked={form.enabled} onChange={v => set('enabled', v)} label="Process incoming mail" /> <span><b>Process incoming mail</b><br /><span className="olk-hint">Only mail received after this is first turned on is processed.</span></span></label>
            <label className="olk-switch"><Toggle checked={form.auto_create} onChange={v => set('auto_create', v)} label="Create tasks automatically" /> <span><b>Create action items automatically</b><br /><span className="olk-hint">Off = every actionable email waits in the review queue for a person to approve.</span></span></label>
            <div className="form-group">
              <label className="form-label">Email types that create action items</label>
              <div className="olk-chips">
                {Object.entries(CATEGORIES).map(([k, l]) => (
                  <button key={k} type="button" className={`chip-toggle ${form.categories?.includes(k) ? 'on' : ''}`}
                    onClick={() => set('categories', form.categories?.includes(k) ? form.categories.filter(c => c !== k) : [...(form.categories || []), k])}>{l}</button>
                ))}
              </div>
            </div>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Minimum confidence to create without review</label>
                <select className="form-select" value={String(form.min_confidence)} onChange={e => set('min_confidence', Number(e.target.value))}>
                  {[0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95].map(v => <option key={v} value={String(v)}>{Math.round(v * 100)}%</option>)}
                </select></div>
              <div className="form-group"><label className="form-label">Classifier</label>
                <select className="form-select" value={form.ai_provider} onChange={e => set('ai_provider', e.target.value)}>
                  {Object.entries(AI_PROVIDERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <div className="olk-hint">Keys come from Settings → AI / LLM Keys. Email text is sent to the chosen provider.</div></div>
            </div>
          </section>

          <section className="card">
            <h3>Action items</h3>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Assign to</label>
                <select className="form-select" value={form.assign_mode} onChange={e => set('assign_mode', e.target.value)}>
                  {Object.entries(ASSIGN_MODES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select></div>
              <div className="form-group"><label className="form-label">Default person</label>
                <select className="form-select" value={form.default_assignee_id || ''} onChange={e => set('default_assignee_id', e.target.value || null)}>
                  <option value="">— none —</option>{lookups.people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Priority when the email doesn't make it clear</label>
                <select className="form-select" value={form.default_priority} onChange={e => set('default_priority', e.target.value)}>
                  {['low', 'medium', 'high', 'critical'].map(p => <option key={p} value={p}>{p}</option>)}
                </select></div>
              <div className="form-group"><label className="form-label">Due date when the email gives none</label>
                <select className="form-select" value={form.default_due_days ?? ''} onChange={e => set('default_due_days', e.target.value === '' ? null : Number(e.target.value))}>
                  <option value="">No due date</option>{[1, 2, 3, 5, 7, 14].map(d => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''} after the email</option>)}
                </select></div>
              <div className="form-group"><label className="form-label">Initial status</label>
                <input className="form-input" value={form.default_status || ''} onChange={e => set('default_status', e.target.value)} placeholder="backlog" /></div>
            </div>
          </section>

          <section className="card">
            <h3>Review queue & retention</h3>
            <div className="form-group">
              <label className="form-label">Tell these people when an email needs review</label>
              <div className="olk-chips">
                {(form.notify_user_ids || []).map(id => {
                  const p = lookups.people.find(x => x.id === id)
                  return <button key={id} type="button" className="chip-toggle on" onClick={() => set('notify_user_ids', form.notify_user_ids.filter(x => x !== id))}>{p?.full_name || 'Unknown'} ×</button>
                })}
                <select className="form-select" style={{ width: 'auto', minWidth: 200 }} value="" onChange={e => e.target.value && set('notify_user_ids', [...(form.notify_user_ids || []), e.target.value])}>
                  <option value="">+ Add person…</option>
                  {lookups.people.filter(p => !(form.notify_user_ids || []).includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </div>
            </div>
            {Array.isArray(form.inbox_roles) && (
              <div className="form-group">
                <label className="form-label">Who can open this mailbox in the Outlook Email tab and reply internally</label>
                <div className="olk-chips">
                  {INBOX_ROLES.map(r => {
                    const always = ['admin', 'ceo', 'manager', 'department_head'].includes(r)
                    const on = always || form.inbox_roles.includes(r)
                    return <button key={r} type="button" disabled={always} title={always ? 'Always has access' : ''} className={`chip-toggle ${on ? 'on' : ''}`}
                      onClick={() => set('inbox_roles', on ? form.inbox_roles.filter(x => x !== r) : [...form.inbox_roles, r])} style={{ textTransform: 'capitalize' }}>{r.replace('_', ' ')}</button>
                  })}
                </div>
              </div>
            )}
            <div className="form-group" style={{ maxWidth: 320 }}><label className="form-label">Keep email text for</label>
              <select className="form-select" value={form.retention_days} onChange={e => set('retention_days', Number(e.target.value))}>
                {[30, 60, 90, 180, 365].map(d => <option key={d} value={d}>{d} days</option>)}
              </select>
              <div className="olk-hint">After this the body excerpt is erased and ignored emails are deleted; tasks keep their own description.</div></div>
          </section>

          {canEdit && (
            <div className="olk-savebar">
              {form.id && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(true)}><Trash2 size={13} /> Remove mailbox</button>}
              {form.id && <button type="button" className="btn btn-ghost btn-sm" title="Issue a new webhook secret and re-subscribe" disabled={!!busy}
                onClick={() => run('rot', async () => { await rotateClientState(form.id); if (sel?.enabled) { const r = await syncAction('subscribe', { mailbox_id: form.id }); if (!r.ok) throw new Error(r.error) } await load(form.id) }, 'Webhook secret rotated.')}><KeyRound size={13} /> Rotate webhook secret</button>}
              <div style={{ flex: 1 }} />
              <button type="button" className="btn btn-primary" disabled={!!busy || !form.mailbox_address?.trim() || (form.id && !dirty && !secret.trim())} onClick={save}><Save size={14} /> {busy === 'save' ? 'Saving…' : form.id ? 'Save changes' : 'Add mailbox'}</button>
            </div>
          )}
        </fieldset>
      )}

      <Confirm open={confirmDelete} danger message={`Remove ${form?.mailbox_address}? Processing stops; created tasks stay. Unsubscribe first so Graph stops sending notifications.`}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => { setConfirmDelete(false); await run('del', async () => { if (sel?.subscription_id) { try { await syncAction('unsubscribe', { mailbox_id: sel.id }) } catch { /* function not deployed */ } } await deleteMailbox(form.id); setSelId(null); await load(null) }, 'Mailbox removed.') }} />
    </div>
  )
}

function Stat({ label, value, sub }) {
  return (
    <div className="olk-stat">
      <div className="olk-stat-label">{label}</div>
      <div className="olk-stat-value">{value}</div>
      {sub && <div className="olk-stat-sub">{sub}</div>}
    </div>
  )
}
