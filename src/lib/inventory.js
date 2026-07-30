import { supabase } from './supabase'
import { getSpendByProduct } from './spendAnalyzer'

// Non-serialized on-hand balance = SUM(quantity) from the ledger, grouped
// by part_number. Aggregated client-side over a full-table fetch — same
// convention as getBomCompanySummary/getSpendByProduct elsewhere in this
// app (no precomputed running-balance column to keep in sync).
export async function getOnHandByPart() {
  const { data, error } = await supabase.from('inventory_transactions').select('part_number,quantity')
  if (error) throw error
  const byPart = {}
  ;(data || []).forEach(t => { byPart[t.part_number] = (byPart[t.part_number] || 0) + Number(t.quantity || 0) })
  return byPart
}

// Serialized on-hand = count of device_instances currently in_storage,
// grouped by part_number — device_instances is already the correct source
// of truth for serialized stock, this just aggregates it by part.
export async function getSerializedStockByPart() {
  const { data, error } = await supabase.from('device_instances').select('part_number').eq('status', 'in_storage')
  if (error) throw error
  const byPart = {}
  ;(data || []).forEach(d => { byPart[d.part_number] = (byPart[d.part_number] || 0) + 1 })
  return byPart
}

// Full catalog with on-hand qty (serialized or ledger, by is_serialized),
// valuation at current standard_cost, and a low-stock flag. This is the
// Inventory page's master list source.
export async function getInventoryList() {
  const [{ data: products, error: pErr }, ledgerByPart, deviceByPart] = await Promise.all([
    supabase.from('products').select('id,part_number,name,device_type,standard_cost,is_serialized,reorder_level,reorder_qty').order('name'),
    getOnHandByPart(),
    getSerializedStockByPart(),
  ])
  if (pErr) throw pErr
  return (products || []).map(p => {
    const onHand = p.is_serialized ? (deviceByPart[p.part_number] || 0) : Math.round((ledgerByPart[p.part_number] || 0) * 100) / 100
    const unitCost = Number(p.standard_cost || 0)
    const reorderLevel = Number(p.reorder_level || 0)
    return {
      ...p, onHand, unitCost,
      totalValue: Math.round(onHand * unitCost * 100) / 100,
      lowStock: reorderLevel > 0 && onHand < reorderLevel,
    }
  })
}

// Company-wide KPI strip. totalComponentSpend calls getSpendByProduct()
// directly (not re-derived) so it is exactly the number Spend Analyzer's
// "By Product" view shows — the mechanism that keeps the two in sync.
export async function getInventorySummary() {
  const [list, spendRows] = await Promise.all([
    getInventoryList(),
    getSpendByProduct({ limit: 1000 }),
  ])
  return {
    totalComponentsTracked: list.length,
    totalStockValue: Math.round(list.reduce((s, i) => s + i.totalValue, 0) * 100) / 100,
    lowStockCount: list.filter(i => i.lowStock).length,
    lowStockItems: list.filter(i => i.lowStock),
    totalComponentSpend: Math.round(spendRows.reduce((s, r) => s + (r.requisitionedTotal || 0), 0) * 100) / 100,
  }
}

// Status breakdown for a serialized part's device_instances — same status
// buckets DevicesPage.jsx already counts, scoped to one part_number.
export async function getSerializedDeviceBreakdown(partNumber) {
  const { data, error } = await supabase.from('device_instances').select('id,device_code,serial_number,status,current_location').eq('part_number', partNumber)
  if (error) throw error
  const rows = data || []
  return {
    total: rows.length,
    inStorage: rows.filter(d => d.status === 'in_storage').length,
    deployed: rows.filter(d => d.status === 'deployed').length,
    attention: rows.filter(d => ['faulty', 'replaced'].includes(d.status)).length,
    decommissioned: rows.filter(d => d.status === 'decommissioned').length,
    devices: rows,
  }
}

export async function getPartLedger(partNumber) {
  const { data, error } = await supabase
    .from('inventory_transactions')
    .select('*,creator:profiles!created_by(full_name)')
    .eq('part_number', partNumber)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// quantity is always passed as a positive magnitude from the UI except for
// 'adjustment', where the caller passes a signed delta directly (a
// correction can go either way and the UI collects a +/- toggle for it).
export async function recordManualTransaction({ partNumber, txnType, quantity, unitCost, notes, userId }) {
  const qty = Number(quantity) || 0
  const signedQty = txnType === 'stock_out' ? -Math.abs(qty) : txnType === 'stock_in' ? Math.abs(qty) : qty
  const { error } = await supabase.from('inventory_transactions').insert({
    part_number: partNumber, txn_type: txnType, quantity: signedQty, unit_cost: Number(unitCost) || 0,
    reference_type: 'manual', notes: notes || null, created_by: userId,
  })
  if (error) throw error
}

// GRNs that included this part_number, newest first. grn_items has no FK
// to grn/purchase_orders (soft refs, per this app's convention), so this
// joins client-side in two steps rather than via PostgREST embed.
export async function getReceivingHistory(partNumber) {
  const { data: items, error } = await supabase.from('grn_items').select('*').eq('part_number', partNumber).order('created_at', { ascending: false })
  if (error) throw error
  if (!items?.length) return []
  const grnIds = [...new Set(items.map(i => i.grn_id))]
  const { data: grns } = await supabase.from('grn').select('id,grn_number,received_date,po_id').in('id', grnIds)
  const poIds = [...new Set((grns || []).map(g => g.po_id).filter(Boolean))]
  const { data: pos } = poIds.length ? await supabase.from('purchase_orders').select('id,po_number').in('id', poIds) : { data: [] }
  const poById = Object.fromEntries((pos || []).map(p => [p.id, p]))
  const grnById = Object.fromEntries((grns || []).map(g => [g.id, g]))
  return items.map(i => {
    const grn = grnById[i.grn_id]
    return {
      ...i, grnNumber: grn?.grn_number, receivedDate: grn?.received_date,
      poNumber: grn?.po_id ? poById[grn.po_id]?.po_number : null,
    }
  })
}
