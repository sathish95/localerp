// Block catalog for the Landing Page Builder — modeled directly on
// src/lib/dashboardWidgets.js's WIDGET_CATALOG (same shape: id, category,
// label, icon, defaultWPct), just for landing-page blocks instead of
// dashboard widgets. defaultConfig must match STEP79's documented JSON
// shape per block_type exactly.
//
// Auto-height flow layout (STEP86) — width is the only size a block
// carries (percentage of its row, 0-100); height is always intrinsic to
// the block's own content, never manually set. This replaced an earlier
// fixed-pixel-height model (STEP83) that reliably broke: content height
// depends on font wrapping and canvas width in ways no static number
// can predict, so blocks kept overflowing their assigned box.
export const BLOCK_CATEGORIES = [
  { id: 'content', label: 'Content', icon: '📝', color: '#6366f1' },
  { id: 'sales', label: 'Sales & Proof', icon: '💬', color: '#db2777' },
  { id: 'product', label: 'Product', icon: '📦', color: '#0ea5e9' },
  { id: 'conversion', label: 'Conversion', icon: '🎯', color: '#15803d' },
]

export const BLOCK_CATALOG = [
  { id: 'Header', category: 'content', label: 'Header / Nav Menu', icon: '🧭', defaultWPct: 100, defaultConfig: { logo_text: 'Your Brand', menu_items: [{ label: 'Home', url: '#' }, { label: 'Features', url: '#' }, { label: 'Contact', url: '#' }], cta_label: 'Get Started', cta_action: 'scroll_to_form', cta_url: '', cta_meeting_page_slug: '' } },
  { id: 'Hero', category: 'content', label: 'Hero', icon: '🏔️', defaultWPct: 100, defaultConfig: { headline: 'Your headline here', subheadline: '', image_url: '', eyebrow: '', cta_label: 'Get Started', cta_action: 'scroll_to_form', cta_url: '' } },
  { id: 'Heading', category: 'content', label: 'Heading', icon: '🔠', defaultWPct: 100, defaultConfig: { text: 'Section heading', level: 2 } },
  { id: 'Paragraph', category: 'content', label: 'Paragraph', icon: '📄', defaultWPct: 100, defaultConfig: { text: 'Write your copy here.' } },
  { id: 'Image', category: 'content', label: 'Image', icon: '🖼️', defaultWPct: 50, defaultConfig: { image_url: '', alt: '' } },
  { id: 'Carousel', category: 'content', label: 'Image Carousel / Slider', icon: '🎞️', defaultWPct: 100, defaultConfig: { slides: [], autoplay: true, interval_seconds: 4 } },
  { id: 'Divider', category: 'content', label: 'Divider', icon: '➖', defaultWPct: 100, defaultConfig: {} },
  { id: 'TrustBar', category: 'sales', label: 'Trust Bar', icon: '✅', defaultWPct: 100, defaultConfig: { items: ['Trusted by 100+ customers'] } },
  { id: 'FeatureCard', category: 'sales', label: 'Feature Card', icon: '⭐', defaultWPct: 33.333, defaultConfig: { icon: '⚡', title: 'Feature title', description: 'Short description of the benefit.' } },
  { id: 'TestimonialCard', category: 'sales', label: 'Testimonial Card', icon: '💬', defaultWPct: 50, defaultConfig: { quote: 'This product changed how we work.', author: 'Customer Name', role: '', avatar_url: '' } },
  { id: 'StatBlock', category: 'sales', label: 'Stat Block', icon: '📊', defaultWPct: 33.333, defaultConfig: { number: '100+', label: 'Metric label' } },
  { id: 'ComparisonTable', category: 'sales', label: 'Comparison Table', icon: '⚖️', defaultWPct: 100, defaultConfig: { rows: [{ feature: 'Feature', us: 'Yes', competitor: 'No' }] } },
  { id: 'HowItWorksStep', category: 'sales', label: 'How It Works Step', icon: '🔢', defaultWPct: 33.333, defaultConfig: { step_number: 1, title: 'Step title', description: 'What happens in this step.' } },
  { id: 'ProductCard', category: 'product', label: 'Product Card', icon: '📦', defaultWPct: 100, defaultConfig: { product_part_number: '', override_title: '', override_description: '' } },
  { id: 'ProductGrid', category: 'product', label: 'Product Grid', icon: '🗂️', defaultWPct: 100, defaultConfig: { product_part_numbers: [] } },
  { id: 'PricingCard', category: 'conversion', label: 'Pricing Card', icon: '💳', defaultWPct: 100, defaultConfig: { plan_name: 'Plan', price: 'Contact us', features: ['Feature one'], cta_label: 'Get Started', cta_action: 'scroll_to_form', cta_url: '' } },
  { id: 'FAQItem', category: 'conversion', label: 'FAQ Item', icon: '❓', defaultWPct: 100, defaultConfig: { question: 'Question?', answer: 'Answer.' } },
  { id: 'Button', category: 'conversion', label: 'Button', icon: '🔘', defaultWPct: 33.333, defaultConfig: { label: 'Click Here', cta_action: 'scroll_to_form', cta_url: '' } },
  { id: 'LeadForm', category: 'conversion', label: 'Lead Capture Form', icon: '📋', defaultWPct: 100, defaultConfig: { headline: 'Get in touch', standard_fields: { company: true, phone: true, email: true, message: true }, custom_fields: [] } },

  // ── Growth catalog (STEP89) — 36 additional blocks, rendered/edited by
  // src/components/landing-blocks/growthRenderers.jsx / growthEditors.jsx.
  // content
  { id: 'AnnouncementBar', category: 'content', label: 'Announcement Bar', icon: '📣', defaultWPct: 100, defaultConfig: { text: 'New: our biggest release yet', link_label: 'Learn more', link_url: '#', background_style: 'indigo' } },
  { id: 'HeroSplit', category: 'content', label: 'Hero (Split / Image)', icon: '🖼️', defaultWPct: 100, defaultConfig: { eyebrow: '', headline: 'A better way to work', subheadline: 'The platform teams switch to and never leave.', cta_label: 'Get Started', cta_action: 'scroll_to_form', cta_url: '', cta_meeting_page_slug: '', image_url: '', background_style: 'indigo', image_position: 'right' } },
  { id: 'VideoEmbed', category: 'content', label: 'Video Embed', icon: '▶️', defaultWPct: 100, defaultConfig: { video_url: '', caption: '' } },
  { id: 'TwoColumnText', category: 'content', label: 'Two-Column Text', icon: '🗂️', defaultWPct: 100, defaultConfig: { image_url: '', image_position: 'right', heading: 'Why teams choose us', text: 'Write your copy here.', cta_label: '', cta_action: 'scroll_to_form', cta_url: '', cta_meeting_page_slug: '' } },
  { id: 'SpacerBlock', category: 'content', label: 'Spacer', icon: '⬜', defaultWPct: 100, defaultConfig: { height_px: 40 } },
  { id: 'QuoteBlock', category: 'content', label: 'Pull Quote', icon: '❝', defaultWPct: 100, defaultConfig: { quote: 'A powerful quote goes here.', author: '' } },
  { id: 'IconTextRow', category: 'content', label: 'Icon + Text Row', icon: '➕', defaultWPct: 100, defaultConfig: { items: [{ icon: '⚡', title: 'Fast', description: 'Live in minutes.' }, { icon: '🔒', title: 'Secure', description: 'Enterprise-grade security.' }, { icon: '🌍', title: 'Global', description: 'Built for every region.' }] } },
  { id: 'Footer', category: 'content', label: 'Footer', icon: '🦶', defaultWPct: 100, defaultConfig: { logo_text: 'Your Brand', columns: [{ heading: 'Product', link1_label: 'Features', link1_url: '#', link2_label: 'Pricing', link2_url: '#' }, { heading: 'Company', link1_label: 'About', link1_url: '#', link2_label: 'Contact', link2_url: '#' }], social_links: [{ platform: 'twitter', url: '#' }, { platform: 'linkedin', url: '#' }], copyright_text: '' } },
  { id: 'TeamGrid', category: 'content', label: 'Team Grid', icon: '🧑‍🤝‍🧑', defaultWPct: 100, defaultConfig: { items: [{ name: 'Jane Doe', role: 'CEO', photo_url: '' }] } },
  { id: 'AboutSection', category: 'content', label: 'About Section', icon: 'ℹ️', defaultWPct: 100, defaultConfig: { heading: 'About us', text: 'Tell your company story here.', image_url: '', image_position: 'right' } },
  { id: 'MapEmbed', category: 'content', label: 'Map Embed', icon: '📍', defaultWPct: 100, defaultConfig: { address: '', map_embed_url: '', map_height: 320 } },
  { id: 'ContactInfoBlock', category: 'content', label: 'Contact Info', icon: '☎️', defaultWPct: 100, defaultConfig: { items: [{ icon_type: 'phone', label: 'Call us', value: '' }, { icon_type: 'email', label: 'Email us', value: '' }] } },

  // sales
  { id: 'LogoCloud', category: 'sales', label: 'Logo Cloud', icon: '🏢', defaultWPct: 100, defaultConfig: { heading: 'Trusted by teams at', logos: [] } },
  { id: 'TestimonialGrid', category: 'sales', label: 'Testimonial Grid', icon: '💬', defaultWPct: 100, defaultConfig: { items: [{ quote: 'This product changed how we work.', author: 'Customer Name', role: '', avatar_url: '' }] } },
  { id: 'ReviewStars', category: 'sales', label: 'Review Stars', icon: '⭐', defaultWPct: 33.333, defaultConfig: { rating: 4.8, review_count: 120, source_label: 'G2' } },
  { id: 'CaseStudyCard', category: 'sales', label: 'Case Study Card', icon: '📈', defaultWPct: 50, defaultConfig: { company_name: 'Customer Inc.', logo_url: '', result_stat: '+40%', result_label: 'increase in efficiency', link_url: '#' } },
  { id: 'VideoTestimonial', category: 'sales', label: 'Video Testimonial', icon: '🎥', defaultWPct: 50, defaultConfig: { video_url: '', author: '', role: '' } },
  { id: 'StatGrid', category: 'sales', label: 'Stat Grid', icon: '📊', defaultWPct: 100, defaultConfig: { items: [{ number: '200+', label: 'Customers' }, { number: '99.9%', label: 'Uptime' }, { number: '24/7', label: 'Support' }] } },
  { id: 'ProgressBarStat', category: 'sales', label: 'Progress Bar Stat', icon: '📶', defaultWPct: 50, defaultConfig: { label: 'Customer satisfaction', percentage: 96 } },
  { id: 'CounterBlock', category: 'sales', label: 'Animated Counter', icon: '🔢', defaultWPct: 33.333, defaultConfig: { end_number: 500, label: 'Happy customers', suffix: '+' } },
  { id: 'StepGroup', category: 'sales', label: 'Step Group', icon: '🪜', defaultWPct: 100, defaultConfig: { items: [{ title: 'Sign up', description: 'Create your account.' }, { title: 'Set up', description: 'Connect your tools.' }, { title: 'Go live', description: 'Launch with confidence.' }] } },
  { id: 'TimelineBlock', category: 'sales', label: 'Timeline', icon: '🕰️', defaultWPct: 100, defaultConfig: { items: [{ date: '2023', title: 'Founded', description: 'Our journey began.' }] } },

  // product
  { id: 'FeatureGrid', category: 'product', label: 'Feature Grid', icon: '🧩', defaultWPct: 100, defaultConfig: { columns: 3, items: [{ icon: '⚡', title: 'Fast setup', description: 'Live in minutes, not weeks.' }, { icon: '🔗', title: 'Integrates everywhere', description: 'Connects to your existing stack.' }, { icon: '📈', title: 'Built to scale', description: 'From startup to enterprise.' }] } },
  { id: 'FeatureHighlight', category: 'product', label: 'Feature Highlight', icon: '🌟', defaultWPct: 100, defaultConfig: { eyebrow: 'Feature', title: 'A feature worth highlighting', description: 'Explain the benefit in a sentence or two.', image_url: '', image_position: 'right', bullet_points: ['Benefit one', 'Benefit two'] } },
  { id: 'IntegrationGrid', category: 'product', label: 'Integration Grid', icon: '🔌', defaultWPct: 100, defaultConfig: { heading: 'Works with your stack', logos: [] } },
  { id: 'ScreenshotShowcase', category: 'product', label: 'Screenshot Showcase', icon: '🖥️', defaultWPct: 100, defaultConfig: { image_url: '', caption: '', frame_style: 'browser' } },
  { id: 'BeforeAfterSlider', category: 'product', label: 'Before / After Slider', icon: '↔️', defaultWPct: 100, defaultConfig: { before_image_url: '', after_image_url: '', before_label: 'Before', after_label: 'After' } },

  // conversion
  { id: 'PricingTable', category: 'conversion', label: 'Pricing Table (multi-plan)', icon: '💰', defaultWPct: 100, defaultConfig: { plans: [{ name: 'Starter', price: '$29', period: 'mo', features: 'Core features, Email support', cta_label: 'Choose Plan', highlighted: 'no' }, { name: 'Pro', price: '$79', period: 'mo', features: 'Everything in Starter, Priority support, Advanced analytics', cta_label: 'Choose Plan', highlighted: 'yes' }] } },
  { id: 'PricingToggle', category: 'conversion', label: 'Pricing Toggle (monthly/annual)', icon: '🔁', defaultWPct: 50, defaultConfig: { plan_name: 'Pro', monthly_price: '$79/mo', annual_price: '$790/yr', features: ['Everything you need'], cta_label: 'Get Started', cta_action: 'scroll_to_form', cta_url: '', cta_meeting_page_slug: '' } },
  { id: 'CTABanner', category: 'conversion', label: 'CTA Banner', icon: '📯', defaultWPct: 100, defaultConfig: { headline: 'Ready to get started?', subheadline: 'Join hundreds of teams already using our platform.', cta_label: 'Get Started', cta_action: 'scroll_to_form', cta_url: '', cta_meeting_page_slug: '', background_style: 'violet' } },
  { id: 'StickyCTA', category: 'conversion', label: 'CTA Bar', icon: '📌', defaultWPct: 100, defaultConfig: { label: 'Ready when you are.', cta_label: 'Get Started', cta_action: 'scroll_to_form', cta_url: '', cta_meeting_page_slug: '' } },
  { id: 'GuaranteeBadge', category: 'conversion', label: 'Guarantee / Trust Badges', icon: '🛡️', defaultWPct: 100, defaultConfig: { items: [{ icon: '🛡️', text: '30-day money back' }, { icon: '🔒', text: 'Secure checkout' }, { icon: '💬', text: '24/7 support' }] } },
  { id: 'UrgencyCountdown', category: 'conversion', label: 'Countdown Timer', icon: '⏳', defaultWPct: 100, defaultConfig: { label: 'Offer ends in', deadline_iso: '' } },
  { id: 'NewsletterSignup', category: 'conversion', label: 'Newsletter Signup', icon: '✉️', defaultWPct: 50, defaultConfig: { headline: 'Get product updates', subheadline: 'No spam, unsubscribe anytime.' } },
  { id: 'SocialShareBar', category: 'conversion', label: 'Social Share Bar', icon: '🔗', defaultWPct: 100, defaultConfig: {} },
  { id: 'FAQGroup', category: 'conversion', label: 'FAQ Group (multi)', icon: '❔', defaultWPct: 100, defaultConfig: { items: [{ question: 'Question one?', answer: 'Answer one.' }, { question: 'Question two?', answer: 'Answer two.' }] } },
]

export function blockMeta(blockType) {
  return BLOCK_CATALOG.find(b => b.id === blockType)
}
