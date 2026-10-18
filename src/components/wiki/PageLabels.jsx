import { useEffect, useState } from 'react'
import { listLabels, createLabel, listPageLabels, setPageLabels } from '../../lib/wikiLabels'
import { Modal } from '../ui'
import { Tag, Plus } from 'lucide-react'

const PALETTE = ['#6366f1', '#f59e0b', '#10b981', '#e11d48', '#0ea5e9', '#8b5cf6', '#14b8a6']

export default function PageLabels({ pageId }) {
  const [allLabels, setAllLabels] = useState([])
  const [pageLabels, setPageLabelsState] = useState([])
  const [showEdit, setShowEdit] = useState(false)
  const [newLabel, setNewLabel] = useState('')

  useEffect(() => { load() }, [pageId])
  async function load() {
    const [all, mine] = await Promise.all([listLabels(), listPageLabels(pageId)])
    setAllLabels(all); setPageLabelsState(mine)
  }

  async function toggle(label) {
    const has = pageLabels.some(l => l.id === label.id)
    const next = has ? pageLabels.filter(l => l.id !== label.id) : [...pageLabels, label]
    setPageLabelsState(next)
    await setPageLabels(pageId, next.map(l => l.id))
  }

  async function handleCreate() {
    if (!newLabel.trim()) return
    try {
      const label = await createLabel(newLabel, PALETTE[allLabels.length % PALETTE.length])
      setNewLabel('')
      setAllLabels(prev => [...prev, label])
      await toggle(label)
    } catch (err) { alert(err.message) }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
      {pageLabels.map(l => (
        <span key={l.id} style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: `${l.color}18`, color: l.color }}>
          {l.name}
        </span>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={() => setShowEdit(true)} style={{ fontSize: 11 }}>
        <Tag size={11} /> {pageLabels.length ? 'Edit labels' : 'Add labels'}
      </button>

      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Labels">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {allLabels.map(l => {
            const active = pageLabels.some(pl => pl.id === l.id)
            return (
              <button key={l.id} onClick={() => toggle(l)}
                style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  border: `1.5px solid ${active ? l.color : 'var(--border)'}`,
                  background: active ? `${l.color}18` : 'var(--surface)', color: active ? l.color : 'inherit',
                }}>
                {l.name}
              </button>
            )
          })}
          {allLabels.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>No labels yet — create one below.</div>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="form-input" value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="New label name"
            onKeyDown={e => e.key === 'Enter' && handleCreate()} />
          <button className="btn btn-primary btn-sm" onClick={handleCreate}><Plus size={13} /> Create</button>
        </div>
      </Modal>
    </div>
  )
}
