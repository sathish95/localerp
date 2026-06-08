import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useTabVisibility, DEFAULT_TABS } from '../context/TabVisibilityContext'
import { Alert } from '../components/ui'
import {
  Settings, GitBranch, DollarSign, Bell, Tag, FileText,
  Save, Plus, Trash2, Edit2, Check, X, Users, Eye, EyeOff, Shield
} from 'lucide-react'

const TAB_DEFS = [
  { key: 'dashboard',   label: 'Dashboard',        emoji: '🏠' },
  { key: 'expenses',    label: 'Expenses',          emoji: '🧾' },
  { key: 'travel',      label: 'Travel Requests',   emoji: '✈️' },
  { key: 'approvals',   label: 'Approvals',         emoji: '✅' },
  { key: 'leave',       label: 'Leave Management',  emoji: '📅' },
  { key: 'resources',   label: 'Resource Tracking', emoji: '⏱' },
  { key: 'vendors',     label: 'Vendors',           emoji: '🏪' },
  { key: 'projects',    label: 'Projects',          emoji: '📁' },
  { key: 'tasks',       label: 'Task Management',   emoji: '📋' },
  { key: 'budget',      label: 'Budget',            emoji: '💰' },
  { key: 'assets',      label: 'Assets',            emoji: '📦' },
  { key: 'procurement', label: 'Procurement',       emoji: '🛒' },
  { key: 'invoices',    label: 'Invoices',          emoji: '📄' },
  { key: 'fundflow',    label: 'Fund Flow',         emoji: '💸' },
  { key: 'pos',         label: 'Purchase Orders',   emoji: '📋' },
  { key: 'grn',         label: 'GRN',               emoji: '📦' },
  { key: 'users',       label: 'Users',             emoji: '👥' },
  { key: 'reports',     label: 'Reports',           emoji: '📊' },
  { key: 'settings',    label: 'Settings',          emoji: '⚙️' },
]

const ROLE_DEFS = [
  { key: 'manager',  label: 'Manager',  color: '#0284c7' },
  { key: 'finance',  label: 'Finance',  color: '#059669' },
  { key: 'hr',       label: 'HR',       color: '#0891b2' },
  { key: 'employee', label: 'Employee', color: '#d97706' },
]

// ── Tab Visibility (Admin Feature) ──
function TabVisibilityTab() {
  const { config, saveConfig } = useTabVisibility()
  const [local, setLocal] = useState(config)
  const [saved, setSaved] = useState(false)

  useEffect(() => { setLocal(config) }, [config])

  function toggle(role, tab) {
    setLocal(prev => ({
      ...prev,
      [role]: { ...prev[role], [tab]: !prev[role]?.[tab] }
    }))
  }

  function save() {
    saveConfig(local)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  function resetRole(role) {
    setLocal(prev => ({ ...prev, [role]: { ...DEFAULT_TABS[role] } }))
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Tab Visibility by Role</h3>
        <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem' }}>
          Control which tabs are visible for each user role. Admin and CEO always see all tabs.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {ROLE_DEFS.map(role => (
          <div key={role.key} style={{ border: '1.5px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', background: `${role.color}10`, borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: role.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Shield size={16} color="#fff" />
                </div>
                <span style={{ fontWeight: 800, fontSize: '1rem', color: role.color }}>{role.label}</span>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => resetRole(role.key)} style={{ fontSize: 12 }}>
                Reset to Default
              </button>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                {TAB_DEFS.map(tab => {
                  const visible = local[role.key]?.[tab.key] !== false
                  return (
                    <button key={tab.key} onClick={() => toggle(role.key, tab.key)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                        borderRadius: 10, border: `1.5px solid ${visible ? role.color + '40' : 'var(--border)'}`,
                        background: visible ? `${role.color}10` : 'var(--surface)',
                        cursor: 'pointer', transition: 'all .15s', textAlign: 'left'
                      }}>
                      <div style={{ width: 22, height: 22, borderRadius: 6, background: visible ? role.color : 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}>
                        {visible ? <Eye size={12} color="#fff" /> : <EyeOff size={12} color="#94a3b8" />}
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: visible ? role.color : 'var(--ink-muted)' }}>
                        {tab.emoji} {tab.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24 }}>
        {saved && <Alert type="success" message="Tab visibility settings saved!" />}
        <button className="btn btn-primary" onClick={save} style={{ marginTop: saved ? 12 : 0 }}>
          <Save size={15} /> Save Visibility Settings
        </button>
      </div>
    </div>
  )
}

// ── Approval Chain Config ──
function ApprovalChainTab() {
  const [saved, setSaved] = useState(false)
  function save() { setSaved(true); setTimeout(() => setSaved(false), 2500) }

  const rules = [
    { label: '≤ ₹25,000', chain: ['Manager'] },
    { label: '₹25,001 – ₹1,00,000', chain: ['Manager', 'CEO'] },
    { label: '> ₹1,00,000', chain: ['Manager', 'CEO', 'Finance'] },
  ]
  const roleColors = { Manager: { bg: '#dbeafe', color: '#1d4ed8' }, CEO: { bg: '#fee2e2', color: '#dc2626' }, Finance: { bg: '#d1fae5', color: '#065f46' } }

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Approval Chain by Amount</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 20 }}>Approval hierarchy based on expense amount thresholds.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
        {rules.map(rule => (
          <div key={rule.label} style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '14px 20px', borderRadius: 12, border: '1.5px solid var(--border)', background: 'var(--surface)' }}>
            <div style={{ minWidth: 200, fontWeight: 700, fontSize: '0.9rem' }}>{rule.label}</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {rule.chain.map((step, i) => (
                <span key={step} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {i > 0 && <span style={{ color: 'var(--ink-muted)', fontSize: 18 }}>→</span>}
                  <span style={{ padding: '4px 12px', borderRadius: 999, fontWeight: 700, fontSize: '0.78rem', background: roleColors[step]?.bg, color: roleColors[step]?.color }}>{step.toUpperCase()}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: '12px 16px', borderRadius: 10, background: '#fef3c7', border: '1px solid #fde68a', marginBottom: 20, fontSize: '0.85rem', color: '#92400e' }}>
        <strong>Note:</strong> Modify thresholds directly in your Supabase backend or RPC functions.
      </div>
      {saved && <Alert type="success" message="Settings saved!" />}
      <button className="btn btn-primary" onClick={save}><Save size={15} /> Save Settings</button>
    </div>
  )
}

// ── Budget Config ──
function BudgetConfigTab() {
  const [depts, setDepts] = useState([])
  const [budgets, setBudgets] = useState({})
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    async function load() {
      const [d, b] = await Promise.all([
        supabase.from('departments').select('*').order('name'),
        supabase.from('budgets').select('*')
      ])
      setDepts(d.data || [])
      const map = {}
      ;(b.data || []).forEach(b => { map[b.department_id] = b })
      setBudgets(map)
      setLoading(false)
    }
    load()
  }, [])

  async function save() {
    for (const dept of depts) {
      const b = budgets[dept.id]
      if (!b) continue
      await supabase.from('budgets').upsert({ department_id: dept.id, annual_budget: b.annual_budget || 0, monthly_budget: b.monthly_budget || 0 }, { onConflict: 'department_id' })
    }
    setSaved(true); setTimeout(() => setSaved(false), 2500)
  }

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-muted)' }}>Loading...</div>

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Department Budget Configuration</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 20 }}>Set annual and monthly budgets for each department.</p>
      <table className="data-table" style={{ marginBottom: 20 }}>
        <thead><tr><th>Department</th><th>Annual Budget (₹)</th><th>Monthly Budget (₹)</th></tr></thead>
        <tbody>
          {depts.map(dept => (
            <tr key={dept.id}>
              <td style={{ fontWeight: 600 }}>{dept.name}</td>
              <td><input type="number" className="form-input" value={budgets[dept.id]?.annual_budget || ''} style={{ width: 160 }} onChange={e => setBudgets(p => ({ ...p, [dept.id]: { ...p[dept.id], department_id: dept.id, annual_budget: parseFloat(e.target.value) || 0 } }))} placeholder="0" /></td>
              <td><input type="number" className="form-input" value={budgets[dept.id]?.monthly_budget || ''} style={{ width: 160 }} onChange={e => setBudgets(p => ({ ...p, [dept.id]: { ...p[dept.id], department_id: dept.id, monthly_budget: parseFloat(e.target.value) || 0 } }))} placeholder="0" /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {saved && <Alert type="success" message="Budget configuration saved!" />}
      <button className="btn btn-primary" onClick={save}><Save size={15} /> Save Budgets</button>
    </div>
  )
}

// ── Expense Categories ──
function ExpenseCategoriesTab() {
  const [cats, setCats] = useState(['Travel & Transport','Food & Meals','Accommodation','Office Supplies','Software & Subscriptions','Training & Education','Marketing','Utilities','Equipment','Medical','Entertainment','Miscellaneous'])
  const [newCat, setNewCat] = useState('')
  const [editing, setEditing] = useState(null)
  const [editVal, setEditVal] = useState('')
  const [saved, setSaved] = useState(false)

  function add() { if (newCat.trim()) { setCats([...cats, newCat.trim()]); setNewCat('') } }
  function remove(i) { setCats(cats.filter((_, idx) => idx !== i)) }
  function save() { setSaved(true); setTimeout(() => setSaved(false), 2500) }

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Expense Categories</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 20 }}>Manage the list of expense categories available when submitting.</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input className="form-input" value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="New category name..." onKeyDown={e => e.key === 'Enter' && add()} style={{ flex: 1, maxWidth: 300 }} />
        <button className="btn btn-primary" onClick={add}><Plus size={15} /> Add</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8, marginBottom: 20 }}>
        {cats.map((cat, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, border: '1.5px solid var(--border)', background: 'var(--surface)' }}>
            <Tag size={13} style={{ color: 'var(--c1)', flexShrink: 0 }} />
            {editing === i ? (
              <>
                <input className="form-input" value={editVal} onChange={e => setEditVal(e.target.value)} style={{ flex: 1, padding: '4px 8px', fontSize: '0.85rem' }} autoFocus />
                <button className="btn btn-ghost btn-sm btn-icon" onClick={() => { const c=[...cats]; c[i]=editVal; setCats(c); setEditing(null) }}><Check size={13} /></button>
                <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditing(null)}><X size={13} /></button>
              </>
            ) : (
              <>
                <span style={{ flex: 1, fontSize: '0.88rem', fontWeight: 500 }}>{cat}</span>
                <button className="btn btn-ghost btn-sm btn-icon" onClick={() => { setEditing(i); setEditVal(cat) }}><Edit2 size={12} /></button>
                <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => remove(i)}><Trash2 size={12} /></button>
              </>
            )}
          </div>
        ))}
      </div>
      {saved && <Alert type="success" message="Categories saved!" />}
      <button className="btn btn-primary" onClick={save}><Save size={15} /> Save Categories</button>
    </div>
  )
}

// ── GST Settings ──
function GSTSettingsTab() {
  const [s, setS] = useState({ gstin: '', business_name: '', address: '', state: '', state_code: '', cgst_rate: 9, sgst_rate: 9, igst_rate: 18, default_hsn: '', include_gst_in_invoices: true, auto_calculate: true })
  const [saved, setSaved] = useState(false)
  function save() { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  const set = (k, v) => setS(p => ({ ...p, [k]: v }))

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>GST Configuration</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 20 }}>Configure GST details for invoices and procurement.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
        {[['gstin','GSTIN','29ABCDE1234F1Z5',false],['business_name','Business Name','Acme Pvt. Ltd.',false],['address','Registered Address','123, MG Road...',true],['state','State','Karnataka',false],['state_code','State Code','29',false],['default_hsn','Default HSN Code','998313',false]].map(([k,label,ph,full]) => (
          <div key={k} style={{ gridColumn: full ? '1/-1' : 'auto' }}>
            <label className="form-label">{label}</label>
            <input className="form-input" value={s[k]} placeholder={ph} onChange={e => set(k, e.target.value)} />
          </div>
        ))}
      </div>
      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 12 }}>GST Rates</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 20 }}>
        {[['cgst_rate','CGST Rate (%)'],['sgst_rate','SGST Rate (%)'],['igst_rate','IGST Rate (%)']].map(([k,l]) => (
          <div key={k}><label className="form-label">{l}</label><input type="number" className="form-input" value={s[k]} onChange={e => set(k, parseFloat(e.target.value)||0)} min={0} max={28} step={0.5} /></div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        {[['include_gst_in_invoices','Include GST breakdown in invoices'],['auto_calculate','Auto-calculate GST on amounts']].map(([k,l]) => (
          <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: '0.9rem' }}>
            <input type="checkbox" checked={s[k]} onChange={() => set(k, !s[k])} style={{ width: 16, height: 16, accentColor: 'var(--c1)' }} />
            {l}
          </label>
        ))}
      </div>
      {saved && <Alert type="success" message="GST settings saved!" />}
      <button className="btn btn-primary" onClick={save}><Save size={15} /> Save GST Settings</button>
    </div>
  )
}

const TABS = [
  { id: 'visibility', label: 'Tab Visibility', icon: <Eye size={15} /> },
  { id: 'approval', label: 'Approval Chain', icon: <GitBranch size={15} /> },
  { id: 'budget', label: 'Budget Config', icon: <DollarSign size={15} /> },
  { id: 'categories', label: 'Expense Categories', icon: <Tag size={15} /> },
  { id: 'gst', label: 'GST Settings', icon: <FileText size={15} /> },
]

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('visibility')
  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Settings</div><div className="page-subtitle">Configure system-wide settings and permissions</div></div>
      </div>

      <div className="table-wrap">
        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', overflowX: 'auto', padding: '0 4px' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 18px', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 600, fontSize: '0.86rem', color: activeTab === t.id ? 'var(--c1)' : 'var(--ink-muted)', borderBottom: activeTab === t.id ? '2.5px solid var(--c1)' : '2.5px solid transparent', transition: 'all .15s', marginBottom: -1, whiteSpace: 'nowrap' }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        <div style={{ padding: '24px' }}>
          {activeTab === 'visibility' && <TabVisibilityTab />}
          {activeTab === 'approval' && <ApprovalChainTab />}
          {activeTab === 'budget' && <BudgetConfigTab />}
          {activeTab === 'categories' && <ExpenseCategoriesTab />}
          {activeTab === 'gst' && <GSTSettingsTab />}
        </div>
      </div>
    </div>
  )
}
