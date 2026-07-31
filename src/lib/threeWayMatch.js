import { supabase } from './supabase'

export async function getMatchTolerance() {
  const { data } = await supabase.from('finance_settings').select('match_variance_tolerance_pct').maybeSingle()
  return data?.match_variance_tolerance_pct ?? 5
}

// reference = total received_amount summed across every GRN raised against
// this PO (a PO can have multiple GRNs for repeated partial deliveries), else
// po.total_amount (2-way fallback when nothing has been received yet).
export function runMatch(invoice, po, receivedAmount, tolerancePct) {
  if (!invoice.po_id || !po) return { match_status: 'unmatched', variance_percent: null }
  const reference = receivedAmount || po.total_amount
  if (!reference) return { match_status: 'unmatched', variance_percent: null }
  const variance_percent = Math.round((((invoice.total_amount - reference) / reference) * 100) * 100) / 100
  const match_status = Math.abs(variance_percent) <= tolerancePct ? 'matched' : 'variance'
  return { match_status, variance_percent }
}

export async function runMatchAndSave(invoiceId, poId, tolerancePct) {
  const [{ data: po }, { data: grns }] = await Promise.all([
    supabase.from('purchase_orders').select('*').eq('id', poId).maybeSingle(),
    supabase.from('grn').select('received_amount').eq('po_id', poId),
  ])
  const receivedAmount = (grns || []).reduce((s, g) => s + (g.received_amount || 0), 0)
  const { data: invoice } = await supabase.from('invoices').select('*').eq('id', invoiceId).single()
  const result = runMatch({ ...invoice, po_id: poId }, po, receivedAmount, tolerancePct)
  await supabase.from('invoices').update({
    po_id: poId, match_status: result.match_status, variance_percent: result.variance_percent,
  }).eq('id', invoiceId)
  return result
}

// finance/admin/ceo only (enforced by the calling page's role gate)
export async function applyOverride(invoiceId, profileId, note) {
  await supabase.from('invoices').update({
    match_status: 'override_approved', match_override_by: profileId, match_override_at: new Date().toISOString(),
    variance_notes: note || null,
  }).eq('id', invoiceId)
}
