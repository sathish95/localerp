import { generateStructured } from './llm'

// AI-assisted BOM drafting. The model is given the real product/component
// catalog and instructed to select ONLY from it — component_part_number is
// a soft reference with no FK (STEP52), so this is the one place data
// integrity actually depends on the model behaving, not the database. A
// part the model can't match against the catalog goes into
// suggested_new_parts instead of components — never inserted into the
// draft. The draft is never saved directly: BomManagementPage.jsx loads it
// into the same editable draft table + "Save as New Version" flow a human
// editing the BOM by hand already goes through, so a bad AI suggestion is
// just an extra row to delete, not a silent bad write.
const SYSTEM_PROMPT = `You are a Bill-of-Materials (BOM) engineering assistant embedded in an ERP application.
Given a product description and a catalog of existing parts (with part numbers), decide which existing parts
should be used as components of the described product, and in what quantity.

Rules:
- ONLY use part_number values that appear in the provided catalog. Never invent a part number.
- If the product needs a part that isn't in the catalog, list it in suggested_new_parts (name + short description)
  instead of components — do not fabricate a part number for it.
- Quantities are the number of units of that component needed per one unit of the parent product.
- Return ONLY a JSON object, no other text, matching this exact shape:
{
  "components": [ { "part_number": "existing catalog part number", "quantity": 1, "notes": "short reason, optional" } ],
  "suggested_new_parts": [ { "name": "part name", "description": "why it's needed" } ]
}`

export async function generateBomDraft({ productName, partNumber, prompt, catalog, modelId, ollamaModel, userId }) {
  const catalogLines = catalog
    .filter(p => p.part_number !== partNumber)
    .slice(0, 300) // keep the prompt bounded for large catalogs
    .map(p => `${p.part_number} | ${p.name}${p.device_type ? ` | ${p.device_type}` : ''}`)
    .join('\n')

  const userPrompt = `Parent product: "${productName}" (${partNumber})
Requirement: ${prompt}

Existing parts catalog (part_number | name | type):
${catalogLines || '(catalog is empty)'}
`
  const result = await generateStructured(SYSTEM_PROMPT, userPrompt, modelId, ollamaModel, userId, 'bom_ai')
  const catalogByPart = Object.fromEntries(catalog.map(p => [p.part_number, p]))
  const components = (Array.isArray(result.components) ? result.components : [])
    .filter(c => c.part_number && catalogByPart[c.part_number])
    .map(c => ({
      component_part_number: c.part_number,
      name: catalogByPart[c.part_number].name,
      quantity: Number(c.quantity) > 0 ? Number(c.quantity) : 1,
      notes: c.notes || '',
    }))
  const suggestedNewParts = (Array.isArray(result.suggested_new_parts) ? result.suggested_new_parts : [])
    .filter(p => p.name)
    .map(p => ({ name: p.name, description: p.description || '' }))

  return { components, suggestedNewParts }
}
