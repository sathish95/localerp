import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { Modal, SearchBox, StatusBadge, Loader, Empty, Confirm } from '../components/ui'
import {
  listWorkTypeConfigs, listWorkItems, getWorkItem, createWorkItem, updateWorkItem,
  listTasksForWorkItem, createTaskForWorkItem, getWorkItemHoursSummary,
} from '../lib/workItems'
import { listTaskTemplates } from '../lib/taskTemplates'
import {
  listTaskEquipment, linkTaskEquipment, returnTaskEquipment,
  listTaskMaterials, linkTaskMaterial, unlinkTaskMaterial,
} from '../lib/resourceLinks'
import { suggestAssignees } from '../lib/allocationRecommendation'
import AIDockedPanel from '../components/AIDockedPanel'
import { TaskActionsTab } from '../components/AIActionTabs'
import { Plus, ArrowLeft, MapPin, Building2, Clock, ListChecks, Users, Edit2, Box, Package, X, Sparkles } from 'lucide-react'

// Industry-Adaptive Platform — Phase 7 (Work Order). Generic list +
// create + detail view for `work_items`, closing the loop Phase 4
// deliberately left open: TasksPage.jsx's "Work Item" picker has existed
// since Phase 4 with nothing to actually populate it. This page is that
// missing piece — Work Order → Tasks → People → WorkLog → Timesheet,
// per the master prompt's Phase 7 spec. Hours logged against a work
// item's tasks already flow into the Timesheet page via work_logs
// (wired in Phase 5) — this page only surfaces that, it adds no new
// timesheet logic of its own.

const SL = { backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress', delayed: 'Delayed', qa: 'QA Testing', ready_for_demo: 'Ready for Demo', closed: 'Closed' }
const SC = { backlog: '#64748b', todo: '#3b82f6', in_progress: '#f59e0b', delayed: '#e11d48', qa: '#8b5cf6', ready_for_demo: '#10b981', closed: '#94a3b8' }
const PC = { critical: '#e11d48', high: '#f59e0b', medium: '#3b82f6', low: '#10b981' }

const initForm = () => ({ title: '', workTypeKey: '', clientId: '', locationId: '', status: 'open' })

export default function WorkItemsPage() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [types, setTypes] = useState([])
  const [clients, setClients] = useState([])
  const [locations, setLocations] = useState([])
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(initForm())
  const [submitting, setSubmitting] = useState(false)
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => { loadLookups() }, [])
  useEffect(() => { load() }, [filterType, filterStatus])

  async function loadLookups() {
    const [t, c, l] = await Promise.all([
      listWorkTypeConfigs(),
      supabase.from('customers').select('id,name').order('name'),
      supabase.from('locations').select('id,name').order('name'),
    ])
    setTypes(t)
    setClients(c.data || [])
    setLocations(l.data || [])
  }

  async function load() {
    setLoading(true)
    try {
      const data = await listWorkItems({ workType: filterType || undefined, status: filterStatus || undefined })
      setItems(data)
    } finally { setLoading(false) }
  }

  function openCreate() { setEditing(null); setForm(initForm()); setShowModal(true) }
  function openEdit(w) {
    setEditing(w)
    setForm({ title: w.title, workTypeKey: w.work_type_key, clientId: w.client_id || '', locationId: w.location_id || '', status: w.status })
    setShowModal(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim() || !form.workTypeKey) return
    setSubmitting(true)
    try {
      if (editing) await updateWorkItem(editing.id, form)
      else await createWorkItem(form, profile.id)
      setShowModal(false); load()
    } catch (err) { alert(err.message) } finally { setSubmitting(false) }
  }

  const filtered = items.filter(w => !search || w.title.toLowerCase().includes(search.toLowerCase()))
  const typeName = key => types.find(t => t.key === key)?.name || key?.replace(/_/g, ' ')

  if (selectedId) {
    return <WorkItemDetail id={selectedId} onBack={() => { setSelectedId(null); load() }} types={types} onEdit={w => { setSelectedId(null); openEdit(w) }} />
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Work Items</div>
          <div className="page-subtitle">Work Orders, Service Requests and other client/site work — outside or alongside Projects</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={openCreate}><Plus size={15} /> New Work Item</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}><SearchBox value={search} onChange={setSearch} placeholder="Search work items..." /></div>
        <select className="form-select" style={{ maxWidth: 200 }} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          {types.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
        </select>
        <select className="form-select" style={{ maxWidth: 160 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <Empty icon="🛠" title="No work items yet" desc="Create a Work Order, Service Request or other work item — tasks can be linked to it instead of a Project." />
      ) : (
        <div className="grid-3">
          {filtered.map(w => (
            <div key={w.id} className="card" style={{ cursor: 'pointer' }} onClick={() => setSelectedId(w.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <span className="badge badge-purple">{typeName(w.work_type_key)}</span>
                <StatusBadge status={w.status === 'open' ? 'active' : 'inactive'} />
              </div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{w.title}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--ink-soft)' }}>
                {w.client && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Building2 size={12} /> {w.client.name}</div>}
                {w.location && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><MapPin size={12} /> {w.location.name}</div>}
              </div>
              <div style={{ display: 'flex', gap: 14, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 12 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><ListChecks size={13} /> {w.taskCount} task{w.taskCount === 1 ? '' : 's'}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Clock size={13} /> {w.totalHours}h logged</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Work Item' : 'New Work Item'} size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>{submitting ? 'Saving...' : editing ? 'Save Changes' : 'Create'}</button>
        </>}>
        <form onSubmit={handleSubmit}>
          <div className="form-group"><label className="form-label">Title *</label>
            <input className="form-input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. AC Maintenance — Client ABC" required /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Type *</label>
              <select className="form-select" value={form.workTypeKey} onChange={e => setForm(f => ({ ...f, workTypeKey: e.target.value }))} required>
                <option value="">Select…</option>
                {types.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Status</label>
              <select className="form-select" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Client</label>
              <select className="form-select" value={form.clientId} onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}>
                <option value="">None</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Location</label>
              <select className="form-select" value={form.locationId} onChange={e => setForm(f => ({ ...f, locationId: e.target.value }))}>
                <option value="">None</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select></div>
          </div>
        </form>
      </Modal>
    </div>
  )
}

function WorkItemDetail({ id, onBack, types, onEdit }) {
  const { profile } = useAuth()
  const [item, setItem] = useState(null)
  const [tasks, setTasks] = useState([])
  const [hours, setHours] = useState({ totalHours: 0, byTaskHours: {} })
  const [loading, setLoading] = useState(true)
  const [showNewTask, setShowNewTask] = useState(false)
  const [taskName, setTaskName] = useState('')
  const [taskAssignee, setTaskAssignee] = useState('')
  const [savingTask, setSavingTask] = useState(false)
  const [templates, setTemplates] = useState([])
  const [templateId, setTemplateId] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [showAiPanel, setShowAiPanel] = useState(false)

  // Phase 9 — resource links (equipment/materials), scoped per-task but
  // rolled up to the work-item level here since that's this page's unit.
  const [equipment, setEquipment] = useState([])
  const [materials, setMaterials] = useState([])
  const [assetOptions, setAssetOptions] = useState([])
  const [productOptions, setProductOptions] = useState([])
  const [showAddEquip, setShowAddEquip] = useState(false)
  const [showAddMaterial, setShowAddMaterial] = useState(false)
  const [equipForm, setEquipForm] = useState({ taskId: '', assetId: '' })
  const [materialForm, setMaterialForm] = useState({ taskId: '', productId: '', quantity: '' })
  const [resourceErr, setResourceErr] = useState('')

  useEffect(() => { load() }, [id])
  useEffect(() => { listTaskTemplates().then(setTemplates).catch(() => setTemplates([])) }, [])
  // Phase 10 — deterministic "suggested people" (workload + shift based,
  // no LLM call) computed once when the New Task modal opens, not on
  // every keystroke — this is a suggestion list, not a live-typing feature.
  useEffect(() => {
    if (!showNewTask) return
    suggestAssignees({}).then(setSuggestions).catch(() => setSuggestions([]))
  }, [showNewTask])
  useEffect(() => {
    supabase.from('assets').select('id,asset_code,name,category').order('name').then(({ data }) => setAssetOptions(data || []))
    supabase.from('products').select('id,part_number,name').order('name').then(({ data }) => setProductOptions(data || []))
  }, [])

  async function load() {
    setLoading(true)
    try {
      const [w, t, h] = await Promise.all([getWorkItem(id), listTasksForWorkItem(id), getWorkItemHoursSummary(id)])
      setItem(w); setTasks(t); setHours(h)
      const taskIds = t.map(x => x.id)
      if (taskIds.length) {
        const [eqLists, matLists] = await Promise.all([
          Promise.all(taskIds.map(tid => listTaskEquipment(tid).then(rows => rows.map(r => ({ ...r, taskName: t.find(x => x.id === tid)?.task_name }))))),
          Promise.all(taskIds.map(tid => listTaskMaterials(tid).then(rows => rows.map(r => ({ ...r, taskName: t.find(x => x.id === tid)?.task_name }))))),
        ])
        setEquipment(eqLists.flat())
        setMaterials(matLists.flat())
      } else {
        setEquipment([]); setMaterials([])
      }
    } finally { setLoading(false) }
  }

  async function handleAddEquipment(e) {
    e.preventDefault(); setResourceErr('')
    if (!equipForm.taskId || !equipForm.assetId) return
    try {
      await linkTaskEquipment(equipForm.taskId, equipForm.assetId, profile.id)
      setShowAddEquip(false); setEquipForm({ taskId: '', assetId: '' }); load()
    } catch (err) { setResourceErr(err.message) }
  }

  async function handleReturnEquipment(linkId) {
    await returnTaskEquipment(linkId); load()
  }

  async function handleAddMaterial(e) {
    e.preventDefault(); setResourceErr('')
    if (!materialForm.taskId || !materialForm.productId) return
    try {
      await linkTaskMaterial(materialForm.taskId, materialForm.productId, materialForm.quantity ? Number(materialForm.quantity) : null, profile.id)
      setShowAddMaterial(false); setMaterialForm({ taskId: '', productId: '', quantity: '' }); load()
    } catch (err) { setResourceErr(err.message) }
  }

  async function handleUnlinkMaterial(linkId) {
    await unlinkTaskMaterial(linkId); load()
  }

  async function handleAddTask(e) {
    e.preventDefault()
    if (!taskName.trim()) return
    setSavingTask(true)
    try {
      const template = templateId ? templates.find(t => t.id === templateId) : null
      await createTaskForWorkItem(id, { taskName: taskName.trim(), assignedTo: taskAssignee || null, template }, profile.id)
      setTaskName(''); setTemplateId(''); setTaskAssignee(''); setShowNewTask(false); load()
    } catch (err) { alert(err.message) } finally { setSavingTask(false) }
  }

  if (loading || !item) return <Loader />

  const people = [...new Map(tasks.filter(t => t.assignee).map(t => [t.assignee.id, t.assignee])).values()]

  return (
    <div>
      <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 12 }}><ArrowLeft size={15} /> Back to Work Items</button>

      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span className="badge badge-purple">{types.find(t => t.key === item.work_type_key)?.name || item.work_type_key}</span>
            <StatusBadge status={item.status === 'open' ? 'active' : 'inactive'} />
          </div>
          <div className="page-title">{item.title}</div>
          <div className="page-subtitle">
            {item.client && <>Client: {item.client.name} · </>}
            {item.location && <>Location: {item.location.name}</>}
            {!item.client && !item.location && 'No client or location set'}
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => onEdit(item)}><Edit2 size={14} /> Edit</button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card" style={{ '--accent': '#6366f1' }}><div className="stat-value" style={{ color: '#6366f1' }}>{tasks.length}</div><div className="stat-label">Tasks</div></div>
        <div className="stat-card" style={{ '--accent': '#10b981' }}><div className="stat-value" style={{ color: '#10b981' }}>{hours.totalHours}h</div><div className="stat-label">Hours Logged</div></div>
        <div className="stat-card" style={{ '--accent': '#f59e0b' }}><div className="stat-value" style={{ color: '#f59e0b' }}>{people.length}</div><div className="stat-label">People Involved</div></div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}><ListChecks size={16} /> Tasks</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAiPanel(true)}><Sparkles size={13} /> AI-Assisted</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowNewTask(true)}><Plus size={13} /> New Task</button>
          </div>
        </div>
        {tasks.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>No tasks linked yet.</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tasks.map(t => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{t.task_name}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{t.assignee?.full_name || 'Unassigned'} {hours.byTaskHours[t.id] ? `· ${hours.byTaskHours[t.id]}h logged` : ''}</span>
                </div>
                <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: `${SC[t.status] || '#64748b'}18`, color: SC[t.status] || '#64748b' }}>{SL[t.status] || t.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {people.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><Users size={16} /> People</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {people.map(p => <span key={p.id} className="badge badge-purple">{p.full_name}</span>)}
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}><Box size={16} /> Equipment</div>
          <button className="btn btn-ghost btn-sm" disabled={!tasks.length} title={!tasks.length ? 'Add a task first' : ''} onClick={() => setShowAddEquip(true)}><Plus size={13} /> Link Asset</button>
        </div>
        {equipment.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>No equipment linked yet.</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {equipment.map(eq => (
              <div key={eq.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{eq.asset?.name} <span style={{ color: 'var(--ink-muted)', fontWeight: 400 }}>({eq.asset?.asset_code})</span></span>
                  <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Task: {eq.taskName}{eq.returned_at ? ' · Returned' : ''}</span>
                </div>
                {!eq.returned_at && <button className="btn btn-ghost btn-sm" onClick={() => handleReturnEquipment(eq.id)}>Mark Returned</button>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}><Package size={16} /> Materials</div>
          <button className="btn btn-ghost btn-sm" disabled={!tasks.length} title={!tasks.length ? 'Add a task first' : ''} onClick={() => setShowAddMaterial(true)}><Plus size={13} /> Link Material</button>
        </div>
        {materials.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>No materials linked yet.</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {materials.map(m => (
              <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{m.product?.name} <span style={{ color: 'var(--ink-muted)', fontWeight: 400 }}>({m.product?.part_number})</span></span>
                  <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Task: {m.taskName}{m.quantity_required ? ` · Qty needed: ${m.quantity_required}` : ''}{m.quantity_used ? ` · Used: ${m.quantity_used}` : ''}</span>
                </div>
                <button className="btn btn-ghost btn-sm btn-icon" onClick={() => handleUnlinkMaterial(m.id)}><X size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {hours.totalHours > 0 && (
        <div className="card" style={{ background: 'var(--surface-2)', fontSize: 12.5, color: 'var(--ink-soft)' }}>
          These {hours.totalHours}h are logged via each task's work sessions and already reflected in the team's timesheets — no separate submission needed here.
        </div>
      )}

      <Modal open={showAddEquip} onClose={() => setShowAddEquip(false)} title="Link Equipment"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowAddEquip(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleAddEquipment}>Link</button>
        </>}>
        {resourceErr && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{resourceErr}</div>}
        <form onSubmit={handleAddEquipment}>
          <div className="form-group"><label className="form-label">Task *</label>
            <select className="form-select" value={equipForm.taskId} onChange={e => setEquipForm(f => ({ ...f, taskId: e.target.value }))} required>
              <option value="">Select task</option>
              {tasks.map(t => <option key={t.id} value={t.id}>{t.task_name}</option>)}
            </select>
          </div>
          <div className="form-group"><label className="form-label">Asset *</label>
            <select className="form-select" value={equipForm.assetId} onChange={e => setEquipForm(f => ({ ...f, assetId: e.target.value }))} required>
              <option value="">Select asset</option>
              {assetOptions.map(a => <option key={a.id} value={a.id}>{a.name} ({a.asset_code})</option>)}
            </select>
          </div>
        </form>
      </Modal>

      <Modal open={showAddMaterial} onClose={() => setShowAddMaterial(false)} title="Link Material"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowAddMaterial(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleAddMaterial}>Link</button>
        </>}>
        {resourceErr && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{resourceErr}</div>}
        <form onSubmit={handleAddMaterial}>
          <div className="form-group"><label className="form-label">Task *</label>
            <select className="form-select" value={materialForm.taskId} onChange={e => setMaterialForm(f => ({ ...f, taskId: e.target.value }))} required>
              <option value="">Select task</option>
              {tasks.map(t => <option key={t.id} value={t.id}>{t.task_name}</option>)}
            </select>
          </div>
          <div className="form-group"><label className="form-label">Product / Component *</label>
            <select className="form-select" value={materialForm.productId} onChange={e => setMaterialForm(f => ({ ...f, productId: e.target.value }))} required>
              <option value="">Select product</option>
              {productOptions.map(p => <option key={p.id} value={p.id}>{p.name} ({p.part_number})</option>)}
            </select>
          </div>
          <div className="form-group"><label className="form-label">Quantity Required</label>
            <input className="form-input" type="number" value={materialForm.quantity} onChange={e => setMaterialForm(f => ({ ...f, quantity: e.target.value }))} placeholder="0" />
          </div>
        </form>
      </Modal>

      <Modal open={showNewTask} onClose={() => setShowNewTask(false)} title="New Task"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowNewTask(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleAddTask} disabled={savingTask}>{savingTask ? 'Saving...' : 'Create Task'}</button>
        </>}>
        <form onSubmit={handleAddTask}>
          <div className="form-group"><label className="form-label">Task Name *</label>
            <input className="form-input" value={taskName} onChange={e => setTaskName(e.target.value)} placeholder="e.g. Inspect unit 3" required autoFocus /></div>
          {templates.length > 0 && (
            <div className="form-group">
              <label className="form-label">Start from template (optional)</label>
              <select className="form-select" value={templateId} onChange={e => setTemplateId(e.target.value)}>
                <option value="">None</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}{(t.default_checklist || []).length ? ` (${t.default_checklist.length} checklist items)` : ''}</option>)}
              </select>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Assignee (optional)</label>
            <select className="form-select" value={taskAssignee} onChange={e => setTaskAssignee(e.target.value)}>
              <option value="">Unassigned</option>
              {suggestions.map(s => <option key={s.person.id} value={s.person.id}>{s.person.full_name}</option>)}
            </select>
            {suggestions.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Suggested</div>
                {suggestions.slice(0, 3).map(s => (
                  <button key={s.person.id} type="button" onClick={() => setTaskAssignee(s.person.id)}
                    className="btn btn-ghost btn-sm" style={{ justifyContent: 'space-between', textAlign: 'left', fontWeight: taskAssignee === s.person.id ? 700 : 500 }}>
                    <span>{s.person.full_name}</span>
                    <span style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 400 }}>{s.explanation}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </form>
      </Modal>

      <AIDockedPanel open={showAiPanel} onClose={() => setShowAiPanel(false)} title="AI Task Creation" subtitle={`For "${item.title}"`}>
        <TaskActionsTab profile={profile} onSaved={load} workItemId={id} workItemTitle={item.title} />
      </AIDockedPanel>
    </div>
  )
}
