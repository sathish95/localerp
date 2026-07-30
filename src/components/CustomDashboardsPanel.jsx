import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Loader, Modal, Confirm } from './ui'
import CustomDashboardBuilder from './CustomDashboardBuilder'
import { widgetMeta } from '../lib/dashboardWidgets'
import { Plus, Trash2 } from 'lucide-react'

const fmt = d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const initForm = () => ({ name: '', period_type: 'monthly', period_start: '', period_end: '', template: 'standard' })
const Kpi = ({ label, v, color = '#6366f1' }) => (
  <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, borderTop: `2px solid ${color}`, padding: '10px 14px', minWidth: 0, overflow: 'hidden' }}>
    <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 'clamp(14px,3vw,20px)', color, lineHeight: 1.2, marginBottom: 3, overflowWrap: 'break-word' }}>{v}</div>
    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
  </div>
)

// Default starter template — at least 2 widgets from every category
// (Project, Finance, Procurement, Resource), laid out 2-per-row.
const DEFAULT_TEMPLATE = [
  { widget_type: 'sprint_progress',       x: 0, y: 0,  w: 6, h: 7 },
  { widget_type: 'budget_health',         x: 6, y: 0,  w: 6, h: 6 },
  { widget_type: 'task_status_breakdown', x: 0, y: 7,  w: 6, h: 6 },
  { widget_type: 'spend_in_period',       x: 6, y: 6,  w: 6, h: 6 },
  { widget_type: 'procurement_pipeline',  x: 0, y: 13, w: 6, h: 6 },
  { widget_type: 'resource_utilization',  x: 6, y: 12, w: 6, h: 7 },
  { widget_type: 'requests_in_period',    x: 0, y: 19, w: 6, h: 4 },
  { widget_type: 'team_hours_summary',    x: 6, y: 19, w: 6, h: 6 },
]

// Custom review dashboards for a single project — drag-and-drop widgets,
// bound to a weekly/monthly/custom date range. Used inside Task Management's
// Reports tab, scoped to whichever project is currently selected there.
export default function CustomDashboardsPanel({ projectId }) {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const canManage = ['admin', 'ceo', 'manager', 'department_head'].includes(role)
  const [dashboards, setDashboards] = useState([])
  const [widgetCount, setWidgetCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [openDash, setOpenDash] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(initForm())
  const [delDash, setDelDash] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { if (projectId) loadDashboards(); else { setDashboards([]); setWidgetCount(0) } }, [projectId])

  async function loadDashboards() {
    setLoading(true)
    const { data } = await supabase.from('custom_dashboards').select('*').eq('project_id', projectId).order('created_at', { ascending: false })
    setDashboards(data || [])
    const ids = (data || []).map(d => d.id)
    if (ids.length) {
      const { count } = await supabase.from('custom_dashboard_widgets').select('id', { count: 'exact', head: true }).in('dashboard_id', ids)
      setWidgetCount(count || 0)
    } else setWidgetCount(0)
    setLoading(false)
  }

  function computeRange(type, refDate) {
    if (!refDate) return { start: '', end: '' }
    const d = new Date(refDate)
    if (type === 'weekly') {
      const day = d.getDay()
      const diffToMonday = day === 0 ? -6 : 1 - day
      const monday = new Date(d); monday.setDate(d.getDate() + diffToMonday)
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
      return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) }
    }
    if (type === 'monthly') {
      const first = new Date(d.getFullYear(), d.getMonth(), 1)
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) }
    }
    return { start: '', end: '' }
  }

  function handleRefDateChange(refDate) {
    const { start, end } = computeRange(form.period_type, refDate)
    setForm(f => ({ ...f, period_start: start, period_end: end }))
  }

  async function createDashboard(e) {
    e.preventDefault()
    if (!form.name.trim() || !form.period_start || !form.period_end) { alert('Name and a date range are required'); return }
    setSubmitting(true)
    try {
      const { data, error } = await supabase.from('custom_dashboards').insert({
        project_id: projectId, name: form.name, period_type: form.period_type,
        period_start: form.period_start, period_end: form.period_end, created_by: profile.id,
      }).select().single()
      if (error) throw error
      if (form.template === 'standard') {
        const widgetRows = DEFAULT_TEMPLATE.map(t => {
          const meta = widgetMeta(t.widget_type)
          return { dashboard_id: data.id, widget_type: t.widget_type, title: meta?.label, layout_x: t.x, layout_y: t.y, layout_w: t.w, layout_h: t.h }
        })
        const { error: widgetErr } = await supabase.from('custom_dashboard_widgets').insert(widgetRows)
        if (widgetErr) throw widgetErr
      }
      setShowCreate(false); setForm(initForm())
      loadDashboards(); setOpenDash(data)
    } catch (e) { alert(e.message) } finally { setSubmitting(false) }
  }

  async function deleteDashboard(id) {
    await supabase.from('custom_dashboards').delete().eq('id', id)
    setDelDash(null); loadDashboards()
  }

  if (openDash) return <CustomDashboardBuilder dashboard={openDash} canEdit={canManage || openDash.created_by === profile?.id} onClose={() => { setOpenDash(null); loadDashboards() }} />

  if (!projectId) return (
    <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--text-muted)' }}>
      <div style={{ fontSize: 30, marginBottom: 10 }}>📊</div>
      <div style={{ fontWeight: 600 }}>Select a project in the filter bar to see or build its custom dashboards</div>
    </div>
  )

  const weeklyCount = dashboards.filter(d => d.period_type === 'weekly').length
  const monthlyCount = dashboards.filter(d => d.period_type === 'monthly').length
  const customCount = dashboards.filter(d => d.period_type === 'custom').length

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(105px,1fr))', gap: 10, marginBottom: 16 }}>
        <Kpi label="Dashboards" v={dashboards.length} color="#6366f1" />
        <Kpi label="Widgets" v={widgetCount} color="#7c3aed" />
        <Kpi label="Weekly" v={weeklyCount} color="#059669" />
        <Kpi label="Monthly" v={monthlyCount} color="#0891b2" />
        <Kpi label="Custom" v={customCount} color="#f59e0b" />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-primary btn-sm" onClick={() => { setForm(initForm()); setShowCreate(true) }} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Plus size={13} /> New Dashboard</button>
      </div>

      {loading ? <Loader /> : dashboards.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>🧩</div>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>No custom dashboards yet for this project</div>
          <button className="btn btn-primary btn-sm" onClick={() => { setForm(initForm()); setShowCreate(true) }}>+ Build your first dashboard</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 14 }}>
          {dashboards.map(d => (
            <div key={d.id} style={{ background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 16, padding: '16px 18px', boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{d.name}</div>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#ede9fe', color: '#6d28d9', textTransform: 'capitalize', flexShrink: 0 }}>{d.period_type}</span>
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 14 }}>{fmt(d.period_start)} → {fmt(d.period_end)}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => setOpenDash(d)}>Open</button>
                {(canManage || d.created_by === profile?.id) && <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => setDelDash(d.id)}><Trash2 size={13} /></button>}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Custom Dashboard" size="md"
        footer={<><button className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button><button className="btn btn-primary" onClick={createDashboard} disabled={submitting}>{submitting ? 'Creating…' : 'Create'}</button></>}>
        <div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. March 2026 Monthly Review" /></div>
        <div className="form-group"><label className="form-label">Period Type</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {['weekly', 'monthly', 'custom'].map(t => (
              <button key={t} type="button" onClick={() => setForm(f => ({ ...f, period_type: t }))}
                style={{ flex: 1, padding: '8px', borderRadius: 8, border: `2px solid ${form.period_type === t ? '#6366f1' : '#e2e8f0'}`, background: form.period_type === t ? '#ede9fe' : '#fff', color: form.period_type === t ? '#6366f1' : '#475569', fontWeight: 700, fontSize: 12, cursor: 'pointer', textTransform: 'capitalize' }}>{t}</button>
            ))}
          </div>
        </div>
        {form.period_type !== 'custom' && (
          <div className="form-group"><label className="form-label">{form.period_type === 'weekly' ? 'Any day in the week' : 'Any day in the month'}</label>
            <input className="form-input" type="date" onChange={e => handleRefDateChange(e.target.value)} />
          </div>
        )}
        <div className="form-row">
          <div className="form-group"><label className="form-label">Start Date</label><input className="form-input" type="date" value={form.period_start} onChange={e => setForm(f => ({ ...f, period_start: e.target.value }))} /></div>
          <div className="form-group"><label className="form-label">End Date</label><input className="form-input" type="date" value={form.period_end} min={form.period_start} onChange={e => setForm(f => ({ ...f, period_end: e.target.value }))} /></div>
        </div>
        <div className="form-group">
          <label className="form-label">Template</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <button type="button" onClick={() => setForm(f => ({ ...f, template: 'blank' }))}
              style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', border: `2px solid ${form.template === 'blank' ? '#6366f1' : '#e2e8f0'}`, background: form.template === 'blank' ? '#ede9fe' : '#fff' }}>
              <div style={{ fontSize: 18, marginBottom: 4 }}>📄</div>
              <div style={{ fontWeight: 700, fontSize: 12.5 }}>Blank</div>
              <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2 }}>Start empty, add widgets yourself</div>
            </button>
            <button type="button" onClick={() => setForm(f => ({ ...f, template: 'standard' }))}
              style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', border: `2px solid ${form.template === 'standard' ? '#6366f1' : '#e2e8f0'}`, background: form.template === 'standard' ? '#ede9fe' : '#fff' }}>
              <div style={{ fontSize: 18, marginBottom: 4 }}>🧩</div>
              <div style={{ fontWeight: 700, fontSize: 12.5 }}>Standard Review</div>
              <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2 }}>8 widgets pre-loaded — 2 from each category</div>
            </button>
          </div>
        </div>
      </Modal>

      <Confirm open={!!delDash} message="Delete this dashboard and all its widgets?" danger onConfirm={() => deleteDashboard(delDash)} onCancel={() => setDelDash(null)} />
    </div>
  )
}
