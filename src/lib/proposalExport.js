import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { rupee, dateFmt } from './supabase'
import { getProposal, getCostSections, getValueSummary, listTimeline } from './proposals'
import { getActiveTemplate } from './documentTemplates'
import { getDocumentSettings } from './documentSettings'
import { writeWrapped, pdfCurrency, amountInWords } from './pdfKit'
import { ensureXLSX } from './xlsxLoader'

// Customer-facing and internal-review builders are genuinely separate
// functions, not one template with a visibility flag — the customer
// builder's row-mapping code never reads internalCost/marginPercent at
// all, so there's no toggle to misconfigure that could leak those numbers
// into a customer export.

// The order comes from whatever cost sections actually exist on this
// proposal — including custom domains added via STEP215 — never from the
// fixed PROPOSAL_CATEGORIES list, which would silently drop any custom
// section from every export. A template's preferred section_order (if set)
// just reorders the categories that are present; it can't add or remove any.
function orderedCategories(sectionOrder, sections) {
  const present = sections.map(s => s.category)
  if (!sectionOrder?.length) return present
  const rest = present.filter(c => !sectionOrder.includes(c))
  return [...sectionOrder.filter(c => present.includes(c)), ...rest]
}

// Every individual line in a section, each priced at that section's own
// margin — used only when the template asks for itemized customer detail.
// Still price-only: this never reads internalCost, same rule as the
// category-level builder. Shared between the PDF and Excel exports below,
// which need DIFFERENT currency formatting — Excel cells render the real
// ₹ symbol fine, but jsPDF's built-in fonts can't (see pdfCurrency's
// comment in pdfKit.js) — so the formatter is a parameter, not hardcoded.
function itemizedCustomerRows(section, marginPercent, fmt = rupee) {
  const markup = x => x * (1 + marginPercent / 100)
  const rows = []
  ;(section.resourcePlans || []).forEach(r => rows.push([r.designation, `${r.estimated_count} × ${r.estimated_duration_weeks}wk`, fmt(markup(r.computed_cost))]))
  ;(section.hardwareLines || []).forEach(h => rows.push([h.description, `qty ${h.estimated_quantity}`, fmt(markup(h.subtotal_internal_cost))]))
  ;(section.softwareLines || []).forEach(s => rows.push([s.item_name, s.cost_type, fmt(markup(s.computed_cost))]))
  ;(section.miscLines || []).forEach(m => rows.push([m.item_name, m.line_type, fmt(markup(m.cost))]))
  return rows
}

// PDF-only from here down — always pdfCurrency, never rupee().
//
// Both the customer and the internal PDF now render in the same boxed
// "Quotation" (GST tax-invoice) layout — enclosing page frame, seller
// letterhead band, Quotation #/Date + Place of Supply strip, Bill To /
// Ship To cells, a grid line-items table, a Sub Total → IGST → Total
// block with the amount in words. The internal build is the same layout
// with three extra columns (Internal Cost / Margin % / Profit) and is
// laid out landscape to fit them. Seller identity, GST rates, HSN, bank
// details and footer all come from document_settings (Settings → GST &
// Document Settings) — the same source customerInvoiceExport.js uses.

async function loadExportData(proposalId, mode) {
  const [proposal, sections, summary, timeline, template, settings] = await Promise.all([
    getProposal(proposalId), getCostSections(proposalId), getValueSummary(proposalId), listTimeline(proposalId),
    getActiveTemplate('proposal', mode === 'customer' ? 'customer' : 'internal'),
    getDocumentSettings(),
  ])
  if (!summary) throw new Error('No value summary computed yet — open the proposal and let it calculate before exporting.')
  return { proposal, sections, summary, timeline, template, settings }
}

// Every itemized line in a section, priced at that section's margin. Carries
// both the customer amount and the raw internal cost — the internal number
// is only ever pushed into a row when mode === 'internal' (see buildLineRows).
function sectionLineItems(section, marginPct) {
  const markup = x => (Number(x) || 0) * (1 + marginPct / 100)
  const out = []
  ;(section.resourcePlans || []).forEach(r => out.push({
    name: `${r.designation} — ${r.estimated_count} × ${r.estimated_duration_weeks} wk`,
    qty: Number(r.estimated_count) || 1, amount: markup(r.computed_cost), internalCost: Number(r.computed_cost) || 0,
  }))
  ;(section.hardwareLines || []).forEach(h => out.push({
    name: h.description || h.part_number || 'Hardware',
    qty: Number(h.estimated_quantity) || 1, amount: markup(h.subtotal_internal_cost), internalCost: Number(h.subtotal_internal_cost) || 0,
  }))
  ;(section.softwareLines || []).forEach(s => out.push({
    name: `${s.item_name}${s.cost_type ? ` (${s.cost_type})` : ''}`,
    qty: 1, amount: markup(s.computed_cost), internalCost: Number(s.computed_cost) || 0,
  }))
  ;(section.miscLines || []).forEach(m => out.push({
    name: `${m.item_name}${m.line_type ? ` (${m.line_type})` : ''}`,
    qty: 1, amount: markup(m.cost), internalCost: Number(m.cost) || 0,
  }))
  return out.map(l => ({ ...l, marginPct, unitRate: l.qty ? l.amount / l.qty : l.amount }))
}

function buildLineRows({ summary, sections, template, mode, hsn, gstRate, currency }) {
  const order = orderedCategories(template?.config?.section_order, sections)
  const internal = mode === 'internal'
  const nCols = internal ? (gstRate ? 11 : 9) : (gstRate ? 8 : 6)
  const body = []
  const totals = { sub: 0, igst: 0, internal: 0 }
  let idx = 0

  order.forEach(cat => {
    const c = summary.cost_by_category.find(x => x.category === cat)
    const section = sections.find(s => s.category === cat)
    if (!c || !section) return
    const lines = sectionLineItems(section, c.marginPercent)
    if (!lines.length) return
    body.push([{ content: cat, colSpan: nCols, styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } }])
    lines.forEach(l => {
      idx += 1
      const igstAmt = gstRate ? l.amount * gstRate / 100 : 0
      totals.sub += l.amount; totals.igst += igstAmt; totals.internal += l.internalCost
      const row = [
        String(idx), l.name, hsn,
        l.qty.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        pdfCurrency(l.unitRate, currency),
      ]
      if (internal) row.push(pdfCurrency(l.internalCost, currency), `${l.marginPct}%`)
      if (gstRate) row.push(`${gstRate}%`, pdfCurrency(igstAmt, currency))
      row.push(pdfCurrency(l.amount, currency))
      if (internal) row.push(pdfCurrency(l.amount - l.internalCost, currency))
      body.push(row)
    })
  })

  const head = [['#', 'Item & Description', 'HSN/SAC', 'Qty', 'Rate']]
  if (internal) head[0].push('Internal Cost', 'Margin %')
  if (gstRate) head[0].push('IGST %', 'IGST Amt')
  head[0].push(internal ? 'Customer Price' : `Amount (${currency})`)
  if (internal) head[0].push('Profit')

  return { head, body, totals, grand: totals.sub + totals.igst }
}

// The bordered letterhead + Quotation#/Date + Bill To/Ship To bands.
// Returns the y coordinate the line-items table should start at.
function drawQuotationHead(doc, { settings, template, proposal, x0, W }) {
  const right = x0 + W
  const top = 8
  const logo = template?.header_logo || settings.header_logo || ''

  if (logo.startsWith('data:image')) {
    try { doc.addImage(logo, 'PNG', x0 + 3, top + 3, 34, 17) } catch { /* bad data uri — skip */ }
  }

  const sx = x0 + 44
  doc.setFont(undefined, 'bold'); doc.setFontSize(10.5); doc.setTextColor(20)
  doc.text(settings.business_name || 'Company', sx, top + 7)
  doc.setFont(undefined, 'normal'); doc.setFontSize(8); doc.setTextColor(90)
  let ay = top + 12
  if (settings.address) ay = writeWrapped(doc, settings.address, sx, ay, 92, 4)
  if (settings.gstin) { doc.text(`GSTIN ${settings.gstin}`, sx, ay); ay += 4 }
  doc.setTextColor(0)

  doc.setFontSize(23); doc.setTextColor(130)
  doc.text('Quotation', right - 3, top + 16, { align: 'right' })
  doc.setTextColor(0)

  const bandBot = Math.max(ay + 3, top + 26)
  doc.setDrawColor(150)
  doc.rect(x0, top, W, bandBot - top)
  doc.line(x0 + 40, top, x0 + 40, bandBot)

  // Quotation #/Date + Place of Supply strip
  const iy = bandBot
  const stripH = 15
  const splitX = x0 + Math.min(112, W * 0.58)
  doc.rect(x0, iy, splitX - x0, stripH)
  doc.rect(splitX, iy, right - splitX, stripH)
  doc.setFontSize(8); doc.setTextColor(110)
  doc.text('Quotation #', x0 + 2, iy + 5)
  doc.text('Quotation Date', x0 + 2, iy + 11)
  doc.text('Place Of Supply', splitX + 2, iy + 5)
  doc.setTextColor(0); doc.setFont(undefined, 'bold')
  doc.text(`: ${proposal.proposal_number || '—'}`, x0 + 34, iy + 5)
  doc.text(`: ${dateFmt(proposal.created_at) || dateFmt(new Date())}`, x0 + 34, iy + 11)
  const pos = [settings.state, settings.state_code ? `(${settings.state_code})` : ''].filter(Boolean).join(' ')
  doc.text(`: ${pos || '—'}`, splitX + 34, iy + 5)
  doc.setFont(undefined, 'normal')

  // Bill To / Ship To
  const by = iy + stripH
  const name = proposal.customer_name || 'Customer'
  const contact = proposal.customer_contact || ''
  doc.setFontSize(8)
  const contactLines = contact ? doc.splitTextToSize(contact, splitX - x0 - 6) : []
  const billH = 6 + 6 + contactLines.length * 4 + 4
  doc.rect(x0, by, splitX - x0, billH)
  doc.rect(splitX, by, right - splitX, billH)
  doc.setFillColor(241, 245, 249)
  doc.rect(x0, by, splitX - x0, 6, 'F')
  doc.rect(splitX, by, right - splitX, 6, 'F')
  doc.setTextColor(90); doc.setFont(undefined, 'bold')
  doc.text('Bill To', x0 + 2, by + 4.2)
  doc.text('Ship To', splitX + 2, by + 4.2)
  doc.setTextColor(0); doc.setFontSize(9)
  doc.text(name, x0 + 2, by + 11)
  doc.text(name, splitX + 2, by + 11)
  doc.setFont(undefined, 'normal'); doc.setFontSize(8); doc.setTextColor(90)
  if (contactLines.length) {
    doc.text(contactLines, x0 + 2, by + 15)
    doc.text(contactLines, splitX + 2, by + 15)
  }
  doc.setTextColor(0)

  return by + billH + 4
}

export async function exportProposalPDF(proposalId, mode = 'customer') {
  const { proposal, sections, summary, timeline, template, settings } = await loadExportData(proposalId, mode)
  const internal = mode === 'internal'
  const currency = proposal.currency || 'INR'
  const gstRate = settings.include_gst_in_invoices !== false && Number(settings.igst_rate) > 0 ? Number(settings.igst_rate) : 0
  const hsn = settings.default_hsn || '998313'

  const doc = new jsPDF({ orientation: internal ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const x0 = 8
  const W = pageW - 16
  const right = x0 + W
  const drawFrame = () => { doc.setDrawColor(150); doc.rect(x0, 8, W, pageH - 16) }

  const headBottom = drawQuotationHead(doc, { settings, template, proposal, x0, W })
  if (internal) {
    doc.setFontSize(8); doc.setTextColor(190, 40, 40)
    doc.text('INTERNAL REVIEW — not for customer distribution', x0 + 2, headBottom + 1)
    doc.setTextColor(0)
  }

  const { head, body, totals, grand } = buildLineRows({ summary, sections, template, mode, hsn, gstRate, currency })

  const columnStyles = {
    0: { cellWidth: internal ? 8 : 9, halign: 'center' },
    1: { cellWidth: internal ? 58 : 64 },
    2: { cellWidth: internal ? 16 : 20, halign: 'center' },
  }
  head[0].forEach((_, i) => { if (i >= 3) columnStyles[i] = { ...(columnStyles[i] || {}), halign: 'right' } })

  autoTable(doc, {
    startY: headBottom + (internal ? 4 : 0),
    head, body,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 }, lineColor: [210, 210, 210], overflow: 'linebreak' },
    headStyles: { fillColor: [237, 240, 245], textColor: 40, fontStyle: 'bold', lineColor: [210, 210, 210] },
    columnStyles,
    margin: { top: 14, left: x0, right: x0, bottom: 18 },
    tableWidth: W,
    didDrawPage: drawFrame,
  })

  const tableEndY = doc.lastAutoTable.finalY

  // Sub Total → IGST → Total block (right), amount in words (left)
  const boxW = internal ? 118 : 84
  const boxX = right - boxW
  let ty = tableEndY + 7
  const rows = [['Sub Total', pdfCurrency(totals.sub, currency)]]
  if (gstRate) rows.push([`IGST ${gstRate}%`, pdfCurrency(totals.igst, currency)])
  if (internal) {
    rows.push(['Total Internal Cost', pdfCurrency(totals.internal, currency)])
    rows.push(['Projected Profit', pdfCurrency(totals.sub - totals.internal, currency)])
    rows.push(['Projected Margin', `${summary.projected_margin_percent}%`])
  }
  doc.setFontSize(9)
  rows.forEach(([l, v]) => {
    doc.setTextColor(90); doc.text(l, boxX, ty)
    doc.setTextColor(0); doc.text(v, right, ty, { align: 'right' })
    ty += 6
  })
  doc.setFillColor(237, 240, 245)
  doc.rect(boxX - 2, ty - 4.5, boxW + 2, 8, 'F')
  doc.setFont(undefined, 'bold'); doc.setFontSize(10)
  doc.text('Total', boxX, ty + 1)
  doc.text(pdfCurrency(grand, currency), right, ty + 1, { align: 'right' })
  doc.setFont(undefined, 'normal')

  doc.setFontSize(8); doc.setTextColor(110)
  doc.text('Total In Words', x0 + 2, tableEndY + 12)
  doc.setTextColor(20); doc.setFont(undefined, 'bolditalic')
  writeWrapped(doc, amountInWords(grand, currency), x0 + 2, tableEndY + 17, boxX - x0 - 8, 4.5)
  doc.setFont(undefined, 'normal'); doc.setTextColor(0)

  let y = Math.max(ty + 8, tableEndY + 30)

  if (timeline.length) {
    if (y > pageH - 45) { doc.addPage(); drawFrame(); y = 20 }
    doc.setFontSize(10); doc.setFont(undefined, 'bold')
    doc.text('Delivery Timeline', x0 + 2, y); doc.setFont(undefined, 'normal')
    autoTable(doc, {
      startY: y + 2,
      head: [['Phase', 'Starts (week)', 'Duration (weeks)']],
      body: timeline.map(t => [t.phase_name, t.start_offset_weeks, t.duration_weeks]),
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2, lineColor: [210, 210, 210] },
      headStyles: { fillColor: [237, 240, 245], textColor: 40 },
      margin: { left: x0, right: x0, bottom: 18 },
      tableWidth: internal ? 170 : W,
      didDrawPage: drawFrame,
    })
    y = doc.lastAutoTable.finalY + 8
  }

  if (y > pageH - 45) { doc.addPage(); drawFrame(); y = 20 }
  const notes = []
  if (mode === 'customer' && proposal.validity_until_date) notes.push(`This quotation is valid until ${dateFmt(proposal.validity_until_date)}.`)
  if (proposal.creator?.full_name) notes.push(`For any questions concerning this quotation, contact ${proposal.creator.full_name}.`)
  if (settings.bank_details) notes.push(settings.bank_details)
  const tc = template?.terms_and_conditions_text || settings.terms_and_conditions_text
  if (mode === 'customer' && tc) notes.push(tc)
  if (notes.length) {
    doc.setFontSize(8); doc.setTextColor(110); doc.text('Notes', x0 + 2, y); y += 4
    doc.setTextColor(80)
    notes.forEach(t => { y = writeWrapped(doc, t, x0 + 2, y, W - 6, 4) + 2 })
    doc.setTextColor(0)
  }

  doc.setFontSize(7.5); doc.setTextColor(150)
  doc.text(template?.footer_text || settings.footer_text || 'This is a system-generated quotation.', x0 + 2, pageH - 11)

  doc.save(`${proposal.proposal_number}-${mode}.pdf`)
}

export async function exportProposalExcel(proposalId, mode = 'customer') {
  await ensureXLSX()
  const { proposal, sections, summary, timeline, template } = await loadExportData(proposalId, mode)
  const XLSX = window.XLSX
  const order = orderedCategories(template?.config?.section_order, sections)

  let rows
  if (mode === 'customer' && template?.config?.show_line_item_detail) {
    rows = []
    order.forEach(cat => {
      const c = summary.cost_by_category.find(x => x.category === cat)
      const section = sections.find(s => s.category === cat)
      if (!c || !section) return
      itemizedCustomerRows(section, c.marginPercent).forEach(([name, meta, price]) => rows.push({ Category: cat, Item: name, Detail: meta, [`Price (${proposal.currency})`]: price }))
    })
  } else if (mode === 'customer') {
    rows = order.map(cat => summary.cost_by_category.find(c => c.category === cat)).filter(Boolean)
      .map(c => ({ Category: c.category, [`Price (${proposal.currency})`]: c.customerPrice }))
  } else {
    rows = order.map(cat => summary.cost_by_category.find(c => c.category === cat)).filter(Boolean)
      .map(c => ({ Category: c.category, 'Internal Cost': c.internalCost, 'Margin %': c.marginPercent, 'Customer Price': c.customerPrice, Profit: c.customerPrice - c.internalCost }))
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Cost Summary')

  if (timeline.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      timeline.map(t => ({ Phase: t.phase_name, 'Starts (week)': t.start_offset_weeks, 'Duration (weeks)': t.duration_weeks }))
    ), 'Timeline')
  }

  XLSX.writeFile(wb, `${proposal.proposal_number}-${mode}.xlsx`)
}
