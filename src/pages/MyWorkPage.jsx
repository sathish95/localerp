import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { supabase, dateFmt } from '../lib/supabase'
import {
  getActiveCheckIn, listWorkLogsForTasks, deriveTaskRunState,
  startTask, pauseTask, resumeTask, completeTask, uploadTaskEvidence,
} from '../lib/workExecution'
import { getTodayShift } from '../lib/shifts'
import { getPersonalAttention } from '../lib/aiAttention'
import { listFlows, makeStatusHelpers } from '../lib/departmentStatusFlows'
import { Tabs, Loader, Empty, Modal } from '../components/ui'
import { ClipboardCheck, Play, Pause, CheckCircle2, Clock, AlertTriangle } from 'lucide-react'

const SEVERITY_COLOR = { high: '#dc2626', medium: '#f59e0b', low: '#64748b' }

// Industry-Adaptive Platform Phase 4 — "My Work" is deliberately a
// read-mostly view over the SAME project_tasks rows TasksPage.jsx already
// renders, just filtered to `assigned_to = me` with no project_id filter
// at all — so a task shows here whether or not it belongs to a Project,
// with zero new query complexity (unlike TasksPage's manager-view fetch,
// there's no "gate on ids.length" problem here since this was never
// project-scoped to begin with).
//
// Phase 5 — Work Execution adds Start/Pause/Resume/Complete, backed by
// work_logs (src/lib/workExecution.js). Run-state is derived from
// work_logs on every load, never stored as a new task.status value — see
// that file's header comment for why.
const STATUSES=['backlog','todo','in_progress','delayed','qa','ready_for_demo','closed']
const SL={backlog:'Backlog',todo:'To Do',in_progress:'In Progress',delayed:'Delayed',qa:'QA Testing',ready_for_demo:'Ready for Demo',closed:'Closed'}
const SC={backlog:'#64748b',todo:'#3b82f6',in_progress:'#f59e0b',delayed:'#e11d48',qa:'#8b5cf6',ready_for_demo:'#10b981',closed:'#94a3b8'}
// Pre-STEP198 fallback for a department with no configured flow row yet —
// see makeStatusHelpers in departmentStatusFlows.js.
const LEGACY_STEPS = STATUSES.map(s => ({ status_key: s, label: SL[s], color: SC[s], is_closed: s === 'closed' }))
const PI={critical:'🔴',high:'🟠',medium:'🔵',low:'🟢'}
const isOverdue=(t,isTaskDone)=>t.planned_end_date&&new Date(t.planned_end_date)<new Date()&&!isTaskDone(t)
const isToday=t=>t.planned_end_date&&new Date(t.planned_end_date).toDateString()===new Date().toDateString()
const fmtMinutes=m=>{ const h=Math.floor(m/60), mm=m%60; return h>0?`${h}h ${mm}m`:`${mm}m` }

export default function MyWorkPage() {
  const { profile } = useAuth()
  const { term } = useWorkspace()
  const [tasks, setTasks] = useState([])
  const [flows, setFlows] = useState([])
  const [logsByTask, setLogsByTask] = useState({}) // task_id -> work_logs[]
  const [activeCheckIn, setActiveCheckIn] = useState(null)
  const [todayShift, setTodayShift] = useState(null)
  const [attention, setAttention] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [tab, setTab] = useState('today')
  const [checklistTask, setChecklistTask] = useState(null) // task pending checklist-fill before complete
  const [checklistDraft, setChecklistDraft] = useState([])
  const [uploadingItemId, setUploadingItemId] = useState(null)

  useEffect(() => { load() }, [profile?.id])

  async function load() {
    if (!profile?.id) return
    setLoading(true)
    const [{ data: taskRows }, checkIn, shift, flowsRes] = await Promise.all([
      supabase.from('project_tasks').select('*,project:projects(id,name)').eq('assigned_to', profile.id)
        .order('planned_end_date', { ascending: true, nullsFirst: false }),
      getActiveCheckIn(profile.id).catch(() => null),
      getTodayShift(profile.id).catch(() => null),
      listFlows(profile.organization_id).catch(() => []),
    ])
    const rows = taskRows || []
    setTasks(rows)
    setActiveCheckIn(checkIn)
    setTodayShift(shift)
    setFlows(flowsRes || [])
    const logs = await listWorkLogsForTasks(rows.map(t => t.id), profile.id).catch(() => [])
    const grouped = {}
    for (const l of logs) { (grouped[l.task_id] ??= []).push(l) }
    setLogsByTask(grouped)
    getPersonalAttention(profile.id).then(setAttention).catch(() => setAttention([]))
    setLoading(false)
  }

  const helpers = useMemo(() => makeStatusHelpers(flows, LEGACY_STEPS), [flows])

  const groups = useMemo(() => ({
    today: tasks.filter(t => !helpers.isTaskDone(t) && (isToday(t) || isOverdue(t, helpers.isTaskDone))),
    upcoming: tasks.filter(t => !helpers.isTaskDone(t) && !isToday(t) && !isOverdue(t, helpers.isTaskDone)),
    overdue: tasks.filter(t => isOverdue(t, helpers.isTaskDone)),
    completed: tasks.filter(t => helpers.isTaskDone(t)),
  }), [tasks, helpers])

  const visible = groups[tab] || []

  async function handleStart(task) {
    setBusyId(task.id)
    try { await startTask(task, profile.id); await load() }
    catch (e) { alert(e.message) }
    finally { setBusyId(null) }
  }

  async function handlePause(task, openLogId) {
    setBusyId(task.id)
    try { await pauseTask(openLogId); await load() }
    catch (e) { alert(e.message) }
    finally { setBusyId(null) }
  }

  async function handleResume(task) {
    setBusyId(task.id)
    try { await resumeTask(task, profile.id); await load() }
    catch (e) { alert(e.message) }
    finally { setBusyId(null) }
  }

  // Complete: if the task has any checklist items at all, open the
  // fill-in modal first (required items block the confirm button there);
  // a task with no checklist completes immediately.
  function handleCompleteClick(task) {
    const checklist = Array.isArray(task.checklist) ? task.checklist : []
    if (checklist.length === 0) { doComplete(task, []); return }
    setChecklistTask(task)
    setChecklistDraft(checklist.map(i => ({ ...i })))
  }

  async function doComplete(task, checklist) {
    setBusyId(task.id)
    try { await completeTask(task, profile.id, checklist); setChecklistTask(null); await load() }
    catch (e) { alert(e.message) }
    finally { setBusyId(null) }
  }

  const missingRequired = checklistDraft.some(i => i.required && !i.value)

  async function handleEvidenceUpload(itemId, file) {
    if (!checklistTask || !file) return
    setUploadingItemId(itemId)
    try {
      const url = await uploadTaskEvidence(checklistTask.id, file)
      setChecklistDraft(d => d.map(i => i.id === itemId ? { ...i, value: url } : i))
    } catch (e) { alert(e.message) }
    finally { setUploadingItemId(null) }
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">My Work</div>
          <div className="page-subtitle">Everything assigned to you — {term('project', 'project')}-linked or direct</div>
        </div>
      </div>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ width: 10, height: 10, borderRadius: 999, background: activeCheckIn ? '#10b981' : '#cbd5e1', flexShrink: 0 }} />
        <div style={{ fontSize: 13 }}>
          {activeCheckIn
            ? <>Checked in since <strong>{new Date(activeCheckIn.check_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</strong> — task work below is tracked independently of this check-in.</>
            : <span style={{ color: 'var(--text-muted)' }}>Not checked in right now — you can still start/complete tasks; check-in and task work are tracked separately.</span>}
          {todayShift?.shift && (
            <span style={{ color: 'var(--ink-muted)', marginLeft: 8 }}>
              · Shift: {todayShift.shift.start_time?.slice(0, 5)}–{todayShift.shift.end_time?.slice(0, 5)} ({todayShift.shift.name})
            </span>
          )}
        </div>
      </div>

      {attention.length > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <AlertTriangle size={14} /> Needs Attention
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {attention.map((a, i) => (
              <Link key={i} to={a.link} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text)', textDecoration: 'none' }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: SEVERITY_COLOR[a.severity] || '#64748b', flexShrink: 0 }} />
                {a.text}
              </Link>
            ))}
          </div>
        </div>
      )}

      <Tabs
        tabs={[
          { id: 'today', label: 'Today', count: groups.today.length },
          { id: 'upcoming', label: 'Upcoming', count: groups.upcoming.length },
          { id: 'overdue', label: 'Overdue', count: groups.overdue.length },
          { id: 'completed', label: 'Completed', count: groups.completed.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {visible.length === 0 ? (
        <Empty icon={<ClipboardCheck size={28} />} title="Nothing here" desc={`No ${tab} tasks right now.`} />
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead><tr><th>Task</th><th>{term('project', 'Project')}</th><th>Priority</th><th>Status</th><th>Time logged</th><th>Due</th><th></th></tr></thead>
            <tbody>
              {visible.map(t => {
                const run = deriveTaskRunState(logsByTask[t.id] || [])
                const busy = busyId === t.id
                return (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 600 }}>{t.task_name}</td>
                    <td>{t.project?.name || <span style={{ color: 'var(--text-muted)' }}>No {term('project', 'project').toLowerCase()}</span>}</td>
                    <td>{PI[t.priority]} {t.priority}</td>
                    <td><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, background: `${helpers.colorFor(t)}18`, color: helpers.colorFor(t) }}>{helpers.labelFor(t)}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Clock size={12} /> {fmtMinutes(run.totalMinutes)}
                      {run.state === 'running' && <span style={{ color: '#10b981', fontWeight: 700 }}>● running</span>}
                      {run.state === 'paused' && <span style={{ color: '#f59e0b', fontWeight: 700 }}>paused</span>}
                    </td>
                    <td>{t.planned_end_date ? dateFmt(t.planned_end_date) : '—'}</td>
                    <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {helpers.isTaskDone(t) ? null : run.state === 'not_started' ? (
                        <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => handleStart(t)}><Play size={12} /> Start</button>
                      ) : run.state === 'running' ? (
                        <>
                          <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => handlePause(t, run.openLogId)}><Pause size={12} /> Pause</button>
                          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => handleCompleteClick(t)}><CheckCircle2 size={12} /> Complete</button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => handleResume(t)}><Play size={12} /> Resume</button>
                          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => handleCompleteClick(t)}><CheckCircle2 size={12} /> Complete</button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!checklistTask} onClose={() => setChecklistTask(null)} title="Complete task — checklist"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setChecklistTask(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={missingRequired || busyId === checklistTask?.id}
            onClick={() => doComplete(checklistTask, checklistDraft)}>
            {busyId === checklistTask?.id ? 'Completing…' : 'Complete Task'}
          </button>
        </>}>
        {missingRequired && <div style={{ marginBottom: 10, fontSize: 12, color: '#dc2626', fontWeight: 600 }}>Fill in every required item before completing.</div>}
        {checklistDraft.map(item => (
          <div key={item.id} className="form-group">
            <label className="form-label">{item.label}{item.required && ' *'}</label>
            {['photo', 'file', 'signature'].includes(item.type) ? (
              <>
                <input type="file" onChange={e => handleEvidenceUpload(item.id, e.target.files?.[0])} disabled={uploadingItemId === item.id} />
                {item.value && <div style={{ fontSize: 11, color: '#10b981', marginTop: 4 }}>✓ Uploaded</div>}
              </>
            ) : item.type === 'pass_fail' ? (
              <select className="form-select" value={item.value || ''} onChange={e => setChecklistDraft(d => d.map(i => i.id === item.id ? { ...i, value: e.target.value } : i))}>
                <option value="">Select…</option>
                <option value="pass">Pass</option>
                <option value="fail">Fail</option>
              </select>
            ) : (
              <input className="form-input" type={item.type === 'number' ? 'number' : item.type === 'date' ? 'date' : 'text'}
                value={item.value || ''} onChange={e => setChecklistDraft(d => d.map(i => i.id === item.id ? { ...i, value: e.target.value } : i))} />
            )}
          </div>
        ))}
      </Modal>
    </div>
  )
}
