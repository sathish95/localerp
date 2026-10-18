// Agreements & e-Sign (STEP273) — PDFs, built in the browser.
//   contentPdf()  the document itself, from the template text (jsPDF)
//   signedPdf()   original (generated or uploaded) + a footer on every page +
//                 a signature certificate (signatures, IPs, code check, audit
//                 trail, SHA-256 of what was sent) — pdf-lib
import { jsPDF } from 'jspdf'
import autoTableImport from 'jspdf-autotable'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { parseBody, DOC_TYPE_LABEL } from './esignTemplates.js'

// Node (tests) resolves the CJS build, where the function is on .default.
const autoTable = autoTableImport.default || autoTableImport

// Standard PDF fonts are WinAnsi only.
const safe = s => String(s ?? '')
  .replace(/₹ ?/g, 'INR ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/[•·]/g, '-').replace(/…/g, '...')
  .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?')

export const istTime = t => (t ? new Date(t).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) + ' IST' : '-')

export function base64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
export function bytesToBase64(bytes) {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  return btoa(s)
}
export function downloadBytes(bytes, name, type = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
export const fileBase = doc => `${doc.doc_number || 'document'}-${String(doc.title || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 50)}`

/* ── the document from template text ── */
export function contentPdf(doc, orgName) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 18, maxW = W - 2 * M
  let y = 16
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(100, 116, 139)
  pdf.text(safe(orgName || ''), M, y)
  pdf.text(safe([doc.doc_number, DOC_TYPE_LABEL[doc.doc_type]].filter(Boolean).join('  |  ')), W - M, y, { align: 'right' })
  pdf.setDrawColor(226, 232, 240); pdf.line(M, y + 3, W - M, y + 3)
  y += 12
  const need = h => { if (y + h > H - 18) { pdf.addPage(); y = 18 } }
  const write = (text, { size = 10, bold = false, gap = 2.2, indent = 0, color = [15, 23, 42] } = {}) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); pdf.setTextColor(...color)
    const lh = size * 0.46
    for (const line of pdf.splitTextToSize(safe(text), maxW - indent)) { need(lh); pdf.text(line, M + indent, y); y += lh }
    y += gap
  }
  for (const b of parseBody(doc.content)) {
    if (b.kind === 'h1') { need(14); write(b.text, { size: 16, bold: true, gap: 4 }) }
    else if (b.kind === 'h2') { need(12); y += 1.5; write(b.text, { size: 11.5, bold: true, gap: 1.5 }) }
    else if (b.kind === 'li') {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); need(5); pdf.text('-', M + 2, y)
      write(b.text, { indent: 6, gap: 1.2 })
    } else if (b.kind === 'table') {
      need(16)
      autoTable(pdf, {
        startY: y, head: [b.head.map(safe)], body: b.rows.map(r => r.map(safe)), margin: { left: M, right: M },
        styles: { fontSize: 8.5, cellPadding: 1.8 }, headStyles: { fillColor: [99, 102, 241], textColor: 255 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      })
      y = pdf.lastAutoTable.finalY + 4
    } else write(b.text)
  }
  const n = pdf.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    pdf.setPage(i); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(148, 163, 184)
    pdf.text(safe(`${doc.doc_number || ''}  ${doc.title || ''}`).slice(0, 110), M, H - 8)
    pdf.text(`Page ${i} of ${n}`, W - M, H - 8, { align: 'right' })
  }
  return new Uint8Array(pdf.output('arraybuffer'))
}

const EVENT_LABEL = {
  SENT: 'Sent for signature', NOTIFIED: 'Signing request emailed', VIEWED: 'Opened the document', CODE_SENT: 'Email code sent',
  CODE_FAILED: 'Wrong email code entered', SIGNED: 'Signed', DECLINED: 'Declined', REMINDED: 'Reminder sent', CANCELLED: 'Cancelled',
  COMPLETED: 'Completed — signed by all parties', EXPIRED: 'Expired', CREATED: 'Created',
}
export const eventLabel = e => EVENT_LABEL[e] || e

/* ── original + certificate ── */
export async function signedPdf({ doc, signers, events = [], orgName, originalBytes }) {
  const base = originalBytes || contentPdf(doc, orgName)
  const out = await PDFDocument.load(base, { ignoreEncryption: true })
  const font = await out.embedFont(StandardFonts.Helvetica)
  const bold = await out.embedFont(StandardFonts.HelveticaBold)
  const done = doc.status === 'COMPLETED'
  const ink = rgb(0.06, 0.09, 0.16), muted = rgb(0.39, 0.45, 0.55), line = rgb(0.89, 0.91, 0.94), accent = rgb(0.39, 0.4, 0.95)

  // footer on each original page
  const stamp = safe(`${doc.doc_number || ''} - ${done ? 'Electronically signed by all parties' : `Status: ${doc.status}`} - signature certificate attached`)
  for (const p of out.getPages()) {
    const { width } = p.getSize()
    p.drawText(stamp, { x: 30, y: 14, size: 6.5, font, color: muted, maxWidth: width - 60 })
  }

  let page, y
  const W = 595.28, H = 841.89, M = 48
  const newPage = () => { page = out.addPage([W, H]); y = H - M }
  const need = h => { if (y - h < M) newPage() }
  const text = (s, x, size = 9.5, f = font, color = ink) => page.drawText(safe(s), { x, y, size, font: f, color })
  const wrap = (s, size, f, maxW) => {
    const words = safe(s).split(/\s+/), lines = []
    let cur = ''
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w
      if (f.widthOfTextAtSize(t, size) > maxW && cur) { lines.push(cur); cur = w } else cur = t
    }
    if (cur) lines.push(cur)
    return lines
  }
  newPage()
  text('Signature certificate', M, 18, bold); y -= 16
  text(done ? 'This document was signed electronically by every party listed below.' : `This document is not fully signed yet (status: ${doc.status}).`, M, 9.5, font, muted); y -= 22

  const kv = [
    ['Document', `${doc.doc_number || ''}  ${doc.title || ''}`], ['Type', DOC_TYPE_LABEL[doc.doc_type] || doc.doc_type],
    ['Sent by', orgName || ''], ['Other party', doc.counterparty_name || '-'],
    ['Sent', istTime(doc.sent_at)], ['Completed', done ? istTime(doc.completed_at) : '-'],
    ['Signing order', doc.signing_order === 'PARALLEL' ? 'Any order' : 'One after another'],
    ['Identity check', doc.require_otp ? 'One-time code sent to each signer\'s email' : 'Personal signing link only'],
    ['Fingerprint (SHA-256)', doc.content_hash || '-'],
  ]
  for (const [k, v] of kv) {
    const lines = wrap(v, 9, font, W - 2 * M - 130)
    need(12 * lines.length)
    text(k, M, 9, bold, muted)
    lines.forEach((l, i) => { page.drawText(l, { x: M + 130, y: y - i * 12, size: 9, font, color: ink }) })
    y -= 12 * lines.length + 2
  }
  y -= 6
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: line }); y -= 20

  text('Signatures', M, 12, bold); y -= 18
  for (const s of [...signers].sort((a, b) => a.seq - b.seq)) {
    need(118)
    const top = y
    page.drawRectangle({ x: M, y: top - 104, width: W - 2 * M, height: 108, borderColor: line, borderWidth: 0.8 })
    y = top - 14
    text(`${s.seq}. ${s.name}`, M + 12, 10.5, bold)
    if (s.role_label) { page.drawText(safe(s.role_label), { x: M + 12 + bold.widthOfTextAtSize(safe(`${s.seq}. ${s.name}`), 10.5) + 8, y, size: 9, font, color: muted }) }
    y -= 14
    const rows = [
      ['Email', s.email || '-'], ['Status', s.status === 'SIGNED' ? `Signed ${istTime(s.signed_at)}` : s.status === 'DECLINED' ? `Declined: ${s.decline_reason || ''}` : 'Not signed'],
      ['Typed name', s.typed_name || '-'], ['IP address', s.ip || '-'],
      ['Method', s.signature_kind ? `${s.signature_kind === 'DRAWN' ? 'Drawn' : 'Typed'} signature${doc.require_otp ? ', email code verified' : ''}` : '-'],
    ]
    for (const [k, v] of rows) { text(k, M + 12, 8.5, font, muted); page.drawText(safe(v).slice(0, 70), { x: M + 80, y, size: 8.5, font, color: ink }); y -= 12 }
    if (s.signature_png && s.status === 'SIGNED') {
      try {
        const img = await out.embedPng(base64ToBytes(s.signature_png.split(',')[1]))
        const maxW = 190, maxH = 64, r = Math.min(maxW / img.width, maxH / img.height, 1)
        const w = img.width * r, h = img.height * r, x = W - M - 12 - maxW
        page.drawImage(img, { x: x + (maxW - w) / 2, y: top - 22 - maxH + (maxH - h) / 2, width: w, height: h })
        page.drawLine({ start: { x, y: top - 90 }, end: { x: x + maxW, y: top - 90 }, thickness: 0.6, color: accent })
        page.drawText('Signature', { x, y: top - 100, size: 7.5, font, color: muted })
      } catch { /* a damaged image never blocks the download */ }
    }
    y = top - 118
  }

  const trail = events.filter(e => e.event !== 'CREATED')
  if (trail.length) {
    need(40); y -= 4
    text('Audit trail', M, 12, bold); y -= 16
    const who = Object.fromEntries(signers.map(s => [s.id, s.name]))
    for (const e of trail) {
      need(13)
      text(istTime(e.at), M, 8, font, muted)
      page.drawText(safe(`${eventLabel(e.event)}${e.signer_id && who[e.signer_id] ? ` - ${who[e.signer_id]}` : ''}`).slice(0, 70), { x: M + 140, y, size: 8, font, color: ink })
      if (e.ip) page.drawText(safe(e.ip), { x: W - M - 90, y, size: 8, font, color: muted })
      y -= 12
    }
  }
  need(30); y -= 10
  for (const l of wrap('Signed electronically under the Information Technology Act, 2000. The fingerprint above is the SHA-256 hash of the document content (template documents) or of the uploaded PDF file, taken when it was sent for signature.', 7.5, font, W - 2 * M)) {
    need(10); text(l, M, 7.5, font, muted); y -= 10
  }
  return out.save()
}

