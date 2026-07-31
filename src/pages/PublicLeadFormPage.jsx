import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { getPublicLandingLink, getPublicLandingPage } from '../lib/publicLeadForm'
import { PublicLeadCaptureForm } from '../components/PublicLeadCaptureForm'
import PublicLandingPage from '../components/PublicLandingPage'

// Public, unauthenticated marketing page — deliberately NOT wrapped in
// Layout/AuthProvider gating. If the link has an attached, Published
// Landing Page Builder page (STEP79), renders that full block grid;
// otherwise falls back to the original plain fixed-form render — old
// links created before the builder existed keep working unchanged.
export default function PublicLeadFormPage() {
  const { slug } = useParams()
  const [link, setLink] = useState(undefined) // undefined = loading, null = not found
  const [builderPage, setBuilderPage] = useState(undefined) // undefined = loading, null = no builder page for this link

  useEffect(() => {
    getPublicLandingLink(slug).then(setLink).catch(() => setLink(null))
    getPublicLandingPage(slug).then(setBuilderPage).catch(() => setBuilderPage(null))
  }, [slug])

  if (link === undefined || builderPage === undefined) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <div className="spinner" />
      </div>
    )
  }

  if (builderPage) {
    return <PublicLandingPage slug={slug} pageName={builderPage.pageName} theme={builderPage.theme} blocks={builderPage.blocks} />
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', fontFamily: "'Plus Jakarta Sans',sans-serif", padding: 20 }}>
      <div style={{ maxWidth: 480, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 24, fontWeight: 800 }}>ThingsAlive <span style={{ color: '#6366f1' }}>NeoX</span></div>
        </div>

        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e2e8f0', boxShadow: '0 4px 24px rgba(0,0,0,.06)', padding: 28 }}>
          {link === null ? (
            <div style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>This link isn't available. It may have expired or been deactivated.</div>
          ) : (
            <>
              <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 4 }}>{link.display_headline || link.campaign_name}</div>
              {link.display_subheadline && <div style={{ color: '#64748b', fontSize: 13.5, marginBottom: 20 }}>{link.display_subheadline}</div>}
              <PublicLeadCaptureForm slug={slug} featuredProducts={link.featured_products} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
