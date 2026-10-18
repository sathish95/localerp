// Text extraction for Email Intelligence attachments (Deno / Edge Function only —
// the web app and node tests never import this file).
//
//   PDF (text layer)  → unpdf (pdf.js)          method PDF_TEXT
//   XLSX / XLS / CSV  → SheetJS, every sheet as CSV  method SHEET
//   TXT / XML / CSV   → UTF-8 decode            method TEXT
//   DOCX / PPTX / ODF / RTF / DOC / EML → eiFormats.js (Phase 5)
//   scanned PDF / images → no text here (method NONE); the configured AI
//   provider reads PDFs / images directly when one is set up, otherwise the
//   document is classified by file name only and routed to review.
//   Password-protected or damaged files throw a FormatError (code) so the
//   pipeline records the reason and raises them for review.

import { extractText, getDocumentProxy } from 'npm:unpdf@0.12.1'
import * as XLSX from 'npm:xlsx@0.18.5'
import { extraText, expandContainer, isEncryptedPdf, FormatError } from './eiFormats.js'

export { expandContainer }

const MAX = 20000

export async function extractAttachmentText(bytes: Uint8Array, ext: string, contentType = ''): Promise<{ text: string; method: string }> {
  const e = (ext || '').toLowerCase()
  const other = await extraText(bytes, e)
  if (other) return other
  if (e === 'pdf' || /pdf/i.test(contentType)) {
    if (isEncryptedPdf(bytes)) throw new FormatError('Password-protected PDF — open it manually', 'ENCRYPTED')
    let pdf
    try { pdf = await getDocumentProxy(new Uint8Array(bytes)) }
    catch (err) { throw new FormatError(/password/i.test(String(err)) ? 'Password-protected PDF — open it manually' : 'The PDF is damaged and cannot be read', /password/i.test(String(err)) ? 'ENCRYPTED' : 'CORRUPT') }
    const { text } = await extractText(pdf, { mergePages: true })
    const t = String(Array.isArray(text) ? text.join('\n') : text || '').replace(/[ \t]+/g, ' ').trim()
    // a scanned PDF has (almost) no text layer
    return t.replace(/\s/g, '').length >= 20 ? { text: t.slice(0, MAX), method: 'PDF_TEXT' } : { text: '', method: 'NONE' }
  }
  if (['xlsx', 'xls', 'ods'].includes(e)) {
    const wb = XLSX.read(bytes, { type: 'array' })
    const parts = wb.SheetNames.slice(0, 10).map((n: string) => `# ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`)
    return { text: parts.join('\n').slice(0, MAX), method: 'SHEET' }
  }
  if (['csv', 'txt', 'xml', 'json'].includes(e) || /^text\//i.test(contentType)) {
    return { text: new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, MAX * 2)).slice(0, MAX), method: 'TEXT' }
  }
  return { text: '', method: 'NONE' }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('')
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(String(b64 || '').replace(/^data:[^,]+,/, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
