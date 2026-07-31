import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { dateFmt } from '../lib/supabase'
import { getMyQueue, getTeamQueue, updateTaskStatus, isOverdue } from '../lib/salesTasks'
import { StatusBadge, Loader, Empty, StatCard } from '../components/ui'
import { ClipboardList, AlertTriangle, CheckCircle } from 'lucide-react'

const MANAGER_ROLES = ['admin', 'ceo', 'sales_head', 'regional_sales_head', 'sales_ops']

export default function SalesTasksPage() {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const isManager = MANAGER_ROLES.includes(role)
  const [view, setView] = useState('mine')
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState('due_date')

  useEffect(() => { load() }, [view])

  async function load() {
    setLoading(true)
    setTasks(view === 'mine' ? await getMyQueue(profile.id) : await getTeamQueue())
    setLoading(false)
  }

  async function complete(id) {
    await updateTaskStatus(id, 'Completed')
    await load()
  }

  const sorted = [...tasks].sort((a, b) => {
    if (sortBy === 'priority') { const order = { High: 0, Medium: 1, Low: 2 }; return order[a.priority] - order[b.priority] }
    return a.due_date.localeCompare(b.due_date)
  })
  const overdue = tasks.filter(isOverdue)

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Sales Tasks</div>
          <div className="page-subtitle">"What needs to happen" — separate from the Activity history log</div>
        </div>
        {isManager && (
          <div className="page-actions">
            <button className={`btn btn-ghost ${view === 'mine' ? 'btn-primary' : ''}`} onClick={() => setView('mine')}>My Queue</button>
            <button className={`btn btn-ghost ${view === 'team' ? 'btn-primary' : ''}`} onClick={() => setView('team')}>Team Queue</button>
          </div>
        )}
      </div>

      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Open Tasks" value={tasks.length} icon={<ClipboardList size={17} />} accent="#0ea5e9" />
        <StatCard label="Overdue" value={overdue.length} icon={<AlertTriangle size={17} />} accent="#dc2626" />
        <StatCard label="High Priority" value={tasks.filter(t => t.priority === 'High').length} icon={<AlertTriangle size={17} />} accent="#f59e0b" />
      </div>

      <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: '#64748b' }}>Sort by</span>
        <select className="form-select" style={{ fontSize: 12, width: 160 }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="due_date">Due Date</option>
          <option value="priority">Priority</option>
        </select>
      </div>

      {sorted.length === 0 ? (
        <div className="card" style={{ padding: '20px 24px' }}><Empty icon="✅" title="No open tasks" desc="You're all caught up" /></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Type</th>{view === 'team' && <th>Assignee</th>}<th>Related To</th><th>Due Date</th><th>Priority</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {sorted.map(t => (
                <tr key={t.id} style={isOverdue(t) ? { background: '#fef2f2' } : undefined}>
                  <td className="td-bold">{t.task_type}</td>
                  {view === 'team' && <td>{t.assignee?.full_name}</td>}
                  <td style={{ fontSize: 12 }}>{t.related_to_type}</td>
                  <td style={{ fontSize: 12, color: isOverdue(t) ? '#dc2626' : '#94a3b8', fontWeight: isOverdue(t) ? 700 : 400 }}>
                    {dateFmt(t.due_date)}{isOverdue(t) && ' · Overdue'}
                  </td>
                  <td>{t.priority}</td>
                  <td><StatusBadge status={t.status} /></td>
                  <td>{t.status !== 'Completed' && <button className="btn btn-ghost btn-sm" onClick={() => complete(t.id)}><CheckCircle size={13} /> Complete</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
