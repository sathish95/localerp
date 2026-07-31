import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  getLandingPage, listBlocks, addBlock, updateBlockConfig, saveBlockLayout, deleteBlock, publishLandingPage, updateLandingPage, normalizeBlockLayout,
} from '../lib/landingPageBuilder'
import { BLOCK_CATALOG, BLOCK_CATEGORIES } from '../lib/landingPageBlockCatalog'
import { BLOCK_RENDER_COMPONENTS, BLOCK_EDITOR_COMPONENTS } from './landing-blocks'
import BlockStyleEditor, { applyBlockStyle } from './landing-blocks/BlockStyleEditor'
import { themeCssVars } from '../lib/landingPageTheme'
import { Modal, Confirm, Loader } from './ui'
import { Plus, X, ArrowLeft, Eye, EyeOff, Save, Palette, ChevronUp, ChevronDown } from 'lucide-react'

const FONT_OPTIONS = [
  { id: "'Plus Jakarta Sans',sans-serif", label: 'Plus Jakarta Sans (default)' },
  { id: "'Playfair Display',serif", label: 'Playfair Display' },
  { id: 'Georgia,serif', label: 'Georgia' },
  { id: "'Courier New',monospace", label: 'Courier New' },
]

// Soft-snap targets while dragging a block's width handle, so freehand
// dragging still lands on clean column fractions (25/33/50/66/75/100%)
// rather than odd numbers like 41.7% — matches how real page builders
// (Webflow, Framer) snap width during drag.
const WIDTH_SNAP_POINTS = [25, 33.333, 50, 66.667, 75, 100]
function snapWidth(pct) {
  const clamped = Math.min(100, Math.max(15, pct))
  const nearest = WIDTH_SNAP_POINTS.reduce((best, p) => Math.abs(p - clamped) < Math.abs(best - clamped) ? p : best, WIDTH_SNAP_POINTS[0])
  return Math.abs(nearest - clamped) <= 3 ? nearest : clamped
}

// Auto-height flow canvas (STEP86) — blocks stack via flexbox, each
// sized to its own intrinsic content height. Only layout_w_pct (width)
// and array order (persisted as sort_order) are user-controlled; height
// is never manually set. Replaced an earlier fixed-pixel-height
// absolute-position model (STEP83) that reliably broke — no static
// height number survives real font wrapping at varying canvas widths.
// Reordering uses explicit up/down buttons rather than a drag gesture:
// after three consecutive bugs from hand-rolled pointer-math
// interactions on this page, a button is zero-math and can't regress.
// The public render (src/components/PublicLandingPage.jsx) uses the
// identical flex-wrap scheme with edit controls omitted, so editor and
// live page match.
export default function LandingPageBuilder({ pageId, canEdit, onBack }) {
  const [page, setPage] = useState(null)
  const [blocks, setBlocks] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [showTheme, setShowTheme] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [delBlock, setDelBlock] = useState(null)

  const canvasRef = useRef(null)
  const resizeRef = useRef(null)

  useEffect(() => { load() }, [pageId])
  async function load() {
    setLoading(true)
    const [p, bs, prods] = await Promise.all([
      getLandingPage(pageId), listBlocks(pageId),
      supabase.from('products').select('part_number,name').order('name').then(x => x.data || []),
    ])
    setPage(p); setBlocks(bs.map(normalizeBlockLayout)); setProducts(prods)
    setLoading(false); setDirty(false)
  }

  async function handleAddBlock(blockType) {
    const created = await addBlock(pageId, blockType, blocks)
    setBlocks(prev => [...prev, created])
    setShowAdd(false)
    setSelectedId(created.id)
  }

  async function handleDeleteBlock(id) {
    await deleteBlock(id)
    setBlocks(prev => prev.filter(b => b.id !== id))
    if (selectedId === id) setSelectedId('')
    setDelBlock(null)
  }

  function updateBlockWidth(id, wPct) {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, layout_w_pct: wPct } : b))
  }

  function moveBlock(id, dir) {
    setBlocks(prev => {
      const i = prev.findIndex(b => b.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
    setDirty(true)
  }

  const onResizeMove = useCallback((e) => {
    const r = resizeRef.current
    if (!r) return
    const dwPct = (e.clientX - r.startClientX) / r.containerWidth * 100
    updateBlockWidth(r.blockId, snapWidth(r.startWPct + dwPct))
  }, [])
  const onResizeEnd = useCallback(() => {
    window.removeEventListener('pointermove', onResizeMove)
    resizeRef.current = null
    setDirty(true)
  }, [onResizeMove])
  function startResize(e, blockId) {
    if (!canEdit || preview) return
    e.stopPropagation(); e.preventDefault()
    const block = blocks.find(b => b.id === blockId)
    const rect = canvasRef.current.getBoundingClientRect()
    resizeRef.current = { blockId, startClientX: e.clientX, startWPct: block.layout_w_pct, containerWidth: rect.width }
    window.addEventListener('pointermove', onResizeMove)
    window.addEventListener('pointerup', onResizeEnd, { once: true })
  }

  useEffect(() => () => window.removeEventListener('pointermove', onResizeMove), [onResizeMove])

  async function saveLayoutToDb() {
    setSaving(true)
    try { await saveBlockLayout(blocks); setDirty(false) } finally { setSaving(false) }
  }

  function updateSelectedConfig(nextConfig) {
    setBlocks(prev => prev.map(b => b.id === selectedId ? { ...b, config: nextConfig } : b))
  }
  async function saveSelectedConfig() {
    const block = blocks.find(b => b.id === selectedId)
    if (!block) return
    setSaving(true)
    try { await updateBlockConfig(block.id, block.config) } finally { setSaving(false) }
  }

  async function saveTheme(theme) {
    setSaving(true)
    try { await updateLandingPage(pageId, { theme }); setPage(p => ({ ...p, theme })); setShowTheme(false) } finally { setSaving(false) }
  }

  async function togglePublish() {
    if (page.status === 'Published') await updateLandingPage(pageId, { status: 'Draft' })
    else await publishLandingPage(pageId)
    await load()
  }

  if (loading || !page) return <Loader />
  const selectedBlock = blocks.find(b => b.id === selectedId)
  const EditorComp = selectedBlock ? BLOCK_EDITOR_COMPONENTS[selectedBlock.block_type] : null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={14} /> Landing Pages</button>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{page.name}</div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>{page.domain} · {page.status}</div>
        </div>
        {canEdit && <>
          <button className="btn btn-outline btn-sm" onClick={() => setPreview(p => !p)}>{preview ? <EyeOff size={13} /> : <Eye size={13} />} {preview ? 'Edit' : 'Preview'}</button>
          {!preview && <button className="btn btn-outline btn-sm" onClick={() => setShowTheme(true)}><Palette size={13} /> Theme</button>}
          {dirty && !preview && <button className="btn btn-primary btn-sm" onClick={saveLayoutToDb} disabled={saving}><Save size={13} /> Save Layout</button>}
          {!preview && <button className="btn btn-outline btn-sm" onClick={() => setShowAdd(true)}><Plus size={13} /> Add Block</button>}
          <button className="btn btn-primary btn-sm" onClick={togglePublish}>{page.status === 'Published' ? 'Unpublish' : 'Publish'}</button>
        </>}
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0, background: 'var(--lp-bg)', borderRadius: 12, padding: 16, ...themeCssVars(page.theme) }}>
          {blocks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>🧱</div>
              <div style={{ fontWeight: 600, marginBottom: 12 }}>No blocks yet</div>
              {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}><Plus size={13} /> Add your first block</button>}
            </div>
          ) : (
            <div ref={canvasRef} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {blocks.map((b, i) => {
                const Comp = BLOCK_RENDER_COMPONENTS[b.block_type]
                const isSelected = selectedId === b.id
                return (
                  <div key={b.id} className="lp-block-col" style={{ flex: `0 1 ${b.layout_w_pct}%`, minWidth: 180, boxSizing: 'border-box', padding: 8 }}>
                    <div onClick={() => !preview && setSelectedId(b.id)}
                      style={{
                        position: 'relative', borderRadius: 12, minHeight: 40,
                        outline: isSelected && !preview ? '2px solid #6366f1' : 'none',
                        cursor: preview ? 'default' : 'pointer',
                        ...applyBlockStyle(b.config?.style),
                      }}>
                      {!preview && canEdit && (
                        <div style={{ position: 'absolute', top: -10, left: 10, zIndex: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ background: '#334155', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>{b.block_type}</span>
                          <button onClick={e => { e.stopPropagation(); moveBlock(b.id, -1) }} disabled={i === 0}
                            style={{ width: 18, height: 18, borderRadius: '50%', border: 'none', background: i === 0 ? '#cbd5e1' : '#475569', color: '#fff', cursor: i === 0 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <ChevronUp size={11} />
                          </button>
                          <button onClick={e => { e.stopPropagation(); moveBlock(b.id, 1) }} disabled={i === blocks.length - 1}
                            style={{ width: 18, height: 18, borderRadius: '50%', border: 'none', background: i === blocks.length - 1 ? '#cbd5e1' : '#475569', color: '#fff', cursor: i === blocks.length - 1 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <ChevronDown size={11} />
                          </button>
                        </div>
                      )}
                      {!preview && canEdit && (
                        <button onClick={e => { e.stopPropagation(); setDelBlock(b.id) }}
                          style={{ position: 'absolute', top: -10, right: 4, zIndex: 2, width: 20, height: 20, borderRadius: '50%', background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <X size={11} />
                        </button>
                      )}
                      {!preview && canEdit && isSelected && (
                        <div onPointerDown={e => startResize(e, b.id)} title="Drag to resize width"
                          style={{ position: 'absolute', top: '50%', right: -6, transform: 'translateY(-50%)', width: 12, height: 36, borderRadius: 6, background: '#6366f1', border: '2px solid #fff', cursor: 'ew-resize', zIndex: 3, touchAction: 'none' }} />
                      )}
                      <div style={{ pointerEvents: preview ? 'auto' : 'none' }}>
                        {b.config?.section_title && (
                          <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 800, fontSize: 20, margin: '4px 0 12px' }}>{b.config.section_title}</div>
                        )}
                        {Comp ? <Comp config={b.config || {}} productLookup={Object.fromEntries(products.map(p => [p.part_number, p]))} slug={null} /> : null}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {!preview && selectedBlock && (
          <div style={{ width: 300, flexShrink: 0, background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 16, position: 'sticky', top: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{selectedBlock.block_type} settings</div>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setSelectedId('')}><X size={13} /></button>
            </div>
            {EditorComp ? <EditorComp config={selectedBlock.config || {}} onChange={updateSelectedConfig} products={products} /> : <div style={{ fontSize: 12, color: '#94a3b8' }}>No settings for this block.</div>}
            <BlockStyleEditor config={selectedBlock.config || {}} onChange={updateSelectedConfig} />
            {canEdit && <button className="btn btn-primary btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={saveSelectedConfig} disabled={saving}>{saving ? 'Saving…' : 'Save Content'}</button>}
          </div>
        )}
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Block" size="lg">
        {BLOCK_CATEGORIES.map(cat => (
          <div key={cat.id} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: cat.color, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>{cat.icon} {cat.label}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 8 }}>
              {BLOCK_CATALOG.filter(b => b.category === cat.id).map(b => (
                <button key={b.id} onClick={() => handleAddBlock(b.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10, border: `1px solid ${cat.color}30`, background: `${cat.color}08`, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, color: 'var(--text)', textAlign: 'left' }}>
                  <span style={{ fontSize: 15 }}>{b.icon}</span>{b.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </Modal>

      <Confirm open={!!delBlock} message="Remove this block from the page?" danger onConfirm={() => handleDeleteBlock(delBlock)} onCancel={() => setDelBlock(null)} />

      {showTheme && <ThemeEditorModal theme={page.theme || {}} onSave={saveTheme} onClose={() => setShowTheme(false)} saving={saving} />}
    </div>
  )
}

function ThemeEditorModal({ theme, onSave, onClose, saving }) {
  const [draft, setDraft] = useState({
    primaryColor: theme.primaryColor || '#6366f1',
    backgroundColor: theme.backgroundColor || '#f8fafc',
    textColor: theme.textColor || '#0f172a',
    fontFamily: theme.fontFamily || FONT_OPTIONS[0].id,
    buttonRadius: theme.buttonRadius ?? 10,
  })
  const set = (key) => (v) => setDraft(d => ({ ...d, [key]: v }))

  return (
    <Modal open onClose={onClose} title="Page Theme" size="md"
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => onSave(draft)} disabled={saving}>{saving ? 'Saving…' : 'Save Theme'}</button></>}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>Applies as CSS variables across this page — individual blocks/styles you've already set are not overridden.</div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <label className="form-label">Primary Color</label>
          <input type="color" className="form-input" style={{ padding: 2, height: 34 }} value={draft.primaryColor} onChange={e => set('primaryColor')(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="form-label">Background</label>
          <input type="color" className="form-input" style={{ padding: 2, height: 34 }} value={draft.backgroundColor} onChange={e => set('backgroundColor')(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="form-label">Text Color</label>
          <input type="color" className="form-input" style={{ padding: 2, height: 34 }} value={draft.textColor} onChange={e => set('textColor')(e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Font</label>
        <select className="form-select" value={draft.fontFamily} onChange={e => set('fontFamily')(e.target.value)}>
          {FONT_OPTIONS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Button Corner Radius (px)</label>
        <input type="number" min="0" className="form-input" value={draft.buttonRadius} onChange={e => set('buttonRadius')(Number(e.target.value) || 0)} />
      </div>
    </Modal>
  )
}
