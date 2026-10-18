import { useEffect, useState } from 'react'
import { Modal } from '../ui'
import { syncAction, MESSAGE_STATUSES } from '../../lib/outlookEmail'

// Runs a made-up email through the real pipeline (classify → match project
// → create task / review / ignore) — only the Microsoft Graph fetch is
// skipped. Lets an admin try the flow before Entra ID is configured.
const PRESETS = (code, name) => [
  {
    label: 'Bug report with a project code',
    from_name: 'Ravi Kumar', from_email: 'ravi.kumar@customer-example.com',
    subject: `[Sample] ${code || 'PRJ-001'} dashboard shows Error 500 after the update`,
    body: `Hi team,\n\nSince this morning's update the live dashboard for ${code || 'PRJ-001'}${name ? ` (${name})` : ''} shows "Error 500" and does not load. Our supervisors cannot see the equipment status.\n\nPlease treat this as urgent.\n\nRegards,\nRavi Kumar`,
  },
  {
    label: 'Delay — no project named',
    from_name: 'Anita Shah', from_email: 'anita@unknown-customer.com',
    subject: '[Sample] Gateway delivery delayed again',
    body: 'Hello,\n\nThe gateways promised for last week have still not been delivered and our installation is blocked. When will they arrive?\n\nThanks,\nAnita',
  },
  {
    label: 'Newsletter / thank-you (should be ignored)',
    from_name: 'Priya', from_email: 'priya@customer-example.com',
    subject: '[Sample] Thank you!',
    body: 'Thank you for the quick visit yesterday, have a great weekend.\n\nPriya',
  },
]

export default function SampleEmailModal({ mailboxes, projects, onClose, onDone }) {
  const open = projects.filter(p => ['active', 'planning', 'in_progress'].includes(String(p.status || 'active').toLowerCase()))
  const presets = PRESETS(open[0]?.code, open[0]?.name)
  const [mailboxId, setMailboxId] = useState(mailboxes[0]?.id || '')
  const [f, setF] = useState(presets[0])
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { if (!mailboxId && mailboxes[0]) setMailboxId(mailboxes[0].id) }, [mailboxes]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))

  async function run() {
    setBusy(true); setErr(''); setRes(null)
    try {
      const r = await syncAction('simulate', { mailbox_id: mailboxId, email: { from_name: f.from_name, from_email: f.from_email, subject: f.subject, body: f.body } })
      setRes(r.message || r.result); onDone?.()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  const st = res && (MESSAGE_STATUSES[res.status] || { label: res.status, tone: 'gray' })
  return (
    <Modal open onClose={onClose} title="Send a sample email" size="lg"
      footer={<><button className="btn btn-ghost" onClick={onClose}>Close</button><button className="btn btn-primary" disabled={busy || !mailboxId} onClick={run}>{busy ? 'Processing…' : 'Run through the pipeline'}</button></>}>
      <div className="olk-hint" style={{ marginTop: 0 }}>The email goes through the same classification, project matching and task creation as real mail; only the Microsoft fetch is skipped. A real task is created when it matches a project — samples are marked "Sample".</div>
      {err && <div className="olk-msg error">{err}</div>}
      {res && (
        <div className="olk-reason" style={{ marginBottom: 12 }}>
          <b>Result</b> <span className={`gl-pill ${st.tone}`}>{st.label}</span> {res.decision_reason}
          {res.classifier && <span className="gl-meta"> · classified by {res.classifier}{res.confidence != null ? ` (${Math.round(res.confidence * 100)}%)` : ''}</span>}
        </div>
      )}
      <div className="form-row">
        <div className="form-group"><label className="form-label">Mailbox</label>
          <select className="form-select" value={mailboxId} onChange={e => setMailboxId(e.target.value)}>
            {mailboxes.map(m => <option key={m.id} value={m.id}>{m.mailbox_address}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">Start from</label>
          <select className="form-select" value="" onChange={e => e.target.value !== '' && setF(presets[Number(e.target.value)])}>
            <option value="">Pick a sample…</option>{presets.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
          </select></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Sender name</label><input className="form-input" value={f.from_name} onChange={e => set('from_name', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Sender email</label><input className="form-input" value={f.from_email} onChange={e => set('from_email', e.target.value)} /></div>
      </div>
      <div className="form-group"><label className="form-label">Subject</label><input className="form-input" value={f.subject} onChange={e => set('subject', e.target.value)} /></div>
      <div className="form-group"><label className="form-label">Body</label><textarea className="form-textarea" rows={8} value={f.body} onChange={e => set('body', e.target.value)} /></div>
    </Modal>
  )
}
