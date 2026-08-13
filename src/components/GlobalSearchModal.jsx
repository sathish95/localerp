import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { globalSearch } from '../lib/globalSearch'
import { Search, X, User, Building2, Trophy, Target, FileBadge2, FolderOpen, ClipboardList, Truck, FileText, FileCheck, ShoppingCart, Radar } from 'lucide-react'

const CATEGORY_ICON = {
  Employees: User, Departments: Building2, Awards: Trophy, 'Performance Cycles': Target, Certificates: FileBadge2,
  Projects: FolderOpen, Tasks: ClipboardList, Customers: Building2, Vendors: Truck, Proposals: FileText,
  'Customer Invoices': FileCheck, 'Purchase Orders': ShoppingCart, Scenarios: Radar,
}

export default function GlobalSearchModal({ open, onClose }) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)

  // The modal's DOM (backdrop/box/input) unmounts entirely while closed
  // (see `if (!open) return null` below) and remounts fresh each time it
  // opens — so the input's own `autoFocus` below is the primary focus
  // mechanism (React applies it synchronously on insert, no race). This
  // timeout is just a fallback for the rare case a browser doesn't honor
  // autoFocus inside a just-inserted subtree.
  useEffect(() => {
    if (open) { setQuery(''); setResults([]); setTimeout(() => inputRef.current?.focus(), 50) }
  }, [open])

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      setLoading(true)
      try { setResults(await globalSearch(query, profile?.organization_id)) }
      finally { setLoading(false) }
    }, 250)
    return () => clearTimeout(t)
  }, [query, profile?.organization_id])

  function go(link) { onClose(); navigate(link) }

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()} onKeyDown={e => e.key === 'Escape' && onClose()}>
      <div className="modal-box" style={{ maxWidth: 560, marginTop: '10vh', maxHeight: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <Search size={16} style={{ color: 'var(--ink-muted)', flexShrink: 0 }} />
          <input ref={inputRef} autoFocus value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search projects, customers, invoices, vendors, scenarios…"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, background: 'transparent', color: 'var(--text)' }} />
          {query && (
            <button onClick={() => { setQuery(''); inputRef.current?.focus() }} title="Clear"
              style={{ display: 'flex', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-muted)', padding: 2, flexShrink: 0 }}>
              <X size={15} />
            </button>
          )}
          <span style={{ fontSize: 11, color: 'var(--ink-muted)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px', flexShrink: 0 }}>Esc</span>
        </div>
        <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: results.length ? '8px 0' : 0 }}>
          {loading && <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-muted)', fontSize: 13 }}>Searching…</div>}
          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-muted)', fontSize: 13 }}>No matches for "{query}"</div>
          )}
          {!loading && query.trim().length < 2 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-muted)', fontSize: 13 }}>Type at least 2 characters…</div>
          )}
          {!loading && results.map(group => {
            const Icon = CATEGORY_ICON[group.category] || Search
            return (
              <div key={group.category} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '.05em', padding: '6px 18px' }}>{group.category}</div>
                {group.items.map(item => (
                  <button key={item.id} onClick={() => go(item.link)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '8px 18px', border: 'none', background: 'transparent', cursor: 'pointer' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                    <Icon size={15} style={{ color: 'var(--ink-muted)', flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</div>
                      {item.sublabel && <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{item.sublabel}</div>}
                    </div>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
