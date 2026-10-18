import { useState } from 'react'
import { Modal } from '../ui'
import { setEngagementStatus, decideExit, deleteEngagement, reopenEngagement } from '../../lib/goLive'
import { istToday, addDays } from '../../lib/goLiveRules'
import { Field, ErrorLine, errText } from './shared'

// Confirm-with-reason modal for engagement lifecycle actions, shared by the
// engagement list and the engagement page.
const CONFIG = {
  cancel: { title: 'Cancel engagement', label: 'Reason', btn: 'Cancel engagement', danger: true, required: true },
  approve: { title: 'Approve hypercare exit', label: 'Comment (optional)', btn: 'Approve & close' },
  reject: { title: 'Send exit back', label: 'What needs to happen first', btn: 'Send back', danger: true, required: true },
  reopen: { title: 'Reopen hypercare', label: 'Why is hypercare being reopened?', btn: 'Reopen', required: true },
  delete: { title: 'Delete engagement', label: 'Reason for deleting', btn: 'Delete engagement', danger: true, required: true },
}

export default function EngagementActionModal({ kind, engagement, onClose, onDone }) {
  const cfg = CONFIG[kind]
  const [comment, setComment] = useState('')
  const [plannedEnd, setPlannedEnd] = useState(() => {
    const min = addDays(istToday(), 7)
    return engagement.hypercare_planned_end && engagement.hypercare_planned_end > min ? engagement.hypercare_planned_end : min
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function go() {
    setBusy(true); setError('')
    try {
      if (kind === 'cancel') await setEngagementStatus(engagement, 'CANCELLED', comment)
      else if (kind === 'delete') await deleteEngagement(engagement.id, comment)
      else if (kind === 'reopen') await reopenEngagement(engagement.id, comment, plannedEnd)
      else await decideExit(engagement.id, kind === 'approve', comment)
      await onDone(kind)
    } catch (e) { setError(errText(e)) }
    setBusy(false)
  }

  return (
    <Modal open title={`${cfg.title} · ${engagement.code}`} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Close</button>
        <button className={`btn ${cfg.danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy || (cfg.required && !comment.trim())} onClick={go}>{busy ? 'Working…' : cfg.btn}</button></>}>
      <ErrorLine error={error} />
      {kind === 'approve' && <p style={{ fontSize: 13, marginTop: 0 }}>Approving closes hypercare today and hands open P3/P4 incidents to <strong>{engagement.handover_to || 'steady-state support'}</strong>.</p>}
      {kind === 'delete' && <p style={{ fontSize: 13, marginTop: 0 }}>The engagement and its incidents disappear from Go-Live Support and scheduled reminders stop. Devices stay in the device master; history is kept for audit.</p>}
      {kind === 'reopen' && <p style={{ fontSize: 13, marginTop: 0 }}>Hypercare goes back to <strong>Active</strong>: daily checks, reminders and exit tracking start again. Any previous exit decision is cleared.</p>}
      <Field label={cfg.label} required={cfg.required}>
        <textarea className="form-textarea" value={comment} onChange={e => setComment(e.target.value)} />
      </Field>
      {kind === 'reopen' && (
        <Field label="New planned end" hint="Default: the old planned end, or a week from today if that has passed">
          <input type="date" className="form-input" min={istToday()} value={plannedEnd} onChange={e => setPlannedEnd(e.target.value)} />
        </Field>
      )}
    </Modal>
  )
}
