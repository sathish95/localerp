// Shared jsPDF drawing primitives — the actual "design system" behind
// the Modern Minimal look, so Invoice/Delivery Note/Proposal/Warranty/GRN
// PDFs read as one consistent family instead of five separately
// hand-tuned layouts. One accent color, used sparingly (the total
// callout, table header fill); status is always a small colored pill,
// never a border-heavy box.

export const ACCENT = '#6366f1'

export function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

export const ACCENT_RGB = hexToRgb(ACCENT)

// Per-document-type status -> color. Anything not listed falls back to
// neutral gray in statusColor() below rather than throwing.
export const STATUS_COLORS = {
  invoice:        { draft: '#94a3b8', sent: '#6366f1', partially_paid: '#f59e0b', paid: '#10b981', cancelled: '#ef4444' },
  delivery_note:  { draft: '#94a3b8', dispatched: '#6366f1', delivered: '#10b981', cancelled: '#ef4444' },
  proposal:       { Draft: '#94a3b8', 'In Negotiation': '#f59e0b', Sent: '#6366f1', Accepted: '#10b981', Rejected: '#ef4444' },
  warranty:       { Reported: '#94a3b8', 'Under Review': '#6366f1', 'PM Review': '#6366f1', 'CEO Review': '#6366f1', 'Finance Review': '#6366f1', Approved: '#0ea5e9', Resolved: '#10b981', Rejected: '#ef4444' },
  grn:            { pending: '#94a3b8', partial: '#f59e0b', received: '#10b981', closed: '#475569' },
}

export function statusColor(docType, status) {
  return STATUS_COLORS[docType]?.[status] || '#94a3b8'
}

// jsPDF's built-in fonts (Helvetica/Times/Courier) use WinAnsiEncoding — a
// single-byte Western codepage with no slot for the Indian Rupee sign
// (₹, U+20B9). The app's rupee() helper (src/lib/supabase.js) prepends
// that exact character, which silently drops/mangles in a generated PDF
// even though it renders perfectly in the browser. Every PDF exporter
// must format money with this instead of rupee() — same grouping/decimals,
// just an ASCII-safe "Rs." prefix that every PDF font can actually draw.
export function pdfCurrency(n, currency = 'INR') {
  const formatted = (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency === 'INR' ? `Rs. ${formatted}` : `${currency} ${formatted}`
}

// Indian-system amount in words ("Fifteen Lakh Thirty-Four Thousand"),
// prefixed with the currency unit and suffixed "Only" — the exact phrasing
// used on the tax-invoice / quotation PDF layout. Paise, when present,
// render as "... And Fifty Paise Only".
const _ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const _TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
function _twoDigits(n) {
  if (n < 20) return _ONES[n]
  const t = Math.floor(n / 10), o = n % 10
  return _TENS[t] + (o ? '-' + _ONES[o] : '')
}
function _threeDigits(n) {
  const h = Math.floor(n / 100), r = n % 100
  return (h ? _ONES[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? _twoDigits(r) : '')
}
function _inWordsIndian(n) {
  if (n < 1000) return _threeDigits(n)
  const crore = Math.floor(n / 10000000)
  const lakh = Math.floor((n % 10000000) / 100000)
  const thousand = Math.floor((n % 100000) / 1000)
  const rest = n % 1000
  const p = []
  if (crore) p.push(_inWordsIndian(crore) + ' Crore')
  if (lakh) p.push(_threeDigits(lakh) + ' Lakh')
  if (thousand) p.push(_threeDigits(thousand) + ' Thousand')
  if (rest) p.push(_threeDigits(rest))
  return p.join(' ')
}
export function amountInWords(amount, currency = 'INR') {
  const abs = Math.abs(Number(amount) || 0)
  const whole = Math.floor(abs)
  const paise = Math.round((abs - whole) * 100)
  const unit = currency === 'INR' ? 'Indian Rupee' : currency
  const wholeWords = whole === 0 ? 'Zero' : _inWordsIndian(whole)
  return paise
    ? `${unit} ${wholeWords} And ${_twoDigits(paise)} Paise Only`
    : `${unit} ${wholeWords} Only`
}

// Draws text wrapped to maxWidth and returns the y position right after
// the last line actually drawn. This is the fix for the overlap bug that
// hit every "draw wrapped text, then advance y by a fixed guess" call
// site — a two-line address or a long note would render its second line
// on top of whatever came next, since the cursor only ever moved by one
// line's worth. Always use this instead of a bare
// doc.text(doc.splitTextToSize(...)) + manual y += N.
export function writeWrapped(doc, text, x, y, maxWidth, lineHeight = 5) {
  const lines = doc.splitTextToSize(String(text ?? ''), maxWidth)
  doc.text(lines, x, y)
  return y + lines.length * lineHeight
}

// Logo-or-text header + document title, right-aligned. Returns the y
// coordinate it's safe to continue drawing from.
export function drawLetterhead(doc, { logo, businessName, docTitle }) {
  let bottomY = 18
  if (logo?.startsWith('data:image')) {
    try { doc.addImage(logo, 'PNG', 14, 10, 32, 16); bottomY = 30 } catch { /* malformed image data — fall through to text */ }
  }
  if (bottomY === 18) {
    doc.setFontSize(16)
    doc.setTextColor(20)
    doc.text(businessName || 'Company', 14, 18)
  }
  doc.setFontSize(19)
  doc.setTextColor(140)
  doc.text(docTitle, 196, 18, { align: 'right' })
  doc.setTextColor(0)
  return bottomY
}

export function drawDivider(doc, y) {
  doc.setDrawColor(226, 232, 240)
  doc.line(14, y, 196, y)
}

// A small rounded status pill. `align: 'right'` treats x as the pill's
// right edge (for placing it flush against a right-aligned number/date
// block) instead of its left edge. Returns the pill's width.
export function drawStatusPill(doc, { x, y, label, color, align = 'left' }) {
  const [r, g, b] = hexToRgb(color)
  const text = (label || '').toUpperCase()
  doc.setFontSize(8.5)
  doc.setFont(undefined, 'bold')
  const textWidth = doc.getTextWidth(text)
  const padX = 4, height = 5.5
  const width = textWidth + padX * 2
  const left = align === 'right' ? x - width : x
  doc.setFillColor(r, g, b)
  doc.roundedRect(left, y, width, height, 1.6, 1.6, 'F')
  doc.setTextColor(255, 255, 255)
  doc.text(text, left + padX, y + height - 1.7)
  doc.setFont(undefined, 'normal')
  doc.setTextColor(0)
  return width
}

// One confident colored callout for "the number that matters" (invoice
// total, amount due) instead of a heavy dark footer table row.
export function drawTotalCallout(doc, { x, y, label, value, width = 74, height = 15, color = ACCENT }) {
  const [r, g, b] = hexToRgb(color)
  doc.setFillColor(r, g, b)
  doc.roundedRect(x, y, width, height, 2.2, 2.2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(8.5)
  doc.text(label.toUpperCase(), x + 7, y + 6)
  doc.setFontSize(14)
  doc.setFont(undefined, 'bold')
  doc.text(String(value), x + width - 7, y + height - 4, { align: 'right' })
  doc.setFont(undefined, 'normal')
  doc.setTextColor(0)
}

// Shared autoTable visual theme — alternating row shading instead of
// grid lines, one accent-tinted header. Spread this into an autoTable()
// call's options object alongside startY/head/body.
export const STRIPED_TABLE_THEME = {
  theme: 'striped',
  styles: { fontSize: 10, cellPadding: { top: 5, bottom: 5, left: 3, right: 3 } },
  headStyles: { fillColor: ACCENT_RGB, textColor: 255, fontStyle: 'bold' },
  alternateRowStyles: { fillColor: [248, 250, 252] },
}

// Two signature lines side by side — used by every document meant to be
// physically signed on receipt/handover (Delivery Note, Warranty, GRN).
export function drawSignatureLines(doc, y, leftLabel, rightLabel) {
  doc.setDrawColor(180)
  doc.line(14, y, 80, y)
  doc.line(130, y, 196, y)
  doc.setFontSize(9)
  doc.setTextColor(100)
  doc.text(leftLabel, 14, y + 5)
  doc.text(rightLabel, 130, y + 5)
  doc.setTextColor(0)
}
