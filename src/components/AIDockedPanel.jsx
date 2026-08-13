import { X } from 'lucide-react'

// Right-docked AI panel embedded directly in a module page (BOM
// Management, Products, Tasks, Invoices, Delivery Notes) — the
// alternative entry point to the AskBubble.jsx floating popover.
// Clicking a capability bubble now navigates here (?ai=1, see each
// page) instead of opening a small popover disconnected from the
// page's real data: the user already sees the actual records on the
// page and chats alongside them, and can fire another prompt
// immediately via AIChatFlow's own "New Request" button without
// re-opening anything.
export default function AIDockedPanel({ title, subtitle, open, onClose, children }) {
  if (!open) return null
  return (
    <div style={{
      position: 'fixed', top: 'var(--topbar-h)', right: 0, bottom: 0, width: 400, maxWidth: '92vw',
      background: 'var(--surface)', borderLeft: '1px solid var(--border)', boxShadow: '-8px 0 30px rgba(0,0,0,.12)',
      zIndex: 10000, display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        padding: '16px 18px', background: 'linear-gradient(135deg, var(--c1), #8b5cf6)', color: '#fff',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(255,255,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 15 }}>✨</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14.5 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, opacity: .85 }}>{subtitle}</div>}
        </div>
        <button onClick={onClose} title="Close AI panel" style={{ background: 'rgba(255,255,255,.15)', border: 'none', borderRadius: 8, cursor: 'pointer', color: '#fff', width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <X size={13} />
        </button>
      </div>
      <div className="askbubble-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 18px' }}>
        {children}
      </div>
    </div>
  )
}
