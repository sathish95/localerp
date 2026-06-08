import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, rupee } from '../lib/supabase'
import { Modal, Loader, Empty } from '../components/ui'
import { Plus, Edit2, Trash2, AlertTriangle } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1]

const initForm = () => ({
  type: 'department',       // 'department' | 'project'
  department_id: '',
  project_id: '',
  category: '',
  fiscal_year: CURRENT_YEAR,
  month: '',                // blank = annual
  allocated: '',
})

export default function BudgetPage() {
  const { profile } = useAuth()
  const [budgets, setBudgets]   = useState([])
  const [depts, setDepts]       = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading]   = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing]   = useState(null)
  const [form, setForm]         = useState(initForm())
  const [submitting, setSub]    = useState(false)
  const [err, setErr]           = useState('')
  const [deleteConfirm, setDel] = useState(null)
  const [filterType, setFilterType] = useState('all')
  const [filterYear, setFilterYear] = useState(CURRENT_YEAR)

  const role     = profile?.role || 'employee'
  const canEdit  = ['admin', 'ceo', 'finance'].includes(role)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [b, d, p] = await Promise.all([
      supabase.from('budgets')
        .select('*, dept:departments(id,name,code), proj:projects(id,name,code)')
        .order('fiscal_year', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('departments').select('id, name, code').order('name'),
      supabase.from('projects').select('id, name, code').eq('status', 'active').order('name'),
    ])
    setBudgets(b.data || [])
    setDepts(d.data || [])
    setProjects(p.data || [])
    setLoading(false)
  }

  async function handleSubmit(e) {
    e.preventDefault(); setSub(true); setErr('')
    try {
      if (!form.allocated || parseFloat(form.allocated) <= 0) throw new Error('Allocated amount is required')
      if (form.type === 'department' && !form.department_id) throw new Error('Select a department')
      if (form.type === 'project' && !form.project_id) throw new Error('Select a project')

      const payload = {
        fiscal_year: parseInt(form.fiscal_year),
        month: form.month ? parseInt(form.month) : null,
        department_id: form.type === 'department' ? form.department_id : null,
        project_id: form.type === 'project' ? form.project_id : null,
        category: form.category || null,
        allocated: parseFloat(form.allocated),
        spent: editing?.spent || 0,
        created_by: profile.id,
      }

      if (editing) {
        const { error } = await supabase.from('budgets').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('budgets').insert(payload)
        if (error) throw error
      }
      setShowModal(false); setEditing(null); loadAll()
    } catch (e) { setErr(e.message) }
    finally { setSub(false) }
  }

  async function handleDelete(id) {
    await supabase.from('budgets').delete().eq('id', id)
    setDel(null); loadAll()
  }

  function openEdit(b) {
    setEditing(b)
    setForm({
      type: b.department_id ? 'department' : 'project',
      department_id: b.department_id || '',
      project_id: b.project_id || '',
      category: b.category || '',
      fiscal_year: b.fiscal_year || CURRENT_YEAR,
      month: b.month || '',
      allocated: b.allocated || '',
    })
    setErr(''); setShowModal(true)
  }

  const filtered = budgets.filter(b => {
    const mt = filterType === 'all' || (filterType === 'department' && b.department_id) || (filterType === 'project' && b.project_id)
    const my = b.fiscal_year === filterYear
    return mt && my
  })

  const totalAllocated = filtered.reduce((s, b) => s + (b.allocated || 0), 0)
  const totalSpent     = filtered.reduce((s, b) => s + (b.spent || 0), 0)
  const totalRemaining = totalAllocated - totalSpent

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  const chartData = filtered.slice(0, 10).map(b => ({
    name: (b.dept?.name || b.proj?.name || b.category || 'General')?.slice(0, 10),
    Allocated: b.allocated || 0,
    Spent: b.spent || 0,
    Remaining: Math.max(0, (b.allocated || 0) - (b.spent || 0)),
  }))

  const COLORS = ['#6366f1','#10b981','#f59e0b','#ec4899','#3b82f6','#8b5cf6','#ef4444','#14b8a6']

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Budget Management</div>
          <div className="page-subtitle">Set and track budgets by department or project</div>
        </div>
        {canEdit && (
          <button className="btn btn-primary" onClick={() => { setEditing(null); setForm(initForm()); setErr(''); setShowModal(true) }}>
            <Plus size={15} /> Set Budget
          </button>
        )}
      </div>

      {/* KPIs */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {[
          { label: 'Budget Lines', value: filtered.length, color: '#6366f1' },
          { label: 'Total Allocated', value: rupee(totalAllocated), color: '#3b82f6' },
          { label: 'Total Spent', value: rupee(totalSpent), color: '#f59e0b' },
          { label: 'Remaining', value: rupee(totalRemaining), color: totalRemaining >= 0 ? '#10b981' : '#ef4444' },
          { label: 'Utilization', value: totalAllocated > 0 ? `${Math.round((totalSpent/totalAllocated)*100)}%` : '0%', color: '#8b5cf6' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ borderTopColor: s.color }}>
            <div className="stat-value" style={{ fontSize: typeof s.value === 'string' && s.value.length > 7 ? 18 : 24, color: s.color }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {['all','department','project'].map(t => (
          <button key={t} onClick={() => setFilterType(t)} style={{ padding: '6px 16px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12, background: filterType === t ? '#6366f1' : '#f1f5f9', color: filterType === t ? '#fff' : '#475569', textTransform: 'capitalize' }}>{t === 'all' ? 'All Types' : t}</button>
        ))}
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          {YEARS.map(y => (
            <button key={y} onClick={() => setFilterYear(y)} style={{ padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12, background: filterYear === y ? '#1e293b' : '#f1f5f9', color: filterYear === y ? '#fff' : '#475569' }}>{y}</button>
          ))}
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e2e8f0', overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', fontWeight: 700, fontSize: 14 }}>Budget vs Actual — FY {filterYear}</div>
          <div style={{ padding: '16px 20px' }}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} barSize={18} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `₹${(v/100000).toFixed(0)}L`} axisLine={false} tickLine={false} />
                <Tooltip formatter={v => [rupee(v)]} contentStyle={{ borderRadius: 10, fontSize: 12, border: '1px solid #e2e8f0' }} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Allocated" fill="#6366f1" radius={[4,4,0,0]} />
                <Bar dataKey="Spent" fill="#f59e0b" radius={[4,4,0,0]} />
                <Bar dataKey="Remaining" fill="#10b981" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="table-wrap">
        <div className="table-toolbar">
          <span style={{ fontWeight: 700, fontSize: 14 }}>Budget Lines — FY {filterYear}</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{filtered.length} entries</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Type</th><th>Name</th><th>Category</th><th>Period</th>
              <th>Allocated</th><th>Spent</th><th>Remaining</th><th>Utilization</th>
              {canEdit && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0
              ? <tr><td colSpan={9}><Empty icon="💰" title="No budgets for this period" desc="Set a budget to get started" /></td></tr>
              : filtered.map((b, i) => {
                  const name  = b.dept?.name || b.proj?.name || b.category || 'General'
                  const type  = b.department_id ? 'Dept' : 'Project'
                  const rem   = (b.allocated || 0) - (b.spent || 0)
                  const pct   = b.allocated > 0 ? Math.round(((b.spent||0) / b.allocated) * 100) : 0
                  const over  = pct > 100
                  const c     = COLORS[i % COLORS.length]
                  const period = b.month ? `${MONTHS[b.month-1]} ${b.fiscal_year}` : `FY ${b.fiscal_year}`
                  return (
                    <tr key={b.id}>
                      <td>
                        <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: b.department_id ? '#dbeafe' : '#ede9fe', color: b.department_id ? '#1d4ed8' : '#6d28d9' }}>{type}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 }} />
                          <span className="td-bold">{name}</span>
                        </div>
                        {(b.dept?.code || b.proj?.code) && <div style={{ fontSize: 10, color: '#94a3b8', marginLeft: 16 }}>{b.dept?.code || b.proj?.code}</div>}
                      </td>
                      <td style={{ fontSize: 12, color: '#64748b' }}>{b.category || '—'}</td>
                      <td style={{ fontSize: 12 }}>{period}</td>
                      <td style={{ fontWeight: 700 }}>{rupee(b.allocated)}</td>
                      <td style={{ fontWeight: 600, color: '#f59e0b' }}>{rupee(b.spent || 0)}</td>
                      <td style={{ fontWeight: 700, color: rem < 0 ? '#ef4444' : '#10b981' }}>
                        {rem < 0 && <AlertTriangle size={12} style={{ verticalAlign: 'middle', marginRight: 3 }} />}
                        {rupee(rem)}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 110 }}>
                          <div style={{ flex: 1, height: 6, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: over ? '#ef4444' : pct > 75 ? '#f59e0b' : c, borderRadius: 99, transition: 'width .3s' }} />
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: over ? '#ef4444' : '#475569', minWidth: 32 }}>{pct}%</span>
                        </div>
                      </td>
                      {canEdit && (
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openEdit(b)}><Edit2 size={12} /></button>
                            <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => setDel(b.id)}><Trash2 size={12} /></button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })
            }
          </tbody>
        </table>
      </div>

      {/* Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Budget' : 'Set New Budget'} size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>{submitting ? 'Saving…' : editing ? 'Update Budget' : 'Save Budget'}</button>
        </>}>
        {err && <div className="alert alert-danger" style={{ marginBottom: 14 }}>{err}</div>}

        {/* Type toggle */}
        <div className="form-group">
          <label className="form-label">Budget For</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {['department','project'].map(t => (
              <button key={t} type="button" onClick={() => setForm(f => ({ ...f, type: t, department_id: '', project_id: '' }))}
                style={{ flex: 1, padding: '10px', borderRadius: 10, border: `2px solid ${form.type === t ? '#6366f1' : '#e2e8f0'}`, background: form.type === t ? '#ede9fe' : '#fff', color: form.type === t ? '#6366f1' : '#475569', fontWeight: 700, fontSize: 13, cursor: 'pointer', textTransform: 'capitalize' }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Department or Project selector */}
        {form.type === 'department' ? (
          <div className="form-group">
            <label className="form-label">Department *</label>
            <select className="form-select" value={form.department_id} onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))} required>
              <option value="">Select department…</option>
              {depts.map(d => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
            </select>
            {depts.length === 0 && <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>No departments found. Add departments first.</div>}
          </div>
        ) : (
          <div className="form-group">
            <label className="form-label">Project *</label>
            <select className="form-select" value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))} required>
              <option value="">Select project…</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
            </select>
            {projects.length === 0 && <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>No active projects found.</div>}
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Category / Label</label>
          <input className="form-input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="e.g. Software, Travel, Payroll (optional)" />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Fiscal Year *</label>
            <select className="form-select" value={form.fiscal_year} onChange={e => setForm(f => ({ ...f, fiscal_year: parseInt(e.target.value) }))}>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Month (blank = annual)</label>
            <select className="form-select" value={form.month} onChange={e => setForm(f => ({ ...f, month: e.target.value }))}>
              <option value="">Annual Budget</option>
              {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
                <option key={i+1} value={i+1}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Allocated Amount (₹) *</label>
          <input className="form-input" type="number" step="1000" value={form.allocated} onChange={e => setForm(f => ({ ...f, allocated: e.target.value }))} placeholder="e.g. 500000" required />
        </div>

        {form.allocated > 0 && (
          <div style={{ padding: '10px 14px', borderRadius: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: 12 }}>
            <span style={{ color: '#15803d', fontWeight: 600 }}>Monthly equivalent: {rupee(parseFloat(form.allocated) / 12)}/mo</span>
          </div>
        )}
      </Modal>

      {/* Delete confirm */}
      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 600, padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, maxWidth: 380, width: '100%' }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Delete Budget?</div>
            <div style={{ color: '#64748b', fontSize: 14, marginBottom: 24 }}>This cannot be undone.</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setDel(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => handleDelete(deleteConfirm)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
