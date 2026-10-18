import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { dateFmt } from '../lib/supabase'
import { getDailyStatusReport } from '../lib/dailyStatus'
import { shareLinkUrl, getOrCreateShareLink, listShareLinks, setShareLinkExpiry, revokeShareLink } from '../lib/dailyStatusShare'
import { ensureXLSX } from '../lib/xlsxLoader'
import { Loader } from '../components/ui'
import DailyStatusReportView from '../components/DailyStatusReportView'
import TeamPerformanceView from '../components/TeamPerformanceView'
import { getTeamPerformance, FLAG_META } from '../lib/teamPerformance'
import { getTeamDailyUpdates } from '../lib/teamDailyUpdatesData'
import TeamDailyUpdatesView from '../components/TeamDailyUpdatesView'
import { ClipboardList, Download, Link2, Globe, Copy, Ban, Users, Activity, ListChecks } from 'lucide-react'

const PERIODS = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
]

const CAN_SHARE_ROLES = ['admin', 'ceo', 'manager', 'department_head']
// Per-person efficiency is management data — same roles as sharing.
const CAN_SEE_TEAM_ROLES = ['admin', 'ceo', 'manager', 'department_head', 'hr']

export default function DailyStatusPage() {
  const { profile } = useAuth()
  const canManageShare = CAN_SHARE_ROLES.includes(profile?.role)
  const canSeeTeam = CAN_SEE_TEAM_ROLES.includes(profile?.role)
  const [searchParams, setSearchParams] = useSearchParams()
  // The period/date filters live in the URL (not just component state) so
  // the page is a real shareable link — opening the same URL (already
  // logged in) reproduces the exact same view instead of always landing
  // back on "today / daily".
  const [period, setPeriod] = useState(searchParams.get('period') || 'daily')
  const [refDate, setRefDate] = useState(searchParams.get('date') || new Date().toISOString().slice(0, 10))
  const [tab, setTab] = useState(searchParams.get('tab') || 'team')
  const [report, setReport] = useState(null)
  const [team, setTeam] = useState(null)
  const [updates, setUpdates] = useState(null)
  const [updatesErr, setUpdatesErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [exporting, setExporting] = useState(false)
  const [copied, setCopied] = useState(false)

  const activeTab = canSeeTeam ? tab : 'activity'
  useEffect(() => { setSearchParams({ period, date: refDate, tab: activeTab }, { replace: true }) }, [period, refDate, activeTab, setSearchParams])

  const load = useCallback(async () => {
    if (!profile?.organization_id) return
    setLoading(true); setErr('')
    try {
      const ref = new Date(refDate + 'T12:00:00')
      const [rep, tp] = await Promise.all([
        getDailyStatusReport(profile.organization_id, period, ref),
        canSeeTeam ? getTeamPerformance(profile.organization_id, period, ref) : Promise.resolve(null),
      ])
      setReport(rep); setTeam(tp)
    }
    catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [profile?.organization_id, period, refDate, canSeeTeam])

  useEffect(() => { load() }, [load])

  // Daily updates is always one day (the "As of" date), whatever the period
  useEffect(() => {
    if (!profile?.organization_id || !canSeeTeam || activeTab !== 'updates') return
    let live = true
    setUpdates(null); setUpdatesErr('')
    getTeamDailyUpdates(profile.organization_id, refDate).then(d => live && setUpdates(d)).catch(e => live && setUpdatesErr(e.message))
    return () => { live = false }
  }, [profile?.organization_id, canSeeTeam, activeTab, refDate])

  function copyLink() {
    navigator.clipboard?.writeText(window.location.href)
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  async function exportExcel() {
    if (!report) return
    setExporting(true)
    try {
      await ensureXLSX()
      const XLSX = window.XLSX
      const wb = XLSX.utils.book_new()
      const sheet = (rows, cols) => XLSX.utils.json_to_sheet(rows.map(r => Object.fromEntries(cols.map(([k, label]) => [label, r[k]]))))
      XLSX.utils.book_append_sheet(wb, sheet(report.moved, [['source', 'Source'], ['title', 'Item'], ['from', 'From'], ['to', 'To'], ['resource', 'Resource'], ['changedAt', 'Changed At']]), 'Moved')
      XLSX.utils.book_append_sheet(wb, sheet(report.planned, [['source', 'Source'], ['title', 'Item'], ['status', 'Status'], ['dueDate', 'Due Date'], ['resource', 'Resource']]), 'Planned')
      XLSX.utils.book_append_sheet(wb, sheet(report.completed, [['source', 'Source'], ['title', 'Item'], ['resource', 'Resource'], ['completedAt', 'Completed At']]), 'Completed')
      XLSX.utils.book_append_sheet(wb, sheet(report.overdue, [['source', 'Source'], ['title', 'Item'], ['status', 'Status'], ['dueDate', 'Due Date'], ['resource', 'Resource']]), 'Overdue')
      XLSX.utils.book_append_sheet(wb, sheet(report.byResource, [['name', 'Resource'], ['inProgress', 'In Progress'], ['completed', 'Completed'], ['hoursLogged', 'Task Hours (work_logs)'], ['totalHoursLogged', 'Total Hours Logged (time_logs)']]), 'By Resource')
      XLSX.utils.book_append_sheet(wb, sheet(report.byDepartment, [['name', 'Department'], ['open', 'Open'], ['completed', 'Completed'], ['overdue', 'Overdue'], ['completionRate', 'Completion %'], ['onTimeRate', 'On-Time %'], ['hoursLogged', 'Hours Logged']]), 'Department Efficiency')
      if (team) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(team.rows.map(r => ({
        Resource: r.name, Department: team.departments.find(d => d.id === r.department_id)?.name || '', Role: r.role || '',
        'Capacity (h)': r.capacity, 'Attendance (h)': r.attendance, 'Attendance %': r.attendancePct ?? '',
        'Task time (h)': r.taskHours, 'Logged %': r.loggingPct ?? '', 'Days present': r.daysPresent, 'Leave days': r.leaveDays,
        Completed: r.completed, 'On time %': r.onTimePct ?? '', 'Est. accuracy %': r.estimateAccuracy ?? '',
        'Est. hours': r.estHours, 'Actual hours': r.actHours, 'Open tasks': r.openTasks, Overdue: r.overdue,
        'Missed check-outs': r.missedCheckouts, Attention: r.flags.map(f => FLAG_META[f].label).join(', '),
      }))), 'Team Performance')
      XLSX.writeFile(wb, `Daily-Status-${period}-${refDate}.xlsx`)
    } catch (e) { setErr(e.message) }
    finally { setExporting(false) }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--c1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <ClipboardList size={19} />
            </span>
            Daily Status
          </div>
          <div className="page-subtitle">Attendance, time logged against tasks and delivery for each person, plus task and ticket activity across the organisation</div>
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={copyLink}><Link2 size={15} /> {copied ? 'Link Copied!' : 'Copy Link'}</button>
          <button className="btn btn-outline" onClick={exportExcel} disabled={!report || exporting}><Download size={15} /> {exporting ? 'Exporting…' : 'Export'}</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div className="tb-seg" role="tablist" aria-label="Period">
          {PERIODS.map(p => <button key={p.id} className={period === p.id ? 'on' : ''} onClick={() => setPeriod(p.id)}>{p.label}</button>)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11.5, color: '#64748b' }}>As of</span>
          <input type="date" className="form-input" style={{ fontSize: 12.5, height: 32, padding: '0 8px', width: 'auto', borderWidth: 1, borderRadius: 8 }} value={refDate} onChange={e => e.target.value && setRefDate(e.target.value)} />
        </div>
        {report && (
          <div style={{ fontSize: 12.5, color: '#64748b', marginLeft: 'auto', fontWeight: 500 }}>
            {period === 'daily' ? dateFmt(report.start) : `${dateFmt(report.start)} – ${dateFmt(report.end)}`}
          </div>
        )}
      </div>

      {err && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{err}</div>}

      {loading || !report ? <Loader /> : (
        <>
          {canSeeTeam && (
            <div className="ds-tabs" role="tablist">
              <button role="tab" aria-selected={activeTab === 'team'} className={activeTab === 'team' ? 'on' : ''} onClick={() => setTab('team')}><Users size={15} /> Team performance</button>
              <button role="tab" aria-selected={activeTab === 'updates'} className={activeTab === 'updates' ? 'on' : ''} onClick={() => setTab('updates')}><ListChecks size={15} /> Daily updates</button>
              <button role="tab" aria-selected={activeTab === 'activity'} className={activeTab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}><Activity size={15} /> Activity &amp; departments</button>
            </div>
          )}
          {activeTab === 'updates' ? (
            <>
              {period !== 'daily' && <div className="card" style={{ padding: '8px 12px', marginBottom: 12, fontSize: 12.5, color: 'var(--ink-soft)' }}>Daily updates are per day — showing {dateFmt(refDate)} (the “As of” date).</div>}
              {updatesErr ? <div className="alert alert-danger">{updatesErr}</div> : updates ? <TeamDailyUpdatesView data={updates} /> : <Loader />}
            </>
          ) : activeTab === 'team' && team ? <TeamPerformanceView data={team} period={period} /> : <DailyStatusReportView report={report} />}
          {canManageShare && <ExternalShareCard organizationId={profile.organization_id} profileId={profile.id} />}
        </>
      )}
    </div>
  )
}

// Generates/copies/revokes a tokenized, unauthenticated external link
// (get_daily_status_public_raw). Per explicit confirmation, this now
// mirrors the internal report EXACTLY — same computeDailyStatus() output,
// same DailyStatusReportView rendering, employee names/hours/department
// efficiency included. There is no separate anonymized data path anymore;
// anyone holding the link sees precisely what this page shows.
function ExternalShareCard({ organizationId, profileId }) {
  const [link, setLink] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const links = await listShareLinks(organizationId)
      setLink(links.find(l => !l.revoked_at) || links[0] || null)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [organizationId])

  useEffect(() => { load() }, [load])

  async function generate() {
    setBusy('generate'); setErr('')
    try { setLink(await getOrCreateShareLink(organizationId, profileId)) }
    catch (e) { setErr(e.message) }
    finally { setBusy('') }
  }
  async function revoke() {
    setBusy('revoke'); setErr('')
    try { await revokeShareLink(link.id); await load() }
    catch (e) { setErr(e.message) }
    finally { setBusy('') }
  }
  async function updateExpiry(dateStr) {
    setErr('')
    try { await setShareLinkExpiry(link.id, dateStr ? new Date(dateStr).toISOString() : null); await load() }
    catch (e) { setErr(e.message) }
  }
  function copyLink() {
    navigator.clipboard?.writeText(shareLinkUrl(link.token))
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  if (loading) return null

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16, borderTop: '3px solid #0ea5e9' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}><Globe size={14} /> Share Externally (No Login)</div>
      <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600, marginBottom: 12 }}>
        This link shows the EXACT same view as this page, including employee names, individual hours logged and department efficiency —
        anyone with the link sees it, no login required. Revoke it as soon as it's no longer needed.
      </div>
      {err && <div className="alert alert-danger" style={{ marginBottom: 10 }}>{err}</div>}

      {!link || link.revoked_at ? (
        <button className="btn btn-primary btn-sm" onClick={generate} disabled={busy === 'generate'}>
          <Globe size={14} /> {busy === 'generate' ? 'Generating…' : 'Generate External Link'}
        </button>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <input readOnly value={shareLinkUrl(link.token)} onFocus={e => e.target.select()}
              style={{ flex: '1 1 320px', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontFamily: 'monospace', fontSize: 12 }} />
            <button className="btn btn-outline btn-sm" onClick={copyLink}><Copy size={13} /> {copied ? 'Copied!' : 'Copy'}</button>
            <button className="btn btn-ghost btn-sm" onClick={revoke} disabled={busy === 'revoke'} style={{ color: '#dc2626' }}><Ban size={13} /> Revoke</button>
          </div>
          <label style={{ fontSize: 11.5, color: '#64748b', display: 'flex', alignItems: 'center', gap: 8 }}>
            Expires
            <input type="date" defaultValue={link.expires_at ? link.expires_at.slice(0, 10) : ''}
              onChange={e => updateExpiry(e.target.value)}
              style={{ padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: 6, fontFamily: 'inherit', fontSize: 12 }} />
            <span style={{ color: '#94a3b8' }}>(leave blank for no expiry)</span>
          </label>
        </div>
      )}
    </div>
  )
}
