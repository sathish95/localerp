import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useWorkspace } from '../context/WorkspaceContext'
import { supabase, dateFmt } from '../lib/supabase'
import { getTeamAttention } from '../lib/aiAttention'
import { Tabs, Loader, Empty } from '../components/ui'
import { UserCheck, AlertTriangle } from 'lucide-react'

const SEVERITY_COLOR = { high: '#dc2626', medium: '#f59e0b', low: '#64748b' }

// Industry-Adaptive Platform Phase 4 — simple list view only (Kanban/
// Calendar/Timeline are a stretch goal explicitly deferred). Fetch shape
// mirrors TasksPage.jsx's manager-branch query exactly (active projects +
// org-wide project-less tasks via the same `.or(...,project_id.is.null)`
// pattern) so a manager sees the same universe of tasks here as on the
// main Task Management page, just pre-grouped for a quick daily read.
const SL={backlog:'Backlog',todo:'To Do',in_progress:'In Progress',delayed:'Delayed',qa:'QA Testing',ready_for_demo:'Ready for Demo',closed:'Closed'}
const SC={backlog:'#64748b',todo:'#3b82f6',in_progress:'#f59e0b',delayed:'#e11d48',qa:'#8b5cf6',ready_for_demo:'#10b981',closed:'#94a3b8'}
const isOverdue=t=>t.planned_end_date&&new Date(t.planned_end_date)<new Date()&&t.status!=='closed'

export default function TeamWorkPage() {
  const { term } = useWorkspace()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('assigned')
  const [attention, setAttention] = useState([])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const pR = await supabase.from('projects').select('id,name').eq('status', 'active').order('name')
    const ids = (pR.data || []).map(p => p.id)
    const orFilter = ids.length > 0 ? `project_id.in.(${ids.join(',')}),project_id.is.null` : 'project_id.is.null'
    const tR = await supabase
      .from('project_tasks')
      .select('*,assignee:profiles!assigned_to(id,full_name),project:projects(id,name)')
      .or(orFilter)
      .neq('status', 'closed')
      .order('planned_end_date', { ascending: true, nullsFirst: false })
    setTasks(tR.data || [])
    getTeamAttention().then(setAttention).catch(() => setAttention([]))
    setLoading(false)
  }

  const groups = useMemo(() => ({
    assigned: tasks.filter(t => t.assigned_to),
    unassigned: tasks.filter(t => !t.assigned_to),
    overdue: tasks.filter(t => isOverdue(t)),
  }), [tasks])

  const visible = groups[tab] || []

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Team Work</div>
          <div className="page-subtitle">Open work across your team — {term('project', 'project')}-linked or direct</div>
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
          { id: 'assigned', label: 'Assigned', count: groups.assigned.length },
          { id: 'unassigned', label: 'Unassigned', count: groups.unassigned.length },
          { id: 'overdue', label: 'Overdue', count: groups.overdue.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {visible.length === 0 ? (
        <Empty icon={<UserCheck size={28} />} title="Nothing here" desc={`No ${tab} work right now.`} />
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead><tr><th>Task</th><th>{term('project', 'Project')}</th><th>Assignee</th><th>Status</th><th>Due</th></tr></thead>
            <tbody>
              {visible.map(t => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>{t.task_name}</td>
                  <td>{t.project?.name || <span style={{ color: 'var(--text-muted)' }}>No {term('project', 'project').toLowerCase()}</span>}</td>
                  <td>{t.assignee?.full_name || <span style={{ color: 'var(--text-muted)' }}>Unassigned</span>}</td>
                  <td><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, background: `${SC[t.status]}18`, color: SC[t.status] }}>{SL[t.status] || t.status}</span></td>
                  <td>{t.planned_end_date ? dateFmt(t.planned_end_date) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
