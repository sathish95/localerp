import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase, dateFmt, rupee } from '../lib/supabase'
import { createDeviceWarranty, computeDeviceAgeMonths, computeWarrantyWindow } from '../lib/warranty'
import { Modal, SearchBox, Loader, Empty, Confirm } from '../components/ui'
import { Plus, Edit2, Trash2, ArrowRightLeft, History, Clock, ShieldCheck } from 'lucide-react'

const STATUSES = ['deployed', 'in_storage', 'faulty', 'replaced', 'decommissioned']
const SL = { deployed: 'Deployed', in_storage: 'In Storage', faulty: 'Faulty', replaced: 'Replaced', decommissioned: 'Decommissioned' }
const SC = { deployed: '#10b981', in_storage: '#3b82f6', faulty: '#e11d48', replaced: '#f59e0b', decommissioned: '#94a3b8' }
const Pill = ({ status }) => <span style={{ padding: '2px 9px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: `${SC[status]}18`, color: SC[status], border: `1px solid ${SC[status]}30`, whiteSpace: 'nowrap' }}>{SL[status] || status}</span>

const initForm = () => ({
  part_number: '', serial_number: '', customer_id: '', project_id: '', status: 'in_storage',
  installed_date: '', warranty_start: '', warranty_end: '', warranty_policy_id: '', current_location: '', assigned_to: '', notes: '',
})

const isWarrantyNear = d => {
  if (!d) return false
  const days = (new Date(d) - new Date()) / 86400000
  return days >= 0 && days <= 30
}

// Mirrors src/lib/warranty.js's getClaimPercentageForAge, but takes an
// already-loaded tiers array instead of making a DB round-trip per row —
// this page needs the age-adjusted claim % for every device in the table
// at once, not one at a time.
function claimPctFromTiers(tiers, ageMonths) {
  if (!tiers?.length) return 100
  const match = tiers.find(t => ageMonths >= Number(t.min_age_months) && (t.max_age_months == null || ageMonths < Number(t.max_age_months)))
  return match ? Number(match.claim_percentage) : 0
}

export default function DevicesPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [devices, setDevices] = useState([])
  const [products, setProducts] = useState([])
  const [customers, setCustomers] = useState([])
  const [projects, setProjects] = useState([])
  const [users, setUsers] = useState([])
  const [policies, setPolicies] = useState([])
  const [depreciationTiers, setDepreciationTiers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(initForm())
  const [showMove, setShowMove] = useState(null)
  const [moveForm, setMoveForm] = useState({ to_project_id: '', to_customer_id: '', to_status: 'deployed', warranty_policy_id: '', reason: '' })
  const [showHistory, setShowHistory] = useState(null)
  const [history, setHistory] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [err, setErr] = useState('')

  const role = profile?.role || 'employee'
  const canEdit = ['admin', 'ceo', 'manager', 'department_head', 'procurement_lead', 'pm'].includes(role)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    // device_instances.part_number/customer_id/project_id are all soft refs
    // (no REFERENCES constraint, per STEP25's design) — PostgREST embedding
    // (`product:products(...)`) can't resolve those, so devices are fetched
    // plain and joined to products/customers/projects client-side below via
    // productByPart/customerById/projectById.
    const [dR, pR, cR, prR, uR, polR, tierR] = await Promise.all([
      supabase.from('device_instances').select('*').order('created_at', { ascending: false }),
      supabase.from('products').select('part_number,name,standard_cost,warranty_months').eq('is_serialized', true).eq('status', 'active').order('name'),
      supabase.from('customers').select('id,name').order('name'),
      supabase.from('projects').select('id,name,code').order('name'),
      supabase.from('profiles').select('id,full_name').order('full_name'),
      supabase.from('warranty_policies').select('*').eq('is_active', true),
      supabase.from('warranty_depreciation_tiers').select('*'),
    ])
    setDevices(dR.data || []); setProducts(pR.data || []); setCustomers(cR.data || [])
    setProjects(prR.data || []); setUsers(uR.data || [])
    setPolicies(polR.data || []); setDepreciationTiers(tierR.data || [])
    setLoading(false)
  }

  // Product register applying its Warranty Policy: for each device, resolve
  // the policy for its part_number, compute the device's age from its
  // warranty start date, and price the claim value as standard_cost x the
  // policy's age-based depreciation % (100% if no policy/tiers configured).
  const policyByPart = useMemo(() => Object.fromEntries(policies.map(p => [p.part_number, p])), [policies])
  const productByPart = useMemo(() => Object.fromEntries(products.map(p => [p.part_number, p])), [products])
  const customerById = useMemo(() => Object.fromEntries(customers.map(c => [c.id, c])), [customers])
  const projectById = useMemo(() => Object.fromEntries(projects.map(p => [p.id, p])), [projects])
  const tiersByPolicy = useMemo(() => {
    const m = {}
    depreciationTiers.forEach(t => { (m[t.warranty_policy_id] ||= []).push(t) })
    return m
  }, [depreciationTiers])

  function ageAndClaimFor(d) {
    if (!d.warranty_start) return { ageMonths: null, claimPct: null, claimValue: null }
    const ageMonths = computeDeviceAgeMonths(d.warranty_start)
    const policy = policyByPart[d.part_number]
    const standardCost = Number(productByPart[d.part_number]?.standard_cost || 0)
    const tiers = policy ? tiersByPolicy[policy.id] : null
    const claimPct = claimPctFromTiers(tiers, ageMonths)
    return { ageMonths, claimPct, claimValue: Math.round(standardCost * (claimPct / 100) * 100) / 100 }
  }

  const policyById = useMemo(() => Object.fromEntries(policies.map(p => [p.id, p])), [policies])
  function durationForPolicy(policyId, partNumber) {
    return policyById[policyId]?.warranty_duration_months || productByPart[partNumber]?.warranty_months || 12
  }

  // Installation date -> automatic warranty window: whenever the install
  // date (or the selected product/policy) changes, recompute Warranty
  // Start/End from installed_date + the policy's duration (default 12mo)
  // so a new device always gets a warranty period without extra steps.
  function applyInstallDate(f, installedDate) {
    if (!installedDate) return { ...f, installed_date: installedDate }
    const { warrantyStart, warrantyEnd } = computeWarrantyWindow(installedDate, durationForPolicy(f.warranty_policy_id, f.part_number))
    return { ...f, installed_date: installedDate, warranty_start: warrantyStart, warranty_end: warrantyEnd }
  }
  function applyPartNumber(f, partNumber) {
    const policyId = policyByPart[partNumber]?.id || ''
    const next = { ...f, part_number: partNumber, warranty_policy_id: policyId }
    return f.installed_date ? applyInstallDate(next, f.installed_date) : next
  }
  function applyPolicy(f, policyId) {
    const next = { ...f, warranty_policy_id: policyId }
    return f.installed_date ? applyInstallDate(next, f.installed_date) : next
  }

  function openCreate() { setEditing(null); setForm(initForm()); setErr(''); setShowModal(true) }
  function openEdit(d) { setEditing(d); setForm({ ...initForm(), ...d, warranty_policy_id: policyByPart[d.part_number]?.id || '' }); setErr(''); setShowModal(true) }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true); setErr('')
    try {
      const { part_number, serial_number, customer_id, project_id, status, installed_date, warranty_start, warranty_end, warranty_policy_id, current_location, assigned_to, notes } = form
      const payload = {
        part_number: part_number || null, serial_number, customer_id: customer_id || null, project_id: project_id || null,
        status, installed_date: installed_date || null, warranty_start: warranty_start || null, warranty_end: warranty_end || null,
        current_location: current_location || null, assigned_to: assigned_to || null, notes: notes || null,
      }
      if (editing) {
        const { error } = await supabase.from('device_instances').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const device_code = 'DEV-' + Date.now().toString().slice(-6)
        // Plain insert, no .select() chained — the device's save must
        // succeed and show up regardless of whether a select-back of the
        // fresh row (RLS timing, etc.) works. Warranty activation below is
        // a strictly best-effort follow-up that can never block this.
        const { error } = await supabase.from('device_instances').insert({ ...payload, device_code, created_by: profile.id })
        if (error) throw error
        // Installation date present at registration -> the warranty clock
        // starts immediately (12mo by default, or the applied policy's
        // duration), same as the Move/Redeploy flow's Workflow A — a new
        // device never sits untracked just because it wasn't deployed
        // through the Move dialog.
        if (installed_date) {
          try {
            const { data: created } = await supabase.from('device_instances').select('id').eq('device_code', device_code).maybeSingle()
            if (created?.id) {
              await createDeviceWarranty({
                deviceId: created.id, deploymentDate: installed_date, projectId: project_id || null,
                policyId: warranty_policy_id || null, profileId: profile.id,
              })
            }
          } catch (e) { console.error('Warranty activation failed:', e) }
        }
      }
      setShowModal(false); load()
    } catch (e) { setErr(e.message) }
    finally { setSubmitting(false) }
  }

  async function handleDelete(id) {
    await supabase.from('device_instances').delete().eq('id', id)
    setDeleteConfirm(null); load()
  }

  function openMove(d) {
    setShowMove(d)
    setMoveForm({ to_project_id: d.project_id || '', to_customer_id: d.customer_id || '', to_status: 'deployed', warranty_policy_id: policyByPart[d.part_number]?.id || '', reason: '' })
  }

  async function handleMoveSubmit(e) {
    e.preventDefault()
    if (!moveForm.reason) { alert('A reason for the move is required.'); return }
    setSubmitting(true)
    try {
      const d = showMove
      await supabase.from('deployment_history').insert({
        device_id: d.id, from_project_id: d.project_id || null, to_project_id: moveForm.to_project_id || null,
        from_customer_id: d.customer_id || null, to_customer_id: moveForm.to_customer_id || null,
        from_status: d.status, to_status: moveForm.to_status, moved_by: profile.id, reason: moveForm.reason,
      })
      await supabase.from('device_instances').update({
        project_id: moveForm.to_project_id || null, customer_id: moveForm.to_customer_id || null, status: moveForm.to_status,
      }).eq('id', d.id)
      // Workflow A: auto-activate a warranty clock the moment a device is
      // deployed, so tracking never gets forgotten for a newly deployed unit.
      if (moveForm.to_status === 'deployed') {
        try {
          await createDeviceWarranty({
            deviceId: d.id, deploymentDate: new Date().toISOString().slice(0, 10),
            projectId: moveForm.to_project_id || null, policyId: moveForm.warranty_policy_id || null, profileId: profile.id,
          })
        } catch (e) { console.error('Warranty activation failed:', e) }
      }
      setShowMove(null); load()
    } catch (e) { alert(e.message) }
    finally { setSubmitting(false) }
  }

  async function openHistory(d) {
    setShowHistory(d)
    const { data } = await supabase.from('deployment_history').select('*, mover:profiles!moved_by(full_name)').eq('device_id', d.id).order('moved_date', { ascending: false })
    setHistory(data || [])
  }

  const filtered = useMemo(() => devices.filter(d =>
    (!search || d.serial_number?.toLowerCase().includes(search.toLowerCase()) || d.device_code?.toLowerCase().includes(search.toLowerCase()) || d.product?.name?.toLowerCase().includes(search.toLowerCase())) &&
    (!statusFilter || d.status === statusFilter)
  ), [devices, search, statusFilter])

  const stats = useMemo(() => ({
    total: devices.length,
    deployed: devices.filter(d => d.status === 'deployed').length,
    inStorage: devices.filter(d => d.status === 'in_storage').length,
    attention: devices.filter(d => d.status === 'faulty' || d.status === 'replaced').length,
    decommissioned: devices.filter(d => d.status === 'decommissioned').length,
    warrantyDue: devices.filter(d => isWarrantyNear(d.warranty_end)).length,
  }), [devices])

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Device Instances</div>
          <div className="page-subtitle">Serialized device registry with deployment history and warranty tracking</div>
        </div>
        <div className="page-actions">
          {canEdit && <button className="btn btn-primary" onClick={openCreate}><Plus size={15} /> Register Device</button>}
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {[
          { label: 'Total Devices', value: stats.total, color: '#6366f1' },
          { label: 'Deployed', value: stats.deployed, color: '#10b981' },
          { label: 'In Storage', value: stats.inStorage, color: '#3b82f6' },
          { label: 'Needs Attention', value: stats.attention, color: '#e11d48' },
          { label: 'Decommissioned', value: stats.decommissioned, color: '#94a3b8' },
          { label: 'Warranty ≤30 days', value: stats.warrantyDue, color: '#f59e0b' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ '--accent': s.color }}>
            <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 200 }}><SearchBox value={search} onChange={setSearch} placeholder="Search serial #, device code, product..." /></div>
        <select className="form-select" style={{ width: 'auto' }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{SL[s]}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? <Empty icon="📡" title="No devices found" desc="Register a device instance to start tracking it" /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Device Code</th><th>Serial No.</th><th>Product</th><th>Customer</th><th>Project</th><th>Location</th><th>Status</th><th>Warranty Ends</th><th>Age</th><th>Claim Value</th>{canEdit && <th>Actions</th>}</tr></thead>
            <tbody>
              {filtered.map(d => {
                const near = isWarrantyNear(d.warranty_end)
                const { ageMonths, claimPct, claimValue } = ageAndClaimFor(d)
                return (
                  <tr key={d.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--c1)' }}>{d.device_code}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{d.serial_number}</td>
                    <td>{productByPart[d.part_number]?.name || d.part_number || '—'}</td>
                    <td>{customerById[d.customer_id]?.name || '—'}</td>
                    <td>{projectById[d.project_id]?.name || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d.current_location || '—'}</td>
                    <td><Pill status={d.status} /></td>
                    <td style={{ fontSize: 12, color: near ? 'var(--rose)' : 'var(--text-muted)', fontWeight: near ? 700 : 400 }}>
                      {d.warranty_end ? dateFmt(d.warranty_end) : '—'}{near && <span style={{ marginLeft: 4 }}>⚠</span>}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{ageMonths != null ? `${ageMonths}mo` : '—'}</td>
                    <td style={{ fontSize: 12 }} title={claimPct != null ? `${claimPct}% of standard cost, based on the applied warranty policy's depreciation schedule` : ''}>
                      {claimValue != null ? <><span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#e11d48' }}>{rupee(claimValue)}</span> <span style={{ color: 'var(--text-muted)' }}>({claimPct}%)</span></> : '—'}
                    </td>
                    {canEdit && <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-ghost btn-sm btn-icon" title="Move / Redeploy" onClick={() => openMove(d)}><ArrowRightLeft size={12} /></button>
                        <button className="btn btn-ghost btn-sm btn-icon" title="Deployment History" onClick={() => openHistory(d)}><History size={12} /></button>
                        <button className="btn btn-ghost btn-sm btn-icon" title="View Warranty" onClick={() => navigate(`/warranty?tab=claims&device=${d.id}`)}><ShieldCheck size={12} /></button>
                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openEdit(d)}><Edit2 size={12} /></button>
                        <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => setDeleteConfirm(d.id)}><Trash2 size={12} /></button>
                      </div>
                    </td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Device' : 'Register Device'} size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>{submitting ? 'Saving...' : editing ? 'Update Device' : 'Register Device'}</button>
        </>}
      >
        <form onSubmit={handleSubmit}>
          {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
          <div className="form-row">
            <div className="form-group"><label className="form-label">Product</label>
              <select className="form-select" value={form.part_number} onChange={e => setForm(f => applyPartNumber(f, e.target.value))}>
                <option value="">Select…</option>{products.map(p => <option key={p.part_number} value={p.part_number}>{p.name} ({p.part_number})</option>)}
              </select>
            </div>
            <div className="form-group"><label className="form-label">Serial Number *</label><input className="form-input" value={form.serial_number} onChange={e => setForm(f => ({ ...f, serial_number: e.target.value }))} required /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Warranty Policy</label>
              <select className="form-select" value={form.warranty_policy_id} onChange={e => setForm(f => applyPolicy(f, e.target.value))}>
                <option value="">No policy — default {productByPart[form.part_number]?.warranty_months || 12}mo warranty</option>
                {policies.map(p => <option key={p.id} value={p.id}>{p.policy_name} ({p.part_number || 'generic'}) — {p.warranty_duration_months}mo</option>)}
              </select>
              {form.warranty_policy_id && (() => {
                const policy = policyById[form.warranty_policy_id]
                const tiers = policy ? tiersByPolicy[policy.id] : null
                return policy ? (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    {policy.coverage_type} coverage{tiers?.length ? `, ${tiers.length} age-based depreciation tier(s)` : ', flat 100% claim value at any age'}
                  </div>
                ) : null
              })()}
            </div>
            <div className="form-group"><label className="form-label">Installed Date</label>
              <input className="form-input" type="date" value={form.installed_date} onChange={e => setForm(f => applyInstallDate(f, e.target.value))} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Setting this auto-fits the warranty window below ({durationForPolicy(form.warranty_policy_id, form.part_number)}mo) and, for a new device, activates its warranty clock on save.</div>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Customer</label>
              <select className="form-select" value={form.customer_id} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))}>
                <option value="">None</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Project</label>
              <select className="form-select" value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}>
                <option value="">None</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Status</label>
              <select className="form-select" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {STATUSES.map(s => <option key={s} value={s}>{SL[s]}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Current Location</label><input className="form-input" value={form.current_location} onChange={e => setForm(f => ({ ...f, current_location: e.target.value }))} placeholder="Site / warehouse" /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Assigned To</label>
              <select className="form-select" value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}>
                <option value="">Unassigned</option>{users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select></div>
            <div />
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Warranty Start</label><input className="form-input" type="date" value={form.warranty_start} onChange={e => setForm(f => ({ ...f, warranty_start: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Warranty End</label><input className="form-input" type="date" value={form.warranty_end} onChange={e => setForm(f => ({ ...f, warranty_end: e.target.value }))} /></div>
          </div>
          <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" style={{ minHeight: 60 }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
        </form>
      </Modal>

      {/* Move / Redeploy Modal */}
      <Modal open={!!showMove} onClose={() => setShowMove(null)} title={`Move / Redeploy — ${showMove?.serial_number || ''}`} size="md"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowMove(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleMoveSubmit} disabled={submitting}>{submitting ? 'Moving...' : 'Confirm Move'}</button>
        </>}
      >
        {showMove && <form onSubmit={handleMoveSubmit}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
            Currently: <strong>{projectById[showMove.project_id]?.name || 'No project'}</strong> · <strong>{customerById[showMove.customer_id]?.name || 'No customer'}</strong> · <Pill status={showMove.status} />
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">To Project</label>
              <select className="form-select" value={moveForm.to_project_id} onChange={e => setMoveForm(f => ({ ...f, to_project_id: e.target.value }))}>
                <option value="">None</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">To Customer</label>
              <select className="form-select" value={moveForm.to_customer_id} onChange={e => setMoveForm(f => ({ ...f, to_customer_id: e.target.value }))}>
                <option value="">None</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
          </div>
          <div className="form-group"><label className="form-label">New Status</label>
            <select className="form-select" value={moveForm.to_status} onChange={e => setMoveForm(f => ({ ...f, to_status: e.target.value }))}>
              {STATUSES.map(s => <option key={s} value={s}>{SL[s]}</option>)}
            </select></div>
          {moveForm.to_status === 'deployed' && (
            <div className="form-group">
              <label className="form-label">Warranty Policy</label>
              <select className="form-select" value={moveForm.warranty_policy_id} onChange={e => setMoveForm(f => ({ ...f, warranty_policy_id: e.target.value }))}>
                <option value="">No policy — default {productByPart[showMove.part_number]?.warranty_months || 12}mo warranty</option>
                {policies.map(p => <option key={p.id} value={p.id}>{p.policy_name} ({p.part_number || 'generic'}) — {p.warranty_duration_months}mo</option>)}
              </select>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                {(() => { const w = computeWarrantyWindow(new Date().toISOString().slice(0, 10), durationForPolicy(moveForm.warranty_policy_id, showMove.part_number)); return <>Deploying today activates a warranty window through <strong>{dateFmt(w.warrantyEnd)}</strong>.</> })()}
              </div>
            </div>
          )}
          <div className="form-group"><label className="form-label">Reason *</label><textarea className="form-textarea" value={moveForm.reason} onChange={e => setMoveForm(f => ({ ...f, reason: e.target.value }))} placeholder="Why is this device moving?" required /></div>
        </form>}
      </Modal>

      {/* Deployment History Modal */}
      <Modal open={!!showHistory} onClose={() => setShowHistory(null)} title={`Deployment History — ${showHistory?.serial_number || ''}`} size="md">
        {history.length === 0 ? <Empty icon="🕓" title="No moves recorded" desc="This device hasn't been redeployed yet" /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {history.map(h => (
              <div key={h.id} style={{ borderLeft: '2px solid var(--border)', paddingLeft: 12, paddingBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}><Clock size={11} />{dateFmt(h.moved_date)} · {h.mover?.full_name || 'Unknown'}</div>
                <div style={{ fontSize: 13, marginTop: 3 }}><Pill status={h.from_status} /> → <Pill status={h.to_status} /></div>
                {h.reason && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{h.reason}</div>}
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Confirm open={!!deleteConfirm} message="Delete this device instance? This cannot be undone." danger onConfirm={() => handleDelete(deleteConfirm)} onCancel={() => setDeleteConfirm(null)} />
    </div>
  )
}
