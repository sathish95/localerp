import { supabase, nextNum } from './supabase'

// Delivery Notes — outbound dispatch tracking (STEP111), the customer-
// facing counterpart to GRN's inbound receipt. A note has a header
// (delivery_notes) and line items (delivery_note_items); items are
// replaced wholesale on every save (delete-then-insert under one
// function) rather than versioned like BOM — a delivery note describes
// a single physical shipment event, not something with meaningful
// history across edits the way a product's BOM does.

// project_id/customer_id/customer_invoice_id are soft refs (no FK — see
// STEP111's header comment), so PostgREST's embedded-resource syntax
// (`project:projects(...)`) can't infer the join — it 404s with PGRST200
// ("no relationship found"). Resolve them client-side instead.
export async function listDeliveryNotes() {
  const { data, error } = await supabase.from('delivery_notes')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  const notes = data || []

  const projectIds = [...new Set(notes.map(n => n.project_id).filter(Boolean))]
  const customerIds = [...new Set(notes.map(n => n.customer_id).filter(Boolean))]
  const invoiceIds = [...new Set(notes.map(n => n.customer_invoice_id).filter(Boolean))]

  const [{ data: projects }, { data: customers }, { data: invoices }] = await Promise.all([
    projectIds.length ? supabase.from('projects').select('id,name').in('id', projectIds) : Promise.resolve({ data: [] }),
    customerIds.length ? supabase.from('customers').select('id,name').in('id', customerIds) : Promise.resolve({ data: [] }),
    invoiceIds.length ? supabase.from('customer_invoices').select('id,invoice_number').in('id', invoiceIds) : Promise.resolve({ data: [] }),
  ])
  const projectById = Object.fromEntries((projects || []).map(p => [p.id, p]))
  const customerById = Object.fromEntries((customers || []).map(c => [c.id, c]))
  const invoiceById = Object.fromEntries((invoices || []).map(i => [i.id, i]))

  return notes.map(n => ({
    ...n,
    project: n.project_id ? projectById[n.project_id] : null,
    customer: n.customer_id ? customerById[n.customer_id] : null,
    invoice: n.customer_invoice_id ? invoiceById[n.customer_invoice_id] : null,
  }))
}

export async function getDeliveryNoteItems(deliveryNoteId) {
  const { data, error } = await supabase.from('delivery_note_items')
    .select('*').eq('delivery_note_id', deliveryNoteId).order('sort_order')
  if (error) throw error
  return data || []
}

// items: [{part_number, description, quantity, unit, notes}]
export async function createDeliveryNote(header, items, userId) {
  const delivery_note_number = header.delivery_note_number?.trim() || await nextNum('delivery_note')
  const { data: note, error } = await supabase.from('delivery_notes')
    .insert({ ...header, delivery_note_number, created_by: userId })
    .select().single()
  if (error) throw error
  if (items?.length) {
    const { error: itemErr } = await supabase.from('delivery_note_items').insert(
      items.map((it, i) => ({
        delivery_note_id: note.id, part_number: it.part_number || null, description: it.description,
        quantity: Number(it.quantity) || 1, unit: it.unit || 'pcs', notes: it.notes || null, sort_order: i,
      }))
    )
    if (itemErr) throw itemErr
  }
  return note
}

export async function updateDeliveryNote(id, header, items) {
  const { error } = await supabase.from('delivery_notes').update(header).eq('id', id)
  if (error) throw error
  const { error: delErr } = await supabase.from('delivery_note_items').delete().eq('delivery_note_id', id)
  if (delErr) throw delErr
  if (items?.length) {
    const { error: insErr } = await supabase.from('delivery_note_items').insert(
      items.map((it, i) => ({
        delivery_note_id: id, part_number: it.part_number || null, description: it.description,
        quantity: Number(it.quantity) || 1, unit: it.unit || 'pcs', notes: it.notes || null, sort_order: i,
      }))
    )
    if (insErr) throw insErr
  }
}

export async function setDeliveryNoteStatus(id, status) {
  const { error } = await supabase.from('delivery_notes').update({ status }).eq('id', id)
  if (error) throw error
}

export async function deleteDeliveryNote(id) {
  const { error } = await supabase.from('delivery_notes').delete().eq('id', id)
  if (error) throw error
}
