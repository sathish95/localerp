import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase, dateFmt } from './supabase'
import { getDeliveryNoteItems } from './deliveryNotes'
import { getDocumentSettings } from './documentSettings'
import { getActiveTemplate } from './documentTemplates'
import { drawLetterhead, drawDivider, drawStatusPill, statusColor, STRIPED_TABLE_THEME, drawSignatureLines, writeWrapped } from './pdfKit'

// Modern-Minimal delivery note PDF — see src/lib/pdfKit.js for the shared
// design system. project_id/customer_id/customer_invoice_id on
// delivery_notes are soft refs (STEP111's header comment) so — same
// reasoning as the PGRST200 fix in listDeliveryNotes() — this resolves
// them with separate lookups instead of a PostgREST embed.
async function loadNote(deliveryNoteId) {
  const { data: note, error } = await supabase.from('delivery_notes').select('*').eq('id', deliveryNoteId).single()
  if (error) throw error
  const [{ data: project }, { data: customer }, { data: invoice }] = await Promise.all([
    note.project_id ? supabase.from('projects').select('name').eq('id', note.project_id).single() : Promise.resolve({ data: null }),
    note.customer_id ? supabase.from('customers').select('name,address,city,gst_number,contact_name,phone').eq('id', note.customer_id).single() : Promise.resolve({ data: null }),
    note.customer_invoice_id ? supabase.from('customer_invoices').select('invoice_number').eq('id', note.customer_invoice_id).single() : Promise.resolve({ data: null }),
  ])
  return { ...note, project, customer, invoice }
}

export async function exportDeliveryNotePDF(deliveryNoteId, orgName) {
  const [note, items, settings, template] = await Promise.all([
    loadNote(deliveryNoteId), getDeliveryNoteItems(deliveryNoteId), getDocumentSettings(), getActiveTemplate('delivery_note'),
  ])
  const doc = new jsPDF()

  const logo = template?.header_logo || settings.header_logo
  const businessName = settings.business_name || orgName
  const logoBottomY = drawLetterhead(doc, { logo, businessName, docTitle: 'DELIVERY NOTE' })

  drawStatusPill(doc, { x: 196, y: 22, label: note.status, color: statusColor('delivery_note', note.status), align: 'right' })
  doc.setFontSize(10); doc.setTextColor(100)
  doc.text(`# ${note.delivery_note_number}`, 196, 32, { align: 'right' })
  doc.text(`Delivery Date: ${dateFmt(note.delivery_date) || '—'}`, 196, 38, { align: 'right' })
  doc.setTextColor(0)

  let fy = logoBottomY + (logoBottomY === 18 ? 6 : 4)
  doc.setFontSize(9); doc.setTextColor(100)
  if (settings.address) fy = writeWrapped(doc, settings.address, 14, fy, 100, 4.5)
  if (settings.gstin) { doc.text(`GSTIN: ${settings.gstin}`, 14, fy); fy += 4.5 }
  doc.setTextColor(0)

  const dividerY = Math.max(fy + 4, 44)
  drawDivider(doc, dividerY)

  // Ship To — left column
  let y = dividerY + 10
  doc.setFontSize(9); doc.setTextColor(150)
  doc.text('SHIP TO', 14, y)
  doc.setTextColor(0)
  y += 6
  doc.setFontSize(12); doc.setFont(undefined, 'bold')
  doc.text(note.customer?.name || 'Customer', 14, y)
  doc.setFont(undefined, 'normal')
  y += 6
  doc.setFontSize(10); doc.setTextColor(90)
  const shipAddress = note.delivery_address || note.customer?.address
  if (shipAddress) y = writeWrapped(doc, shipAddress, 14, y, 100, 5)
  const contactLine = [note.customer?.contact_name, note.customer?.phone].filter(Boolean).join('  ·  ')
  if (contactLine) { doc.text(contactLine, 14, y); y += 5 }
  doc.setTextColor(0)

  // Shipment details — right column, independent cursor
  let ry = dividerY + 10
  doc.setFontSize(9); doc.setTextColor(150)
  doc.text('SHIPMENT DETAILS', 130, ry)
  doc.setTextColor(0)
  ry += 6
  doc.setFontSize(10)
  if (note.project?.name) { doc.text(`Project: ${note.project.name}`, 130, ry); ry += 6 }
  if (note.carrier) { doc.text(`Carrier: ${note.carrier}`, 130, ry); ry += 6 }
  if (note.tracking_number) { doc.text(`Tracking #: ${note.tracking_number}`, 130, ry); ry += 6 }
  if (note.invoice?.invoice_number) { doc.text(`Invoice: ${note.invoice.invoice_number}`, 130, ry); ry += 6 }

  y = Math.max(y, ry) + 8

  autoTable(doc, {
    startY: y,
    head: [['#', 'Part #', 'Description', 'Qty', 'Unit']],
    body: items.map((it, i) => [i + 1, it.part_number || '—', it.description, it.quantity, it.unit]),
    ...STRIPED_TABLE_THEME,
  })

  y = doc.lastAutoTable.finalY + 14
  const footerText = template?.footer_text || settings.footer_text
  if (note.notes) {
    doc.setFontSize(9); doc.setTextColor(100)
    doc.text('Notes', 14, y); y += 5
    y = writeWrapped(doc, note.notes, 14, y, 180, 4.5) + 6
  }

  drawSignatureLines(doc, Math.max(y + 20, 250), 'Dispatched By', 'Received By')

  doc.setFontSize(8); doc.setTextColor(150)
  doc.text(footerText || 'This is a system-generated delivery note.', 14, 285)

  doc.save(`${note.delivery_note_number}.pdf`)
}
