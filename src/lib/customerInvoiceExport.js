import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase, dateFmt } from './supabase'
import { getDocumentSettings } from './documentSettings'
import { getActiveTemplate } from './documentTemplates'
import { drawLetterhead, drawDivider, drawStatusPill, drawTotalCallout, statusColor, STRIPED_TABLE_THEME, writeWrapped, pdfCurrency } from './pdfKit'

// Modern-Minimal invoice PDF: clean whitespace instead of boxed sections,
// one accent color used only for the table header and the total callout,
// a small status pill instead of a status text line, striped rows
// instead of grid lines (see src/lib/pdfKit.js — the shared design
// system every document-type exporter now draws from).
async function loadInvoice(invoiceId) {
  const { data, error } = await supabase.from('customer_invoices')
    .select('*, customer:customers(name,address,city,gst_number,contact_name,phone,email), project:projects(name), milestone:project_milestones(title)')
    .eq('id', invoiceId).single()
  if (error) throw error
  return data
}

// orgName is a last-resort fallback (no active Invoice template AND no
// document_settings row yet) so the PDF never prints a blank header.
// overrides lets a reviewer tweak what actually prints (description/
// notes/amounts) from the export-preview modal without touching the
// underlying database row — the PDF reflects the edited values, the
// invoice record itself is untouched.
export async function exportCustomerInvoicePDF(invoiceId, orgName, overrides = {}) {
  const [loaded, settings, template] = await Promise.all([
    loadInvoice(invoiceId), getDocumentSettings(), getActiveTemplate('invoice'),
  ])
  const inv = { ...loaded, ...overrides }
  const doc = new jsPDF()

  const logo = template?.header_logo || settings.header_logo
  const businessName = settings.business_name || orgName
  const logoBottomY = drawLetterhead(doc, { logo, businessName, docTitle: 'INVOICE' })

  drawStatusPill(doc, { x: 196, y: 22, label: (inv.status || '').replace('_', ' '), color: statusColor('invoice', inv.status), align: 'right' })
  doc.setFontSize(10); doc.setTextColor(100)
  doc.text(`# ${inv.invoice_number}`, 196, 32, { align: 'right' })
  doc.text(`Invoice Date: ${dateFmt(inv.invoice_date) || '—'}`, 196, 38, { align: 'right' })
  doc.text(`Due: ${dateFmt(inv.due_date) || '—'}`, 196, 44, { align: 'right' })
  doc.setTextColor(0)

  // Seller details under the logo/name — GSTIN/address, org-wide (not
  // per-template) data from Settings -> GST & Document Settings.
  let fy = logoBottomY + (logoBottomY === 18 ? 6 : 4)
  doc.setFontSize(9); doc.setTextColor(100)
  if (settings.address) fy = writeWrapped(doc, settings.address, 14, fy, 100, 4.5)
  if (settings.gstin) { doc.text(`GSTIN: ${settings.gstin}`, 14, fy); fy += 4.5 }
  doc.setTextColor(0)

  const dividerY = Math.max(fy + 4, 48)
  drawDivider(doc, dividerY)

  // Bill To — left column
  let y = dividerY + 10
  doc.setFontSize(9); doc.setTextColor(150)
  doc.text('BILL TO', 14, y)
  doc.setTextColor(0)
  y += 6
  doc.setFontSize(12); doc.setFont(undefined, 'bold')
  doc.text(inv.customer?.name || 'Customer', 14, y)
  doc.setFont(undefined, 'normal')
  y += 6
  doc.setFontSize(10); doc.setTextColor(90)
  if (inv.customer?.address) y = writeWrapped(doc, inv.customer.address, 14, y, 90, 5)
  if (inv.customer?.city) { doc.text(inv.customer.city, 14, y); y += 5 }
  if (inv.customer?.gst_number) { doc.text(`GSTIN: ${inv.customer.gst_number}`, 14, y); y += 5 }
  const contactLine = [inv.customer?.contact_name, inv.customer?.phone].filter(Boolean).join('  ·  ')
  if (contactLine) { doc.text(contactLine, 14, y); y += 5 }
  doc.setTextColor(0)

  // Reference — right column, independent cursor
  let ry = dividerY + 10
  doc.setFontSize(9); doc.setTextColor(150)
  doc.text('REFERENCE', 130, ry)
  doc.setTextColor(0)
  ry += 6
  doc.setFontSize(10)
  if (inv.project?.name) { doc.text(`Project: ${inv.project.name}`, 130, ry); ry += 6 }
  if (inv.milestone?.title) { doc.text(`Milestone: ${inv.milestone.title}`, 130, ry); ry += 6 }
  if (inv.paid_at) { doc.text(`Paid: ${dateFmt(inv.paid_at)}`, 130, ry); ry += 6 }

  y = Math.max(y, ry) + 8

  const description = inv.description || (inv.milestone?.title
    ? `Milestone billing — ${inv.milestone.title}`
    : inv.project?.name ? `Project billing — ${inv.project.name}` : (inv.notes || 'Services rendered'))
  const subtotal = inv.subtotal ?? Math.max(0, (inv.total_amount || 0) - (inv.gst_amount || 0))
  const currency = inv.currency || 'INR'

  autoTable(doc, {
    startY: y,
    head: [['Description', `Amount (${currency})`]],
    body: [
      [description, pdfCurrency(subtotal, currency)],
      ...(inv.gst_amount ? [['GST', pdfCurrency(inv.gst_amount, currency)]] : []),
    ],
    columnStyles: { 1: { halign: 'right' } },
    ...STRIPED_TABLE_THEME,
  })

  y = doc.lastAutoTable.finalY + 10
  drawTotalCallout(doc, { x: 196 - 74, y, label: 'Total', value: pdfCurrency(inv.total_amount, currency) })
  y += 15 + 10

  const footerText = template?.footer_text || settings.footer_text
  const termsText = template?.terms_and_conditions_text || settings.terms_and_conditions_text

  if (inv.notes) {
    doc.setFontSize(9); doc.setTextColor(100)
    doc.text('Notes', 14, y); y += 5
    y = writeWrapped(doc, inv.notes, 14, y, 180, 4.5) + 4
  }
  if (settings.bank_details) {
    doc.setFontSize(9); doc.setTextColor(100)
    doc.text('Bank Details', 14, y); y += 5
    y = writeWrapped(doc, settings.bank_details, 14, y, 180, 4.5) + 4
  }
  if (termsText) {
    doc.setFontSize(8); doc.setTextColor(120)
    doc.text('Terms & Conditions', 14, y); y += 4
    y = writeWrapped(doc, termsText, 14, y, 180, 4)
  }

  doc.setFontSize(8); doc.setTextColor(150)
  doc.text(footerText || 'This is a system-generated invoice.', 14, 285)

  doc.save(`${inv.invoice_number}.pdf`)
}
