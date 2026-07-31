// Generic per-block styling panel (STEP83/84) — one shared form for all
// 18 block types instead of duplicating style fields inside every
// BLOCK_EDITOR_COMPONENTS entry. Writes to config.style, a new key
// inside the block's existing config JSONB — no schema change needed.
// Applied by the caller (src/components/LandingPageBuilder.jsx and
// src/components/PublicLandingPage.jsx) as inline styles on the single
// absolute-positioned block wrapper div, so it doesn't need to touch
// every renderer component individually.
const field = { marginBottom: 10 }
const label = { display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.03em' }
const row = { display: 'flex', gap: 8 }

const ALIGN_OPTIONS = [
  { id: 'left', label: 'Left' },
  { id: 'center', label: 'Center' },
  { id: 'right', label: 'Right' },
]

export function applyBlockStyle(style) {
  if (!style) return {}
  const out = {}
  if (style.backgroundColor) out.backgroundColor = style.backgroundColor
  if (style.textColor) out.color = style.textColor
  if (style.padding != null && style.padding !== '') out.padding = `${style.padding}px`
  if (style.textAlign) out.textAlign = style.textAlign
  if (style.borderRadius != null && style.borderRadius !== '') out.borderRadius = `${style.borderRadius}px`
  return out
}

export default function BlockStyleEditor({ config, onChange }) {
  const style = config.style || {}
  function set(key, value) { onChange({ ...config, style: { ...style, [key]: value } }) }
  function clear() { onChange({ ...config, style: {} }) }

  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
      <div style={field}>
        <label style={label}>Section Title (optional)</label>
        <input className="form-input" value={config.section_title || ''} onChange={e => onChange({ ...config, section_title: e.target.value })} placeholder="Shown above this section" />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.03em' }}>Style</div>
        <button type="button" onClick={clear} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}>Reset</button>
      </div>

      <div style={row}>
        <div style={{ ...field, flex: 1 }}>
          <label style={label}>Background</label>
          <input type="color" className="form-input" style={{ padding: 2, height: 32 }} value={style.backgroundColor || '#ffffff'} onChange={e => set('backgroundColor', e.target.value)} />
        </div>
        <div style={{ ...field, flex: 1 }}>
          <label style={label}>Text Color</label>
          <input type="color" className="form-input" style={{ padding: 2, height: 32 }} value={style.textColor || '#0f172a'} onChange={e => set('textColor', e.target.value)} />
        </div>
      </div>

      <div style={row}>
        <div style={{ ...field, flex: 1 }}>
          <label style={label}>Padding (px)</label>
          <input type="number" min="0" className="form-input" value={style.padding ?? ''} onChange={e => set('padding', e.target.value)} placeholder="0" />
        </div>
        <div style={{ ...field, flex: 1 }}>
          <label style={label}>Corner Radius (px)</label>
          <input type="number" min="0" className="form-input" value={style.borderRadius ?? ''} onChange={e => set('borderRadius', e.target.value)} placeholder="0" />
        </div>
      </div>

      <div style={field}>
        <label style={label}>Text Align</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {ALIGN_OPTIONS.map(o => (
            <button key={o.id} type="button" onClick={() => set('textAlign', o.id)}
              style={{ flex: 1, padding: '6px 0', borderRadius: 8, border: `1px solid ${style.textAlign === o.id ? '#6366f1' : 'var(--border)'}`, background: style.textAlign === o.id ? '#eef2ff' : 'none', color: style.textAlign === o.id ? '#4338ca' : 'var(--text)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
