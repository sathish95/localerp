import { supabase } from './supabase'

// Vendor mapping for one component, newest-preferred-first.
export async function getVendorMap(partNumber) {
  const { data, error } = await supabase.from('component_vendors')
    .select('*, vendor:vendors(id,name,email,phone,gst_number,supplier_type)')
    .eq('part_number', partNumber)
    .order('is_preferred', { ascending: false })
    .order('unit_cost', { ascending: true })
  if (error) throw error
  return data || []
}

// Every mapping across every component, keyed by part_number — used by the
// Components list to show each row's preferred vendor without one query per row.
export async function getAllVendorMaps() {
  const { data, error } = await supabase.from('component_vendors').select('*, vendor:vendors(id,name)')
  if (error) throw error
  const byPart = {}
  ;(data || []).forEach(m => { (byPart[m.part_number] ||= []).push(m) })
  return byPart
}

export async function addVendorMap({ partNumber, vendorId, unitCost, leadTimeDays, isPreferred, notes, userId }) {
  if (isPreferred) await clearPreferred(partNumber)
  const { error } = await supabase.from('component_vendors').insert({
    part_number: partNumber, vendor_id: vendorId, unit_cost: Number(unitCost) || 0,
    lead_time_days: leadTimeDays ? Number(leadTimeDays) : null, is_preferred: !!isPreferred,
    notes: notes || null, created_by: userId,
  })
  if (error) throw error
}

export async function updateVendorMap(id, { partNumber, unitCost, leadTimeDays, isPreferred, notes }) {
  if (isPreferred) await clearPreferred(partNumber)
  const { error } = await supabase.from('component_vendors').update({
    unit_cost: Number(unitCost) || 0, lead_time_days: leadTimeDays ? Number(leadTimeDays) : null,
    is_preferred: !!isPreferred, notes: notes || null,
  }).eq('id', id)
  if (error) throw error
}

export async function deleteVendorMap(id) {
  const { error } = await supabase.from('component_vendors').delete().eq('id', id)
  if (error) throw error
}

// Read-then-update client pattern (no DB transaction/RPC) — same known
// race-condition limitation this app already accepts elsewhere (see
// budgetSync.js) — unsets any existing preferred vendor for this part before
// the caller sets a new one, so the partial unique index never conflicts.
async function clearPreferred(partNumber) {
  await supabase.from('component_vendors').update({ is_preferred: false }).eq('part_number', partNumber).eq('is_preferred', true)
}

// Actual money moved with each vendor for this component, derived from the
// same GRN receipts the rest of the app's fund flow already uses (grn_items
// -> grn -> purchase_orders.vendor_id) — not a separate ledger, so this can
// never drift from what Spend Analyzer / Fund Flow report elsewhere.
export async function getVendorSpendForComponent(partNumber) {
  const { data: items, error } = await supabase.from('grn_items').select('quantity_received,unit_cost,grn_id').eq('part_number', partNumber)
  if (error) throw error
  if (!items?.length) return []

  const grnIds = [...new Set(items.map(i => i.grn_id))]
  const { data: grns } = await supabase.from('grn').select('id,po_id').in('id', grnIds)
  const poIdByGrn = Object.fromEntries((grns || []).map(g => [g.id, g.po_id]))

  const poIds = [...new Set(Object.values(poIdByGrn).filter(Boolean))]
  const { data: pos } = poIds.length ? await supabase.from('purchase_orders').select('id,vendor_id').in('id', poIds) : { data: [] }
  const vendorIdByPo = Object.fromEntries((pos || []).map(p => [p.id, p.vendor_id]))

  const vendorIds = [...new Set(Object.values(vendorIdByPo).filter(Boolean))]
  const { data: vendors } = vendorIds.length ? await supabase.from('vendors').select('id,name').in('id', vendorIds) : { data: [] }
  const vendorById = Object.fromEntries((vendors || []).map(v => [v.id, v]))

  const byVendor = {}
  items.forEach(i => {
    const poId = poIdByGrn[i.grn_id]
    const vendorId = poId ? vendorIdByPo[poId] : null
    const key = vendorId || 'unknown'
    const b = byVendor[key] ||= { vendorId, vendorName: vendorId ? (vendorById[vendorId]?.name || '—') : 'Unlinked GRN', qtyReceived: 0, amountSpent: 0 }
    b.qtyReceived += Number(i.quantity_received || 0)
    b.amountSpent += Number(i.quantity_received || 0) * Number(i.unit_cost || 0)
  })
  return Object.values(byVendor)
    .map(v => ({ ...v, amountSpent: Math.round(v.amountSpent * 100) / 100 }))
    .sort((a, b) => b.amountSpent - a.amountSpent)
}
