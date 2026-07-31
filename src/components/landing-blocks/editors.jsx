// Config-editing forms — one per block_type, rendered in the builder's
// side panel when a block is selected. Each receives `config` (the
// block's current content) and `onChange(nextConfig)`, called on every
// field edit; the builder itself decides when to persist (see
// src/components/LandingPageBuilder.jsx).
import { useState, useEffect } from 'react'
import { uploadLandingAsset } from '../../lib/landingPageStorage'
import { listMeetingPages } from '../../lib/meetingBookingPages'
import { Trash2, Plus, Upload } from 'lucide-react'

// Exported (STEP89 growth catalog) — src/components/landing-blocks/growthEditors.jsx
// reuses these shared field primitives instead of duplicating them.
export const field = { marginBottom: 12 }
export const label = { display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.03em' }

export function Text({ lbl, value, onChange, placeholder }) {
  return <div style={field}><label style={label}>{lbl}</label><input className="form-input" value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></div>
}
export function TextArea({ lbl, value, onChange, placeholder }) {
  return <div style={field}><label style={label}>{lbl}</label><textarea className="form-textarea" value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></div>
}
export function NumberF({ lbl, value, onChange }) {
  return <div style={field}><label style={label}>{lbl}</label><input className="form-input" type="number" value={value ?? ''} onChange={e => onChange(e.target.value)} /></div>
}
// URL field + real file upload (STEP80's public 'landing-assets' bucket) — manual paste still works.
export function ImageUploadField({ lbl, value, onChange }) {
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true); setErr('')
    try { onChange(await uploadLandingAsset(file)) }
    catch (er) { setErr(er.message) } finally { setUploading(false) }
  }
  return (
    <div style={field}>
      <label style={label}>{lbl}</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input className="form-input" style={{ flex: 1 }} value={value || ''} onChange={e => onChange(e.target.value)} placeholder="https://… or upload" />
        <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <Upload size={12} /> {uploading ? 'Uploading…' : 'Upload'}
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} disabled={uploading} />
        </label>
      </div>
      {err && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>{err}</div>}
      {value && <img src={value} alt="" style={{ marginTop: 6, maxHeight: 80, borderRadius: 6, border: '1px solid var(--border)' }} />}
    </div>
  )
}
// Simple string-list editor (Trust Bar items, Pricing features, Product Grid part numbers).
export function StringList({ lbl, items, onChange, placeholder }) {
  const list = items || []
  function set(i, v) { const next = [...list]; next[i] = v; onChange(next) }
  function add() { onChange([...list, '']) }
  function remove(i) { onChange(list.filter((_, idx) => idx !== i)) }
  return (
    <div style={field}>
      <label style={label}>{lbl}</label>
      {list.map((v, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input className="form-input" style={{ fontSize: 12.5 }} value={v} onChange={e => set(i, e.target.value)} placeholder={placeholder} />
          <button type="button" className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => remove(i)}><Trash2 size={12} /></button>
        </div>
      ))}
      <button type="button" className="btn btn-outline btn-sm" onClick={add}><Plus size={12} /> Add</button>
    </div>
  )
}
// Repeating object-list editor (Comparison rows, generic {a,b,c} shapes).
export function ObjectList({ lbl, items, fields: keys, onChange }) {
  const list = items || []
  function set(i, key, v) { const next = list.map((r, idx) => idx === i ? { ...r, [key]: v } : r); onChange(next) }
  function add() { onChange([...list, Object.fromEntries(keys.map(k => [k.key, '']))]) }
  function remove(i) { onChange(list.filter((_, idx) => idx !== i)) }
  return (
    <div style={field}>
      <label style={label}>{lbl}</label>
      {list.map((row, i) => (
        <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, marginBottom: 8 }}>
          {keys.map(k => (
            <input key={k.key} className="form-input" style={{ fontSize: 12.5, marginBottom: 4 }} placeholder={k.label} value={row[k.key] || ''} onChange={e => set(i, k.key, e.target.value)} />
          ))}
          <button type="button" className="btn btn-ghost btn-sm" style={{ color: '#ef4444' }} onClick={() => remove(i)}><Trash2 size={12} /> Remove</button>
        </div>
      ))}
      <button type="button" className="btn btn-outline btn-sm" onClick={add}><Plus size={12} /> Add</button>
    </div>
  )
}
// Shared by Hero/Button/PricingCard/Header — "where does this button
// go". Default (no cta_action stored yet, i.e. every block created
// before STEP80) reads as 'scroll_to_form' in the renderer, so this only
// needs to show what's actually selected.
//
// 'meeting_page' (STEP87+) maps the button straight to one of the admin's
// existing Meeting Booking Pages (src/pages/MeetingBookingPagesPage.jsx,
// /book/:slug) by picking it from a dropdown rather than requiring the
// marketer to know/paste its raw URL — stores cta_meeting_page_slug, and
// handleCtaClick() in renderers.jsx resolves that to /book/:slug at click
// time.
export function CTAActionFields({ config, onChange }) {
  const action = config.cta_action || 'scroll_to_form'
  const [meetingPages, setMeetingPages] = useState([])
  useEffect(() => { listMeetingPages().then(setMeetingPages).catch(() => setMeetingPages([])) }, [])

  return (
    <div style={field}>
      <label style={label}>Button Action</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
          <input type="radio" checked={action === 'scroll_to_form'} onChange={() => onChange({ ...config, cta_action: 'scroll_to_form' })} /> Scroll to Lead Form
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
          <input type="radio" checked={action === 'meeting_page'} onChange={() => onChange({ ...config, cta_action: 'meeting_page' })} /> Meeting Booking Page
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
          <input type="radio" checked={action === 'url'} onChange={() => onChange({ ...config, cta_action: 'url' })} /> Custom URL
        </label>
      </div>
      {action === 'url' && <input className="form-input" style={{ marginTop: 6 }} value={config.cta_url || ''} onChange={e => onChange({ ...config, cta_url: e.target.value })} placeholder="https://…" />}
      {action === 'meeting_page' && (
        <div style={{ marginTop: 6 }}>
          <select className="form-select" value={config.cta_meeting_page_slug || ''} onChange={e => onChange({ ...config, cta_meeting_page_slug: e.target.value })}>
            <option value="">Select a booking page…</option>
            {meetingPages.map(p => <option key={p.id} value={p.slug}>{p.campaign_name}</option>)}
          </select>
          {meetingPages.length === 0 && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>No Meeting Booking Pages yet — create one from Sales → Meeting Booking.</div>}
        </div>
      )}
    </div>
  )
}

export const set = (config, onChange, key) => (v) => onChange({ ...config, [key]: v })

function HeaderEditor({ config, onChange }) {
  return <>
    <Text lbl="Logo / Brand Text" value={config.logo_text} onChange={set(config, onChange, 'logo_text')} />
    <ObjectList lbl="Menu Items" items={config.menu_items} onChange={v => onChange({ ...config, menu_items: v })}
      fields={[{ key: 'label', label: 'Label' }, { key: 'url', label: 'Link (# or https://…)' }]} />
    <Text lbl="Button Label (optional)" value={config.cta_label} onChange={set(config, onChange, 'cta_label')} />
    {config.cta_label && <CTAActionFields config={config} onChange={onChange} />}
  </>
}

function HeroEditor({ config, onChange }) {
  return <>
    <Text lbl="Headline" value={config.headline} onChange={set(config, onChange, 'headline')} />
    <TextArea lbl="Subheadline" value={config.subheadline} onChange={set(config, onChange, 'subheadline')} />
    <ImageUploadField lbl="Background Image" value={config.image_url} onChange={set(config, onChange, 'image_url')} />
    <Text lbl="Eyebrow (small text above headline)" value={config.eyebrow} onChange={set(config, onChange, 'eyebrow')} />
    <Text lbl="Button Label" value={config.cta_label} onChange={set(config, onChange, 'cta_label')} />
    <CTAActionFields config={config} onChange={onChange} />
  </>
}
function HeadingEditor({ config, onChange }) {
  return <>
    <Text lbl="Text" value={config.text} onChange={set(config, onChange, 'text')} />
    <NumberF lbl="Level (1-6)" value={config.level} onChange={v => onChange({ ...config, level: Number(v) || 2 })} />
  </>
}
function ParagraphEditor({ config, onChange }) { return <TextArea lbl="Text" value={config.text} onChange={set(config, onChange, 'text')} /> }
function ImageEditor({ config, onChange }) {
  return <>
    <ImageUploadField lbl="Image" value={config.image_url} onChange={set(config, onChange, 'image_url')} />
    <Text lbl="Alt Text" value={config.alt} onChange={set(config, onChange, 'alt')} />
  </>
}
function DividerEditor() { return <div style={{ fontSize: 12, color: '#94a3b8' }}>No settings for a divider.</div> }
function CarouselEditor({ config, onChange }) {
  const slides = config.slides || []
  function updateSlide(i, patch) { onChange({ ...config, slides: slides.map((s, idx) => idx === i ? { ...s, ...patch } : s) }) }
  function addSlide() { onChange({ ...config, slides: [...slides, { image_url: '', caption: '' }] }) }
  function removeSlide(i) { onChange({ ...config, slides: slides.filter((_, idx) => idx !== i) }) }
  return (
    <>
      <div style={field}>
        <label style={label}>Slides</label>
        {slides.map((s, i) => (
          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, marginBottom: 8 }}>
            <ImageUploadField lbl={`Slide ${i + 1} Image`} value={s.image_url} onChange={v => updateSlide(i, { image_url: v })} />
            <Text lbl="Caption (optional)" value={s.caption} onChange={v => updateSlide(i, { caption: v })} />
            <button type="button" className="btn btn-ghost btn-sm" style={{ color: '#ef4444' }} onClick={() => removeSlide(i)}><Trash2 size={12} /> Remove Slide</button>
          </div>
        ))}
        <button type="button" className="btn btn-outline btn-sm" onClick={addSlide}><Plus size={12} /> Add Slide</button>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, marginBottom: 8 }}>
        <input type="checkbox" checked={config.autoplay !== false} onChange={e => onChange({ ...config, autoplay: e.target.checked })} /> Autoplay
      </label>
      {config.autoplay !== false && <NumberF lbl="Seconds per slide" value={config.interval_seconds} onChange={v => onChange({ ...config, interval_seconds: Number(v) || 4 })} />}
    </>
  )
}
function TrustBarEditor({ config, onChange }) { return <StringList lbl="Items" items={config.items} onChange={v => onChange({ ...config, items: v })} placeholder="e.g. Trusted by 100+ customers" /> }
function FeatureCardEditor({ config, onChange }) {
  return <>
    <Text lbl="Icon (emoji)" value={config.icon} onChange={set(config, onChange, 'icon')} />
    <Text lbl="Title" value={config.title} onChange={set(config, onChange, 'title')} />
    <TextArea lbl="Description" value={config.description} onChange={set(config, onChange, 'description')} />
  </>
}
function TestimonialCardEditor({ config, onChange }) {
  return <>
    <TextArea lbl="Quote" value={config.quote} onChange={set(config, onChange, 'quote')} />
    <Text lbl="Author" value={config.author} onChange={set(config, onChange, 'author')} />
    <Text lbl="Role / Company" value={config.role} onChange={set(config, onChange, 'role')} />
    <ImageUploadField lbl="Photo (optional — falls back to initials)" value={config.avatar_url} onChange={set(config, onChange, 'avatar_url')} />
  </>
}
function StatBlockEditor({ config, onChange }) {
  return <>
    <Text lbl="Number" value={config.number} onChange={set(config, onChange, 'number')} />
    <Text lbl="Label" value={config.label} onChange={set(config, onChange, 'label')} />
  </>
}
function ComparisonTableEditor({ config, onChange }) {
  return <ObjectList lbl="Rows" items={config.rows} onChange={v => onChange({ ...config, rows: v })}
    fields={[{ key: 'feature', label: 'Feature' }, { key: 'us', label: 'Us' }, { key: 'competitor', label: 'Others' }]} />
}
function HowItWorksStepEditor({ config, onChange }) {
  return <>
    <NumberF lbl="Step Number" value={config.step_number} onChange={v => onChange({ ...config, step_number: Number(v) || 1 })} />
    <Text lbl="Title" value={config.title} onChange={set(config, onChange, 'title')} />
    <TextArea lbl="Description" value={config.description} onChange={set(config, onChange, 'description')} />
  </>
}
function ProductCardEditor({ config, onChange, products }) {
  return <>
    <div style={field}>
      <label style={label}>Product</label>
      <select className="form-select" value={config.product_part_number || ''} onChange={e => onChange({ ...config, product_part_number: e.target.value })}>
        <option value="">Select from catalog…</option>
        {(products || []).map(p => <option key={p.part_number} value={p.part_number}>{p.name}</option>)}
      </select>
    </div>
    <Text lbl="Title Override" value={config.override_title} onChange={set(config, onChange, 'override_title')} />
    <TextArea lbl="Description Override" value={config.override_description} onChange={set(config, onChange, 'override_description')} />
    <ImageUploadField lbl="Product Photo (optional — catalog has no image)" value={config.override_image_url} onChange={set(config, onChange, 'override_image_url')} />
  </>
}
function ProductGridEditor({ config, onChange, products }) {
  const selected = config.product_part_numbers || []
  const images = config.product_image_overrides || {}
  function toggle(pn) {
    onChange({ ...config, product_part_numbers: selected.includes(pn) ? selected.filter(x => x !== pn) : [...selected, pn] })
  }
  function setImage(pn, url) {
    onChange({ ...config, product_image_overrides: { ...images, [pn]: url } })
  }
  return (
    <div style={field}>
      <label style={label}>Products (from catalog)</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 160, overflowY: 'auto', marginBottom: 8 }}>
        {(products || []).map(p => (
          <label key={p.part_number} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, padding: '3px 8px', borderRadius: 999, background: selected.includes(p.part_number) ? '#eef2ff' : '#f8fafc', border: '1px solid var(--border)', cursor: 'pointer' }}>
            <input type="checkbox" checked={selected.includes(p.part_number)} onChange={() => toggle(p.part_number)} /> {p.name}
          </label>
        ))}
      </div>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {selected.map(pn => (
            <ImageUploadField key={pn} lbl={`Photo — ${products?.find(p => p.part_number === pn)?.name || pn}`} value={images[pn]} onChange={v => setImage(pn, v)} />
          ))}
        </div>
      )}
    </div>
  )
}
function PricingCardEditor({ config, onChange }) {
  return <>
    <Text lbl="Plan Name" value={config.plan_name} onChange={set(config, onChange, 'plan_name')} />
    <Text lbl="Price" value={config.price} onChange={set(config, onChange, 'price')} />
    <StringList lbl="Features" items={config.features} onChange={v => onChange({ ...config, features: v })} placeholder="Feature" />
    <Text lbl="Button Label" value={config.cta_label} onChange={set(config, onChange, 'cta_label')} />
    <CTAActionFields config={config} onChange={onChange} />
  </>
}
function FAQItemEditor({ config, onChange }) {
  return <>
    <Text lbl="Question" value={config.question} onChange={set(config, onChange, 'question')} />
    <TextArea lbl="Answer" value={config.answer} onChange={set(config, onChange, 'answer')} />
  </>
}
function ButtonEditor({ config, onChange }) {
  return <>
    <Text lbl="Label" value={config.label} onChange={set(config, onChange, 'label')} />
    <CTAActionFields config={config} onChange={onChange} />
  </>
}

const CUSTOM_FIELD_TYPES = [
  { id: 'text', label: 'Short text' }, { id: 'email', label: 'Email' }, { id: 'phone', label: 'Phone' },
  { id: 'textarea', label: 'Long text' }, { id: 'select', label: 'Dropdown' }, { id: 'checkbox', label: 'Checkbox' },
]
function slugifyKey(text) {
  return (text || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field'
}
// Real form builder: which standard sales_leads fields show, plus
// arbitrary marketer-defined questions (answers land in
// sales_leads.custom_fields JSONB — STEP80). Name is always shown/
// required (sales_leads.contact_name is NOT NULL); the UI blocks turning
// off BOTH Phone and Email since there'd be no way to reach the lead.
function LeadFormEditor({ config, onChange }) {
  const std = { company: true, phone: true, email: true, message: true, ...(config.standard_fields || {}) }
  const custom = config.custom_fields || []

  function toggleStd(key) {
    const next = { ...std, [key]: !std[key] }
    if (key === 'phone' || key === 'email') {
      if (!next.phone && !next.email) return // can't disable both — no way to reach the lead
    }
    onChange({ ...config, standard_fields: next })
  }
  function updateCustom(i, patch) {
    const next = custom.map((f, idx) => idx === i ? { ...f, ...patch } : f)
    onChange({ ...config, custom_fields: next })
  }
  function addCustom() {
    onChange({ ...config, custom_fields: [...custom, { key: `field_${custom.length + 1}`, label: 'New Question', type: 'text', required: false, options: [] }] })
  }
  function removeCustom(i) { onChange({ ...config, custom_fields: custom.filter((_, idx) => idx !== i) }) }

  return (
    <>
      <Text lbl="Headline" value={config.headline} onChange={set(config, onChange, 'headline')} />

      <div style={field}>
        <label style={label}>Standard Fields</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>Name — always shown, required</div>
          {[['company', 'Company'], ['phone', 'Phone'], ['email', 'Email'], ['message', 'Message']].map(([k, l]) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
              <input type="checkbox" checked={!!std[k]} onChange={() => toggleStd(k)} /> {l}
            </label>
          ))}
        </div>
        <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 4 }}>At least one of Phone/Email must stay on.</div>
      </div>

      <div style={field}>
        <label style={label}>Custom Questions</label>
        {custom.map((f, i) => (
          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, marginBottom: 8 }}>
            <input className="form-input" style={{ fontSize: 12.5, marginBottom: 4 }} placeholder="Question label" value={f.label}
              onChange={e => updateCustom(i, { label: e.target.value, key: slugifyKey(e.target.value) })} />
            <select className="form-select" style={{ fontSize: 12.5, marginBottom: 4 }} value={f.type} onChange={e => updateCustom(i, { type: e.target.value })}>
              {CUSTOM_FIELD_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            {f.type === 'select' && (
              <StringList lbl="Options" items={f.options} onChange={v => updateCustom(i, { options: v })} placeholder="Option" />
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, margin: '6px 0' }}>
              <input type="checkbox" checked={!!f.required} onChange={e => updateCustom(i, { required: e.target.checked })} /> Required
            </label>
            <button type="button" className="btn btn-ghost btn-sm" style={{ color: '#ef4444' }} onClick={() => removeCustom(i)}><Trash2 size={12} /> Remove Question</button>
          </div>
        ))}
        <button type="button" className="btn btn-outline btn-sm" onClick={addCustom}><Plus size={12} /> Add Question</button>
      </div>
    </>
  )
}

export const BLOCK_EDITOR_COMPONENTS = {
  Header: HeaderEditor,
  Hero: HeroEditor, Heading: HeadingEditor, Paragraph: ParagraphEditor, Image: ImageEditor, Divider: DividerEditor, Carousel: CarouselEditor,
  TrustBar: TrustBarEditor, FeatureCard: FeatureCardEditor, TestimonialCard: TestimonialCardEditor, StatBlock: StatBlockEditor,
  ComparisonTable: ComparisonTableEditor, HowItWorksStep: HowItWorksStepEditor,
  ProductCard: ProductCardEditor, ProductGrid: ProductGridEditor,
  PricingCard: PricingCardEditor, FAQItem: FAQItemEditor, Button: ButtonEditor, LeadForm: LeadFormEditor,
}
