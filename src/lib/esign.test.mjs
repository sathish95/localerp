// Run: node --test src/lib/esign.test.mjs
// Agreements & e-Sign (STEP273): templates, fill-in, body parsing, signing order.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  BUILT_IN_TEMPLATES, fieldsFor, fillTemplate, defaultValues, parseBody, itemsSummary, isTurn, validateSigners, placeholders, fmtDate,
} from './esignTemplates.js'

const SQL = readFileSync(new URL('../../sql/STEP273_esign_agreements.sql', import.meta.url), 'utf8')

test('every built-in template is complete and its doc type exists in SQL', () => {
  const sqlTypes = /doc_type IN \(([^)]*)\)/.exec(SQL)[1]
  for (const t of BUILT_IN_TEMPLATES) {
    assert.ok(sqlTypes.includes(`'${t.doc_type}'`), t.key)
    const keys = new Set(fieldsFor(t).map(f => f.key))
    for (const p of placeholders(t.body)) assert.ok(keys.has(p) || p.startsWith('items_'), `${t.key}: {{${p}}} has no field`)
    for (const f of t.fields) assert.ok(placeholders(t.body).includes(f.key) || f.key === 'items' || f.key === 'gst_rate', `${t.key}: field ${f.key} unused`)
  }
  for (const k of ['nda_mutual', 'service_agreement', 'sow', 'purchase_order', 'work_order', 'epc_contract']) assert.ok(BUILT_IN_TEMPLATES.find(t => t.key === k), k)
})

test('fill-in: dates, money, missing markers, line items with GST', () => {
  const po = BUILT_IN_TEMPLATES.find(t => t.key === 'purchase_order')
  const v = { ...defaultValues(po, { orgName: 'ThingsAlive' }), party_name: 'Acme', po_number: 'PO-7', effective_date: '2026-10-18',
    items: [{ description: 'Sensor | v2', qty: 4, unit: 'Nos', rate: 1250 }, { description: '', qty: '', rate: '' }], gst_rate: '18' }
  const r = fillTemplate(po, v)
  assert.match(r.text, /^# Purchase Order PO-7/)
  assert.match(r.text, /Date: 18 Oct 2026/)
  assert.match(r.text, /\| 1 \| Sensor \/ v2 \| 4 \| Nos \| INR 1,250\.00 \| INR 5,000\.00 \|/)
  assert.match(r.text, /GST at 18%: INR 900\.00/)
  assert.match(r.text, /Total: INR 5,900\.00/)
  assert.match(r.text, /\(GSTIN \[Vendor GSTIN\]\)/)        // optional & empty → visible marker
  assert.deepEqual(r.missing, [])
  assert.deepEqual(fillTemplate(po, {}).missing.sort(), ['company_name', 'effective_date', 'party_name', 'po_number'])
  assert.equal(r.totals.total, 5900)
  assert.deepEqual(itemsSummary([{ qty: '2', rate: '10.005' }], 5), { lines: [{ description: '', qty: 2, unit: '', rate: 10.005, amount: 20.01 }], subtotal: 20.01, gst: 1, total: 21.01 })
})

test('defaults come from org, counterparty and project', () => {
  const sow = BUILT_IN_TEMPLATES.find(t => t.key === 'sow')
  const v = defaultValues(sow, { orgName: 'TA', counterpartyName: 'Client Co', projectName: 'Smart Meters' })
  assert.deepEqual([v.company_name, v.party_name, v.project_name, v.acceptance_days], ['TA', 'Client Co', 'Smart Meters', '7'])
})

test('custom template fields are guessed from placeholders', () => {
  const f = fieldsFor({ body: 'On {{start_date}} pay {{fee_amount}} within {{notice_days}} to {{vendor}} {{items_total}}' })
  assert.deepEqual(f.map(x => [x.key, x.type]), [['start_date', 'date'], ['fee_amount', 'money'], ['notice_days', 'number'], ['vendor', 'text'], ['items', 'items']])
})

test('body parsing: headings, bullets, paragraphs, tables', () => {
  const b = parseBody('# T\n\n## 1. A\nline one\nline two\n- x\n* y\n\n| a | b |\n|---|---|\n| 1 | 2 |\nafter')
  assert.deepEqual(b.map(x => x.kind), ['h1', 'h2', 'p', 'li', 'li', 'table', 'p'])
  assert.equal(b[2].text, 'line one\nline two')
  assert.deepEqual([b[5].head, b[5].rows], [['a', 'b'], [['1', '2']]])
})

test('signing order mirrors _esign_is_turn', () => {
  const s = [{ id: 'a', seq: 1, status: 'SIGNED' }, { id: 'b', seq: 2, status: 'VIEWED' }, { id: 'c', seq: 3, status: 'PENDING' }]
  assert.equal(isTurn(s, s[1]), true)
  assert.equal(isTurn(s, s[2]), false)
  assert.equal(isTurn(s, s[2], 'PARALLEL'), true)
  assert.match(SQL, /o\.seq < s\.seq AND o\.status <> 'SIGNED'/)
})

test('signer validation', () => {
  assert.deepEqual(validateSigners([]), ['Add at least one signer'])
  assert.deepEqual(validateSigners([{ name: 'A', email: 'a@x.com' }, { name: '', email: 'A@X.com' }]), ['Signer 2: name is missing', 'a@x.com is listed twice'])
  assert.deepEqual(validateSigners([{ name: 'B', email: 'nope' }]), ['Signer 1: email is not valid'])
})

test('fmtDate', () => { assert.equal(fmtDate('2026-01-05'), '5 Jan 2026'); assert.equal(fmtDate(''), '') })

test('every template (except blank) has auto-fill details that fill all required fields', async () => {
  const { PRESETS } = await import('./esignPresets.js')
  for (const t of BUILT_IN_TEMPLATES.filter(x => x.key !== 'blank')) {
    const preset = PRESETS[t.key]
    assert.ok(preset, `no auto-fill details for ${t.key}`)
    const r = fillTemplate(t, { ...defaultValues(t, { orgName: 'ThingsAlive Technologies' }), ...preset.values })
    assert.deepEqual(r.missing, [], t.key)
    assert.doesNotMatch(r.text, /\[[A-Z][^\]]*\]/, `${t.key} still has an empty [field]`)
    assert.deepEqual(validateSigners(preset.signers), [], t.key)
    if (preset.values.items) assert.equal(r.totals.total, preset.contract_value, `${t.key} contract value = line total`)
  }
})
