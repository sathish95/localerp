// Email Intelligence — more file formats (STEP272 / Phase 5). Import-free:
// uses only web-standard APIs (DecompressionStream, TextDecoder) that exist in
// both Deno (worker) and Node (tests: src/lib/eiFormats.test.mjs).
//
//   ZIP          validated before anything is read: entry count, total and
//                per-file size, compression ratio (zip bombs), path traversal,
//                encryption, nesting — then each entry becomes its own document
//   DOCX / PPTX / ODT / ODP   text from the XML parts
//   RTF          control words stripped
//   DOC / PPT (old binary)    printable text runs (best effort, marked as such)
//   EML (and Outlook "attached email" items, which Graph returns as MIME)
//                headers + body text, and each MIME attachment as its own document
//   PDF          password-protected files are detected and reported, not guessed at
// MSG files (Outlook binary) are not read here — they are recorded with a clear reason.

export class FormatError extends Error {
  constructor(message, code) { super(message); this.code = code }
}

export const ARCHIVE_LIMITS = { maxEntries: 50, maxEntryBytes: 25 * 1048576, maxTotalBytes: 60 * 1048576, maxRatio: 100 }

const td = new TextDecoder('utf-8', { fatal: false })
const u16 = (b, o) => b[o] | (b[o + 1] << 8)
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

async function inflateRaw(bytes, maxOut) {
  const ds = new DecompressionStream('deflate-raw')
  const reader = new Blob([bytes]).stream().pipeThrough(ds).getReader()
  const chunks = []; let total = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxOut) { await reader.cancel().catch(() => {}); throw new FormatError('A file in the archive expands beyond the size limit', 'BOMB') }
    chunks.push(value)
  }
  const out = new Uint8Array(total); let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}

const isZip = b => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04

/**
 * Read a ZIP safely. Throws FormatError(code) on anything suspicious:
 * CORRUPT, ENCRYPTED, TOO_MANY, TOO_LARGE, BOMB, BAD_PATH, UNSUPPORTED.
 * @returns [{ name, bytes }] (directories skipped)
 */
export async function readZip(bytes, limits = ARCHIVE_LIMITS, { only = null } = {}) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  // end of central directory: scan back over a possible comment
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new FormatError('Not a valid ZIP archive', 'CORRUPT')
  const count = u16(b, eocd + 10)
  let p = u32(b, eocd + 16)
  if (count === 0xffff || p === 0xffffffff) throw new FormatError('ZIP64 archives are not supported', 'UNSUPPORTED')
  if (count > limits.maxEntries) throw new FormatError(`The archive has ${count} files (limit ${limits.maxEntries})`, 'TOO_MANY')
  const out = []; let total = 0
  for (let i = 0; i < count; i++) {
    if (u32(b, p) !== 0x02014b50) throw new FormatError('Damaged ZIP directory', 'CORRUPT')
    const flags = u16(b, p + 8), method = u16(b, p + 10)
    const csize = u32(b, p + 20), usize = u32(b, p + 24)
    const nlen = u16(b, p + 28), elen = u16(b, p + 30), clen = u16(b, p + 32)
    const local = u32(b, p + 42)
    const name = td.decode(b.subarray(p + 46, p + 46 + nlen))
    p += 46 + nlen + elen + clen
    if (name.endsWith('/')) continue
    if (only && !only(name)) continue
    if (name.includes('..') || name.startsWith('/') || /^[a-z]:/i.test(name) || name.includes('\\')) throw new FormatError(`Unsafe path in archive: ${name}`, 'BAD_PATH')
    if (flags & 1) throw new FormatError('The archive is password-protected', 'ENCRYPTED')
    if (usize > limits.maxEntryBytes) throw new FormatError(`${name} is too large inside the archive`, 'TOO_LARGE')
    if (csize > 0 && usize / csize > limits.maxRatio) throw new FormatError(`${name} is compressed suspiciously well (possible zip bomb)`, 'BOMB')
    total += usize
    if (total > limits.maxTotalBytes) throw new FormatError('The archive expands beyond the size limit', 'TOO_LARGE')
    if (u32(b, local) !== 0x04034b50) throw new FormatError('Damaged ZIP entry', 'CORRUPT')
    const start = local + 30 + u16(b, local + 26) + u16(b, local + 28)
    const data = b.subarray(start, start + csize)
    let content
    if (method === 0) content = data.slice()
    else if (method === 8) content = await inflateRaw(data, Math.min(limits.maxEntryBytes, usize + 1024))
    else throw new FormatError(`Compression method ${method} is not supported`, 'UNSUPPORTED')
    out.push({ name, bytes: content })
  }
  return out
}

/* ── text from XML-based office files ── */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const decodeEntities = s => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === '#'
  ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e.toLowerCase()] ?? m))
function xmlText(xml, paraTags) {
  let s = String(xml)
  for (const t of paraTags) s = s.replace(new RegExp(`</${t}>`, 'g'), '\n')
  s = s.replace(/<w:tab\/>|<text:tab\/>/g, '\t').replace(/<w:br\/>|<a:br\/>|<text:line-break\/>/g, '\n')
  return decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

const MAX = 20000
export async function officeText(bytes, ext) {
  const e = String(ext || '').toLowerCase()
  const pick = re => readZip(bytes, ARCHIVE_LIMITS, { only: n => re.test(n) })
  if (e === 'docx' || e === 'docm' || e === 'dotx') {
    const parts = await pick(/^word\/(document|header\d*|footer\d*)\.xml$/)
    const doc = parts.sort((a, b) => (a.name.includes('document') ? -1 : 1) - (b.name.includes('document') ? -1 : 1))
    return { text: doc.map(x => xmlText(td.decode(x.bytes), ['w:p'])).join('\n').slice(0, MAX), method: 'DOCX' }
  }
  if (e === 'pptx' || e === 'pptm') {
    const slides = (await pick(/^ppt\/slides\/slide\d+\.xml$/)).sort((a, b) => Number(a.name.match(/(\d+)\.xml$/)[1]) - Number(b.name.match(/(\d+)\.xml$/)[1]))
    return { text: slides.map((x, i) => `# Slide ${i + 1}\n${xmlText(td.decode(x.bytes), ['a:p'])}`).join('\n').slice(0, MAX), method: 'PPTX' }
  }
  if (e === 'odt' || e === 'odp' || e === 'ods') {
    const [c] = await pick(/^content\.xml$/)
    return { text: c ? xmlText(td.decode(c.bytes), ['text:p', 'text:h']).slice(0, MAX) : '', method: 'ODF' }
  }
  return null
}

export function rtfText(bytes) {
  let s = td.decode(bytes)
  s = s.replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  s = s.replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(Number(n) < 0 ? Number(n) + 65536 : Number(n)))
  // drop destinations we never want as text (fonts, colours, styles, pictures)
  s = s.replace(/\{(?:\\\*)?\\(fonttbl|colortbl|stylesheet|info|pict|themedata|colorschememapping|datastore|latentstyles)[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, '')
  s = s.replace(/\\(par|line)\b ?/g, '\n').replace(/\\tab\b ?/g, '\t').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '')
  return s.replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX)
}

// Old binary Office files: printable runs (UTF-16LE and ASCII), best effort
export function binaryText(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const runs = []
  let cur = ''
  for (let i = 0; i + 1 < b.length; i += 2) {   // UTF-16LE
    const c = b[i] | (b[i + 1] << 8)
    if ((c >= 32 && c < 0xd800 && c !== 0xfffd) || c === 10 || c === 13 || c === 9) cur += String.fromCharCode(c)
    else { if (cur.trim().length >= 6) runs.push(cur.trim()); cur = '' }
  }
  if (cur.trim().length >= 6) runs.push(cur.trim())
  cur = ''
  for (let i = 0; i < b.length; i++) {   // 8-bit text (Word stores "compressed" text this way)
    const c = b[i]
    if ((c >= 32 && c < 127) || c === 10 || c === 13 || c === 9) cur += String.fromCharCode(c)
    else { if (cur.trim().length >= 6) runs.push(cur.trim()); cur = '' }
  }
  if (cur.trim().length >= 6) runs.push(cur.trim())
  const text = [...new Set(runs)].filter(r => /[a-z]{3}/i.test(r) && (r.match(/[a-z ]/gi) || []).length / r.length > 0.7).join('\n')
  return text.slice(0, MAX)
}

export function isEncryptedPdf(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const head = td.decode(b.subarray(0, Math.min(b.length, 4096)))
  const tail = td.decode(b.subarray(Math.max(0, b.length - 65536)))
  return head.startsWith('%PDF') && /\/Encrypt\s/.test(tail + head)
}

/* ── EML / MIME ── */
function qpDecode(s) {
  const bytes = []
  const t = s.replace(/=\r?\n/g, '')
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '=' && /^[0-9A-F]{2}$/i.test(t.slice(i + 1, i + 3))) { bytes.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2 }
    else bytes.push(t.charCodeAt(i) & 0xff)
  }
  return new Uint8Array(bytes)
}
function b64Decode(s) {
  const bin = atob(String(s).replace(/[^A-Za-z0-9+/=]/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
// RFC 2047 encoded words in headers
const decodeWords = s => String(s || '').replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_, cs, enc, txt) => {
  try {
    const b = enc.toUpperCase() === 'B' ? b64Decode(txt) : qpDecode(txt.replace(/_/g, ' '))
    return new TextDecoder(/8859|latin/i.test(cs) ? 'latin1' : 'utf-8').decode(b)
  } catch { return txt }
})
function splitHeaders(raw) {
  const i = raw.search(/\r?\n\r?\n/)
  const head = i < 0 ? raw : raw.slice(0, i)
  const body = i < 0 ? '' : raw.slice(i).replace(/^\r?\n\r?\n/, '')
  const headers = {}
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const m = line.match(/^([\w-]+):\s*(.*)$/)
    if (m) headers[m[1].toLowerCase()] ??= m[2]
  }
  return { headers, body }
}
const param = (h, k) => (String(h || '').match(new RegExp(`${k}\\*?=(?:"([^"]*)"|([^;\\s]*))`, 'i')) || []).slice(1).find(Boolean) || null

function walk(raw, out, depth) {
  const { headers, body } = splitHeaders(raw)
  const ct = headers['content-type'] || 'text/plain'
  const type = ct.split(';')[0].trim().toLowerCase()
  if (type.startsWith('multipart/') && depth < 6) {
    const boundary = param(ct, 'boundary')
    if (!boundary) return
    const parts = body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \\t]*\\r?\\n?`))
    for (const p of parts) if (p.trim()) walk(p, out, depth + 1)
    return
  }
  const enc = (headers['content-transfer-encoding'] || '').toLowerCase()
  const bytes = enc === 'base64' ? b64Decode(body) : enc === 'quoted-printable' ? qpDecode(body) : Uint8Array.from(body, ch => ch.charCodeAt(0) & 0xff)
  const disp = headers['content-disposition'] || ''
  const name = decodeWords(param(disp, 'filename') || param(ct, 'name') || '')
  if (name || /attachment/i.test(disp) || type === 'message/rfc822') {
    out.attachments.push({ name: name || (type === 'message/rfc822' ? 'attached-email.eml' : 'attachment.bin'), contentType: type, bytes })
  } else if (type === 'text/plain' && !out.text) {
    out.text = new TextDecoder(/8859|latin|1252/i.test(param(ct, 'charset') || '') ? 'latin1' : 'utf-8').decode(bytes)
  } else if (type === 'text/html' && !out.html) {
    out.html = new TextDecoder('utf-8').decode(bytes)
  }
}

export function parseEml(bytes) {
  const raw = new TextDecoder('latin1').decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
  const { headers } = splitHeaders(raw)
  const out = { text: '', html: '', attachments: [] }
  walk(raw, out, 0)
  const body = out.text || decodeEntities(out.html.replace(/<(br|\/p|\/div|\/tr)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ')
  return {
    subject: decodeWords(headers.subject || ''), from: decodeWords(headers.from || ''), to: decodeWords(headers.to || ''), date: headers.date || null,
    text: body.replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX), attachments: out.attachments,
  }
}

const CT = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', csv: 'text/csv', txt: 'text/plain', eml: 'message/rfc822', xml: 'application/xml' }
export const contentTypeFor = name => CT[(String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1]] || 'application/octet-stream'

/**
 * Containers whose content becomes separate documents.
 * @returns { kind: 'zip'|'eml', text, children: [{ name, contentType, bytes }] } | null
 */
export async function expandContainer(bytes, ext, contentType = '', limits = ARCHIVE_LIMITS) {
  const e = String(ext || '').toLowerCase()
  if (e === 'zip' || /zip/i.test(contentType)) {
    const entries = await readZip(bytes, limits)
    const files = entries.filter(x => !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)/.test(x.name))
    return { kind: 'zip', text: `Archive with ${files.length} file${files.length === 1 ? '' : 's'}:\n${files.map(f => f.name).join('\n')}`,
      children: files.map(f => ({ name: f.name.split('/').pop(), path: f.name, contentType: contentTypeFor(f.name), bytes: f.bytes })) }
  }
  if (e === 'eml' || /message\/rfc822/i.test(contentType)) {
    const m = parseEml(bytes)
    return { kind: 'eml', text: [`Subject: ${m.subject}`, `From: ${m.from}`, m.date ? `Date: ${m.date}` : null, '', m.text].filter(x => x != null).join('\n'),
      children: m.attachments.slice(0, limits.maxEntries).map(a => ({ name: a.name, contentType: a.contentType || contentTypeFor(a.name), bytes: a.bytes })) }
  }
  return null
}

// Text for the formats above (null = not handled here)
export async function extraText(bytes, ext) {
  const e = String(ext || '').toLowerCase()
  if (['docx', 'docm', 'dotx', 'pptx', 'pptm', 'odt', 'odp', 'ods'].includes(e)) {
    if (!isZip(bytes)) throw new FormatError('The file is damaged or not really a ' + e.toUpperCase(), 'CORRUPT')
    return officeText(bytes, e)
  }
  if (e === 'rtf') return { text: rtfText(bytes), method: 'RTF' }
  if (e === 'doc' || e === 'ppt') return { text: binaryText(bytes), method: 'BINARY_TEXT' }
  if (e === 'eml') { const m = parseEml(bytes); return { text: [`Subject: ${m.subject}`, `From: ${m.from}`, '', m.text].join('\n').slice(0, MAX), method: 'EML' } }
  if (e === 'msg') throw new FormatError('Outlook .msg files are not read automatically — open it in Outlook, or forward it as an attachment', 'UNSUPPORTED')
  return null
}
