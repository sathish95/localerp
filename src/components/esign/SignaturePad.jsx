import { useEffect, useRef, useState } from 'react'
import { Eraser, PenLine, Type } from 'lucide-react'

// Draw or type a signature. onChange({ png, kind }) — png is a cropped
// transparent PNG data URL, or null while empty.
const W = 560, H = 170
const SCRIPT = '"Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive'

function cropped(canvas) {
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  const px = ctx.getImageData(0, 0, width, height).data
  let x0 = width, y0 = height, x1 = -1, y1 = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (px[(y * width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  }
  if (x1 < 0) return null
  const pad = 8
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad)
  const out = document.createElement('canvas')
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1
  out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  return out.toDataURL('image/png')
}

export default function SignaturePad({ name, onChange }) {
  const [mode, setMode] = useState('draw')
  const [typed, setTyped] = useState(name || '')
  const canvas = useRef(null)
  const drawing = useRef(false)
  const last = useRef(null)
  const dirty = useRef(false)

  const ctx = () => {
    const c = canvas.current.getContext('2d')
    c.lineWidth = 2.4; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#0f172a'
    return c
  }
  const clear = () => {
    const c = canvas.current
    c.getContext('2d').clearRect(0, 0, c.width, c.height)
    dirty.current = false
    onChange(null)
  }
  const renderTyped = text => {
    const c = canvas.current
    const g = c.getContext('2d')
    g.clearRect(0, 0, c.width, c.height)
    const t = text.trim()
    if (!t) { onChange(null); return }
    let size = 64
    g.fillStyle = '#0f172a'; g.textBaseline = 'middle'
    do { g.font = `italic ${size}px ${SCRIPT}`; size -= 2 } while (g.measureText(t).width > c.width - 30 && size > 18)
    g.fillText(t, 15, c.height / 2)
    onChange({ png: cropped(c), kind: 'TYPED' })
  }

  useEffect(() => { if (mode === 'type') renderTyped(typed); else clear() }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (mode === 'type') renderTyped(typed) }, [typed]) // eslint-disable-line react-hooks/exhaustive-deps

  const pos = e => {
    const r = canvas.current.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) }
  }
  const down = e => {
    if (mode !== 'draw') return
    e.preventDefault()
    canvas.current.setPointerCapture?.(e.pointerId)
    drawing.current = true
    last.current = pos(e)
    const g = ctx(); g.beginPath(); g.arc(last.current.x, last.current.y, 1.1, 0, Math.PI * 2); g.fillStyle = '#0f172a'; g.fill()
  }
  const move = e => {
    if (!drawing.current) return
    e.preventDefault()
    const p = pos(e), g = ctx()
    g.beginPath(); g.moveTo(last.current.x, last.current.y); g.lineTo(p.x, p.y); g.stroke()
    last.current = p
    dirty.current = true
  }
  const up = () => {
    if (!drawing.current) return
    drawing.current = false
    if (dirty.current) onChange({ png: cropped(canvas.current), kind: 'DRAWN' })
  }

  return (
    <div className="esg-pad">
      <div className="esg-pad-bar">
        <div className="gl-seg">
          <button type="button" className={mode === 'draw' ? 'on' : ''} onClick={() => setMode('draw')}><PenLine size={13} /> Draw</button>
          <button type="button" className={mode === 'type' ? 'on' : ''} onClick={() => setMode('type')}><Type size={13} /> Type</button>
        </div>
        {mode === 'draw' && <button type="button" className="btn btn-ghost btn-sm" onClick={clear}><Eraser size={13} /> Clear</button>}
      </div>
      {mode === 'type' && <input className="form-input" value={typed} onChange={e => setTyped(e.target.value)} placeholder="Type your name" style={{ marginBottom: 8 }} />}
      <canvas ref={canvas} width={W} height={H} className={`esg-canvas${mode === 'draw' ? ' draw' : ''}`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} onPointerCancel={up} />
      <div className="esg-pad-hint">{mode === 'draw' ? 'Sign with your mouse, finger or stylus' : 'Your typed name is used as your signature'}</div>
    </div>
  )
}
