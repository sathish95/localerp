import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { listRestrictions, addRestriction, removeRestriction } from '../../lib/wikiRestrictions'
import { Modal } from '../ui'
import { Lock, X, Plus } from 'lucide-react'

const ROLES = ['admin', 'ceo', 'manager', 'department_head', 'finance', 'hr', 'employee']

export default function PageRestrictions({ pageId, profile }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState([])
  const [users, setUsers] = useState([])
  const [permission, setPermission] = useState('view')
  const [subjectType, setSubjectType] = useState('user')
  const [subjectId, setSubjectId] = useState('')

  useEffect(() => { if (open) load() }, [open])
  async function load() {
    const [r, u] = await Promise.all([
      listRestrictions(pageId),
      supabase.from('profiles').select('id,full_name').order('full_name'),
    ])
    setRows(r); setUsers(u.data || [])
  }

  function nameFor(row) {
    if (row.subject_type === 'role') return row.subject_id.replace(/_/g, ' ')
    return users.find(u => u.id === row.subject_id)?.full_name || 'Unknown user'
  }

  async function handleAdd() {
    if (!subjectId) return
    try {
      await addRestriction(pageId, subjectType, subjectId, permission, profile.id)
      setSubjectId('')
      await load()
    } catch (err) { alert(err.message) }
  }

  async function handleRemove(id) {
    await removeRestriction(id)
    await load()
  }

  return (
    <>
      <button className="btn btn-ghost btn-sm btn-icon" title="Restrict access" onClick={() => setOpen(true)}><Lock size={13} /></button>
      <Modal open={open} onClose={() => setOpen(false)} title="Restrict Access">
        <p style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginBottom: 14 }}>
          With no restrictions, this page follows the space's normal access. Add a restriction to limit who can view or edit it —
          admins/CEO and the page's creator always keep access.
        </p>

        {rows.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            {rows.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderRadius: 8, background: 'var(--surface-2)' }}>
                <span style={{ fontSize: 12.5 }}>
                  <strong style={{ textTransform: 'capitalize' }}>{r.permission}</strong> — {nameFor(r)} <span style={{ color: 'var(--ink-muted)' }}>({r.subject_type})</span>
                </span>
                <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => handleRemove(r.id)}><X size={12} /></button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <select className="form-select" value={permission} onChange={e => setPermission(e.target.value)} style={{ maxWidth: 100 }}>
            <option value="view">Can view</option>
            <option value="edit">Can edit</option>
          </select>
          <select className="form-select" value={subjectType} onChange={e => { setSubjectType(e.target.value); setSubjectId('') }} style={{ maxWidth: 90 }}>
            <option value="user">User</option>
            <option value="role">Role</option>
          </select>
          {subjectType === 'user' ? (
            <select className="form-select" value={subjectId} onChange={e => setSubjectId(e.target.value)} style={{ flex: 1, minWidth: 140 }}>
              <option value="">Select person…</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          ) : (
            <select className="form-select" value={subjectId} onChange={e => setSubjectId(e.target.value)} style={{ flex: 1, minWidth: 140 }}>
              <option value="">Select role…</option>
              {ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
            </select>
          )}
          <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={!subjectId}><Plus size={13} /> Add</button>
        </div>
      </Modal>
    </>
  )
}
