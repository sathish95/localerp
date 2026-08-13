import { generateStructured } from './llm'

// AI-assisted delivery note drafting. Unlike BOM AI (which must only ever
// select from the real catalog — component_part_number backs a real
// inventory/cost rollup), a delivery note item is allowed to be a
// freeform description with no catalog entry at all (STEP111's own
// header: "third-party pass-through goods") — so this prompts the model
// to match against the catalog where it can, but doesn't reject or
// side-channel items it can't match the way bomAI.js does. The draft
// only ever pre-fills DeliveryNotesPage.jsx's existing create form;
// saving still goes through that page's own createDeliveryNote(), unchanged.
const SYSTEM_PROMPT = `You are a logistics assistant embedded in an ERP application. Draft a delivery note (outbound
shipment record) from a short description, given today's date and an optional catalog of existing parts.

Rules:
- items: what's being shipped, each with a description and quantity. If an item clearly matches a catalog part_number,
  include it; otherwise leave part_number empty and just give a clear description — freeform items are completely
  valid here, this is not restricted to catalog parts.
- unit defaults to "pcs" unless the description implies otherwise (e.g. kg, boxes, meters, units).
- Resolve relative dates (e.g. "ship next Monday", "dispatch in 3 days") using the given today's date.
- carrier, tracking_number and delivery_address are optional — only fill them in if mentioned in the description.
- Return ONLY a JSON object, no other text, matching this exact shape:
{
  "items": [ { "part_number": "existing catalog part number or empty string", "description": "what it is", "quantity": 1, "unit": "pcs" } ],
  "delivery_date": "YYYY-MM-DD or empty string",
  "carrier": "carrier name or empty string",
  "tracking_number": "or empty string",
  "delivery_address": "or empty string",
  "notes": "short summary, optional"
}`

export async function generateDeliveryNoteDraft({ prompt, catalog, modelId, ollamaModel, userId }) {
  const today = new Date().toISOString().slice(0, 10)
  const catalogLines = (catalog || [])
    .slice(0, 300)
    .map(p => `${p.part_number} | ${p.name}`)
    .join('\n')
  const userPrompt = `Today's date is ${today}. Shipment description: ${prompt}

Existing parts catalog (part_number | name), optional — match items to these where it clearly fits:
${catalogLines || '(catalog is empty)'}
`
  const result = await generateStructured(SYSTEM_PROMPT, userPrompt, modelId, ollamaModel, userId, 'delivery_note_ai', 900)
  const catalogByPart = Object.fromEntries((catalog || []).map(p => [p.part_number, p]))

  const items = (Array.isArray(result.items) ? result.items : [])
    .filter(it => (it.description || '').toString().trim())
    .map(it => ({
      part_number: it.part_number && catalogByPart[it.part_number] ? it.part_number : '',
      description: (it.description || '').toString().trim(),
      quantity: Number(it.quantity) > 0 ? Number(it.quantity) : 1,
      unit: (it.unit || 'pcs').toString().trim() || 'pcs',
      notes: '',
    }))

  return {
    items,
    delivery_date: /^\d{4}-\d{2}-\d{2}$/.test(result.delivery_date) ? result.delivery_date : '',
    carrier: (result.carrier || '').toString().trim(),
    tracking_number: (result.tracking_number || '').toString().trim(),
    delivery_address: (result.delivery_address || '').toString().trim(),
    notes: (result.notes || '').toString().trim(),
  }
}
