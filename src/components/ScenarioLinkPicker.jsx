import { useState, useEffect } from 'react'
import { Modal, SearchBox, Loader, Empty } from './ui'
import { LINKABLE_TYPES, searchLinkable } from '../lib/scenarioLinks'

// Universal Link Picker (Phase 6) — one search box, switchable across
// every linkable entity type confirmed to exist in this app (see the
// header note in scenarioLinks.js for what was deliberately excluded).
export default function ScenarioLinkPicker({ onSelect, onClose }) {
  const [type, setType] = useState(LINKABLE_TYPES[0].key)
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    searchLinkable(type, q).then(r => { if (alive) { setResults(r); setLoading(false) } })
    return () => { alive = false }
  }, [type, q])

  return (
    <Modal open onClose={onClose} title="Link a Record" size="lg" footer={<button className="btn btn-ghost" onClick={onClose}>Close</button>}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {LINKABLE_TYPES.map(t => (
          <button
            key={t.key}
            className={`btn btn-sm ${type === t.key ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setType(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <SearchBox value={q} onChange={setQ} placeholder={`Search ${LINKABLE_TYPES.find(t => t.key === type)?.label.toLowerCase()}…`} />

      <div style={{ marginTop: 14, maxHeight: 360, overflowY: 'auto' }}>
        {loading ? <Loader /> : results.length === 0 ? (
          <Empty title="No matches" desc="Try a different search or record type." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {results.map(r => (
              <button
                key={r.id}
                className="link-picker-row"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', cursor: 'pointer' }}
                onClick={() => onSelect(r, type)}
              >
                <span>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{r.label}</div>
                  {r.sublabel && <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{r.sublabel}</div>}
                </span>
                {r.amount != null && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--c1)' }}>{Number(r.amount).toLocaleString('en-IN')}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
