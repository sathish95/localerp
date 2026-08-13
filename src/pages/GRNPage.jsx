import { useState, useEffect } from 'react'
import { supabase, rupee } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { getGRNItems } from '../lib/grn'
import { exportGRNPDF } from '../lib/grnExport'
import CreateGRNModal from '../components/CreateGRNModal'
import { StatusBadge, SearchBox, Empty, Modal, Loader } from '../components/ui'
import { ClipboardCheck, Eye, CheckCircle, XCircle, AlertTriangle, Package, Truck, Download, Plus } from 'lucide-react'

const PO_STATUS_META = {
  draft: { color: '#64748b', bg: '#f1f5f9', label: 'Draft' },
  sent: { color: '#2563eb', bg: '#dbeafe', label: 'Sent' },
  acknowledged: { color: '#7c3aed', bg: '#ede9fe', label: 'Acknowledged' },
  delivered: { color: '#059669', bg: '#d1fae5', label: 'Delivered' },
}

const fmt = d => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const STATUS_META = {
  pending:  { color: '#f59e0b', bg: '#fef3c7', label: 'Pending' },
  partial:  { color: '#6366f1', bg: '#ede9fe', label: 'Partial' },
  received: { color: '#059669', bg: '#d1fae5', label: 'Received' },
  closed:   { color: '#475569', bg: '#e2e8f0', label: 'Closed' },
}

export default function GRNPage() {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const canEditAmount = ['admin', 'ceo', 'finance', 'procurement_lead'].includes(role)
  // Same role set PurchaseOrdersPage.jsx uses to gate "Create GRN" there —
  // a GRN is always against a PO, so this page's own create button needs
  // the same permission, just with a PO-picker step first.
  const canCreateGRN = ['admin', 'ceo', 'manager', 'department_head', 'finance', 'procurement_lead'].includes(role)
  const [grns, setGRNs] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selected, setSelected] = useState(null)
  const [selectedItems, setSelectedItems] = useState([])
  const [receivedAmount, setReceivedAmount] = useState('')
  const [savingAmount, setSavingAmount] = useState(false)
  const [exportingId, setExportingId] = useState(null)

  const [showPOPicker, setShowPOPicker] = useState(false)
  const [poSearch, setPOSearch] = useState('')
  const [eligiblePOs, setEligiblePOs] = useState([])
  const [poLoading, setPOLoading] = useState(false)
  const [poErr, setPOErr] = useState('')
  const [createForPO, setCreateForPO] = useState(null)

  useEffect(() => { load() }, [])

  async function handleExport(grn) {
    setExportingId(grn.id)
    try { await exportGRNPDF(grn.id, profile?.org?.name) }
    catch (e) { alert(e.message) }
    finally { setExportingId(null) }
  }

  // A GRN always receives against a PO, so "New GRN" here is really
  // "pick a PO, then receive against it" — same eligibility rule
  // PurchaseOrdersPage.jsx's own Create GRN button uses (anything not
  // already closed/cancelled). Fetches with the exact same query
  // PurchaseOrdersPage.jsx already uses successfully, then filters
  // client-side — avoids relying on a `.not(...,'in',...)` PostgREST
  // filter string that was never actually verified against a live PO
  // list, in favor of the one pattern already proven to work here.
  async function openPOPicker() {
    setShowPOPicker(true); setPOSearch(''); setPOLoading(true); setPOErr('')
    const { data, error } = await supabase.from('purchase_orders')
      .select('id, po_number, status, total_amount, vendor:vendors(name)')
      .order('created_at', { ascending: false })
    if (error) { console.error(error); setPOErr(error.message) }
    setEligiblePOs((data || []).filter(po => !['closed', 'cancelled'].includes(po.status)))
    setPOLoading(false)
  }

  function pickPO(po) {
    setShowPOPicker(false)
    setCreateForPO(po)
  }

  function handleGRNCreated() {
    setCreateForPO(null)
    load()
  }

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('grn')
      .select('*, po:purchase_orders(po_number, vendor:vendors(name))')
      .order('created_at', { ascending: false })
    if (error) console.error(error)
    setGRNs(data || [])
    setLoading(false)
  }

  const filtered = grns.filter(g => {
    const ms = !search || g.grn_number?.toLowerCase().includes(search.toLowerCase()) || g.po?.vendor?.name?.toLowerCase().includes(search.toLowerCase()) || g.po?.po_number?.toLowerCase().includes(search.toLowerCase())
    const mf = statusFilter === 'all' || g.status === statusFilter
    return ms && mf
  })

  const counts = Object.fromEntries(Object.keys(STATUS_META).map(k => [k, grns.filter(g => g.status === k).length]))

  function openDetail(grn) {
    setSelected(grn); setReceivedAmount(grn.received_amount ?? ''); setSelectedItems([])
    getGRNItems(grn.id).then(setSelectedItems)
  }

  async function saveReceivedAmount() {
    setSavingAmount(true)
    try {
      const amt = receivedAmount === '' ? null : parseFloat(receivedAmount)
      await supabase.from('grn').update({ received_amount: amt }).eq('id', selected.id)
      setGRNs(prev => prev.map(g => g.id === selected.id ? { ...g, received_amount: amt } : g))
      setSelected(prev => ({ ...prev, received_amount: amt }))
    } finally { setSavingAmount(false) }
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Goods Receipt Notes</div>
          <div className="page-subtitle">Verify and record delivery of ordered goods</div>
        </div>
        {canCreateGRN && (
          <button className="btn btn-primary" onClick={openPOPicker}><Plus size={15} /> New GRN</button>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total GRNs', value: grns.length, color: '#059669' },
          { label: 'Pending', value: counts.pending || 0, color: '#f59e0b' },
          { label: 'Partial', value: counts.partial || 0, color: '#6366f1' },
          { label: 'Received', value: counts.received || 0, color: '#059669' },
          { label: 'Closed', value: counts.closed || 0, color: '#475569' },
        ].map(s => (
          <div key={s.label} style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', border: `1.5px solid ${s.color}20`, borderTop: `4px solid ${s.color}`, boxShadow: '0 1px 4px rgba(0,0,0,.05)' }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter Pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={() => setStatusFilter('all')} style={{ padding: '6px 16px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12, background: statusFilter === 'all' ? '#059669' : '#f1f5f9', color: statusFilter === 'all' ? '#fff' : '#475569' }}>
          All ({grns.length})
        </button>
        {Object.entries(STATUS_META).map(([k, v]) => (
          <button key={k} onClick={() => setStatusFilter(statusFilter === k ? 'all' : k)} style={{ padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12, background: statusFilter === k ? v.color : v.bg, color: statusFilter === k ? '#fff' : v.color }}>
            {v.label} ({counts[k] || 0})
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="table-wrap">
        <div className="table-toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Search GRN, PO or vendor…" />
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{filtered.length} records</span>
        </div>

        {filtered.length === 0 ? (
          <Empty icon={<ClipboardCheck size={44} />} title="No GRNs found" desc="Goods receipts from delivered POs will appear here" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>GRN Number</th>
                <th>PO Number</th>
                <th>Vendor</th>
                <th>Received Date</th>
                <th>Status</th>
                <th>Remarks</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(grn => {
                const sm = STATUS_META[grn.status] || STATUS_META.pending
                return (
                  <tr key={grn.id}>
                    <td>
                      <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 13, color: '#059669', background: '#d1fae5', padding: '3px 8px', borderRadius: 6 }}>
                        {grn.grn_number || '—'}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, color: '#64748b' }}>{grn.po?.po_number || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, color: '#475569', flexShrink: 0 }}>
                          {grn.po?.vendor?.name?.[0] || <Truck size={14} />}
                        </div>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{grn.po?.vendor?.name || '—'}</span>
                      </div>
                    </td>
                    <td style={{ fontSize: 13 }}>{fmt(grn.received_date)}</td>
                    <td>
                      <span style={{ padding: '4px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: sm.bg, color: sm.color }}>
                        {sm.label}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: '#64748b', maxWidth: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {grn.remarks || '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openDetail(grn)} title="View">
                          <Eye size={14} />
                        </button>
                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => handleExport(grn)} disabled={exportingId === grn.id} title="Download PDF">
                          <Download size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail Modal */}
      {selected && (
        <Modal open title={`GRN — ${selected.grn_number}`} onClose={() => setSelected(null)} size="lg"
          footer={<>
            <button className="btn btn-ghost" onClick={() => setSelected(null)}>Close</button>
            <button className="btn btn-primary" onClick={() => handleExport(selected)} disabled={exportingId === selected.id}><Download size={14} /> {exportingId === selected.id ? 'Preparing…' : 'Download PDF'}</button>
          </>}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #f1f5f9' }}>
            <div>
              <div style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 800, color: '#059669' }}>{selected.grn_number}</div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>Created {fmt(selected.created_at)}</div>
            </div>
            <span style={{ padding: '6px 16px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: STATUS_META[selected.status]?.bg || '#f1f5f9', color: STATUS_META[selected.status]?.color || '#475569' }}>
              {STATUS_META[selected.status]?.label || selected.status}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              ['PO Number', selected.po?.po_number],
              ['Vendor', selected.po?.vendor?.name],
              ['Received Date', fmt(selected.received_date)],
              ['Status', STATUS_META[selected.status]?.label || selected.status],
            ].map(([k, v]) => (
              <div key={k} style={{ padding: '10px 14px', borderRadius: 10, background: '#f8fafc' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#94a3b8', marginBottom: 3 }}>{k}</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{v || '—'}</div>
              </div>
            ))}
            <div style={{ padding: '10px 14px', borderRadius: 10, background: '#f8fafc' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#94a3b8', marginBottom: 3 }}>Received Amount</div>
              {canEditAmount ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="form-input" type="number" step="0.01" value={receivedAmount} onChange={e => setReceivedAmount(e.target.value)} placeholder="Not recorded" style={{ fontSize: 13 }} />
                  <button className="btn btn-primary btn-sm" onClick={saveReceivedAmount} disabled={savingAmount}>{savingAmount ? '…' : 'Save'}</button>
                </div>
              ) : (
                <div style={{ fontWeight: 600, fontSize: 14 }}>{selected.received_amount != null ? rupee(selected.received_amount) : '—'}</div>
              )}
              <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 4 }}>Used for 3-way match against the PO and Vendor Invoice amounts</div>
            </div>
            {selected.remarks && (
              <div style={{ gridColumn: '1/-1', padding: '10px 14px', borderRadius: 10, background: '#fef3c7', border: '1px solid #fde68a' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#92400e', marginBottom: 3 }}>Remarks</div>
                <div style={{ fontSize: 13, color: '#78350f' }}>{selected.remarks}</div>
              </div>
            )}
            {selectedItems.length > 0 ? (
              <div style={{ gridColumn: '1/-1' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 8 }}>Items Received</div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Part #</th><th>Description</th><th>Ordered</th><th>Received</th><th>Unit Cost</th></tr></thead>
                    <tbody>{selectedItems.map(item => (
                      <tr key={item.id}>
                        <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{item.part_number || '—'}</td>
                        <td>{item.description}</td>
                        <td>{item.quantity_ordered}</td>
                        <td style={{ fontWeight: 700 }}>{item.quantity_received}</td>
                        <td>{rupee(item.unit_cost)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            ) : selected.items?.length > 0 && (
              // Legacy free-text items — pre-dates grn_items (structured line
              // items with part_number), kept viewable for old seeded rows.
              <div style={{ gridColumn: '1/-1' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 8 }}>Items Received</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(typeof selected.items === 'string' ? JSON.parse(selected.items) : selected.items).map((item, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 8, background: '#f8fafc', fontSize: 13 }}>
                      <span style={{ fontWeight: 600 }}>{item.name || item.description || `Item ${i+1}`}</span>
                      <span style={{ color: '#64748b' }}>Qty: {item.qty_received || item.quantity || '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Pick a PO, then hand off to the shared Create GRN form — same one
          Purchase Orders uses, so receiving behaves identically from
          either page. */}
      <Modal open={showPOPicker} onClose={() => setShowPOPicker(false)} title="Select a Purchase Order" size="lg"
        footer={<button className="btn btn-ghost" onClick={() => setShowPOPicker(false)}>Cancel</button>}>
        {poErr && <div className="alert alert-danger" style={{ marginBottom: 12 }}>Couldn't load purchase orders: {poErr}</div>}
        <div style={{ marginBottom: 12 }}>
          <SearchBox value={poSearch} onChange={setPOSearch} placeholder="Search PO number or vendor…" />
        </div>
        {poLoading ? <Loader /> : (
          (() => {
            const matches = eligiblePOs.filter(po =>
              !poSearch || po.po_number?.toLowerCase().includes(poSearch.toLowerCase()) || po.vendor?.name?.toLowerCase().includes(poSearch.toLowerCase())
            )
            return matches.length === 0 ? (
              <Empty icon={<Package size={36} />} title="No open purchase orders"
                desc={poErr ? 'See the error above.' : eligiblePOs.length === 0 && !poSearch
                  ? "Every PO is either closed/cancelled, or none exist yet — create one under Purchase Orders first."
                  : 'No PO matches that search.'} />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>PO Number</th><th>Vendor</th><th>Status</th><th>Total</th><th></th></tr></thead>
                  <tbody>
                    {matches.map(po => {
                      const sm = PO_STATUS_META[po.status] || PO_STATUS_META.draft
                      return (
                        <tr key={po.id} style={{ cursor: 'pointer' }} onClick={() => pickPO(po)}>
                          <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12 }}>{po.po_number}</td>
                          <td>{po.vendor?.name || '—'}</td>
                          <td><span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: sm.bg, color: sm.color }}>{sm.label}</span></td>
                          <td>{rupee(po.total_amount)}</td>
                          <td><button className="btn btn-primary btn-sm" onClick={() => pickPO(po)}>Select</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })()
        )}
      </Modal>

      <CreateGRNModal po={createForPO} onClose={() => setCreateForPO(null)} onCreated={handleGRNCreated} />
    </div>
  )
}
