import { supabase, nextNum } from './supabase'
import { commitBudget } from './budgetSync'

export async function getPOItems(poId) {
  const { data, error } = await supabase.from('purchase_order_items').select('*').eq('po_id', poId).order('sort_order')
  if (error) throw error
  return data || []
}

// Approved PRs with no PO raised against them yet — the pool available for
// "Create PO". Filtered client-side (fetch both, subtract) rather than a
// NOT IN subquery, matching this app's established client-side-join
// convention (DevicesPage.jsx et al.) since these are two independent
// small tables, not worth a server round-trip per row.
export async function getEligiblePRsForPO() {
  const [{ data: prs, error: prErr }, { data: pos, error: poErr }] = await Promise.all([
    supabase.from('purchase_requisitions').select('id,pr_number,title,vendor_id,estimated_total,requested_by').eq('status', 'approved'),
    supabase.from('purchase_orders').select('pr_id'),
  ])
  if (prErr) throw prErr
  if (poErr) throw poErr
  const withPO = new Set((pos || []).map(p => p.pr_id).filter(Boolean))
  return (prs || []).filter(pr => !withPO.has(pr.id))
}

// budgetId: the source PR's budget_id (optional). commitBudget() is already
// called at PR-approval time for the PR's pre-tax estimated_total — but the
// PO's real vendor commitment is GST-inclusive, so once the PO exists (and
// its real gst_amount is known) we true up the same budget by that GST
// delta, otherwise "Committed" permanently understates the real commitment
// by the GST percentage.
export async function createPOFromPR(prId, vendorId, deliveryDate, gstPercent, terms, userId, budgetId) {
  const poNumber = await nextNum('po')
  const { data, error } = await supabase.rpc('create_po_from_pr', {
    p_po_number: poNumber,
    p_pr_id: prId,
    p_vendor_id: vendorId,
    p_delivery_date: deliveryDate || null,
    p_user_id: userId,
    p_gst_percent: gstPercent ?? 18,
    p_terms: terms || null,
  })
  if (error) throw error
  if (budgetId) {
    const { data: po } = await supabase.from('purchase_orders').select('gst_amount').eq('id', data).maybeSingle()
    if (po?.gst_amount) await commitBudget(budgetId, po.gst_amount)
  }
  return data
}
