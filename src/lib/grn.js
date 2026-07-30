import { supabase, nextNum } from './supabase'

export async function getGRNItems(grnId) {
  const { data, error } = await supabase.from('grn_items').select('*').eq('grn_id', grnId).order('created_at')
  if (error) throw error
  return data || []
}

// Sum of quantity_received already posted per po_item_id, across every GRN
// raised against this PO so far — used to prefill "Create GRN" with what's
// still outstanding rather than the full ordered quantity every time.
export async function getReceivedQtyByPOItem(poId) {
  const { data: grns, error: grnErr } = await supabase.from('grn').select('id').eq('po_id', poId)
  if (grnErr) throw grnErr
  const grnIds = (grns || []).map(g => g.id)
  if (!grnIds.length) return {}
  const { data: items, error } = await supabase.from('grn_items').select('po_item_id,quantity_received').in('grn_id', grnIds)
  if (error) throw error
  const totals = {}
  ;(items || []).forEach(i => { if (i.po_item_id) totals[i.po_item_id] = (totals[i.po_item_id] || 0) + Number(i.quantity_received || 0) })
  return totals
}

// items: [{po_item_id, part_number, description, quantity_ordered, quantity_received, unit_cost}]
export async function createAndReceiveGRN({ poId, receivedDate, items, remarks, userId }) {
  if (!items?.length) throw new Error('At least one item is required')
  const grnNumber = await nextNum('grn')
  const { data, error } = await supabase.rpc('receive_grn', {
    p_grn_number: grnNumber,
    p_po_id: poId,
    p_received_date: receivedDate || new Date().toISOString().slice(0, 10),
    p_items: items.map(i => ({
      po_item_id: i.po_item_id || null,
      part_number: i.part_number || null,
      description: i.description,
      quantity_ordered: Number(i.quantity_ordered) || 0,
      quantity_received: Number(i.quantity_received) || 0,
      unit_cost: Number(i.unit_cost) || 0,
    })),
    p_user_id: userId,
    p_remarks: remarks || null,
  })
  if (error) throw error
  return data
}
