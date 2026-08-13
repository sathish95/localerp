import { generateStructured } from './llm'

// AI-assisted product drafting. Only ever pre-fills ProductsPage.jsx's
// existing create/edit form — the actual INSERT is the same
// supabase.from('products').insert(...) call a human typing the form by
// hand already goes through (ProductsPage.jsx's handleSubmit), so a bad
// AI suggestion is a form field to fix, not a silent bad write.
const SYSTEM_PROMPT = `You are a product-catalog assistant embedded in an ERP application for IoT/hardware products.
Given a short description of a new product, draft its catalog entry.

Rules:
- device_type MUST be exactly one of the values in the provided list — pick the closest match, never invent a new one.
- part_number is a short, human-readable suggestion (uppercase, hyphenated, e.g. "GPS-TRK-4G-01") — the user can still edit or clear it.
- standard_cost is a rough estimate in Indian Rupees (INR), a plain number, no currency symbol.
- warranty_months, reorder_level, reorder_qty are plain integers/numbers, reasonable defaults if not specified.
- Return ONLY a JSON object, no other text, matching this exact shape:
{
  "part_number": "SUGGESTED-PART-NO",
  "name": "Product name",
  "device_type": "one of the provided device types",
  "spec_sheet": "1-3 sentence free-text spec summary",
  "warranty_months": 12,
  "reorder_level": 5,
  "reorder_qty": 10,
  "standard_cost": 2500
}`

export async function generateProductDraft({ prompt, deviceTypes, modelId, ollamaModel, userId }) {
  const userPrompt = `Product description: ${prompt}

Allowed device_type values: ${deviceTypes.join(', ')}`
  const result = await generateStructured(SYSTEM_PROMPT, userPrompt, modelId, ollamaModel, userId, 'product_ai')

  return {
    part_number: (result.part_number || '').toString().trim().slice(0, 40),
    name: (result.name || '').toString().trim(),
    device_type: deviceTypes.includes(result.device_type) ? result.device_type : deviceTypes[0],
    spec_sheet: (result.spec_sheet || '').toString().trim(),
    warranty_months: Number(result.warranty_months) > 0 ? Number(result.warranty_months) : 12,
    reorder_level: Number(result.reorder_level) >= 0 ? Number(result.reorder_level) : 0,
    reorder_qty: Number(result.reorder_qty) >= 0 ? Number(result.reorder_qty) : 0,
    standard_cost: Number(result.standard_cost) >= 0 ? Number(result.standard_cost) : 0,
  }
}
