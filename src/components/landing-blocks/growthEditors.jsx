// Growth catalog (STEP89) — editor forms for the 36 blocks in
// ./growthRenderers.jsx, reusing the shared field primitives from
// ./editors.jsx (Text, TextArea, NumberF, ImageUploadField, StringList,
// ObjectList, CTAActionFields, field, label, set) rather than duplicating
// them. Kept in a separate file so the original, already-verified
// editors stay untouched — see ./index.js for how the two maps merge.
import { Trash2, Plus } from 'lucide-react'
import { Text, TextArea, NumberF, ImageUploadField, StringList, ObjectList, CTAActionFields, field, label, set } from './editors'
import { BG_PRESETS } from './growthRenderers'

const BACKGROUND_OPTIONS = Object.keys(BG_PRESETS)
function BackgroundSelect({ config, onChange }) {
  return (
    <div style={field}>
      <label style={label}>Background Style</label>
      <select className="form-select" value={config.background_style || 'indigo'} onChange={e => onChange({ ...config, background_style: e.target.value })}>
        {BACKGROUND_OPTIONS.map(o => <option key={o} value={o}>{o[0].toUpperCase() + o.slice(1)}</option>)}
      </select>
    </div>
  )
}
function ImagePositionSelect({ config, onChange }) {
  return (
    <div style={field}>
      <label style={label}>Image Position</label>
      <select className="form-select" value={config.image_position || 'right'} onChange={e => onChange({ ...config, image_position: e.target.value })}>
        <option value="right">Right</option>
        <option value="left">Left</option>
      </select>
    </div>
  )
}
// Repeating {name, image_url} list (LogoCloud/IntegrationGrid logos) —
// ObjectList (editors.jsx) is text-input-only, so a small dedicated list
// editor with a real ImageUploadField per row lives here instead.
function LogoListEditor({ lbl, items, onChange }) {
  const list = items || []
  function setRow(i, patch) { onChange(list.map((r, idx) => idx === i ? { ...r, ...patch } : r)) }
  function add() { onChange([...list, { name: '', image_url: '' }]) }
  function remove(i) { onChange(list.filter((_, idx) => idx !== i)) }
  return (
    <div style={field}>
      <label style={label}>{lbl}</label>
      {list.map((row, i) => (
        <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, marginBottom: 8 }}>
          <input className="form-input" style={{ fontSize: 12.5, marginBottom: 4 }} placeholder="Name" value={row.name || ''} onChange={e => setRow(i, { name: e.target.value })} />
          <ImageUploadField lbl="Logo Image" value={row.image_url} onChange={v => setRow(i, { image_url: v })} />
          <button type="button" className="btn btn-ghost btn-sm" style={{ color: '#ef4444' }} onClick={() => remove(i)}><Trash2 size={12} /> Remove</button>
        </div>
      ))}
      <button type="button" className="btn btn-outline btn-sm" onClick={add}><Plus size={12} /> Add</button>
    </div>
  )
}
function TeamListEditor({ items, onChange }) {
  const list = items || []
  function setRow(i, patch) { onChange(list.map((r, idx) => idx === i ? { ...r, ...patch } : r)) }
  function add() { onChange([...list, { name: '', role: '', photo_url: '' }]) }
  function remove(i) { onChange(list.filter((_, idx) => idx !== i)) }
  return (
    <div style={field}>
      <label style={label}>Team Members</label>
      {list.map((row, i) => (
        <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, marginBottom: 8 }}>
          <input className="form-input" style={{ fontSize: 12.5, marginBottom: 4 }} placeholder="Name" value={row.name || ''} onChange={e => setRow(i, { name: e.target.value })} />
          <input className="form-input" style={{ fontSize: 12.5, marginBottom: 4 }} placeholder="Role" value={row.role || ''} onChange={e => setRow(i, { role: e.target.value })} />
          <ImageUploadField lbl="Photo (optional — falls back to initials)" value={row.photo_url} onChange={v => setRow(i, { photo_url: v })} />
          <button type="button" className="btn btn-ghost btn-sm" style={{ color: '#ef4444' }} onClick={() => remove(i)}><Trash2 size={12} /> Remove</button>
        </div>
      ))}
      <button type="button" className="btn btn-outline btn-sm" onClick={add}><Plus size={12} /> Add</button>
    </div>
  )
}
function TestimonialListEditor({ items, onChange }) {
  const list = items || []
  function setRow(i, patch) { onChange(list.map((r, idx) => idx === i ? { ...r, ...patch } : r)) }
  function add() { onChange([...list, { quote: '', author: '', role: '', avatar_url: '' }]) }
  function remove(i) { onChange(list.filter((_, idx) => idx !== i)) }
  return (
    <div style={field}>
      <label style={label}>Testimonials</label>
      {list.map((row, i) => (
        <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, marginBottom: 8 }}>
          <textarea className="form-textarea" style={{ fontSize: 12.5, marginBottom: 4 }} placeholder="Quote" value={row.quote || ''} onChange={e => setRow(i, { quote: e.target.value })} />
          <input className="form-input" style={{ fontSize: 12.5, marginBottom: 4 }} placeholder="Author" value={row.author || ''} onChange={e => setRow(i, { author: e.target.value })} />
          <input className="form-input" style={{ fontSize: 12.5, marginBottom: 4 }} placeholder="Role / Company" value={row.role || ''} onChange={e => setRow(i, { role: e.target.value })} />
          <ImageUploadField lbl="Photo (optional)" value={row.avatar_url} onChange={v => setRow(i, { avatar_url: v })} />
          <button type="button" className="btn btn-ghost btn-sm" style={{ color: '#ef4444' }} onClick={() => remove(i)}><Trash2 size={12} /> Remove</button>
        </div>
      ))}
      <button type="button" className="btn btn-outline btn-sm" onClick={add}><Plus size={12} /> Add</button>
    </div>
  )
}
function DateTimeField({ lbl, value, onChange }) {
  return <div style={field}><label style={label}>{lbl}</label><input type="datetime-local" className="form-input" value={value || ''} onChange={e => onChange(e.target.value)} /></div>
}

/* ── content ── */

function AnnouncementBarEditor({ config, onChange }) {
  return <>
    <Text lbl="Message" value={config.text} onChange={set(config, onChange, 'text')} />
    <Text lbl="Link Label (optional)" value={config.link_label} onChange={set(config, onChange, 'link_label')} />
    {config.link_label && <Text lbl="Link URL" value={config.link_url} onChange={set(config, onChange, 'link_url')} />}
    <BackgroundSelect config={config} onChange={onChange} />
  </>
}
function HeroSplitEditor({ config, onChange }) {
  return <>
    <Text lbl="Eyebrow" value={config.eyebrow} onChange={set(config, onChange, 'eyebrow')} />
    <Text lbl="Headline" value={config.headline} onChange={set(config, onChange, 'headline')} />
    <TextArea lbl="Subheadline" value={config.subheadline} onChange={set(config, onChange, 'subheadline')} />
    <ImageUploadField lbl="Image" value={config.image_url} onChange={set(config, onChange, 'image_url')} />
    <ImagePositionSelect config={config} onChange={onChange} />
    <BackgroundSelect config={config} onChange={onChange} />
    <Text lbl="Button Label" value={config.cta_label} onChange={set(config, onChange, 'cta_label')} />
    <CTAActionFields config={config} onChange={onChange} />
  </>
}
function VideoEmbedEditor({ config, onChange }) {
  return <>
    <Text lbl="Video URL (YouTube, Vimeo, or direct .mp4)" value={config.video_url} onChange={set(config, onChange, 'video_url')} placeholder="https://youtube.com/watch?v=…" />
    <Text lbl="Caption (optional)" value={config.caption} onChange={set(config, onChange, 'caption')} />
  </>
}
function TwoColumnTextEditor({ config, onChange }) {
  return <>
    <ImageUploadField lbl="Image" value={config.image_url} onChange={set(config, onChange, 'image_url')} />
    <ImagePositionSelect config={config} onChange={onChange} />
    <Text lbl="Heading" value={config.heading} onChange={set(config, onChange, 'heading')} />
    <TextArea lbl="Text" value={config.text} onChange={set(config, onChange, 'text')} />
    <Text lbl="Button Label (optional)" value={config.cta_label} onChange={set(config, onChange, 'cta_label')} />
    {config.cta_label && <CTAActionFields config={config} onChange={onChange} />}
  </>
}
function SpacerBlockEditor({ config, onChange }) {
  return <NumberF lbl="Height (px)" value={config.height_px} onChange={v => onChange({ ...config, height_px: Number(v) || 40 })} />
}
function QuoteBlockEditor({ config, onChange }) {
  return <>
    <TextArea lbl="Quote" value={config.quote} onChange={set(config, onChange, 'quote')} />
    <Text lbl="Author" value={config.author} onChange={set(config, onChange, 'author')} />
  </>
}
function IconTextRowEditor({ config, onChange }) {
  return <ObjectList lbl="Items" items={config.items} onChange={v => onChange({ ...config, items: v })}
    fields={[{ key: 'icon', label: 'Icon (emoji)' }, { key: 'title', label: 'Title' }, { key: 'description', label: 'Description' }]} />
}
function FooterEditor({ config, onChange }) {
  return <>
    <Text lbl="Logo / Brand Text" value={config.logo_text} onChange={set(config, onChange, 'logo_text')} />
    <ObjectList lbl="Columns (up to 3 links each)" items={config.columns} onChange={v => onChange({ ...config, columns: v })}
      fields={[{ key: 'heading', label: 'Column Heading' }, { key: 'link1_label', label: 'Link 1 Label' }, { key: 'link1_url', label: 'Link 1 URL' },
        { key: 'link2_label', label: 'Link 2 Label' }, { key: 'link2_url', label: 'Link 2 URL' }, { key: 'link3_label', label: 'Link 3 Label' }, { key: 'link3_url', label: 'Link 3 URL' }]} />
    <ObjectList lbl="Social Links" items={config.social_links} onChange={v => onChange({ ...config, social_links: v })}
      fields={[{ key: 'platform', label: 'twitter / linkedin / facebook' }, { key: 'url', label: 'URL' }]} />
    <Text lbl="Copyright Text" value={config.copyright_text} onChange={set(config, onChange, 'copyright_text')} placeholder="© 2026 Your Company" />
  </>
}
function TeamGridEditor({ config, onChange }) {
  return <TeamListEditor items={config.items} onChange={v => onChange({ ...config, items: v })} />
}
function AboutSectionEditor({ config, onChange }) {
  return <>
    <Text lbl="Heading" value={config.heading} onChange={set(config, onChange, 'heading')} />
    <TextArea lbl="Text" value={config.text} onChange={set(config, onChange, 'text')} />
    <ImageUploadField lbl="Image" value={config.image_url} onChange={set(config, onChange, 'image_url')} />
    <ImagePositionSelect config={config} onChange={onChange} />
  </>
}
function MapEmbedEditor({ config, onChange }) {
  return <>
    <Text lbl="Address (optional caption)" value={config.address} onChange={set(config, onChange, 'address')} />
    <Text lbl="Google Maps Embed URL" value={config.map_embed_url} onChange={set(config, onChange, 'map_embed_url')} placeholder="https://www.google.com/maps/embed?…" />
    <NumberF lbl="Map Height (px)" value={config.map_height} onChange={v => onChange({ ...config, map_height: Number(v) || 320 })} />
  </>
}
function ContactInfoBlockEditor({ config, onChange }) {
  return <ObjectList lbl="Items" items={config.items} onChange={v => onChange({ ...config, items: v })}
    fields={[{ key: 'icon_type', label: 'phone / email / address / hours' }, { key: 'label', label: 'Label' }, { key: 'value', label: 'Value' }]} />
}

/* ── sales ── */

function LogoCloudEditor({ config, onChange }) {
  return <>
    <Text lbl="Heading (optional)" value={config.heading} onChange={set(config, onChange, 'heading')} placeholder="Trusted by teams at" />
    <LogoListEditor lbl="Logos" items={config.logos} onChange={v => onChange({ ...config, logos: v })} />
  </>
}
function TestimonialGridEditor({ config, onChange }) {
  return <TestimonialListEditor items={config.items} onChange={v => onChange({ ...config, items: v })} />
}
function ReviewStarsEditor({ config, onChange }) {
  return <>
    <NumberF lbl="Rating (0-5)" value={config.rating} onChange={v => onChange({ ...config, rating: Math.min(5, Math.max(0, Number(v) || 0)) })} />
    <NumberF lbl="Review Count" value={config.review_count} onChange={v => onChange({ ...config, review_count: Number(v) || 0 })} />
    <Text lbl="Source (e.g. G2, Capterra)" value={config.source_label} onChange={set(config, onChange, 'source_label')} />
  </>
}
function CaseStudyCardEditor({ config, onChange }) {
  return <>
    <Text lbl="Company Name" value={config.company_name} onChange={set(config, onChange, 'company_name')} />
    <ImageUploadField lbl="Company Logo (optional)" value={config.logo_url} onChange={set(config, onChange, 'logo_url')} />
    <Text lbl="Result Stat (e.g. +40%)" value={config.result_stat} onChange={set(config, onChange, 'result_stat')} />
    <Text lbl="Result Label" value={config.result_label} onChange={set(config, onChange, 'result_label')} />
    <Text lbl="Link URL" value={config.link_url} onChange={set(config, onChange, 'link_url')} />
  </>
}
function VideoTestimonialEditor({ config, onChange }) {
  return <>
    <Text lbl="Video URL" value={config.video_url} onChange={set(config, onChange, 'video_url')} />
    <Text lbl="Author" value={config.author} onChange={set(config, onChange, 'author')} />
    <Text lbl="Role / Company" value={config.role} onChange={set(config, onChange, 'role')} />
  </>
}
function StatGridEditor({ config, onChange }) {
  return <ObjectList lbl="Stats" items={config.items} onChange={v => onChange({ ...config, items: v })}
    fields={[{ key: 'number', label: 'Number (e.g. 200+)' }, { key: 'label', label: 'Label' }]} />
}
function ProgressBarStatEditor({ config, onChange }) {
  return <>
    <Text lbl="Label" value={config.label} onChange={set(config, onChange, 'label')} />
    <NumberF lbl="Percentage (0-100)" value={config.percentage} onChange={v => onChange({ ...config, percentage: Math.min(100, Math.max(0, Number(v) || 0)) })} />
  </>
}
function CounterBlockEditor({ config, onChange }) {
  return <>
    <NumberF lbl="End Number" value={config.end_number} onChange={v => onChange({ ...config, end_number: Number(v) || 0 })} />
    <Text lbl="Label" value={config.label} onChange={set(config, onChange, 'label')} />
    <Text lbl="Suffix (e.g. +, %, k)" value={config.suffix} onChange={set(config, onChange, 'suffix')} />
  </>
}
function StepGroupEditor({ config, onChange }) {
  return <ObjectList lbl="Steps" items={config.items} onChange={v => onChange({ ...config, items: v })}
    fields={[{ key: 'title', label: 'Title' }, { key: 'description', label: 'Description' }]} />
}
function TimelineBlockEditor({ config, onChange }) {
  return <ObjectList lbl="Timeline Items" items={config.items} onChange={v => onChange({ ...config, items: v })}
    fields={[{ key: 'date', label: 'Date' }, { key: 'title', label: 'Title' }, { key: 'description', label: 'Description' }]} />
}

/* ── product ── */

function FeatureGridEditor({ config, onChange }) {
  return <>
    <NumberF lbl="Columns (2-4)" value={config.columns} onChange={v => onChange({ ...config, columns: Math.min(4, Math.max(2, Number(v) || 3)) })} />
    <ObjectList lbl="Features" items={config.items} onChange={v => onChange({ ...config, items: v })}
      fields={[{ key: 'icon', label: 'Icon (emoji)' }, { key: 'title', label: 'Title' }, { key: 'description', label: 'Description' }]} />
  </>
}
function FeatureHighlightEditor({ config, onChange }) {
  return <>
    <Text lbl="Eyebrow" value={config.eyebrow} onChange={set(config, onChange, 'eyebrow')} />
    <Text lbl="Title" value={config.title} onChange={set(config, onChange, 'title')} />
    <TextArea lbl="Description" value={config.description} onChange={set(config, onChange, 'description')} />
    <ImageUploadField lbl="Image" value={config.image_url} onChange={set(config, onChange, 'image_url')} />
    <ImagePositionSelect config={config} onChange={onChange} />
    <StringList lbl="Bullet Points" items={config.bullet_points} onChange={v => onChange({ ...config, bullet_points: v })} placeholder="Benefit" />
  </>
}
function IntegrationGridEditor({ config, onChange }) {
  return <>
    <Text lbl="Heading (optional)" value={config.heading} onChange={set(config, onChange, 'heading')} placeholder="Works with your stack" />
    <LogoListEditor lbl="Integrations" items={config.logos} onChange={v => onChange({ ...config, logos: v })} />
  </>
}
function ScreenshotShowcaseEditor({ config, onChange }) {
  return <>
    <ImageUploadField lbl="Screenshot" value={config.image_url} onChange={set(config, onChange, 'image_url')} />
    <Text lbl="Caption (optional)" value={config.caption} onChange={set(config, onChange, 'caption')} />
    <div style={field}>
      <label style={label}>Frame Style</label>
      <select className="form-select" value={config.frame_style || 'browser'} onChange={e => onChange({ ...config, frame_style: e.target.value })}>
        <option value="browser">Browser window</option>
        <option value="device">Device / phone</option>
        <option value="none">None</option>
      </select>
    </div>
  </>
}
function BeforeAfterSliderEditor({ config, onChange }) {
  return <>
    <ImageUploadField lbl="Before Image" value={config.before_image_url} onChange={set(config, onChange, 'before_image_url')} />
    <Text lbl="Before Label" value={config.before_label} onChange={set(config, onChange, 'before_label')} placeholder="Before" />
    <ImageUploadField lbl="After Image" value={config.after_image_url} onChange={set(config, onChange, 'after_image_url')} />
    <Text lbl="After Label" value={config.after_label} onChange={set(config, onChange, 'after_label')} placeholder="After" />
  </>
}

/* ── conversion ── */

function PricingTableEditor({ config, onChange }) {
  return <ObjectList lbl="Plans" items={config.plans} onChange={v => onChange({ ...config, plans: v })}
    fields={[{ key: 'name', label: 'Plan Name' }, { key: 'price', label: 'Price (e.g. $49)' }, { key: 'period', label: 'Period (e.g. mo)' },
      { key: 'features', label: 'Features (comma-separated)' }, { key: 'cta_label', label: 'Button Label' }, { key: 'highlighted', label: 'Highlighted? (yes/no)' }]} />
}
function PricingToggleEditor({ config, onChange }) {
  return <>
    <Text lbl="Plan Name" value={config.plan_name} onChange={set(config, onChange, 'plan_name')} />
    <Text lbl="Monthly Price" value={config.monthly_price} onChange={set(config, onChange, 'monthly_price')} />
    <Text lbl="Annual Price" value={config.annual_price} onChange={set(config, onChange, 'annual_price')} />
    <StringList lbl="Features" items={config.features} onChange={v => onChange({ ...config, features: v })} placeholder="Feature" />
    <Text lbl="Button Label" value={config.cta_label} onChange={set(config, onChange, 'cta_label')} />
    <CTAActionFields config={config} onChange={onChange} />
  </>
}
function CTABannerEditor({ config, onChange }) {
  return <>
    <Text lbl="Headline" value={config.headline} onChange={set(config, onChange, 'headline')} />
    <TextArea lbl="Subheadline" value={config.subheadline} onChange={set(config, onChange, 'subheadline')} />
    <Text lbl="Button Label" value={config.cta_label} onChange={set(config, onChange, 'cta_label')} />
    <CTAActionFields config={config} onChange={onChange} />
    <BackgroundSelect config={config} onChange={onChange} />
  </>
}
function StickyCTAEditor({ config, onChange }) {
  return <>
    <Text lbl="Label" value={config.label} onChange={set(config, onChange, 'label')} />
    <Text lbl="Button Label" value={config.cta_label} onChange={set(config, onChange, 'cta_label')} />
    <CTAActionFields config={config} onChange={onChange} />
  </>
}
function GuaranteeBadgeEditor({ config, onChange }) {
  return <ObjectList lbl="Badges" items={config.items} onChange={v => onChange({ ...config, items: v })}
    fields={[{ key: 'icon', label: 'Icon (emoji)' }, { key: 'text', label: 'Text' }]} />
}
function UrgencyCountdownEditor({ config, onChange }) {
  return <>
    <Text lbl="Label" value={config.label} onChange={set(config, onChange, 'label')} placeholder="Offer ends in" />
    <DateTimeField lbl="Deadline" value={config.deadline_iso} onChange={set(config, onChange, 'deadline_iso')} />
  </>
}
function NewsletterSignupEditor({ config, onChange }) {
  return <>
    <Text lbl="Headline" value={config.headline} onChange={set(config, onChange, 'headline')} placeholder="Get product updates" />
    <TextArea lbl="Subheadline" value={config.subheadline} onChange={set(config, onChange, 'subheadline')} />
  </>
}
function SocialShareBarEditor() {
  return <div style={{ fontSize: 12, color: '#94a3b8' }}>No settings — share links use this page's live URL automatically.</div>
}
function FAQGroupEditor({ config, onChange }) {
  return <ObjectList lbl="FAQs" items={config.items} onChange={v => onChange({ ...config, items: v })}
    fields={[{ key: 'question', label: 'Question' }, { key: 'answer', label: 'Answer' }]} />
}

export const GROWTH_EDITOR_COMPONENTS = {
  AnnouncementBar: AnnouncementBarEditor, HeroSplit: HeroSplitEditor, VideoEmbed: VideoEmbedEditor, TwoColumnText: TwoColumnTextEditor,
  SpacerBlock: SpacerBlockEditor, QuoteBlock: QuoteBlockEditor, IconTextRow: IconTextRowEditor, Footer: FooterEditor,
  TeamGrid: TeamGridEditor, AboutSection: AboutSectionEditor, MapEmbed: MapEmbedEditor, ContactInfoBlock: ContactInfoBlockEditor,
  LogoCloud: LogoCloudEditor, TestimonialGrid: TestimonialGridEditor, ReviewStars: ReviewStarsEditor, CaseStudyCard: CaseStudyCardEditor,
  VideoTestimonial: VideoTestimonialEditor, StatGrid: StatGridEditor, ProgressBarStat: ProgressBarStatEditor, CounterBlock: CounterBlockEditor,
  StepGroup: StepGroupEditor, TimelineBlock: TimelineBlockEditor,
  FeatureGrid: FeatureGridEditor, FeatureHighlight: FeatureHighlightEditor, IntegrationGrid: IntegrationGridEditor,
  ScreenshotShowcase: ScreenshotShowcaseEditor, BeforeAfterSlider: BeforeAfterSliderEditor,
  PricingTable: PricingTableEditor, PricingToggle: PricingToggleEditor, CTABanner: CTABannerEditor, StickyCTA: StickyCTAEditor,
  GuaranteeBadge: GuaranteeBadgeEditor, UrgencyCountdown: UrgencyCountdownEditor, NewsletterSignup: NewsletterSignupEditor,
  SocialShareBar: SocialShareBarEditor, FAQGroup: FAQGroupEditor,
}
