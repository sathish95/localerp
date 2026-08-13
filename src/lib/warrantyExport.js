import jsPDF from 'jspdf'
import { supabase, dateFmt } from './supabase'
import { getDocumentSettings } from './documentSettings'
import { getActiveTemplate } from './documentTemplates'
import { drawLetterhead, drawDivider, drawStatusPill, statusColor, drawSignatureLines, writeWrapped } from './pdfKit'

// First-ever PDF for a Warranty claim. Deliberately no cost figures —
// estimated_cost/warranty_cost_entries are role-gated on WarrantyPage.jsx
// (canViewCostFigures) and this is an operational hand-to-customer/
// technician record, not a financial one. warranty_claims has no direct
// customer reference — resolved via device_instances.customer_id, same
// soft-ref client-side join pattern as deliveryNoteExport.js.
async function loadClaim(claimId) {
  const { data: claim, error } = await supabase.from('warranty_claims').select('*').eq('id', claimId).single()
  if (error) throw error

  const [{ data: device }, { data: warranty }, { data: raisedBy }] = await Promise.all([
    claim.device_id ? supabase.from('device_instances').select('device_code,part_number,serial_number,customer_id').eq('id', claim.device_id).single() : Promise.resolve({ data: null }),
    claim.device_warranty_id ? supabase.from('device_warranties').select('warranty_start_date,warranty_end_date').eq('id', claim.device_warranty_id).single() : Promise.resolve({ data: null }),
    claim.raised_by ? supabase.from('profiles').select('full_name').eq('id', claim.raised_by).single() : Promise.resolve({ data: null }),
  ])
  const [{ data: product }, { data: customer }] = await Promise.all([
    device?.part_number ? supabase.from('products').select('name,device_type').eq('part_number', device.part_number).single() : Promise.resolve({ data: null }),
    device?.customer_id ? supabase.from('customers').select('name,address,city,gst_number,contact_name,phone').eq('id', device.customer_id).single() : Promise.resolve({ data: null }),
  ])
  return { ...claim, device, warranty, raisedBy, product, customer }
}

export async function exportWarrantyClaimPDF(claimId, orgName) {
  const [claim, settings, template] = await Promise.all([
    loadClaim(claimId), getDocumentSettings(), getActiveTemplate('warranty'),
  ])
  const doc = new jsPDF()

  const logo = template?.header_logo || settings.header_logo
  const businessName = settings.business_name || orgName
  const logoBottomY = drawLetterhead(doc, { logo, businessName, docTitle: 'WARRANTY CLAIM' })

  drawStatusPill(doc, { x: 196, y: 22, label: claim.status, color: statusColor('warranty', claim.status), align: 'right' })
  doc.setFontSize(10); doc.setTextColor(100)
  doc.text(`# ${claim.claim_number}`, 196, 32, { align: 'right' })
  doc.text(`Claim Date: ${dateFmt(claim.claim_date) || '—'}`, 196, 38, { align: 'right' })
  doc.setTextColor(0)

  let fy = logoBottomY + (logoBottomY === 18 ? 6 : 4)
  doc.setFontSize(9); doc.setTextColor(100)
  if (settings.address) fy = writeWrapped(doc, settings.address, 14, fy, 100, 4.5)
  if (settings.gstin) { doc.text(`GSTIN: ${settings.gstin}`, 14, fy); fy += 4.5 }
  doc.setTextColor(0)

  const dividerY = Math.max(fy + 4, 44)
  drawDivider(doc, dividerY)

  // Device — left column
  let y = dividerY + 10
  doc.setFontSize(9); doc.setTextColor(150)
  doc.text('DEVICE', 14, y)
  doc.setTextColor(0)
  y += 6
  doc.setFontSize(12); doc.setFont(undefined, 'bold')
  doc.text(claim.product?.name || claim.device?.part_number || 'Device', 14, y)
  doc.setFont(undefined, 'normal')
  y += 6
  doc.setFontSize(10); doc.setTextColor(90)
  if (claim.device?.serial_number) { doc.text(`Serial: ${claim.device.serial_number}`, 14, y); y += 5 }
  if (claim.device?.device_code) { doc.text(`Device Code: ${claim.device.device_code}`, 14, y); y += 5 }
  if (claim.warranty?.warranty_end_date) { doc.text(`Warranty Until: ${dateFmt(claim.warranty.warranty_end_date)}`, 14, y); y += 5 }
  doc.setTextColor(0)

  // Customer / site — right column, independent cursor
  let ry = dividerY + 10
  doc.setFontSize(9); doc.setTextColor(150)
  doc.text('CUSTOMER / SITE', 130, ry)
  doc.setTextColor(0)
  ry += 6
  doc.setFontSize(10)
  if (claim.customer?.name) { doc.text(claim.customer.name, 130, ry); ry += 5 }
  doc.setFontSize(9); doc.setTextColor(90)
  if (claim.customer?.address) ry = writeWrapped(doc, claim.customer.address, 130, ry, 60, 4.5)
  if (claim.customer?.city) { doc.text(claim.customer.city, 130, ry); ry += 4.5 }
  const contactLine = [claim.customer?.contact_name, claim.customer?.phone].filter(Boolean).join('  ·  ')
  if (contactLine) { doc.text(contactLine, 130, ry); ry += 4.5 }
  doc.setTextColor(0)

  y = Math.max(y, ry) + 10

  // Issue & resolution
  doc.setFontSize(9); doc.setTextColor(150)
  doc.text('ISSUE', 14, y)
  doc.setTextColor(0)
  y += 6
  doc.setFontSize(10)
  if (claim.issue_type) { doc.text(`Type: ${claim.issue_type}`, 14, y); y += 6 }
  doc.setTextColor(90)
  y = writeWrapped(doc, claim.issue_description || '—', 14, y, 180, 5) + 4
  doc.setTextColor(0)
  if (claim.resolution_type) { doc.text(`Resolution: ${claim.resolution_type}`, 14, y); y += 6 }
  if (claim.status === 'Rejected' && claim.rejection_reason) {
    doc.setTextColor(90)
    y = writeWrapped(doc, `Reason: ${claim.rejection_reason}`, 14, y, 180, 5) + 1
    doc.setTextColor(0)
  }
  if (claim.raisedBy?.full_name) { doc.text(`Reported By: ${claim.raisedBy.full_name}`, 14, y); y += 6 }

  drawSignatureLines(doc, Math.max(y + 20, 250), 'Technician', 'Customer Acknowledgement')

  doc.setFontSize(8); doc.setTextColor(150)
  doc.text(template?.footer_text || settings.footer_text || 'This is a system-generated warranty claim record.', 14, 285)

  doc.save(`${claim.claim_number}.pdf`)
}
