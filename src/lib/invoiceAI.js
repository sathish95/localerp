import { generateStructured } from './llm'

// AI-assisted invoice drafting for both Customer Invoices and vendor
// Invoice Management. Same posture as bomAI.js/productAI.js: the human
// always picks the required foreign key first (project for a customer
// invoice, vendor for a vendor invoice) — the AI never chooses who's
// being billed or who's billing you, only drafts the amounts/dates/notes
// from a plain-language description. The draft only ever pre-fills the
// page's existing create/edit form; saving still goes through that page's
// own handleSubmit, unchanged.
const CUSTOMER_SYSTEM_PROMPT = `You are a billing assistant embedded in an ERP application. Draft a customer invoice
from a short billing description.

Rules:
- subtotal and gst_amount are plain numbers in Indian Rupees (INR), no currency symbol.
- If the description doesn't specify a GST rate, assume 18% GST on the subtotal.
- If the description gives a total inclusive of GST instead of a subtotal, back-calculate the subtotal.
- Resolve relative dates (e.g. "due in 30 days", "net 15") using the given today's date.
- Return ONLY a JSON object, no other text, matching this exact shape:
{
  "subtotal": 45000,
  "gst_amount": 8100,
  "total_amount": 53100,
  "invoice_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD or empty string if not specified",
  "notes": "one-line description of what's being billed"
}`

const VENDOR_SYSTEM_PROMPT = `You are an accounts-payable assistant embedded in an ERP application. Draft a vendor
invoice record from a short description of what's being billed.

Rules:
- subtotal and gst_amount are plain numbers in Indian Rupees (INR), no currency symbol.
- If the description doesn't specify a GST rate, assume 18% GST on the subtotal.
- If the description gives a total inclusive of GST instead of a subtotal, back-calculate the subtotal.
- Resolve relative dates (e.g. "due in 30 days", "net 15") using the given today's date.
- Return ONLY a JSON object, no other text, matching this exact shape:
{
  "subtotal": 45000,
  "gst_amount": 8100,
  "total_amount": 53100,
  "invoice_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD or empty string if not specified",
  "notes": "one-line description of what's being billed"
}`

function normalizeDraft(result, today) {
  const subtotal = Number(result.subtotal) || 0
  const gst = Number(result.gst_amount) || 0
  return {
    subtotal,
    gst_amount: gst,
    total_amount: Number(result.total_amount) || (subtotal + gst),
    invoice_date: /^\d{4}-\d{2}-\d{2}$/.test(result.invoice_date) ? result.invoice_date : today,
    due_date: /^\d{4}-\d{2}-\d{2}$/.test(result.due_date) ? result.due_date : '',
    notes: (result.notes || '').toString().trim(),
  }
}

export async function generateCustomerInvoiceDraft({ prompt, modelId, ollamaModel, userId }) {
  const today = new Date().toISOString().slice(0, 10)
  const userPrompt = `Today's date is ${today}. Billing description: ${prompt}`
  const result = await generateStructured(CUSTOMER_SYSTEM_PROMPT, userPrompt, modelId, ollamaModel, userId, 'customer_invoice_ai', 500)
  return normalizeDraft(result, today)
}

export async function generateVendorInvoiceDraft({ prompt, modelId, ollamaModel, userId }) {
  const today = new Date().toISOString().slice(0, 10)
  const userPrompt = `Today's date is ${today}. Billing description: ${prompt}`
  const result = await generateStructured(VENDOR_SYSTEM_PROMPT, userPrompt, modelId, ollamaModel, userId, 'vendor_invoice_ai', 500)
  return normalizeDraft(result, today)
}
