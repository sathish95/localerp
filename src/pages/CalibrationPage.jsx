import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, dateFmt } from '../lib/supabase'
import {
  listCycles, listCalibrationSessions, createCalibrationSession, updateCalibrationSession,
  listCalibrationAdjustments, addCalibrationAdjustment, RATING_BANDS,
} from '../lib/performance'
import { Loader, Empty, Modal } from '../components/ui'
import { Scale, Plus, CheckCircle } from 'lucide-react'

export default function CalibrationPage() {
  const { profile } = useAuth()
  const [cycles, setCycles] = useState([])
  const [cycleId, setCycleId] = useState('')
  const [sessions, setSessions] = useState([])
  const [selected, setSelected] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listCycles().then(cs => {
      setCycles(cs)
      const active = cs.find(c => c.calibration_required) || cs[0]
      setCycleId(active?.id || '')
      setLoading(false)
    })
  }, [])

  const loadSessions = useCallback(async () => {
    if (!cycleId) return []
    const data = await listCalibrationSessions(cycleId)
    setSessions(data)
    return data
  }, [cycleId])
  useEffect(() => { loadSessions() }, [loadSessions])

  const cycle = cycles.find(c => c.id === cycleId)

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#dc2626,#991b1b)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <Scale size={19} />
            </span>
            Calibration
          </div>
          <div className="page-subtitle">HR + department managers align ratings for consistency across the department</div>
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 8 }}>
          <select className="form-select" value={cycleId} onChange={e => { setCycleId(e.target.value); setSelected(null) }} style={{ minWidth: 200 }}>
            <option value="">Select a cycle…</option>
            {cycles.map(c => <option key={c.id} value={c.id}>{c.cycle_name} {c.calibration_required ? '(calibration required)' : ''}</option>)}
          </select>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)} disabled={!cycle}><Plus size={15} /> New Session</button>
        </div>
      </div>

      {!cycle ? (
        <Empty icon={<Scale size={40} />} title="Select a cycle" desc="Pick a cycle to manage its calibration sessions" />
      ) : sessions.length === 0 ? (
        <Empty icon={<Scale size={40} />} title="No calibration sessions yet" desc="Create one per department that needs alignment." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20, alignItems: 'start' }}>
          <div className="card" style={{ overflow: 'hidden' }}>
            {sessions.map(s => (
              <button key={s.id} onClick={() => setSelected(s)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '11px 14px', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selected?.id === s.id ? 'linear-gradient(135deg,#dc2626,#991b1b)' : 'transparent', color: selected?.id === s.id ? '#fff' : 'inherit' }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{s.department?.name || 'All Departments'}</div>
                <div style={{ fontSize: 11, opacity: .85 }}>{s.status} · {dateFmt(s.created_at)}</div>
              </button>
            ))}
          </div>
          <div className="card" style={{ padding: 20, minHeight: 300 }}>
            {!selected ? <Empty icon={<Scale size={40} />} title="Select a session" desc="Pick a calibration session to review and adjust ratings" /> : (
              <SessionDetail session={selected} cycle={cycle} profileId={profile.id} onChanged={async () => { const fresh = await loadSessions(); setSelected(s => fresh.find(x => x.id === s?.id) || null) }} />
            )}
          </div>
        </div>
      )}

      {showCreate && <CreateSessionModal cycleId={cycleId} profileId={profile.id} onClose={() => setShowCreate(false)} onCreated={async () => { setShowCreate(false); await loadSessions() }} />}
    </div>
  )
}

function CreateSessionModal({ cycleId, profileId, onClose, onCreated }) {
  const [departments, setDepartments] = useState([])
  const [managers, setManagers] = useState([])
  const [form, setForm] = useState({ department_id: '', participants: [], notes: '' })
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('departments').select('id,name').order('name').then(({ data }) => setDepartments(data || []))
    supabase.from('profiles').select('id,full_name,role').in('role', ['admin', 'ceo', 'hr', 'manager', 'department_head']).order('full_name').then(({ data }) => setManagers(data || []))
  }, [])

  async function save() {
    setSaving(true); setErr('')
    try {
      await createCalibrationSession({ cycle_id: cycleId, department_id: form.department_id || null, participants: form.participants, notes: form.notes || null }, profileId)
      onCreated()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title="New Calibration Session"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
      </>}>
      {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="form-group"><label className="form-label">Department</label>
        <select className="form-select" value={form.department_id} onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))}>
          <option value="">All Departments</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select></div>
      <div className="form-group">
        <label className="form-label">Participants</label>
        <select multiple className="form-select" style={{ minHeight: 100 }} value={form.participants}
          onChange={e => setForm(f => ({ ...f, participants: Array.from(e.target.selectedOptions, o => o.value) }))}>
          {managers.map(m => <option key={m.id} value={m.id}>{m.full_name} ({m.role})</option>)}
        </select>
      </div>
      <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
    </Modal>
  )
}

function SessionDetail({ session, cycle, profileId, onChanged }) {
  const [employees, setEmployees] = useState([])
  const [adjustments, setAdjustments] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    let empQuery = supabase.from('profiles').select('id,full_name,department_id')
    if (session.department_id) empQuery = empQuery.eq('department_id', session.department_id)
    const [{ data: emps }, adjs] = await Promise.all([empQuery.order('full_name'), listCalibrationAdjustments(session.id)])
    const ids = (emps || []).map(e => e.id)
    const { data: reviews } = ids.length
      ? await supabase.from('manager_reviews').select('employee_id, overall_rating').eq('cycle_id', cycle.id).in('employee_id', ids)
      : { data: [] }
    const reviewByEmp = new Map((reviews || []).map(r => [r.employee_id, r.overall_rating]))
    setEmployees((emps || []).filter(e => reviewByEmp.has(e.id)).map(e => ({ ...e, overall_rating: reviewByEmp.get(e.id) })))
    setAdjustments(adjs)
    setLoading(false)
  }, [session, cycle.id])
  useEffect(() => { load() }, [load])

  async function markCompleted() { await updateCalibrationSession(session.id, { status: 'Completed' }); onChanged() }

  if (loading) return <Loader />

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{session.department?.name || 'All Departments'}</div>
          {session.notes && <div style={{ fontSize: 12, color: '#94a3b8' }}>{session.notes}</div>}
        </div>
        {session.status !== 'Completed' && <button className="btn btn-success btn-sm" onClick={markCompleted}><CheckCircle size={13} /> Mark Completed</button>}
      </div>

      {employees.length === 0 ? (
        <Empty icon={<Scale size={40} />} title="No manager reviews to calibrate" desc="Employees in this department need a submitted Manager Review first." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Employee</th><th>Manager Rating</th><th>Calibrated Rating</th><th>Reason</th><th></th></tr></thead>
            <tbody>
              {employees.map(e => {
                const existing = adjustments.find(a => a.employee_id === e.id)
                return <CalibrationRow key={e.id} employee={e} session={session} cycle={cycle} profileId={profileId} existing={existing} onSaved={load} />
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function CalibrationRow({ employee, session, cycle, profileId, existing, onSaved }) {
  const [rating, setRating] = useState(existing?.calibrated_final_rating || employee.overall_rating || '')
  const [reason, setReason] = useState(existing?.adjustment_reason || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    if (!rating) { setErr('Pick a calibrated rating.'); return }
    if (!reason.trim()) { setErr('A reason is required — this is what the employee sees if they ask why their rating changed.'); return }
    setSaving(true); setErr('')
    try {
      await addCalibrationAdjustment({
        calibrationSessionId: session.id, employeeId: employee.id, cycleId: cycle.id,
        originalManagerRating: employee.overall_rating, calibratedFinalRating: rating, adjustmentReason: reason, adjustedBy: profileId,
      })
      onSaved()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <tr>
      <td className="td-bold" style={{ fontSize: 12 }}>{employee.full_name}</td>
      <td style={{ fontSize: 12 }}>{employee.overall_rating}</td>
      <td>
        <select className="form-select" style={{ fontSize: 11, padding: '3px 6px' }} value={rating} onChange={e => setRating(e.target.value)}>
          <option value="">Select…</option>{RATING_BANDS.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </td>
      <td><input className="form-input" style={{ fontSize: 11, padding: '3px 6px' }} value={reason} onChange={e => setReason(e.target.value)} placeholder="Why this rating?" /></td>
      <td>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{existing ? 'Update' : 'Lock In'}</button>
        {err && <div style={{ fontSize: 10, color: '#dc2626', marginTop: 2 }}>{err}</div>}
      </td>
    </tr>
  )
}
