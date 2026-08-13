import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { listPendingApprovals, decideVersion } from '../lib/scenarios'
import { Loader, Alert, StatusBadge, Empty } from '../components/ui'
import { dateFmt } from '../lib/supabase'
import { CheckCircle, XCircle, RotateCcw } from 'lucide-react'

const APPROVER_ROLES = ['admin', 'ceo', 'finance', 'department_head']

export default function ScenarioApprovalsPage() {
  const { profile } = useAuth()
  const isApprover = APPROVER_ROLES.includes(profile?.role)
  const [pending, setPending] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [notes, setNotes] = useState({})

  async function load() {
    try { setPending(await listPendingApprovals()) } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function decide(v, decision) {
    setBusyId(v.id); setErr('')
    try { await decideVersion(v.id, decision, notes[v.id] || null); await load() }
    catch (e) { setErr(e.message) }
    finally { setBusyId(null) }
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Scenario Approvals</div>
          <div className="page-subtitle">Scenarios awaiting a decision</div>
        </div>
      </div>

      {err && <Alert type="error" message={err} />}
      {!isApprover && <Alert type="info" message="Your role doesn't have approval authority — showing the queue for visibility only." />}

      {pending.length === 0 ? (
        <Empty title="Nothing pending" desc="Submitted scenarios will show up here for review." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {pending.map(v => (
            <div key={v.id} className="card" style={{ padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div>
                  <Link to={`/scenarios/${v.id}`} style={{ fontWeight: 700, textDecoration: 'none', color: 'inherit' }}>{v.scenario?.name}</Link>
                  <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{v.scenario?.code} · v{v.version_number} · by {v.scenario?.creator?.full_name || 'Unknown'} · {dateFmt(v.updated_at)}</div>
                </div>
                <StatusBadge status={v.status} />
              </div>
              {isApprover && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input className="form-input" style={{ flex: 1, minWidth: 180 }} placeholder="Decision note (optional)" value={notes[v.id] || ''} onChange={e => setNotes(n => ({ ...n, [v.id]: e.target.value }))} />
                  <button className="btn btn-primary btn-sm" disabled={busyId === v.id} onClick={() => decide(v, 'approve')}><CheckCircle size={13} /> Approve</button>
                  <button className="btn btn-ghost btn-sm" disabled={busyId === v.id} onClick={() => decide(v, 'request_changes')}><RotateCcw size={13} /> Request Changes</button>
                  <button className="btn btn-danger btn-sm" disabled={busyId === v.id} onClick={() => decide(v, 'reject')}><XCircle size={13} /> Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
