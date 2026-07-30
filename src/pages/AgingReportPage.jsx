import { useState, useEffect } from 'react'
import { rupee, dateFmt } from '../lib/supabase'
import { getAgingBuckets } from '../lib/aging'
import { Loader, Empty, StatusBadge } from '../components/ui'
import { History, AlertTriangle } from 'lucide-react'

// overdue buckets get escalating warm colors as they age
function colorFor(label, index, total) {
  if (label === 'current') return '#10b981'
  const t = (index - 1) / Math.max(1, total - 2)
  if (t < 0.34) return '#f59e0b'
  if (t < 0.67) return '#f97316'
  return '#ef4444'
}

export default function AgingReportPage() {
  const [type, setType] = useState('vendor')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedBucket, setSelectedBucket] = useState('current')

  useEffect(() => { load() }, [type])

  async function load() {
    setLoading(true)
    const result = await getAgingBuckets(type)
    setData(result)
    setSelectedBucket('current')
    setLoading(false)
  }

  if (loading || !data) return <Loader />

  const { buckets, labels } = data
  const grandTotal = labels.reduce((s, l) => s + buckets[l].reduce((s2, r) => s2 + Number(r.total_amount || 0), 0), 0)
  const overdueTotal = labels.filter(l => l !== 'current').reduce((s, l) => s + buckets[l].reduce((s2, r) => s2 + Number(r.total_amount || 0), 0), 0)

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Aging Report</div>
          <div className="page-subtitle">Outstanding {type === 'vendor' ? 'vendor payables' : 'customer receivables'}, bucketed by days overdue</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['vendor', 'customer'].map(t => (
          <button key={t} onClick={() => setType(t)} style={{ padding: '8px 20px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: type === t ? '#6366f1' : '#f1f5f9', color: type === t ? '#fff' : '#475569' }}>
            {t === 'vendor' ? 'Vendor Payables (AP)' : 'Customer Receivables (AR)'}
          </button>
        ))}
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card"><div className="stat-value" style={{ color: '#6366f1' }}>{rupee(grandTotal)}</div><div className="stat-label">Total Outstanding</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: '#ef4444' }}>{rupee(overdueTotal)}</div><div className="stat-label">Overdue</div></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${labels.length},1fr)`, gap: 10, marginBottom: 20 }}>
        {labels.map((l, i) => {
          const rows = buckets[l]
          const total = rows.reduce((s, r) => s + Number(r.total_amount || 0), 0)
          const c = colorFor(l, i, labels.length)
          const active = selectedBucket === l
          return (
            <div key={l} onClick={() => setSelectedBucket(l)} style={{ cursor: 'pointer', background: active ? `${c}12` : '#fff', border: `1.5px solid ${active ? c : '#e2e8f0'}`, borderTop: `4px solid ${c}`, borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>{l === 'current' ? 'Current' : `${l} days`}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: c }}>{rupee(total)}</div>
              <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2 }}>{rows.length} invoice{rows.length !== 1 ? 's' : ''}</div>
            </div>
          )
        })}
      </div>

      <div className="table-wrap">
        <div className="table-toolbar">
          <span style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            {selectedBucket !== 'current' && <AlertTriangle size={14} style={{ color: '#ef4444' }} />}
            {selectedBucket === 'current' ? 'Current (not yet due)' : `${selectedBucket} days overdue`}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{buckets[selectedBucket].length} records</span>
        </div>
        {buckets[selectedBucket].length === 0 ? (
          <Empty icon={<History size={40} />} title="Nothing in this bucket" desc="No invoices fall into this range" />
        ) : (
          <table>
            <thead><tr><th>Invoice #</th><th>{type === 'vendor' ? 'Vendor' : 'Customer / Project'}</th><th>Due Date</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {buckets[selectedBucket].map(r => (
                <tr key={r.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: 'var(--c1)' }}>{r.invoice_number}</td>
                  <td className="td-bold">{r.party}</td>
                  <td>{dateFmt(r.due_date)}</td>
                  <td style={{ fontWeight: 700 }}>{rupee(r.total_amount)}</td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
