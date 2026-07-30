import { useState, useEffect } from 'react'
import GridLayout, { WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { supabase } from '../lib/supabase'
import { Modal, Confirm } from './ui'
import { WIDGET_CATALOG, WIDGET_CATEGORIES, WIDGET_COMPONENTS, widgetMeta } from '../lib/dashboardWidgets'
import { Plus, X, ArrowLeft } from 'lucide-react'

const ResponsiveGridLayout = WidthProvider(GridLayout)

export default function CustomDashboardBuilder({ dashboard, canEdit, onClose }) {
  const [widgets, setWidgets] = useState([])
  const [layout, setLayout] = useState([])
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [delWidget, setDelWidget] = useState(null)

  useEffect(() => { load() }, [dashboard.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('custom_dashboard_widgets').select('*').eq('dashboard_id', dashboard.id).order('created_at')
    const ws = data || []
    setWidgets(ws)
    setLayout(ws.map(w => ({ i: w.id, x: w.layout_x, y: w.layout_y, w: w.layout_w, h: w.layout_h })))
    setLoading(false)
    setDirty(false)
  }

  async function addWidget(widgetType) {
    const meta = widgetMeta(widgetType)
    const maxY = layout.reduce((m, l) => Math.max(m, l.y + l.h), 0)
    const { data, error } = await supabase.from('custom_dashboard_widgets').insert({
      dashboard_id: dashboard.id, widget_type: widgetType, title: meta.label,
      layout_x: 0, layout_y: maxY, layout_w: meta.defaultW, layout_h: meta.defaultH,
    }).select().single()
    if (error) { alert(error.message); return }
    setWidgets(prev => [...prev, data])
    setLayout(prev => [...prev, { i: data.id, x: 0, y: maxY, w: meta.defaultW, h: meta.defaultH }])
    setShowAdd(false)
  }

  async function removeWidget(id) {
    await supabase.from('custom_dashboard_widgets').delete().eq('id', id)
    setWidgets(prev => prev.filter(w => w.id !== id))
    setLayout(prev => prev.filter(l => l.i !== id))
    setDelWidget(null)
  }

  function onLayoutChange(newLayout) {
    setLayout(newLayout)
    setDirty(true)
  }

  async function saveLayout() {
    setSaving(true)
    try {
      await Promise.all(layout.map(l =>
        supabase.from('custom_dashboard_widgets').update({ layout_x: l.x, layout_y: l.y, layout_w: l.w, layout_h: l.h }).eq('id', l.i)
      ))
      setDirty(false)
    } finally { setSaving(false) }
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner" /></div>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: 5 }}><ArrowLeft size={13} /> Dashboards</button>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{dashboard.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{dashboard.period_type} · {dashboard.period_start} → {dashboard.period_end}</div>
        </div>
        {canEdit && <>
          {dirty && <button className="btn btn-primary btn-sm" onClick={saveLayout} disabled={saving}>{saving ? 'Saving…' : 'Save Layout'}</button>}
          <button className="btn btn-outline btn-sm" onClick={() => setShowAdd(true)} style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Plus size={13} /> Add Widget</button>
        </>}
      </div>

      {widgets.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>🧩</div>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>No widgets yet</div>
          {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Plus size={13} /> Add your first widget</button>}
        </div>
      ) : (
        <ResponsiveGridLayout
          className="layout" layout={layout} cols={12} rowHeight={30} margin={[14, 14]}
          isDraggable={canEdit} isResizable={canEdit} draggableHandle=".widget-drag-handle"
          onLayoutChange={onLayoutChange}>
          {widgets.map(w => {
            const Comp = WIDGET_COMPONENTS[w.widget_type]
            const meta = widgetMeta(w.widget_type)
            return (
              <div key={w.id} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div className={canEdit ? 'widget-drag-handle' : ''} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', cursor: canEdit ? 'move' : 'default', flexShrink: 0 }}>
                  <span style={{ fontSize: 13 }}>{meta?.icon}</span>
                  <span style={{ fontWeight: 700, fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title || meta?.label}</span>
                  {canEdit && <button onClick={() => setDelWidget(w.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, display: 'flex' }}><X size={13} /></button>}
                </div>
                <div style={{ flex: 1, padding: '14px 16px', overflow: 'auto' }}>
                  {Comp ? <Comp projectId={dashboard.project_id} periodStart={dashboard.period_start} periodEnd={dashboard.period_end} config={w.config || {}} /> : <div style={{ fontSize: 12, color: 'var(--rose)' }}>Unknown widget type</div>}
                </div>
              </div>
            )
          })}
        </ResponsiveGridLayout>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Widget" size="lg">
        {WIDGET_CATEGORIES.map(cat => (
          <div key={cat.id} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: cat.color, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>{cat.icon} {cat.label}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 8 }}>
              {WIDGET_CATALOG.filter(w => w.category === cat.id).map(w => (
                <button key={w.id} onClick={() => addWidget(w.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10, border: `1px solid ${cat.color}30`, background: `${cat.color}08`, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, color: 'var(--text)', textAlign: 'left' }}>
                  <span style={{ fontSize: 15 }}>{w.icon}</span>{w.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </Modal>

      <Confirm open={!!delWidget} message="Remove this widget from the dashboard?" danger onConfirm={() => removeWidget(delWidget)} onCancel={() => setDelWidget(null)} />
    </div>
  )
}
