import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase, rupee } from '../lib/supabase'
import { getInventoryList } from '../lib/inventory'
import { getSpendByProduct } from '../lib/spendAnalyzer'
import { getActiveBomEdges } from '../lib/bom'
import { getVendorMap, getAllVendorMaps, addVendorMap, updateVendorMap, deleteVendorMap, getVendorSpendForComponent } from '../lib/componentVendors'
import { getPolicyForPartNumber, listWarrantyPolicies, updateWarrantyPolicy } from '../lib/warranty'
import { Modal, SearchBox, Loader, Empty, Confirm, StatCard } from './ui'
import ExcelImport from './ui/ExcelImport'
import {
  Boxes, Plus, Upload, Edit2, Trash2, Truck, Star, X, Wallet, Package, AlertTriangle,
  ShoppingCart, Warehouse, Link2, ShieldCheck, ExternalLink,
} from 'lucide-react'

const initForm = () => ({
  part_number: '', name: '', device_type: '', reorder_level: 0, reorder_qty: 0,
  standard_cost: '', status: 'active', warranty_policy_id: '',
})

export default function InventoryComponentsPanel() {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const canEdit = ['admin', 'ceo', 'manager', 'department_head', 'finance', 'procurement_lead'].includes(role)

  const [loading, setLoading] = useState(true)
  const [list, setList] = useState([])
  const [spendByPart, setSpendByPart] = useState({})
  const [vendorMapByPart, setVendorMapByPart] = useState({})
  const [usedInByPart, setUsedInByPart] = useState({})
  const [search, setSearch] = useState('')
  const [lowStockOnly, setLowStockOnly] = useState(false)

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(initForm())
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [vendorTarget, setVendorTarget] = useState(null)
  const [linkedPolicy, setLinkedPolicy] = useState(null)
  const [policies, setPolicies] = useState([])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [full, spendRows, vmap, edges, pols] = await Promise.all([
      getInventoryList(), getSpendByProduct({ limit: 1000 }), getAllVendorMaps(), getActiveBomEdges(), listWarrantyPolicies({ activeOnly: true }),
    ])
    setList(full.filter(i => !i.is_serialized))
    setSpendByPart(Object.fromEntries(spendRows.map(r => [r.part_number, r.requisitionedTotal])))
    setVendorMapByPart(vmap)
    const usedIn = {}
    edges.forEach(e => { usedIn[e.component_part_number] = (usedIn[e.component_part_number] || 0) + 1 })
    setUsedInByPart(usedIn)
    setPolicies(pols)
    setLoading(false)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return list.filter(i => (!q || i.name?.toLowerCase().includes(q) || i.part_number?.toLowerCase().includes(q)) && (!lowStockOnly || i.lowStock))
  }, [list, search, lowStockOnly])

  const kpis = useMemo(() => ({
    total: list.length,
    active: list.filter(i => i.status === 'active').length,
    stockValue: Math.round(list.reduce((s, i) => s + i.totalValue, 0) * 100) / 100,
    lowStock: list.filter(i => i.lowStock).length,
    requisitionedSpend: Math.round(list.reduce((s, i) => s + (spendByPart[i.part_number] || 0), 0) * 100) / 100,
  }), [list, spendByPart])

  // Families are on-demand, not a fixed list — whatever's already been typed
  // in for any component becomes a suggestion for the next one via the
  // datalist below, but a brand new family can always just be typed in.
  const familyOptions = useMemo(() => [...new Set(list.map(i => i.device_type).filter(Boolean))].sort(), [list])

  function openCreate() { setEditing(null); setForm(initForm()); setLinkedPolicy(null); setErr(''); setShowModal(true) }

  async function openEdit(p) {
    setEditing(p); setForm({ ...initForm(), ...p, warranty_policy_id: '' }); setLinkedPolicy(null); setErr(''); setShowModal(true)
    const policy = await getPolicyForPartNumber(p.part_number)
    setLinkedPolicy(policy.id ? policy : null)
    if (policy.id) setForm(f => ({ ...f, warranty_policy_id: policy.id }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true); setErr('')
    try {
      const { name, device_type, reorder_level, reorder_qty, standard_cost, status } = form
      const part_number = form.part_number?.trim() || ('CMP-' + Date.now().toString().slice(-6))
      const payload = {
        part_number, name, device_type: device_type || null,
        reorder_level: parseFloat(reorder_level) || 0, reorder_qty: parseFloat(reorder_qty) || 0,
        standard_cost: parseFloat(standard_cost) || 0, is_serialized: false, status: status || 'active',
      }
      if (editing) {
        const { error } = await supabase.from('products').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('products').insert({ ...payload, created_by: profile.id })
        if (error) throw error
      }

      // Reassign the warranty policy link if the dropdown selection changed —
      // a policy is a reusable template (warranty_policies.part_number is
      // just "which part it currently applies to"), so switching the
      // selection here moves it: unassign whatever was linked before, then
      // point the newly chosen policy at this component's part_number.
      const originalPolicyId = linkedPolicy?.id || null
      const selectedPolicyId = form.warranty_policy_id || null
      if (selectedPolicyId !== originalPolicyId) {
        if (originalPolicyId) await updateWarrantyPolicy(originalPolicyId, { part_number: null })
        if (selectedPolicyId) await updateWarrantyPolicy(selectedPolicyId, { part_number })
      }

      setShowModal(false); load()
    } catch (e) { setErr(e.message) }
    finally { setSubmitting(false) }
  }

  async function handleDelete(id) {
    await supabase.from('products').delete().eq('id', id)
    setDeleteConfirm(null); load()
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Components" value={kpis.total} icon={<Boxes size={17} />} accent="#6366f1" />
        <StatCard label="Active" value={kpis.active} icon={<Package size={17} />} accent="#10b981" />
        <StatCard label="Stock Value" value={rupee(kpis.stockValue)} icon={<Wallet size={17} />} accent="#0ea5e9" />
        <StatCard label="Low Stock Alerts" value={kpis.lowStock} icon={<AlertTriangle size={17} />} accent="#ef4444" />
        <StatCard label="Requisitioned Spend" value={rupee(kpis.requisitionedSpend)} icon={<ShoppingCart size={17} />} accent="#f59e0b" />
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 200 }}><SearchBox value={search} onChange={setSearch} placeholder="Search components…" /></div>
        <button className={`btn btn-sm ${lowStockOnly ? 'btn-primary' : 'btn-outline'}`} onClick={() => setLowStockOnly(v => !v)}>
          <AlertTriangle size={13} /> Low Stock Only
        </button>
        {canEdit && <button className="btn btn-outline" onClick={() => setShowImport(true)}><Upload size={15} /> Import</button>}
        {canEdit && <button className="btn btn-primary" onClick={openCreate}><Plus size={15} /> Add Component</button>}
      </div>

      {filtered.length === 0 ? (
        <Empty icon={<Boxes size={44} />} title="No components found" desc="Add a bulk/consumable component, or import a batch from a spreadsheet" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Part #</th><th>Name</th><th>Category</th><th>On Hand</th><th>Reorder Lvl</th>
                <th>Unit Cost</th><th>Total Value</th><th>Used In</th><th>Preferred Vendor</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const vmaps = vendorMapByPart[p.part_number] || []
                const preferred = vmaps.find(v => v.is_preferred) || vmaps[0]
                return (
                  <tr key={p.part_number}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--c1)' }}>{p.part_number}</td>
                    <td className="td-bold">{p.name}</td>
                    <td style={{ fontSize: 12 }}>{p.device_type || '—'}</td>
                    <td style={{ fontWeight: 700, color: p.lowStock ? '#dc2626' : 'inherit' }}>{p.onHand}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.reorder_level ?? '—'}</td>
                    <td style={{ fontFamily: 'monospace' }}>{rupee(p.unitCost)}</td>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{rupee(p.totalValue)}</td>
                    <td style={{ fontWeight: 700, textAlign: 'center' }} title="Number of Products whose active BOM includes this component">
                      {usedInByPart[p.part_number] || 0}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {preferred ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {vmaps.find(v => v.is_preferred) && <Star size={11} style={{ color: '#f59e0b' }} fill="#f59e0b" />}
                          {preferred.vendor?.name || '—'}
                        </span>
                      ) : <span style={{ color: '#94a3b8' }}>Not mapped</span>}
                    </td>
                    <td>{p.status === 'active' ? <span className="badge badge-success">Active</span> : <span className="badge badge-danger">Discontinued</span>}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-ghost btn-sm btn-icon" title="Vendor Mapping" onClick={() => setVendorTarget(p)}><Truck size={12} /></button>
                        <Link className="btn btn-ghost btn-sm btn-icon" title="Ledger & History" to={`/inventory?view=overview&product=${encodeURIComponent(p.part_number)}`}><Warehouse size={12} /></Link>
                        {canEdit && <>
                          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openEdit(p)}><Edit2 size={12} /></button>
                          <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => setDeleteConfirm(p.id)}><Trash2 size={12} /></button>
                        </>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit Component */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Component' : 'Add New Component'} size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>{submitting ? 'Saving…' : editing ? 'Update Component' : 'Add Component'}</button>
        </>}>
        <form onSubmit={handleSubmit}>
          {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
          <div className="form-row">
            <div className="form-group"><label className="form-label">Part Number</label><input className="form-input" value={form.part_number} onChange={e => setForm(f => ({ ...f, part_number: e.target.value }))} placeholder="Auto-generated if left blank" /></div>
            <div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Family / Category</label>
              <input className="form-input" list="component-family-options" value={form.device_type}
                onChange={e => setForm(f => ({ ...f, device_type: e.target.value }))}
                placeholder="Type an existing family or a new one" />
              <datalist id="component-family-options">
                {familyOptions.map(t => <option key={t} value={t} />)}
              </datalist>
            </div>
            <div className="form-group"><label className="form-label">Standard Cost (₹)</label><input className="form-input" type="number" step="0.01" value={form.standard_cost} onChange={e => setForm(f => ({ ...f, standard_cost: e.target.value }))} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Reorder Level</label><input className="form-input" type="number" value={form.reorder_level} onChange={e => setForm(f => ({ ...f, reorder_level: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Reorder Quantity</label><input className="form-input" type="number" value={form.reorder_qty} onChange={e => setForm(f => ({ ...f, reorder_qty: e.target.value }))} /></div>
          </div>
          <div className="form-group"><label className="form-label">Status</label>
            <select className="form-select" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              <option value="active">Active</option>
              <option value="discontinued">Discontinued</option>
            </select></div>

          <div style={{ marginTop: 8, padding: 14, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <ShieldCheck size={14} style={{ color: '#10b981' }} />
              <span style={{ fontWeight: 700, fontSize: 13 }}>Warranty Policy</span>
            </div>
            <div className="form-group" style={{ marginBottom: 6 }}>
              <select className="form-select" value={form.warranty_policy_id} onChange={e => setForm(f => ({ ...f, warranty_policy_id: e.target.value }))}>
                <option value="">— No policy —</option>
                {policies.map(pol => (
                  <option key={pol.id} value={pol.id}>
                    {pol.policy_name} ({pol.warranty_duration_months}mo, {pol.coverage_type}){pol.part_number && pol.part_number !== form.part_number ? ` — currently on ${pol.part_number}` : ''}
                  </option>
                ))}
              </select>
            </div>
            {(() => {
              const selected = policies.find(pol => pol.id === form.warranty_policy_id)
              return selected?.part_number && selected.part_number !== (editing?.part_number || form.part_number) ? (
                <div style={{ fontSize: 11, color: '#d97706', marginBottom: 6 }}>
                  Currently assigned to {selected.part_number} — saving will move it to this component instead.
                </div>
              ) : null
            })()}
            <a href={`/warranty?tab=policies${editing ? `&part_number=${encodeURIComponent(editing.part_number)}` : ''}`} target="_blank" rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--c1)', fontWeight: 600, textDecoration: 'none' }}>
              Create a new policy <ExternalLink size={11} />
            </a>
          </div>
        </form>
      </Modal>

      <Confirm open={!!deleteConfirm} message="Delete this component? This cannot be undone." danger onConfirm={() => handleDelete(deleteConfirm)} onCancel={() => setDeleteConfirm(null)} />

      {/* Import */}
      <Modal open={showImport} onClose={() => setShowImport(false)} title="Import Components" size="lg">
        <ExcelImport type="components" onSuccess={() => { setShowImport(false); load() }} onClose={() => setShowImport(false)} />
      </Modal>

      {/* Vendor Mapping */}
      {vendorTarget && (
        <VendorMapModal component={vendorTarget} onClose={() => { setVendorTarget(null); load() }} canEdit={canEdit} userId={profile.id} />
      )}
    </div>
  )
}

function VendorMapModal({ component, onClose, canEdit, userId }) {
  const [maps, setMaps] = useState([])
  const [spend, setSpend] = useState([])
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ vendorId: '', unitCost: '', leadTimeDays: '', isPreferred: false, notes: '' })
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [component.part_number])

  async function load() {
    setLoading(true)
    const [m, s, v] = await Promise.all([
      getVendorMap(component.part_number),
      getVendorSpendForComponent(component.part_number),
      supabase.from('vendors').select('id,name').eq('status', 'active').order('name'),
    ])
    setMaps(m); setSpend(s); setVendors(v.data || [])
    setLoading(false)
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!form.vendorId) { setErr('Select a vendor'); return }
    setSubmitting(true); setErr('')
    try {
      await addVendorMap({
        partNumber: component.part_number, vendorId: form.vendorId, unitCost: form.unitCost,
        leadTimeDays: form.leadTimeDays, isPreferred: form.isPreferred, notes: form.notes, userId,
      })
      setForm({ vendorId: '', unitCost: '', leadTimeDays: '', isPreferred: false, notes: '' })
      load()
    } catch (e) { setErr(e.message) }
    finally { setSubmitting(false) }
  }

  async function handleTogglePreferred(m) {
    await updateVendorMap(m.id, { partNumber: component.part_number, unitCost: m.unit_cost, leadTimeDays: m.lead_time_days, isPreferred: true, notes: m.notes })
    load()
  }

  async function handleDelete(id) {
    await deleteVendorMap(id)
    load()
  }

  const mappedVendorIds = new Set(maps.map(m => m.vendor_id))
  const spendByVendor = Object.fromEntries(spend.map(s => [s.vendorId, s]))

  return (
    <Modal open onClose={onClose} title={`Vendor Mapping — ${component.name}`} size="lg" footer={<button className="btn btn-ghost" onClick={onClose}>Close</button>}>
      {loading ? <Loader /> : (
        <div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 16 }}>
            Spend figures come straight from GRN receipts against this part — the same records Fund Flow and Spend Analyzer use, so nothing here can drift from those.
          </div>

          {maps.length === 0 ? (
            <div style={{ fontSize: 12, color: '#94a3b8', padding: '10px 0', marginBottom: 16 }}>No vendor mapped to this component yet.</div>
          ) : (
            <div className="table-wrap" style={{ marginBottom: 16 }}>
              <table>
                <thead><tr><th>Vendor</th><th>Unit Cost</th><th>Lead Time</th><th>Received (GRN)</th><th>Spent (GRN)</th><th></th></tr></thead>
                <tbody>
                  {maps.map(m => {
                    const vs = spendByVendor[m.vendor_id]
                    return (
                      <tr key={m.id}>
                        <td style={{ fontWeight: 700 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            {m.is_preferred && <Star size={12} style={{ color: '#f59e0b' }} fill="#f59e0b" />}
                            {m.vendor?.name || '—'}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'monospace' }}>{rupee(m.unit_cost)}</td>
                        <td style={{ fontSize: 12 }}>{m.lead_time_days != null ? `${m.lead_time_days} days` : '—'}</td>
                        <td style={{ fontSize: 12 }}>{vs?.qtyReceived ?? 0}</td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 700, color: '#059669' }}>{rupee(vs?.amountSpent || 0)}</td>
                        <td>
                          {canEdit && (
                            <div style={{ display: 'flex', gap: 4 }}>
                              {!m.is_preferred && <button className="btn btn-ghost btn-sm btn-icon" title="Set as preferred" onClick={() => handleTogglePreferred(m)}><Star size={12} /></button>}
                              <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => handleDelete(m.id)}><Trash2 size={12} /></button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {spend.some(s => !mappedVendorIds.has(s.vendorId) && s.vendorId) && (
            <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a', fontSize: 12, color: '#92400e' }}>
              <Link2 size={12} style={{ marginRight: 5, verticalAlign: -2 }} />
              This component has also been received from vendor(s) not yet mapped above — add them below to keep the master mapping aligned with actual purchase history.
            </div>
          )}

          {canEdit && (
            <form onSubmit={handleAdd} style={{ padding: 14, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              {err && <div className="alert alert-danger" style={{ marginBottom: 10 }}>{err}</div>}
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Map a Vendor</div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Vendor *</label>
                  <select className="form-select" value={form.vendorId} onChange={e => setForm(f => ({ ...f, vendorId: e.target.value }))}>
                    <option value="">Select vendor…</option>
                    {vendors.filter(v => !mappedVendorIds.has(v.id)).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                <div className="form-group"><label className="form-label">Unit Cost (₹)</label><input className="form-input" type="number" step="0.01" value={form.unitCost} onChange={e => setForm(f => ({ ...f, unitCost: e.target.value }))} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Lead Time (days)</label><input className="form-input" type="number" value={form.leadTimeDays} onChange={e => setForm(f => ({ ...f, leadTimeDays: e.target.value }))} /></div>
                <div className="form-group"><label className="form-label">Notes</label><input className="form-input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 10 }}>
                <input type="checkbox" checked={form.isPreferred} onChange={e => setForm(f => ({ ...f, isPreferred: e.target.checked }))} />
                Set as preferred vendor
              </label>
              <button className="btn btn-primary btn-sm" disabled={submitting}><Plus size={13} /> {submitting ? 'Adding…' : 'Add Vendor'}</button>
            </form>
          )}
        </div>
      )}
    </Modal>
  )
}
