import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import { rupee, rupeeFull, dateFmt } from '../lib/supabase'
import {
  ACTIVITY_TYPES, ACTIVITY_STATUSES, RESOURCE_TYPES, COST_CATEGORIES, TYPE_COLORS,
  workingDays, resourceCost, activityTotals, listActivities, saveActivity, deleteActivity,
  loadPlannerLookups, findConflicts,
} from '../lib/activityPlanner'
import { Loader, Modal, StatCard, Confirm, Empty, StatusBadge, Tabs } from '../components/ui'
import { ChevronLeft, ChevronRight, Plus, CalendarDays, Users, Clock, IndianRupee, AlertTriangle, Download, Printer, Trash2, Pencil, MapPin } from 'lucide-react'

const MANAGER_ROLES = ['admin', 'ceo', 'manager', 'department_head', 'cto', 'project_manager']
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monthStart = d => new Date(d.getFullYear(), d.getMonth(), 1)
const monthEnd = d => new Date(d.getFullYear(), d.getMonth() + 1, 0)

const blankActivity = date => ({
  title: '', activity_type: 'Installation', project_id: '', customer_id: '', location: '',
  start_date: date, end_date: date, days_required: workingDays(date, date), status: 'planned', owner_id: '', notes: '',
})
const blankResource = () => ({ resource_type: 'person', person_id: '', name: '', role: '', quantity: 1, days: 1, rate_per_day: 0 })
const blankCost = () => ({ category: 'Travel', description: '', amount: 0 })

export default function ActivityPlannerPage() {
  const { profile } = useAuth()
  const [month, setMonth] = useState(() => monthStart(new Date()))
  const [view, setView] = useState('calendar')
  const [activities, setActivities] = useState([])
  const [lookups, setLookups] = useState({ people: [], projects: [], customers: [] })
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [detail, setDetail] = useState(null)
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')

  const from = iso(monthStart(month))
  const to = iso(monthEnd(month))

  useEffect(() => { loadPlannerLookups().then(setLookups) }, [])
  useEffect(() => { load() }, [from])

  async function load() {
    setLoading(true); setError('')
    try { setActivities(await listActivities({ from, to })) } catch (e) { setError(e.message) }
    setLoading(false)
  }

  const canEdit = a => !a?.id || MANAGER_ROLES.includes(profile?.role) || a.created_by === profile?.id || a.owner_id === profile?.id
  const nameOf = (list, id) => list.find(x => x.id === id)?.name || list.find(x => x.id === id)?.full_name || ''

  const shown = useMemo(() => activities.filter(a =>
    (!typeFilter || a.activity_type === typeFilter) && (!statusFilter || a.status === statusFilter)
  ), [activities, typeFilter, statusFilter])
  const conflicts = useMemo(() => findConflicts(activities), [activities])

  const totals = useMemo(() => {
    const live = shown.filter(a => a.status !== 'cancelled')
    const people = new Set()
    let cost = 0, days = 0
    for (const a of live) {
      const t = activityTotals(a)
      cost += t.total; days += Number(a.days_required || 0)
      a.resources.filter(r => r.resource_type === 'person').forEach(r => people.add(r.person_id || r.name))
    }
    return { count: live.length, cost, days, people: people.size }
  }, [shown])

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Activity Planner</div>
          <div className="page-subtitle">Installations and field activities — resources, cost and days required</div>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing(blankActivity(iso(new Date())))}><Plus size={14} /> New Activity</button>
      </div>

      <div className="stats-grid">
        <StatCard label="Activities this month" value={totals.count} icon={<CalendarDays size={16} />} />
        <StatCard label="Days required" value={totals.days} icon={<Clock size={16} />} accent="#0891b2" />
        <StatCard label="People involved" value={totals.people} icon={<Users size={16} />} accent="#059669" />
        <StatCard label="Planned cost" value={rupee(totals.cost)} icon={<IndianRupee size={16} />} accent="#d97706" />
      </div>

      <div className="card" style={{ padding: 12, marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={14} /></button>
        <div style={{ fontWeight: 700, minWidth: 140, textAlign: 'center' }}>{month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</div>
        <button className="btn btn-ghost btn-sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={14} /></button>
        <button className="btn btn-ghost btn-sm" onClick={() => setMonth(monthStart(new Date()))}>Today</button>
        <div style={{ flex: 1 }} />
        <select className="form-select" style={{ fontSize: 12, width: 160 }} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All types</option>{ACTIVITY_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
        <select className="form-select" style={{ fontSize: 12, width: 150 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>{ACTIVITY_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      <Tabs tabs={[{ id: 'calendar', label: 'Calendar' }, { id: 'summary', label: 'Management Summary', count: shown.length }]} active={view} onChange={setView} />

      {error && <div className="card" style={{ padding: 12, marginBottom: 12, color: '#dc2626', fontSize: 13 }}>{error}</div>}

      {loading ? <Loader /> : view === 'calendar' ? (
        <CalendarGrid month={month} activities={shown} conflicts={conflicts} onOpen={setDetail} onNew={d => setEditing(blankActivity(d))} />
      ) : (
        <SummaryView month={month} activities={shown} conflicts={conflicts} lookups={lookups} nameOf={nameOf} onOpen={setDetail} />
      )}

      {detail && (
        <DetailModal activity={detail} conflicts={conflicts.get(detail.id) || []} lookups={lookups} nameOf={nameOf}
          canEdit={canEdit(detail)} onClose={() => setDetail(null)}
          onEdit={() => { setEditing(detail); setDetail(null) }}
          onDeleted={() => { setDetail(null); load() }} />
      )}
      {editing && (
        <EditorModal initial={editing} lookups={lookups} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }} />
      )}
    </div>
  )
}

function CalendarGrid({ month, activities, conflicts, onOpen, onNew }) {
  const first = monthStart(month)
  const lead = (first.getDay() + 6) % 7 // Monday-first
  const daysInMonth = monthEnd(month).getDate()
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))]
  while (cells.length % 7) cells.push(null)
  const today = iso(new Date())

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: '1px solid var(--border)' }}>
        {WEEKDAYS.map(d => <div key={d} style={{ padding: '8px 10px', fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase' }}>{d}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
        {cells.map((d, i) => {
          if (!d) return <div key={i} style={{ minHeight: 110, borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }} />
          const key = iso(d)
          const dayActs = activities.filter(a => a.start_date <= key && a.end_date >= key)
          return (
            <div key={i} onClick={() => onNew(key)} style={{ minHeight: 110, padding: 6, borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: d.getDay() === 0 ? 'var(--surface)' : undefined }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, color: key === today ? 'var(--c1)' : 'var(--ink-muted)' }}>{d.getDate()}</div>
              {dayActs.slice(0, 3).map(a => {
                const color = TYPE_COLORS[a.activity_type] || TYPE_COLORS.Other
                return (
                  <div key={a.id} onClick={e => { e.stopPropagation(); onOpen(a) }} title={`${a.title} · ${a.activity_type}`}
                    style={{ fontSize: 11, padding: '2px 6px', marginBottom: 3, borderRadius: 5, background: `${color}18`, color, borderLeft: `3px solid ${color}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600, opacity: a.status === 'cancelled' ? 0.45 : 1, textDecoration: a.status === 'cancelled' ? 'line-through' : 'none' }}>
                    {conflicts.has(a.id) && <AlertTriangle size={10} style={{ marginRight: 3, verticalAlign: -1 }} />}{a.title}
                  </div>
                )
              })}
              {dayActs.length > 3 && <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>+{dayActs.length - 3} more</div>}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', padding: '10px 12px', fontSize: 11.5, color: 'var(--ink-muted)' }}>
        {ACTIVITY_TYPES.map(t => <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: TYPE_COLORS[t] }} />{t}</span>)}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><AlertTriangle size={11} /> Person double-booked</span>
      </div>
    </div>
  )
}

function SummaryView({ month, activities, conflicts, lookups, nameOf, onOpen }) {
  const rows = activities.map(a => ({ a, t: activityTotals(a) }))
  const live = rows.filter(r => r.a.status !== 'cancelled')
  const sum = k => live.reduce((s, r) => s + r.t[k], 0)
  const byType = ACTIVITY_TYPES.map(type => {
    const items = live.filter(r => r.a.activity_type === type)
    return { type, count: items.length, days: items.reduce((s, r) => s + Number(r.a.days_required || 0), 0), cost: items.reduce((s, r) => s + r.t.total, 0) }
  }).filter(x => x.count)

  function exportCsv() {
    const head = ['Activity', 'Type', 'Status', 'Customer', 'Project', 'Location', 'Start', 'End', 'Days Required', 'People', 'Man-days', 'Resources', 'Resource Cost', 'Other Cost', 'Total Cost']
    const lines = rows.map(({ a, t }) => [
      a.title, a.activity_type, a.status, nameOf(lookups.customers, a.customer_id), nameOf(lookups.projects, a.project_id), a.location || '',
      a.start_date, a.end_date, a.days_required, t.people, t.manDays,
      a.resources.map(r => `${r.name}${r.role ? ` (${r.role})` : ''}`).join('; '),
      t.resourceTotal.toFixed(2), t.otherTotal.toFixed(2), t.total.toFixed(2),
    ])
    const csv = [head, ...lines].map(l => l.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    Object.assign(document.createElement('a'), { href: url, download: `activity-plan-${iso(month).slice(0, 7)}.csv` }).click()
    URL.revokeObjectURL(url)
  }

  if (!rows.length) return <div className="card" style={{ padding: '20px 24px' }}><Empty icon="📅" title="No activities this month" desc="Plan an installation or field activity to see its resources and cost here" /></div>

  return (
    <div>
      {byType.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10, marginBottom: 14 }}>
          {byType.map(x => (
            <div key={x.type} className="card" style={{ padding: 12, borderLeft: `3px solid ${TYPE_COLORS[x.type]}` }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{x.type}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 2 }}>{x.count} activit{x.count === 1 ? 'y' : 'ies'} · {x.days} days</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>{rupee(x.cost)}</div>
            </div>
          ))}
        </div>
      )}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: 10 }} className="no-print">
          <button className="btn btn-ghost btn-sm" onClick={exportCsv}><Download size={13} /> Export CSV</button>
          <button className="btn btn-ghost btn-sm" onClick={() => window.print()}><Printer size={13} /> Print</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ display: 'table', fontSize: 12.5 }}>
            <thead>
              <tr><th>Activity</th><th>Dates</th><th style={{ textAlign: 'right' }}>Days</th><th>Resources</th><th style={{ textAlign: 'right' }}>Resource cost</th><th style={{ textAlign: 'right' }}>Other cost</th><th style={{ textAlign: 'right' }}>Total</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map(({ a, t }) => (
                <tr key={a.id} onClick={() => onOpen(a)} style={{ cursor: 'pointer', opacity: a.status === 'cancelled' ? 0.5 : 1 }}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{conflicts.has(a.id) && <AlertTriangle size={12} color="#d97706" style={{ marginRight: 4, verticalAlign: -1 }} />}{a.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                      <span style={{ color: TYPE_COLORS[a.activity_type] }}>{a.activity_type}</span>
                      {[nameOf(lookups.customers, a.customer_id), a.location].filter(Boolean).map(s => ` · ${s}`).join('')}
                    </div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{dateFmt(a.start_date)}{a.end_date !== a.start_date && <> – {dateFmt(a.end_date)}</>}</td>
                  <td style={{ textAlign: 'right' }}>{a.days_required}</td>
                  <td style={{ maxWidth: 240 }}>
                    <div>{t.people} people · {t.manDays} man-days</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.resources.map(r => r.name).join(', ') || '—'}</div>
                  </td>
                  <td style={{ textAlign: 'right' }}>{rupee(t.resourceTotal)}</td>
                  <td style={{ textAlign: 'right' }}>{rupee(t.otherTotal)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{rupee(t.total)}</td>
                  <td><StatusBadge status={a.status} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td style={{ padding: '10px 14px' }}>Total ({live.length} active)</td><td />
                <td style={{ textAlign: 'right', padding: '10px 14px' }}>{live.reduce((s, r) => s + Number(r.a.days_required || 0), 0)}</td>
                <td style={{ padding: '10px 14px' }}>{sum('manDays')} man-days</td>
                <td style={{ textAlign: 'right', padding: '10px 14px' }}>{rupee(sum('resourceTotal'))}</td>
                <td style={{ textAlign: 'right', padding: '10px 14px' }}>{rupee(sum('otherTotal'))}</td>
                <td style={{ textAlign: 'right', padding: '10px 14px' }}>{rupee(sum('total'))}</td><td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}

function DetailModal({ activity: a, conflicts, lookups, nameOf, canEdit, onClose, onEdit, onDeleted }) {
  const [confirm, setConfirm] = useState(false)
  const [err, setErr] = useState('')
  const t = activityTotals(a)
  const color = TYPE_COLORS[a.activity_type] || TYPE_COLORS.Other

  async function remove() {
    try { await deleteActivity(a.id); onDeleted() } catch (e) { setErr(e.message); setConfirm(false) }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={a.title}
      footer={canEdit && <>
        <button className="btn btn-ghost" style={{ marginRight: 'auto' }} onClick={() => setConfirm(true)}><Trash2 size={13} /> Delete</button>
        <button className="btn btn-primary" onClick={onEdit}><Pencil size={13} /> Edit</button>
      </>}>
      {err && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 10 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14, fontSize: 13 }}>
        <span style={{ padding: '2px 8px', borderRadius: 6, background: `${color}18`, color, fontWeight: 700, fontSize: 12 }}>{a.activity_type}</span>
        <StatusBadge status={a.status} />
        <span>{dateFmt(a.start_date)}{a.end_date !== a.start_date && <> – {dateFmt(a.end_date)}</>}</span>
        <span style={{ color: 'var(--ink-muted)' }}>· {a.days_required} days required</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, fontSize: 13, marginBottom: 14 }}>
        {nameOf(lookups.customers, a.customer_id) && <div><span style={{ color: 'var(--ink-muted)' }}>Customer:</span> {nameOf(lookups.customers, a.customer_id)}</div>}
        {nameOf(lookups.projects, a.project_id) && <div><span style={{ color: 'var(--ink-muted)' }}>Project:</span> {nameOf(lookups.projects, a.project_id)}</div>}
        {a.location && <div><MapPin size={12} style={{ verticalAlign: -1 }} /> {a.location}</div>}
        {nameOf(lookups.people, a.owner_id) && <div><span style={{ color: 'var(--ink-muted)' }}>Lead:</span> {nameOf(lookups.people, a.owner_id)}</div>}
      </div>
      {conflicts.length > 0 && (
        <div style={{ padding: 10, borderRadius: 8, background: '#fef3c7', color: '#92400e', fontSize: 12.5, marginBottom: 14 }}>
          <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
          Double-booked: {conflicts.map(c => `${c.name} (also on "${c.otherTitle}")`).join(', ')}
        </div>
      )}
      <div className="form-label">Resources involved</div>
      <table className="data-table" style={{ display: 'table', fontSize: 12.5, marginBottom: 14 }}>
        <thead><tr><th>Resource</th><th>Type</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Days</th><th style={{ textAlign: 'right' }}>Rate/day</th><th style={{ textAlign: 'right' }}>Cost</th></tr></thead>
        <tbody>
          {a.resources.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--ink-muted)' }}>No resources added</td></tr>}
          {a.resources.map(r => (
            <tr key={r.id}>
              <td><div style={{ fontWeight: 600 }}>{r.name}</div>{r.role && <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{r.role}</div>}</td>
              <td style={{ textTransform: 'capitalize' }}>{r.resource_type}</td>
              <td style={{ textAlign: 'right' }}>{r.quantity}</td>
              <td style={{ textAlign: 'right' }}>{r.days}</td>
              <td style={{ textAlign: 'right' }}>{rupee(r.rate_per_day)}</td>
              <td style={{ textAlign: 'right' }}>{rupee(resourceCost(r))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form-label">Other costs</div>
      <table className="data-table" style={{ display: 'table', fontSize: 12.5, marginBottom: 14 }}>
        <tbody>
          {a.costs.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--ink-muted)' }}>No other costs</td></tr>}
          {a.costs.map(c => <tr key={c.id}><td style={{ fontWeight: 600 }}>{c.category}</td><td>{c.description}</td><td style={{ textAlign: 'right' }}>{rupee(c.amount)}</td></tr>)}
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 18, fontSize: 13 }}>
        <span>Resources: <b>{rupeeFull(t.resourceTotal)}</b></span>
        <span>Other: <b>{rupeeFull(t.otherTotal)}</b></span>
        <span>Total: <b style={{ color: 'var(--c1)' }}>{rupeeFull(t.total)}</b></span>
      </div>
      {a.notes && <div style={{ marginTop: 14, fontSize: 13, whiteSpace: 'pre-wrap', color: 'var(--ink-soft)' }}>{a.notes}</div>}
      <Confirm open={confirm} danger message={`Delete "${a.title}"? This cannot be undone.`} onConfirm={remove} onCancel={() => setConfirm(false)} />
    </Modal>
  )
}

function EditorModal({ initial, lookups, onClose, onSaved }) {
  const [form, setForm] = useState({ ...blankActivity(initial.start_date), ...initial, project_id: initial.project_id || '', customer_id: initial.customer_id || '', owner_id: initial.owner_id || '' })
  const [resources, setResources] = useState(initial.resources?.length ? initial.resources.map(r => ({ ...r, person_id: r.person_id || '' })) : [blankResource()])
  const [costs, setCosts] = useState(initial.costs?.length ? initial.costs : [])
  const [daysTouched, setDaysTouched] = useState(!!initial.id)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(f => {
    const next = { ...f, [k]: v }
    if (k === 'start_date' && next.end_date < v) next.end_date = v
    if ((k === 'start_date' || k === 'end_date') && !daysTouched) next.days_required = workingDays(next.start_date, next.end_date)
    return next
  })
  const setRes = (i, patch) => setResources(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r))
  const pickPerson = (i, id) => {
    const p = lookups.people.find(x => x.id === id)
    setRes(i, p ? { person_id: id, name: p.full_name, role: p.designation || '', rate_per_day: p.day_rate } : { person_id: '', name: '' })
  }
  const setCost = (i, patch) => setCosts(cs => cs.map((c, j) => j === i ? { ...c, ...patch } : c))
  const t = activityTotals({ resources, costs })

  async function save() {
    if (!form.title.trim()) return setErr('Title is required')
    if (form.end_date < form.start_date) return setErr('End date must be on or after the start date')
    setSaving(true); setErr('')
    try { await saveActivity(form, resources, costs); onSaved() } catch (e) { setErr(e.message); setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={initial.id ? 'Edit Activity' : 'New Activity'}
      footer={<>
        <div style={{ marginRight: 'auto', fontSize: 13 }}>Total cost: <b>{rupeeFull(t.total)}</b></div>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
      </>}>
      {err && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 10 }}>{err}</div>}
      <div className="form-group">
        <label className="form-label">Activity *</label>
        <input className="form-input" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Sensor installation — Plant 2" />
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Type</label>
          <select className="form-select" value={form.activity_type} onChange={e => set('activity_type', e.target.value)}>{ACTIVITY_TYPES.map(x => <option key={x}>{x}</option>)}</select></div>
        <div className="form-group"><label className="form-label">Status</label>
          <select className="form-select" value={form.status} onChange={e => set('status', e.target.value)}>{ACTIVITY_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></div>
      </div>
      <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <div className="form-group"><label className="form-label">Start date</label>
          <input type="date" className="form-input" value={form.start_date} onChange={e => set('start_date', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">End date</label>
          <input type="date" className="form-input" value={form.end_date} min={form.start_date} onChange={e => set('end_date', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Days required</label>
          <input type="number" min="0" step="0.5" className="form-input" value={form.days_required}
            onChange={e => { setDaysTouched(true); set('days_required', e.target.value) }} />
          <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 3 }}>{workingDays(form.start_date, form.end_date)} working days in range (excl. Sundays)</div></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Customer</label>
          <select className="form-select" value={form.customer_id} onChange={e => set('customer_id', e.target.value)}>
            <option value="">—</option>{lookups.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="form-group"><label className="form-label">Project</label>
          <select className="form-select" value={form.project_id} onChange={e => set('project_id', e.target.value)}>
            <option value="">—</option>{lookups.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Location / site</label>
          <input className="form-input" value={form.location || ''} onChange={e => set('location', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Activity lead</label>
          <select className="form-select" value={form.owner_id} onChange={e => set('owner_id', e.target.value)}>
            <option value="">—</option>{lookups.people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
      </div>

      <div className="form-label" style={{ marginTop: 6 }}>Resources involved</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table" style={{ display: 'table', fontSize: 12.5 }}>
          <thead><tr><th>Type</th><th>Resource</th><th>Role</th><th>Qty</th><th>Days</th><th>Rate/day (₹)</th><th style={{ textAlign: 'right' }}>Cost</th><th /></tr></thead>
          <tbody>
            {resources.map((r, i) => (
              <tr key={i}>
                <td style={{ padding: 4 }}><select className="form-select" style={{ fontSize: 12, minWidth: 110 }} value={r.resource_type} onChange={e => setRes(i, { resource_type: e.target.value, person_id: '' })}>
                  {RESOURCE_TYPES.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}</select></td>
                <td style={{ padding: 4, minWidth: 170 }}>
                  {r.resource_type === 'person'
                    ? <select className="form-select" style={{ fontSize: 12 }} value={r.person_id} onChange={e => pickPerson(i, e.target.value)}>
                        <option value="">Select person…</option>{lookups.people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
                    : <input className="form-input" style={{ fontSize: 12 }} value={r.name} placeholder="Name" onChange={e => setRes(i, { name: e.target.value })} />}
                </td>
                <td style={{ padding: 4 }}><input className="form-input" style={{ fontSize: 12, minWidth: 90 }} value={r.role || ''} onChange={e => setRes(i, { role: e.target.value })} /></td>
                <td style={{ padding: 4 }}><input type="number" min="0" className="form-input" style={{ fontSize: 12, width: 60 }} value={r.quantity} onChange={e => setRes(i, { quantity: e.target.value })} /></td>
                <td style={{ padding: 4 }}><input type="number" min="0" step="0.5" className="form-input" style={{ fontSize: 12, width: 66 }} value={r.days} onChange={e => setRes(i, { days: e.target.value })} /></td>
                <td style={{ padding: 4 }}><input type="number" min="0" className="form-input" style={{ fontSize: 12, width: 96 }} value={r.rate_per_day} onChange={e => setRes(i, { rate_per_day: e.target.value })} /></td>
                <td style={{ padding: 4, textAlign: 'right', whiteSpace: 'nowrap' }}>{rupee(resourceCost(r))}</td>
                <td style={{ padding: 4 }}><button className="btn btn-ghost btn-sm" onClick={() => setResources(rs => rs.filter((_, j) => j !== i))}><Trash2 size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 8, margin: '8px 0 16px' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setResources(rs => [...rs, { ...blankResource(), days: form.days_required || 1 }])}><Plus size={12} /> Add resource</button>
        <span style={{ fontSize: 11.5, color: 'var(--ink-muted)', alignSelf: 'center' }}>Person rates default from Role Rates (hourly × 8) — adjust as needed.</span>
      </div>

      <div className="form-label">Other costs</div>
      {costs.map((c, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <select className="form-select" style={{ fontSize: 12, width: 160 }} value={c.category} onChange={e => setCost(i, { category: e.target.value })}>{COST_CATEGORIES.map(x => <option key={x}>{x}</option>)}</select>
          <input className="form-input" style={{ fontSize: 12, flex: 1 }} placeholder="Description" value={c.description || ''} onChange={e => setCost(i, { description: e.target.value })} />
          <input type="number" min="0" className="form-input" style={{ fontSize: 12, width: 120 }} placeholder="Amount ₹" value={c.amount} onChange={e => setCost(i, { amount: e.target.value })} />
          <button className="btn btn-ghost btn-sm" onClick={() => setCosts(cs => cs.filter((_, j) => j !== i))}><Trash2 size={12} /></button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" style={{ marginBottom: 16 }} onClick={() => setCosts(cs => [...cs, blankCost()])}><Plus size={12} /> Add cost</button>

      <div className="form-group"><label className="form-label">Notes</label>
        <textarea className="form-textarea" value={form.notes || ''} onChange={e => set('notes', e.target.value)} /></div>
    </Modal>
  )
}
