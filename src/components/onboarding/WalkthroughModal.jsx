import { useState } from 'react'
import * as LucideIcons from 'lucide-react'
import { X, ArrowRight, ArrowLeft, Sparkles } from 'lucide-react'

// Full-screen first-run walkthrough — a short carousel of admin-authored
// slides (Settings → Onboarding & Tour). Shown once per user, gated by
// profiles.walkthrough_seen_at (see Layout.jsx for the trigger logic).
export default function WalkthroughModal({ slides, onDone }) {
  const [i, setI] = useState(0)
  const slide = slides[i]
  const isLast = i === slides.length - 1
  const Icon = (slide.icon && LucideIcons[slide.icon]) || Sparkles

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(15,15,25,.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        width: '100%', maxWidth: 460, background: '#fff', borderRadius: 20, padding: '36px 32px 28px',
        position: 'relative', boxShadow: '0 24px 60px rgba(0,0,0,.25)', textAlign: 'center',
      }}>
        <button onClick={onDone} title="Skip"
          style={{ position: 'absolute', top: 14, right: 14, border: 'none', background: 'var(--surface)', borderRadius: 8, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--ink-muted)' }}>
          <X size={15} />
        </button>

        <div style={{
          width: 68, height: 68, borderRadius: '50%', margin: '0 auto 20px',
          background: 'linear-gradient(135deg,#6366f1,#4338ca)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={30} color="#fff" />
        </div>

        <div style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: 10, fontFamily: 'Playfair Display, serif' }}>{slide.title}</div>
        {slide.body && <div style={{ color: 'var(--ink-muted)', fontSize: '0.92rem', lineHeight: 1.6, marginBottom: 28 }}>{slide.body}</div>}

        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 24 }}>
          {slides.map((s, idx) => (
            <span key={s.id} style={{
              width: idx === i ? 20 : 7, height: 7, borderRadius: 4, transition: 'all .2s',
              background: idx === i ? '#6366f1' : 'var(--border)',
            }} />
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
          <button onClick={() => setI(x => Math.max(0, x - 1))} disabled={i === 0}
            className="btn btn-ghost" style={{ visibility: i === 0 ? 'hidden' : 'visible', display: 'flex', alignItems: 'center', gap: 6 }}>
            <ArrowLeft size={14} /> Back
          </button>
          <button onClick={() => (isLast ? onDone() : setI(x => x + 1))}
            className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, flex: i === 0 ? 1 : undefined }}>
            {isLast ? 'Get Started' : 'Next'} {!isLast && <ArrowRight size={14} />}
          </button>
        </div>
      </div>
    </div>
  )
}
