import { useState } from 'react'
import { dateFmt } from '../../lib/supabase'
import { assignRole, setPrimaryUnavailable } from '../../lib/goLive'
import { ROSTER_ROLES } from '../../lib/goLiveRules'
import { Modal, Toggle } from '../ui'
import { PersonSelect, Field, ErrorLine, errText } from './shared'
import { UserRound, Mail, Pencil, History } from 'lucide-react'

export default function RosterTab({ ctx }) {
  const { engagement, roster, cur, lookups, perms, reloadRoster } = ctx
  const [editing, setEditing] = useState(null)
  const [showHistory, setShowHistory] = useState(false)
  const [error, setError] = useState('')
  const person = id => lookups.people.find(p => p.id === id)
  const editable = perms.canManage && !['CLOSED', 'CANCELLED'].includes(engagement.status)

  async function toggleUnavailable(row, v) {
    setError('')
    try { await setPrimaryUnavailable(row, v); await reloadRoster() } catch (e) { setError(errText(e)) }
  }

  const Avatar = ({ p, tag }) => (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <div style={{ width: 34, height: 34, borderRadius: 999, background: 'var(--surface-2)', color: 'var(--c1)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13 }}>
        {p ? p.full_name.split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase() : <UserRound size={15} />}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{p?.full_name || <span style={{ color: 'var(--ink-muted)' }}>Not assigned</span>} <span style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 500 }}>{tag}</span></div>
        {p?.email && <div style={{ fontSize: 11, color: 'var(--ink-muted)', display: 'flex', gap: 4, alignItems: 'center' }}><Mail size={11} /> {p.email}</div>}
      </div>
    </div>
  )

  return (
    <div>
      <ErrorLine error={error} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 16 }}>
        {ROSTER_ROLES.map(r => {
          const row = cur[r.key]
          return (
            <div key={r.key} className="card">
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><div className="card-title">{r.label}</div><div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{row?.responsibility_note || r.note}</div></div>
                {editable && <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ role: r, row })}><Pencil size={12} /> {row ? 'Change' : 'Assign'}</button>}
              </div>
              <div className="card-body" style={{ display: 'grid', gap: 12 }}>
                <Avatar p={person(row?.primary_user_id)} tag={row?.primary_unavailable ? 'Primary · unavailable' : 'Primary'} />
                <Avatar p={person(row?.backup_user_id)} tag={row?.primary_unavailable ? 'Backup · covering now' : 'Backup'} />
                {row && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--ink-muted)' }}>
                    <span>Since {dateFmt(row.effective_from)}</span>
                    {editable && row.backup_user_id && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>Primary unavailable
                        <Toggle checked={row.primary_unavailable} onChange={v => toggleUnavailable(row, v)} label="Primary unavailable" /></span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <button className="btn btn-ghost btn-sm" onClick={() => setShowHistory(s => !s)}><History size={13} /> {showHistory ? 'Hide' : 'Show'} roster history</button>
      {showHistory && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="data-table" style={{ display: 'table', fontSize: 12.5 }}>
            <thead><tr><th>Role</th><th>Primary</th><th>Backup</th><th>From</th><th>To</th></tr></thead>
            <tbody>{roster.map(r => (
              <tr key={r.id}>
                <td>{ROSTER_ROLES.find(x => x.key === r.role)?.label || r.role}</td>
                <td>{person(r.primary_user_id)?.full_name || '—'}</td><td>{person(r.backup_user_id)?.full_name || '—'}</td>
                <td>{dateFmt(r.effective_from)}</td><td>{r.effective_to ? dateFmt(r.effective_to) : 'Current'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {editing && <AssignModal engagementId={engagement.id} role={editing.role} current={editing.row} people={lookups.people}
        onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reloadRoster() }} />}
    </div>
  )
}

function AssignModal({ engagementId, role, current, people, onClose, onSaved }) {
  const [form, setForm] = useState({
    primary_user_id: current?.primary_user_id || '', backup_user_id: current?.backup_user_id || '',
    responsibility_note: current?.responsibility_note || role.note,
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true); setError('')
    try { await assignRole(engagementId, role.key, form, current); await onSaved() } catch (e) { setError(errText(e)) }
    setBusy(false)
  }
  return (
    <Modal open title={`${role.label}`} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>Save</button></>}>
      <ErrorLine error={error} />
      {current && <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 0 }}>Changing the assignment keeps the current one in roster history.</p>}
      <Field label="Primary" required><PersonSelect people={people} value={form.primary_user_id} onChange={v => setForm(f => ({ ...f, primary_user_id: v }))} /></Field>
      <Field label="Backup" hint="Receives routing when the primary is unavailable"><PersonSelect people={people.filter(p => p.id !== form.primary_user_id)} value={form.backup_user_id} onChange={v => setForm(f => ({ ...f, backup_user_id: v }))} placeholder="No backup" /></Field>
      <Field label="Responsibility"><textarea className="form-textarea" value={form.responsibility_note} onChange={e => setForm(f => ({ ...f, responsibility_note: e.target.value }))} /></Field>
    </Modal>
  )
}
