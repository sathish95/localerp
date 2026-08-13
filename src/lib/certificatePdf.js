import jsPDF from 'jspdf'
import QRCode from 'qrcode'
import { hexToRgb } from './pdfKit'
import { resolveTemplateString } from './certificateVariables'

const FONT_MAP = { helvetica: 'helvetica', times: 'times', courier: 'courier' }

// Renders a template version + resolved data into a jsPDF document.
// Uses unit:'px' with the version's own canvas_width/canvas_height as the
// page format, so every element's x/y/width/height is drawn in the exact
// same pixel coordinate space the on-screen builder canvas uses — no
// mm-conversion math, and the PDF is pixel-for-pixel what HR designed.
// verifyUrl is optional (the builder's "Preview" call has none yet, since
// a draft template isn't attached to a real certificate number) — the
// qrcode element just renders a placeholder box when it's missing.
export async function renderCertificatePdf(version, data, verifyUrl) {
  const doc = new jsPDF({
    orientation: version.orientation === 'portrait' ? 'p' : 'l',
    unit: 'px',
    format: [version.canvas_width, version.canvas_height],
  })

  if (version.background_color) {
    const [r, g, b] = hexToRgb(version.background_color)
    doc.setFillColor(r, g, b)
    doc.rect(0, 0, version.canvas_width, version.canvas_height, 'F')
  }
  if (version.background_image) {
    try { doc.addImage(version.background_image, 0, 0, version.canvas_width, version.canvas_height) } catch { /* malformed image */ }
  }

  const elements = [...(version.elements || [])].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
  for (const el of elements) {
    if (el.type === 'text') {
      drawText(doc, el, data)
    } else if (el.type === 'image') {
      const src = el.variableKey ? data[el.variableKey] : el.imageSrc
      if (src) { try { doc.addImage(src, el.x, el.y, el.width, el.height) } catch { /* malformed image */ } }
    } else if (el.type === 'shape') {
      drawShape(doc, el)
    } else if (el.type === 'qrcode') {
      const url = verifyUrl || 'https://example.com/verify/preview'
      try {
        const qrDataUrl = await QRCode.toDataURL(url, { margin: 0, width: Math.max(64, Math.round(el.width)) })
        doc.addImage(qrDataUrl, el.x, el.y, el.width, el.height)
      } catch { /* qr generation failure — skip silently */ }
    }
  }
  return doc
}

function drawText(doc, el, data) {
  const text = resolveTemplateString(el.content, data)
  if (!text) return
  const fontStyle = el.bold && el.italic ? 'bolditalic' : el.bold ? 'bold' : el.italic ? 'italic' : 'normal'
  doc.setFont(FONT_MAP[el.fontFamily] || 'helvetica', fontStyle)
  doc.setFontSize(el.fontSize || 16)
  const [r, g, b] = hexToRgb(el.color || '#111111')
  doc.setTextColor(r, g, b)
  const lineHeight = (el.fontSize || 16) * 1.3
  const lines = doc.splitTextToSize(text, el.width)
  const align = el.align || 'left'
  const alignX = align === 'center' ? el.x + el.width / 2 : align === 'right' ? el.x + el.width : el.x
  let ty = el.y + (el.fontSize || 16)
  lines.forEach(line => { doc.text(line, alignX, ty, { align }); ty += lineHeight })
  doc.setTextColor(0, 0, 0)
}

function drawShape(doc, el) {
  const [br, bg, bb] = hexToRgb(el.borderColor || '#000000')
  doc.setDrawColor(br, bg, bb)
  doc.setLineWidth(el.borderWidth || 1)
  if (el.shapeType === 'line') {
    doc.line(el.x, el.y, el.x + el.width, el.y + (el.height || 0))
    return
  }
  if (el.filled) {
    const [fr, fg, fb] = hexToRgb(el.fillColor || '#ffffff')
    doc.setFillColor(fr, fg, fb)
  }
  doc.rect(el.x, el.y, el.width, el.height, el.filled ? 'FD' : 'D')
}
