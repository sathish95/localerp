import { supabase } from './supabase'

export async function getPaymentsFor(invoiceType, invoiceId) {
  const { data } = await supabase.from('payments').select('*,recorder:profiles!recorded_by(full_name)')
    .eq('invoice_type', invoiceType).eq('invoice_id', invoiceId).order('payment_date', { ascending: false })
  return data || []
}

async function getTotalPaid(invoiceType, invoiceId) {
  const { data } = await supabase.from('payments').select('amount').eq('invoice_type', invoiceType).eq('invoice_id', invoiceId)
  return (data || []).reduce((s, p) => s + Number(p.amount || 0), 0)
}

// Inserts a payment row, then re-sums all payments for that invoice and stamps
// the parent invoice/customer_invoice status accordingly. Vendor `invoices` has
// no 'partially_paid' status in its enum (uploaded/processing/verified/matched/
// rejected/paid) — a partial vendor payment is recorded but only flips status to
// 'paid' once fully covered, leaving the workflow status untouched otherwise.
// customer_invoices does support 'partially_paid', so that one updates eagerly.
export async function recordPayment({ invoice_type, invoice_id, amount, payment_date, payment_method, reference_number, notes, recorded_by }) {
  const { error } = await supabase.from('payments').insert({
    invoice_type, invoice_id, amount: parseFloat(amount), payment_date: payment_date || new Date().toISOString().slice(0, 10),
    payment_method: payment_method || null, reference_number: reference_number || null, notes: notes || null, recorded_by,
  })
  if (error) throw error

  const totalPaid = await getTotalPaid(invoice_type, invoice_id)
  const table = invoice_type === 'customer' ? 'customer_invoices' : 'invoices'
  const { data: inv } = await supabase.from(table).select('total_amount,status').eq('id', invoice_id).single()
  if (!inv) return

  if (totalPaid >= Number(inv.total_amount || 0)) {
    await supabase.from(table).update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', invoice_id)
  } else if (invoice_type === 'customer' && totalPaid > 0) {
    await supabase.from('customer_invoices').update({ status: 'partially_paid' }).eq('id', invoice_id)
  }
}
