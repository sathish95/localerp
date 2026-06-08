import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Loader, Empty } from '../components/ui'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from 'recharts'
import { TrendingUp, TrendingDown, DollarSign, Clock, CheckCircle, PauseCircle } from 'lucide-react'

const rupee = v => v > 0 ? '₹' + Number(v).toLocaleString('en-IN') : '₹0'

export default function FundFlowPage() {
  const [vendors, setVendors] = useState([])
  const [invoices, setInvoices] = useState([])
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeVendor, setActiveVendor] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [v, inv, exp] = await Promise.all([
      supabase.from('vendors').select('id, name, category').eq('status', 'active'),
      supabase.from('invoices').select('vendor_id, total_amount, status'),
      supabase.from('expense_requests').select('total_amount, status'),
    ])
    setVendors(v.data || [])
    setInvoices(inv.data || [])
    setExpenses(exp.data || [])
    setLoading(false)
  }

  if (loading) return <Loader />

  const vendorFlow = vendors.map(v => {
    const vInv = invoices.filter(i => i.vendor_id === v.id)
    const paid        = vInv.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total_amount || 0), 0)
    const processing  = vInv.filter(i => ['processing','verified','matched'].includes(i.status)).reduce((s, i) => s + (i.total_amount || 0), 0)
    const uploaded    = vInv.filter(i => i.status === 'uploaded').reduce((s, i) => s + (i.total_amount || 0), 0)
    const rejected    = vInv.filter(i => i.status === 'rejected').reduce((s, i) => s + (i.total_amount || 0), 0)
    const total       = paid + processing + uploaded + rejected
    return { ...v, paid, processing, uploaded, rejected, total, count: vInv.length }
  }).sort((a, b) => b.total - a.total)

  const topVendors = vendorFlow.filter(v => v.count > 0).slice(0, 10)

  const totals = {
    paid:       invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total_amount || 0), 0),
    processing: invoices.filter(i => ['processing','verified','matched'].includes(i.status)).reduce((s, i) => s + (i.total_amount || 0), 0),
    uploaded:   invoices.filter(i => i.status === 'uploaded').reduce((s, i) => s + (i.total_amount || 0), 0),
    rejected:   invoices.filter(i => i.status === 'rejected').reduce((s, i) => s + (i.total_amount || 0), 0),
  }
  const grandTotal = Object.values(totals).reduce((s, v) => s + v, 0)

  const expApproved = expenses.filter(e => e.status === 'approved').reduce((s, e) => s + (e.total_amount || 0), 0)
  const expPending  = expenses.filter(e => e.status === 'submitted').reduce((s, e) => s + (e.total_amount || 0), 0)
  const expDraft    = expenses.filter(e => e.status === 'draft').reduce((s, e) => s + (e.total_amount || 0), 0)

  const pieData = [
    { name: 'Paid', value: totals.paid, color: '#10b981' },
    { name: 'Processing', value: totals.processing, color: '#3b82f6' },
    { name: 'Pending', value: totals.uploaded, color: '#f59e0b' },
    { name: 'Rejected', value: totals.rejected, color: '#ef4444' },
  ].filter(d => d.value > 0)

  const barData = topVendors.map(v => ({
    name: v.name?.slice(0, 10) + (v.name?.length > 10 ? '…' : ''),
    Paid: v.paid, Processing: v.processing, Pending: v.uploaded, Rejected: v.rejected
  }))

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Fund Flow</div>
          <div className="page-subtitle">Vendor-wise financial flow and invoice payment tracking</div>
        </div>
      </div>

      {/* KPI Banner */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total Invoiced', value: rupee(grandTotal), color: '#6366f1', icon: <DollarSign size={18} />, sub: `${invoices.length} invoices` },
          { label: 'Paid Out', value: rupee(totals.paid), color: '#10b981', icon: <CheckCircle size={18} />, sub: `${invoices.filter(i=>i.status==='paid').length} invoices` },
          { label: 'In Processing', value: rupee(totals.processing), color: '#3b82f6', icon: <Clock size={18} />, sub: 'Verified / Matched' },
          { label: 'Pending Review', value: rupee(totals.uploaded), color: '#f59e0b', icon: <PauseCircle size={18} />, sub: 'Awaiting action' },
          { label: 'Exp. Approved', value: rupee(expApproved), color: '#059669', icon: <TrendingUp size={18} />, sub: 'Released' },
          { label: 'Exp. Pending', value: rupee(expPending), color: '#ec4899', icon: <TrendingDown size={18} />, sub: 'Awaiting approval' },
        ].map(s => (
          <div key={s.label} style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', border: `1.5px solid ${s.color}20`, borderLeft: `4px solid ${s.color}`, boxShadow: '0 1px 4px rgba(0,0,0,.05)' }}>
            <div style={{ color: s.color, marginBottom: 6 }}>{s.icon}</div>
            <div style={{ fontSize: typeof s.value === 'string' && s.value.length > 8 ? 16 : 20, fontWeight: 800, color: s.color, lineHeight: 1.1 }}>{s.value}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', marginTop: 4 }}>{s.label}</div>
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 20 }}>
        {/* Bar chart */}
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e2e8f0', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Vendor-wise Fund Flow</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>Top {topVendors.length} vendors</div>
          </div>
          <div style={{ padding: '16px 20px' }}>
            {barData.length === 0 ? (
              <Empty icon="💸" title="No data yet" desc="Add vendors and invoices to see fund flow" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={barData} barSize={12} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} axisLine={false} tickLine={false} />
                  <Tooltip formatter={v => [rupee(v)]} contentStyle={{ borderRadius: 10, fontSize: 12, border: '1px solid #e2e8f0' }} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Paid" fill="#10b981" radius={[3,3,0,0]} />
                  <Bar dataKey="Processing" fill="#3b82f6" radius={[3,3,0,0]} />
                  <Bar dataKey="Pending" fill="#f59e0b" radius={[3,3,0,0]} />
                  <Bar dataKey="Rejected" fill="#ef4444" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Pie chart */}
        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e2e8f0', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Payment Breakdown</div>
          </div>
          <div style={{ padding: '16px 20px' }}>
            {pieData.length === 0 ? (
              <Empty icon="🥧" title="No data" desc="Invoice data needed" />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={3}>
                      {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip formatter={v => [rupee(v)]} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {pieData.map(d => (
                    <div key={d.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: d.color }} />
                        <span style={{ color: '#475569' }}>{d.name}</span>
                      </div>
                      <span style={{ fontWeight: 700, color: d.color }}>{rupee(d.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Vendor Table */}
      <div className="table-wrap">
        <div className="table-toolbar">
          <span style={{ fontWeight: 700, fontSize: 14 }}>Detailed Vendor Fund Flow</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{vendorFlow.length} vendors</span>
        </div>
        {vendorFlow.length === 0 ? (
          <Empty icon="🏪" title="No vendors" desc="Add vendors and link invoices to see flow" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Vendor</th>
                <th>Category</th>
                <th style={{ color: '#10b981' }}>Paid ✅</th>
                <th style={{ color: '#3b82f6' }}>Processing 🔄</th>
                <th style={{ color: '#f59e0b' }}>Pending ⏳</th>
                <th style={{ color: '#ef4444' }}>Rejected ❌</th>
                <th>Total</th>
                <th style={{ minWidth: 120 }}>Flow</th>
              </tr>
            </thead>
            <tbody>
              {vendorFlow.map((v, i) => {
                const total = v.paid + v.processing + v.uploaded + v.rejected
                return (
                  <tr key={v.id} style={{ cursor: 'pointer', background: activeVendor === v.id ? '#f8fafc' : 'transparent' }}
                    onClick={() => setActiveVendor(activeVendor === v.id ? null : v.id)}>
                    <td style={{ fontWeight: 700, color: '#94a3b8', width: 32 }}>{i + 1}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: `hsl(${(i * 47) % 360},70%,94%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, color: `hsl(${(i * 47) % 360},60%,40%)`, flexShrink: 0 }}>
                          {v.name?.[0]}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{v.name}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>{v.count} invoice{v.count !== 1 ? 's' : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td><span className="badge badge-info" style={{ fontSize: 11 }}>{v.category || '—'}</span></td>
                    <td style={{ fontWeight: 700, color: '#10b981', fontSize: 13 }}>{rupee(v.paid)}</td>
                    <td style={{ fontWeight: 700, color: '#3b82f6', fontSize: 13 }}>{rupee(v.processing)}</td>
                    <td style={{ fontWeight: 700, color: '#f59e0b', fontSize: 13 }}>{rupee(v.uploaded)}</td>
                    <td style={{ fontWeight: 700, color: '#ef4444', fontSize: 13 }}>{rupee(v.rejected)}</td>
                    <td style={{ fontWeight: 800, fontSize: 14 }}>{rupee(total)}</td>
                    <td>
                      {total > 0 ? (
                        <div style={{ display: 'flex', height: 8, borderRadius: 99, overflow: 'hidden', gap: 1 }}>
                          {[['paid','#10b981'],['processing','#3b82f6'],['uploaded','#f59e0b'],['rejected','#ef4444']].map(([k, c]) => v[k] > 0 && (
                            <div key={k} style={{ flex: v[k], background: c, minWidth: 3 }} title={`${k}: ${rupee(v[k])}`} />
                          ))}
                        </div>
                      ) : <span style={{ color: '#e2e8f0', fontSize: 12 }}>—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Expense flow summary */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e2e8f0', padding: '20px', marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Expense Reimbursement Flow</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
          {[
            { label: 'Released (Approved)', value: rupee(expApproved), color: '#10b981', desc: 'Funds approved for reimbursement', icon: '✅' },
            { label: 'Awaiting Approval', value: rupee(expPending), color: '#f59e0b', desc: 'Submitted, not yet approved', icon: '⏳' },
            { label: 'Draft / Not Submitted', value: rupee(expDraft), color: '#94a3b8', desc: 'Not yet submitted', icon: '📝' },
          ].map(s => (
            <div key={s.label} style={{ padding: '16px', borderRadius: 12, background: `${s.color}08`, border: `1.5px solid ${s.color}20` }}>
              <div style={{ fontSize: 20, marginBottom: 8 }}>{s.icon}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginTop: 4 }}>{s.label}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{s.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
