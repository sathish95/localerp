import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { StatusBadge, SearchBox, Empty, Modal, Loader } from '../components/ui'
import { ShoppingCart, Eye, Building2, Calendar, Package, TrendingUp, Clock, CheckCircle, X } from 'lucide-react'

const rupee = v => v != null ? '₹' + Number(v).toLocaleString('en-IN') : '—'
const fmt = d => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const STATUS_META = {
  draft:        { color: '#64748b', bg: '#f1f5f9', label: 'Draft' },
  sent:         { color: '#2563eb', bg: '#dbeafe', label: 'Sent' },
  acknowledged: { color: '#7c3aed', bg: '#ede9fe', label: 'Acknowledged' },
  delivered:    { color: '#059669', bg: '#d1fae5', label: 'Delivered' },
  closed:       { color: '#475569', bg: '#e2e8f0', label: 'Closed' },
  cancelled:    { color: '#dc2626', bg: '#fee2e2', label: 'Cancelled' },
}

export default function PurchaseOrdersPage() {
  const [pos, setPOs] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selected, setSelected] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('purchase_orders')
      .select('*, vendor:vendors(name, email, phone, gst_number), pr:purchase_requisitions(pr_number, title)')
      .order('created_at', { ascending: false })
    if (error) console.error(error)
    setPOs(data || [])
    setLoading(false)
  }

  const filtered = pos.filter(p => {
    const ms = !search || p.po_number?.toLowerCase().includes(search.toLowerCase()) || p.vendor?.name?.toLowerCase().includes(search.toLowerCase())
    const mf = statusFilter === 'all' || p.status === statusFilter
    return ms && mf
  })

  const totalValue = pos.reduce((s, p) => s + (p.total_amount || 0), 0)
  const counts = Object.fromEntries(Object.keys(STATUS_META).map(k => [k, pos.filter(p => p.status === k).length]))

  if (loading) return <Loader />

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Purchase Orders</div>
          <div className="page-subtitle">Track all POs raised from approved requisitions</div>
        </div>
      </div>

      {/* KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total POs', value: pos.length, icon: <ShoppingCart size={18} />, color: '#6366f1' },
          { label: 'Total Value', value: rupee(totalValue), icon: <TrendingUp size={18} />, color: '#0891b2' },
          { label: 'Sent', value: counts.sent || 0, icon: <Clock size={18} />, color: '#2563eb' },
          { label: 'Delivered', value: counts.delivered || 0, icon: <CheckCircle size={18} />, color: '#059669' },
          { label: 'Cancelled', value: counts.cancelled || 0, icon: <X size={18} />, color: '#dc2626' },
        ].map(s => (
          <div key={s.label} style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', border: `1.5px solid ${s.color}20`, borderTop: `4px solid ${s.color}`, boxShadow: '0 1px 4px rgba(0,0,0,.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: s.color, marginBottom: 8 }}>{s.icon}</div>
            <div style={{ fontSize: typeof s.value === 'string' ? 18 : 26, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Status filter pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={() => setStatusFilter('all')} style={{ padding: '6px 16px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12, background: statusFilter === 'all' ? '#1e293b' : '#f1f5f9', color: statusFilter === 'all' ? '#fff' : '#475569' }}>
          All ({pos.length})
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
          <SearchBox value={search} onChange={setSearch} placeholder="Search PO number or vendor…" />
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{filtered.length} orders</span>
        </div>

        {filtered.length === 0 ? (
          <Empty icon={<ShoppingCart size={44} />} title="No purchase orders" desc="POs appear here once raised from approved requisitions" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>PO Number</th>
                <th>Vendor</th>
                <th>Linked PR</th>
                <th>Order Date</th>
                <th>Delivery Date</th>
                <th>Amount</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(po => {
                const sm = STATUS_META[po.status] || STATUS_META.draft
                return (
                  <tr key={po.id}>
                    <td>
                      <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 13, color: '#6366f1', background: '#6366f110', padding: '3px 8px', borderRadius: 6 }}>
                        {po.po_number || '—'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 10, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, color: '#475569', flexShrink: 0 }}>
                          {po.vendor?.name?.[0] || '?'}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{po.vendor?.name || '—'}</div>
                          {po.vendor?.phone && <div style={{ fontSize: 11, color: '#94a3b8' }}>{po.vendor.phone}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: '#64748b', fontFamily: 'monospace' }}>{po.pr?.pr_number || '—'}</td>
                    <td style={{ fontSize: 13 }}>{fmt(po.order_date)}</td>
                    <td style={{ fontSize: 13 }}>{fmt(po.delivery_date)}</td>
                    <td style={{ fontWeight: 800, fontSize: 14 }}>{rupee(po.total_amount)}</td>
                    <td>
                      <span style={{ padding: '4px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: sm.bg, color: sm.color }}>
                        {sm.label}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setSelected(po)} title="View details">
                        <Eye size={14} />
                      </button>
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
        <Modal open title={`Purchase Order — ${selected.po_number}`} onClose={() => setSelected(null)} size="lg"
          footer={<button className="btn btn-ghost" onClick={() => setSelected(null)}>Close</button>}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid #f1f5f9' }}>
            <div>
              <div style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 800, color: '#6366f1' }}>{selected.po_number}</div>
              <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>Raised on {fmt(selected.created_at)}</div>
            </div>
            <span style={{ padding: '6px 16px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: STATUS_META[selected.status]?.bg || '#f1f5f9', color: STATUS_META[selected.status]?.color || '#475569' }}>
              {STATUS_META[selected.status]?.label || selected.status}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              ['Vendor', selected.vendor?.name],
              ['GST Number', selected.vendor?.gst_number],
              ['Linked PR', selected.pr?.pr_number],
              ['PR Title', selected.pr?.title],
              ['Order Date', fmt(selected.order_date)],
              ['Delivery Date', fmt(selected.delivery_date)],
              ['Subtotal', rupee(selected.subtotal)],
              ['GST Amount', rupee(selected.gst_amount)],
            ].map(([k, v]) => (
              <div key={k} style={{ padding: '10px 14px', borderRadius: 10, background: '#f8fafc', border: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#94a3b8', marginBottom: 3 }}>{k}</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{v || '—'}</div>
              </div>
            ))}
            <div style={{ gridColumn: '1/-1', padding: '14px 18px', borderRadius: 12, background: 'linear-gradient(135deg, #6366f110, #8b5cf610)', border: '1.5px solid #6366f125' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#6366f1', marginBottom: 4 }}>Total Amount</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#6366f1' }}>{rupee(selected.total_amount)}</div>
            </div>
            {selected.terms && (
              <div style={{ gridColumn: '1/-1', padding: '10px 14px', borderRadius: 10, background: '#f8fafc' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 3 }}>Terms</div>
                <div style={{ fontSize: 13 }}>{selected.terms}</div>
              </div>
            )}
            {selected.notes && (
              <div style={{ gridColumn: '1/-1', padding: '10px 14px', borderRadius: 10, background: '#f8fafc' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 3 }}>Notes</div>
                <div style={{ fontSize: 13 }}>{selected.notes}</div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
