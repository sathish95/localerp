import { X, Search, ChevronRight } from 'lucide-react'

// ── Field Label with example tooltip ──
// A form-field label with a small "?" info dot — hover (or focus, for
// keyboard/touch users) shows an example value via the native title
// attribute, no custom tooltip JS needed. `example` is plain text like
// "e.g. ₹95/litre" or "e.g. 12 (as a %, not 0.12)".
export function FieldLabel({ children, example, style }) {
  return (
    <label style={{ ...style, display: 'flex', alignItems: 'center', gap: 5 }}>
      {children}
      {example && (
        <span tabIndex={0} title={example} aria-label={`Example: ${example}`} style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 14, height: 14, borderRadius: '50%', border: '1px solid currentColor',
          fontSize: 9.5, fontWeight: 700, color: 'var(--text-muted)', cursor: 'help', flexShrink: 0,
        }}>?</span>
      )}
    </label>
  )
}

// ── Loader ──
export function Loader() {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'80px 20px' }}>
      <div className="spinner" />
    </div>
  )
}

// ── Modal ──
export function Modal({ open, onClose, title, children, footer, size }) {
  if (!open) return null
  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal-box ${size === 'lg' ? 'lg' : ''}`}>
        <div className="modal-header">
          <span>{title}</span>
          <button className="close-btn" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

// ── Badge ──
export function Badge({ children, type = 'info' }) {
  return <span className={`badge badge-${type}`}>{children}</span>
}

// ── Status Badge ──
const STATUS_MAP = {
  draft:          { label: 'Draft',         bg: '#f1f5f9', color: '#475569' },
  submitted:      { label: 'Pending',       bg: '#fef3c7', color: '#b45309' },
  manager_review: { label: 'Mgr Review',    bg: '#dbeafe', color: '#1d4ed8' },
  dept_review:    { label: 'Dept Review',   bg: '#ede9fe', color: '#6d28d9' },
  ceo_review:     { label: 'CEO Review',    bg: '#fee2e2', color: '#dc2626' },
  finance_review: { label: 'Finance Review',bg: '#d1fae5', color: '#065f46' },
  procurement_lead_review: { label: 'Proc. Lead Review', bg: '#e0e7ff', color: '#4338ca' },
  pm_review:      { label: 'PM Review',     bg: '#dbeafe', color: '#1d4ed8' },
  cto_review:     { label: 'CTO Review',    bg: '#fce7f3', color: '#be185d' },
  approved:       { label: 'Approved',      bg: '#dcfce7', color: '#15803d' },
  rejected:       { label: 'Rejected',      bg: '#fee2e2', color: '#dc2626' },
  paid:           { label: 'Paid',          bg: '#dcfce7', color: '#15803d' },
  closed:         { label: 'Closed',        bg: '#f1f5f9', color: '#475569' },
  cancelled:      { label: 'Cancelled',     bg: '#f1f5f9', color: '#475569' },
  active:         { label: 'Active',        bg: '#dcfce7', color: '#15803d' },
  evaluation:     { label: 'Evaluation',     bg: '#fef3c7', color: '#b45309' },
  inactive:       { label: 'Inactive',      bg: '#fee2e2', color: '#dc2626' },
  blacklisted:    { label: 'Blacklisted',   bg: '#fee2e2', color: '#7f1d1d' },
  uploaded:       { label: 'Uploaded',      bg: '#ede9fe', color: '#6d28d9' },
  processing:     { label: 'Processing',    bg: '#fef3c7', color: '#b45309' },
  verified:       { label: 'Verified',      bg: '#dbeafe', color: '#1d4ed8' },
  matched:        { label: 'Matched',       bg: '#d1fae5', color: '#065f46' },
  partial:        { label: 'Partial',       bg: '#fef3c7', color: '#b45309' },
  purchased:      { label: 'Purchased',     bg: '#ede9fe', color: '#6d28d9' },
  assigned:       { label: 'Assigned',      bg: '#dcfce7', color: '#15803d' },
  returned:       { label: 'Returned',      bg: '#fef3c7', color: '#b45309' },
  scrap:          { label: 'Scrap',         bg: '#fee2e2', color: '#dc2626' },
  converted_to_po:{ label: 'Converted PO',  bg: '#d1fae5', color: '#065f46' },
  sent:           { label: 'Sent',          bg: '#dbeafe', color: '#1d4ed8' },
  acknowledged:   { label: 'Acknowledged',  bg: '#ede9fe', color: '#6d28d9' },
  delivered:      { label: 'Delivered',     bg: '#dcfce7', color: '#15803d' },
  requested:      { label: 'Requested',     bg: '#fef3c7', color: '#b45309' },
  completed:      { label: 'Completed',     bg: '#dbeafe', color: '#1d4ed8' },
  simulated:        { label: 'Simulated',        bg: '#dbeafe', color: '#1d4ed8' },
  under_review:     { label: 'Under Review',     bg: '#fef3c7', color: '#b45309' },
  changes_requested:{ label: 'Changes Requested',bg: '#fce7f3', color: '#be185d' },
  executed:         { label: 'Executed',         bg: '#dcfce7', color: '#15803d' },
  superseded:       { label: 'Superseded',       bg: '#f1f5f9', color: '#475569' },
  open:               { label: 'Open',              bg: '#fef3c7', color: '#b45309' },
  in_progress:        { label: 'In Progress',       bg: '#dbeafe', color: '#1d4ed8' },
  planned:            { label: 'Planned',           bg: '#f1f5f9', color: '#475569' },
  confirmed:          { label: 'Confirmed',         bg: '#e0e7ff', color: '#4338ca' },
  waiting_on_customer:{ label: 'Waiting on You',    bg: '#fce7f3', color: '#be185d' },
  resolved:           { label: 'Resolved',          bg: '#dcfce7', color: '#15803d' },
}

export function StatusBadge({ status }) {
  const cfg = STATUS_MAP[status] || { label: status || '—', bg: '#f1f5f9', color: '#475569' }
  return (
    <span className="status-badge" style={{ background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  )
}

// ── Stat Card ──
export function StatCard({ label, value, icon, accent = '#6366f1' }) {
  return (
    <div className="stat-card" style={{ borderTopColor: accent }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
        <div style={{ width:34, height:34, borderRadius:8, background:`${accent}15`, display:'flex', alignItems:'center', justifyContent:'center', color:accent }}>
          {icon}
        </div>
      </div>
      <div className="stat-value" style={{ color:accent }}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

// ── Alert ──
export function Alert({ type = 'info', message }) {
  return <div className={`alert alert-${type}`}>{message}</div>
}

// ── Confirm Dialog ──
export function Confirm({ open, message, danger, onConfirm, onCancel }) {
  if (!open) return null
  return (
    <div className="confirm-overlay">
      <div className="confirm-box">
        <div style={{ fontSize:16, fontWeight:700, marginBottom:8 }}>Confirm Action</div>
        <div style={{ fontSize:14, color:'var(--ink-muted)', marginBottom:24 }}>{message}</div>
        <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  )
}

// ── Search Box ──
export function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="search-box">
      <Search size={15} style={{ color:'var(--ink-muted)', flexShrink:0 }} />
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder || 'Search...'} />
    </div>
  )
}

// ── Empty State ──
export function Empty({ icon, title, desc }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      <div className="empty-desc">{desc}</div>
    </div>
  )
}

// ── Approval Chain ──
export function ApprovalChain({ steps = [], currentStep = 0 }) {
  return (
    <div className="approval-chain">
      {steps.map((step, i) => {
        const isDone = i < currentStep
        const isActive = i === currentStep
        const isRejected = step.cls === 'rejected'
        const cls = isRejected ? 'rejected' : isDone ? 'done' : isActive ? 'active' : 'pending'
        return (
          <div key={i} className="chain-step">
            {i > 0 && <div className="chain-line" />}
            <div title={step.label}>
              <div className={`chain-node ${cls}`}>
                {isDone ? '✓' : isRejected ? '✗' : step.label?.[0] || (i+1)}
              </div>
              {step.name && <div style={{ fontSize:10, color:'var(--ink-muted)', textAlign:'center', marginTop:2 }}>{step.name}</div>}
              <div style={{ fontSize:10, color:'var(--ink-muted)', textAlign:'center' }}>{step.label}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Progress ──
export function Progress({ value, max, color = 'var(--c1)' }) {
  const pct = Math.min(100, Math.round((value / max) * 100)) || 0
  return (
    <div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width:`${pct}%`, background:color }} />
      </div>
      <div style={{ display:'flex', justifyContent:'flex-end', fontSize:11, color:'var(--ink-muted)', marginTop:2 }}>{pct}%</div>
    </div>
  )
}

// ── Stepper (wizard progress) ──
// allowJumpAhead: false (default) matches the award wizard's needs —
// later steps depend on earlier ones actually being saved, so clicking
// ahead isn't safe. Pass true for a wizard like onboarding where every
// step is independently optional and skippable in any order.
//
// doneSteps: optional boolean[] (same length as `steps`) giving each
// step's REAL completion state. Without allowJumpAhead, "steps before
// the active one are done" is a safe assumption (that's how you got
// here) — but once a wizard allows skipping ahead, a skipped earlier
// step must not render a checkmark it hasn't earned. Omit it and the
// index-based fallback below is unchanged from before this prop existed.
export function Stepper({ steps = [], activeIndex = 0, onStepClick, allowJumpAhead = false, doneSteps }) {
  return (
    <div style={{ display:'flex', alignItems:'flex-start', marginBottom:28, overflowX:'auto' }}>
      {steps.map((label, i) => {
        const isDone = doneSteps ? !!doneSteps[i] : i < activeIndex
        const isActive = i === activeIndex
        const clickable = typeof onStepClick === 'function' && (allowJumpAhead || i <= activeIndex)
        return (
          <div key={label} style={{ display:'flex', alignItems:'flex-start', flex: i === steps.length - 1 ? '0 0 auto' : '1 1 auto' }}>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', minWidth:88, cursor: clickable ? 'pointer' : 'default' }}
              onClick={() => clickable && onStepClick(i)}>
              <div style={{
                width:30, height:30, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:13, fontWeight:700, flexShrink:0,
                background: isDone ? 'var(--c1)' : isActive ? 'var(--c1)' : 'var(--surface)',
                color: isDone || isActive ? '#fff' : 'var(--ink-muted)',
                border: isActive ? '2px solid var(--c1)' : '1px solid var(--border)',
              }}>
                {isDone ? '✓' : i + 1}
              </div>
              <div style={{ fontSize:11.5, fontWeight: isActive ? 700 : 500, color: isActive ? 'var(--c1)' : 'var(--ink-muted)', textAlign:'center', marginTop:6, maxWidth:100 }}>
                {label}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div style={{ height:2, flex:1, background: isDone ? 'var(--c1)' : 'var(--border)', marginTop:15, minWidth:24 }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Toggle (switch) ──
// Flat on/off switch — shared primitive for company-wide enable/disable
// style controls. Renders a real <input type=checkbox role=switch> for
// keyboard/AT support; the track + thumb are CSS (.switch in index.css).
export function Toggle({ checked, onChange, disabled, label }) {
  return (
    <label className="switch" title={label}>
      <input type="checkbox" role="switch" checked={!!checked} disabled={disabled}
        aria-label={label} onChange={e => onChange?.(e.target.checked)} />
      <span className="track" />
      <span className="thumb" />
    </label>
  )
}

// ── Tabs ──
export function Tabs({ tabs, active, onChange }) {
  return (
    <div style={{ display:'flex', gap:4, borderBottom:'1px solid var(--border)', marginBottom:20 }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{ padding:'10px 16px', border:'none', background:'transparent', cursor:'pointer', fontWeight:600, fontSize:13, color:active===t.id?'var(--c1)':'var(--ink-muted)', borderBottom:active===t.id?'2.5px solid var(--c1)':'2.5px solid transparent', marginBottom:-1, transition:'all .15s', display:'flex', alignItems:'center', gap:6 }}>
          {t.label} {t.count != null && <span style={{ background:active===t.id?'var(--c1)':'var(--surface)', color:active===t.id?'#fff':'var(--ink-muted)', borderRadius:999, padding:'1px 7px', fontSize:11 }}>{t.count}</span>}
        </button>
      ))}
    </div>
  )
}
