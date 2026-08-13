import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase, rupee } from '../lib/supabase'
import { getSpendByProduct } from '../lib/spendAnalyzer'
import {
  getProductBomDetail, getBomCompanySummary, getActiveVersionsByPart, getActiveBomEdges,
  saveNewBomVersion, getVersionComponents, wouldCreateCycle,
} from '../lib/bom'
import AIDockedPanel from '../components/AIDockedPanel'
import { BomAiTab } from '../components/AIActionTabs'
import { Loader, Empty, SearchBox, StatCard, Modal } from '../components/ui'
import ExcelImport from '../components/ui/ExcelImport'
import {
  Boxes, Trash2, History, RotateCcw, AlertTriangle, Save, X, Package,
  Layers, Wallet, ShoppingCart, Upload, ChevronRight, Sparkles,
} from 'lucide-react'

export default function BomManagementPage() {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const canEdit = ['admin', 'ceo', 'manager', 'department_head', 'finance', 'procurement_lead'].includes(role)

  const [searchParams, setSearchParams] = useSearchParams()
  const selectedPart = searchParams.get('product') || ''

  const [products, setProducts] = useState([])
  const [versionByPart, setVersionByPart] = useState({})
  const [summary, setSummary] = useState(null)
  const [componentSpend, setComponentSpend] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState([])
  const [allEdges, setAllEdges] = useState([])
  const [saveNotes, setSaveNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')
  const [showImport, setShowImport] = useState(false)

  const [previewVersion, setPreviewVersion] = useState(null)
  const [previewComponents, setPreviewComponents] = useState(null)
  const [stockByPart, setStockByPart] = useState({})

  const [showAiPanel, setShowAiPanel] = useState(searchParams.get('ai') === '1')

  useEffect(() => { loadOverview() }, [])

  async function loadOverview() {
    setLoading(true)
    const [{ data: prods }, versions, comSummary] = await Promise.all([
      supabase.from('products').select('id,part_number,name,device_type,standard_cost,is_serialized,reorder_level,reorder_qty').order('name'),
      getActiveVersionsByPart(),
      getBomCompanySummary(),
    ])
    setProducts(prods || [])
    setVersionByPart(versions)
    setSummary(comSummary)
    if (comSummary.componentPartNumbers.length) {
      const spendRows = await getSpendByProduct({ limit: 1000 })
      const spendByPart = Object.fromEntries(spendRows.map(r => [r.part_number, r.requisitionedTotal]))
      setComponentSpend(comSummary.componentPartNumbers.reduce((s, p) => s + (spendByPart[p] || 0), 0))
    } else {
      setComponentSpend(0)
    }
    setLoading(false)
  }

  const loadDetail = useCallback(async (partNumber) => {
    if (!partNumber) { setDetail(null); return }
    setDetailLoading(true); setEditing(false); setErr(''); setPreviewVersion(null); setPreviewComponents(null)
    const d = await getProductBomDetail(partNumber)
    setDetail(d)
    setDetailLoading(false)
  }, [])

  useEffect(() => { loadDetail(selectedPart) }, [selectedPart, loadDetail])

  useEffect(() => { loadStock(detail) }, [detail])

  async function loadStock(d) {
    if (!d?.tree?.children?.length) { setStockByPart({}); return }
    const productByPart = Object.fromEntries(products.map(p => [p.part_number, p]))
    const serializedParts = [...new Set(d.tree.children.map(c => c.partNumber).filter(pn => productByPart[pn]?.is_serialized))]
    if (!serializedParts.length) { setStockByPart({}); return }
    const { data } = await supabase.from('device_instances').select('part_number').in('part_number', serializedParts).eq('status', 'in_storage')
    const counts = {}
    ;(data || []).forEach(r => { counts[r.part_number] = (counts[r.part_number] || 0) + 1 })
    setStockByPart(counts)
  }

  function selectProduct(partNumber) {
    setSearchParams(partNumber ? { product: partNumber } : {})
  }

  async function startEdit() {
    setErr('')
    setDraft((detail?.tree?.children || []).map(c => ({ component_part_number: c.partNumber, name: c.name, quantity: c.quantity, notes: '' })))
    setSaveNotes('')
    setAllEdges(await getActiveBomEdges())
    setEditing(true)
  }

  function cancelEdit() { setEditing(false); setErr(''); setShowImport(false) }

  function addDraftRow(partNumber) {
    if (!partNumber || draft.some(d => d.component_part_number === partNumber)) return
    const p = products.find(x => x.part_number === partNumber)
    setDraft(d => [...d, { component_part_number: partNumber, name: p?.name || partNumber, quantity: 1, notes: '' }])
  }
  function removeDraftRow(partNumber) { setDraft(d => d.filter(r => r.component_part_number !== partNumber)) }
  function setDraftQty(partNumber, qty) { setDraft(d => d.map(r => r.component_part_number === partNumber ? { ...r, quantity: qty } : r)) }

  function handleImportRows(rows) {
    const cycleFreeEdges = allEdges.filter(e => e.parent_part_number !== selectedPart)
    const accepted = [], rejected = []
    rows.forEach(r => {
      if (wouldCreateCycle(selectedPart, r.component_part_number, cycleFreeEdges)) rejected.push(r.component_part_number)
      else accepted.push(r)
    })
    setDraft(prev => {
      const map = new Map(prev.map(d => [d.component_part_number, d]))
      accepted.forEach(r => map.set(r.component_part_number, {
        component_part_number: r.component_part_number, name: r.component_name, quantity: r.required_quantity_for_product, notes: r.notes || '',
      }))
      return [...map.values()]
    })
    setErr(rejected.length ? `Skipped ${rejected.length} component(s) that would create a circular BOM: ${rejected.join(', ')}` : '')
    setShowImport(false)
  }

  async function handleSave() {
    setSubmitting(true); setErr('')
    try {
      await saveNewBomVersion(selectedPart, draft, profile.id, saveNotes)
      setEditing(false); setAiSuggestedNew([])
      await Promise.all([loadDetail(selectedPart), loadOverview()])
    } catch (e) { setErr(e.message) }
    finally { setSubmitting(false) }
  }

  async function openVersionPreview(v) {
    if (previewVersion?.id === v.id) { setPreviewVersion(null); setPreviewComponents(null); return }
    setPreviewVersion(v)
    setPreviewComponents(await getVersionComponents(v.id))
  }

  function restoreVersion() {
    if (!previewComponents) return
    const productByPart = Object.fromEntries(products.map(p => [p.part_number, p]))
    setDraft(previewComponents.map(c => ({
      component_part_number: c.component_part_number, name: productByPart[c.component_part_number]?.name || c.component_part_number,
      quantity: c.quantity, notes: c.notes || '',
    })))
    setSaveNotes(`Restored from version ${previewVersion.version_no}`)
    setPreviewVersion(null); setPreviewComponents(null)
    setErr('')
    setEditing(true)
  }

  // Only real, serialized Products can BE a BOM's subject — a Component is a
  // BOM ingredient, not something that itself has a Bill of Materials (it
  // still shows up in availableToAdd below, just not in this selector).
  const bomSubjects = useMemo(() => products.filter(p => p.is_serialized), [products])

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return bomSubjects
    return bomSubjects.filter(p => p.name?.toLowerCase().includes(q) || p.part_number?.toLowerCase().includes(q))
  }, [bomSubjects, search])

  const availableToAdd = useMemo(() => {
    if (!editing) return []
    const draftParts = new Set(draft.map(d => d.component_part_number))
    return products.filter(p => p.part_number !== selectedPart && !draftParts.has(p.part_number) && !wouldCreateCycle(selectedPart, p.part_number, allEdges.filter(e => e.parent_part_number !== selectedPart)))
  }, [editing, draft, products, selectedPart, allEdges])

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <Boxes size={19} />
            </span>
            BOM Management
          </div>
          <div className="page-subtitle">Product-wise Bill of Materials — versioned, with rolled-up cost and inventory</div>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 6 }}>
        <StatCard label="Products with BOM" value={summary.productsWithBomCount} icon={<Package size={17} />} accent="#6366f1" />
        <StatCard label="Distinct Components" value={summary.distinctComponentCount} icon={<Layers size={17} />} accent="#8b5cf6" />
        <StatCard label="Total BOM Value" value={rupee(summary.totalBomValue)} icon={<Wallet size={17} />} accent="#10b981" />
        <StatCard label="Total Component Spend" value={rupee(componentSpend)} icon={<ShoppingCart size={17} />} accent="#f59e0b" />
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 20 }}>
        Total BOM Value sums each top-level product's own rolled-up cost — it can double-count value when a sub-assembly is also independently tracked as its own top-level product elsewhere. Total Component Spend is real requisitioned spend (Spend Analyzer → By Product) for everything used as a BOM component anywhere.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20, alignItems: 'start' }}>
        <div className="card" style={{ position: 'sticky', top: 76, overflow: 'hidden' }}>
          <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
            <SearchBox value={search} onChange={setSearch} placeholder="Search products…" />
          </div>
          <div style={{ maxHeight: 620, overflowY: 'auto' }}>
            {filteredProducts.map(p => {
              const v = versionByPart[p.part_number]
              const active = selectedPart === p.part_number
              return (
                <button key={p.part_number} onClick={() => selectProduct(p.part_number)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '11px 14px',
                    border: 'none', borderLeft: active ? '3px solid #fff' : '3px solid transparent', borderBottom: '1px solid var(--border)',
                    cursor: 'pointer', background: active ? 'linear-gradient(135deg,#6366f1,#7c6cf0)' : 'transparent',
                    color: active ? '#fff' : 'inherit', transition: 'background .12s',
                  }}>
                  <span style={{
                    width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: active ? 'rgba(255,255,255,.18)' : v ? '#eef2ff' : '#f1f5f9', color: active ? '#fff' : v ? '#6366f1' : '#94a3b8',
                  }}>
                    <Package size={14} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                    <div style={{ fontSize: 11, opacity: .85, marginTop: 2, display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                      <span style={{ fontFamily: 'monospace' }}>{p.part_number}</span>
                      <span style={{
                        padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700, flexShrink: 0,
                        background: active ? 'rgba(255,255,255,.22)' : v ? 'rgba(16,185,129,.12)' : 'rgba(148,163,184,.15)',
                        color: active ? '#fff' : v ? '#059669' : '#94a3b8',
                      }}>{v ? `v${v}` : 'No BOM'}</span>
                    </div>
                  </div>
                  {active && <ChevronRight size={14} style={{ opacity: .8, flexShrink: 0 }} />}
                </button>
              )
            })}
            {filteredProducts.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>No products match</div>}
          </div>
        </div>

        <div className="card" style={{ padding: '20px 24px', minHeight: 300 }}>
          {!selectedPart ? (
            <Empty icon={<Boxes size={40} />} title="Select a product" desc="Pick a product from the list to view or edit its Bill of Materials" />
          ) : detailLoading || !detail ? <Loader /> : (
            <BomDetail
              partNumber={selectedPart} detail={detail} canEdit={canEdit}
              editing={editing} draft={draft} err={err} submitting={submitting} saveNotes={saveNotes}
              availableToAdd={availableToAdd} showImport={showImport} setShowImport={setShowImport}
              onStartEdit={startEdit} onCancelEdit={cancelEdit} onSave={handleSave} setSaveNotes={setSaveNotes}
              onAddRow={addDraftRow} onRemoveRow={removeDraftRow} onQtyChange={setDraftQty}
              previewVersion={previewVersion} previewComponents={previewComponents}
              onOpenVersionPreview={openVersionPreview} onRestoreVersion={restoreVersion}
              products={products} stockByPart={stockByPart}
              onOpenAiModal={() => setShowAiPanel(true)}
            />
          )}
        </div>
      </div>

      <Modal open={showImport} onClose={() => setShowImport(false)} title="Import BOM Components from Excel" size="lg">
        <ExcelImport
          type="bom"
          lookups={{ products, currentPartNumber: selectedPart, stockByPart }}
          onImportRows={handleImportRows}
          onSuccess={() => {}}
          onClose={() => setShowImport(false)}
        />
      </Modal>

      <AIDockedPanel open={showAiPanel} onClose={() => setShowAiPanel(false)} title="BOM AI" subtitle="Draft a Bill of Materials">
        <BomAiTab profile={profile} onSaved={() => { loadDetail(selectedPart); loadOverview() }} />
      </AIDockedPanel>
    </div>
  )
}

function BomDetail({
  partNumber, detail, canEdit, editing, draft, err, submitting, saveNotes,
  availableToAdd, showImport, setShowImport, onStartEdit, onCancelEdit, onSave, setSaveNotes, onAddRow, onRemoveRow, onQtyChange,
  previewVersion, previewComponents, onOpenVersionPreview, onRestoreVersion, products, stockByPart,
  onOpenAiModal,
}) {
  const varianceSignificant = Math.abs(detail.variance) > 1 && detail.standardCost > 0 && Math.abs(detail.variance / detail.standardCost) > 0.05
  const productByPart = Object.fromEntries(products.map(p => [p.part_number, p]))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#eef2ff,#e0e7ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6366f1', flexShrink: 0 }}>
            <Package size={20} />
          </span>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{detail.tree.name}</div>
            <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#94a3b8' }}>{partNumber}</div>
          </div>
        </div>
        {canEdit && (editing ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-outline btn-sm" onClick={() => setShowImport(true)}><Upload size={13} /> Import from Excel</button>
            <button className="btn btn-ghost btn-sm" onClick={onCancelEdit} disabled={submitting}><X size={13} /> Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={onSave} disabled={submitting || !draft.length}><Save size={13} /> {submitting ? 'Saving…' : 'Save as New Version'}</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={onOpenAiModal} style={{ background: 'linear-gradient(135deg,#8b5cf611,#22d3ee11)', borderColor: '#8b5cf644' }}>
              <Sparkles size={13} /> Generate with AI
            </button>
            <button className="btn btn-outline btn-sm" onClick={onStartEdit}>Edit BOM</button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 22, flexWrap: 'wrap' }}>
        <MiniStat label="Active Version" value={detail.activeVersion ? `v${detail.activeVersion.version_no}` : '—'} accent="#6366f1" icon={<Sparkles size={13} />} />
        <MiniStat label="Standard Cost" value={rupee(detail.standardCost)} accent="#0ea5e9" icon={<Wallet size={13} />} />
        <MiniStat label="Rolled-Up BOM Cost" value={rupee(detail.rolledUpCost)} accent="#8b5cf6" icon={<Layers size={13} />} />
        {varianceSignificant && (
          <div style={{ padding: '10px 14px', borderRadius: 10, background: 'linear-gradient(135deg,#fef2f2,#fee2e2)', border: '1px solid #fecaca' }}>
            <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={11} /> VARIANCE</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#dc2626' }}>{detail.variance > 0 ? '+' : ''}{rupee(detail.variance)}</div>
          </div>
        )}
      </div>

      {err && <div className="alert alert-danger" style={{ marginBottom: 14 }}>{err}</div>}

      <SectionHeading icon={<Boxes size={14} />}>Components</SectionHeading>
      {editing ? (
        <div style={{ marginBottom: 24 }}>
          <div className="table-wrap" style={{ marginBottom: 12 }}>
            <table>
              <thead><tr>
                <th>Component Name</th><th>Component ID</th><th>Part Number</th>
                <th>Per Unit Cost</th><th>Quantity (Stock)</th><th>Required Qty for Product</th><th></th>
              </tr></thead>
              <tbody>
                {draft.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: '#94a3b8', padding: 16 }}>No components — add one below, import from Excel, or save empty to clear the BOM</td></tr>}
                {draft.map(row => {
                  const p = productByPart[row.component_part_number]
                  return (
                    <tr key={row.component_part_number}>
                      <td className="td-bold">{row.name}</td>
                      <td><ComponentIdCell id={p?.id} /></td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{row.component_part_number}</td>
                      <td>{rupee(p?.standard_cost || 0)}</td>
                      <td><StockCell product={p} stockByPart={stockByPart} /></td>
                      <td><input className="form-input" style={{ width: 80 }} type="number" min="0.01" step="0.01" value={row.quantity} onChange={e => onQtyChange(row.component_part_number, e.target.value)} /></td>
                      <td><button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => onRemoveRow(row.component_part_number)}><Trash2 size={12} /></button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <select className="form-select" style={{ flex: 1, minWidth: 220 }} value="" onChange={e => onAddRow(e.target.value)}>
              <option value="">+ Add a component…</option>
              {availableToAdd.map(p => <option key={p.part_number} value={p.part_number}>{p.name} ({p.part_number})</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Version Notes (optional)</label>
            <input className="form-input" value={saveNotes} onChange={e => setSaveNotes(e.target.value)} placeholder="What changed in this version?" />
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 24 }}>
          {detail.tree.children.length === 0 ? (
            <div style={{ fontSize: 12, color: '#94a3b8', padding: '10px 0' }}>No components defined yet — this product has no active BOM.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>Component Name</th><th>Component ID</th><th>Part Number</th>
                  <th>Per Unit Cost</th><th>Quantity (Stock)</th><th>Required Qty for Product</th><th>Line Cost</th>
                </tr></thead>
                <tbody>
                  {detail.tree.children.map(c => {
                    const p = productByPart[c.partNumber]
                    return (
                      <tr key={c.id}>
                        <td className="td-bold">{c.name} {c.children?.length > 0 && <span style={{ fontSize: 10, color: '#8b5cf6', marginLeft: 4, fontWeight: 700 }}>SUB-ASSEMBLY</span>}</td>
                        <td><ComponentIdCell id={p?.id} /></td>
                        <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{c.partNumber}</td>
                        <td>{rupee(p?.standard_cost || 0)}</td>
                        <td><StockCell product={p} stockByPart={stockByPart} /></td>
                        <td>{c.quantity}</td>
                        <td style={{ fontWeight: 700 }}>{rupee(c.lineCost)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <SectionHeading icon={<History size={14} />}>Version History</SectionHeading>
      {detail.versions.length === 0 ? (
        <div style={{ fontSize: 12, color: '#94a3b8', padding: '10px 0' }}>No versions saved yet.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Version</th><th>Status</th><th>By</th><th>Date</th><th>Notes</th><th></th></tr></thead>
            <tbody>
              {detail.versions.map(v => (
                <>
                  <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => onOpenVersionPreview(v)}>
                    <td className="td-bold">v{v.version_no}</td>
                    <td>{v.status === 'active' ? <span className="badge badge-success">Active</span> : <span className="badge">Archived</span>}</td>
                    <td>{v.creator?.full_name || '—'}</td>
                    <td>{new Date(v.created_at).toLocaleDateString('en-IN')}</td>
                    <td style={{ fontSize: 12, color: '#64748b' }}>{v.notes || '—'}</td>
                    <td></td>
                  </tr>
                  {previewVersion?.id === v.id && (
                    <tr><td colSpan={6} style={{ background: 'var(--surface-2)', padding: '14px 18px' }}>
                      {!previewComponents ? <Loader /> : (
                        <div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                            {previewComponents.map(c => (
                              <div key={c.id} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', maxWidth: 320 }}>
                                <span>{productByPart[c.component_part_number]?.name || c.component_part_number}</span>
                                <span style={{ fontWeight: 700 }}>× {c.quantity}</span>
                              </div>
                            ))}
                            {previewComponents.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>This version had no components.</div>}
                          </div>
                          {v.status !== 'active' && canEdit && (
                            <button className="btn btn-outline btn-sm" onClick={onRestoreVersion}><RotateCcw size={12} /> Restore This Version</button>
                          )}
                        </div>
                      )}
                    </td></tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SectionHeading({ icon, children }) {
  return (
    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 7, color: '#334155' }}>
      <span style={{ width: 22, height: 22, borderRadius: 6, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6366f1' }}>{icon}</span>
      {children}
    </div>
  )
}

function MiniStat({ label, value, accent = '#6366f1', icon }) {
  return (
    <div style={{ padding: '10px 14px', borderRadius: 10, background: `${accent}0d`, border: `1px solid ${accent}30`, minWidth: 130 }}>
      <div style={{ fontSize: 10, color: accent, fontWeight: 700, letterSpacing: '.04em', display: 'flex', alignItems: 'center', gap: 4 }}>{icon}{label.toUpperCase()}</div>
      <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>{value}</div>
    </div>
  )
}

// products.id is a UUID — shown truncated (full value in the title tooltip)
// since the raw part number is already the human-readable identifier.
function ComponentIdCell({ id }) {
  if (!id) return <span style={{ color: '#94a3b8' }}>—</span>
  return <span title={id} style={{ fontFamily: 'monospace', fontSize: 11, color: '#64748b', cursor: 'default' }}>{id.slice(0, 8)}…</span>
}

// Serialized components have a real on-hand count from Device Instances
// (status = 'in_storage'). Non-serialized products have no live stock
// table in this app — only a reorder trigger level — so that's shown
// labeled as a threshold, not presented as an actual stock count.
function StockCell({ product, stockByPart }) {
  if (!product) return <span style={{ color: '#94a3b8' }}>—</span>
  if (product.is_serialized) {
    const n = stockByPart?.[product.part_number] ?? 0
    return <span style={{ fontWeight: 700, color: n > 0 ? '#059669' : '#ef4444' }}>{n} in stock</span>
  }
  return <span style={{ fontSize: 11, color: '#94a3b8' }} title="Not serialized — no live stock count tracked, this is the reorder trigger level">Reorder @ {product.reorder_level ?? '—'}</span>
}
