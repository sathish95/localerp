import { BLOCK_RENDER_COMPONENTS as CORE_RENDER } from './renderers'
import { BLOCK_EDITOR_COMPONENTS as CORE_EDITOR } from './editors'
import { GROWTH_RENDER_COMPONENTS } from './growthRenderers'
import { GROWTH_EDITOR_COMPONENTS } from './growthEditors'

// STEP89: merges the original 19-block catalog with the 36-block growth
// catalog into the single lookup every consumer (LandingPageBuilder.jsx,
// PublicLandingPage.jsx) already uses — neither needs to know the
// catalog is split across two file pairs internally.
export const BLOCK_RENDER_COMPONENTS = { ...CORE_RENDER, ...GROWTH_RENDER_COMPONENTS }
export const BLOCK_EDITOR_COMPONENTS = { ...CORE_EDITOR, ...GROWTH_EDITOR_COMPONENTS }
