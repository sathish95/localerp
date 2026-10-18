import { useState } from 'react'
import { Modal, Badge } from '../ui'
import { addDeviceNote, updateDeviceNote, deleteDeviceNote, deviceLabel, NOTE_SEVERITIES } from '../../lib/goLive'
import { CATEGORIES, labelOf, istDateTime } from '../../lib/goLiveRules'
import { IncidentForm } from './IncidentsTab'
import { EnumSelect, ErrorLine, Chip, errText } from './shared'
import { AlertTriangle, CheckCircle2, RotateCcw, Siren, Pencil, Trash2, MessageSquarePlus } from 'lucide-react'

const SEVERITY_TO_PRIORITY = { HIGH: 'P2_HIGH', MEDIUM: 'P3_NORMAL', LOW: 'P4_REQUEST' }

// Open issue count per enrollment, for badges in device lists.
export function noteCounts(notes) {
  const out = {}
  for (const n of notes) {
    const c = (out[n.enrollment_id] ||= { notes: 0, openIssues: 0, high: 0 })
    c.notes++
    if (n.is_issue && n.issue_status === 'OPEN') { c.openIssues++; if (n.severity === 'HIGH') c.high++ }
  }
  return out
}

export function NotesBadge({ count }) {
  if (!count?.notes) return <span style={{ color: 'var(--ink-muted)', fontSize: 12 }}>Add</span>
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {count.openIssues > 0 && <Chip tone={count.high ? 'red' : 'amber'}>{count.openIssues} open issue{count.openIssues > 1 ? 's' : ''}</Chip>}
      <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{count.notes} note{count.notes > 1 ? 's' : ''}</span>
    </span>
  )
}

// Per-device comment thread. Any note can be flagged as an issue
// (category + severity), resolved / reopened, or escalated to an incident.
export default function DeviceNotesModal({ ctx, enrollment, notes, onClose, onChanged }) {
  const { engagement, lookups, perms, profile } = ctx
  const mine = notes.filter(n => n.enrollment_id === enrollment.id)
  const [filter, setFilter] = useState('all')
  const [form, setForm] = useState({ body: '', isIssue: false, category: '', severity: 'MEDIUM' })
  const [editing, setEditing] = useState(null) // { id, body }
  const [resolving, setResolving] = useState(null) // { note, text }
  const [escalating, setEscalating] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const canWrite = !['CANCELLED'].includes(engagement.status)
  const person = id => lookups.people.find(p => p.id === id)?.full_name || '—'
  const canEdit = n => n.created_by === profile.id || perms.canManage

  const shown = mine.filter(n => filter === 'all' || (filter === 'issues' ? n.is_issue : n.is_issue && n.issue_status === 'OPEN'))
  const openCount = mine.filter(n => n.is_issue && n.issue_status === 'OPEN').length

  async function run(fn) {
    setBusy(true); setError('')
    try { await fn(); await onChanged() } catch (e) { setError(errText(e)) }
    setBusy(false)
  }
  const add = () => run(async () => {
    await addDeviceNote({ engagementId: engagement.id, enrollmentId: enrollment.id, body: form.body, isIssue: form.isIssue, category: form.category, severity: form.severity }, profile.id)
    setForm({ body: '', isIssue: false, category: '', severity: 'MEDIUM' })
  })

  if (escalating) {
    const n = escalating
    return (
      <IncidentForm ctx={ctx} title={`Raise incident from issue · ${deviceLabel(enrollment.device)}`}
        prefill={{
          title: `${deviceLabel(enrollment.device)}: ${n.body.split('\n')[0].slice(0, 80)}`,
          device_enrollment_ids: [enrollment.id], site: enrollment.site || '',
          category: n.issue_category || 'HARDWARE', priority: SEVERITY_TO_PRIORITY[n.severity] || 'P3_NORMAL',
          issue_business_impact: n.body,
        }}
        onClose={() => setEscalating(null)}
        onSaved={async inc => {
          if (inc) await updateDeviceNote(n, { incident_id: inc.id })
          setEscalating(null); await onChanged(true)
        }} />
    )
  }

  return (
    <Modal open size="lg" title={`Notes & issues · ${deviceLabel(enrollment.device)}`} onClose={onClose}>
      <ErrorLine error={error} />
      <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 12 }}>
        {enrollment.device?.serial_number}{enrollment.site ? ` · ${enrollment.site}` : ''}{enrollment.equipment_id ? ` · ${enrollment.equipment_id}` : ''}
      </div>

      {canWrite && (
        <div className="card" style={{ padding: 12, marginBottom: 14 }}>
          <textarea className="form-textarea" placeholder="Add a comment about this device…" value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, fontWeight: 600 }}>
              <input type="checkbox" checked={form.isIssue} onChange={e => setForm(f => ({ ...f, isIssue: e.target.checked }))} /> <AlertTriangle size={13} color="#d97706" /> This is an issue
            </label>
            {form.isIssue && <>
              <EnumSelect options={CATEGORIES} value={form.category} placeholder="Category" onChange={v => setForm(f => ({ ...f, category: v }))} style={{ width: 150, fontSize: 12 }} />
              <EnumSelect options={NOTE_SEVERITIES} value={form.severity} placeholder="Severity" onChange={v => setForm(f => ({ ...f, severity: v || 'MEDIUM' }))} style={{ width: 120, fontSize: 12 }} />
            </>}
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary btn-sm" disabled={busy || !form.body.trim()} onClick={add}><MessageSquarePlus size={13} /> {form.isIssue ? 'Log issue' : 'Add comment'}</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {[['all', `All (${mine.length})`], ['issues', `Issues (${mine.filter(n => n.is_issue).length})`], ['open', `Open issues (${openCount})`]].map(([k, l]) => (
          <button key={k} className={`chip-toggle ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      {!shown.length ? <div style={{ fontSize: 13, color: 'var(--ink-muted)', padding: '12px 0' }}>{mine.length ? 'Nothing matches this filter.' : 'No comments on this device yet.'}</div> : shown.map(n => (
        <div key={n.id} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
            <strong>{person(n.created_by)}</strong>
            <span style={{ color: 'var(--ink-muted)' }}>{istDateTime(n.created_at)}</span>
            {n.is_issue && <>
              <Badge type={n.issue_status === 'OPEN' ? 'danger' : 'success'}>{n.issue_status === 'OPEN' ? 'Open issue' : 'Resolved'}</Badge>
              <Badge type={NOTE_SEVERITIES.find(s => s.key === n.severity)?.badge || 'gray'}>{labelOf(NOTE_SEVERITIES, n.severity)} severity</Badge>
              {n.issue_category && <Chip>{labelOf(CATEGORIES, n.issue_category)}</Chip>}
            </>}
            {n.incident_id && <Chip title="Escalated to an incident">Incident raised</Chip>}
            <div style={{ flex: 1 }} />
            {canWrite && n.is_issue && n.issue_status === 'OPEN' && <>
              <button className="btn btn-ghost btn-sm" onClick={() => setResolving({ note: n, text: '' })}><CheckCircle2 size={12} /> Resolve</button>
              {!n.incident_id && <button className="btn btn-ghost btn-sm" onClick={() => setEscalating(n)}><Siren size={12} /> Raise incident</button>}
            </>}
            {canWrite && n.is_issue && n.issue_status === 'RESOLVED' && <button className="btn btn-ghost btn-sm" onClick={() => run(() => updateDeviceNote(n, { issue_status: 'OPEN' }))}><RotateCcw size={12} /> Reopen</button>}
            {canWrite && canEdit(n) && <>
              {!n.is_issue && <button className="btn btn-ghost btn-sm" title="Mark as issue" onClick={() => run(() => updateDeviceNote(n, { is_issue: true, severity: 'MEDIUM', issue_status: 'OPEN' }))}><AlertTriangle size={12} /></button>}
              <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => setEditing({ id: n.id, body: n.body })}><Pencil size={12} /></button>
              <button className="btn btn-ghost btn-sm" title="Delete" onClick={() => window.confirm('Delete this note?') && run(() => deleteDeviceNote(n))}><Trash2 size={12} /></button>
            </>}
          </div>
          {editing?.id === n.id ? (
            <div style={{ marginTop: 6 }}>
              <textarea className="form-textarea" value={editing.body} onChange={e => setEditing(x => ({ ...x, body: e.target.value }))} />
              <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {n.is_issue && <>
                  <EnumSelect options={CATEGORIES} value={editing.category ?? n.issue_category} placeholder="Category" onChange={v => setEditing(x => ({ ...x, category: v }))} style={{ width: 150, fontSize: 12 }} />
                  <EnumSelect options={NOTE_SEVERITIES} value={editing.severity ?? n.severity} placeholder="Severity" onChange={v => setEditing(x => ({ ...x, severity: v }))} style={{ width: 120, fontSize: 12 }} />
                </>}
                <button className="btn btn-primary btn-sm" disabled={busy || !editing.body.trim()} onClick={() => run(async () => {
                  await updateDeviceNote(n, { body: editing.body, ...(editing.category !== undefined ? { issue_category: editing.category } : {}), ...(editing.severity ? { severity: editing.severity } : {}) })
                  setEditing(null)
                })}>Save</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          ) : <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', marginTop: 4 }}>{n.body}</div>}
          {n.issue_status === 'RESOLVED' && (
            <div style={{ fontSize: 12, color: '#047857', marginTop: 4 }}>
              Resolved by {person(n.resolved_by)}{n.resolved_at ? ` · ${istDateTime(n.resolved_at)}` : ''}{n.resolution ? ` — ${n.resolution}` : ''}
            </div>
          )}
          {resolving?.note.id === n.id && (
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input className="form-input" autoFocus placeholder="How was it resolved? (optional)" value={resolving.text} onChange={e => setResolving(r => ({ ...r, text: e.target.value }))} />
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(async () => { await updateDeviceNote(n, { issue_status: 'RESOLVED', resolution: resolving.text }); setResolving(null) })}>Mark resolved</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setResolving(null)}>Cancel</button>
            </div>
          )}
        </div>
      ))}
    </Modal>
  )
}
