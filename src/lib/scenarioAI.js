import { generateStructured } from './llm'

// AI-assisted scenario drafting — same "propose, human confirms" contract
// as bomAI.js/productAI.js: this never saves anything itself. The caller
// (ScenarioAiTab in AIActionTabs.jsx) loads the draft into AIChatFlow's
// review step, and only createScenario()/updateVersion()/upsertVariable()
// (the same functions ScenarioBuilderPage's own wizard calls) run on
// Confirm — a bad AI suggestion is just a field to edit or delete before
// confirming, never a silent write.
const CATEGORIES = ['general', 'expansion', 'cost-reduction', 'hiring', 'product-launch', 'restructuring']
const DATA_TYPES = ['number', 'percent', 'currency', 'text', 'boolean', 'date']

const SYSTEM_PROMPT = `You are a business scenario planning assistant embedded in an ERP application's what-if Scenario Builder.
Given a plain-English description of a business situation to model, draft the initial scenario fields.

Return ONLY a JSON object, no other text, matching this exact shape:
{
  "name": "short scenario name, 5-8 words",
  "objective": "1-2 sentence objective describing what decision this scenario should inform",
  "category": "one of: general, expansion, cost-reduction, hiring, product-launch, restructuring",
  "background": "1-3 sentence background/context for why this is being explored now",
  "stakeholders": "comma-separated list of likely stakeholders",
  "risks": "1-3 sentence summary of key risks or assumptions that could make this scenario wrong",
  "variables": [
    { "key": "snake_case_key", "label": "Human-readable label", "data_type": "number|percent|currency|text|boolean|date", "value": "a reasonable starting value" }
  ]
}

Rules:
- category must be exactly one of the six listed values.
- Suggest 2-5 variables relevant to the described situation. Include a variable with key "expected_revenue" (data_type "currency") whenever the scenario has a revenue angle — the simulation engine specifically looks for that key.
- Starting variable values should be round, clearly-placeholder numbers the user is expected to review and adjust — never invent a specific real financial figure that wasn't given to you.
- variable keys must be snake_case, no spaces.`

export async function generateScenarioDraft({ description, modelId, ollamaModel, userId }) {
  const userPrompt = `Business situation to model as a what-if scenario:\n${description}`
  const result = await generateStructured(SYSTEM_PROMPT, userPrompt, modelId, ollamaModel, userId, 'scenario_ai')

  return {
    name: (result.name || '').slice(0, 120),
    objective: result.objective || '',
    category: CATEGORIES.includes(result.category) ? result.category : 'general',
    background: result.background || '',
    stakeholders: result.stakeholders || '',
    risks: result.risks || '',
    variables: (Array.isArray(result.variables) ? result.variables : [])
      .filter(v => v?.key && v?.label)
      .slice(0, 8)
      .map(v => ({
        key: String(v.key).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        label: String(v.label).trim(),
        data_type: DATA_TYPES.includes(v.data_type) ? v.data_type : 'number',
        value: v.value != null ? String(v.value) : '0',
      })),
  }
}
