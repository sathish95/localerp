// Agreements & e-Sign (STEP273) — built-in templates and the pure text helpers
// shared by the editor, the public signing page and the PDF builder.
// Import-free so `node --test src/lib/esign.test.mjs` can load it.
//
// Body markup (one block per line group):
//   # Heading        ## Sub-heading       - bullet
//   | a | b |  table rows (first row = header)        blank line = new paragraph
//   {{field_key}}  replaced by the field's value ({{items_table}} / {{items_total}}
//   come from an `items` field).

export const DOC_TYPES = [
  ['AGREEMENT', 'Agreement'], ['NDA', 'NDA'], ['MSA', 'Master service agreement'], ['EPC_CONTRACT', 'EPC contract'],
  ['SOW', 'Statement of work'], ['PURCHASE_ORDER', 'Purchase order'], ['WORK_ORDER', 'Work order'],
  ['AMENDMENT', 'Amendment'], ['OTHER', 'Other'],
]
export const DOC_TYPE_LABEL = Object.fromEntries(DOC_TYPES)

export const STATUS_META = {
  DRAFT: ['Draft', 'gray'], SENT: ['Out for signature', 'amber'], IN_PROGRESS: ['Partly signed', 'amber'],
  COMPLETED: ['Signed', 'green'], DECLINED: ['Declined', 'red'], CANCELLED: ['Cancelled', 'gray'], EXPIRED: ['Expired', 'red'],
}
export const SIGNER_STATUS_META = {
  PENDING: ['Waiting', 'gray'], NOTIFIED: ['Sent', 'amber'], VIEWED: ['Viewed', 'amber'], SIGNED: ['Signed', 'green'], DECLINED: ['Declined', 'red'],
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function fmtDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''))
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : String(v || '')
}
export function fmtMoney(v, currency = 'INR') {
  const n = Number(v)
  if (v === '' || v == null || !Number.isFinite(n)) return ''
  const s = n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency === 'INR' ? `INR ${s}` : `${currency} ${s}`
}

const PARTY = [
  { key: 'company_name', label: 'Our company name', type: 'text', required: true, source: 'org' },
  { key: 'company_address', label: 'Our registered address', type: 'textarea' },
  { key: 'party_name', label: 'Other party name', type: 'text', required: true, source: 'counterparty' },
  { key: 'party_address', label: 'Other party address', type: 'textarea', source: 'counterparty_address' },
]
const DATES = [{ key: 'effective_date', label: 'Effective date', type: 'date', required: true }]
const LAW = [{ key: 'jurisdiction', label: 'Courts at (city)', type: 'text', required: true }]
const ITEMS = [{ key: 'items', label: 'Line items', type: 'items' }, { key: 'gst_rate', label: 'GST %', type: 'number', default: '18' }]

export const BUILT_IN_TEMPLATES = [
  {
    key: 'nda_mutual', name: 'Mutual NDA', doc_type: 'NDA',
    description: 'Both parties share and protect confidential information.',
    fields: [...PARTY, ...DATES,
      { key: 'purpose', label: 'Purpose of disclosure', type: 'textarea', required: true, default: 'evaluating and carrying out a possible business relationship between the parties' },
      { key: 'term_years', label: 'Confidentiality period (years)', type: 'number', default: '3' }, ...LAW],
    body: `# Mutual Non-Disclosure Agreement

This Mutual Non-Disclosure Agreement ("Agreement") is made on {{effective_date}} between {{company_name}}, {{company_address}} and {{party_name}}, {{party_address}} (each a "Party", together the "Parties").

## 1. Purpose
The Parties wish to share information for {{purpose}} (the "Purpose").

## 2. Confidential Information
"Confidential Information" means any business, technical, financial or customer information disclosed by one Party to the other, in any form, that is marked confidential or would reasonably be understood to be confidential. It does not include information that is or becomes public without breach, was already lawfully known to the receiving Party, is independently developed, or is lawfully received from a third party without restriction.

## 3. Obligations
The receiving Party shall:
- use the Confidential Information only for the Purpose;
- not disclose it to anyone except its employees, advisers and contractors who need to know it and are bound by similar obligations;
- protect it with at least the care it uses for its own confidential information, and no less than reasonable care.

## 4. Required disclosure
A Party may disclose Confidential Information if required by law, court or regulator, after giving the other Party prompt notice where lawful.

## 5. Term
This Agreement applies to disclosures made within one year of the effective date. The obligations continue for {{term_years}} years after each disclosure.

## 6. Return of information
On request, the receiving Party shall return or destroy the Confidential Information and confirm this in writing.

## 7. No licence
No licence or right is granted except the limited right to use the information for the Purpose. All information is provided "as is".

## 8. Remedies
Unauthorised disclosure may cause irreparable harm; the disclosing Party may seek injunctive relief in addition to other remedies.

## 9. Governing law
This Agreement is governed by the laws of India. The courts at {{jurisdiction}} have exclusive jurisdiction.

The Parties have signed this Agreement electronically on the dates shown in the signature certificate.`,
  },
  {
    key: 'service_agreement', name: 'Service agreement', doc_type: 'AGREEMENT',
    description: 'General agreement for services with fees, term and termination.',
    fields: [...PARTY, ...DATES,
      { key: 'services', label: 'Services', type: 'textarea', required: true },
      { key: 'fees', label: 'Fees', type: 'money', required: true },
      { key: 'payment_terms', label: 'Payment terms', type: 'text', default: '30 days from the date of invoice' },
      { key: 'term_months', label: 'Term (months)', type: 'number', default: '12' },
      { key: 'notice_days', label: 'Termination notice (days)', type: 'number', default: '30' }, ...LAW],
    body: `# Service Agreement

This Service Agreement is made on {{effective_date}} between {{company_name}}, {{company_address}} ("Service Provider") and {{party_name}}, {{party_address}} ("Client").

## 1. Services
The Service Provider shall provide the following services: {{services}}

## 2. Fees and payment
The Client shall pay {{fees}} plus applicable taxes. Payment is due within {{payment_terms}}. Late payments may attract interest at 1.5% per month.

## 3. Term
This Agreement starts on the effective date and continues for {{term_months}} months unless terminated earlier.

## 4. Termination
Either party may terminate this Agreement with {{notice_days}} days' written notice, or immediately if the other party materially breaches it and does not remedy the breach within 15 days of notice. Fees for services delivered up to termination remain payable.

## 5. Confidentiality
Each party shall keep the other's confidential information confidential and use it only to perform this Agreement.

## 6. Intellectual property
Pre-existing intellectual property stays with its owner. Deliverables are licensed to the Client on payment in full, unless agreed otherwise in a statement of work.

## 7. Limitation of liability
Neither party is liable for indirect or consequential losses. Each party's total liability is limited to the fees paid in the twelve months before the claim, except for breach of confidentiality, fraud or wilful misconduct.

## 8. General
This Agreement is the entire agreement on its subject. Changes must be in writing and signed by both parties. It is governed by the laws of India and the courts at {{jurisdiction}} have exclusive jurisdiction.

The parties have signed this Agreement electronically.`,
  },
  {
    key: 'sow', name: 'Statement of work', doc_type: 'SOW',
    description: 'Scope, deliverables, milestones and acceptance for a project.',
    fields: [...PARTY, ...DATES,
      { key: 'project_name', label: 'Project name', type: 'text', required: true, source: 'project' },
      { key: 'master_agreement', label: 'Under agreement (reference)', type: 'text' },
      { key: 'scope', label: 'Scope of work', type: 'textarea', required: true },
      { key: 'deliverables', label: 'Deliverables (one per line)', type: 'textarea', required: true },
      { key: 'out_of_scope', label: 'Out of scope', type: 'textarea' },
      { key: 'milestones', label: 'Milestones and payment schedule (one per line)', type: 'textarea' },
      { key: 'fees', label: 'Total fees', type: 'money', required: true },
      { key: 'end_date', label: 'Completion date', type: 'date' },
      { key: 'acceptance_days', label: 'Acceptance period (days)', type: 'number', default: '7' }],
    body: `# Statement of Work — {{project_name}}

This Statement of Work ("SOW") dated {{effective_date}} is between {{company_name}}, {{company_address}} ("Supplier") and {{party_name}}, {{party_address}} ("Client"). It is governed by {{master_agreement}}.

## 1. Scope
{{scope}}

## 2. Deliverables
{{deliverables}}

## 3. Out of scope
{{out_of_scope}}

## 4. Timeline
Work starts on {{effective_date}} and is planned to be completed by {{end_date}}.

## 5. Milestones and payment
{{milestones}}

Total fees: {{fees}} plus applicable taxes.

## 6. Acceptance
The Client shall review each deliverable within {{acceptance_days}} days of delivery and either accept it or list the defects in writing. A deliverable not rejected in that period is treated as accepted.

## 7. Change requests
Any change to scope, timeline or fees needs a written change request agreed by both parties.

Signed electronically by the authorised representatives of both parties.`,
  },
  {
    key: 'purchase_order', name: 'Purchase order', doc_type: 'PURCHASE_ORDER',
    description: 'Order to a vendor with line items, GST and delivery terms.',
    fields: [...PARTY.map(f => (f.key === 'party_name' ? { ...f, label: 'Vendor name' } : f.key === 'party_address' ? { ...f, label: 'Vendor address' } : f)),
      { key: 'po_number', label: 'PO number', type: 'text', required: true },
      { key: 'effective_date', label: 'PO date', type: 'date', required: true },
      { key: 'vendor_gstin', label: 'Vendor GSTIN', type: 'text' },
      { key: 'delivery_address', label: 'Delivery address', type: 'textarea' },
      { key: 'delivery_date', label: 'Delivery by', type: 'date' }, ...ITEMS,
      { key: 'payment_terms', label: 'Payment terms', type: 'text', default: '30 days from receipt of goods and a valid tax invoice' }],
    body: `# Purchase Order {{po_number}}

Date: {{effective_date}}
From: {{company_name}}, {{company_address}}
To: {{party_name}}, {{party_address}} (GSTIN {{vendor_gstin}})

## Items
{{items_table}}

Sub-total: {{items_subtotal}}
GST at {{gst_rate}}%: {{items_gst}}
Total: {{items_total}}

## Delivery
Deliver to {{delivery_address}} by {{delivery_date}}. Each delivery must carry a delivery challan quoting this PO number.

## Terms
- Payment: {{payment_terms}}.
- Invoices must quote this PO number and match the quantities received.
- Goods are subject to inspection; rejected goods will be returned at the vendor's cost.
- Prices are fixed for this order. Changes need a written PO amendment.

The vendor accepts this purchase order by signing it electronically.`,
  },
  {
    key: 'work_order', name: 'Work order', doc_type: 'WORK_ORDER',
    description: 'Order for site or service work by a contractor.',
    fields: [...PARTY.map(f => (f.key === 'party_name' ? { ...f, label: 'Contractor name' } : f.key === 'party_address' ? { ...f, label: 'Contractor address' } : f)),
      { key: 'wo_number', label: 'Work order number', type: 'text', required: true },
      { key: 'effective_date', label: 'Date', type: 'date', required: true },
      { key: 'project_name', label: 'Project', type: 'text', source: 'project' },
      { key: 'site', label: 'Site / location', type: 'text', required: true },
      { key: 'scope', label: 'Scope of work', type: 'textarea', required: true },
      { key: 'start_date', label: 'Start date', type: 'date' }, { key: 'end_date', label: 'Completion date', type: 'date' }, ...ITEMS,
      { key: 'retention_pct', label: 'Retention %', type: 'number', default: '5' },
      { key: 'ld_pct', label: 'Liquidated damages % per week (max 10%)', type: 'number', default: '0.5' }],
    body: `# Work Order {{wo_number}}

Date: {{effective_date}}
Issued by: {{company_name}}, {{company_address}}
Issued to: {{party_name}}, {{party_address}}
Project: {{project_name}}   Site: {{site}}

## 1. Scope of work
{{scope}}

## 2. Schedule of rates
{{items_table}}

Sub-total: {{items_subtotal}}
GST at {{gst_rate}}%: {{items_gst}}
Total work order value: {{items_total}}

## 3. Time for completion
Start on {{start_date}} and complete by {{end_date}}. For delay attributable to the contractor, liquidated damages of {{ld_pct}}% of the work order value per week apply, up to 10%.

## 4. Payment
Running bills against measured work certified by the site engineer. {{retention_pct}}% retention is held and released after the defects liability period of 12 months.

## 5. Safety and compliance
The contractor shall follow site safety rules, provide PPE, and comply with labour laws (including PF, ESI and minimum wages) for its workers.

## 6. Quality
Work shall meet the drawings, specifications and applicable standards. Defective work shall be redone at the contractor's cost.

The contractor accepts this work order by signing it electronically.`,
  },
  {
    key: 'epc_contract', name: 'EPC contract', doc_type: 'EPC_CONTRACT',
    description: 'Engineering, procurement and construction — lump-sum turnkey.',
    fields: [...PARTY.map(f => (f.key === 'company_name' ? { ...f, label: 'Contractor (our company)' } : f.key === 'party_name' ? { ...f, label: 'Employer / owner' } : f)),
      ...DATES,
      { key: 'project_name', label: 'Project', type: 'text', required: true, source: 'project' },
      { key: 'site', label: 'Site', type: 'text', required: true },
      { key: 'scope', label: 'Scope (engineering, procurement, construction, commissioning)', type: 'textarea', required: true },
      { key: 'contract_price', label: 'Contract price (lump sum)', type: 'money', required: true },
      { key: 'completion_months', label: 'Time for completion (months)', type: 'number', required: true },
      { key: 'advance_pct', label: 'Advance %', type: 'number', default: '10' },
      { key: 'pbg_pct', label: 'Performance bank guarantee %', type: 'number', default: '10' },
      { key: 'dlp_months', label: 'Defects liability period (months)', type: 'number', default: '12' },
      { key: 'ld_pct', label: 'Liquidated damages % per week', type: 'number', default: '0.5' },
      { key: 'ld_cap_pct', label: 'LD cap %', type: 'number', default: '10' }, ...LAW],
    body: `# EPC Contract — {{project_name}}

This Engineering, Procurement and Construction Contract is made on {{effective_date}} between {{party_name}}, {{party_address}} (the "Employer") and {{company_name}}, {{company_address}} (the "Contractor").

## 1. Works
The Contractor shall design, engineer, procure, construct, test and commission the works at {{site}} on a lump-sum turnkey basis: {{scope}}

## 2. Contract price
The contract price is {{contract_price}}, exclusive of GST, fixed for the duration of the works except for agreed variations.

## 3. Payment
- Advance of {{advance_pct}}% against an advance bank guarantee of equal value.
- Milestone payments as per the agreed payment schedule, against certified progress.
- Final payment on taking-over and submission of as-built documents.

## 4. Time for completion
The works shall be completed within {{completion_months}} months from the effective date. Delay attributable to the Contractor attracts liquidated damages of {{ld_pct}}% of the contract price per week, capped at {{ld_cap_pct}}%.

## 5. Securities
The Contractor shall furnish a performance bank guarantee of {{pbg_pct}}% of the contract price, valid until the end of the defects liability period.

## 6. Testing and taking-over
Tests on completion and performance tests shall be carried out as per the technical specifications. The Employer issues a taking-over certificate when the works pass them.

## 7. Defects liability
The Contractor shall remedy defects notified within {{dlp_months}} months from taking-over at its own cost.

## 8. Variations
The Employer may instruct variations in writing. Their effect on price and time is agreed before the work is carried out.

## 9. Insurance
The Contractor shall maintain contractor's all-risk, third-party liability and workmen's compensation insurance until taking-over.

## 10. Force majeure, suspension and termination
Neither party is liable for delay caused by force majeure events notified promptly. Either party may terminate for material breach not remedied within 30 days of notice.

## 11. Disputes
Disputes are first referred to senior management for 30 days, then to arbitration under the Arbitration and Conciliation Act, 1996, seated at {{jurisdiction}}. The contract is governed by the laws of India.

Signed electronically by the authorised representatives of the Employer and the Contractor.`,
  },
  {
    key: 'msa', name: 'Master service agreement', doc_type: 'MSA',
    description: 'Umbrella terms; each project then gets its own SOW or work order.',
    fields: [...PARTY, ...DATES,
      { key: 'term_years', label: 'Term (years)', type: 'number', default: '3' },
      { key: 'payment_days', label: 'Payment due (days from invoice)', type: 'number', default: '30' },
      { key: 'liability_cap', label: 'Liability cap', type: 'text', default: 'the fees paid under the relevant SOW in the 12 months before the claim' },
      { key: 'notice_days', label: 'Termination for convenience notice (days)', type: 'number', default: '60' }, ...LAW],
    body: `# Master Service Agreement

This Master Service Agreement ("MSA") is made on {{effective_date}} between {{company_name}}, {{company_address}} ("Supplier") and {{party_name}}, {{party_address}} ("Customer").

## 1. Structure
This MSA sets the terms for all services the Supplier provides to the Customer. Each engagement is described in a statement of work or work order ("SOW") that refers to this MSA. If an SOW conflicts with this MSA, the SOW prevails for that engagement only.

## 2. Term
This MSA runs for {{term_years}} years from the effective date and renews for one-year periods unless either party gives 90 days' notice. SOWs in progress continue under this MSA until they end.

## 3. Fees, invoicing and payment
Fees are set in each SOW. The Supplier invoices as the SOW states; invoices are payable within {{payment_days}} days. Amounts are exclusive of GST, which is charged as applicable. TDS deducted must be supported by a certificate.

## 4. Personnel
Each party appoints a single point of contact. The Supplier remains responsible for its staff and subcontractors, their conduct on the Customer's premises and their compliance with applicable labour laws.

## 5. Confidentiality and data protection
Each party keeps the other's confidential information confidential for the term and five years after. Personal data is processed only for the services, under reasonable security safeguards and in line with the Digital Personal Data Protection Act, 2023.

## 6. Intellectual property
Each party keeps its pre-existing intellectual property. Deliverables created specifically for the Customer are assigned to it on full payment, except the Supplier's tools, platforms and know-how, which are licensed for the Customer's internal use.

## 7. Warranties
The Supplier warrants that services are performed with reasonable skill and care by qualified people. Defective services reported within 30 days are re-performed at no cost.

## 8. Liability
Neither party is liable for indirect or consequential loss or loss of profit. Each party's total liability is limited to {{liability_cap}}, except for breach of confidentiality, IP infringement, fraud or wilful misconduct.

## 9. Termination
Either party may terminate this MSA or an SOW for convenience on {{notice_days}} days' written notice, or immediately for material breach not remedied within 30 days. The Customer pays for services delivered up to termination.

## 10. Governing law
This MSA is governed by the laws of India. The courts at {{jurisdiction}} have exclusive jurisdiction.

Signed electronically by the authorised representatives of both parties.`,
  },
  {
    key: 'amc', name: 'Annual maintenance contract', doc_type: 'AGREEMENT',
    description: 'Yearly support and maintenance with SLA, visits and spares.',
    fields: [...PARTY, ...DATES,
      { key: 'end_date', label: 'Contract end date', type: 'date', required: true },
      { key: 'covered_assets', label: 'Equipment / systems covered (one per line)', type: 'textarea', required: true },
      { key: 'site', label: 'Site(s)', type: 'text', required: true },
      { key: 'visits_per_year', label: 'Preventive visits per year', type: 'number', default: '4' },
      { key: 'response_hours', label: 'Response time for critical faults (hours)', type: 'number', default: '4' },
      { key: 'resolution_hours', label: 'Resolution target for critical faults (hours)', type: 'number', default: '24' },
      { key: 'uptime_pct', label: 'Uptime commitment %', type: 'number', default: '98' },
      { key: 'amc_fee', label: 'Annual fee', type: 'money', required: true },
      { key: 'billing', label: 'Billing', type: 'text', default: 'quarterly in advance' }],
    body: `# Annual Maintenance Contract

This Annual Maintenance Contract ("AMC") is made on {{effective_date}} between {{company_name}}, {{company_address}} ("Service Provider") and {{party_name}}, {{party_address}} ("Customer").

## 1. Period
From {{effective_date}} to {{end_date}}, renewable by mutual agreement.

## 2. Equipment covered
{{covered_assets}}

Located at: {{site}}

## 3. Services
- {{visits_per_year}} preventive maintenance visits per year, with a visit report after each.
- Corrective maintenance for faults reported through the helpdesk, phone or email.
- Firmware and software updates released for the covered equipment.
- Remote monitoring and health reports where the equipment is connected.

## 4. Service levels
| Priority | Response | Resolution |
| Critical (system down) | {{response_hours}} hours | {{resolution_hours}} hours |
| High (partly working) | 8 hours | 48 hours |
| Low (query / minor) | 1 business day | 5 business days |

Uptime commitment: {{uptime_pct}}% per quarter, excluding planned maintenance, power or network failures at site, and misuse.

## 5. Spares
Consumables and parts damaged by misuse, power surges or tampering are charged at list price. Other spare parts are covered.

## 6. Fees
Annual fee {{amc_fee}} plus GST, billed {{billing}}. Visits outside the scope are charged at the agreed per-visit rate.

## 7. Customer responsibilities
Safe access to the site, a single point of contact, stable power and network, and no repairs by third parties during the AMC.

## 8. Exclusions
Relocation, civil or electrical works, damage from fire, flood or accidents, and equipment not listed above.

Signed electronically by both parties.`,
  },
  {
    key: 'amendment', name: 'Amendment', doc_type: 'AMENDMENT',
    description: 'Change an agreement already signed (scope, value, dates).',
    fields: [...PARTY, ...DATES,
      { key: 'amendment_no', label: 'Amendment number', type: 'text', default: '1' },
      { key: 'original_agreement', label: 'Original agreement (name, number, date)', type: 'text', required: true },
      { key: 'changes', label: 'Changes (one clause per line)', type: 'textarea', required: true },
      { key: 'reason', label: 'Reason for the change', type: 'textarea' }],
    body: `# Amendment No. {{amendment_no}}

This Amendment is made on {{effective_date}} between {{company_name}}, {{company_address}} and {{party_name}}, {{party_address}}, and amends {{original_agreement}} (the "Agreement").

## 1. Background
{{reason}}

## 2. Changes
With effect from {{effective_date}}, the Agreement is amended as follows:
{{changes}}

## 3. Everything else unchanged
All other terms of the Agreement remain in full force. If this Amendment conflicts with the Agreement, this Amendment prevails. Terms defined in the Agreement have the same meaning here.

Signed electronically by both parties.`,
  },
  {
    key: 'blank', name: 'Blank document', doc_type: 'AGREEMENT',
    description: 'Start from empty text and write your own.',
    fields: [{ key: 'title', label: 'Heading', type: 'text', default: 'Agreement' }, { key: 'text', label: 'Text', type: 'textarea' }],
    body: `# {{title}}

{{text}}`,
  },
]

/* ── placeholders ── */
const PH = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi
const DERIVED = new Set(['items_table', 'items_subtotal', 'items_gst', 'items_total'])
export function placeholders(body) {
  const out = []
  for (const m of String(body || '').matchAll(PH)) if (!out.includes(m[1])) out.push(m[1])
  return out
}
const humanize = k => k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
// Field list for a custom template: its declared fields, plus any placeholder
// that has none (type guessed from the name).
export function fieldsFor(tpl) {
  const declared = Array.isArray(tpl?.fields) ? tpl.fields : []
  const have = new Set(declared.map(f => f.key))
  const extra = placeholders(tpl?.body).filter(k => !have.has(k) && !DERIVED.has(k)).map(k => ({
    key: k, label: humanize(k),
    type: /date$/.test(k) ? 'date' : /(amount|price|fees|value)$/.test(k) ? 'money' : /(_pct|_days|_months|_years|rate)$/.test(k) ? 'number' : 'text',
  }))
  const needsItems = placeholders(tpl?.body).some(k => DERIVED.has(k)) && !have.has('items')
  return [...declared, ...extra, ...(needsItems ? [{ key: 'items', label: 'Line items', type: 'items' }] : [])]
}

export function itemsSummary(items, gstRate) {
  const rows = (Array.isArray(items) ? items : []).filter(r => r && (r.description || r.qty || r.rate))
  const lines = rows.map(r => {
    const qty = Number(r.qty) || 0, rate = Number(r.rate) || 0
    return { description: String(r.description || ''), qty, unit: String(r.unit || ''), rate, amount: Math.round(qty * rate * 100) / 100 }
  })
  const subtotal = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100
  const gst = Math.round(subtotal * (Number(gstRate) || 0)) / 100
  return { lines, subtotal, gst, total: Math.round((subtotal + gst) * 100) / 100 }
}

// Replace placeholders. Missing values stay visible as [Label] so a reviewer
// can spot them; `missing` lists the required fields still empty.
export function fillTemplate(tpl, values = {}, currency = 'INR') {
  const fields = fieldsFor(tpl)
  const byKey = Object.fromEntries(fields.map(f => [f.key, f]))
  const sum = itemsSummary(values.items, values.gst_rate)
  const derived = {
    items_table: sum.lines.length
      ? ['| # | Description | Qty | Unit | Rate | Amount |',
         ...sum.lines.map((l, i) => `| ${i + 1} | ${l.description.replace(/\|/g, '/')} | ${l.qty} | ${l.unit} | ${fmtMoney(l.rate, currency)} | ${fmtMoney(l.amount, currency)} |`)].join('\n')
      : '[Line items]',
    items_subtotal: fmtMoney(sum.subtotal, currency), items_gst: fmtMoney(sum.gst, currency), items_total: fmtMoney(sum.total, currency),
  }
  const missing = fields.filter(f => f.required && f.type !== 'items' && !String(values[f.key] ?? '').trim()).map(f => f.key)
  const text = String(tpl?.body || '').replace(PH, (_, k) => {
    if (k in derived) return derived[k]
    const f = byKey[k], v = values[k]
    if (v == null || String(v).trim() === '') return `[${f?.label || humanize(k)}]`
    if (f?.type === 'date') return fmtDate(v)
    if (f?.type === 'money') return fmtMoney(v, currency)
    return String(v).trim()
  })
  return { text, missing, totals: sum }
}

export function defaultValues(tpl, ctx = {}) {
  const v = {}
  for (const f of fieldsFor(tpl)) {
    if (f.source === 'org' && ctx.orgName) v[f.key] = ctx.orgName
    else if (f.source === 'counterparty' && ctx.counterpartyName) v[f.key] = ctx.counterpartyName
    else if (f.source === 'counterparty_address' && ctx.counterpartyAddress) v[f.key] = ctx.counterpartyAddress
    else if (f.source === 'project' && ctx.projectName) v[f.key] = ctx.projectName
    else if (f.default != null) v[f.key] = f.default
    else if (f.type === 'items') v[f.key] = [{ description: '', qty: 1, unit: 'Nos', rate: '' }]
  }
  return v
}

/* ── body → blocks (HTML preview + PDF) ── */
export function parseBody(text) {
  const blocks = []
  let para = [], table = null
  const flushPara = () => { if (para.length) { blocks.push({ kind: 'p', text: para.join('\n') }); para = [] } }
  const flushTable = () => { if (table) { blocks.push({ kind: 'table', head: table[0], rows: table.slice(1) }); table = null } }
  for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushPara()
      const cells = line.trim().slice(1, -1).split('|').map(c => c.trim())
      if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue          // markdown separator row
      ;(table ||= []).push(cells)
      continue
    }
    flushTable()
    if (!line.trim()) { flushPara(); continue }
    let m
    if ((m = /^#\s+(.*)$/.exec(line))) { flushPara(); blocks.push({ kind: 'h1', text: m[1] }) }
    else if ((m = /^##+\s+(.*)$/.exec(line))) { flushPara(); blocks.push({ kind: 'h2', text: m[1] }) }
    else if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) { flushPara(); blocks.push({ kind: 'li', text: m[1] }) }
    else para.push(line.trim())
  }
  flushPara(); flushTable()
  return blocks
}

// Signing order check, mirrors _esign_is_turn() in STEP273.
export function isTurn(signers, signer, order = 'SEQUENTIAL') {
  if (order === 'PARALLEL') return true
  return !signers.some(o => o.id !== signer.id && o.seq < signer.seq && o.status !== 'SIGNED')
}

export function validateSigners(signers) {
  const errs = []
  if (!signers.length) errs.push('Add at least one signer')
  const seen = new Set()
  signers.forEach((s, i) => {
    if (!String(s.name || '').trim()) errs.push(`Signer ${i + 1}: name is missing`)
    const e = String(s.email || '').trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) errs.push(`Signer ${i + 1}: email is not valid`)
    else if (seen.has(e)) errs.push(`${e} is listed twice`)
    seen.add(e)
  })
  return errs
}
