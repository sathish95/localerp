import { useState, useEffect } from 'react'
import { getProductsPublic } from '../lib/publicLeadForm'
import { BLOCK_RENDER_COMPONENTS } from './landing-blocks'
import { applyBlockStyle } from './landing-blocks/BlockStyleEditor'
import { themeCssVars } from '../lib/landingPageTheme'

function collectPartNumbers(blocks) {
  const set = new Set()
  blocks.forEach(b => {
    if (b.block_type === 'ProductCard' && b.config?.product_part_number) set.add(b.config.product_part_number)
    if (b.block_type === 'ProductGrid') (b.config?.product_part_numbers || []).forEach(pn => set.add(pn))
  })
  return [...set]
}

// Read-only render of a published Landing Page — same auto-height
// flex-wrap flow the builder uses (src/components/LandingPageBuilder.jsx,
// STEP86), just without edit controls. Guarantees the public page
// matches the editor's stacking/wrapping exactly, since both size every
// block to its own content rather than a manually-set pixel height.
export default function PublicLandingPage({ slug, pageName, theme, blocks }) {
  const [productLookup, setProductLookup] = useState({})

  useEffect(() => {
    const partNumbers = collectPartNumbers(blocks)
    if (partNumbers.length) getProductsPublic(partNumbers).then(setProductLookup)
  }, [blocks])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--lp-bg)', fontFamily: 'var(--lp-font)', ...themeCssVars(theme) }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {blocks.map(b => {
            const Comp = BLOCK_RENDER_COMPONENTS[b.block_type]
            const wPct = b.w_pct ?? 100
            return (
              <div key={b.id} className="lp-block-col" style={{ flex: `0 1 ${wPct}%`, minWidth: 220, boxSizing: 'border-box', padding: 8 }}>
                <div style={applyBlockStyle(b.config?.style)}>
                  {b.config?.section_title && (
                    <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 800, fontSize: 20, margin: '4px 0 12px' }}>{b.config.section_title}</div>
                  )}
                  {Comp ? <Comp config={b.config || {}} productLookup={productLookup} slug={slug} /> : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
