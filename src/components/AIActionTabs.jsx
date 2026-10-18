import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, rupee, nextNum } from '../lib/supabase'
import { generateBomDraft } from '../lib/bomAI'
import { saveNewBomVersion } from '../lib/bom'
import { generateProductDraft } from '../lib/productAI'
import { generateCustomerInvoiceDraft, generateVendorInvoiceDraft } from '../lib/invoiceAI'
import { generateDeliveryNoteDraft } from '../lib/deliveryNoteAI'
import { createDeliveryNote } from '../lib/deliveryNotes'
import { parseTaskCommand, matchTasks, matchMember, TASK_STATUSES } from '../lib/workflowAI'
import { generateScenarioDraft } from '../lib/scenarioAI'
import { createScenario, updateScenario, updateVersion, upsertVariable } from '../lib/scenarios'
import { DEVICE_TYPES } from '../config/deviceTypes'
import { ArrowRight, Trash2 } from 'lucide-react'
import AIChatFlow from './AIChatFlow'

// Tab content for the AI capability tabs inside AskBubble.jsx (the app's
// one global floating chat bubble — see Layout.jsx). Nothing here is
// simulated: BOM AI, Product Catalog AI, Task Actions and the invoice/
// delivery-note AI capabilities call the exact same lib functions
// (src/lib/{bomAI,productAI,invoiceAI,deliveryNoteAI,workflowAI,bom,
// deliveryNotes}.js) the dedicated pages use, and can save for real —
// gated by the same role checks those pages already enforce (duplicated
// here as plain constants since this popover isn't scoped to any one
// page's component tree).
//
// Each capability is built on AIChatFlow (a real message-thread engine —
// see that file's header): the bot asks one thing at a time. A genuine
// selection (which project, which vendor, ...) is always a tappable
// chip, never free-text-guessed by the model — same safety principle the
// old single-screen forms already had, just presented as a conversation
// instead of a form with every field visible at once. Reference lists
// (products, projects, ...) are fetched lazily and memoized in a ref the
// first time a step needs them, rather than fetched in a parent
// useEffect — AIChatFlow asks its first question on its own mount
// effect, which can fire before a sibling effect in the tab component
// would have, so each step's `options` fetches for itself.
export const BOM_EDIT_ROLES = ['admin','ceo','manager','department_head','finance','procurement_lead']
export const PRODUCT_EDIT_ROLES = ['admin','ceo','manager','department_head','finance','procurement_lead']
export const INVOICE_EDIT_ROLES = ['admin','ceo','finance']
export const DELIVERY_NOTE_EDIT_ROLES = ['admin','ceo','manager','department_head','finance']
export const SCENARIO_EDIT_ROLES = ['admin','ceo','manager','department_head','finance']
const TASK_DEF_PERMS = {
  employee:{can_create:false,can_change_status:true}, developer:{can_create:false,can_change_status:true},
  lead:{can_create:true,can_change_status:true}, manager:{can_create:true,can_change_status:true},
  department_head:{can_create:true,can_change_status:true}, ceo:{can_create:true,can_change_status:true},
  admin:{can_create:true,can_change_status:true}, finance:{can_create:false,can_change_status:false},
  hr:{can_create:false,can_change_status:false},
}

const input = { width:'100%', padding:'9px 11px', borderRadius:8, border:'1px solid var(--border)', background:'var(--bg)', color:'var(--text)', fontSize:12.5, fontFamily:'inherit', outline:'none' }
const btnPrimary = { padding:'9px 16px', borderRadius:8, border:'none', background:'var(--c1)', color:'#fff', fontWeight:700, fontSize:12.5, cursor:'pointer', fontFamily:'inherit' }
const label = { display:'block', fontSize:10.5, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:4 }

function PermissionNotice({ children }) {
  return (
    <div style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
      <div style={{ width:24, height:24, borderRadius:7, background:'var(--surface-2)', color:'var(--c1)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontSize:12 }}>✨</div>
      <div style={{ background:'var(--surface-2)', border:'1px solid var(--border)', borderRadius:'4px 12px 12px 12px', padding:'9px 12px', fontSize:12.5, color:'var(--text-muted)', lineHeight:1.5 }}>{children}</div>
    </div>
  )
}

export function NeoTaskTab({ onNavigate }) {
  return (
    <div style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
      <div style={{ width:24, height:24, borderRadius:7, background:'var(--surface-2)', color:'var(--c1)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontSize:12 }}>✨</div>
      <div style={{ background:'var(--surface-2)', border:'1px solid var(--border)', borderRadius:'4px 12px 12px 12px', padding:'12px 14px', maxWidth:'88%' }}>
        <div style={{ fontSize:12.5, color:'var(--text)', lineHeight:1.55, marginBottom:12 }}>
          Neo Task AI turns a requirement document into user stories, a backlog, tasks, test cases, API specs and a
          sprint plan. It needs a document upload, so it opens as its own page rather than a chat reply.
        </div>
        <button onClick={onNavigate} style={{ ...btnPrimary, display:'flex', alignItems:'center', gap:6 }}>
          Open Neo Task AI <ArrowRight size={13} />
        </button>
      </div>
    </div>
  )
}

// ── BOM AI ──
// `onSaved` (optional): called after a successful save, in addition to
// onView — the module pages embed these tabs in a docked panel right
// alongside their own data grid (see AIDockedPanel.jsx), so unlike the
// AskBubble popover they need a way to refresh that grid without the
// user leaving the page. AskBubble itself doesn't pass this — navigating
// away via onView is enough there.
export function BomAiTab({ profile, onSaved }) {
  const navigate = useNavigate()
  const canEdit = BOM_EDIT_ROLES.includes(profile?.role)
  const productsRef = useRef(null)
  const partNumberRef = useRef('')

  async function getProducts() {
    if (!productsRef.current) {
      const { data } = await supabase.from('products').select('part_number,name,device_type,standard_cost,is_serialized').order('name')
      productsRef.current = data || []
    }
    return productsRef.current
  }

  if (!canEdit) return <PermissionNotice>Your role can view BOM AI drafts but not save changes to a product's Bill of Materials.</PermissionNotice>

  const steps = [
    { key:'partNumber', type:'select', botMessage:'Which product is this Bill of Materials for?',
      options: async () => (await getProducts()).map(p => ({ value:p.part_number, label:`${p.name} (${p.part_number})` })) },
    { key:'prompt', type:'text', botMessage:'Got it. Now describe what it’s made of.', placeholder:'e.g. WiFi temperature sensor with microcontroller, enclosure, battery' },
  ]

  async function onGenerate(answers) {
    const products = await getProducts()
    const selected = products.find(p => p.part_number === answers.partNumber)
    partNumberRef.current = answers.partNumber
    const r = await generateBomDraft({ productName: selected?.name || answers.partNumber, partNumber: answers.partNumber, prompt: answers.prompt, catalog: products, modelId:'deepseek-v3', userId: profile.id })
    if (!r.components.length) return { status:'error', message:'Couldn’t match any existing catalog parts to this description. Try being more specific, or add the needed parts to Products first.' }
    return { status:'ready', draft: { productName: selected?.name || answers.partNumber, components: r.components, suggestedNewParts: r.suggestedNewParts } }
  }

  function renderDraft(draft, setDraft) {
    return (
      <div>
        <div style={{ fontWeight:700, fontSize:12.5, marginBottom:8 }}>Draft BOM for {draft.productName}</div>
        {draft.components.map((c, i) => (
          <div key={c.component_part_number} style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, padding:'6px 0', borderTop: i>0 ? '1px solid var(--border)' : 'none' }}>
            <span style={{ flex:1 }}>{c.name}</span>
            <input type="number" min="0.01" step="0.01" value={c.quantity} style={{ ...input, width:56, padding:'4px 6px' }}
              onChange={e => setDraft({ ...draft, components: draft.components.map((x, idx) => idx === i ? { ...x, quantity: e.target.value } : x) })} />
          </div>
        ))}
        {draft.suggestedNewParts?.length > 0 && (
          <div style={{ marginTop:8, fontSize:11, color:'var(--warning)' }}>Not in catalog yet: {draft.suggestedNewParts.map(p => p.name).join(', ')}</div>
        )}
      </div>
    )
  }

  async function onSave(answers, draft) {
    await saveNewBomVersion(answers.partNumber, draft.components, profile.id, `AI-drafted: "${answers.prompt.slice(0, 80)}"`)
    onSaved?.()
  }

  return (
    <AIChatFlow steps={steps} onGenerate={onGenerate} renderDraft={renderDraft} onSave={onSave}
      savedMessage="Saved as a new BOM version." viewLabel="View in BOM Management"
      onView={() => navigate(`/bom?product=${encodeURIComponent(partNumberRef.current)}`)} />
  )
}

// ── Product Catalog AI ──
export function ProductAiTab({ profile, onSaved }) {
  const navigate = useNavigate()
  const canEdit = PRODUCT_EDIT_ROLES.includes(profile?.role)
  if (!canEdit) return <PermissionNotice>Your role can view Product AI drafts but not add new products.</PermissionNotice>

  const steps = [
    { key:'prompt', type:'text', botMessage:'Describe the product you want to add.', placeholder:'e.g. Rugged outdoor GPS tracker for fleet vehicles, 4G, 5-year battery' },
  ]

  async function onGenerate(answers) {
    const d = await generateProductDraft({ prompt: answers.prompt, deviceTypes: DEVICE_TYPES, modelId:'deepseek-v3', userId: profile.id })
    return { status:'ready', draft: d }
  }

  function renderDraft(draft, setDraft) {
    const set = (k, v) => setDraft({ ...draft, [k]: v })
    return (
      <div>
        <label style={label}>Name</label>
        <input style={{ ...input, marginBottom:8 }} value={draft.name} onChange={e => set('name', e.target.value)} />
        <div style={{ display:'flex', gap:8, marginBottom:8 }}>
          <div style={{ flex:1 }}><label style={label}>Part Number</label><input style={input} value={draft.part_number} onChange={e => set('part_number', e.target.value)} /></div>
          <div style={{ flex:1 }}>
            <label style={label}>Device Type</label>
            <select style={input} value={draft.device_type} onChange={e => set('device_type', e.target.value)}>
              {DEVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <div style={{ flex:1 }}><label style={label}>Warranty (mo)</label><input style={input} type="number" value={draft.warranty_months} onChange={e => set('warranty_months', e.target.value)} /></div>
          <div style={{ flex:1 }}><label style={label}>Est. Cost (₹)</label><input style={input} type="number" value={draft.standard_cost} onChange={e => set('standard_cost', e.target.value)} /></div>
        </div>
      </div>
    )
  }

  async function onSave(answers, draft) {
    const part_number = draft.part_number?.trim() || ('PRD-' + Date.now().toString().slice(-6))
    const payload = {
      part_number, name: draft.name, device_type: draft.device_type || null, spec_sheet: draft.spec_sheet || null,
      warranty_months: parseInt(draft.warranty_months) || 12, reorder_level: parseFloat(draft.reorder_level) || 0,
      reorder_qty: parseFloat(draft.reorder_qty) || 0, standard_cost: parseFloat(draft.standard_cost) || 0,
      is_serialized: true, status: 'active', created_by: profile.id,
    }
    const { error } = await supabase.from('products').insert(payload)
    if (error) throw error
    onSaved?.()
  }

  return (
    <AIChatFlow steps={steps} onGenerate={onGenerate} renderDraft={renderDraft} onSave={onSave}
      savedMessage="Product created." viewLabel="View in Products" onView={() => navigate('/products')} />
  )
}

// ── Prompt-Based Task Actions ──
// `workItemId`/`workItemTitle` (both optional — default undefined, so the
// AskBubble popover and TasksPage.jsx's existing usage are byte-identical
// to before): when set (from WorkItemsPage.jsx's Phase 7/10 "AI-assisted"
// entry point), this skips the "which project" question entirely — the
// task is created as a Direct Task (project_id: null, per Phase 4) linked
// to that work item instead. Status-change intents aren't supported in
// this mode (no project to scope the task search to) — the bot says so
// rather than guessing.
export function TaskActionsTab({ profile, onSaved, workItemId, workItemTitle }) {
  const navigate = useNavigate()
  const perm = TASK_DEF_PERMS[profile?.role] || TASK_DEF_PERMS.employee
  const usersRef = useRef(null)
  const parseCacheRef = useRef(null)

  async function getUsers() {
    if (!usersRef.current) {
      const { data } = await supabase.from('profiles').select('id,full_name,role').order('full_name')
      usersRef.current = data || []
    }
    return usersRef.current
  }

  // Best-effort audit trail (master prompt: every AI action must be
  // audited). Fire-and-forget, matching Layout.jsx's own page_view
  // logging convention (no .catch there either) — an audit-log failure
  // must never block or surface as an error on the actual task action.
  function auditLog(eventType, extra) {
    try {
      supabase.from('app_events').insert({
        event_type: eventType,
        path: workItemId ? `/work-items/${workItemId}` : '/tasks',
        user_id: profile.id,
        session_id: `ai-task-actions-${profile.id}`,
      }).then(() => {}, () => {})
    } catch {}
  }

  if (!perm.can_create && !perm.can_change_status) return <PermissionNotice>Your role can't create tasks or change their status.</PermissionNotice>

  const steps = workItemId
    ? [
        { key:'prompt', type:'text', botMessage:`What task would you like to create for "${workItemTitle}"?`, placeholder:'"Inspect the HVAC unit, assign to Raj, high priority, due Friday"' },
      ]
    : [
        { key:'projectId', type:'select', botMessage:'Which project is this for?',
          options: async () => { const { data } = await supabase.from('projects').select('id,name').eq('status','active').order('name'); return (data || []).map(p => ({ value:p.id, label:p.name })) } },
        { key:'prompt', type:'text', botMessage:'What would you like to do?', placeholder:'"Create a task to fix the login bug, assign to Priya, high priority" or "Mark \'Fix login bug\' as done"' },
      ]

  async function onGenerate(answers) {
    if (answers.pickedTaskId) {
      const cache = parseCacheRef.current
      const matchedTask = cache.candidates.find(t => t.id === answers.pickedTaskId)
      return { status:'ready', draft: { ...cache.parsed, kind:'status', matchedTask } }
    }
    const parsed = await parseTaskCommand({ prompt: answers.prompt, modelId:'deepseek-v3', userId: profile.id })
    if (parsed.intent === 'unclear') return { status:'error', message: parsed.reason || 'Could not understand that as a task action.' }
    if (parsed.intent === 'create_task') {
      if (!perm.can_create) return { status:'error', message: "Your role can't create tasks." }
      return { status:'ready', draft: { ...parsed, kind:'create' } }
    }
    if (workItemId) return { status:'error', message: "Status changes via AI aren't available from here yet — open the task from the list and change its status directly." }
    if (!perm.can_change_status) return { status:'error', message: "Your role can't change task status." }
    const { data: tasks } = await supabase.from('project_tasks').select('id,task_name,status').eq('project_id', answers.projectId)
    const candidates = matchTasks(parsed.task_match, tasks || [])
    if (!candidates.length) return { status:'error', message:`No task found matching "${parsed.task_match}" in this project.` }
    if (candidates.length === 1) return { status:'ready', draft: { ...parsed, kind:'status', matchedTask: candidates[0] } }
    parseCacheRef.current = { parsed, candidates }
    return { status:'need-input', key:'pickedTaskId', botMessage:`Multiple tasks match "${parsed.task_match}" — which one?`, type:'select', options: candidates.map(t => ({ value:t.id, label:t.task_name })) }
  }

  function renderDraft(draft) {
    if (draft.kind === 'status') {
      return (
        <div style={{ fontSize:12.5 }}>
          Mark <strong>{draft.matchedTask.task_name}</strong> as{' '}
          <strong style={{ textTransform:'capitalize' }}>{TASK_STATUSES.includes(draft.new_status) ? draft.new_status.replace(/_/g,' ') : draft.new_status}</strong>?
        </div>
      )
    }
    const users = usersRef.current || []
    const matched = matchMember(draft.assignee_name, users)
    return (
      <div>
        <div style={{ fontWeight:700, fontSize:13, marginBottom:6 }}>{draft.task_name}</div>
        {draft.description && <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:8 }}>{draft.description}</div>}
        <div style={{ fontSize:11.5, marginBottom:4 }}>Priority: <strong style={{ textTransform:'capitalize' }}>{draft.priority}</strong></div>
        <div style={{ fontSize:11.5 }}>Assignee: {draft.assignee_name ? (matched ? <strong>{matched.full_name}</strong> : <span style={{ color:'var(--warning)' }}>no match for "{draft.assignee_name}" — unassigned</span>) : <em>none specified</em>}</div>
      </div>
    )
  }

  async function onSave(answers, draft) {
    await getUsers()
    if (draft.kind === 'create') {
      const matched = matchMember(draft.assignee_name, usersRef.current)
      const { error } = await supabase.from('project_tasks').insert({
        project_id: workItemId ? null : answers.projectId,
        work_item_id: workItemId || null,
        task_name: draft.task_name || 'Untitled task', task_type:'task',
        description: draft.description || null, priority: draft.priority || 'medium', status:'backlog',
        assigned_to: matched?.id || null, planned_end_date: draft.due_date || null, created_by: profile.id,
      })
      if (error) throw error
      auditLog('ai_task_created')
    } else {
      const { error } = await supabase.from('project_tasks').update({ status: draft.new_status }).eq('id', draft.matchedTask.id)
      if (error) throw error
      auditLog('ai_task_status_changed')
    }
    onSaved?.()
  }

  return (
    <AIChatFlow steps={steps} onGenerate={onGenerate} renderDraft={renderDraft} onSave={onSave}
      savedMessage="Done." viewLabel="View in Task Management" onView={() => navigate('/tasks')} />
  )
}

// ── Customer Invoice AI ──
export function CustomerInvoiceAiTab({ profile, onSaved }) {
  const navigate = useNavigate()
  const canEdit = INVOICE_EDIT_ROLES.includes(profile?.role)
  if (!canEdit) return <PermissionNotice>Your role can view Customer Invoice AI drafts but not create invoices.</PermissionNotice>

  const steps = [
    { key:'projectId', type:'select', botMessage:'Which project is being billed?',
      options: async () => { const { data } = await supabase.from('projects').select('id,name').eq('status','active').order('name'); return (data || []).map(p => ({ value:p.id, label:p.name })) } },
    { key:'customerId', type:'select', optional:true, botMessage:'Which customer? (optional)',
      options: async () => { const { data } = await supabase.from('customers').select('id,name').eq('status','active').order('name'); return (data || []).map(c => ({ value:c.id, label:c.name })) } },
    { key:'prompt', type:'text', botMessage:'Describe what’s being billed.', placeholder:'e.g. October consulting, ₹45,000 plus GST, due in 30 days' },
  ]

  async function onGenerate(answers) {
    const d = await generateCustomerInvoiceDraft({ prompt: answers.prompt, modelId:'deepseek-v3', userId: profile.id })
    return { status:'ready', draft: d }
  }

  function renderDraft(draft, setDraft) {
    const set = (k, v) => setDraft({ ...draft, [k]: v })
    return (
      <div>
        <div style={{ display:'flex', gap:8, marginBottom:8 }}>
          <div style={{ flex:1 }}><label style={label}>Subtotal (₹)</label><input style={input} type="number" value={draft.subtotal} onChange={e => set('subtotal', e.target.value)} /></div>
          <div style={{ flex:1 }}><label style={label}>GST (₹)</label><input style={input} type="number" value={draft.gst_amount} onChange={e => set('gst_amount', e.target.value)} /></div>
        </div>
        <label style={label}>Total (₹)</label>
        <input style={{ ...input, marginBottom:8 }} type="number" value={draft.total_amount} onChange={e => set('total_amount', e.target.value)} />
        <div style={{ display:'flex', gap:8 }}>
          <div style={{ flex:1 }}><label style={label}>Invoice Date</label><input style={input} type="date" value={draft.invoice_date} onChange={e => set('invoice_date', e.target.value)} /></div>
          <div style={{ flex:1 }}><label style={label}>Due Date</label><input style={input} type="date" value={draft.due_date} onChange={e => set('due_date', e.target.value)} /></div>
        </div>
      </div>
    )
  }

  async function onSave(answers, draft) {
    const invoice_number = await nextNum('invoice')
    const { error } = await supabase.from('customer_invoices').insert({
      invoice_number, project_id: answers.projectId, customer_id: answers.customerId || null,
      invoice_date: draft.invoice_date || null, due_date: draft.due_date || null,
      subtotal: Number(draft.subtotal) || null, gst_amount: Number(draft.gst_amount) || 0,
      total_amount: Number(draft.total_amount) || 0, status:'draft', notes: draft.notes || null, created_by: profile.id,
    })
    if (error) throw error
    onSaved?.()
  }

  return (
    <AIChatFlow steps={steps} onGenerate={onGenerate} renderDraft={renderDraft} onSave={onSave}
      savedMessage="Invoice created." viewLabel="View in Customer Invoices" onView={() => navigate('/customer-invoices')} />
  )
}

// ── Vendor Invoice AI ──
export function VendorInvoiceAiTab({ profile, onSaved }) {
  const navigate = useNavigate()
  const canEdit = INVOICE_EDIT_ROLES.includes(profile?.role)
  const vendorsRef = useRef(null)
  if (!canEdit) return <PermissionNotice>Your role can view Vendor Invoice AI drafts but not add invoices.</PermissionNotice>

  async function getVendors() {
    if (!vendorsRef.current) {
      const { data } = await supabase.from('vendors').select('id,name').eq('status','active').order('name')
      vendorsRef.current = data || []
    }
    return vendorsRef.current
  }

  const steps = [
    { key:'vendorId', type:'select', botMessage:'Which vendor is this from?',
      options: async () => (await getVendors()).map(v => ({ value:v.id, label:v.name })) },
    { key:'poId', type:'select', optional:true, botMessage:'Link a Purchase Order? (optional, for 3-way match)',
      options: async (answers) => { const { data } = await supabase.from('purchase_orders').select('id,po_number,vendor_id,total_amount').eq('vendor_id', answers.vendorId); return (data || []).map(po => ({ value:po.id, label:`${po.po_number} — ${rupee(po.total_amount)}` })) } },
    { key:'projectId', type:'select', optional:true, botMessage:'Which project? (optional)',
      options: async () => { const { data } = await supabase.from('projects').select('id,name').eq('status','active').order('name'); return (data || []).map(p => ({ value:p.id, label:p.name })) } },
    { key:'prompt', type:'text', botMessage:'Describe what’s being billed.', placeholder:'e.g. Component shipment for October, ₹1,20,000 plus GST, net 30' },
  ]

  async function onGenerate(answers) {
    const d = await generateVendorInvoiceDraft({ prompt: answers.prompt, modelId:'deepseek-v3', userId: profile.id })
    return { status:'ready', draft: { ...d, invoice_number:'' } }
  }

  function renderDraft(draft, setDraft) {
    const set = (k, v) => setDraft({ ...draft, [k]: v })
    return (
      <div>
        <label style={label}>Invoice Number *</label>
        <input style={{ ...input, marginBottom:8 }} value={draft.invoice_number} onChange={e => set('invoice_number', e.target.value)} placeholder="INV-001" />
        <div style={{ display:'flex', gap:8, marginBottom:8 }}>
          <div style={{ flex:1 }}><label style={label}>Subtotal (₹)</label><input style={input} type="number" value={draft.subtotal} onChange={e => set('subtotal', e.target.value)} /></div>
          <div style={{ flex:1 }}><label style={label}>GST (₹)</label><input style={input} type="number" value={draft.gst_amount} onChange={e => set('gst_amount', e.target.value)} /></div>
        </div>
        <label style={label}>Total (₹)</label>
        <input style={{ ...input, marginBottom:8 }} type="number" value={draft.total_amount} onChange={e => set('total_amount', e.target.value)} />
        <div style={{ display:'flex', gap:8 }}>
          <div style={{ flex:1 }}><label style={label}>Invoice Date</label><input style={input} type="date" value={draft.invoice_date} onChange={e => set('invoice_date', e.target.value)} /></div>
          <div style={{ flex:1 }}><label style={label}>Due Date</label><input style={input} type="date" value={draft.due_date} onChange={e => set('due_date', e.target.value)} /></div>
        </div>
      </div>
    )
  }

  async function onSave(answers, draft) {
    if (!draft.invoice_number?.trim()) throw new Error('Invoice number is required.')
    const vendors = await getVendors()
    const vendor = vendors.find(v => v.id === answers.vendorId)
    const { error } = await supabase.from('invoices').insert({
      invoice_number: draft.invoice_number.trim(), vendor_id: answers.vendorId, vendor_name: vendor?.name || null,
      po_id: answers.poId || null, project_id: answers.projectId || null,
      invoice_date: draft.invoice_date || null, due_date: draft.due_date || null,
      subtotal: Number(draft.subtotal) || null, gst_amount: Number(draft.gst_amount) || 0,
      total_amount: Number(draft.total_amount) || 0, status:'uploaded', created_by: profile.id,
    })
    if (error) throw error
    onSaved?.()
  }

  return (
    <AIChatFlow steps={steps} onGenerate={onGenerate} renderDraft={renderDraft} onSave={onSave}
      savedMessage="Invoice added." viewLabel="View in Invoice Management" onView={() => navigate('/invoices')} />
  )
}

// ── Delivery Note AI ──
export function DeliveryNoteAiTab({ profile, onSaved }) {
  const navigate = useNavigate()
  const canEdit = DELIVERY_NOTE_EDIT_ROLES.includes(profile?.role)
  const productsRef = useRef(null)
  if (!canEdit) return <PermissionNotice>Your role can view Delivery Note AI drafts but not create delivery notes.</PermissionNotice>

  async function getProducts() {
    if (!productsRef.current) {
      const { data } = await supabase.from('products').select('part_number,name').order('name')
      productsRef.current = data || []
    }
    return productsRef.current
  }

  const steps = [
    { key:'projectId', type:'select', botMessage:'Which project is this shipment for?',
      options: async () => { const { data } = await supabase.from('projects').select('id,name').eq('status','active').order('name'); return (data || []).map(p => ({ value:p.id, label:p.name })) } },
    { key:'customerId', type:'select', optional:true, botMessage:'Which customer? (optional)',
      options: async () => { const { data } = await supabase.from('customers').select('id,name').eq('status','active').order('name'); return (data || []).map(c => ({ value:c.id, label:c.name })) } },
    { key:'prompt', type:'text', botMessage:'Describe what’s going out.', placeholder:'e.g. 10 temperature sensors and 2 gateways via Blue Dart, dispatch next Monday' },
  ]

  async function onGenerate(answers) {
    const catalog = await getProducts()
    const d = await generateDeliveryNoteDraft({ prompt: answers.prompt, catalog, modelId:'deepseek-v3', userId: profile.id })
    if (!d.items.length) return { status:'error', message:'Couldn’t draft any items from that description — try being more specific about what’s shipping.' }
    return { status:'ready', draft: d }
  }

  function renderDraft(draft, setDraft) {
    const setItem = (i, k, v) => setDraft({ ...draft, items: draft.items.map((it, idx) => idx === i ? { ...it, [k]: v } : it) })
    const set = (k, v) => setDraft({ ...draft, [k]: v })
    return (
      <div>
        {draft.items.map((it, i) => (
          <div key={i} style={{ display:'flex', gap:6, alignItems:'center', marginBottom:6 }}>
            <input style={{ ...input, flex:1 }} value={it.description} onChange={e => setItem(i, 'description', e.target.value)} />
            <input style={{ ...input, width:46, padding:'4px 6px' }} type="number" min="0" value={it.quantity} onChange={e => setItem(i, 'quantity', e.target.value)} />
            <input style={{ ...input, width:46, padding:'4px 6px' }} value={it.unit} onChange={e => setItem(i, 'unit', e.target.value)} />
          </div>
        ))}
        <div style={{ display:'flex', gap:8, marginTop:8 }}>
          <div style={{ flex:1 }}><label style={label}>Delivery Date</label><input style={input} type="date" value={draft.delivery_date} onChange={e => set('delivery_date', e.target.value)} /></div>
          <div style={{ flex:1 }}><label style={label}>Carrier</label><input style={input} value={draft.carrier} onChange={e => set('carrier', e.target.value)} /></div>
        </div>
      </div>
    )
  }

  async function onSave(answers, draft) {
    await createDeliveryNote({
      project_id: answers.projectId, customer_id: answers.customerId || null,
      delivery_date: draft.delivery_date || null, carrier: draft.carrier || null,
      tracking_number: draft.tracking_number || null, delivery_address: draft.delivery_address || null,
      status:'draft', notes: draft.notes || null,
    }, draft.items, profile.id)
    onSaved?.()
  }

  return (
    <AIChatFlow steps={steps} onGenerate={onGenerate} renderDraft={renderDraft} onSave={onSave}
      savedMessage="Delivery note created." viewLabel="View in Delivery Notes" onView={() => navigate('/delivery-notes')} />
  )
}

// ── Scenario AI ──
// Drafts the Objective/Context/Assumptions/Risks steps a human would
// otherwise fill in by hand across ScenarioBuilderPage's wizard (Phase 5).
// Deliberately does NOT touch Linked Data or run a simulation — those stay
// manual, since they depend on picking real records / reviewing computed
// numbers, not something to hand to a model. onSave calls the exact same
// scenarios.js functions the wizard itself uses (createScenario,
// updateVersion, upsertVariable), so a saved AI draft is a completely
// ordinary draft scenario afterward — no separate code path, no special
// "AI-created" flag to keep in sync.
export function ScenarioAiTab({ profile, onSaved }) {
  const navigate = useNavigate()
  const canEdit = SCENARIO_EDIT_ROLES.includes(profile?.role)
  const createdVersionIdRef = useRef('')

  if (!canEdit) return <PermissionNotice>Your role can view Scenario AI drafts but not create scenarios.</PermissionNotice>

  const steps = [
    { key:'prompt', type:'text', botMessage:'Describe the business situation you want to model as a what-if scenario.', placeholder:'e.g. Should we expand into the APAC region next quarter, hiring a 4-person local team?' },
  ]

  async function onGenerate(answers) {
    const d = await generateScenarioDraft({ description: answers.prompt, modelId:'deepseek-v3', userId: profile.id })
    return { status:'ready', draft: d }
  }

  function renderDraft(draft, setDraft) {
    const set = (k, v) => setDraft({ ...draft, [k]: v })
    const setVar = (i, k, v) => setDraft({ ...draft, variables: draft.variables.map((x, idx) => idx === i ? { ...x, [k]: v } : x) })
    const removeVar = i => setDraft({ ...draft, variables: draft.variables.filter((_, idx) => idx !== i) })
    return (
      <div>
        <label style={label}>Name</label>
        <input style={{ ...input, marginBottom:8 }} value={draft.name} onChange={e => set('name', e.target.value)} />
        <label style={label}>Objective</label>
        <textarea style={{ ...input, marginBottom:8, minHeight:44, resize:'vertical' }} value={draft.objective} onChange={e => set('objective', e.target.value)} />
        <label style={label}>Category</label>
        <select style={{ ...input, marginBottom:8 }} value={draft.category} onChange={e => set('category', e.target.value)}>
          {['general','expansion','cost-reduction','hiring','product-launch','restructuring'].map(c => <option key={c} value={c}>{c.replace(/-/g,' ')}</option>)}
        </select>
        <label style={label}>Risks</label>
        <textarea style={{ ...input, marginBottom:8, minHeight:36, resize:'vertical' }} value={draft.risks} onChange={e => set('risks', e.target.value)} />
        {draft.variables.length > 0 && (
          <>
            <label style={label}>Assumptions</label>
            {draft.variables.map((v, i) => (
              <div key={i} style={{ display:'flex', gap:6, alignItems:'center', marginBottom:6 }}>
                <input style={{ ...input, flex:1 }} value={v.label} onChange={e => setVar(i, 'label', e.target.value)} />
                <input style={{ ...input, width:64, padding:'4px 6px' }} value={v.value} onChange={e => setVar(i, 'value', e.target.value)} />
                <button onClick={() => removeVar(i)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', padding:2, flexShrink:0 }}><Trash2 size={13} /></button>
              </div>
            ))}
          </>
        )}
      </div>
    )
  }

  async function onSave(answers, draft) {
    const { scenario, version } = await createScenario({ name: draft.name || 'Untitled Scenario', objective: draft.objective, category: draft.category })
    await updateScenario(scenario.id, { name: draft.name || 'Untitled Scenario', objective: draft.objective, category: draft.category })
    await updateVersion(version.id, { context: { background: draft.background, stakeholders: draft.stakeholders, risks: draft.risks } })
    for (const [i, v] of draft.variables.entries()) {
      await upsertVariable(version.id, { key: v.key, label: v.label, dataType: v.data_type, value: v.value, sortOrder: i })
    }
    createdVersionIdRef.current = version.id
    onSaved?.()
  }

  return (
    <AIChatFlow steps={steps} onGenerate={onGenerate} renderDraft={renderDraft} onSave={onSave}
      savedMessage="Scenario drafted — link real data and run a simulation next." viewLabel="Open Scenario"
      onView={() => navigate(`/scenarios/${createdVersionIdRef.current}`)} />
  )
}
