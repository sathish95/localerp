import { useState, useMemo, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { PERSON_STATUSES, fmtMins, stripHtml, updatesText, personLine } from '../lib/teamDailyUpdates'
import { ensureXLSX } from '../lib/xlsxLoader'
import { dateFmt } from '../lib/supabase'
import { Kpi, Search } from './golive/shared'
import {
  ChevronDown, Copy, Download, LogIn, LogOut, Play, ArrowRightLeft, CheckCircle2, MessageSquare, Pencil, PlusCircle, ExternalLink, ListChecks,
} from 'lucide-react'

const hm = t => (t ? new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '')
const initials = n => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
const KIND_ICON = { checkin: LogIn, checkout: LogOut, work: Play, move: ArrowRightLeft, completed: CheckCircle2, comment: MessageSquare, edit: Pencil, created: PlusCircle }
const FILTERS = [['', 'All'], ['UPDATED', 'Updated'], ['PRESENT', 'Checked in only'], ['NO_UPDATE', 'No update']]
const taskLink = id => `/tasks?taskId=${id}`

// Daily Status → Daily updates: per person, every task they touched on the
// day (status moves, edits, progress comments, work sessions) + attendance.
export default function TeamDailyUpdatesView({ data }) {
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dept, setDept] = useState('')
  const [open, setOpen] = useState({})
  const [copied, setCopied] = useState(false)
  const t = data.totals

  const depts = useMemo(() => [...new Set(data.people.map(p => p.department).filter(Boolean))].sort(), [data])
  const scoped = data.people.filter(p => !dept || p.department === dept)
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, k ? scoped.filter(p => p.status === k).length : scoped.length]))
  const ql = q.trim().toLowerCase()
  const rows = scoped.filter(p => (!statusFilter || p.status === statusFilter)
    && (!ql || p.name.toLowerCase().includes(ql) || p.department.toLowerCase().includes(ql) || p.tasks.some(x => `${x.code} ${x.name}`.toLowerCase().includes(ql))))
  const allOpen = rows.length > 0 && rows.every(p => open[p.id])

  async function copy() {
    try { await navigator.clipboard.writeText(updatesText(data)); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ }
  }
  async function exportXlsx() {
    await ensureXLSX()
    const XLSX = window.XLSX
    const team = [['Daily updates', dateFmt(data.date)], [],
      ['Team member', 'Department', 'Role', 'Status', 'Check-in', 'Check-out', 'Attendance (h)', 'Tasks updated', 'Status moves', 'Completed', 'Progress comments', 'Field edits', 'Tasks created', 'Task time (h)', 'Summary'],
      ...data.people.map(p => [p.name, p.department, p.role, PERSON_STATUSES[p.status].label, hm(p.checkIn), p.checkOut ? hm(p.checkOut) : p.checkedIn ? 'open' : '',
        p.attendanceHours, p.tasksUpdated, p.moves, p.completed, p.comments, p.edits, p.created, p.taskHours, personLine(p)])]
    const tasks = [['Team member', 'Task', 'Title', 'Project', 'Current status', 'Created', 'Status moves', 'Completed', 'Progress %', 'Updates', 'Task time', 'Field edits'],
      ...data.people.flatMap(p => p.tasks.filter(x => x.touched).map(x => [p.name, x.code, x.name, x.project, x.status, x.created ? 'Yes' : '',
        x.moves.map(m => `${m.from} → ${m.to} (${hm(m.at)})`).join('; '), x.completed ? 'Yes' : '', x.lastProgress ?? '',
        x.comments.map(c => `${hm(c.at)} ${stripHtml(c.text)}`).join('\n'), x.minutes ? fmtMins(x.minutes) : '',
        x.edits.map(e => `${e.field}: ${e.from} → ${e.to}`).join('; ')]))]
    const wb = XLSX.utils.book_new()
    const ws1 = XLSX.utils.aoa_to_sheet(team); ws1['!cols'] = [22, 18, 14, 22, 9, 9, 10, 9, 9, 9, 9, 9, 9, 9, 90].map(w => ({ wch: w }))
    const ws2 = XLSX.utils.aoa_to_sheet(tasks); ws2['!cols'] = [22, 12, 40, 20, 16, 8, 40, 9, 9, 60, 10, 40].map(w => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws1, 'Team'); XLSX.utils.book_append_sheet(wb, ws2, 'Task updates')
    XLSX.writeFile(wb, `Daily-Updates-${data.date}.xlsx`)
  }

  return (
    <div className="gl-st">
      <div className="gl-kpis">
        <Kpi label="Team updated" value={`${t.updated}/${t.people}`} accent="#6366f1" sub={t.people ? `${Math.round(t.updated * 100 / t.people)}% posted a task update` : '—'} />
        <Kpi label="Checked in" value={t.checkedIn} accent="#059669" sub={data.isToday ? `${t.workingNow} working now` : `${t.attendanceHours} h attendance`} />
        <Kpi label="Tasks updated" value={t.tasksUpdated} accent="#0ea5e9" sub={t.created ? `${t.created} new` : 'distinct tasks'} />
        <Kpi label="Status moves" value={t.moves} accent="#6366f1" sub={`${t.completed} completed`} />
        <Kpi label="Progress updates" value={t.comments} accent="#64748b" sub="task comments" />
        <Kpi label="Time on tasks" value={`${t.taskHours} h`} accent="#0ea5e9" sub={`of ${t.attendanceHours} h checked in`} />
        <Kpi label="No task update" value={t.present + t.noUpdate} accent={t.present + t.noUpdate ? '#d97706' : '#059669'}
          active={statusFilter === 'NO_UPDATE' || statusFilter === 'PRESENT'} onClick={() => setStatusFilter(f => (f ? '' : 'PRESENT'))}
          sub={`${t.present} checked in only · ${t.noUpdate} absent`} />
      </div>

      <div className="table-wrap">
        <div className="gl-bar">
          <Search value={q} onChange={setQ} placeholder="Person, department or task…" />
          <div className="gl-seg">
            {FILTERS.map(([k, l]) => <button key={k} type="button" className={statusFilter === k ? 'on' : ''} onClick={() => setStatusFilter(k)}>{l} <span className="gl-st-n">{counts[k]}</span></button>)}
          </div>
          {depts.length > 1 && (
            <select className="form-select" value={dept} onChange={e => setDept(e.target.value)}>
              <option value="">All departments</option>{depts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          <div className="gl-grow" />
          <button className="btn btn-ghost btn-sm" disabled={!rows.length} onClick={() => setOpen(allOpen ? {} : Object.fromEntries(rows.map(p => [p.id, true])))}>{allOpen ? 'Collapse all' : 'Expand all'}</button>
          <button className="btn btn-ghost btn-sm" onClick={copy}><Copy size={13} /> {copied ? 'Copied' : 'Copy'}</button>
          <button className="btn btn-ghost btn-sm" onClick={exportXlsx}><Download size={13} /> Export</button>
        </div>
        <div className="gl-tscroll" style={{ maxHeight: 'none' }}>
          <table className="gl-table gl-st-table">
            <thead>
              <tr className="gl-groups">
                <th colSpan={2} /><th colSpan={2} className="gl-sep" style={{ textAlign: 'center' }}>Attendance</th>
                <th colSpan={5} className="gl-sep" style={{ textAlign: 'center' }}>Task updates</th><th colSpan={2} className="gl-sep" />
              </tr>
              <tr>
                <th style={{ minWidth: 230 }}>Team member</th><th>Status</th>
                <th className="gl-sep">In – out</th><th className="num">Hours</th>
                <th className="num gl-sep">Tasks</th><th className="num">Moves</th><th className="num">Completed</th><th className="num">Updates</th><th className="num">Task time</th>
                <th className="gl-sep">Active</th><th style={{ width: 34 }} />
              </tr>
            </thead>
            <tbody>
              {!rows.length && <tr><td colSpan={11} className="gl-st-empty">No one matches these filters.</td></tr>}
              {rows.map(p => {
                const isOpen = !!open[p.id]
                return (
                  <Fragment key={p.id}>
                    <tr className={`gl-st-row${isOpen ? ' open' : ''}${p.status !== 'UPDATED' ? ' idle' : ''}`} onClick={() => setOpen(o => ({ ...o, [p.id]: !o[p.id] }))}>
                      <td>
                        <div className="gl-st-who">
                          <span className="gl-st-av">{initials(p.name)}</span>
                          <div style={{ minWidth: 0 }}>
                            <div className="gl-st-name">{p.name}</div>
                            <div className="gl-st-roles">{p.department && <span className="gl-tag">{p.department}</span>}{p.role && <span className="gl-meta" style={{ textTransform: 'capitalize' }}>{p.role.replace(/_/g, ' ')}</span>}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`gl-pill ${PERSON_STATUSES[p.status].tone}`}>{PERSON_STATUSES[p.status].label}</span>
                        {p.workingNow && <div className="gl-meta" style={{ color: '#047857', marginTop: 3 }}>● working now</div>}
                      </td>
                      <td className="gl-sep nowrap">{p.checkIn ? <>{hm(p.checkIn)} – {p.checkOut ? hm(p.checkOut) : <span style={{ color: '#047857' }}>open</span>}</> : <span className="gl-st-zero">–</span>}</td>
                      <td className="num">{p.attendanceHours ? <span className="gl-st-num">{p.attendanceHours}</span> : <span className="gl-st-zero">–</span>}</td>
                      <td className="num gl-sep"><N v={p.tasksUpdated} />{p.created > 0 && <div className="gl-meta">{p.created} new</div>}</td>
                      <td className="num"><N v={p.moves} /></td>
                      <td className="num">{p.completed ? <span className="gl-st-good">{p.completed}</span> : <N v={0} />}</td>
                      <td className="num"><N v={p.comments} /></td>
                      <td className="num">{p.taskHours ? <span className="gl-st-num">{p.taskHours} h</span> : <N v={0} />}</td>
                      <td className="gl-sep nowrap">{p.firstAt ? <>{hm(p.firstAt)}–{hm(p.lastAt)}</> : <span className="gl-st-zero">–</span>}</td>
                      <td><ChevronDown size={15} className="gl-st-chev" /></td>
                    </tr>
                    {isOpen && <tr className="gl-st-detail"><td colSpan={11}><PersonDetail p={p} /></td></tr>}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const N = ({ v }) => (v ? <span className="gl-st-num">{v}</span> : <span className="gl-st-zero">–</span>)

function PersonDetail({ p }) {
  if (p.status === 'NO_UPDATE') return <div className="gl-st-detail-empty">No check-in and no task updates from {p.name} on this day.</div>
  const touched = p.tasks.filter(t => t.touched)
  const plannedOnly = p.tasks.filter(t => !t.touched && t.planned)
  return (
    <div className="gl-st-detail-grid">
      <section>
        <div className="gl-st-h"><ListChecks size={13} /> Tasks updated <span className="gl-st-n">{touched.length}</span></div>
        {!touched.length && <div className="gl-meta" style={{ marginBottom: 8 }}>Checked in but posted no task update{plannedOnly.length ? ' — tasks picked at check-in are listed below' : ''}.</div>}
        <div className="tdu-tasks">
          {touched.map(t => <TaskCard key={t.id} t={t} />)}
        </div>
        {plannedOnly.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="gl-meta" style={{ marginBottom: 4 }}>Picked at check-in, not updated</div>
            <div className="gl-st-devs">{plannedOnly.map(t => <Link key={t.id} to={taskLink(t.id)} className="gl-tag">{t.code ? `${t.code} · ` : ''}{t.name}</Link>)}</div>
          </div>
        )}
      </section>
      <section>
        <div className="gl-st-h">Day timeline <span className="gl-st-n">{p.timeline.length}</span></div>
        <ol className="gl-st-tl">
          {p.timeline.map((e, n) => {
            const Icon = KIND_ICON[e.kind] || Pencil
            return (
              <li key={n} className={`gl-st-ev ${e.tone}`}>
                <div className="gl-st-time">{hm(e.at)}{e.until && <span>–{hm(e.until)}</span>}{e.open && <span className="gl-st-onsite">running</span>}</div>
                <div className="gl-st-dot"><Icon size={12} /></div>
                <div className="gl-st-body">
                  <div className="gl-st-title">{e.title}</div>
                  {e.detail && <div className="gl-st-text tdu-clamp">{e.detail}</div>}
                </div>
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}

function TaskCard({ t }) {
  // everything that happened on the task, in time order
  const lines = [
    ...t.moves.map(m => ({ at: m.at, icon: <ArrowRightLeft size={12} />, body: <><s>{m.from}</s> → <b>{m.to}</b></> })),
    ...t.comments.map(c => ({ at: c.at, clamp: true, icon: <MessageSquare size={12} />, body: <>{stripHtml(c.text)}{c.pct != null && <em> · {c.pct}%</em>}</> })),
    ...t.work.map(w => ({ at: w.from, icon: <Play size={12} />, body: <>Worked {hm(w.from)}–{w.to ? hm(w.to) : 'now'} · {fmtMins(w.minutes)}{w.note ? ` — ${w.note}` : ''}</> })),
    ...t.edits.map(e => ({ at: e.at, icon: <Pencil size={12} />, body: <>{e.field}: {e.from} → <b>{e.to}</b></> })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at))
  return (
    <div className="tdu-task">
      <div className="tdu-task-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <Link to={taskLink(t.id)} className="tdu-task-name">{t.code && <span className="gl-code">{t.code}</span>} {t.name} <ExternalLink size={11} /></Link>
          <div className="gl-meta">{[t.project, t.due && `due ${dateFmt(t.due)}`].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="tdu-task-flags">
          {t.created && <span className="gl-tag">New</span>}
          {t.planned && <span className="gl-tag">Planned</span>}
          {t.completed ? <span className="gl-pill green">Completed</span> : t.status && <span className="gl-tag">{t.status}</span>}
          {t.minutes > 0 && <span className="tdu-time">{fmtMins(t.minutes)}</span>}
        </div>
      </div>
      {t.lastProgress != null && (
        <div className="tdu-progress"><div style={{ width: `${Math.min(100, Math.max(0, t.lastProgress))}%` }} /><span>{t.lastProgress}%</span></div>
      )}
      <ul className="tdu-lines">
        {lines.map((l, i) => <li key={i}>{l.icon}<span className={l.clamp ? 'tdu-clamp' : undefined}>{l.body}</span><time>{hm(l.at)}</time></li>)}
      </ul>
    </div>
  )
}
