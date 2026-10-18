// Run: node --test src/lib/eiFormats.test.mjs
// More file formats (Phase 5): ZIP safety, Office / RTF / EML text, containers in the pipeline.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readZip, officeText, rtfText, parseEml, expandContainer, extraText, isEncryptedPdf, binaryText, FormatError } from '../../supabase/functions/_shared/eiFormats.js'
import { runEmailIntelligence } from '../../supabase/functions/_shared/eiPipeline.js'
import { CONFIG, docDeps, CTX } from './eiFixtures.mjs'

const enc = new TextEncoder()
async function deflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(s).arrayBuffer())
}
// Minimal ZIP writer for tests (CRC left 0 — the reader doesn't rely on it)
async function zip(files, { encrypted = false, store = false } = {}) {
  const parts = [], central = []; let off = 0
  for (const f of files) {
    const name = enc.encode(f.name), raw = typeof f.data === 'string' ? enc.encode(f.data) : f.data
    const data = store ? raw : await deflate(raw)
    const h = new DataView(new ArrayBuffer(30))
    h.setUint32(0, 0x04034b50, true); h.setUint16(6, encrypted ? 1 : 0, true); h.setUint16(8, store ? 0 : 8, true)
    h.setUint32(18, data.length, true); h.setUint32(22, raw.length, true); h.setUint16(26, name.length, true)
    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true); c.setUint16(8, encrypted ? 1 : 0, true); c.setUint16(10, store ? 0 : 8, true)
    c.setUint32(20, data.length, true); c.setUint32(24, raw.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true)
    parts.push(new Uint8Array(h.buffer), name, data); central.push(new Uint8Array(c.buffer), name)
    off += 30 + name.length + data.length
  }
  const cdSize = central.reduce((s, x) => s + x.length, 0)
  const e = new DataView(new ArrayBuffer(22))
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true)
  return new Uint8Array(await new Blob([...parts, ...central, new Uint8Array(e.buffer)]).arrayBuffer())
}
const code = async p => { try { await p; return 'OK' } catch (e) { assert.ok(e instanceof FormatError, e.message); return e.code } }

test('zip: reads deflated and stored entries', async () => {
  const z = await zip([{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.txt', data: 'world' }])
  assert.deepEqual((await readZip(z)).map(x => [x.name, new TextDecoder().decode(x.bytes)]), [['a.txt', 'hello'], ['dir/b.txt', 'world']])
  const s = await zip([{ name: 'c.txt', data: 'stored' }], { store: true })
  assert.equal(new TextDecoder().decode((await readZip(s))[0].bytes), 'stored')
})

test('zip: unsafe archives are refused with a reason', async () => {
  assert.equal(await code(readZip(await zip([{ name: '../evil.txt', data: 'x' }]))), 'BAD_PATH')
  assert.equal(await code(readZip(await zip([{ name: 'a.txt', data: 'x' }], { encrypted: true }))), 'ENCRYPTED')
  assert.equal(await code(readZip(await zip([{ name: 'bomb.txt', data: new Uint8Array(5 * 1048576) }]))), 'BOMB')
  assert.equal(await code(readZip(await zip(Array.from({ length: 60 }, (_, i) => ({ name: `f${i}.txt`, data: 'x' }))))), 'TOO_MANY')
  assert.equal(await code(readZip(enc.encode('not a zip at all'))), 'CORRUPT')
})

test('office text: docx and pptx', async () => {
  const docx = await zip([{ name: 'word/document.xml', data: '<w:document><w:body><w:p><w:r><w:t>Method Statement</w:t></w:r></w:p><w:p><w:r><w:t>Piling &amp; works</w:t></w:r></w:p></w:body></w:document>' }])
  assert.deepEqual(await officeText(docx, 'docx'), { text: 'Method Statement\nPiling & works', method: 'DOCX' })
  const pptx = await zip([{ name: 'ppt/slides/slide2.xml', data: '<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>' }, { name: 'ppt/slides/slide1.xml', data: '<p:sld><a:p><a:r><a:t>Steering committee pack</a:t></a:r></a:p></p:sld>' }])
  const t = await officeText(pptx, 'pptx')
  assert.ok(t.text.indexOf('Steering committee pack') < t.text.indexOf('Second'))
  assert.equal(await code(extraText(enc.encode('garbage'), 'docx')), 'CORRUPT')
})

test('rtf, old binary office, encrypted pdf, msg', async () => {
  assert.equal(rtfText(enc.encode('{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 Work Order\\par No 77\\par}')), 'Work Order\nNo 77')
  const u16 = s => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) b[i * 2] = s.charCodeAt(i); return b }
  const doc = new Uint8Array([...new Uint8Array(40), ...u16('Letter of Acceptance for road works'), ...new Uint8Array(40).fill(255)])
  assert.match(binaryText(doc), /Letter of Acceptance/)
  assert.equal(isEncryptedPdf(enc.encode('%PDF-1.7\n1 0 obj\ntrailer << /Root 1 0 R /Encrypt 5 0 R >>')), true)
  assert.equal(isEncryptedPdf(enc.encode('%PDF-1.7\ntrailer << /Root 1 0 R >>')), false)
  assert.equal(await code(extraText(enc.encode('x'), 'msg')), 'UNSUPPORTED')
})

const EML = [
  'From: =?UTF-8?B?U2l0ZSBFbmdpbmVlcg==?= <se@contractor.in>', 'Subject: Fwd: WIR 034', 'Date: Tue, 13 Oct 2026 10:00:00 +0530',
  'Content-Type: multipart/mixed; boundary="XYZ"', '', '--XYZ', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '',
  'Please inspect pier P12 =E2=80=94 PRJ-101', '--XYZ', 'Content-Type: application/pdf; name="WIR-034.pdf"', 'Content-Disposition: attachment; filename="WIR-034.pdf"',
  'Content-Transfer-Encoding: base64', '', Buffer.from('Work Inspection Request PRJ-101').toString('base64'), '--XYZ--', '',
].join('\r\n')

test('eml: headers, body and attachments', async () => {
  const m = parseEml(enc.encode(EML))
  assert.equal(m.from, 'Site Engineer <se@contractor.in>')
  assert.equal(m.subject, 'Fwd: WIR 034')
  assert.equal(m.text, 'Please inspect pier P12 — PRJ-101')
  assert.equal(m.attachments.length, 1)
  assert.equal(new TextDecoder().decode(m.attachments[0].bytes), 'Work Inspection Request PRJ-101')
  const c = await expandContainer(enc.encode(EML), 'eml')
  assert.equal(c.kind, 'eml'); assert.equal(c.children[0].name, 'WIR-034.pdf')
})

test('pipeline: a ZIP becomes one document per file, each filed on its own', async () => {
  const z = await zip([{ name: 'docs/WO_PRJ-202.txt', data: 'WORK ORDER for PRJ-202 Solar Park' }, { name: '__MACOSX/._x', data: 'junk' }])
  const files = [{ id: 'z', name: 'bundle.zip', bytes: z }]
  const { st, d } = docDeps([], CTX)
  d.attachments = { list: async () => [{ id: 'z', name: 'bundle.zip', contentType: 'application/zip', size: z.length, kind: 'file' }], fetchBytes: async () => files[0].bytes }
  d.text = { extract: async (b, ext) => ({ text: new TextDecoder().decode(b), method: 'TEXT' }), expand: (b, ext, ct) => expandContainer(b, ext, ct) }
  const cfg = { ...CONFIG, settings: { attachments: { max_mb: 15, max_count: 15, allowed_ext: ['zip', 'txt', 'pdf'] } } }
  const rep = await runEmailIntelligence({ row: { id: 'm', organization_id: 'o' }, email: { subject: 'Docs', body: 'see zip', senderEmail: 'x@gov.in' }, config: cfg, version: 1, deps: d })
  const child = rep.attachments.find(a => /WO_PRJ-202/.test(a.file_name))
  assert.ok(child, JSON.stringify(rep.attachments.map(a => a.file_name)))
  assert.equal(st.updates[child.id].project_id, 'p2')
  assert.equal(st.updates[child.id].doc_type_code, 'WORK_ORDER')
  assert.ok(!rep.attachments.some(a => /MACOSX/.test(a.file_name)))
  assert.ok(rep.attachments.some(a => a.file_name === 'bundle.zip'))
})

test('pipeline: unsafe ZIP is recorded with its reason and raised for review', async () => {
  const z = await zip([{ name: '../x.txt', data: 'x' }])
  const { st, d } = docDeps([], CTX)
  d.attachments = { list: async () => [{ id: 'z', name: 'evil.zip', contentType: 'application/zip', size: z.length, kind: 'file' }], fetchBytes: async () => z }
  d.text = { extract: async () => ({ text: '', method: 'NONE' }), expand: (b, ext, ct) => expandContainer(b, ext, ct) }
  const raised = []; d.db.raiseException = async e => { raised.push(e); return 'x' }
  const cfg = { ...CONFIG, settings: { attachments: { allowed_ext: ['zip'] } } }
  await runEmailIntelligence({ row: { id: 'm', organization_id: 'o' }, email: { subject: 's', body: 'b', senderEmail: 'x@y.com' }, config: cfg, version: 1, deps: d })
  assert.equal(st.updates['att-z'].status, 'SKIPPED')
  assert.match(st.updates['att-z'].skip_reason, /Unsafe path/)
  assert.ok(raised.some(e => e.kind === 'DOCUMENT_REVIEW'))
})
