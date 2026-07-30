import { useState, useEffect } from 'react'
import { supabase, dateFmt } from '../../lib/supabase'
import { Stat, StatRow, ProgressBar, BarRow, EmptyState, Loading } from './widgetUi'

const TASK_STATUS_COLORS = { backlog:'#64748b', todo:'#3b82f6', in_progress:'#f59e0b', delayed:'#e11d48', qa:'#8b5cf6', ready_for_demo:'#10b981', closed:'#94a3b8' }
const TASK_STATUS_LABELS = { backlog:'Backlog', todo:'To Do', in_progress:'In Progress', delayed:'Delayed', qa:'QA', ready_for_demo:'Ready for Demo', closed:'Closed' }

export function SprintProgressWidget({ projectId, periodStart, periodEnd, config }) {
  const [loading, setLoading] = useState(true)
  const [sprint, setSprint] = useState(null)
  const [stories, setStories] = useState([])
  const [tasks, setTasks] = useState([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data: sprints } = await supabase.from('sprints').select('*').eq('project_id', projectId).order('start_date', { ascending: false })
      let chosen = null
      if (config?.sprint_id) chosen = (sprints || []).find(s => s.id === config.sprint_id) || null
      if (!chosen) chosen = (sprints || []).find(s => s.status === 'active')
      if (!chosen) chosen = (sprints || []).find(s => s.start_date && s.end_date && s.start_date <= periodEnd && s.end_date >= periodStart)
      if (!chosen) chosen = (sprints || [])[0] || null
      if (cancelled) return
      setSprint(chosen)
      if (chosen) {
        const [{ data: st }, { data: tk }] = await Promise.all([
          supabase.from('user_stories').select('story_points,status').eq('sprint_id', chosen.id),
          supabase.from('project_tasks').select('status').eq('sprint_id', chosen.id),
        ])
        if (!cancelled) { setStories(st || []); setTasks(tk || []) }
      } else { setStories([]); setTasks([]) }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [projectId, periodStart, periodEnd, config?.sprint_id])

  if (loading) return <Loading />
  if (!sprint) return <EmptyState icon="🏃" text="No sprint found for this project" />

  const totalPts = stories.reduce((s, x) => s + (x.story_points || 0), 0)
  const donePts = stories.filter(x => x.status === 'done').reduce((s, x) => s + (x.story_points || 0), 0)
  const pct = totalPts > 0 ? Math.round((donePts / totalPts) * 100) : 0
  const byStatus = Object.keys(TASK_STATUS_LABELS).map(k => ({ k, n: tasks.filter(t => t.status === k).length })).filter(x => x.n > 0)
  const maxN = Math.max(...byStatus.map(x => x.n), 1)

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{sprint.name}</div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>{dateFmt(sprint.start_date)} → {dateFmt(sprint.end_date)}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
        <span style={{ color: '#475569' }}>Story Points</span>
        <span style={{ fontWeight: 700 }}>{donePts} / {totalPts} ({pct}%)</span>
      </div>
      <ProgressBar pct={pct} color={pct === 100 ? '#10b981' : '#6366f1'} />
      <div style={{ marginTop: 14 }}>
        {byStatus.length === 0 ? <EmptyState icon="📋" text="No tasks in this sprint" /> :
          byStatus.map(x => <BarRow key={x.k} label={TASK_STATUS_LABELS[x.k]} value={x.n} max={maxN} color={TASK_STATUS_COLORS[x.k]} />)}
      </div>
    </div>
  )
}

export function TaskStatusBreakdownWidget({ projectId, periodStart, periodEnd }) {
  const [loading, setLoading] = useState(true)
  const [tasks, setTasks] = useState([])

  useEffect(() => {
    let cancelled = false
    supabase.from('project_tasks').select('status').eq('project_id', projectId)
      .gte('created_at', periodStart).lte('created_at', periodEnd + 'T23:59:59')
      .then(({ data }) => { if (!cancelled) { setTasks(data || []); setLoading(false) } })
    return () => { cancelled = true }
  }, [projectId, periodStart, periodEnd])

  if (loading) return <Loading />
  if (tasks.length === 0) return <EmptyState icon="📋" text="No tasks created in this period" />

  const byStatus = Object.keys(TASK_STATUS_LABELS).map(k => ({ k, n: tasks.filter(t => t.status === k).length })).filter(x => x.n > 0)
  const maxN = Math.max(...byStatus.map(x => x.n), 1)

  return (
    <div>
      <StatRow><Stat label="Total Tasks" value={tasks.length} color="#6366f1" /></StatRow>
      {byStatus.map(x => <BarRow key={x.k} label={TASK_STATUS_LABELS[x.k]} value={x.n} max={maxN} color={TASK_STATUS_COLORS[x.k]} />)}
    </div>
  )
}

export function MilestoneProgressWidget({ projectId, periodStart, periodEnd }) {
  const [loading, setLoading] = useState(true)
  const [milestones, setMilestones] = useState([])

  useEffect(() => {
    let cancelled = false
    supabase.from('project_milestones').select('*').eq('project_id', projectId).order('due_date')
      .then(({ data }) => { if (!cancelled) { setMilestones(data || []); setLoading(false) } })
    return () => { cancelled = true }
  }, [projectId])

  if (loading) return <Loading />

  const inRange = milestones.filter(m => {
    const start = m.start_date || m.due_date, end = m.due_date || m.start_date
    if (!start || !end) return true
    return start <= periodEnd && end >= periodStart
  })
  if (inRange.length === 0) return <EmptyState icon="🏁" text="No milestones overlap this period" />

  const MSC = { pending: '#94a3b8', in_progress: '#d97706', completed: '#059669', delayed: '#e11d48' }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {inRange.slice(0, 8).map(m => (
        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: MSC[m.status] || '#94a3b8', flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
          <span style={{ fontSize: 10, color: MSC[m.status] || '#94a3b8', fontWeight: 700, textTransform: 'capitalize', flexShrink: 0 }}>{m.status?.replace(/_/g, ' ')}</span>
        </div>
      ))}
    </div>
  )
}
