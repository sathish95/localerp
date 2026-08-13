import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { getPublicLandingLink } from '../lib/publicLeadForm'
import { PublicLeadCaptureForm } from '../components/PublicLeadCaptureForm'
import { useAppName } from '../context/BrandingContext'

// Public, unauthenticated "book a call" page — pairs the same
// Turnstile-verified lead form used at /l/:slug with an embedded
// third-party scheduler (Calendly, Cal.com, etc.). The scheduler is a
// plain iframe of a URL an admin pastes in (src/pages/MeetingBookingPagesPage.jsx)
// — deliberately not an injected <script> embed, so no arbitrary
// third-party JS ever runs on this page.
export default function PublicMeetingBookingPage() {
  const { slug } = useParams()
  const appName = useAppName()
  const [link, setLink] = useState(undefined) // undefined = loading, null = not found/wrong type

  useEffect(() => {
    getPublicLandingLink(slug).then(l => setLink(l && l.page_type === 'meeting' ? l : null)).catch(() => setLink(null))
  }, [slug])

  if (link === undefined) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: "'Plus Jakarta Sans',sans-serif", padding: '32px 16px' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 24, fontWeight: 800 }}>{appName}</div>
      </div>

      {link === null ? (
        <div style={{ maxWidth: 480, margin: '0 auto', background: '#fff', borderRadius: 16, border: '1.5px solid #e2e8f0', boxShadow: '0 4px 24px rgba(0,0,0,.06)', padding: 28, textAlign: 'center', color: '#64748b' }}>
          This booking page isn't available. It may have expired or been deactivated.
        </div>
      ) : (
        <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 320px', maxWidth: 400, background: '#fff', borderRadius: 16, border: '1.5px solid #e2e8f0', boxShadow: '0 4px 24px rgba(0,0,0,.06)', padding: 28 }}>
            <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 4 }}>{link.display_headline || link.campaign_name}</div>
            {link.display_subheadline && <div style={{ color: '#64748b', fontSize: 13.5, marginBottom: 20 }}>{link.display_subheadline}</div>}
            <PublicLeadCaptureForm slug={slug} featuredProducts={link.featured_products} />
          </div>

          <div style={{ flex: '2 1 480px', background: '#fff', borderRadius: 16, border: '1.5px solid #e2e8f0', boxShadow: '0 4px 24px rgba(0,0,0,.06)', overflow: 'hidden', minHeight: 640 }}>
            {link.scheduler_embed_url ? (
              <iframe title="Book a meeting" src={link.scheduler_embed_url} style={{ width: '100%', height: 640, border: 'none' }} />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 640, color: '#94a3b8', fontSize: 13 }}>No scheduler configured for this page yet.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
