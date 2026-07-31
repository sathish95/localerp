import { supabase } from './supabase'
import { blockMeta } from './landingPageBlockCatalog'

// Landing Page Builder — pages/blocks CRUD. The grid editor itself
// (src/components/LandingPageBuilder.jsx) is a structural port of
// src/components/CustomDashboardBuilder.jsx; these functions mirror that
// file's data layer (add/remove/bulk-save-layout) for landing_page_blocks
// instead of custom_dashboard_widgets.

/* ── Templates (read-only from the app's perspective — seeded in STEP79) ── */
export async function listTemplates(domain) {
  let q = supabase.from('landing_page_templates').select('*').eq('is_active', true).order('name')
  const { data, error } = await q
  if (error) throw error
  return domain ? (data || []).filter(t => t.domain === domain || t.domain === 'Both') : (data || [])
}

export async function listTemplateBlocks(templateId) {
  const { data, error } = await supabase.from('landing_page_template_blocks').select('*').eq('template_id', templateId).order('sort_order')
  if (error) throw error
  return data || []
}

/* ── Pages ── */
export async function listLandingPages() {
  const { data, error } = await supabase.from('landing_pages').select('*, template:landing_page_templates(name)').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getLandingPage(id) {
  const { data, error } = await supabase.from('landing_pages').select('*, template:landing_page_templates(name)').eq('id', id).single()
  if (error) throw error
  return data
}

// Creates the page, then clones the chosen template's blocks into
// landing_page_blocks — editing the new page's blocks afterward never
// touches the template (each page owns an independent copy).
export async function createLandingPage(form, userId) {
  const { data: page, error } = await supabase.from('landing_pages').insert({
    name: form.name, domain: form.domain, template_id: form.template_id || null,
    linked_product_ids: form.linked_product_ids || [], created_by: userId,
  }).select().single()
  if (error) throw error

  if (form.template_id) {
    const templateBlocks = await listTemplateBlocks(form.template_id)
    if (templateBlocks.length > 0) {
      const { error: blockErr } = await supabase.from('landing_page_blocks').insert(
        templateBlocks.map(b => ({
          landing_page_id: page.id, block_type: b.block_type,
          layout_w_pct: b.layout_w_pct, config: b.config, sort_order: b.sort_order,
        }))
      )
      if (blockErr) throw blockErr
    }
  }
  return page
}

export async function updateLandingPage(id, patch) {
  const { error } = await supabase.from('landing_pages').update(patch).eq('id', id)
  if (error) throw error
}

export async function publishLandingPage(id) {
  const { error } = await supabase.from('landing_pages').update({ status: 'Published' }).eq('id', id)
  if (error) throw error
}

export async function deleteLandingPage(id) {
  const { error } = await supabase.from('landing_pages').delete().eq('id', id)
  if (error) throw error
}

// Defensive fallback — if layout_w_pct ever comes back null (a stray
// un-migrated row), fall back to a sane full-width default instead of
// letting invalid CSS (`width: null%`) reach the DOM.
export function normalizeBlockLayout(b) {
  return { ...b, layout_w_pct: b.layout_w_pct ?? 100 }
}

/* ── Blocks ──
// STEP86: auto-height flow layout — blocks stack via CSS flexbox, sized
// to their own content. Only layout_w_pct (width, 0-100) and sort_order
// (vertical position) are meaningful; the old layout_x_pct/layout_y_px/
// layout_h_px columns (STEP83) are no longer read here. */
export async function listBlocks(landingPageId) {
  const { data, error } = await supabase.from('landing_page_blocks').select('*').eq('landing_page_id', landingPageId).order('sort_order').order('created_at')
  if (error) throw error
  return data || []
}

// Appends a new block after the last existing one, using the catalog's
// default width — same placement logic as CustomDashboardBuilder.addWidget(),
// generalized to sort_order + width-only (STEP86) instead of grid cells.
export async function addBlock(landingPageId, blockType, existingBlocks) {
  const meta = blockMeta(blockType)
  const maxOrder = (existingBlocks || []).reduce((m, b) => Math.max(m, b.sort_order ?? 0), 0)
  const { data, error } = await supabase.from('landing_page_blocks').insert({
    landing_page_id: landingPageId, block_type: blockType,
    layout_w_pct: meta?.defaultWPct ?? 100, sort_order: maxOrder + 1,
    config: meta?.defaultConfig || {},
  }).select().single()
  if (error) throw error
  return data
}

export async function updateBlockConfig(id, config) {
  const { error } = await supabase.from('landing_page_blocks').update({ config }).eq('id', id)
  if (error) throw error
}

// Bulk-persists width + order after a reorder/resize — mirrors
// CustomDashboardBuilder.saveLayout()'s per-item Promise.all pattern.
export async function saveBlockLayout(blocks) {
  await Promise.all(blocks.map((b, i) =>
    supabase.from('landing_page_blocks').update({ layout_w_pct: b.layout_w_pct, sort_order: i }).eq('id', b.id)
  ))
}

export async function deleteBlock(id) {
  const { error } = await supabase.from('landing_page_blocks').delete().eq('id', id)
  if (error) throw error
}
