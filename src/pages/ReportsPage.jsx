import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Loader } from '../components/ui'
import { Download, FileSpreadsheet, CheckCircle, AlertCircle } from 'lucide-react'

const rupee = v => v != null ? '₹' + Number(v).toLocaleString('en-IN') : '—'
const fmt = d => d ? new Date(d).toLocaleDateString('en-IN') : '—'

const REPORTS = [
  {
    id: 'expenses', label: 'Expenses', emoji: '🧾',
    desc: 'All expense requests — title, amount, category, status, date',
    color: '#7c3aed', light: '#ede9fe',
    fetch: () => supabase.from('expense_requests').select('expense_number,title,category,amount,total_amount,status,expense_date,created_at').order('created_at',{ascending:false}),
    map: r => ({ 'Expense #': r.expense_number, Title: r.title, Category: r.category, Amount: r.amount, 'Total Amount': r.total_amount, Status: r.status, Date: fmt(r.expense_date), Submitted: fmt(r.created_at) })
  },
  {
    id: 'travel', label: 'Travel Requests', emoji: '✈️',
    desc: 'Travel requests — from/to, dates, mode, estimated cost, status',
    color: '#ec4899', light: '#fce7f3',
    fetch: () => supabase.from('travel_requests').select('request_number,from_location,to_location,travel_date,return_date,travel_mode,estimated_cost,status,created_at').order('created_at',{ascending:false}),
    map: r => ({ 'Request #': r.request_number, From: r.from_location, To: r.to_location, 'Travel Date': fmt(r.travel_date), 'Return Date': fmt(r.return_date), Mode: r.travel_mode, 'Est. Cost': r.estimated_cost, Status: r.status })
  },
  {
    id: 'vendors', label: 'Vendors', emoji: '🏪',
    desc: 'Vendor directory — name, category, GST, contact, status',
    color: '#0891b2', light: '#cffafe',
    fetch: () => supabase.from('vendors').select('name,code,category,gst_number,email,phone,city,status,created_at').order('name'),
    map: r => ({ Name: r.name, Code: r.code, Category: r.category, GST: r.gst_number, Email: r.email, Phone: r.phone, City: r.city, Status: r.status, Added: fmt(r.created_at) })
  },
  {
    id: 'invoices', label: 'Invoices', emoji: '📄',
    desc: 'Invoice register — number, vendor, amount, status, due date',
    color: '#d97706', light: '#fef3c7',
    fetch: () => supabase.from('invoices').select('invoice_number,vendor_name,subtotal,gst_amount,total_amount,status,invoice_date,due_date,created_at').order('created_at',{ascending:false}),
    map: r => ({ 'Invoice #': r.invoice_number, Vendor: r.vendor_name, Subtotal: r.subtotal, GST: r.gst_amount, Total: r.total_amount, Status: r.status, 'Invoice Date': fmt(r.invoice_date), 'Due Date': fmt(r.due_date) })
  },
  {
    id: 'procurement', label: 'Purchase Requisitions', emoji: '🛒',
    desc: 'PR register — title, category, amount, priority, status',
    color: '#dc2626', light: '#fee2e2',
    fetch: () => supabase.from('purchase_requisitions').select('pr_number,title,category,estimated_amount,priority,status,created_at').order('created_at',{ascending:false}),
    map: r => ({ 'PR #': r.pr_number, Title: r.title, Category: r.category, 'Est. Amount': r.estimated_amount, Priority: r.priority, Status: r.status, Date: fmt(r.created_at) })
  },
  {
    id: 'assets', label: 'Assets', emoji: '📦',
    desc: 'Asset register — code, name, category, value, status',
    color: '#059669', light: '#d1fae5',
    fetch: () => supabase.from('assets').select('asset_code,name,category,make,model,serial_number,purchase_value,purchase_date,status,location').order('name'),
    map: r => ({ Code: r.asset_code, Name: r.name, Category: r.category, Make: r.make, Model: r.model, Serial: r.serial_number, Value: r.purchase_value, 'Purchase Date': fmt(r.purchase_date), Status: r.status, Location: r.location })
  },
  {
    id: 'projects', label: 'Projects', emoji: '📁',
    desc: 'Project list — name, budget, spent, status, dates',
    color: '#6366f1', light: '#ede9fe',
    fetch: () => supabase.from('projects').select('code,name,budget,spent,status,start_date,end_date').order('name'),
    map: r => ({ Code: r.code, Name: r.name, Budget: r.budget, Spent: r.spent, Status: r.status, 'Start Date': fmt(r.start_date), 'End Date': fmt(r.end_date) })
  },
  {
    id: 'users', label: 'Users', emoji: '👥',
    desc: 'User directory — name, email, role, department',
    color: '#475569', light: '#f1f5f9',
    fetch: () => supabase.from('profiles').select('full_name,email,role,designation,phone,is_active,created_at').order('full_name'),
    map: r => ({ Name: r.full_name, Email: r.email, Role: r.role, Designation: r.designation, Phone: r.phone, Active: r.is_active ? 'Yes' : 'No', Joined: fmt(r.created_at) })
  },
]

function toCSV(rows) {
  if (!rows.length) return ''
  const keys = Object.keys(rows[0])
  const escape = v => { const s = String(v ?? ''); return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g,'""')}"` : s }
  return [keys.join(','), ...rows.map(r => keys.map(k => escape(r[k])).join(','))].join('\n')
}

function download(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function ReportsPage() {
  const [counts, setCounts] = useState({})
  const [exporting, setExporting] = useState(null)
  const [toast, setToast] = useState(null)
  const [loadingCounts, setLoadingCounts] = useState(true)

  useEffect(() => {
    async function loadCounts() {
      const res = {}
      await Promise.all(REPORTS.map(async r => {
        const { count } = await supabase.from(r.id === 'users' ? 'profiles' : r.id === 'procurement' ? 'purchase_requisitions' : r.id === 'travel' ? 'travel_requests' : r.id === 'expenses' ? 'expense_requests' : r.table || r.id)
          .select('*', { count: 'exact', head: true })
        res[r.id] = count || 0
      }))
      setCounts(res)
      setLoadingCounts(false)
    }
    loadCounts()
  }, [])

  async function handleExport(report) {
    setExporting(report.id)
    try {
      const { data, error } = await report.fetch()
      if (error) throw error
      if (!data?.length) { setToast({ type: 'warn', msg: `No data in ${report.label}` }); return }
      const rows = data.map(report.map)
      const csv = toCSV(rows)
      const date = new Date().toISOString().slice(0,10)
      download(csv, `thingsalive-neox-${report.id}-${date}.csv`)
      setToast({ type: 'ok', msg: `${report.label} exported — ${data.length} rows` })
    } catch (e) {
      setToast({ type: 'err', msg: e.message })
    } finally {
      setExporting(null)
      setTimeout(() => setToast(null), 3500)
    }
  }

  async function exportAll() {
    setExporting('all')
    const sheets = []
    for (const r of REPORTS) {
      const { data } = await r.fetch()
      if (data?.length) sheets.push({ name: r.label, rows: data.map(r.map) })
    }
    // Export as multiple CSVs zipped isn't possible in browser without a lib
    // Instead export a single multi-section CSV
    const lines = []
    sheets.forEach(s => {
      lines.push(`\n=== ${s.name.toUpperCase()} ===`)
      lines.push(toCSV(s.rows))
    })
    download(lines.join('\n'), `thingsalive-neox-full-export-${new Date().toISOString().slice(0,10)}.csv`)
    setExporting(null)
    setToast({ type: 'ok', msg: `Full export complete — ${sheets.length} modules` })
    setTimeout(() => setToast(null), 3500)
  }

  const totalRecords = Object.values(counts).reduce((s, v) => s + v, 0)

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 999, padding: '12px 20px', borderRadius: 12, background: toast.type === 'ok' ? '#10b981' : toast.type === 'warn' ? '#f59e0b' : '#ef4444', color: '#fff', fontWeight: 700, fontSize: 13, boxShadow: '0 8px 24px rgba(0,0,0,.15)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {toast.type === 'ok' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {toast.msg}
        </div>
      )}

      <div className="page-header">
        <div>
          <div className="page-title">Reports & Export</div>
          <div className="page-subtitle">{loadingCounts ? 'Loading…' : `${totalRecords.toLocaleString()} total records across ${REPORTS.length} modules`}</div>
        </div>
        <button className="btn btn-primary" onClick={exportAll} disabled={exporting === 'all'} style={{ gap: 8 }}>
          <Download size={15} /> {exporting === 'all' ? 'Exporting…' : 'Export All'}
        </button>
      </div>

      {/* Summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginBottom: 28 }}>
        {REPORTS.slice(0, 6).map(r => (
          <div key={r.id} style={{ background: '#fff', borderRadius: 12, padding: '12px 14px', border: `1.5px solid ${r.color}20`, borderTop: `3px solid ${r.color}` }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{r.emoji}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: r.color }}>{counts[r.id] ?? '—'}</div>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>{r.label}</div>
          </div>
        ))}
      </div>

      {/* Report cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
        {REPORTS.map(r => {
          const busy = exporting === r.id
          return (
            <div key={r.id} style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,.04)', transition: 'box-shadow .15s' }}>
              {/* Color bar */}
              <div style={{ height: 4, background: `linear-gradient(90deg,${r.color},${r.color}88)` }} />
              <div style={{ padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: r.light, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
                    {r.emoji}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>{r.label}</div>
                      <span style={{ fontWeight: 800, fontSize: 18, color: r.color }}>{counts[r.id] ?? '—'}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 3, lineHeight: 1.4 }}>{r.desc}</div>
                  </div>
                </div>

                <button onClick={() => handleExport(r)} disabled={busy || !!exporting}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 0', borderRadius: 10, border: `1.5px solid ${r.color}30`, background: busy ? r.color : r.light, color: busy ? '#fff' : r.color, fontWeight: 700, fontSize: 13, cursor: busy || exporting ? 'not-allowed' : 'pointer', opacity: exporting && !busy ? .5 : 1, transition: 'all .15s' }}>
                  {busy ? (
                    <><div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(255,255,255,.4)', borderTopColor: '#fff', animation: 'spin .7s linear infinite' }} /> Exporting…</>
                  ) : (
                    <><FileSpreadsheet size={14} /> Export CSV</>
                  )}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Help card */}
      <div style={{ marginTop: 20, background: 'linear-gradient(135deg,#f8fafc,#f1f5f9)', borderRadius: 16, padding: '20px 24px', border: '1.5px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ fontSize: 32 }}>💡</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>Export Tips</div>
          <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
            CSV files open in Excel, Google Sheets, or any spreadsheet tool. Use <strong>Export All</strong> to get a single file with all modules. Individual exports give you focused data per module.
          </div>
        </div>
      </div>
    </div>
  )
}
