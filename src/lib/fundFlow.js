import { supabase } from './supabase'
import { getWarrantyAnalyticsRollup } from './warrantyAnalytics'

/**
 * FUND FLOW — assembles the existing commit -> spend -> pay lifecycle into
 * one ordered chain. Every number here already exists somewhere in the app
 * (ProcurementPage, PurchaseOrdersPage, GRNPage, InvoicesPage, PaymentsPage
 * each show one stage in isolation) — this just reads the same tables and
 * puts them in order. No new schema.
 *
 * Chain: Budget Allocated -> Committed (PR approved, budgets.committed_amount
 * via budgetSync.js) -> PO Issued -> GRN Received -> Invoiced -> Paid.
 *
 * purchase_orders/grn don't carry project_id/department_id directly — POs
 * link to a project via pr_id -> purchase_requisitions.project_id, and GRNs
 * via po_id -> purchase_orders -> ... -> project_id. Project/department
 * filters resolve that chain of ids first.
 */

const PO_ACTIVE = ['sent', 'acknowledged', 'delivered', 'closed'] // excludes draft/cancelled
const GRN_RECEIVED = ['partial', 'received', 'closed']
const INVOICE_NON_REJECTED = ['uploaded', 'processing', 'verified', 'matched', 'paid']

async function resolveScopeIds({ departmentId, projectId }) {
  let projectIds = null
  if (projectId) projectIds = [projectId]
  else if (departmentId) {
    const { data } = await supabase.from('projects').select('id').eq('department_id', departmentId)
    projectIds = (data || []).map(p => p.id)
  }
  if (!projectIds) return { projectIds: null, prIds: null }

  const { data: prs } = projectIds.length
    ? await supabase.from('purchase_requisitions').select('id').in('project_id', projectIds)
    : { data: [] }
  return { projectIds, prIds: (prs || []).map(p => p.id) }
}

// budgets rows land two ways (per spendAnalyzer.js's own convention comment):
// project-scoped rows (project_id set, department_id null) or dept-scoped
// overhead rows (department_id set directly, no project_id) — a department
// filter needs to catch both, a project filter only the first.
function scopedBudgetsQuery(cols, { departmentId, projectId, projectIds }) {
  let q = supabase.from('budgets').select(cols)
  if (projectId) return q.eq('project_id', projectId)
  if (departmentId) return q.or(`department_id.eq.${departmentId}${projectIds?.length ? `,project_id.in.(${projectIds.join(',')})` : ''}`)
  return q
}

export async function getFundFlowStages({ departmentId, projectId, vendorId } = {}) {
  const { projectIds, prIds } = await resolveScopeIds({ departmentId, projectId })
  const scoped = projectIds != null // true whenever a department/project filter is active

  // ── Budget Allocated / Committed — budgets ──
  const { data: budgets } = await scopedBudgetsQuery('allocated,committed_amount,project_id,department_id', { departmentId, projectId, projectIds })
  const allocated = (budgets || []).reduce((s, b) => s + Number(b.allocated || 0), 0)
  const committed = (budgets || []).reduce((s, b) => s + Number(b.committed_amount || 0), 0)

  // ── PO Issued — purchase_orders, scoped via pr_id when a project/dept filter is active ──
  let poQ = supabase.from('purchase_orders').select('id,total_amount,status,vendor_id,pr_id').in('status', PO_ACTIVE)
  if (vendorId) poQ = poQ.eq('vendor_id', vendorId)
  if (scoped) poQ = prIds.length ? poQ.in('pr_id', prIds) : Promise.resolve({ data: [] })
  const { data: pos } = await poQ
  const poAmount = (pos || []).reduce((s, p) => s + Number(p.total_amount || 0), 0)
  const poIds = (pos || []).map(p => p.id)

  // ── GRN Received — grn, scoped via po_id from the (already vendor/project-scoped) PO set above ──
  let grnQ = supabase.from('grn').select('id,received_amount,status,po_id').in('status', GRN_RECEIVED)
  if (vendorId || scoped) grnQ = poIds.length ? grnQ.in('po_id', poIds) : Promise.resolve({ data: [] })
  const { data: grns } = await grnQ
  const grnAmount = (grns || []).reduce((s, g) => s + Number(g.received_amount || 0), 0)

  // ── Invoiced — invoices carry project_id + vendor_id directly ──
  let invQ = supabase.from('invoices').select('id,total_amount,status,vendor_id,project_id').in('status', INVOICE_NON_REJECTED)
  if (vendorId) invQ = invQ.eq('vendor_id', vendorId)
  if (projectIds) invQ = projectIds.length ? invQ.in('project_id', projectIds) : Promise.resolve({ data: [] })
  const { data: invoices } = await invQ
  const invoicedAmount = (invoices || []).reduce((s, i) => s + Number(i.total_amount || 0), 0)
  const invoiceIds = (invoices || []).map(i => i.id)

  // ── Paid — payments ledger, invoice_type='vendor', scoped to the invoice set above ──
  let paidAmount = 0, paidCount = 0
  if (invoiceIds.length) {
    const { data: payments } = await supabase.from('payments').select('amount').eq('invoice_type', 'vendor').in('invoice_id', invoiceIds)
    paidAmount = (payments || []).reduce((s, p) => s + Number(p.amount || 0), 0)
    paidCount = (payments || []).length
  }

  return [
    { stage: 'Budget Allocated', amount: round2(allocated), count: (budgets || []).length },
    { stage: 'Committed', amount: round2(committed), count: (budgets || []).filter(b => Number(b.committed_amount) > 0).length },
    { stage: 'PO Issued', amount: round2(poAmount), count: (pos || []).length },
    { stage: 'GRN Received', amount: round2(grnAmount), count: (grns || []).length },
    { stage: 'Invoiced', amount: round2(invoicedAmount), count: (invoices || []).length },
    { stage: 'Paid', amount: round2(paidAmount), count: paidCount },
  ]
}

function round2(n) { return Math.round(Number(n || 0) * 100) / 100 }

// The underlying records for one stage's drill-down click.
export async function getFundFlowRecordsForStage(stage, { departmentId, projectId, vendorId } = {}) {
  const { projectIds, prIds } = await resolveScopeIds({ departmentId, projectId })
  const scoped = projectIds != null

  if (stage === 'Budget Allocated' || stage === 'Committed') {
    const { data } = await scopedBudgetsQuery('id,category,allocated,committed_amount,project_id,department_id,fiscal_year', { departmentId, projectId, projectIds }).order('allocated', { ascending: false })
    return data || []
  }
  if (stage === 'PO Issued') {
    let q = supabase.from('purchase_orders').select('id,po_number,status,total_amount,vendor:vendors(name),pr_id').in('status', PO_ACTIVE).order('created_at', { ascending: false })
    if (vendorId) q = q.eq('vendor_id', vendorId)
    if (scoped) q = prIds.length ? q.in('pr_id', prIds) : Promise.resolve({ data: [] })
    const { data } = await q
    return data || []
  }
  if (stage === 'GRN Received') {
    const { data: allGrns } = await supabase.from('grn')
      .select('id,grn_number,status,received_amount,po:purchase_orders(po_number,vendor_id,vendor:vendors(name),pr_id)')
      .in('status', GRN_RECEIVED).order('created_at', { ascending: false })
    let rows = allGrns || []
    if (vendorId) rows = rows.filter(g => g.po?.vendor_id === vendorId)
    if (scoped) rows = rows.filter(g => prIds.includes(g.po?.pr_id))
    return rows
  }
  if (stage === 'Invoiced' || stage === 'Paid') {
    let q = supabase.from('invoices').select('id,invoice_date,total_amount,status,vendor:vendors(name),project:projects(name)').in('status', INVOICE_NON_REJECTED).order('invoice_date', { ascending: false })
    if (vendorId) q = q.eq('vendor_id', vendorId)
    if (projectIds) q = projectIds.length ? q.in('project_id', projectIds) : Promise.resolve({ data: [] })
    const { data } = await q
    if (stage === 'Invoiced') return data || []
    return (data || []).filter(i => i.status === 'paid')
  }
  return []
}

// One vendor's own PR -> PO -> GRN -> Invoice -> Payment chain, for the
// Vendor tab's drill-down.
export async function getVendorFundFlow(vendorId) {
  const [{ data: pos }, { data: invoices }] = await Promise.all([
    supabase.from('purchase_orders').select('id,po_number,status,total_amount,created_at').eq('vendor_id', vendorId).order('created_at', { ascending: false }),
    supabase.from('invoices').select('id,invoice_date,total_amount,status,project:projects(name)').eq('vendor_id', vendorId).order('invoice_date', { ascending: false }),
  ])
  const poIds = (pos || []).map(p => p.id)
  const { data: grns } = poIds.length
    ? await supabase.from('grn').select('id,grn_number,status,received_amount,po_id').in('po_id', poIds)
    : { data: [] }
  const invoiceIds = (invoices || []).map(i => i.id)
  const { data: payments } = invoiceIds.length
    ? await supabase.from('payments').select('id,amount,payment_date,invoice_id').eq('invoice_type', 'vendor').in('invoice_id', invoiceIds)
    : { data: [] }

  return {
    purchaseOrders: pos || [], grn: grns || [], invoices: invoices || [], payments: payments || [],
    totals: {
      poTotal: round2((pos || []).reduce((s, p) => s + Number(p.total_amount || 0), 0)),
      grnTotal: round2((grns || []).reduce((s, g) => s + Number(g.received_amount || 0), 0)),
      invoicedTotal: round2((invoices || []).reduce((s, i) => s + Number(i.total_amount || 0), 0)),
      paidTotal: round2((payments || []).reduce((s, p) => s + Number(p.amount || 0), 0)),
    },
  }
}

// One product's own Requisitioned -> PO -> GRN -> Deployed -> Warranty
// chain, for the Spend Analyzer Product tab's drill-down.
//
// Unlike vendors, only purchase_requisition_items carries part_number —
// purchase_orders/grn/invoices/payments are all header-level only (no
// line-item table for any of them). So PO/GRN here are approximate (linked
// via the requisition that contained this product's line item — the PO/GRN
// *total* may include other items on the same requisition), and Invoiced/
// Paid can't be tied to a specific product at all with this schema, so the
// chain deliberately stops at GRN rather than fabricate a number for those.
export async function getProductFundFlow(partNumber) {
  const { data: items } = await supabase.from('purchase_requisition_items')
    .select('id,pr_id,description,quantity,unit_cost,line_total').eq('part_number', partNumber)
  const prIds = [...new Set((items || []).map(i => i.pr_id).filter(Boolean))]

  const { data: pos } = prIds.length
    ? await supabase.from('purchase_orders').select('id,po_number,status,total_amount,pr_id,created_at').in('pr_id', prIds)
    : { data: [] }
  const poIds = (pos || []).map(p => p.id)

  const { data: grns } = poIds.length
    ? await supabase.from('grn').select('id,grn_number,status,received_amount,po_id').in('po_id', poIds)
    : { data: [] }

  const { data: devices } = await supabase.from('device_instances')
    .select('id,serial_number,status,project_id,customer_id,warranty_end').eq('part_number', partNumber)

  const rollup = await getWarrantyAnalyticsRollup()
  const warranty = rollup.find(r => r.part_number === partNumber && r.issue_type === 'ALL') || null

  const requisitionedTotal = round2((items || []).reduce((s, i) => s + Number(i.line_total || 0), 0))
  const requisitionedQty = (items || []).reduce((s, i) => s + Number(i.quantity || 0), 0)

  return {
    requisitioned: { total: requisitionedTotal, qty: requisitionedQty, items: items || [] },
    purchaseOrders: pos || [], grn: grns || [], devices: devices || [],
    deployedCount: (devices || []).filter(d => ['deployed', 'faulty', 'replaced'].includes(d.status)).length,
    inStorageCount: (devices || []).filter(d => d.status === 'in_storage').length,
    warranty,
    totals: {
      requisitionedTotal, requisitionedQty,
      poTotal: round2((pos || []).reduce((s, p) => s + Number(p.total_amount || 0), 0)),
      grnTotal: round2((grns || []).reduce((s, g) => s + Number(g.received_amount || 0), 0)),
      warrantyCostTotal: warranty?.actual_cost_total || 0,
    },
  }
}
