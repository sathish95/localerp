import { useEffect } from 'react'
import { X } from 'lucide-react'

// Shared building blocks for NeoX Email Intelligence screens (page + configuration centre).

export function Drawer({ title, subtitle, onClose, footer, children, wide }) {
  useEffect(() => { const h = e => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [onClose])
  return (
    <div className="drawer-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`drawer-panel eic-drawer${wide ? ' wide' : ''}`}>
        <div className="modal-header"><span style={{ minWidth: 0 }}><span className="eic-drawer-title">{title}</span>{subtitle && <span className="eic-drawer-sub">{subtitle}</span>}</span><button className="close-btn" onClick={onClose}><X size={14} /></button></div>
        <div className="modal-body eic-drawer-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

export function Stats({ items }) {
  return <div className="eic-stats">{items.map(([label, value, tone]) => <div key={label} className={`eic-stat ${tone || ''}`}><div className="eic-stat-v">{value ?? '—'}</div><div className="eic-stat-l">{label}</div></div>)}</div>
}

export function Seg({ value, onChange, options }) {
  return <div className="gl-seg">{options.map(([k, l, n]) => <button key={k} type="button" className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}{n != null && n !== 0 && <span className="gl-st-n">{n}</span>}</button>)}</div>
}

export function Group({ title, hint, children }) {
  return <section className="eic-fgroup"><div className="eic-fgroup-h">{title}{hint && <span>{hint}</span>}</div>{children}</section>
}

export function Field({ label, children }) {
  return <div className="eic-kv"><dt>{label}</dt><dd>{children ?? <span className="gl-st-zero">—</span>}</dd></div>
}

export function SectionHead({ title, desc, actions }) {
  return <div className="eic-sec-head eic-sec-row"><div><h2>{title}</h2>{desc && <p>{desc}</p>}</div>{actions && <div className="eic-sec-actions">{actions}</div>}</div>
}

export function EmptyState({ icon: Icon, title, children }) {
  return <div className="eic-emptystate">{Icon && <Icon size={26} />}<b>{title}</b>{children && <span>{children}</span>}</div>
}

const MIN = 60000, HOUR = 3600000, DAY = 86400000
export function ago(t) {
  if (!t) return '—'
  const d = Date.now() - new Date(t).getTime()
  if (d < MIN) return 'just now'
  if (d < HOUR) return `${Math.floor(d / MIN)} min ago`
  if (d < DAY) return `${Math.floor(d / HOUR)} h ago`
  if (d < 7 * DAY) return `${Math.floor(d / DAY)} d ago`
  return new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}
export const fullTime = t => (t ? new Date(t).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—')
export const initials = n => (n || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
export const pct = v => (v == null ? '—' : `${Math.round(Number(v) * 100)}%`)
export const PRIO_COLOR = { critical: '#dc2626', high: '#ea580c', medium: '#6366f1', low: '#94a3b8' }
export function Prio({ p }) { return <span className="eic-prio"><span style={{ background: PRIO_COLOR[p] || '#94a3b8' }} />{p}</span> }
export function ConfBar({ v }) {
  const n = Math.round(Number(v || 0) * 100)
  return <span className="eic-conf"><span><span style={{ width: `${n}%`, background: n >= 80 ? '#16a34a' : n >= 60 ? '#f59e0b' : '#dc2626' }} /></span>{n}%</span>
}

// The AI's pipeline for one document: each step, its outcome and confidence.
export function DecisionTrace({ steps }) {
  return (
    <ol className="eic-trace">
      {steps.map((s, i) => (
        <li key={i} className={s.state}>
          <span className="eic-trace-dot" />
          <div className="eic-trace-body"><b>{s.label}</b><span>{s.detail}</span></div>
          {s.conf != null && <span className="eic-trace-conf">{Math.round(Number(s.conf) * 100)}%</span>}
        </li>
      ))}
    </ol>
  )
}

export function AiSuggestion({ children }) {
  return <div className="eic-ai-sug"><span className="eic-ai-badge">AI suggestion</span><div>{children}</div></div>
}
