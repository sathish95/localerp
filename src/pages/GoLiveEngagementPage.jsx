import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { dateFmt } from '../lib/supabase'
import {
  getEngagement, loadLookups, listRoster, currentRoster, listEnrollments, listIncidents,
  setEngagementStatus, resendReminders, budgetLabel,
} from '../lib/goLive'
import { istToday, daysBetween } from '../lib/goLiveRules'
import { deviceFields as readDeviceFields, matchDevice, EMPTY_DEVICE_FILTER } from '../lib/goLiveDeviceFields'
import { Loader, Tabs } from '../components/ui'
import EngagementForm from '../components/golive/EngagementForm'
import EngagementCheckIn from '../components/golive/EngagementCheckIn'
import SupportTab from '../components/golive/SupportTab'
import OverviewTab from '../components/golive/OverviewTab'
import RosterTab from '../components/golive/RosterTab'
import DevicesTab from '../components/golive/DevicesTab'
import ChecksTab from '../components/golive/ChecksTab'
import DailyStatusTab from '../components/golive/DailyStatusTab'
import IncidentsTab from '../components/golive/IncidentsTab'
import ImportExportTab from '../components/golive/ImportExportTab'
import ShareTab from '../components/golive/ShareTab'
import EngagementActionModal from '../components/golive/EngagementActions'
import { EngagementStatusBadge, ErrorLine, MANAGER_ROLES, errText } from '../components/golive/shared'
import { ArrowLeft, Pencil, Play, XCircle, CheckCircle2, Undo2, RotateCcw, BellRing, Trash2 } from 'lucide-react'

const TABS = ['overview', 'status', 'roster', 'devices', 'checks', 'support', 'incidents', 'share', 'data']

export default function GoLiveEngagementPage() {
  const { id } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  // hours now live inside Daily Checks — keep old ?tab=hours links working
  const rawTab = params.get('tab') === 'hours' ? 'checks' : params.get('tab')
  const tab = TABS.includes(rawTab) ? rawTab : 'overview'
  const [engagement, setEngagement] = useState(null)
  const [lookups, setLookups] = useState(null)
  const [roster, setRoster] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [incidents, setIncidents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [statusModal, setStatusModal] = useState(null) // 'cancel' | 'approve' | 'reject' | 'reopen' | 'delete'
  const [info, setInfo] = useState('')
  const [reminding, setReminding] = useState(false)
  // device filter shared by every tab (Go-live Yes / No + custom fields, STEP259)
  const [deviceFilter, setDeviceFilter] = useState(EMPTY_DEVICE_FILTER)

  const reloadEngagement = useCallback(async () => setEngagement(await getEngagement(id)), [id])
  const reloadRoster = useCallback(async () => setRoster(await listRoster(id)), [id])
  const reloadEnrollments = useCallback(async () => setEnrollments(await listEnrollments(id)), [id])
  const reloadIncidents = useCallback(async () => setIncidents(await listIncidents(id)), [id])
  const reloadAll = useCallback(async () => {
    await Promise.all([reloadEngagement(), reloadRoster(), reloadEnrollments(), reloadIncidents()])
  }, [reloadEngagement, reloadRoster, reloadEnrollments, reloadIncidents])

  useEffect(() => {
    setLoading(true); setError('')
    Promise.all([loadLookups().then(setLookups), reloadAll()])
      .catch(e => setError(errText(e)))
      .finally(() => setLoading(false))
  }, [id])

  const cur = useMemo(() => currentRoster(roster), [roster])
  const perms = useMemo(() => {
    const uid = profile?.id
    const isAdmin = ['admin', 'ceo'].includes(profile?.role)
    const inRole = role => [cur[role]?.primary_user_id, cur[role]?.backup_user_id].includes(uid)
    const override = col => enrollments.some(e => e[col] === uid)
    const canManage = MANAGER_ROLES.includes(profile?.role) || engagement?.pm_user_id === uid || inRole('ESCALATION_OWNER')
    return {
      uid, isAdmin, canManage,
      isPM: engagement?.pm_user_id === uid || MANAGER_ROLES.includes(profile?.role),
      canDecideExit: ['cto', 'ceo', 'admin'].includes(profile?.role),
      onsite: isAdmin || canManage || inRole('ONSITE_COORDINATOR') || override('onsite_coordinator_user_id'),
      firmware: isAdmin || inRole('FIRMWARE_ENGINEER') || override('firmware_engineer_user_id'),
      application: isAdmin || inRole('APPLICATION_ENGINEER') || override('application_engineer_user_id'),
    }
  }, [profile, cur, enrollments, engagement])

  const deviceFields = useMemo(() => readDeviceFields(engagement?.config), [engagement?.config])
  const matchDev = useCallback(e => matchDevice(e, deviceFilter, deviceFields), [deviceFilter, deviceFields])

  if (loading) return <Loader />
  if (!engagement) return <div><ErrorLine error={error || 'Engagement not found'} /><Link to="/golive">Back to Go-Live Support</Link></div>

  const name = (list, x) => list.find(r => r.id === x)?.name || list.find(r => r.id === x)?.full_name || '—'
  const today = istToday()
  const elapsed = engagement.hypercare_start ? Math.max(0, daysBetween(engagement.hypercare_start, today)) : 0
  const remaining = engagement.hypercare_planned_end ? daysBetween(today, engagement.hypercare_planned_end) : null
  const budget = lookups.budgets.find(b => b.id === engagement.budget_line_id)
  const setTab = t => { const p = new URLSearchParams(params); p.set('tab', t); p.delete('incident'); setParams(p, { replace: true }) }

  async function remind() {
    setReminding(true); setError(''); setInfo('')
    try {
      const n = await resendReminders(engagement.id)
      setInfo(n ? `Sent ${n} reminder(s) for today's checks, reviews and open incidents.` : 'Nothing is waiting on anyone today — no reminders needed.')
    } catch (e) { setError(errText(e)) }
    setReminding(false)
  }

  async function activate() {
    setError('')
    try { await setEngagementStatus(engagement, 'ACTIVE'); await reloadEngagement() } catch (e) { setError(errText(e)) }
  }

  const ctx = {
    engagement, lookups, roster, cur, enrollments, incidents, perms, profile,
    reloadEngagement, reloadRoster, reloadEnrollments, reloadIncidents, reloadAll, setTab, params, setParams,
    deviceFilter, setDeviceFilter, deviceFields, matchDev,
  }
  const openCount = incidents.filter(i => i.status !== 'CLOSED').length
  const live = ['ACTIVE', 'EXIT_REVIEW'].includes(engagement.status)

  return (
    <div>
      <Link to="/golive" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--ink-muted)', marginBottom: 8, textDecoration: 'none' }}><ArrowLeft size={12} /> Go-Live Support</Link>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>{engagement.name} <EngagementStatusBadge status={engagement.status} /></div>
          <div className="page-subtitle">
            {engagement.code} · {name(lookups.projects, engagement.project_id)} · {name(lookups.customers, engagement.customer_id)} · {(engagement.department_ids?.length ? engagement.department_ids : [engagement.department_id]).map(d => name(lookups.departments, d)).join(', ')} · {budgetLabel(budget) || 'Budget line'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>
            Go-live {dateFmt(engagement.go_live_date)} · Sites: {(engagement.sites || []).join(', ') || '—'} · PM {name(lookups.people, engagement.pm_user_id)}
            {live && <> · Day {elapsed}{remaining != null && (remaining >= 0 ? `, ${remaining} left` : `, ${-remaining} past planned end`)}</>}
            {engagement.status === 'CLOSED' && <> · Hypercare ended {dateFmt(engagement.hypercare_actual_end)}</>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {['ACTIVE', 'EXIT_REVIEW'].includes(engagement.status) && <EngagementCheckIn engagement={engagement} profile={profile} />}
          {perms.canManage && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}><Pencil size={13} /> Edit</button>}
          {perms.canManage && engagement.status === 'DRAFT' && <button className="btn btn-primary btn-sm" onClick={activate}><Play size={13} /> Activate hypercare</button>}
          {perms.canManage && live && <button className="btn btn-ghost btn-sm" disabled={reminding} onClick={remind} title="Re-send today's reminders"><BellRing size={13} /> {reminding ? 'Sending…' : 'Send reminders'}</button>}
          {perms.canManage && ['CLOSED', 'CANCELLED'].includes(engagement.status) && <button className="btn btn-primary btn-sm" onClick={() => setStatusModal('reopen')}><RotateCcw size={13} /> Reopen hypercare</button>}
          {perms.canDecideExit && engagement.status === 'EXIT_REVIEW' && <>
            <button className="btn btn-primary btn-sm" onClick={() => setStatusModal('approve')}><CheckCircle2 size={13} /> Approve exit</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setStatusModal('reject')}><Undo2 size={13} /> Send back</button>
          </>}
          {perms.canManage && !['CLOSED', 'CANCELLED'].includes(engagement.status) && <button className="btn btn-ghost btn-sm" onClick={() => setStatusModal('cancel')}><XCircle size={13} /> Cancel</button>}
          {perms.isPM && <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setStatusModal('delete')}><Trash2 size={13} /> Delete</button>}
        </div>
      </div>

      {engagement.status === 'DRAFT' && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>
          Draft — complete the <a href="#" onClick={e => { e.preventDefault(); setTab('roster') }}>support roster</a> (all four roles) and <a href="#" onClick={e => { e.preventDefault(); setTab('devices') }}>enroll at least one device</a>, then activate hypercare.
        </div>
      )}
      {engagement.status === 'EXIT_REVIEW' && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>
          Exit submitted {dateFmt(engagement.exit_submitted_at)} by {name(lookups.people, engagement.exit_submitted_by)} — waiting for CTO approval.
          {engagement.exit_override_comment && <div style={{ marginTop: 4, color: '#b45309' }}>Override: {engagement.exit_override_comment}</div>}
        </div>
      )}
      {engagement.status === 'ACTIVE' && engagement.exit_decision_comment && engagement.exit_decided_at && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#b45309' }}>
          Exit sent back by {name(lookups.people, engagement.exit_decided_by)}: {engagement.exit_decision_comment}
        </div>
      )}
      <ErrorLine error={error} />
      {info && <div className="card" style={{ padding: '10px 12px', marginBottom: 12, fontSize: 13, color: '#047857' }}>{info}</div>}

      <Tabs active={tab} onChange={setTab} tabs={[
        { id: 'overview', label: 'Overview' },
        { id: 'status', label: 'Daily Status' },
        { id: 'roster', label: 'Support Roster' },
        { id: 'devices', label: 'Devices', count: enrollments.filter(e => !e.unenrolled_at).length },
        { id: 'checks', label: 'Daily Checks' },
        { id: 'support', label: 'Support Activity' },
        { id: 'incidents', label: 'Incidents', count: openCount },
        { id: 'share', label: 'Share Report' },
        { id: 'data', label: 'Import / Export' },
      ]} />

      {tab === 'overview' && <OverviewTab ctx={ctx} />}
      {tab === 'status' && <DailyStatusTab ctx={ctx} />}
      {tab === 'support' && <SupportTab ctx={ctx} />}
      {tab === 'roster' && <RosterTab ctx={ctx} />}
      {tab === 'devices' && <DevicesTab ctx={ctx} />}
      {tab === 'checks' && <ChecksTab ctx={ctx} />}
      {tab === 'incidents' && <IncidentsTab ctx={ctx} />}
      {tab === 'share' && <ShareTab ctx={ctx} />}
      {tab === 'data' && <ImportExportTab ctx={ctx} />}

      {editing && <EngagementForm initial={engagement} lookups={lookups} onClose={() => setEditing(false)} onSaved={e => { setEditing(false); setEngagement(e) }} />}
      {statusModal && <EngagementActionModal kind={statusModal} engagement={engagement} onClose={() => setStatusModal(null)}
        onDone={async kind => { setStatusModal(null); if (kind === 'delete') navigate('/golive', { replace: true }); else await reloadAll() }} />}
    </div>
  )
}
