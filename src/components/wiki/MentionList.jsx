import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'

// Rendered by src/lib/wikiMentionSuggestion.js via Tiptap's ReactRenderer +
// tippy.js, anchored at the text caret — not a normal child of PageEditor's
// own render tree, so it carries its own <style> block.
export default forwardRef(function MentionList({ items, command }, ref) {
  const [selected, setSelected] = useState(0)
  useEffect(() => setSelected(0), [items])

  function select(index) {
    const item = items[index]
    if (item) command({ id: item.id, label: item.full_name })
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false
      if (event.key === 'ArrowUp') { setSelected((selected + items.length - 1) % items.length); return true }
      if (event.key === 'ArrowDown') { setSelected((selected + 1) % items.length); return true }
      if (event.key === 'Enter') { select(selected); return true }
      return false
    },
  }), [selected, items])

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
      boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: 4, minWidth: 220, maxHeight: 260, overflowY: 'auto',
    }}>
      {items.length === 0 ? (
        <div style={{ padding: '10px 12px', fontSize: 12.5, color: 'var(--ink-muted)' }}>No matches</div>
      ) : items.map((item, i) => (
        <div key={item.id} onClick={() => select(i)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 7, cursor: 'pointer',
            background: i === selected ? 'var(--c1-soft)' : 'transparent',
          }}>
          <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--c1)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {(item.full_name || '?')[0]?.toUpperCase()}
          </div>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.full_name}</div>
            {item.role && <div style={{ fontSize: 10.5, color: 'var(--ink-muted)', textTransform: 'capitalize' }}>{item.role.replace(/_/g, ' ')}</div>}
          </div>
        </div>
      ))}
    </div>
  )
})
