// Growth catalog (STEP89) — 36 additional block renderers on top of the
// original 19 in ./renderers.jsx, reusing its shared primitives (wrap,
// cardBase, handleCtaClick, initials) instead of duplicating them. Kept
// in a separate file purely so the original, already-verified renderers
// stay untouched — see src/components/landing-blocks/index.js for how
// the two maps merge.
import { useState, useEffect, useRef } from 'react'
import { Check, ChevronDown, Star, Play, ArrowRight, Twitter, Linkedin, Facebook, MapPin, Phone, Mail, Clock, Quote } from 'lucide-react'
import { PublicLeadCaptureForm } from '../PublicLeadCaptureForm'
import { wrap, cardBase, handleCtaClick, initials } from './renderers'

// Rotates through 6 vibrant accent pairs by item index — the "more
// colourful" ask, applied automatically to multi-item grid blocks with
// zero extra editor fields (no per-item color picker to fill in).
const ACCENT_CYCLE = [
  { bg: '#eef2ff', fg: '#4338ca' }, { bg: '#ffe4e6', fg: '#be123c' }, { bg: '#d1fae5', fg: '#047857' },
  { bg: '#fef3c7', fg: '#b45309' }, { bg: '#e0f2fe', fg: '#0369a1' }, { bg: '#ede9fe', fg: '#6d28d9' },
]
const accent = (i) => ACCENT_CYCLE[i % ACCENT_CYCLE.length]

// Named gradient/solid presets for large hero-style sections — picked
// from a <select> in the editor (BACKGROUND_STYLE_OPTIONS, growthEditors.jsx).
export const BG_PRESETS = {
  indigo: 'radial-gradient(circle at top left, #818cf8, #4338ca 60%)',
  sunset: 'linear-gradient(135deg,#f97316,#db2777)',
  ocean: 'linear-gradient(135deg,#0ea5e9,#0369a1)',
  midnight: 'linear-gradient(135deg,#1e293b,#0f172a)',
  forest: 'linear-gradient(135deg,#10b981,#047857)',
  violet: 'linear-gradient(135deg,#8b5cf6,#5b21b6)',
}
const bgStyle = (key) => BG_PRESETS[key] || BG_PRESETS.indigo

function toEmbedUrl(url) {
  if (!url) return ''
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/)
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`
  const vim = url.match(/vimeo\.com\/(\d+)/)
  if (vim) return `https://player.vimeo.com/video/${vim[1]}`
  return ''
}
function IconOrIndex({ children }) {
  return <span style={{ fontSize: 18 }}>{children}</span>
}

/* ── content ── */

function AnnouncementBarBlock({ config }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 16px', borderRadius: 10, background: bgStyle(config.background_style), color: '#fff', fontSize: 13, fontWeight: 700 }}>
      <span>{config.text || 'Announcement text goes here'}</span>
      {config.link_label && <a href={config.link_url || '#'} style={{ color: '#fff', textDecoration: 'underline', fontWeight: 800, whiteSpace: 'nowrap' }}>{config.link_label} →</a>}
    </div>
  )
}

function HeroSplitBlock({ config }) {
  const reverse = config.image_position === 'left'
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'center', borderRadius: 16, padding: 32, background: bgStyle(config.background_style), color: '#fff', flexDirection: reverse ? 'row-reverse' : 'row' }}>
      <div style={{ flex: '1 1 320px' }}>
        {config.eyebrow && <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', padding: '4px 12px', borderRadius: 999, background: 'rgba(255,255,255,.16)', display: 'inline-block', marginBottom: 14 }}>{config.eyebrow}</div>}
        <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 'clamp(22px,3.6vw,38px)', fontWeight: 800, lineHeight: 1.15, marginBottom: 12 }}>{config.headline || 'Your headline here'}</div>
        {config.subheadline && <div style={{ fontSize: 15, opacity: 0.92, lineHeight: 1.5, marginBottom: 20, maxWidth: 480 }}>{config.subheadline}</div>}
        {config.cta_label && <button className="btn" style={{ background: '#fff', color: '#312e81', padding: '12px 24px', fontWeight: 800, borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 14 }} onClick={handleCtaClick(config)}>{config.cta_label}</button>}
      </div>
      <div style={{ flex: '1 1 280px' }}>
        {config.image_url ? <img src={config.image_url} alt="" style={{ width: '100%', borderRadius: 12, boxShadow: '0 20px 50px rgba(0,0,0,.25)', display: 'block' }} /> : <div style={{ width: '100%', aspectRatio: '4/3', borderRadius: 12, background: 'rgba(255,255,255,.12)' }} />}
      </div>
    </div>
  )
}

function VideoEmbedBlock({ config }) {
  const embed = toEmbedUrl(config.video_url)
  return (
    <div>
      <div style={{ width: '100%', aspectRatio: '16/9', borderRadius: 12, overflow: 'hidden', background: '#0f172a' }}>
        {embed ? (
          <iframe title="Video" src={embed} style={{ width: '100%', height: '100%', border: 'none' }} allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
        ) : config.video_url ? (
          <video src={config.video_url} controls style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', gap: 8 }}><Play size={18} /> No video set</div>
        )}
      </div>
      {config.caption && <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 8, textAlign: 'center' }}>{config.caption}</div>}
    </div>
  )
}

function TwoColumnTextBlock({ config }) {
  const reverse = config.image_position === 'left'
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'center', flexDirection: reverse ? 'row-reverse' : 'row' }}>
      <div style={{ flex: '1 1 280px' }}>
        {config.image_url ? <img src={config.image_url} alt="" style={{ width: '100%', borderRadius: 14, display: 'block' }} /> : <div style={{ width: '100%', aspectRatio: '4/3', borderRadius: 14, background: '#f1f5f9' }} />}
      </div>
      <div style={{ flex: '1 1 320px' }}>
        <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 800, fontSize: 24, marginBottom: 10 }}>{config.heading || 'Section heading'}</div>
        <div style={{ fontSize: 14, color: '#475569', lineHeight: 1.65, marginBottom: config.cta_label ? 18 : 0 }}>{config.text || ''}</div>
        {config.cta_label && <button className="btn btn-primary" onClick={handleCtaClick(config)}>{config.cta_label}</button>}
      </div>
    </div>
  )
}

function SpacerBlock({ config }) {
  return <div style={{ height: Math.max(4, Number(config.height_px) || 40) }} />
}

function QuoteBlock({ config }) {
  return (
    <div style={{ textAlign: 'center', padding: '20px 24px' }}>
      <Quote size={26} color="#c7d2fe" style={{ marginBottom: 10 }} />
      <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 'clamp(18px,2.6vw,26px)', fontWeight: 700, color: '#1e1b4b', lineHeight: 1.4, marginBottom: 10 }}>&ldquo;{config.quote || 'A powerful quote goes here.'}&rdquo;</div>
      {config.author && <div style={{ fontSize: 13, fontWeight: 700, color: '#64748b' }}>— {config.author}</div>}
    </div>
  )
}

function IconTextRowBlock({ config }) {
  const items = config.items || []
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
      {items.map((it, i) => {
        const a = accent(i)
        return (
          <div key={i} style={{ flex: '1 1 200px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: a.bg, color: a.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><IconOrIndex>{it.icon || '✓'}</IconOrIndex></div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{it.title}</div>
              <div style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.5 }}>{it.description}</div>
            </div>
          </div>
        )
      })}
      {items.length === 0 && <div style={{ color: '#94a3b8', fontSize: 12 }}>No items added</div>}
    </div>
  )
}

const SOCIAL_ICON = { twitter: Twitter, linkedin: Linkedin, facebook: Facebook }
// Each column holds up to 3 fixed link slots (link1_label/url .. link3_label/url)
// rather than a nested links[] array — the shared ObjectList editor
// primitive (editors.jsx) is single-level only, and a fixed small slot
// count is simpler/safer than building a two-level nested list editor
// for what's typically a short footer nav anyway.
function FooterBlock({ config }) {
  const columns = config.columns || []
  const socials = config.social_links || []
  return (
    <div style={{ background: '#0f172a', color: '#cbd5e1', borderRadius: 16, padding: '32px 28px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, marginBottom: 28 }}>
        <div style={{ flex: '1 1 200px' }}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 800, fontSize: 18, color: '#fff', marginBottom: 8 }}>{config.logo_text || 'Your Brand'}</div>
          {socials.length > 0 && (
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              {socials.map((s, i) => {
                const Icon = SOCIAL_ICON[s.platform] || Twitter
                return <a key={i} href={s.url || '#'} style={{ color: '#94a3b8' }}><Icon size={16} /></a>
              })}
            </div>
          )}
        </div>
        {columns.map((col, i) => {
          const links = [[col.link1_label, col.link1_url], [col.link2_label, col.link2_url], [col.link3_label, col.link3_url]].filter(([l]) => l)
          return (
            <div key={i} style={{ flex: '1 1 140px' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#fff', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>{col.heading}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {links.map(([l, u], j) => <a key={j} href={u || '#'} style={{ color: '#94a3b8', fontSize: 12.5, textDecoration: 'none' }}>{l}</a>)}
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ borderTop: '1px solid #1e293b', paddingTop: 16, fontSize: 11.5, color: '#64748b' }}>{config.copyright_text || `© ${new Date().getFullYear()} — all rights reserved.`}</div>
    </div>
  )
}

function TeamGridBlock({ config }) {
  const items = config.items || []
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
      {items.map((m, i) => (
        <div key={i} style={{ flex: '1 1 150px', textAlign: 'center' }}>
          {m.photo_url ? <img src={m.photo_url} alt="" style={{ width: 84, height: 84, borderRadius: '50%', objectFit: 'cover', margin: '0 auto 10px' }} />
            : <div style={{ width: 84, height: 84, borderRadius: '50%', background: accent(i).bg, color: accent(i).fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 22, margin: '0 auto 10px' }}>{initials(m.name)}</div>}
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{m.name}</div>
          <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{m.role}</div>
        </div>
      ))}
      {items.length === 0 && <div style={{ color: '#94a3b8', fontSize: 12 }}>No team members added</div>}
    </div>
  )
}

function AboutSectionBlock({ config }) {
  const reverse = config.image_position === 'left'
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 26, alignItems: 'center', flexDirection: reverse ? 'row-reverse' : 'row' }}>
      <div style={{ flex: '1 1 260px' }}>
        {config.image_url ? <img src={config.image_url} alt="" style={{ width: '100%', borderRadius: 14 }} /> : <div style={{ width: '100%', aspectRatio: '1/1', borderRadius: 14, background: '#f1f5f9' }} />}
      </div>
      <div style={{ flex: '1 1 320px' }}>
        <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 800, fontSize: 22, marginBottom: 10 }}>{config.heading || 'About us'}</div>
        <div style={{ fontSize: 14, color: '#475569', lineHeight: 1.7, whiteSpace: 'pre-line' }}>{config.text}</div>
      </div>
    </div>
  )
}

function MapEmbedBlock({ config }) {
  const h = Math.max(200, Number(config.map_height) || 320)
  return (
    <div>
      <div style={{ width: '100%', height: h, borderRadius: 12, overflow: 'hidden', background: '#f1f5f9' }}>
        {config.map_embed_url ? <iframe title="Map" src={config.map_embed_url} style={{ width: '100%', height: '100%', border: 'none' }} loading="lazy" />
          : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', gap: 8 }}><MapPin size={18} /> No map embed URL set</div>}
      </div>
      {config.address && <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 8 }}><MapPin size={13} style={{ verticalAlign: -2 }} /> {config.address}</div>}
    </div>
  )
}

const CONTACT_ICON = { phone: Phone, email: Mail, address: MapPin, hours: Clock }
function ContactInfoBlock({ config }) {
  const items = config.items || []
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
      {items.map((it, i) => {
        const Icon = CONTACT_ICON[it.icon_type] || Mail
        const a = accent(i)
        return (
          <div key={i} style={{ flex: '1 1 180px', display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: a.bg, color: a.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={16} /></div>
            <div>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>{it.label}</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{it.value}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ── sales ── */

function LogoCloudBlock({ config }) {
  const logos = config.logos || []
  return (
    <div>
      {config.heading && <div style={{ textAlign: 'center', fontSize: 11.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 16 }}>{config.heading}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'center', justifyContent: 'center' }}>
        {logos.map((l, i) => l.image_url
          ? <img key={i} src={l.image_url} alt={l.name || ''} style={{ height: 28, opacity: 0.7, filter: 'grayscale(1)' }} />
          : <span key={i} style={{ fontWeight: 800, fontSize: 15, color: '#94a3b8' }}>{l.name}</span>)}
        {logos.length === 0 && <div style={{ color: '#94a3b8', fontSize: 12 }}>No logos added</div>}
      </div>
    </div>
  )
}

function TestimonialGridBlock({ config }) {
  const items = config.items || []
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
      {items.map((t, i) => (
        <div key={i} style={{ ...cardBase, flex: '1 1 240px', background: 'linear-gradient(135deg,#fdf4ff,#fff)' }}>
          <Quote size={18} color="#d8b4fe" style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 13.5, color: '#334155', marginBottom: 12, lineHeight: 1.5 }}>{t.quote}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {t.avatar_url ? <img src={t.avatar_url} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover' }} />
              : <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#d8b4fe', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 11 }}>{initials(t.author)}</div>}
            <div>
              <div style={{ fontWeight: 700, fontSize: 12.5 }}>{t.author}</div>
              {t.role && <div style={{ fontSize: 11, color: '#94a3b8' }}>{t.role}</div>}
            </div>
          </div>
        </div>
      ))}
      {items.length === 0 && <div style={{ color: '#94a3b8', fontSize: 12 }}>No testimonials added</div>}
    </div>
  )
}

function ReviewStarsBlock({ config }) {
  const rating = Math.min(5, Math.max(0, Number(config.rating) || 5))
  return (
    <div style={{ ...cardBase, textAlign: 'center' }}>
      <div style={{ display: 'flex', gap: 3, justifyContent: 'center', marginBottom: 8 }}>
        {[1, 2, 3, 4, 5].map(n => <Star key={n} size={18} fill={n <= rating ? '#f59e0b' : 'none'} color="#f59e0b" />)}
      </div>
      <div style={{ fontWeight: 800, fontSize: 15 }}>{rating.toFixed(1)} / 5</div>
      {config.review_count && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{config.review_count} reviews {config.source_label ? `on ${config.source_label}` : ''}</div>}
    </div>
  )
}

function CaseStudyCardBlock({ config }) {
  return (
    <div style={{ ...cardBase, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {config.logo_url ? <img src={config.logo_url} alt="" style={{ height: 26, alignSelf: 'flex-start' }} /> : <div style={{ fontWeight: 800, fontSize: 15 }}>{config.company_name}</div>}
      <div style={{ fontSize: 28, fontWeight: 800, background: 'linear-gradient(135deg,#6366f1,#4338ca)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{config.result_stat}</div>
      <div style={{ fontSize: 13, color: '#475569' }}>{config.result_label}</div>
      {config.link_url && <a href={config.link_url} style={{ fontSize: 12.5, fontWeight: 700, color: '#4338ca', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>Read case study <ArrowRight size={13} /></a>}
    </div>
  )
}

function VideoTestimonialBlock({ config }) {
  const embed = toEmbedUrl(config.video_url)
  return (
    <div style={cardBase}>
      <div style={{ width: '100%', aspectRatio: '16/9', borderRadius: 10, overflow: 'hidden', background: '#0f172a', marginBottom: 10 }}>
        {embed ? <iframe title="Testimonial video" src={embed} style={{ width: '100%', height: '100%', border: 'none' }} allowFullScreen />
          : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8' }}><Play size={18} /></div>}
      </div>
      <div style={{ fontWeight: 700, fontSize: 13 }}>{config.author}</div>
      {config.role && <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{config.role}</div>}
    </div>
  )
}

function StatGridBlock({ config }) {
  const items = config.items || []
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
      {items.map((s, i) => {
        const a = accent(i)
        return (
          <div key={i} style={{ ...cardBase, flex: '1 1 130px', textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: a.fg }}>{s.number}</div>
            <div style={{ fontSize: 11.5, color: '#64748b', fontWeight: 600, marginTop: 4 }}>{s.label}</div>
          </div>
        )
      })}
      {items.length === 0 && <div style={{ color: '#94a3b8', fontSize: 12 }}>No stats added</div>}
    </div>
  )
}

function ProgressBarStatBlock({ config }) {
  const pct = Math.min(100, Math.max(0, Number(config.percentage) || 0))
  return (
    <div style={cardBase}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
        <span>{config.label}</span><span>{pct}%</span>
      </div>
      <div style={{ height: 10, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: 'linear-gradient(90deg,#6366f1,#8b5cf6)' }} />
      </div>
    </div>
  )
}

// Animated count-up, triggered once when scrolled into view (IntersectionObserver) —
// consistent with the small self-contained interactivity already used
// elsewhere (Carousel autoplay, FAQItem toggle).
function CounterBlockBlock({ config }) {
  const [count, setCount] = useState(0)
  const ref = useRef(null)
  const end = Number(config.end_number) || 0
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      const duration = 1200, steps = 30, stepMs = duration / steps
      let i = 0
      const t = setInterval(() => {
        i++
        setCount(Math.round((end * i) / steps))
        if (i >= steps) clearInterval(t)
      }, stepMs)
      obs.disconnect()
    }, { threshold: 0.4 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [end])
  return (
    <div ref={ref} style={{ ...cardBase, textAlign: 'center' }}>
      <div style={{ fontSize: 32, fontWeight: 800, color: '#4338ca' }}>{count}{config.suffix}</div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, fontWeight: 600 }}>{config.label}</div>
    </div>
  )
}

function StepGroupBlock({ config }) {
  const items = config.items || []
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
      {items.map((s, i) => {
        const a = accent(i)
        return (
          <div key={i} style={{ ...cardBase, flex: '1 1 200px' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: a.fg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, marginBottom: 10 }}>{i + 1}</div>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>{s.title}</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{s.description}</div>
          </div>
        )
      })}
      {items.length === 0 && <div style={{ color: '#94a3b8', fontSize: 12 }}>No steps added</div>}
    </div>
  )
}

function TimelineBlockBlock({ config }) {
  const items = config.items || []
  return (
    <div style={{ position: 'relative', paddingLeft: 24 }}>
      <div style={{ position: 'absolute', left: 5, top: 4, bottom: 4, width: 2, background: '#e2e8f0' }} />
      {items.map((it, i) => (
        <div key={i} style={{ position: 'relative', paddingBottom: 20 }}>
          <div style={{ position: 'absolute', left: -24, top: 3, width: 12, height: 12, borderRadius: '50%', background: accent(i).fg, border: '2px solid #fff', boxShadow: '0 0 0 2px #e2e8f0' }} />
          <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>{it.date}</div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{it.title}</div>
          <div style={{ fontSize: 12.5, color: '#64748b' }}>{it.description}</div>
        </div>
      ))}
      {items.length === 0 && <div style={{ color: '#94a3b8', fontSize: 12 }}>No timeline items added</div>}
    </div>
  )
}

/* ── product ── */

function FeatureGridBlock({ config }) {
  const items = config.items || []
  const cols = Math.min(4, Math.max(2, Number(config.columns) || 3))
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols},1fr)`, gap: 16 }}>
      {items.map((f, i) => {
        const a = accent(i)
        return (
          <div key={i} style={cardBase}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: a.bg, color: a.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, marginBottom: 10 }}>{f.icon || '⚡'}</div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{f.title}</div>
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>{f.description}</div>
          </div>
        )
      })}
      {items.length === 0 && <div style={{ color: '#94a3b8', fontSize: 12 }}>No features added</div>}
    </div>
  )
}

function FeatureHighlightBlock({ config }) {
  const reverse = config.image_position === 'left'
  const bullets = config.bullet_points || []
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'center', flexDirection: reverse ? 'row-reverse' : 'row' }}>
      <div style={{ flex: '1 1 300px' }}>
        {config.image_url ? <img src={config.image_url} alt="" style={{ width: '100%', borderRadius: 14, boxShadow: '0 12px 30px rgba(15,23,42,.12)' }} /> : <div style={{ width: '100%', aspectRatio: '4/3', borderRadius: 14, background: '#f1f5f9' }} />}
      </div>
      <div style={{ flex: '1 1 300px' }}>
        {config.eyebrow && <div style={{ fontSize: 11, fontWeight: 800, color: '#4338ca', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>{config.eyebrow}</div>}
        <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 800, fontSize: 24, marginBottom: 10 }}>{config.title}</div>
        <div style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, marginBottom: bullets.length ? 14 : 0 }}>{config.description}</div>
        {bullets.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {bullets.map((b, i) => <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}><Check size={15} color="#15803d" /> {b}</li>)}
          </ul>
        )}
      </div>
    </div>
  )
}

function IntegrationGridBlock({ config }) {
  const logos = config.logos || []
  return (
    <div>
      {config.heading && <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 14, textAlign: 'center', fontFamily: "'Playfair Display',serif" }}>{config.heading}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(logos.length || 1, 6)},1fr)`, gap: 12 }}>
        {logos.map((l, i) => (
          <div key={i} style={{ ...cardBase, padding: 14, textAlign: 'center' }}>
            {l.image_url ? <img src={l.image_url} alt={l.name || ''} style={{ height: 28, margin: '0 auto' }} /> : <div style={{ fontWeight: 700, fontSize: 12 }}>{l.name}</div>}
          </div>
        ))}
      </div>
      {logos.length === 0 && <div style={{ color: '#94a3b8', fontSize: 12 }}>No integrations added</div>}
    </div>
  )
}

const FRAME_STYLE = {
  browser: { padding: '28px 12px 12px', background: '#1e293b', borderRadius: 14 },
  device: { padding: '18px 10px', background: '#0f172a', borderRadius: 28 },
  none: {},
}
function ScreenshotShowcaseBlock({ config }) {
  const frame = FRAME_STYLE[config.frame_style] || FRAME_STYLE.browser
  return (
    <div>
      <div style={{ ...frame, position: 'relative' }}>
        {config.frame_style !== 'none' && config.frame_style !== 'device' && (
          <div style={{ position: 'absolute', top: 10, left: 14, display: 'flex', gap: 6 }}>
            {['#ef4444', '#f59e0b', '#22c55e'].map(c => <span key={c} style={{ width: 9, height: 9, borderRadius: '50%', background: c }} />)}
          </div>
        )}
        {config.image_url ? <img src={config.image_url} alt="" style={{ width: '100%', borderRadius: config.frame_style === 'device' ? 16 : 6, display: 'block' }} /> : <div style={{ width: '100%', aspectRatio: '16/10', borderRadius: 8, background: '#334155' }} />}
      </div>
      {config.caption && <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 10, textAlign: 'center' }}>{config.caption}</div>}
    </div>
  )
}

// Draggable before/after comparison — same hand-rolled Pointer Events
// pattern as CarouselBlock (renderers.jsx), just driving a clip-path
// reveal instead of a slide transform.
function BeforeAfterSliderBlock({ config }) {
  const [pct, setPct] = useState(50)
  const ref = useRef(null)
  const dragging = useRef(false)
  function updateFromClientX(clientX) {
    const rect = ref.current.getBoundingClientRect()
    setPct(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)))
  }
  function onPointerDown(e) { dragging.current = true; updateFromClientX(e.clientX); e.currentTarget.setPointerCapture(e.pointerId) }
  function onPointerMove(e) { if (dragging.current) updateFromClientX(e.clientX) }
  function onPointerUp() { dragging.current = false }

  if (!config.before_image_url && !config.after_image_url) {
    return <div style={{ width: '100%', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12, background: '#f1f5f9', borderRadius: 12 }}>Add a before and after image</div>
  }
  return (
    <div ref={ref} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      style={{ position: 'relative', width: '100%', aspectRatio: '16/9', borderRadius: 14, overflow: 'hidden', cursor: 'ew-resize', touchAction: 'none', userSelect: 'none' }}>
      {config.after_image_url && <img src={config.after_image_url} alt="After" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
      {config.before_image_url && (
        <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, overflow: 'hidden' }}>
          <img src={config.before_image_url} alt="Before" draggable={false} style={{ width: `${100 / (pct / 100 || 1)}%`, maxWidth: 'none', height: '100%', objectFit: 'cover' }} />
        </div>
      )}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${pct}%`, width: 3, background: '#fff', transform: 'translateX(-50%)', boxShadow: '0 0 8px rgba(0,0,0,.4)' }} />
      <div style={{ position: 'absolute', top: '50%', left: `${pct}%`, transform: 'translate(-50%,-50%)', width: 32, height: 32, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,.3)', fontSize: 12 }}>↔</div>
      {config.before_label && <div style={{ position: 'absolute', bottom: 10, left: 10, background: 'rgba(15,23,42,.65)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6 }}>{config.before_label}</div>}
      {config.after_label && <div style={{ position: 'absolute', bottom: 10, right: 10, background: 'rgba(15,23,42,.65)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6 }}>{config.after_label}</div>}
    </div>
  )
}

/* ── conversion ── */

// plan.features / plan.highlighted are flat strings (newline-separated
// list, 'yes'/'no') rather than a nested array/boolean — the shared
// ObjectList editor primitive (editors.jsx) only produces flat text
// fields per row, so each plan's shape matches what that editor can
// actually write, same convention as ComparisonTable's existing
// yes/no text columns.
function PricingTableBlock({ config }) {
  const plans = config.plans || []
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
      {plans.map((p, i) => {
        const highlighted = (p.highlighted || '').trim().toLowerCase() === 'yes'
        const features = (p.features || '').split(',').map(f => f.trim()).filter(Boolean)
        return (
          <div key={i} style={{ ...cardBase, flex: '1 1 220px', textAlign: 'center', border: highlighted ? '2px solid #6366f1' : cardBase.border, background: highlighted ? 'linear-gradient(135deg,#f8fafc,#fff)' : '#fff' }}>
            {highlighted && <div style={{ fontSize: 10, fontWeight: 800, color: '#4338ca', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Most Popular</div>}
            <div style={{ fontWeight: 700, fontSize: 13, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.03em' }}>{p.name}</div>
            <div style={{ fontSize: 26, fontWeight: 800, margin: '8px 0' }}>{p.price}{p.period && <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>/{p.period}</span>}</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', fontSize: 12.5, color: '#334155', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {features.map((f, j) => <li key={j} style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}><Check size={13} color="#15803d" /> {f}</li>)}
            </ul>
            <button className={highlighted ? 'btn btn-primary' : 'btn btn-outline'} style={{ width: '100%' }} onClick={handleCtaClick({ ...config, cta_action: 'scroll_to_form' })}>{p.cta_label || 'Choose Plan'}</button>
          </div>
        )
      })}
      {plans.length === 0 && <div style={{ color: '#94a3b8', fontSize: 12 }}>No plans added</div>}
    </div>
  )
}

function PricingToggleBlock({ config }) {
  const [annual, setAnnual] = useState(false)
  const price = annual ? config.annual_price : config.monthly_price
  return (
    <div style={{ ...cardBase, textAlign: 'center', border: '2px solid #6366f1' }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: '#64748b', textTransform: 'uppercase' }}>{config.plan_name || 'Plan'}</div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#f1f5f9', borderRadius: 999, padding: 4, margin: '12px 0' }}>
        <button type="button" onClick={() => setAnnual(false)} style={{ border: 'none', borderRadius: 999, padding: '5px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', background: !annual ? '#fff' : 'transparent', boxShadow: !annual ? '0 1px 2px rgba(0,0,0,.08)' : 'none' }}>Monthly</button>
        <button type="button" onClick={() => setAnnual(true)} style={{ border: 'none', borderRadius: 999, padding: '5px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', background: annual ? '#fff' : 'transparent', boxShadow: annual ? '0 1px 2px rgba(0,0,0,.08)' : 'none' }}>Annual</button>
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, margin: '4px 0 16px' }}>{price || 'Contact us'}</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 7 }}>
        {(config.features || []).map((f, i) => <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}><Check size={14} color="#15803d" /> {f}</li>)}
      </ul>
      <button className="btn btn-primary" onClick={handleCtaClick(config)}>{config.cta_label || 'Get Started'}</button>
    </div>
  )
}

function CTABannerBlock({ config }) {
  return (
    <div style={{ textAlign: 'center', padding: '36px 28px', borderRadius: 16, background: bgStyle(config.background_style), color: '#fff' }}>
      <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 800, fontSize: 'clamp(20px,3vw,30px)', marginBottom: 8 }}>{config.headline || 'Ready to get started?'}</div>
      {config.subheadline && <div style={{ fontSize: 14, opacity: 0.9, marginBottom: 20, maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>{config.subheadline}</div>}
      {config.cta_label && <button className="btn" style={{ background: '#fff', color: '#312e81', padding: '12px 28px', fontWeight: 800, borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 14 }} onClick={handleCtaClick(config)}>{config.cta_label}</button>}
    </div>
  )
}

// Renders as a normal in-flow bar (not position:fixed) in both the
// builder and the public page — the component has no signal to tell
// whether it's being edited or published, so gating a fixed position
// safely isn't possible here without threading new context through
// every renderer. Documented scope limit: place it deliberately near
// the top/bottom of the page for a sticky-like feel.
function StickyCTABlock({ config }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 20px', borderRadius: 12, background: '#0f172a', color: '#fff', flexWrap: 'wrap' }}>
      <span style={{ fontWeight: 700, fontSize: 13.5 }}>{config.label || 'Ready when you are.'}</span>
      {config.cta_label && <button className="btn btn-primary btn-sm" onClick={handleCtaClick(config)}>{config.cta_label}</button>}
    </div>
  )
}

function GuaranteeBadgeBlock({ config }) {
  const items = config.items || []
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, justifyContent: 'center', alignItems: 'center', padding: '16px 0' }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>{it.icon || '🛡️'}</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#334155' }}>{it.text}</span>
        </div>
      ))}
      {items.length === 0 && <div style={{ color: '#94a3b8', fontSize: 12 }}>No badges added</div>}
    </div>
  )
}

function pad2(n) { return String(n).padStart(2, '0') }
function UrgencyCountdownBlock({ config }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const deadline = config.deadline_iso ? new Date(config.deadline_iso).getTime() : null
  const remaining = deadline ? Math.max(0, deadline - now) : 0
  const d = Math.floor(remaining / 86400000), h = Math.floor((remaining % 86400000) / 3600000), m = Math.floor((remaining % 3600000) / 60000), s = Math.floor((remaining % 60000) / 1000)
  return (
    <div style={{ ...cardBase, textAlign: 'center', background: '#0f172a', color: '#fff' }}>
      {config.label && <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10, opacity: 0.85 }}>{config.label}</div>}
      {deadline ? (
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center' }}>
          {[[d, 'Days'], [h, 'Hrs'], [m, 'Min'], [s, 'Sec']].map(([v, l]) => (
            <div key={l}><div style={{ fontSize: 24, fontWeight: 800 }}>{pad2(v)}</div><div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase' }}>{l}</div></div>
          ))}
        </div>
      ) : <div style={{ fontSize: 12, opacity: 0.7 }}>Set a deadline</div>}
    </div>
  )
}

function NewsletterSignupBlock({ config, slug }) {
  return (
    <div style={{ ...cardBase, textAlign: 'center' }}>
      {config.headline && <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>{config.headline}</div>}
      {config.subheadline && <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 14 }}>{config.subheadline}</div>}
      {slug ? <PublicLeadCaptureForm slug={slug} formConfig={{ ...config, standard_fields: { company: false, phone: false, email: true, message: false } }} />
        : <div style={{ fontSize: 12, color: '#94a3b8' }}>Email signup (preview — publish this page to a Landing Link to activate)</div>}
    </div>
  )
}

const SHARE_ICON = { twitter: Twitter, linkedin: Linkedin, facebook: Facebook }
function SocialShareBarBlock() {
  const [url, setUrl] = useState('')
  useEffect(() => { if (typeof window !== 'undefined') setUrl(window.location.href) }, [])
  const links = {
    twitter: `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  }
  return (
    <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
      {Object.entries(SHARE_ICON).map(([k, Icon]) => (
        <a key={k} href={links[k]} target="_blank" rel="noopener noreferrer" style={{ width: 36, height: 36, borderRadius: '50%', background: '#f1f5f9', color: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={16} /></a>
      ))}
    </div>
  )
}

function FAQGroupBlock({ config }) {
  const items = config.items || []
  const [openIdx, setOpenIdx] = useState(-1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((it, i) => (
        <div key={i} style={{ ...cardBase, padding: 0, cursor: 'pointer' }} onClick={() => setOpenIdx(p => p === i ? -1 : i)}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, gap: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{it.question}</div>
            <ChevronDown size={15} color="#94a3b8" style={{ flexShrink: 0, transition: 'transform .15s', transform: openIdx === i ? 'rotate(180deg)' : 'none' }} />
          </div>
          {openIdx === i && <div style={{ fontSize: 12.5, color: '#64748b', padding: '0 16px 16px', lineHeight: 1.5 }}>{it.answer}</div>}
        </div>
      ))}
      {items.length === 0 && <div style={{ color: '#94a3b8', fontSize: 12 }}>No FAQs added</div>}
    </div>
  )
}

export const GROWTH_RENDER_COMPONENTS = {
  AnnouncementBar: AnnouncementBarBlock, HeroSplit: HeroSplitBlock, VideoEmbed: VideoEmbedBlock, TwoColumnText: TwoColumnTextBlock,
  SpacerBlock: SpacerBlock, QuoteBlock: QuoteBlock, IconTextRow: IconTextRowBlock, Footer: FooterBlock,
  TeamGrid: TeamGridBlock, AboutSection: AboutSectionBlock, MapEmbed: MapEmbedBlock, ContactInfoBlock: ContactInfoBlock,
  LogoCloud: LogoCloudBlock, TestimonialGrid: TestimonialGridBlock, ReviewStars: ReviewStarsBlock, CaseStudyCard: CaseStudyCardBlock,
  VideoTestimonial: VideoTestimonialBlock, StatGrid: StatGridBlock, ProgressBarStat: ProgressBarStatBlock, CounterBlock: CounterBlockBlock,
  StepGroup: StepGroupBlock, TimelineBlock: TimelineBlockBlock,
  FeatureGrid: FeatureGridBlock, FeatureHighlight: FeatureHighlightBlock, IntegrationGrid: IntegrationGridBlock,
  ScreenshotShowcase: ScreenshotShowcaseBlock, BeforeAfterSlider: BeforeAfterSliderBlock,
  PricingTable: PricingTableBlock, PricingToggle: PricingToggleBlock, CTABanner: CTABannerBlock, StickyCTA: StickyCTABlock,
  GuaranteeBadge: GuaranteeBadgeBlock, UrgencyCountdown: UrgencyCountdownBlock, NewsletterSignup: NewsletterSignupBlock,
  SocialShareBar: SocialShareBarBlock, FAQGroup: FAQGroupBlock,
}
