import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase, dateFmt } from './supabase'
import { getGRNItems } from './grn'
import { getDocumentSettings } from './documentSettings'
import { getActiveTemplate } from './documentTemplates'
import { drawLetterhead, drawDivider, drawStatusPill, statusColor, STRIPED_TABLE_THEME, drawSignatureLines, writeWrapped, pdfCurrency } from './pdfKit'

// First-ever PDF for a GRN (Goods Receipt Note). Vendor identity has no
// direct FK on `grn` — reached via grn.po_id -> purchase_orders.vendor_id
// -> vendors, same soft-ref client-side join pattern used everywhere else
// in this codebase (see deliveryNoteExport.js).
async function loadGRN(grnId) {
  const { data: grn, error } = await supabase.from('grn')
    .select('*, po:purchase_orders(po_number, total_amount, vendor_id)')
    .eq('id', grnId).single()
  if (error) throw error
  const { data: vendor } = grn.po?.vendor_id
    ? await supabase.from('vendors').select('name,address,city,gst_number,contact_name,phone').eq('id', grn.po.vendor_id).single()
    : { data: null }
  return { ...grn, vendor }
}

export async function exportGRNPDF(grnId, orgName) {
  const [grn, items, settings, template] = await Promise.all([
    loadGRN(grnId), getGRNItems(grnId), getDocumentSettings(), getActiveTemplate('grn'),
  ])
  const doc = new jsPDF()

  const logo = template?.header_logo || settings.header_logo
  const businessName = settings.business_name || orgName
  const logoBottomY = drawLetterhead(doc, { logo, businessName, docTitle: 'GOODS RECEIPT NOTE' })

  drawStatusPill(doc, { x: 196, y: 22, label: grn.status, color: statusColor('grn', grn.status), align: 'right' })
  doc.setFontSize(10); doc.setTextColor(100)
  doc.text(`# ${grn.grn_number || '—'}`, 196, 32, { align: 'right' })
  doc.text(`Received: ${dateFmt(grn.received_date) || '—'}`, 196, 38, { align: 'right' })
  doc.setTextColor(0)

  let fy = logoBottomY + (logoBottomY === 18 ? 6 : 4)
  doc.setFontSize(9); doc.setTextColor(100)
  if (settings.address) fy = writeWrapped(doc, settings.address, 14, fy, 100, 4.5)
  if (settings.gstin) { doc.text(`GSTIN: ${settings.gstin}`, 14, fy); fy += 4.5 }
  doc.setTextColor(0)

  const dividerY = Math.max(fy + 4, 44)
  drawDivider(doc, dividerY)

  // Received From — left column
  let y = dividerY + 10
  doc.setFontSize(9); doc.setTextColor(150)
  doc.text('RECEIVED FROM', 14, y)
  doc.setTextColor(0)
  y += 6
  doc.setFontSize(12); doc.setFont(undefined, 'bold')
  doc.text(grn.vendor?.name || 'Vendor', 14, y)
  doc.setFont(undefined, 'normal')
  y += 6
  doc.setFontSize(10); doc.setTextColor(90)
  if (grn.vendor?.address) y = writeWrapped(doc, grn.vendor.address, 14, y, 90, 5)
  if (grn.vendor?.city) { doc.text(grn.vendor.city, 14, y); y += 5 }
  if (grn.vendor?.gst_number) { doc.text(`GSTIN: ${grn.vendor.gst_number}`, 14, y); y += 5 }
  const contactLine = [grn.vendor?.contact_name, grn.vendor?.phone].filter(Boolean).join('  ·  ')
  if (contactLine) { doc.text(contactLine, 14, y); y += 5 }
  doc.setTextColor(0)

  // Reference — right column, independent cursor
  let ry = dividerY + 10
  doc.setFontSize(9); doc.setTextColor(150)
  doc.text('REFERENCE', 130, ry)
  doc.setTextColor(0)
  ry += 6
  doc.setFontSize(10)
  if (grn.po?.po_number) { doc.text(`PO: ${grn.po.po_number}`, 130, ry); ry += 6 }
  if (grn.po?.total_amount != null) { doc.text(`PO Total: ${pdfCurrency(grn.po.total_amount)}`, 130, ry); ry += 6 }
  if (grn.received_amount != null) { doc.text(`Received Amount: ${pdfCurrency(grn.received_amount)}`, 130, ry); ry += 6 }

  y = Math.max(y, ry) + 8

  // grn_items (structured, has part_number) is preferred; legacy free-text
  // `items` JSON is the fallback for pre-STEP55 rows, same as GRNPage.jsx.
  const legacyItems = (!items?.length && grn.items) ? (typeof grn.items === 'string' ? JSON.parse(grn.items) : grn.items) : null

  autoTable(doc, {
    startY: y,
    head: legacyItems ? [['Item', 'Qty Received']] : [['Part #', 'Description', 'Ordered', 'Received', 'Unit Cost', 'Line Total']],
    body: legacyItems
      ? legacyItems.map(it => [it.name || it.description || 'Item', it.qty_received || it.quantity || '—'])
      : items.map(it => [it.part_number || '—', it.description, it.quantity_ordered, it.quantity_received, pdfCurrency(it.unit_cost || 0), pdfCurrency((it.quantity_received || 0) * (it.unit_cost || 0))]),
    columnStyles: legacyItems ? {} : { 4: { halign: 'right' }, 5: { halign: 'right' } },
    ...STRIPED_TABLE_THEME,
  })

  y = doc.lastAutoTable.finalY + 14
  if (grn.remarks) {
    doc.setFontSize(9); doc.setTextColor(100)
    doc.text('Remarks', 14, y); y += 5
    y = writeWrapped(doc, grn.remarks, 14, y, 180, 4.5) + 6
  }

  drawSignatureLines(doc, Math.max(y + 20, 250), 'Received By', 'Verified By')

  doc.setFontSize(8); doc.setTextColor(150)
  doc.text(template?.footer_text || settings.footer_text || 'This is a system-generated goods receipt note.', 14, 285)

  doc.save(`${grn.grn_number || 'GRN'}.pdf`)
}
