import { useState, useEffect } from 'react'
import { supabase, rupee, dateFmt } from '../lib/supabase'
import { Loader, Empty, SearchBox } from '../components/ui'
import { Wallet } from 'lucide-react'

export default function PaymentsPage() {
  const [payments, setPayments] = useState([])
  const [vendorInvoices, setVendorInvoices] = useState({})
  const [customerInvoices, setCustomerInvoices] = useState({})
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [p, vi, ci] = await Promise.all([
      supabase.from('payments').select('*,recorder:profiles!recorded_by(full_name)').order('payment_date', { ascending: false }),
      supabase.from('invoices').select('id,invoice_number,vendor_name,vendor:vendors(name),project:projects(name)'),
      supabase.from('customer_invoices').select('id,invoice_number,project:projects(name),customer:customers(name)'),
    ])
    setPayments(p.data || [])
    setVendorInvoices(Object.fromEntries((vi.data || []).map(i => [i.id, i])))
    setCustomerInvoices(Object.fromEntries((ci.data || []).map(i => [i.id, i])))
    setLoading(false)
  }

  function invoiceFor(p) {
    return p.invoice_type === 'vendor' ? vendorInvoices[p.invoice_id] : customerInvoices[p.invoice_id]
  }

  const filtered = payments.filter(p => {
    const mt = typeFilter === 'all' || p.invoice_type === typeFilter
    const inv = invoiceFor(p)
    const label = inv ? `${inv.invoice_number} ${inv.vendor?.name || inv.vendor_name || ''} ${inv.customer?.name || ''} ${inv.project?.name || ''}` : ''
    const ms = !search || label.toLowerCase().includes(search.toLowerCase())
    return mt && ms
  })

  const totalVendor = payments.filter(p => p.invoice_type === 'vendor').reduce((s, p) => s + Number(p.amount || 0), 0)
  const totalCustomer = payments.filter(p => p.invoice_type === 'customer').reduce((s, p) => s + Number(p.amount || 0), 0)

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Payments</div>
          <div className="page-subtitle">Payment ledger across vendor payables & customer receivables</div>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {[
          { label: 'Total Payments', value: payments.length, color: '#6366f1' },
          { label: 'Paid to Vendors', value: rupee(totalVendor), color: '#ef4444' },
          { label: 'Received from Customers', value: rupee(totalCustomer), color: '#10b981' },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {['all', 'vendor', 'customer'].map(t => (
          <button key={t} onClick={() => setTypeFilter(t)} style={{ padding: '6px 16px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12, background: typeFilter === t ? '#6366f1' : '#f1f5f9', color: typeFilter === t ? '#fff' : '#475569', textTransform: 'capitalize' }}>
            {t === 'all' ? 'All' : t === 'vendor' ? 'Vendor (Payable)' : 'Customer (Receivable)'}
          </button>
        ))}
      </div>

      <div className="table-wrap">
        <div className="table-toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Search invoice, vendor, customer, project…" />
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{filtered.length} payments</span>
        </div>
        {filtered.length === 0 ? (
          <Empty icon={<Wallet size={40} />} title="No payments found" desc="Record a payment from an invoice's detail view" />
        ) : (
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Invoice</th><th>Party</th><th>Amount</th><th>Method</th><th>Reference</th><th>Recorded By</th></tr></thead>
            <tbody>
              {filtered.map(p => {
                const inv = invoiceFor(p)
                return (
                  <tr key={p.id}>
                    <td>{dateFmt(p.payment_date)}</td>
                    <td>
                      <span style={{ padding: '2px 9px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: p.invoice_type === 'vendor' ? '#fee2e2' : '#dcfce7', color: p.invoice_type === 'vendor' ? '#dc2626' : '#15803d', textTransform: 'capitalize' }}>{p.invoice_type}</span>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: '#6366f1' }}>{inv?.invoice_number || '—'}</td>
                    <td>{inv?.vendor?.name || inv?.vendor_name || inv?.customer?.name || inv?.project?.name || '—'}</td>
                    <td style={{ fontWeight: 700, color: p.invoice_type === 'vendor' ? '#dc2626' : '#15803d' }}>{p.invoice_type === 'vendor' ? '-' : '+'}{rupee(p.amount)}</td>
                    <td style={{ textTransform: 'capitalize', fontSize: 12 }}>{p.payment_method?.replace('_', ' ') || '—'}</td>
                    <td style={{ fontSize: 12, color: '#64748b' }}>{p.reference_number || '—'}</td>
                    <td style={{ fontSize: 12, color: '#64748b' }}>{p.recorder?.full_name || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
