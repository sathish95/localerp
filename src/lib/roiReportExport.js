/**
 * ROI PLANNING — customer-facing report export.
 *
 * Customer-facing ONLY, by construction — same rule proposalExport.js
 * follows for its customer build: this file never reads roi_cost_driver
 * or roi_capture_rate rows at all, only the already-computed snapshot
 * totals (total_annual_saving/total_investment/roi_pct/payback_months)
 * and the delay-impact projections derived from them. There is no
 * "internal" branch here to accidentally leak the underlying assumptions
 * (benchmarks, capture-rate %) into something handed to a client.
 */
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { getDocumentSettings } from './documentSettings'
import { drawLetterhead, drawDivider, drawTotalCallout, writeWrapped, pdfCurrency } from './pdfKit'
import { getProposalFull, getLatestSnapshots } from './roiProposals'
import { delayImpactPresets } from './roiForecast'

export async function exportROIReportPDF(proposalId, { delayMonthsList = [0, 1, 3, 6] } = {}) {
  const [{ proposal }, snapshots, settings] = await Promise.all([
    getProposalFull(proposalId), getLatestSnapshots(proposalId), getDocumentSettings(),
  ])
  const snapshot = snapshots[proposal.active_scenario]
  if (!snapshot) throw new Error('Calculate the active scenario before exporting a report.')
  const currency = proposal.currency || 'INR'

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const x0 = 14, right = pageW - 14

  const logo = settings.header_logo
  const businessName = settings.business_name
  const bottomY = drawLetterhead(doc, { logo, businessName, docTitle: 'ROI SUMMARY' })

  doc.setFontSize(12); doc.setFont(undefined, 'bold')
  doc.text(proposal.name, x0, bottomY + 8)
  doc.setFont(undefined, 'normal'); doc.setFontSize(9); doc.setTextColor(100)
  doc.text(`Planned implementation duration: ${proposal.duration_months} months  ·  Scenario: ${proposal.active_scenario.charAt(0).toUpperCase() + proposal.active_scenario.slice(1)}`, x0, bottomY + 14)
  doc.setTextColor(0)
  drawDivider(doc, bottomY + 18)

  let y = bottomY + 26
  const cardW = (right - x0 - 8) / 2
  drawTotalCallout(doc, { x: x0, y, label: 'Total Annual Saving (Steady State)', value: pdfCurrency(snapshot.total_annual_saving, currency), width: cardW, color: '#10b981' })
  drawTotalCallout(doc, { x: x0 + cardW + 8, y, label: 'Total Investment', value: pdfCurrency(snapshot.total_investment, currency), width: cardW, color: '#0ea5e9' })
  y += 20
  drawTotalCallout(doc, { x: x0, y, label: 'Steady-State ROI %', value: `${snapshot.roi_pct}%`, width: cardW, color: '#6366f1' })
  drawTotalCallout(doc, { x: x0 + cardW + 8, y, label: 'Payback (On Schedule)', value: `${snapshot.payback_months} months`, width: cardW, color: '#f59e0b' })
  y += 28

  doc.setFontSize(12); doc.setFont(undefined, 'bold')
  doc.text('If Implementation Is Delayed…', x0, y)
  doc.setFont(undefined, 'normal')
  y += 3

  const rows = delayImpactPresets(snapshot, delayMonthsList).map(r => [
    r.delay_months === 0 ? 'On Schedule' : `+${r.delay_months} month${r.delay_months > 1 ? 's' : ''}`,
    pdfCurrency(r.saving_captured_in_window, currency),
    r.delay_months === 0 ? '—' : pdfCurrency(r.savings_lost_to_delay, currency),
    `${r.year1_roi_pct}%`,
    `${r.delayed_payback_months} mo`,
  ])
  autoTable(doc, {
    startY: y + 3,
    head: [['Go-Live Timeline', 'Year-1 Saving Captured', 'Value Lost to Delay', 'Year-1 ROI %', 'Payback']],
    body: rows,
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    margin: { left: x0, right: x0 },
  })
  const ty = doc.lastAutoTable.finalY + 10

  doc.setFontSize(8); doc.setTextColor(120)
  writeWrapped(doc,
    'Figures are modeled estimates based on the fleet size, cost-driver assumptions and capture-rate targets defined for this proposal — not a guarantee of realized results. Year-1 figures assume a fixed 12-month value-realization window starting at go-live; the steady-state annual saving and ROI% are unaffected by delay and apply once the solution is live, whenever that is.',
    x0, ty, right - x0, 4)
  doc.setTextColor(0)

  doc.setFontSize(7.5); doc.setTextColor(150)
  doc.text(settings.footer_text || 'This is a system-generated ROI summary.', x0, pageH - 10)

  doc.save(`${proposal.name.replace(/[^a-z0-9]+/gi, '-')}-roi-summary.pdf`)
}
