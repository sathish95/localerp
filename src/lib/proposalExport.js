import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { rupee } from './supabase'
import { getProposal, getCostSections, getValueSummary, listTimeline, PROPOSAL_CATEGORIES } from './proposals'
import { getDefaultTemplate } from './proposalTemplates'

// Customer-facing and internal-review builders are genuinely separate
// functions, not one template with a visibility flag — the customer
// builder's row-mapping code never reads internalCost/marginPercent at
// all, so there's no toggle to misconfigure that could leak those numbers
// into a customer export.

function orderedCategories(sectionOrder) {
  if (!sectionOrder?.length) return PROPOSAL_CATEGORIES
  const rest = PROPOSAL_CATEGORIES.filter(c => !sectionOrder.includes(c))
  return [...sectionOrder.filter(c => PROPOSAL_CATEGORIES.includes(c)), ...rest]
}

// Every individual line in a section, each priced at that section's own
// margin — used only when the template asks for itemized customer detail.
// Still price-only: this never reads internalCost, same rule as the
// category-level builder.
function itemizedCustomerRows(section, marginPercent) {
  const markup = x => x * (1 + marginPercent / 100)
  const rows = []
  ;(section.resourcePlans || []).forEach(r => rows.push([r.designation, `${r.estimated_count} × ${r.estimated_duration_weeks}wk`, rupee(markup(r.computed_cost))]))
  ;(section.hardwareLines || []).forEach(h => rows.push([h.description, `qty ${h.estimated_quantity}`, rupee(markup(h.subtotal_internal_cost))]))
  ;(section.softwareLines || []).forEach(s => rows.push([s.item_name, s.cost_type, rupee(markup(s.computed_cost))]))
  ;(section.miscLines || []).forEach(m => rows.push([m.item_name, m.line_type, rupee(markup(m.cost))]))
  return rows
}

function buildCustomerRows(summary, sections, template) {
  const order = orderedCategories(template?.section_order)
  if (!template?.show_line_item_detail) {
    return order
      .map(cat => summary.cost_by_category.find(c => c.category === cat))
      .filter(Boolean)
      .map(c => [c.category, rupee(c.customerPrice)])
  }
  const rows = []
  order.forEach(cat => {
    const c = summary.cost_by_category.find(x => x.category === cat)
    const section = sections.find(s => s.category === cat)
    if (!c || !section) return
    rows.push([{ content: cat, colSpan: 2, styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } }])
    itemizedCustomerRows(section, c.marginPercent).forEach(([name, meta, price]) => rows.push(['   ' + name + (meta ? ` (${meta})` : ''), price]))
  })
  return rows
}

function buildInternalRows(summary, template) {
  const order = orderedCategories(template?.section_order)
  return order
    .map(cat => summary.cost_by_category.find(c => c.category === cat))
    .filter(Boolean)
    .map(c => [c.category, rupee(c.internalCost), `${c.marginPercent}%`, rupee(c.customerPrice), rupee(c.customerPrice - c.internalCost)])
}

async function loadExportData(proposalId, mode) {
  const [proposal, sections, summary, timeline, template] = await Promise.all([
    getProposal(proposalId), getCostSections(proposalId), getValueSummary(proposalId), listTimeline(proposalId),
    getDefaultTemplate(mode === 'customer' ? 'Customer-Facing' : 'Internal Review'),
  ])
  if (!summary) throw new Error('No value summary computed yet — open the proposal and let it calculate before exporting.')
  return { proposal, sections, summary, timeline, template }
}

export async function exportProposalPDF(proposalId, mode = 'customer') {
  const { proposal, sections, summary, timeline, template } = await loadExportData(proposalId, mode)
  const doc = new jsPDF()
  let y = 18

  // Header — logo only if it's an embeddable data URI; a plain URL/path is
  // shown as a text line instead rather than silently failing to render.
  if (template?.header_logo?.startsWith('data:image')) {
    try { doc.addImage(template.header_logo, 'PNG', 14, 10, 28, 14); y = 30 } catch { /* malformed image data — fall through to text header */ }
  }
  doc.setFontSize(18)
  doc.text(proposal.proposal_name, 14, y)
  y += 7
  doc.setFontSize(10)
  doc.setTextColor(100)
  doc.text(`${proposal.proposal_number} · ${proposal.customer_name} · v${proposal.version}`, 14, y)
  y += 6
  if (template?.company_details) { doc.text(template.company_details, 14, y); y += 6 }
  if (mode === 'internal') { doc.text('INTERNAL REVIEW — not for customer distribution', 14, y); y += 6 }
  doc.setTextColor(0)
  y += 4

  if (mode === 'customer') {
    autoTable(doc, {
      startY: y,
      head: template?.show_line_item_detail ? [['Item', `Price (${proposal.currency})`]] : [['Category', `Price (${proposal.currency})`]],
      body: buildCustomerRows(summary, sections, template),
      foot: [['Total', rupee(summary.total_customer_price)]],
      theme: 'grid',
    })
  } else {
    autoTable(doc, {
      startY: y,
      head: [['Category', 'Internal Cost', 'Margin %', 'Customer Price', 'Profit']],
      body: buildInternalRows(summary, template),
      foot: [['Total', rupee(summary.total_internal_cost), `${summary.blended_markup_percent}%`, rupee(summary.total_customer_price), rupee(summary.projected_profit)]],
      theme: 'grid',
    })
  }

  y = doc.lastAutoTable.finalY + 10
  if (timeline.length) {
    doc.setFontSize(12)
    doc.text('Delivery Timeline', 14, y)
    autoTable(doc, {
      startY: y + 4,
      head: [['Phase', 'Starts (week)', 'Duration (weeks)']],
      body: timeline.map(t => [t.phase_name, t.start_offset_weeks, t.duration_weeks]),
      theme: 'grid',
    })
    y = doc.lastAutoTable.finalY + 10
  }

  if (mode === 'customer' && proposal.validity_until_date) {
    doc.setFontSize(9); doc.setTextColor(120)
    doc.text(`This proposal is valid until ${proposal.validity_until_date}.`, 14, y)
    y += 6
  }
  if (mode === 'customer' && template?.terms_and_conditions_text) {
    doc.setFontSize(9); doc.setTextColor(100)
    doc.text(doc.splitTextToSize(template.terms_and_conditions_text, 180), 14, y)
    y += 10
  }
  if (template?.footer_text) {
    doc.setFontSize(8); doc.setTextColor(150)
    doc.text(template.footer_text, 14, 285)
  }

  doc.save(`${proposal.proposal_number}-${mode}.pdf`)
}

// Excel export reuses the same window.XLSX (SheetJS) library ExcelImport.jsx
// already loads from CDN for imports — that build includes writeFile too,
// so no separate export-only dependency is needed.
async function ensureXLSX() {
  if (window.XLSX) return
  await new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
    s.onload = resolve; s.onerror = reject
    document.head.appendChild(s)
  })
}

export async function exportProposalExcel(proposalId, mode = 'customer') {
  await ensureXLSX()
  const { proposal, sections, summary, timeline, template } = await loadExportData(proposalId, mode)
  const XLSX = window.XLSX
  const order = orderedCategories(template?.section_order)

  let rows
  if (mode === 'customer' && template?.show_line_item_detail) {
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
