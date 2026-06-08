import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { StatusBadge, SearchBox, Empty, Modal, Loader } from '../components/ui'
import { ClipboardCheck, Eye, CheckCircle, XCircle, AlertTriangle, Package, Truck } from 'lucide-react'

const fmt = d => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const STATUS_META = {
  pending:  { color: '#f59e0b', bg: '#fef3c7', label: 'Pending' },
  partial:  { color: '#6366f1', bg: '#ede9fe', label: 'Partial' },
  received: { color: '#059669', bg: '#d1fae5', label: 'Received' },
  closed:   { color: '#475569', bg: '#e2e8f0', label: 'Closed' },
}

export default function GRNPage() {
  const [grns, setGRNs] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selected, setSelected] = useState(null)

  useEffect(() => { load() }, [])

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

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Goods Receipt Notes</div>
          <div className="page-subtitle">Verify and record delivery of ordered goods</div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
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
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setSelected(grn)}>
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
        <Modal open title={`GRN — ${selected.grn_number}`} onClose={() => setSelected(null)} size="lg"
          footer={<button className="btn btn-ghost" onClick={() => setSelected(null)}>Close</button>}>
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
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#94a3b8', marginBottom: 3 }}>{k}</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{v || '—'}</div>
              </div>
            ))}
            {selected.remarks && (
              <div style={{ gridColumn: '1/-1', padding: '10px 14px', borderRadius: 10, background: '#fef3c7', border: '1px solid #fde68a' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#92400e', marginBottom: 3 }}>Remarks</div>
                <div style={{ fontSize: 13, color: '#78350f' }}>{selected.remarks}</div>
              </div>
            )}
            {selected.items?.length > 0 && (
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
    </div>
  )
}
