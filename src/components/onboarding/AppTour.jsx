import { useEffect, useState, useCallback } from 'react'
import { X, ArrowRight, ArrowLeft } from 'lucide-react'

const PAD = 8 // spotlight padding around the target element

// Sequential spotlight tour over existing UI, no library — the "hole" is
// four dark rectangles framing the target's measured rect rather than a
// box-shadow trick, so it works for any target size/position without
// clipping math. Steps whose `[data-tour]` anchor isn't in the DOM are
// dropped by the caller (Layout.jsx) before this ever mounts.
export default function AppTour({ steps, onDone }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState(null)
  const step = steps[i]
  const isLast = i === steps.length - 1

  const measure = useCallback(() => {
    const el = document.querySelector(`[data-tour="${step?.target_key}"]`)
    if (!el) { setRect(null); return }
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    // Let the scroll settle a tick before measuring its final position.
    requestAnimationFrame(() => {
      const r = el.getBoundingClientRect()
      setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 })
    })
  }, [step])

  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [measure])

  if (!step) return null

  const vw = window.innerWidth, vh = window.innerHeight
  const r = rect || { top: -9999, left: -9999, width: 0, height: 0 }
  const spaceBelow = vh - (r.top + r.height)
  const placeBelow = !rect || spaceBelow > 180 || r.top < 180
  const tooltipWidth = 320
  let tooltipLeft = rect ? Math.min(Math.max(r.left, 16), vw - tooltipWidth - 16) : vw / 2 - tooltipWidth / 2
  const dimStyle = { position: 'fixed', background: 'rgba(15,15,25,.55)', zIndex: 3100 }

  return (
    <>
      {/* Four-rectangle mask framing the spotlight hole */}
      <div style={{ ...dimStyle, top: 0, left: 0, right: 0, height: Math.max(0, r.top) }} />
      <div style={{ ...dimStyle, top: Math.max(0, r.top), left: 0, width: Math.max(0, r.left), height: r.height }} />
      <div style={{ ...dimStyle, top: Math.max(0, r.top), left: r.left + r.width, right: 0, height: r.height }} />
      <div style={{ ...dimStyle, top: r.top + r.height, left: 0, right: 0, bottom: 0 }} />

      {rect && (
        <div style={{
          position: 'fixed', top: r.top, left: r.left, width: r.width, height: r.height, zIndex: 3101,
          borderRadius: 12, boxShadow: '0 0 0 3px #6366f1, 0 0 24px rgba(99,102,241,.6)', pointerEvents: 'none',
        }} />
      )}

      <div style={{
        position: 'fixed', zIndex: 3102, width: tooltipWidth, left: tooltipLeft,
        top: placeBelow ? Math.min(r.top + r.height + 14, vh - 200) : undefined,
        bottom: !placeBelow ? vh - r.top + 14 : undefined,
        background: '#fff', borderRadius: 14, padding: '18px 18px 14px', boxShadow: '0 16px 40px rgba(0,0,0,.3)',
      }}>
        <button onClick={onDone} title="Skip tour"
          style={{ position: 'absolute', top: 10, right: 10, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-muted)', padding: 2 }}>
          <X size={14} />
        </button>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
          Step {i + 1} of {steps.length}
        </div>
        <div style={{ fontWeight: 800, fontSize: '0.98rem', marginBottom: 6 }}>{step.title}</div>
        {step.body && <div style={{ fontSize: '0.84rem', color: 'var(--ink-muted)', lineHeight: 1.5, marginBottom: 14 }}>{step.body}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={() => setI(x => Math.max(0, x - 1))} disabled={i === 0}
            className="btn btn-ghost btn-sm" style={{ visibility: i === 0 ? 'hidden' : 'visible', display: 'flex', alignItems: 'center', gap: 4 }}>
            <ArrowLeft size={12} /> Back
          </button>
          <button onClick={() => (isLast ? onDone() : setI(x => x + 1))}
            className="btn btn-primary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {isLast ? 'Finish' : 'Next'} {!isLast && <ArrowRight size={12} />}
          </button>
        </div>
      </div>
    </>
  )
}
