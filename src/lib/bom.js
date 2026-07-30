import { supabase } from './supabase'

// Product-wise multi-level Bill of Materials, versioned (STEP52).
// A version header per product (product_bom_versions — one row per save,
// exactly one 'active' at a time) with that version's component snapshot
// underneath it (product_bom_version_components). Every save creates a new
// version via the save_bom_version() RPC rather than mutating the current
// one in place, so history is never lost — see STEP52's SQL comments for
// why that RPC exists (atomicity the JS client can't provide alone).
//
// The tree/cost/cycle logic below is unchanged from the flat-table version
// of this file — it already operates on abstract
// {parent_part_number, component_part_number, quantity} edges and doesn't
// care where those edges come from. Only the source changed: instead of a
// flat mutable table, edges now come from getActiveBomEdges() — each
// product's currently-active version.

// All active versions, joined to their component snapshots, flattened into
// the same {parent_part_number, component_part_number, quantity, id} edge
// shape the tree/cost/cycle functions below expect — this is the "current
// state" graph, replacing the old flat table.
export async function getActiveBomEdges() {
  const { data: versions, error: vErr } = await supabase.from('product_bom_versions').select('id,part_number').eq('status', 'active')
  if (vErr) throw vErr
  const versionIds = (versions || []).map(v => v.id)
  if (!versionIds.length) return []
  const { data: comps, error: cErr } = await supabase.from('product_bom_version_components')
    .select('id,version_id,component_part_number,quantity,notes').in('version_id', versionIds)
  if (cErr) throw cErr
  const partByVersion = Object.fromEntries(versions.map(v => [v.id, v.part_number]))
  return (comps || []).map(c => ({
    id: c.id, parent_part_number: partByVersion[c.version_id], component_part_number: c.component_part_number,
    quantity: c.quantity, notes: c.notes,
  }))
}

// Lightweight {part_number: version_no} map for every product with an
// active version — used by the BOM Management page's product list to show
// a "v{N}" badge without an N+1 query per product.
export async function getActiveVersionsByPart() {
  const { data, error } = await supabase.from('product_bom_versions').select('part_number,version_no').eq('status', 'active')
  if (error) throw error
  return Object.fromEntries((data || []).map(v => [v.part_number, v.version_no]))
}

export async function getVersionsForProduct(partNumber) {
  const { data, error } = await supabase.from('product_bom_versions')
    .select('*,creator:profiles!created_by(full_name)').eq('part_number', partNumber).order('version_no', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getVersionComponents(versionId) {
  const { data, error } = await supabase.from('product_bom_version_components').select('*').eq('version_id', versionId)
  if (error) throw error
  return data || []
}

// components: [{component_part_number, quantity, notes}]. Cycle-checks
// against the CURRENT company-wide graph excluding this product's own
// existing edges (since they're about to be replaced by this save), then
// commits atomically via the save_bom_version RPC.
export async function saveNewBomVersion(partNumber, components, userId, notes) {
  if (!components?.length) throw new Error('At least one component is required')
  const edges = (await getActiveBomEdges()).filter(e => e.parent_part_number !== partNumber)
  for (const c of components) {
    if (wouldCreateCycle(partNumber, c.component_part_number, edges)) {
      throw new Error(`Adding ${c.component_part_number} would create a circular BOM.`)
    }
  }
  const { data, error } = await supabase.rpc('save_bom_version', {
    p_part_number: partNumber,
    p_components: components.map(c => ({ component_part_number: c.component_part_number, quantity: Number(c.quantity) || 1, notes: c.notes || null })),
    p_user_id: userId,
    p_notes: notes || null,
  })
  if (error) throw error
  return data
}

// DFS from componentPart following ITS OWN existing components — if
// parentPart is reachable, adding parentPart -> componentPart would close a
// loop (componentPart would, directly or transitively, already contain the
// very product we're trying to make it a component of).
export function wouldCreateCycle(parentPart, componentPart, allRows) {
  if (parentPart === componentPart) return true
  const byParent = {}
  allRows.forEach(r => { (byParent[r.parent_part_number] ||= []).push(r.component_part_number) })
  const seen = new Set()
  const stack = [componentPart]
  while (stack.length) {
    const cur = stack.pop()
    if (cur === parentPart) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    ;(byParent[cur] || []).forEach(next => stack.push(next))
  }
  return false
}

// Leaf (no components of its own) costs its own standard_cost; an assembly
// costs sum(component.quantity * componentRolledUpCost). `visited` is a
// belt-and-suspenders cycle guard alongside the write-time check above —
// a bad/legacy row should never be able to hang the UI in infinite recursion.
export function computeRolledUpCost(partNumber, bomByParent, productsByPart, visited = new Set()) {
  if (visited.has(partNumber)) return 0
  const components = bomByParent[partNumber] || []
  if (!components.length) return Number(productsByPart[partNumber]?.standard_cost || 0)
  const nextVisited = new Set(visited); nextVisited.add(partNumber)
  return components.reduce((sum, c) => sum + Number(c.quantity || 0) * computeRolledUpCost(c.component_part_number, bomByParent, productsByPart, nextVisited), 0)
}

// Same recursion as computeRolledUpCost, but returns a display tree instead
// of just a number. The root node has no quantity/lineCost (nothing to be a
// line item of); each child carries the quantity/lineCost relative to its
// direct parent.
export function getBomTree(partNumber, bomByParent, productsByPart, visited = new Set()) {
  const product = productsByPart[partNumber]
  const base = { partNumber, name: product?.name || partNumber, isSerialized: !!product?.is_serialized, unitStandardCost: Number(product?.standard_cost || 0) }
  if (visited.has(partNumber)) return { ...base, rolledUpUnitCost: 0, children: [], cycleDetected: true }

  const nextVisited = new Set(visited); nextVisited.add(partNumber)
  const components = bomByParent[partNumber] || []
  const children = components.map(c => {
    const childTree = getBomTree(c.component_part_number, bomByParent, productsByPart, nextVisited)
    const quantity = Number(c.quantity || 0)
    return { ...childTree, id: c.id, quantity, lineCost: Math.round(quantity * childTree.rolledUpUnitCost * 100) / 100 }
  })
  const rolledUpUnitCost = children.length
    ? Math.round(children.reduce((s, c) => s + c.lineCost, 0) * 100) / 100
    : base.unitStandardCost

  return { ...base, rolledUpUnitCost, children }
}

async function loadProductsByPart() {
  const { data, error } = await supabase.from('products').select('part_number,name,standard_cost,is_serialized,reorder_level,reorder_qty')
  if (error) throw error
  return Object.fromEntries((data || []).map(p => [p.part_number, p]))
}

// Orchestrator for the BOM Management page's detail pane: the active
// version's tree, rolled-up cost, and the full version list for history.
export async function getProductBomDetail(partNumber) {
  const [edges, productsByPart, versions] = await Promise.all([
    getActiveBomEdges(), loadProductsByPart(), getVersionsForProduct(partNumber),
  ])
  const bomByParent = {}
  edges.forEach(e => { (bomByParent[e.parent_part_number] ||= []).push(e) })

  const tree = getBomTree(partNumber, bomByParent, productsByPart)
  const rolledUpCost = computeRolledUpCost(partNumber, bomByParent, productsByPart)
  const standardCost = Number(productsByPart[partNumber]?.standard_cost || 0)
  const activeVersion = versions.find(v => v.status === 'active') || null

  return {
    tree, rolledUpCost: Math.round(rolledUpCost * 100) / 100, standardCost,
    variance: Math.round((rolledUpCost - standardCost) * 100) / 100,
    activeVersion, versions,
  }
}

// Same name and return shape as before versioning — SpendAnalyzerPage.jsx's
// Product tab BOM section calls this and needs no changes; only the
// internal data source moved from the flat table to getActiveBomEdges().
export async function getBomInventoryBreakdown(partNumber) {
  const [edges, productsByPart] = await Promise.all([getActiveBomEdges(), loadProductsByPart()])
  const bomByParent = {}
  edges.forEach(e => { (bomByParent[e.parent_part_number] ||= []).push(e) })

  const tree = getBomTree(partNumber, bomByParent, productsByPart)
  const rolledUpCost = computeRolledUpCost(partNumber, bomByParent, productsByPart)
  const standardCost = Number(productsByPart[partNumber]?.standard_cost || 0)

  const allParts = new Set()
  ;(function collect(node) { allParts.add(node.partNumber); (node.children || []).forEach(collect) })(tree)
  const serializedParts = [...allParts].filter(p => productsByPart[p]?.is_serialized)

  const { data: devices } = serializedParts.length
    ? await supabase.from('device_instances').select('part_number,status').in('part_number', serializedParts)
    : { data: [] }
  const inventoryByPart = {}
  ;(devices || []).forEach(d => {
    const bucket = inventoryByPart[d.part_number] ||= { deployedCount: 0, inStorageCount: 0 }
    if (['deployed', 'faulty', 'replaced'].includes(d.status)) bucket.deployedCount++
    else if (d.status === 'in_storage') bucket.inStorageCount++
  })

  ;(function annotate(node) {
    const prod = productsByPart[node.partNumber]
    node.inventory = prod?.is_serialized
      ? { type: 'serialized', deployedCount: 0, inStorageCount: 0, ...(inventoryByPart[node.partNumber] || {}) }
      : { type: 'threshold', reorderLevel: prod?.reorder_level ?? null, reorderQty: prod?.reorder_qty ?? null }
    ;(node.children || []).forEach(annotate)
  })(tree)

  return {
    tree,
    rolledUpCost: Math.round(rolledUpCost * 100) / 100,
    standardCost,
    variance: Math.round((rolledUpCost - standardCost) * 100) / 100,
  }
}

// Company-wide summary for the BOM Management page's KPI strip. One pass
// over the active-edges graph plus the product catalog; no N+1 queries.
export async function getBomCompanySummary() {
  const [edges, productsByPart] = await Promise.all([getActiveBomEdges(), loadProductsByPart()])
  const bomByParent = {}
  edges.forEach(e => { (bomByParent[e.parent_part_number] ||= []).push(e) })

  const productsWithBom = Object.keys(bomByParent)
  const distinctComponents = new Set(edges.map(e => e.component_part_number))
  // Sum of each top-level BOM'd product's own rolled-up cost — can
  // double-count value when a sub-assembly is ALSO independently tracked
  // as its own top-level product elsewhere (an inherent multi-parent-BOM
  // ambiguity, not hidden here).
  const totalBomValue = productsWithBom.reduce((s, part) => s + computeRolledUpCost(part, bomByParent, productsByPart), 0)

  return {
    productsWithBomCount: productsWithBom.length,
    distinctComponentCount: distinctComponents.size,
    totalBomValue: Math.round(totalBomValue * 100) / 100,
    componentPartNumbers: [...distinctComponents],
  }
}
