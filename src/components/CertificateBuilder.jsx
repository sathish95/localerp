import { useState, useRef, useCallback } from 'react'
import { CERTIFICATE_VARIABLE_GROUPS, IMAGE_VARIABLES, resolveTemplateString, SAMPLE_CERTIFICATE_DATA } from '../lib/certificateVariables'
import {
  Type, Image as ImageIcon, Award, PenTool, QrCode, Square, Minus,
  Trash2, Copy, ArrowUp, ArrowDown, Undo2, Redo2, Bold, Italic, Underline,
  AlignLeft, AlignCenter, AlignRight,
} from 'lucide-react'

const SCALE = 0.6
const GRID = 5
const snap = n => Math.round(n / GRID) * GRID

let idCounter = 0
const newId = () => `el_${Date.now()}_${idCounter++}`

const DEFAULTS = {
  text:    () => ({ type: 'text', x: 100, y: 100, width: 400, height: 60, content: 'New text', fontSize: 18, fontFamily: 'helvetica', color: '#111111', align: 'center', bold: false, italic: false }),
  image:   () => ({ type: 'image', x: 100, y: 100, width: 160, height: 160, imageSrc: null, variableKey: null }),
  shape:   () => ({ type: 'shape', x: 100, y: 100, width: 300, height: 2, shapeType: 'line', borderColor: '#6366f1', borderWidth: 2, filled: false, fillColor: '#ffffff' }),
  qrcode:  () => ({ type: 'qrcode', x: 100, y: 100, width: 110, height: 110 }),
}

// Structured field-position editor: elements are positioned/resized via
// drag on a fixed-pixel grid-snapped canvas (reusing this app's existing
// react-resizable dependency for the resize handle interaction pattern,
// hand-rolled drag via window mouse listeners rather than react-grid-
// layout's own layout engine — RGL's collision/compaction model actively
// fights a design canvas that needs freely overlapping/layered elements,
// e.g. a background image behind text). No rotation support — a
// deliberate scope line agreed with the user up front, not an oversight.
export default function CertificateBuilder({ elements, onElementsChange, canvasWidth, canvasHeight, backgroundColor, onBackgroundColorChange, backgroundImage, onBackgroundImageChange }) {
  const [selectedId, setSelectedId] = useState(null)
  const [history, setHistory] = useState([])
  const [future, setFuture] = useState([])
  const dragRef = useRef(null)
  const canvasRef = useRef(null)

  const selected = elements.find(e => e.id === selectedId) || null

  function commit(next) {
    setHistory(h => [...h.slice(-49), elements])
    setFuture([])
    onElementsChange(next)
  }

  function undo() {
    if (!history.length) return
    const prev = history[history.length - 1]
    setFuture(f => [elements, ...f])
    setHistory(h => h.slice(0, -1))
    onElementsChange(prev)
  }
  function redo() {
    if (!future.length) return
    const next = future[0]
    setHistory(h => [...h, elements])
    setFuture(f => f.slice(1))
    onElementsChange(next)
  }

  function addElement(type, extra = {}) {
    const el = { id: newId(), zIndex: elements.length, ...DEFAULTS[type](), ...extra }
    commit([...elements, el])
    setSelectedId(el.id)
  }

  function updateElement(id, patch) {
    onElementsChange(elements.map(e => e.id === id ? { ...e, ...patch } : e))
  }
  function commitElement(id, patch) {
    commit(elements.map(e => e.id === id ? { ...e, ...patch } : e))
  }
  function deleteElement(id) {
    commit(elements.filter(e => e.id !== id))
    setSelectedId(null)
  }
  function duplicateElement(id) {
    const el = elements.find(e => e.id === id)
    if (!el) return
    const copy = { ...el, id: newId(), x: el.x + 20, y: el.y + 20, zIndex: elements.length }
    commit([...elements, copy])
    setSelectedId(copy.id)
  }
  function moveLayer(id, dir) {
    const sorted = [...elements].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
    const idx = sorted.findIndex(e => e.id === id)
    const swapWith = idx + dir
    if (swapWith < 0 || swapWith >= sorted.length) return
    const a = sorted[idx].zIndex, b = sorted[swapWith].zIndex
    commit(elements.map(e => e.id === sorted[idx].id ? { ...e, zIndex: b } : e.id === sorted[swapWith].id ? { ...e, zIndex: a } : e))
  }

  function insertVariable(key) {
    if (selected && selected.type === 'text') {
      commitElement(selected.id, { content: `${selected.content || ''} {{${key}}}`.trim() })
    } else {
      addElement('text', { content: `{{${key}}}` })
    }
  }
  function insertImageVariable(key) {
    addElement('image', { variableKey: key })
  }

  const startDrag = useCallback((e, el, mode) => {
    e.stopPropagation()
    setSelectedId(el.id)
    const startX = e.clientX, startY = e.clientY
    dragRef.current = { id: el.id, mode, startX, startY, origX: el.x, origY: el.y, origW: el.width, origH: el.height }

    function onMove(ev) {
      const d = dragRef.current
      if (!d) return
      const dx = (ev.clientX - d.startX) / SCALE
      const dy = (ev.clientY - d.startY) / SCALE
      if (d.mode === 'move') {
        updateElement(d.id, { x: Math.max(0, snap(d.origX + dx)), y: Math.max(0, snap(d.origY + dy)) })
      } else {
        updateElement(d.id, { width: Math.max(20, snap(d.origW + dx)), height: Math.max(20, snap(d.origH + dy)) })
      }
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const d = dragRef.current
      dragRef.current = null
      if (d) setHistory(h => [...h.slice(-49), elements])
      setFuture([])
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [elements])

  function handleImageUpload(file, cb) {
    const reader = new FileReader()
    reader.onload = () => cb(reader.result)
    reader.readAsDataURL(file)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 260px', gap: 16, minHeight: 560 }}>
      {/* Elements palette */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 10 }}>Elements</div>
        <PaletteButton icon={<Type size={15} />} label="Text" onClick={() => addElement('text')} />
        <PaletteButton icon={<ImageIcon size={15} />} label="Image" onClick={() => addElement('image')} />
        <PaletteButton icon={<Award size={15} />} label="Logo" onClick={() => insertImageVariable('company_logo')} />
        <PaletteButton icon={<PenTool size={15} />} label="Signature" onClick={() => addElement('image')} />
        <PaletteButton icon={<QrCode size={15} />} label="QR Code" onClick={() => addElement('qrcode')} />
        <PaletteButton icon={<Square size={15} />} label="Rectangle" onClick={() => addElement('shape', { shapeType: 'rect', width: 200, height: 100 })} />
        <PaletteButton icon={<Minus size={15} />} label="Line" onClick={() => addElement('shape', { shapeType: 'line' })} />

        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', margin: '16px 0 10px' }}>Background</div>
        <div className="form-group" style={{ marginBottom: 8 }}>
          <label className="form-label">Color</label>
          <input type="color" value={backgroundColor || '#ffffff'} onChange={e => onBackgroundColorChange(e.target.value)} style={{ width: '100%', height: 32 }} />
        </div>
        <label className="btn btn-outline btn-sm" style={{ width: '100%', justifyContent: 'center', cursor: 'pointer' }}>
          Upload Background
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => e.target.files[0] && handleImageUpload(e.target.files[0], onBackgroundImageChange)} />
        </label>

        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', margin: '16px 0 10px' }}>Variables</div>
        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
          {CERTIFICATE_VARIABLE_GROUPS.map(g => (
            <div key={g.group} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-muted)' }}>{g.group}</div>
              {g.vars.map(v => (
                <button key={v.key} className="btn btn-ghost btn-sm" style={{ display: 'block', width: '100%', textAlign: 'left', padding: '3px 6px' }}
                  onClick={() => insertVariable(v.key)}>{v.label}</button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button className="btn btn-outline btn-sm" onClick={undo} disabled={!history.length}><Undo2 size={13} /> Undo</button>
          <button className="btn btn-outline btn-sm" onClick={redo} disabled={!future.length}><Redo2 size={13} /> Redo</button>
        </div>
        <div style={{ width: canvasWidth * SCALE, height: canvasHeight * SCALE, overflow: 'hidden', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 2px 12px rgba(0,0,0,.08)' }}>
          <div ref={canvasRef}
            onMouseDown={() => setSelectedId(null)}
            style={{
              width: canvasWidth, height: canvasHeight, transform: `scale(${SCALE})`, transformOrigin: 'top left',
              position: 'relative', background: backgroundColor || '#ffffff',
              backgroundImage: backgroundImage ? `url(${backgroundImage})` : 'none', backgroundSize: 'cover',
            }}>
            {[...elements].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0)).map(el => (
              <CanvasElement key={el.id} el={el} selected={el.id === selectedId}
                onSelect={() => setSelectedId(el.id)} onDragStart={(e, mode) => startDrag(e, el, mode)} />
            ))}
          </div>
        </div>
      </div>

      {/* Properties */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 10 }}>Properties</div>
        {!selected ? (
          <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>Select an element to edit it.</div>
        ) : (
          <PropertiesPanel el={selected} onChange={patch => updateElement(selected.id, patch)} onCommit={patch => commitElement(selected.id, patch)}
            onDelete={() => deleteElement(selected.id)} onDuplicate={() => duplicateElement(selected.id)}
            onLayerUp={() => moveLayer(selected.id, 1)} onLayerDown={() => moveLayer(selected.id, -1)}
            onUpload={handleImageUpload} />
        )}
      </div>
    </div>
  )
}

function PaletteButton({ icon, label, onClick }) {
  return (
    <button className="btn btn-outline btn-sm" style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 6 }} onClick={onClick}>
      {icon} {label}
    </button>
  )
}

function CanvasElement({ el, selected, onSelect, onDragStart }) {
  const common = {
    position: 'absolute', left: el.x, top: el.y, width: el.width, height: el.height,
    outline: selected ? '2px solid #6366f1' : '1px dashed rgba(99,102,241,.35)',
    cursor: 'move', boxSizing: 'border-box',
  }
  return (
    <div style={common} onMouseDown={e => { onSelect(); onDragStart(e, 'move') }}>
      {renderPreview(el)}
      {selected && (
        <div onMouseDown={e => { e.stopPropagation(); onDragStart(e, 'resize') }}
          style={{ position: 'absolute', right: -6, bottom: -6, width: 12, height: 12, background: '#6366f1', borderRadius: 3, cursor: 'nwse-resize' }} />
      )}
    </div>
  )
}

function renderPreview(el) {
  if (el.type === 'text') {
    const text = resolveTemplateString(el.content, SAMPLE_CERTIFICATE_DATA) || el.content
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', alignItems: 'center',
        justifyContent: el.align === 'center' ? 'center' : el.align === 'right' ? 'flex-end' : 'flex-start',
        fontSize: el.fontSize, color: el.color, fontWeight: el.bold ? 700 : 400, fontStyle: el.italic ? 'italic' : 'normal',
        textDecoration: el.underline ? 'underline' : 'none', textAlign: el.align, overflow: 'hidden', padding: 2,
        fontFamily: el.fontFamily === 'times' ? 'Times New Roman, serif' : el.fontFamily === 'courier' ? 'Courier New, monospace' : 'Arial, sans-serif',
      }}>{text}</div>
    )
  }
  if (el.type === 'image') {
    const src = el.variableKey ? (SAMPLE_CERTIFICATE_DATA[el.variableKey] || null) : el.imageSrc
    return src
      ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', color: '#94a3b8', fontSize: 11 }}>{el.variableKey ? `{{${el.variableKey}}}` : 'Image'}</div>
  }
  if (el.type === 'qrcode') {
    return <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', color: '#94a3b8' }}><QrCode size={Math.min(el.width, el.height) * 0.6} /></div>
  }
  if (el.type === 'shape') {
    if (el.shapeType === 'line') return <div style={{ width: '100%', height: el.borderWidth, background: el.borderColor, marginTop: '50%' }} />
    return <div style={{ width: '100%', height: '100%', border: `${el.borderWidth}px solid ${el.borderColor}`, background: el.filled ? el.fillColor : 'transparent' }} />
  }
  return null
}

function PropertiesPanel({ el, onChange, onCommit, onDelete, onDuplicate, onLayerUp, onLayerDown, onUpload }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <button className="btn btn-outline btn-sm" onClick={onDuplicate}><Copy size={13} /></button>
        <button className="btn btn-outline btn-sm" onClick={onLayerUp}><ArrowUp size={13} /></button>
        <button className="btn btn-outline btn-sm" onClick={onLayerDown}><ArrowDown size={13} /></button>
        <button className="btn btn-ghost btn-sm" onClick={onDelete}><Trash2 size={13} /></button>
      </div>

      <div className="form-row" style={{ marginBottom: 8 }}>
        <div className="form-group"><label className="form-label">X</label><input className="form-input" type="number" value={Math.round(el.x)} onChange={e => onCommit({ x: Number(e.target.value) })} /></div>
        <div className="form-group"><label className="form-label">Y</label><input className="form-input" type="number" value={Math.round(el.y)} onChange={e => onCommit({ y: Number(e.target.value) })} /></div>
      </div>
      <div className="form-row" style={{ marginBottom: 8 }}>
        <div className="form-group"><label className="form-label">Width</label><input className="form-input" type="number" value={Math.round(el.width)} onChange={e => onCommit({ width: Number(e.target.value) })} /></div>
        <div className="form-group"><label className="form-label">Height</label><input className="form-input" type="number" value={Math.round(el.height)} onChange={e => onCommit({ height: Number(e.target.value) })} /></div>
      </div>

      {el.type === 'text' && (
        <>
          <div className="form-group"><label className="form-label">Content</label>
            <textarea className="form-input" rows={3} value={el.content} onChange={e => onChange({ content: e.target.value })} onBlur={e => onCommit({ content: e.target.value })} /></div>
          <div className="form-row" style={{ marginBottom: 8 }}>
            <div className="form-group"><label className="form-label">Font</label>
              <select className="form-select" value={el.fontFamily} onChange={e => onCommit({ fontFamily: e.target.value })}>
                <option value="helvetica">Sans-Serif</option>
                <option value="times">Serif</option>
                <option value="courier">Monospace</option>
              </select>
            </div>
            <div className="form-group"><label className="form-label">Size</label><input className="form-input" type="number" value={el.fontSize} onChange={e => onCommit({ fontSize: Number(e.target.value) })} /></div>
          </div>
          <div className="form-group" style={{ marginBottom: 8 }}><label className="form-label">Color</label>
            <input type="color" value={el.color} onChange={e => onCommit({ color: e.target.value })} style={{ width: '100%', height: 32 }} /></div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button className={`btn btn-sm ${el.bold ? 'btn-primary' : 'btn-outline'}`} onClick={() => onCommit({ bold: !el.bold })}><Bold size={13} /></button>
            <button className={`btn btn-sm ${el.italic ? 'btn-primary' : 'btn-outline'}`} onClick={() => onCommit({ italic: !el.italic })}><Italic size={13} /></button>
            <button className={`btn btn-sm ${el.underline ? 'btn-primary' : 'btn-outline'}`} onClick={() => onCommit({ underline: !el.underline })}><Underline size={13} /></button>
            <button className={`btn btn-sm ${el.align === 'left' ? 'btn-primary' : 'btn-outline'}`} onClick={() => onCommit({ align: 'left' })}><AlignLeft size={13} /></button>
            <button className={`btn btn-sm ${el.align === 'center' ? 'btn-primary' : 'btn-outline'}`} onClick={() => onCommit({ align: 'center' })}><AlignCenter size={13} /></button>
            <button className={`btn btn-sm ${el.align === 'right' ? 'btn-primary' : 'btn-outline'}`} onClick={() => onCommit({ align: 'right' })}><AlignRight size={13} /></button>
          </div>
        </>
      )}

      {el.type === 'image' && (
        <>
          {el.variableKey ? (
            <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 8 }}>Bound to variable: {`{{${el.variableKey}}}`}</div>
          ) : (
            <label className="btn btn-outline btn-sm" style={{ width: '100%', justifyContent: 'center', cursor: 'pointer', marginBottom: 8 }}>
              Upload Image
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => e.target.files[0] && onUpload(e.target.files[0], src => onCommit({ imageSrc: src }))} />
            </label>
          )}
        </>
      )}

      {el.type === 'shape' && (
        <>
          <div className="form-group" style={{ marginBottom: 8 }}><label className="form-label">Border Color</label>
            <input type="color" value={el.borderColor} onChange={e => onCommit({ borderColor: e.target.value })} style={{ width: '100%', height: 32 }} /></div>
          <div className="form-group" style={{ marginBottom: 8 }}><label className="form-label">Border Width</label>
            <input className="form-input" type="number" value={el.borderWidth} onChange={e => onCommit({ borderWidth: Number(e.target.value) })} /></div>
          {el.shapeType === 'rect' && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, marginBottom: 8 }}>
                <input type="checkbox" checked={el.filled} onChange={e => onCommit({ filled: e.target.checked })} /> Filled
              </label>
              {el.filled && (
                <div className="form-group"><label className="form-label">Fill Color</label>
                  <input type="color" value={el.fillColor} onChange={e => onCommit({ fillColor: e.target.value })} style={{ width: '100%', height: 32 }} /></div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
