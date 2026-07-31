// Shared by src/components/LandingPageBuilder.jsx and
// src/components/PublicLandingPage.jsx (STEP84) — kept in a plain lib
// file rather than exported from the builder component so the public
// page doesn't need to import the (much heavier) authenticated editor.
export function themeCssVars(theme) {
  const t = theme || {}
  return {
    '--lp-primary': t.primaryColor || '#6366f1',
    '--lp-bg': t.backgroundColor || '#f8fafc',
    '--lp-text': t.textColor || '#0f172a',
    '--lp-font': t.fontFamily || "'Plus Jakarta Sans',sans-serif",
  }
}
