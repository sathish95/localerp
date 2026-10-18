// Project matching + decision rules for the Outlook email → task module (STEP261).
//
// Everything here works on the org's real records (projects, customers,
// contacts, profiles, earlier processed emails) passed in by the caller —
// a project is never created and never guessed: anything that isn't a
// single, open, confidently identified project goes to the review queue.
//
// Order: explicit project code → same email conversation → project name →
// sender's customer (contacts / customers email, then company domain).
//
// Import-free plain JS: used by the outlook-sync Edge Function and node --test.

export const PUBLIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'rediffmail.com', 'zohomail.com', 'zohomail.in', 'gmx.com',
  'yandex.com', 'mail.com',
])

export const projectOpen = status => ['active', 'planning', 'in_progress'].includes(String(status || 'active').toLowerCase())

export const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim()

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const domainOf = email => String(email || '').toLowerCase().split('@')[1] || ''
const brief = p => ({ id: p.id, code: p.code || null, name: p.name || null })

function codeInText(code, text) {
  const c = String(code || '').trim()
  if (c.length < 3) return false
  return new RegExp(`(^|[^A-Za-z0-9])${escapeRe(c)}([^A-Za-z0-9]|$)`, 'i').test(text)
}

// Whole-phrase match on normalized text ("Quarry IoT" ⊂ "the quarry iot dashboard").
function phraseInText(phrase, ntext) {
  const p = norm(phrase)
  if (p.length < 4) return false
  return ` ${ntext} `.includes(` ${p} `)
}

// Sender → customer: exact address in contacts / customers, else a unique
// customer on the same company domain (never for gmail.com & co).
export function resolveCustomer(senderEmail, { customers = [], contacts = [] } = {}) {
  const email = String(senderEmail || '').toLowerCase()
  if (!email) return { customer: null, method: null }
  const active = customers.filter(c => String(c.status || 'active') !== 'inactive')
  const byId = new Map(active.map(c => [c.id, c]))
  const direct = new Set([
    ...contacts.filter(c => c.customer_id && String(c.email || '').toLowerCase() === email && String(c.status || 'active') !== 'inactive').map(c => c.customer_id),
    ...active.filter(c => String(c.email || '').toLowerCase() === email).map(c => c.id),
  ].filter(id => byId.has(id)))
  if (direct.size === 1) return { customer: byId.get([...direct][0]), method: 'EMAIL' }
  if (direct.size > 1) return { customer: null, method: null, ambiguous: [...direct].map(id => byId.get(id)) }
  const dom = domainOf(email)
  if (!dom || PUBLIC_DOMAINS.has(dom)) return { customer: null, method: null }
  const byDomain = new Set([
    ...contacts.filter(c => c.customer_id && domainOf(c.email) === dom).map(c => c.customer_id),
    ...active.filter(c => domainOf(c.email) === dom).map(c => c.id),
  ].filter(id => byId.has(id)))
  if (byDomain.size === 1) return { customer: byId.get([...byDomain][0]), method: 'DOMAIN' }
  return { customer: null, method: null, ambiguous: byDomain.size > 1 ? [...byDomain].map(id => byId.get(id)) : undefined }
}

const belongsTo = (p, cust) => !!cust && (p.customer_id === cust.id || (!p.customer_id && p.client_name && norm(p.client_name) === norm(cust.name)))
const hasCustomer = p => !!(p.customer_id || p.client_name)

// → { status: MATCHED|AMBIGUOUS|UNMATCHED, project, customer, method, confidence, candidates, reason }
export function matchProject({ email, classification = {}, projects = [], customers = [], contacts = [], history = [] }) {
  const text = `${email.subject || ''}\n${email.body || ''}`
  const ntext = norm(text)
  const ref = classification.project_reference || ''
  const open = projects.filter(p => projectOpen(p.status))
  const { customer, method: custMethod, ambiguous: custAmbiguous } = resolveCustomer(email.senderEmail, { customers, contacts })
  const out = (status, extra) => ({ status, project: null, customer: customer || null, method: null, confidence: 0, candidates: [], reason: '', ...extra })
  const matched = (project, method, confidence, reason) => out('MATCHED', { project, method, confidence, reason, candidates: [brief(project)] })

  // 1. explicit project code
  const codeHits = projects.filter(p => codeInText(p.code, text) || (ref && norm(ref) === norm(p.code)))
  if (codeHits.length) {
    const openHits = codeHits.filter(p => projectOpen(p.status))
    if (!openHits.length) {
      return out('UNMATCHED', { candidates: codeHits.map(brief), reason: `Project ${codeHits.map(p => p.code).join(', ')} is not active` })
    }
    let pool = openHits
    if (pool.length > 1 && customer) pool = pool.filter(p => belongsTo(p, customer))
    if (pool.length === 1) {
      const p = pool[0]
      // A sender may only raise work on their own customer's project.
      if (customer && hasCustomer(p) && !belongsTo(p, customer)) {
        return out('AMBIGUOUS', { candidates: [brief(p)], reason: `Project ${p.code} belongs to a different customer than the sender (${customer.name})` })
      }
      return matched(p, 'CODE', openHits.length === 1 ? 0.97 : 0.9, `Project code ${p.code} in the email`)
    }
    return out('AMBIGUOUS', { candidates: openHits.slice(0, 10).map(brief), reason: `Several project codes in the email: ${openHits.map(p => p.code).join(', ')}` })
  }

  // 2. earlier email in the same conversation that was already linked
  if (email.conversationId) {
    const ids = [...new Set(history.filter(h => h.conversation_id === email.conversationId && h.matched_project_id).map(h => h.matched_project_id))]
    const hits = open.filter(p => ids.includes(p.id))
    if (hits.length === 1 && !(customer && hasCustomer(hits[0]) && !belongsTo(hits[0], customer))) {
      return matched(hits[0], 'CONVERSATION', 0.93, 'Same email conversation as an earlier linked email')
    }
  }

  // 3. project name (in the text, or the classifier's quoted reference)
  let nameHits = open.filter(p => phraseInText(p.name, ntext) || (norm(ref).length >= 4 && (norm(ref) === norm(p.name) || phraseInText(ref, norm(p.name)) || phraseInText(p.name, norm(ref)))))
  // "Quarry IoT Phase 2" beats "Quarry IoT" when both appear
  nameHits = nameHits.filter(p => !nameHits.some(q => q !== p && norm(q.name).length > norm(p.name).length && ` ${norm(q.name)} `.includes(` ${norm(p.name)} `) && phraseInText(q.name, ntext)))
  if (nameHits.length) {
    const own = customer ? nameHits.filter(p => belongsTo(p, customer)) : []
    if (own.length === 1) return matched(own[0], 'NAME', 0.9, `Project name "${own[0].name}" and the sender's customer`)
    const foreign = customer ? nameHits.filter(p => hasCustomer(p) && !belongsTo(p, customer)) : []
    const pool = customer ? nameHits.filter(p => !foreign.includes(p)) : nameHits
    if (pool.length === 1) return matched(pool[0], 'NAME', 0.85, `Project name "${pool[0].name}" in the email`)
    return out('AMBIGUOUS', { candidates: nameHits.slice(0, 10).map(brief), reason: pool.length ? 'Several project names match' : 'The named project belongs to a different customer than the sender' })
  }

  // 4. the sender's customer
  if (customer) {
    const own = open.filter(p => belongsTo(p, customer))
    if (own.length === 1) {
      return matched(own[0], 'CUSTOMER', custMethod === 'EMAIL' ? 0.8 : 0.7, `Only active project of customer ${customer.name} (${custMethod === 'EMAIL' ? 'known contact' : 'company domain'})`)
    }
    if (own.length > 1) return out('AMBIGUOUS', { candidates: own.slice(0, 10).map(brief), reason: `Customer ${customer.name} has ${own.length} active projects` })
    return out('UNMATCHED', { reason: `Customer ${customer.name} has no active project` })
  }
  if (custAmbiguous?.length) return out('UNMATCHED', { reason: `Sender matches several customers: ${custAmbiguous.map(c => c.name).join(', ')}` })
  return out('UNMATCHED', { reason: 'No project code, project name or known customer found' })
}

// Active profile by exact email or exact full name — else null. Never guesses.
export function resolvePerson(ref, profiles = []) {
  const r = String(ref || '').trim().toLowerCase()
  if (!r) return null
  const active = profiles.filter(p => p.is_active !== false)
  const email = r.match(/[^\s<>()]+@[^\s<>()]+/)?.[0]
  const hits = email
    ? active.filter(p => String(p.email || '').toLowerCase() === email)
    : active.filter(p => norm(p.full_name) && norm(p.full_name) === norm(r))
  return hits.length === 1 ? hits[0] : null
}

export function pickAssignee({ mailbox, project, classification = {}, profiles = [] }) {
  const ok = id => (id && profiles.some(p => p.id === id && p.is_active !== false) ? id : null)
  switch (mailbox.assign_mode) {
    case 'NONE': return null
    case 'FIXED': return ok(mailbox.default_assignee_id)
    case 'SUGGESTED': return resolvePerson(classification.suggested_assignee, profiles)?.id || ok(project?.manager_id) || ok(mailbox.default_assignee_id)
    default: return ok(project?.manager_id) || ok(mailbox.default_assignee_id)
  }
}

// → { action: CREATE | REVIEW | IGNORE, reason }
export function decide({ classification, match, mailbox, injection = [] }) {
  const min = Number(mailbox.min_confidence ?? 0.75)
  const cats = mailbox.categories || []
  if (!classification.requires_action) return { action: 'IGNORE', reason: classification.reason || 'No action needed' }
  if (cats.length && !cats.includes(classification.category)) {
    return { action: 'IGNORE', reason: `Category "${classification.category}" is not set to create action items` }
  }
  if (classification.injection_suspected || injection.length) {
    return { action: 'REVIEW', reason: 'The email contains instructions aimed at the automation — check it by hand' }
  }
  if (match.status !== 'MATCHED') return { action: 'REVIEW', reason: match.reason || 'Project not identified' }
  if (classification.confidence < min) {
    return { action: 'REVIEW', reason: `Classification confidence ${Math.round(classification.confidence * 100)}% is below ${Math.round(min * 100)}%` }
  }
  if (match.confidence < min) {
    return { action: 'REVIEW', reason: `Project match confidence ${Math.round(match.confidence * 100)}% is below ${Math.round(min * 100)}% (${match.reason})` }
  }
  if (!mailbox.auto_create) return { action: 'REVIEW', reason: 'Automatic creation is off — approve in the review queue' }
  return { action: 'CREATE', reason: `${match.reason}; ${classification.reason}`.slice(0, 500) }
}

export function dueDateFor({ classification, mailbox, receivedAt }) {
  if (classification.due_date) return classification.due_date
  if (mailbox.default_due_days == null) return null
  const base = Date.parse(receivedAt || '') || Date.now()
  return new Date(base + Number(mailbox.default_due_days) * 86400000).toISOString().slice(0, 10)
}

export function taskDescription({ email, classification }) {
  const lines = [
    classification.description || '',
    '',
    '— From a customer email (Outlook) —',
    `From: ${email.senderName ? `${email.senderName} <${email.senderEmail}>` : email.senderEmail}`,
    `Subject: ${email.subject || '(no subject)'}`,
    email.receivedAt ? `Received: ${new Date(email.receivedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC` : null,
    email.webLink ? `Open in Outlook: ${email.webLink}` : null,
  ]
  return lines.filter(l => l !== null).join('\n').trim().slice(0, 6000)
}
