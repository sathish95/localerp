import { useState, useMemo, useEffect } from 'react'
import { dateFmt } from '../lib/supabase'
import { FLAG_META } from '../lib/teamPerformance'
import { Search, X, ArrowUp, ArrowDown, AlertTriangle, AlertCircle, Info, ChevronRight, Radio } from 'lucide-react'

// Daily Status → Team Performance (internal only — never rendered on the
// public share link). Styles: "TEAM PERFORMANCE" section of index.css.
// Chart colours validated with the dataviz palette checker: attendance
// #818cf8 / task time #4338ca (all checks pass; low-contrast light step is
// always accompanied by a values table).

const C_ATT = '#818cf8', C_TASK = '#4338ca'
const fmtH = n => (n == null ? '—' : `${Math.round(n * 10) / 10}h`)
const fmtP = n => (n == null ? '—' : `${n}%`)
// Status tone for a percentage where higher is better. Text only carries
// the tone together with the number itself, never colour alone.
const toneOf = (v, good, ok) => (v == null ? '' : v >= good ? 'good' : v >= ok ? 'warn' : 'bad')

const METRIC_HELP = {
  attendance: 'Checked-in hours ÷ capacity. Capacity = weekdays in the period (up to today) × 8h, minus approved leave.',
  taskHours: 'Hours logged against tasks with Start / Pause / Complete.',
  loggingPct: 'Task hours ÷ attendance hours: how much time at work is accounted for against tasks.',
  completed: 'Tasks moved to a closed status (plus IT / Support tickets resolved) in the period.',
  onTimePct: 'Of completed tasks that had a due date, the share finished on or before it.',
  estimateAccuracy: 'Estimated ÷ actual hours on completed tasks. 100% = on estimate; below 100% = took longer.',
  overdue: 'Open tasks assigned to this person that are past their due date (as of today).',
}

function Flag({ id }) {
  const m = FLAG_META[id]
  const Icon = m.tone === 'danger' ? AlertCircle : m.tone === 'warn' ? AlertTriangle : Info
  return <span className={`tp-flag ${m.tone}`} title={m.hint}><Icon size={12} />{m.label}</span>
}

function Kpi({ label, value, sub, help, tone }) {
  return (
    <div className="tp-kpi" title={help}>
      <div className="lbl">{label}</div>
      <div className={`val ${tone || ''}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

function Meter({ value, max = 100 }) {
  const w = value == null ? 0 : Math.max(0, Math.min(100, (value / max) * 100))
  return <span className="tp-meter"><span style={{ width: `${w}%` }} /></span>
}

const COLS = [
  { key: 'name', label: 'Resource', align: 'left' },
  { key: 'attendancePct', label: 'Attendance', help: METRIC_HELP.attendance },
  { key: 'taskHours', label: 'Task time', help: METRIC_HELP.taskHours, num: true },
  { key: 'loggingPct', label: 'Logged', help: METRIC_HELP.loggingPct },
  { key: 'completed', label: 'Completed', help: METRIC_HELP.completed, num: true },
  { key: 'onTimePct', label: 'On time', help: METRIC_HELP.onTimePct, num: true },
  { key: 'estimateAccuracy', label: 'Est. accuracy', help: METRIC_HELP.estimateAccuracy, num: true },
  { key: 'overdue', label: 'Overdue', help: METRIC_HELP.overdue, num: true },
  { key: 'flags', label: 'Attention', align: 'left' },
]

export default function TeamPerformanceView({ data, period }) {
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('')
  const [onlyFlagged, setOnlyFlagged] = useState(false)
  const [sort, setSort] = useState({ key: 'flags', dir: 'desc' })
  const [openId, setOpenId] = useState(null)

  const deptName = id => data.departments.find(d => d.id === id)?.name
  const rows = useMemo(() => {
    const list = data.rows.filter(r =>
      (!q || r.name.toLowerCase().includes(q.toLowerCase())) &&
      (!dept || r.department_id === dept) &&
      (!onlyFlagged || r.flags.some(f => FLAG_META[f].tone !== 'info')))
    const val = r => {
      if (sort.key === 'flags') return r.flags.reduce((s, f) => s + (FLAG_META[f].tone === 'danger' ? 10 : FLAG_META[f].tone === 'warn' ? 3 : 1), 0)
      return r[sort.key]
    }
    return [...list].sort((a, b) => {
      const av = val(a), bv = val(b)
      if (av == null && bv == null) return a.name.localeCompare(b.name)
      if (av == null) return 1
      if (bv == null) return -1
      const c = typeof av === 'string' ? av.localeCompare(bv) : av - bv
      return (sort.dir === 'asc' ? c : -c) || a.name.localeCompare(b.name)
    })
  }, [data.rows, q, dept, onlyFlagged, sort])
  const t = data.totals
  const open = data.rows.find(r => r.id === openId)
  const periodWord = period === 'daily' ? 'today' : period === 'weekly' ? 'this week' : 'this month'

  return (
    <div className="tp">
      <div className="tp-kpis">
        <Kpi label="Capacity used" value={fmtP(t.utilizationPct)} tone={toneOf(t.utilizationPct, 70, 50)}
          sub={`${fmtH(t.taskHours)} task time of ${fmtH(t.capacity)} capacity`} help="Task hours ÷ total capacity across the team" />
        <Kpi label="Attendance" value={fmtP(t.attendancePct)} tone={toneOf(t.attendancePct, 90, 75)}
          sub={`${t.present} of ${t.people} people checked in`} help={METRIC_HELP.attendance} />
        <Kpi label="Logged to tasks" value={fmtP(t.loggingPct)} tone={toneOf(t.loggingPct, 75, 50)}
          sub={`${fmtH(t.taskHours)} of ${fmtH(t.attendance)} at work`} help={METRIC_HELP.loggingPct} />
        <Kpi label="Completed" value={t.completed} sub={`On time ${fmtP(t.onTimePct)}`} help={METRIC_HELP.completed} />
        <Kpi label="Estimate accuracy" value={fmtP(t.estimateAccuracy)} tone={toneOf(t.estimateAccuracy, 85, 70)}
          sub="Estimated ÷ actual hours" help={METRIC_HELP.estimateAccuracy} />
        <Kpi label="Needs attention" value={t.flagged} tone={t.flagged ? 'bad' : 'good'}
          sub={`${t.overdue} overdue task${t.overdue === 1 ? '' : 's'}`} help="People with at least one warning flag" />
      </div>

      <div className="tp-card">
        <div className="tp-toolbar">
          <div className="ttl">Team performance <span className="tb-count">{rows.length}</span></div>
          <div className="tp-search"><Search size={13} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search people…" aria-label="Search people" /></div>
          <select className="tp-select" value={dept} onChange={e => setDept(e.target.value)} aria-label="Department">
            <option value="">All departments</option>
            {data.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <label className="tb-check"><input type="checkbox" checked={onlyFlagged} onChange={e => setOnlyFlagged(e.target.checked)} /> Needs attention only</label>
          <span className="tp-note">{data.days.length} working day{data.days.length === 1 ? '' : 's'} · {data.targetHours}h/day</span>
        </div>
        <div className="tp-scroll">
          <table className="tp-table">
            <thead>
              <tr>{COLS.map(c => (
                <th key={c.key} className={c.align === 'left' ? 'l' : ''} title={c.help}
                  onClick={() => setSort(s => ({ key: c.key, dir: s.key === c.key && s.dir === 'desc' ? 'asc' : 'desc' }))}>
                  <span>{c.label}{sort.key === c.key && (sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}</span>
                </th>
              ))}<th aria-label="Open" /></tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={COLS.length + 1} className="tp-empty">No one matches these filters</td></tr>}
              {rows.map(r => (
                <tr key={r.id} onClick={() => setOpenId(r.id)} className={openId === r.id ? 'sel' : ''}>
                  <td className="l">
                    <div className="tp-who">
                      <span className="tp-av">{initials(r.name)}</span>
                      <div>
                        <div className="nm">{r.name}{r.liveNow && <span className="tp-live" title="Checked in or working on a task right now"><Radio size={10} /> Live</span>}</div>
                        <div className="meta">{[deptName(r.department_id), r.role?.replace(/_/g, ' ')].filter(Boolean).join(' · ')}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="tp-cellbar">
                      <Meter value={r.attendancePct} />
                      <span className={`n ${toneOf(r.attendancePct, 90, 75)}`}>{fmtP(r.attendancePct)}</span>
                    </div>
                    <div className="tp-sub">{fmtH(r.attendance)} / {fmtH(r.capacity)}{r.leaveDays ? ` · ${r.leaveDays}d leave` : ''}</div>
                  </td>
                  <td className="num">{fmtH(r.taskHours)}<div className="tp-sub">{r.tasksWorked} task{r.tasksWorked === 1 ? '' : 's'}</div></td>
                  <td>
                    <div className="tp-cellbar">
                      <Meter value={r.loggingPct} />
                      <span className={`n ${toneOf(r.loggingPct, 75, 50)}`}>{fmtP(r.loggingPct)}</span>
                    </div>
                  </td>
                  <td className="num">{r.completed}{r.resolvedTickets > 0 && <div className="tp-sub">{r.resolvedTickets} ticket{r.resolvedTickets === 1 ? '' : 's'}</div>}</td>
                  <td className={`num ${toneOf(r.onTimePct, 85, 60)}`}>{fmtP(r.onTimePct)}</td>
                  <td className={`num ${toneOf(r.estimateAccuracy, 85, 70)}`}>{fmtP(r.estimateAccuracy)}</td>
                  <td className={`num ${r.overdue ? 'bad' : 'muted'}`}>{r.overdue}</td>
                  <td className="l"><div className="tp-flags">{r.flags.length ? r.flags.map(f => <Flag key={f} id={f} />) : <span className="tp-ok">On track</span>}</div></td>
                  <td className="chev"><ChevronRight size={15} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="tp-foot">
          Hover a column heading for how it's calculated. Figures cover {periodWord} ({dateFmt(data.from)}{data.from !== data.to ? ` – ${dateFmt(data.to)}` : ''}).
        </div>
      </div>

      {open && <PersonPanel r={open} deptName={deptName(open.department_id)} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function initials(name) {
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'
}

function PersonPanel({ r, deptName, onClose }) {
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])
  const [hover, setHover] = useState(null)
  const max = Math.max(8, ...r.daily.map(d => Math.max(d.attendance, d.task)))
  return (
    <>
      <div className="tp-scrim" onClick={onClose} />
      <aside className="tp-panel" role="dialog" aria-label={`${r.name} performance`}>
        <div className="hd">
          <span className="tp-av lg">{initials(r.name)}</span>
          <div style={{ minWidth: 0 }}>
            <div className="nm">{r.name}</div>
            <div className="meta">{[deptName, r.role?.replace(/_/g, ' ')].filter(Boolean).join(' · ')}</div>
          </div>
          <button className="tb-iconbtn" onClick={onClose} title="Close"><X size={16} /></button>
        </div>

        <div className="body">
          <div className="tp-mini">
            <div><span className="lbl">Attendance</span><b>{fmtH(r.attendance)}</b><span className="sub">of {fmtH(r.capacity)} · {fmtP(r.attendancePct)}</span></div>
            <div><span className="lbl">Task time</span><b>{fmtH(r.taskHours)}</b><span className="sub">{fmtP(r.loggingPct)} of attendance</span></div>
            <div><span className="lbl">Completed</span><b>{r.completed}</b><span className="sub">on time {fmtP(r.onTimePct)}</span></div>
            <div><span className="lbl">Est. accuracy</span><b>{fmtP(r.estimateAccuracy)}</b><span className="sub">{r.estHours ? `${fmtH(r.estHours)} est / ${fmtH(r.actHours)} actual` : 'no estimates'}</span></div>
          </div>

          {r.flags.length > 0 && (
            <div className="tp-block">
              <div className="bt">Needs attention</div>
              {r.flags.map(f => <div key={f} className="tp-flagrow"><Flag id={f} /><span>{FLAG_META[f].hint}</span></div>)}
            </div>
          )}

          <div className="tp-block">
            <div className="bt">Day by day
              <span className="tp-legend"><i style={{ background: C_ATT }} />Attendance<i style={{ background: C_TASK }} />Task time</span>
            </div>
            <div className="tp-chart" onMouseLeave={() => setHover(null)}>
              <div className="grid"><span>{Math.round(max)}h</span><span>{Math.round(max / 2)}h</span><span>0</span></div>
              <div className="cols">
                {r.daily.map(d => (
                  <div key={d.date} className={`col ${hover === d.date ? 'on' : ''}`} onMouseEnter={() => setHover(d.date)}>
                    <div className="bars">
                      <span style={{ height: `${(d.attendance / max) * 100}%`, background: C_ATT }} />
                      <span style={{ height: `${(d.task / max) * 100}%`, background: C_TASK }} />
                    </div>
                    <div className="x">{new Date(d.date + 'T00:00:00').toLocaleDateString('en-IN', r.daily.length > 7 ? { day: '2-digit' } : { weekday: 'short' })}</div>
                    {hover === d.date && (
                      <div className="tip">
                        <b>{dateFmt(d.date)}</b>
                        {d.leave ? <div>On leave</div> : <>
                          <div><i style={{ background: C_ATT }} />Attendance <b>{fmtH(d.attendance)}</b>{d.open ? ' (open)' : ''}</div>
                          <div><i style={{ background: C_TASK }} />Task time <b>{fmtH(d.task)}</b></div>
                          <div>Completed <b>{d.completed}</b></div>
                        </>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <table className="tp-mtable">
              <thead><tr><th className="l">Day</th><th>Attendance</th><th>Task time</th><th>Logged</th><th>Done</th></tr></thead>
              <tbody>{r.daily.map(d => (
                <tr key={d.date}>
                  <td className="l">{dateFmt(d.date)}</td>
                  {d.leave ? <td colSpan={4} className="muted">On leave</td> : <>
                    <td>{fmtH(d.attendance)}{d.open ? '*' : ''}</td><td>{fmtH(d.task)}</td>
                    <td>{d.attendance ? `${Math.round((d.task / d.attendance) * 100)}%` : '—'}</td><td>{d.completed || '—'}</td>
                  </>}
                </tr>
              ))}</tbody>
            </table>
            {r.daily.some(d => d.open) && <div className="tp-note" style={{ marginTop: 6 }}>* check-in still open, so its hours aren't counted yet</div>}
          </div>

          <div className="tp-block">
            <div className="bt">Completed tasks <span className="tb-count">{r.completedList.length}</span></div>
            {r.completedList.length === 0 ? <div className="tp-note">No tasks completed in this period.</div> : (
              <table className="tp-mtable">
                <thead><tr><th className="l">Task</th><th>Due</th><th>Done</th><th>Est.</th><th>Actual</th></tr></thead>
                <tbody>{r.completedList.map(c => {
                  const late = c.due && c.at.slice(0, 10) > c.due
                  const over = c.est && c.act && c.act > c.est * 1.2
                  return (
                    <tr key={c.id}>
                      <td className="l"><span className="tb-id">{c.code}</span> {c.name}</td>
                      <td>{c.due ? dateFmt(c.due) : '—'}</td>
                      <td className={late ? 'bad' : ''}>{dateFmt(c.at)}{late ? ' (late)' : ''}</td>
                      <td>{fmtH(c.est)}</td>
                      <td className={over ? 'warn' : ''}>{fmtH(c.act)}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
