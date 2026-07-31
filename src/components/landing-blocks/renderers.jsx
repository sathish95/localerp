// Live-render components — one per block_type, used identically in the
// builder's preview mode and the public /l/:slug page (same components,
// same config shape) so what you build is what renders. Presentational
// only: product names come from the `productLookup` prop the parent
// collects once (authenticated pages query `products` directly; the
// public page uses the curated get_products_public RPC) rather than each
// block fetching its own data.
import { useState, useEffect, useRef } from 'react'
import { Check, X, Quote, ChevronDown } from 'lucide-react'
import { PublicLeadCaptureForm } from '../PublicLeadCaptureForm'

// overflow:'auto' (not 'hidden') — a block's content height (especially
// LeadForm once Turnstile loads / custom fields are added, and FAQItem
// once expanded) can exceed whatever grid height it happens to be sized
// to; 'hidden' silently clipped the bottom of the form (submit button,
// Turnstile widget) off, which read as "the form isn't showing." 'auto'
// scrolls internally instead of ever hiding content.
// Exported (STEP89 growth catalog) — src/components/landing-blocks/growthRenderers.jsx
// reuses these instead of duplicating them.
export const wrap = { height: '100%', width: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }
export const cardBase = { borderRadius: 12, border: '1px solid #e2e8f0', background: '#fff', padding: 18, boxShadow: '0 1px 2px rgba(15,23,42,.04)' }

// Shared by Hero/Button/PricingCard/Header (STEP80, meeting_page STEP87+)
// — default when cta_action isn't set yet (every block created before
// STEP80) is 'scroll_to_form', so old pages gain a working CTA without
// needing to be re-saved.
export function handleCtaClick(config) {
  return (e) => {
    const action = config.cta_action || 'scroll_to_form'
    if (action === 'url') {
      if (config.cta_url) window.location.href = config.cta_url
      return
    }
    if (action === 'meeting_page') {
      if (config.cta_meeting_page_slug) window.location.href = `/book/${config.cta_meeting_page_slug}`
      return
    }
    e.preventDefault()
    document.getElementById('landing-lead-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}
export function initials(name) {
  return (name || '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?'
}
function yesNoIcon(v) {
  const s = (v || '').trim().toLowerCase()
  if (s === 'yes') return <Check size={16} color="#15803d" />
  if (s === 'no') return <X size={16} color="#cbd5e1" />
  return <span>{v}</span>
}

function HeaderBlock({ config }) {
  const items = config.menu_items || []
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 20px', flexWrap: 'wrap', background: '#fff', borderBottom: '1px solid #e2e8f0' }}>
      <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 800, fontSize: 18, color: '#0f172a', flexShrink: 0 }}>{config.logo_text || 'Your Brand'}</div>
      <nav style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
        {items.map((m, i) => <a key={i} href={m.url || '#'} style={{ fontSize: 13.5, fontWeight: 600, color: '#334155', textDecoration: 'none' }}>{m.label}</a>)}
      </nav>
      {config.cta_label && <button className="btn btn-primary btn-sm" onClick={handleCtaClick(config)} style={{ flexShrink: 0 }}>{config.cta_label}</button>}
    </div>
  )
}

function HeroBlock({ config }) {
  return (
    <div style={{ ...wrap, justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: 32, borderRadius: 16, position: 'relative', background: config.image_url ? `linear-gradient(rgba(15,23,42,.62),rgba(15,23,42,.72)), url(${config.image_url}) center/cover` : 'radial-gradient(circle at top left, #818cf8, #4338ca 60%)', color: '#fff' }}>
      {config.eyebrow && <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', padding: '4px 12px', borderRadius: 999, background: 'rgba(255,255,255,.16)', marginBottom: 14 }}>{config.eyebrow}</div>}
      <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 'clamp(24px,4vw,42px)', fontWeight: 800, marginBottom: 12, maxWidth: 740, lineHeight: 1.15 }}>{config.headline || 'Your headline here'}</div>
      {config.subheadline && <div style={{ fontSize: 15.5, opacity: 0.92, marginBottom: 22, maxWidth: 580, lineHeight: 1.5 }}>{config.subheadline}</div>}
      {config.cta_label && <button className="btn" style={{ background: '#fff', color: '#4338ca', padding: '12px 26px', fontWeight: 800, borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 14.5, boxShadow: '0 8px 24px rgba(0,0,0,.18)' }} onClick={handleCtaClick(config)}>{config.cta_label}</button>}
    </div>
  )
}

function HeadingBlock({ config }) {
  const Tag = `h${Math.min(6, Math.max(1, Number(config.level) || 2))}`
  return <div style={wrap}><Tag style={{ margin: 0, fontFamily: "'Playfair Display',serif" }}>{config.text || 'Heading'}</Tag></div>
}

function ParagraphBlock({ config }) {
  return <div style={{ ...wrap, fontSize: 14, lineHeight: 1.6, color: '#334155' }}>{config.text || ''}</div>
}

// aspectRatio (not height:'100%') — this block has no text content to
// derive an intrinsic height from, and the auto-height flow canvas
// (STEP86) gives it no fixed parent height to fill either. A set aspect
// ratio is the standard way to give a media block predictable sizing
// without any manual height control.
function ImageBlock({ config }) {
  return (
    <div style={{ width: '100%', aspectRatio: '16/9', borderRadius: 12, overflow: 'hidden', background: '#f1f5f9' }}>
      {config.image_url ? <img src={config.image_url} alt={config.alt || ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontSize: 12 }}>No image set</div>}
    </div>
  )
}

function DividerBlock() {
  return <div style={{ display: 'flex', alignItems: 'center', padding: '16px 0' }}><div style={{ height: 1, background: '#e2e8f0', width: '100%' }} /></div>
}

// Swipeable, animated slider (STEP83) — a flex "track" of full-width
// slides translated by -i*100%, dragged with Pointer Events (no swipe
// library installed in this repo, and the gesture is simple enough to
// hand-roll). `dragging` is a ref (not state) for the low-level pointer
// tracking so onPointerMove doesn't need to re-run effects; `dragPx` is
// state purely to drive the live transform re-render while dragging.
function CarouselBlock({ config }) {
  const slides = config.slides || []
  const [i, setI] = useState(0)
  const [dragPx, setDragPx] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const dragging = useRef(null) // { startX, containerWidth }
  const trackRef = useRef(null)

  useEffect(() => { if (i >= slides.length) setI(0) }, [slides.length, i])
  useEffect(() => {
    if (!config.autoplay || slides.length < 2 || isDragging) return
    const t = setInterval(() => setI(p => (p + 1) % slides.length), Math.max(1, Number(config.interval_seconds) || 4) * 1000)
    return () => clearInterval(t)
  }, [config.autoplay, config.interval_seconds, slides.length, isDragging])

  function onPointerDown(e) {
    if (slides.length < 2) return
    const rect = trackRef.current.getBoundingClientRect()
    dragging.current = { startX: e.clientX, containerWidth: rect.width }
    setIsDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onPointerMove(e) {
    if (!dragging.current) return
    setDragPx(e.clientX - dragging.current.startX)
  }
  function onPointerUp() {
    const d = dragging.current
    if (!d) return
    const threshold = d.containerWidth * 0.18
    if (dragPx > threshold) setI(p => (p - 1 + slides.length) % slides.length)
    else if (dragPx < -threshold) setI(p => (p + 1) % slides.length)
    dragging.current = null
    setIsDragging(false)
    setDragPx(0)
  }

  if (slides.length === 0) return <div style={{ width: '100%', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12, background: '#f1f5f9', borderRadius: 12 }}>No slides added</div>

  const baseOffsetPct = -i * 100
  const dragOffsetPct = dragging.current ? (dragPx / dragging.current.containerWidth) * 100 : 0

  return (
    <div style={{ width: '100%', aspectRatio: '16/9', position: 'relative', borderRadius: 14, overflow: 'hidden', background: '#0f172a', touchAction: 'pan-y', cursor: slides.length > 1 ? 'grab' : 'default' }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <div ref={trackRef} style={{
        display: 'flex', width: '100%', height: '100%',
        transform: `translateX(${baseOffsetPct + dragOffsetPct}%)`,
        transition: isDragging ? 'none' : 'transform .35s ease',
      }}>
        {slides.map((s, idx) => (
          <div key={idx} style={{ flex: '0 0 100%', height: '100%', position: 'relative' }}>
            {s.image_url ? <img src={s.image_url} alt={s.caption || ''} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} /> : <div style={{ width: '100%', height: '100%' }} />}
            {s.caption && <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 18px', background: 'linear-gradient(transparent,rgba(0,0,0,.65))', color: '#fff', fontWeight: 700, fontSize: 13.5 }}>{s.caption}</div>}
          </div>
        ))}
      </div>
      {slides.length > 1 && <>
        <button type="button" onClick={() => setI(p => (p - 1 + slides.length) % slides.length)} style={{ position: 'absolute', top: '50%', left: 10, transform: 'translateY(-50%)', width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,.85)', cursor: 'pointer', fontWeight: 800 }}>‹</button>
        <button type="button" onClick={() => setI(p => (p + 1) % slides.length)} style={{ position: 'absolute', top: '50%', right: 10, transform: 'translateY(-50%)', width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,.85)', cursor: 'pointer', fontWeight: 800 }}>›</button>
        <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 6 }}>
          {slides.map((_, idx) => <span key={idx} onClick={() => setI(idx)} style={{ width: 6, height: 6, borderRadius: '50%', background: idx === i ? '#fff' : 'rgba(255,255,255,.4)', cursor: 'pointer' }} />)}
        </div>
      </>}
    </div>
  )
}

function TrustBarBlock({ config }) {
  return (
    <div style={{ ...wrap, flexDirection: 'row', flexWrap: 'wrap', gap: 22, alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: 12, border: '1px solid #f1f5f9' }}>
      {(config.items || []).map((t, i) => <span key={i} style={{ fontSize: 12.5, fontWeight: 700, color: '#64748b', letterSpacing: '.02em' }}>{t}</span>)}
    </div>
  )
}

function FeatureCardBlock({ config }) {
  return (
    <div style={{ ...wrap, ...cardBase }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#eef2ff,#e0e7ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, marginBottom: 12 }}>{config.icon || '⭐'}</div>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{config.title || 'Feature title'}</div>
      <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>{config.description}</div>
    </div>
  )
}

function TestimonialCardBlock({ config }) {
  return (
    <div style={{ ...wrap, ...cardBase, justifyContent: 'center', background: 'linear-gradient(135deg,#fdf4ff,#fff)' }}>
      <Quote size={20} color="#d8b4fe" style={{ marginBottom: 8 }} />
      <div style={{ fontSize: 14, color: '#334155', marginBottom: 14, lineHeight: 1.5 }}>{config.quote || ''}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {config.avatar_url ? (
          <img src={config.avatar_url} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#d8b4fe', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12 }}>{initials(config.author)}</div>
        )}
        <div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{config.author}</div>
          {config.role && <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{config.role}</div>}
        </div>
      </div>
    </div>
  )
}

function StatBlockBlock({ config }) {
  return (
    <div style={{ ...wrap, alignItems: 'center', justifyContent: 'center', textAlign: 'center', ...cardBase }}>
      <div style={{ fontSize: 32, fontWeight: 800, background: 'linear-gradient(135deg,#6366f1,#4338ca)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{config.number || '0'}</div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, fontWeight: 600 }}>{config.label}</div>
    </div>
  )
}

function ComparisonTableBlock({ config }) {
  const rows = config.rows || []
  return (
    <div style={{ ...wrap, overflow: 'auto', ...cardBase, padding: 0 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead><tr style={{ background: '#f8fafc' }}>{['Feature', 'Us', 'Others'].map(h => <th key={h} style={{ textAlign: 'left', padding: '10px 14px', borderBottom: '2px solid #e2e8f0', color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.03em' }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i}><td style={{ padding: '10px 14px', borderBottom: '1px solid #f1f5f9', fontWeight: 600 }}>{r.feature}</td>
            <td style={{ padding: '10px 14px', borderBottom: '1px solid #f1f5f9', fontWeight: 700 }}>{yesNoIcon(r.us)}</td>
            <td style={{ padding: '10px 14px', borderBottom: '1px solid #f1f5f9', color: '#94a3b8' }}>{yesNoIcon(r.competitor)}</td></tr>
        ))}</tbody>
      </table>
    </div>
  )
}

function HowItWorksStepBlock({ config }) {
  return (
    <div style={{ ...wrap, ...cardBase }}>
      <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#4338ca)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, marginBottom: 10, fontSize: 14 }}>{config.step_number || 1}</div>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{config.title}</div>
      <div style={{ fontSize: 12.5, color: '#64748b' }}>{config.description}</div>
    </div>
  )
}

// override_image_url (STEP89) — optional per-page photo, since the
// shared `products` table (procurement master data, used well beyond
// marketing) has no image_url column and isn't the place to add one.
// Falls back to the original emoji placeholder box when unset, so
// existing pages render identically.
function ProductCardBlock({ config, productLookup }) {
  const product = productLookup?.[config.product_part_number]
  return (
    <div style={{ ...wrap, ...cardBase, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
      {config.override_image_url ? (
        <img src={config.override_image_url} alt="" style={{ width: 76, height: 76, borderRadius: 14, objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <div style={{ width: 76, height: 76, borderRadius: 14, background: 'linear-gradient(135deg,#eef2ff,#e0e7ff)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>📦</div>
      )}
      <div>
        <div style={{ fontWeight: 800, fontSize: 18 }}>{config.override_title || product?.name || 'Select a product'}</div>
        <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{config.override_description || product?.device_type || ''}</div>
      </div>
    </div>
  )
}

function ProductGridBlock({ config, productLookup }) {
  const parts = config.product_part_numbers || []
  const images = config.product_image_overrides || {}
  return (
    <div style={{ ...wrap, display: 'grid', gridTemplateColumns: `repeat(${Math.min(parts.length || 1, 4)},1fr)`, gap: 12, overflow: 'auto' }}>
      {parts.map(pn => {
        const product = productLookup?.[pn]
        return (
          <div key={pn} style={{ ...cardBase, padding: 14, textAlign: 'center' }}>
            {images[pn] ? (
              <img src={images[pn]} alt="" style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'cover', margin: '0 auto 8px' }} />
            ) : (
              <div style={{ fontSize: 22, marginBottom: 8 }}>📦</div>
            )}
            <div style={{ fontWeight: 700, fontSize: 13 }}>{product?.name || pn}</div>
          </div>
        )
      })}
      {parts.length === 0 && <div style={{ color: '#94a3b8', fontSize: 12 }}>No products selected</div>}
    </div>
  )
}

function PricingCardBlock({ config }) {
  return (
    <div style={{ ...wrap, ...cardBase, alignItems: 'center', textAlign: 'center', background: 'linear-gradient(135deg,#f8fafc,#fff)', border: '2px solid #6366f1' }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em' }}>{config.plan_name || 'Plan'}</div>
      <div style={{ fontSize: 32, fontWeight: 800, margin: '8px 0' }}>{config.price || 'Contact us'}</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 18px', fontSize: 13, color: '#334155', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(config.features || []).map((f, i) => <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}><Check size={14} color="#15803d" /> {f}</li>)}
      </ul>
      <button className="btn btn-primary" onClick={handleCtaClick(config)}>{config.cta_label || 'Get Started'}</button>
    </div>
  )
}

function FAQItemBlock({ config }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ ...wrap, ...cardBase, justifyContent: 'center', padding: 0, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, gap: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{config.question}</div>
        <ChevronDown size={16} color="#94a3b8" style={{ flexShrink: 0, transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </div>
      {open && <div style={{ fontSize: 13, color: '#64748b', padding: '0 16px 16px', lineHeight: 1.5 }}>{config.answer}</div>}
    </div>
  )
}

function ButtonBlock({ config }) {
  return (
    <div style={{ ...wrap, alignItems: 'center', justifyContent: 'center' }}>
      <button className="btn btn-primary" onClick={handleCtaClick(config)}>{config.label || 'Click Here'}</button>
    </div>
  )
}

function LeadFormBlock({ config, slug }) {
  return (
    <div id="landing-lead-form" style={{ ...wrap, ...cardBase }}>
      {config.headline && <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 12 }}>{config.headline}</div>}
      {slug ? <PublicLeadCaptureForm slug={slug} formConfig={config} /> : <div style={{ fontSize: 12, color: '#94a3b8' }}>Lead form (preview — publish this page to a Landing Link to activate)</div>}
    </div>
  )
}

export const BLOCK_RENDER_COMPONENTS = {
  Header: HeaderBlock,
  Hero: HeroBlock, Heading: HeadingBlock, Paragraph: ParagraphBlock, Image: ImageBlock, Divider: DividerBlock, Carousel: CarouselBlock,
  TrustBar: TrustBarBlock, FeatureCard: FeatureCardBlock, TestimonialCard: TestimonialCardBlock, StatBlock: StatBlockBlock,
  ComparisonTable: ComparisonTableBlock, HowItWorksStep: HowItWorksStepBlock,
  ProductCard: ProductCardBlock, ProductGrid: ProductGridBlock,
  PricingCard: PricingCardBlock, FAQItem: FAQItemBlock, Button: ButtonBlock, LeadForm: LeadFormBlock,
}
