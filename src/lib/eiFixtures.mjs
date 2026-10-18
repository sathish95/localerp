// Shared fixtures for the Email Intelligence document tests (not a test file).
export const CONFIG = {
  settings: { attachments: { max_mb: 15, max_count: 15, allowed_ext: ['pdf'] } },
  categories: [{ code: 'OTHER', name: 'Other', workflow_key: 'RECORD_ONLY', is_active: true }],
  document_types: [
    { code: 'WORK_ORDER', name: 'Work Order', fields: [], confidence_threshold: 0.5, destination: 'NONE', is_active: true },
    { code: 'UNKNOWN_DOCUMENT', name: 'Unknown', fields: [], confidence_threshold: 0.75, destination: 'NONE', is_active: true },
  ],
  rules: [{ id: 'r1', name: 'work order', target: 'DOCUMENT', document_type_code: 'WORK_ORDER', terms: ['work order'], match_mode: 'PHRASE', locations: ['ATTACHMENT_TEXT'], weight: 80, action: 'CLASSIFY', is_active: true }],
  vendor_aliases: [],
}
export function docDeps(files, ctx) {
  const st = { updates: {} }
  return { st, d: {
    documentRegister: true,
    attachments: {
      list: async () => files.map(f => ({ id: f.id, name: f.name, contentType: 'application/pdf', size: 10, kind: 'file' })),
      fetchBytes: async a => new TextEncoder().encode(files.find(f => f.id === a.id).text),
    },
    storage: { put: async () => {} },
    text: { extract: async b => ({ text: new TextDecoder().decode(b), method: 'PDF_TEXT' }) },
    sha256: async b => `sha-${new TextDecoder().decode(b)}`,
    lookup: { vendors: async () => [], contacts: async () => [], attachmentsBySha: async () => [], projectContext: async () => ctx, conversationProjects: async () => [] },
    db: { upsertAttachment: async (row, rec) => ({ id: `att-${rec.graph_attachment_id}`, ...rec }), updateAttachment: async (id, p) => { st.updates[id] = p }, raiseException: async () => 'x' },
  } }
}
export const CTX = { projects: [{ id: 'p1', code: 'PRJ-101', name: 'Metro Depot', status: 'active' }, { id: 'p2', code: 'PRJ-202', name: 'Solar Park', status: 'active' }], customers: [], contacts: [] }
