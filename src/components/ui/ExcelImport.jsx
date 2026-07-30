import { useState, useRef } from 'react'
import { supabase, rupee, dateFmt } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { Upload, Download, X, CheckCircle, AlertTriangle, FileSpreadsheet } from 'lucide-react'

const TASK_TYPE_OPTIONS = ['task','bug','change_request','feature','improvement']
const PRIORITY_OPTIONS  = ['critical','high','medium','low']
const EMPLOYMENT_TYPE_OPTIONS = ['FTE','Contractor','Intern']
const PROFICIENCY_OPTIONS = ['Beginner','Intermediate','Expert','Master']

/* ── Template definitions ── */
export const TEMPLATES = {
  tasks: {
    label: 'Project Tasks',
    table: 'project_tasks',
    formatCurrency: false,
    columns: ['task_name','task_type','module_name','priority','assignee_name','sprint_name','story_title','planned_start_date','planned_end_date','estimated_hours','actual_hours','description'],
    required: ['task_name'],
    types:    { estimated_hours:'number', actual_hours:'number' },
    sample: [
      ['Design login screen','feature','Auth','high','','Sprint 1','','2026-08-01','2026-08-05','8','','Figma mockups for login and signup flows'],
      ['Fix password reset bug','bug','Auth','critical','Priya Sharma','Sprint 1','US-001 Login Flow','2026-08-01','2026-08-02','4','','Reset link expires too early'],
      ['Setup CI pipeline','task','DevOps','medium','','','','2026-08-03','2026-08-06','6','',''],
      ['Client requested extra filters','change_request','Reports','medium','','Sprint 2','','2026-08-10','2026-08-14','10','',''],
      ['Improve dashboard load time','improvement','Dashboard','low','','','','','','5','',''],
    ],
    notes: 'Every imported task lands in Backlog. task_type: task/bug/change_request/feature/improvement · priority: critical/high/medium/low · assignee_name must match a team member\'s full name · sprint_name/story_title must match an existing Sprint/Story in the selected project (case-insensitive) — leave blank to skip.',
  },
  hardware: {
    label: 'Hardware Costs',
    table: 'project_hardware_costs',
    formatCurrency: true,
    columns: ['name','category','qty','unit_price','cost_company','cost_client','proposal_cost','vendor','notes'],
    required: ['name','qty','unit_price'],
    types:    { qty:'number', unit_price:'number', cost_company:'number', cost_client:'number', proposal_cost:'number' },
    sample: [
      ['Raspberry Pi 4 (4GB)','component','10','4500','45000','58500','67500','Element14','Main controller boards'],
      ['PCB Assembly','assembly','50','800','40000','52000','60000','TechMfg Ltd','Custom PCBs'],
      ['Shipping & Logistics','logistics','1','12000','12000','15600','18000','DHL Express',''],
    ],
    notes: 'cost_company auto-fits as qty × unit_price if blank. cost_client = ×1.3, proposal = ×1.5',
  },
  software: {
    label: 'Software Costs',
    table: 'project_software_costs',
    formatCurrency: true,
    columns: ['name','category','qty','unit_price','cost_company','cost_client','proposal_cost','billing_cycle','notes'],
    required: ['name'],
    types:    { qty:'number', unit_price:'number', cost_company:'number', cost_client:'number', proposal_cost:'number' },
    sample: [
      ['AWS EC2 t3.large','server','2','6500','13000','16900','19500','monthly','Production servers'],
      ['Twilio SMS API','third_party','1','4200','4200','5460','6300','monthly','SMS notifications'],
      ['Datadog APM','saas','1','8500','8500','11050','12750','monthly','Monitoring'],
      ['SSL Certificate','license','1','2500','2500','3250','3750','yearly','Wildcard cert'],
    ],
    notes: 'billing_cycle: monthly / yearly / quarterly / one_time',
  },
  expenses: {
    label: 'Expense Requests',
    table: 'expense_requests',
    formatCurrency: true,
    columns: ['title','category','amount','expense_date','notes'],
    required: ['title','amount','expense_date'],
    types:    { amount:'number' },
    sample: [
      ['Site visit travel','transport','4500','2025-06-10','Flight to Site Charlie'],
      ['Team lunch','food','1200','2025-06-11','Project kickoff lunch'],
      ['Hardware tools','equipment','8900','2025-06-12','Soldering station'],
      ['Hotel accommodation','accommodation','5400','2025-06-13','3 nights site stay'],
    ],
    notes: 'expense_date format: YYYY-MM-DD. category: transport/food/equipment/accommodation/other',
  },
  employees: {
    label: 'Employees',
    table: 'profiles',
    formatCurrency: false,
    columns: ['email','full_name','role','department_name','reporting_manager_email','employment_type','default_weekly_capacity_hours','date_joined'],
    required: ['email'],
    types:    { default_weekly_capacity_hours:'number' },
    sample: [
      ['priya.sharma@thingsalive.in','Priya Sharma','employee','Engineering','rahul.verma@thingsalive.in','FTE','40','2024-03-01'],
      ['arjun.rao@thingsalive.in','Arjun Rao','manager','Engineering','','FTE','40','2022-11-15'],
    ],
    notes: 'email must match an existing user\'s account — this updates existing profiles, it does not create new logins. Blank cells leave that field unchanged. department_name/reporting_manager_email must match an existing department/employee (case-insensitive) — leave blank to skip. employment_type: FTE/Contractor/Intern.',
  },
  employee_skills: {
    label: 'Employee Skills',
    table: 'employee_skills',
    formatCurrency: false,
    columns: ['employee_email','skill_name','proficiency_level','years_experience','certified'],
    required: ['employee_email','skill_name','proficiency_level'],
    types:    { years_experience:'number' },
    sample: [
      ['priya.sharma@thingsalive.in','Embedded C','Expert','4','yes'],
      ['priya.sharma@thingsalive.in','React','Intermediate','2','no'],
      ['arjun.rao@thingsalive.in','Project Planning','Master','6','yes'],
    ],
    notes: 'employee_email must match an existing user, skill_name must match an existing entry in the Skill Matrix catalog (both case-insensitive) — unmatched rows are skipped, not auto-created. proficiency_level: Beginner/Intermediate/Expert/Master. certified: yes/no.',
  },
  components: {
    label: 'Inventory Components',
    table: 'products',
    formatCurrency: true,
    columns: ['part_number', 'name', 'device_type', 'standard_cost', 'reorder_level', 'reorder_qty', 'status'],
    required: ['name'],
    types: { standard_cost: 'number', reorder_level: 'number', reorder_qty: 'number' },
    sample: [
      ['CMP-1001', 'Temperature Sensor Module', 'Temperature Sensor', '450', '20', '50', 'active'],
      ['CMP-1002', 'Enclosure — Standard', 'Other', '320', '10', '25', 'active'],
      ['CMP-1003', 'Mounting Screw Set (4pc)', 'Other', '40', '100', '200', 'active'],
    ],
    notes: 'part_number is auto-generated if left blank. Every imported row is created as a non-serialized (bulk/consumable) component, listed under Inventory → Components — for serialized devices use the Products page instead. status: active/discontinued (defaults to active).',
  },
  bom: {
    label: 'BOM Components',
    table: null, // special-cased in doImport — staged into the edit form via onImportRows, not inserted directly
    formatCurrency: false,
    columns: ['component_name','component_id','component_part_number','per_unit_cost','quantity_stock','required_quantity_for_product','notes'],
    required: ['component_part_number','required_quantity_for_product'],
    types:    { required_quantity_for_product:'number' },
    sample: [
      ['Temperature Sensor Module','','PRD-1002','450','—','2','Sensor module'],
      ['Enclosure — Standard','','PRD-1005','320','—','1','Enclosure'],
      ['Mounting Screw Set (4pc)','','PRD-1009','40','—','4','Mounting screws (set of 4)'],
    ],
    notes: 'Only component_part_number and required_quantity_for_product are actually read — component_name/component_id/per_unit_cost/quantity_stock are reference-only and always re-fetched live from the Products catalog, never trusted from the file. component_part_number must match an existing Product part number (case-insensitive) — unmatched rows are skipped. Rows are staged into the edit form; you still need to click "Save as New Version" to commit. Use "Download Template" while a product is selected to get a ready-made sheet listing every real component with its current cost.',
  },
}

/* ── Parse CSV text ── */
function parseCSV(text) {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return { headers:[], rows:[] }
  const headers = lines[0].split(',').map(h => h.replace(/"/g,'').trim().toLowerCase().replace(/ /g,'_'))
  const rows = lines.slice(1).map(line => {
    const vals = []
    let current = '', inQ = false
    for (let ch of line) {
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { vals.push(current.trim()); current = '' }
      else current += ch
    }
    vals.push(current.trim())
    return headers.reduce((obj, h, i) => { obj[h] = vals[i] || ''; return obj }, {})
  }).filter(r => Object.values(r).some(v => v !== ''))
  return { headers, rows }
}

/* ── Parse XLSX using SheetJS ── */
async function parseXLSX(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const XLSX = window.XLSX
        if (!XLSX) { reject(new Error('XLSX library not loaded')); return }
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const data = XLSX.utils.sheet_to_csv(ws)
        resolve(parseCSV(data))
      } catch(err) { reject(err) }
    }
    reader.readAsArrayBuffer(file)
  })
}

/* ── Download template CSV ── */
function downloadTemplate(type, lookups) {
  const tmpl = TEMPLATES[type]
  let sampleRows = tmpl.sample

  // BOM: build the template from the real Products catalog instead of
  // static placeholders, so component_name/component_id/per_unit_cost are
  // already correct — the user only has to fill in
  // required_quantity_for_product and delete rows they don't need.
  if (type === 'bom' && lookups?.products?.length) {
    sampleRows = lookups.products
      .filter(p => p.part_number !== lookups.currentPartNumber)
      .map(p => {
        const stockCol = p.is_serialized
          ? (lookups?.stockByPart?.[p.part_number] != null ? `${lookups.stockByPart[p.part_number]} in stock` : 'not shown')
          : `Reorder @ ${p.reorder_level ?? '—'}`
        return [p.name || '', p.id || '', p.part_number || '', Number(p.standard_cost || 0), stockCol, '', '']
      })
  }

  const header = tmpl.columns.join(',')
  const rows   = sampleRows.map(r => r.map(v => `"${v}"`).join(','))
  const csv    = [header, ...rows].join('\n')
  const blob   = new Blob([csv], { type:'text/csv' })
  const a      = document.createElement('a')
  a.href       = URL.createObjectURL(blob)
  a.download   = `thingsalive-${type}-import-template.csv`
  a.click()
}

/* ══ Main Component ══════════════════════════════════════════ */
export default function ExcelImport({ type, projectId, lookups, onSuccess, onClose, onImportRows }) {
  const { profile } = useAuth()
  const tmpl = TEMPLATES[type]
  const fileRef = useRef()

  const [step,     setStep]    = useState('upload')  // upload | preview | result
  const [rows,     setRows]    = useState([])
  const [errors,   setErrors]  = useState([])
  const [warnings, setWarnings]= useState([])
  const [importing,setImporting]=useState(false)
  const [result,   setResult]  = useState(null)
  const [fileName, setFileName]= useState('')

  async function handleFile(file) {
    if (!file) return
    setFileName(file.name)
    try {
      let parsed
      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        // Load SheetJS dynamically
        if (!window.XLSX) {
          await new Promise((res, rej) => {
            const s = document.createElement('script')
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
            s.onload = res; s.onerror = rej
            document.head.appendChild(s)
          })
        }
        parsed = await parseXLSX(file)
      } else {
        const text = await file.text()
        parsed = parseCSV(text)
      }

      validateAndPreview(parsed.rows)
    } catch(e) {
      setErrors([`File parse error: ${e.message}`])
      setStep('preview')
    }
  }

  function validateAndPreview(rawRows) {
    const errs = [], warns = [], cleaned = []

    rawRows.forEach((row, i) => {
      const rowNum = i + 2  // 1-indexed + header
      const obj = {}

      // Check required fields
      let hasError = false
      for (const req of tmpl.required) {
        if (!row[req] && !Object.keys(row).find(k => k.toLowerCase() === req.toLowerCase())) {
          errs.push(`Row ${rowNum}: missing required column "${req}"`)
          hasError = true
        } else if (!row[req]) {
          errs.push(`Row ${rowNum}: "${req}" is required but empty`)
          hasError = true
        }
      }

      // Map columns, coerce types
      for (const col of tmpl.columns) {
        const val = row[col] || row[col.replace('_',' ')] || ''
        if (tmpl.types[col] === 'number') {
          const n = parseFloat(String(val).replace(/[₹,\s]/g, ''))
          obj[col] = isNaN(n) ? 0 : n
        } else {
          obj[col] = val
        }
      }

      // Auto-fill derived fields for HW/SW
      if (type === 'hardware' || type === 'software') {
        const qty = parseFloat(obj.qty) || 1
        const up  = parseFloat(obj.unit_price) || 0
        if (up > 0 && !obj.cost_company) obj.cost_company = qty * up
        if (!obj.cost_client  && obj.cost_company) obj.cost_client  = obj.cost_company * 1.3
        if (!obj.proposal_cost && obj.cost_company) obj.proposal_cost = obj.cost_company * 1.5
        if (type === 'hardware') {
          obj.total_price = qty * up
          if (!obj.category) obj.category = 'component'
        } else {
          if (!obj.billing_cycle) { obj.billing_cycle = 'monthly'; warns.push(`Row ${rowNum}: billing_cycle missing, defaulted to "monthly"`) }
          if (!obj.category) obj.category = 'other'
        }
      }

      if (type === 'expenses') {
        if (!obj.category) obj.category = 'other'
        // Validate date format
        if (obj.expense_date && !/^\d{4}-\d{2}-\d{2}/.test(obj.expense_date)) {
          warns.push(`Row ${rowNum}: expense_date "${obj.expense_date}" — ensure format is YYYY-MM-DD`)
        }
      }

      if (type === 'tasks') {
        let tt = (obj.task_type || 'task').toLowerCase().replace(/ /g,'_')
        if (!TASK_TYPE_OPTIONS.includes(tt)) { warns.push(`Row ${rowNum}: task_type "${obj.task_type}" not recognised, defaulted to "task"`); tt = 'task' }
        obj.task_type = tt

        let pr = (obj.priority || 'medium').toLowerCase()
        if (!PRIORITY_OPTIONS.includes(pr)) { warns.push(`Row ${rowNum}: priority "${obj.priority}" not recognised, defaulted to "medium"`); pr = 'medium' }
        obj.priority = pr

        if (!obj.estimated_hours) obj.estimated_hours = null
        if (!obj.actual_hours) obj.actual_hours = null

        obj.assigned_to = null
        if (obj.assignee_name) {
          const u = (lookups?.users || []).find(u => u.full_name?.toLowerCase().trim() === obj.assignee_name.toLowerCase().trim())
          if (u) obj.assigned_to = u.id
          else warns.push(`Row ${rowNum}: assignee "${obj.assignee_name}" not found in the team — left unassigned`)
        }

        obj.sprint_id = null
        if (obj.sprint_name) {
          const sp = (lookups?.sprints || []).find(s => s.name?.toLowerCase().trim() === obj.sprint_name.toLowerCase().trim())
          if (sp) obj.sprint_id = sp.id
          else warns.push(`Row ${rowNum}: sprint "${obj.sprint_name}" not found in this project — left unassigned`)
        }

        obj.user_story_id = null
        if (obj.story_title) {
          const st = (lookups?.stories || []).find(s => s.title?.toLowerCase().trim() === obj.story_title.toLowerCase().trim() || s.story_id?.toLowerCase() === obj.story_title.toLowerCase().trim())
          if (st) obj.user_story_id = st.id
          else warns.push(`Row ${rowNum}: story "${obj.story_title}" not found in this project — left unlinked`)
        }

        for (const d of ['planned_start_date','planned_end_date']) {
          if (obj[d] && !/^\d{4}-\d{2}-\d{2}/.test(obj[d])) warns.push(`Row ${rowNum}: ${d} "${obj[d]}" — ensure format is YYYY-MM-DD`)
        }
      }

      if (type === 'employees') {
        const existing = (lookups?.users || []).find(u => u.email?.toLowerCase().trim() === obj.email.toLowerCase().trim())
        if (existing) obj._profileId = existing.id
        else { warns.push(`Row ${rowNum}: no existing account found for "${obj.email}" — row skipped`); hasError = true }

        obj.department_id = null
        if (obj.department_name) {
          const d = (lookups?.departments || []).find(d => d.name?.toLowerCase().trim() === obj.department_name.toLowerCase().trim())
          if (d) obj.department_id = d.id
          else warns.push(`Row ${rowNum}: department "${obj.department_name}" not found — left unchanged`)
        }

        obj.reporting_manager_id = null
        if (obj.reporting_manager_email) {
          const m = (lookups?.users || []).find(u => u.email?.toLowerCase().trim() === obj.reporting_manager_email.toLowerCase().trim())
          if (m) obj.reporting_manager_id = m.id
          else warns.push(`Row ${rowNum}: manager "${obj.reporting_manager_email}" not found — left unchanged`)
        }

        if (obj.employment_type && !EMPLOYMENT_TYPE_OPTIONS.includes(obj.employment_type)) {
          warns.push(`Row ${rowNum}: employment_type "${obj.employment_type}" not recognised — left unchanged`)
          obj.employment_type = ''
        }
      }

      if (type === 'employee_skills') {
        obj.employee_id = null
        if (obj.employee_email) {
          const u = (lookups?.users || []).find(u => u.email?.toLowerCase().trim() === obj.employee_email.toLowerCase().trim())
          if (u) obj.employee_id = u.id
          else { warns.push(`Row ${rowNum}: no existing account found for "${obj.employee_email}" — row skipped`); hasError = true }
        }

        obj.skill_id = null
        if (obj.skill_name) {
          const sk = (lookups?.skills || []).find(s => s.skill_name?.toLowerCase().trim() === obj.skill_name.toLowerCase().trim())
          if (sk) obj.skill_id = sk.id
          else { warns.push(`Row ${rowNum}: skill "${obj.skill_name}" not found in the Skill Matrix catalog — row skipped`); hasError = true }
        }

        let pl = obj.proficiency_level
        if (!PROFICIENCY_OPTIONS.includes(pl)) { warns.push(`Row ${rowNum}: proficiency_level "${pl}" not recognised, defaulted to "Beginner"`); pl = 'Beginner' }
        obj.proficiency_level = pl
        obj.certified = ['yes','true','1'].includes(String(obj.certified).toLowerCase().trim())
      }

      if (type === 'bom') {
        const partKey = (obj.component_part_number || '').toLowerCase().trim()
        const match = (lookups?.products || []).find(p => p.part_number?.toLowerCase().trim() === partKey)
        if (!match) { warns.push(`Row ${rowNum}: component part "${obj.component_part_number}" not found in Products catalog — row skipped`); hasError = true }
        else if (lookups?.currentPartNumber && match.part_number === lookups.currentPartNumber) { warns.push(`Row ${rowNum}: a product cannot be its own component — row skipped`); hasError = true }
        else {
          // component_name/component_id/per_unit_cost/quantity_stock are never
          // trusted from the file — always re-derived from the live Products
          // catalog so a stale or edited sheet can't smuggle in wrong data.
          obj.component_part_number = match.part_number
          obj.component_name = match.name
          obj.component_id = match.id
          obj.per_unit_cost = rupee(Number(match.standard_cost || 0))
          if (match.is_serialized) {
            const stock = lookups?.stockByPart?.[match.part_number]
            obj.quantity_stock = stock != null ? `${stock} in stock` : 'not shown'
          } else {
            obj.quantity_stock = `Reorder @ ${match.reorder_level ?? '—'}`
          }
          const reqQty = Number(String(obj.required_quantity_for_product).replace(/[₹,\s]/g, ''))
          obj.required_quantity_for_product = (!reqQty || reqQty <= 0) ? 1 : reqQty
        }
      }

      if (!hasError) cleaned.push(obj)
    })

    setRows(cleaned)
    setErrors(errs)
    setWarnings(warns)
    setStep('preview')
  }

  async function doImport() {
    if (!rows.length) return
    setImporting(true)
    try {
      // Employees: this is an update-by-account, not a row insert — this app has no
      // service-role key to create logins, only the anon key (see src/lib/supabase.js),
      // so unmatched emails were already skipped in validateAndPreview.
      if (type === 'employees') {
        let inserted = 0
        for (const r of rows) {
          const payload = {}
          if (r.full_name) payload.full_name = r.full_name
          if (r.role) payload.role = r.role
          if (r.department_id) payload.department_id = r.department_id
          if (r.reporting_manager_id) payload.reporting_manager_id = r.reporting_manager_id
          if (r.employment_type) payload.employment_type = r.employment_type
          if (r.default_weekly_capacity_hours) payload.default_weekly_capacity_hours = r.default_weekly_capacity_hours
          if (r.date_joined) payload.date_joined = r.date_joined
          if (Object.keys(payload).length === 0) continue
          const { error } = await supabase.from('profiles').update(payload).eq('id', r._profileId)
          if (!error) inserted++
        }
        setResult({ success: inserted, total: rows.length })
        setStep('result')
        if (onSuccess) onSuccess(inserted)
        return
      }

      if (type === 'bom') {
        if (onImportRows) onImportRows(rows)
        setResult({ success: rows.length, total: rows.length })
        setStep('result')
        if (onSuccess) onSuccess(rows.length)
        return
      }

      if (type === 'employee_skills') {
        const payloads = rows.map(r => ({
          employee_id: r.employee_id, skill_id: r.skill_id, proficiency_level: r.proficiency_level,
          years_experience: r.years_experience || 0, certified: r.certified,
          last_updated: new Date().toISOString(),
        }))
        const CHUNK = 100
        let inserted = 0
        for (let i = 0; i < payloads.length; i += CHUNK) {
          const chunk = payloads.slice(i, i + CHUNK)
          const { error } = await supabase.from('employee_skills').upsert(chunk, { onConflict: 'employee_id,skill_id' })
          if (error) throw new Error(`Batch ${Math.floor(i / CHUNK) + 1}: ${error.message}`)
          inserted += chunk.length
        }
        setResult({ success: inserted, total: rows.length })
        setStep('result')
        if (onSuccess) onSuccess(inserted)
        return
      }

      const payloads = rows.map((r, i) => {
        let p
        if (type === 'tasks') {
          // Whitelist real project_tasks columns — assignee_name/sprint_name/story_title
          // are display-only lookups already resolved into assigned_to/sprint_id/user_story_id.
          p = {
            task_name: r.task_name, task_type: r.task_type, module_name: r.module_name || null,
            priority: r.priority, assigned_to: r.assigned_to || null, status: 'backlog',
            planned_start_date: r.planned_start_date || null, planned_end_date: r.planned_end_date || null,
            estimated_hours: r.estimated_hours, actual_hours: r.actual_hours,
            user_story_id: r.user_story_id || null, sprint_id: r.sprint_id || null,
            description: r.description || null, project_id: projectId, created_by: profile.id,
          }
        } else {
          p = { ...r, created_by: profile.id }
          if (projectId) p.project_id = projectId
          // Expenses need extra fields
          if (type === 'expenses') {
            p.requested_by    = profile.id
            p.status          = 'draft'
            p.total_amount    = parseFloat(r.amount) || 0
          }
          // Components are always non-serialized (bulk/consumable) products —
          // serialized devices go through the Products page's own form instead.
          if (type === 'components') {
            p.is_serialized = false
            if (!p.part_number) p.part_number = `CMP-${Date.now().toString().slice(-6)}-${i}`
            if (!p.status) p.status = 'active'
          }
        }
        // Remove empty strings → null
        Object.keys(p).forEach(k => { if (p[k] === '') p[k] = null })
        return p
      })

      // Batch insert in chunks of 100
      const CHUNK = 100
      let inserted = 0
      for (let i = 0; i < payloads.length; i += CHUNK) {
        const chunk = payloads.slice(i, i + CHUNK)
        const { error } = await supabase.from(tmpl.table).insert(chunk)
        if (error) throw new Error(`Batch ${Math.floor(i/CHUNK)+1}: ${error.message}`)
        inserted += chunk.length
      }

      setResult({ success: inserted, total: rows.length })
      setStep('result')
      if (onSuccess) onSuccess(inserted)
    } catch(e) {
      setErrors(prev => [...prev, `Import failed: ${e.message}`])
    } finally {
      setImporting(false)
    }
  }

  function reset() { setStep('upload'); setRows([]); setErrors([]); setWarnings([]); setResult(null); setFileName('') }

  return (
    <div style={{ fontFamily:'var(--font-body)' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:15, color:'var(--text)' }}>Import {tmpl.label}</div>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:3 }}>Upload CSV or Excel file to bulk-import records</div>
        </div>
        <button onClick={() => downloadTemplate(type, lookups)}
          style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:7, border:'1px solid var(--border)', background:'var(--surface-2)', cursor:'pointer', fontSize:12, color:'var(--text-soft)', fontFamily:'inherit' }}>
          <Download size={13}/> Download Template
        </button>
      </div>

      {/* Progress steps */}
      <div style={{ display:'flex', gap:0, marginBottom:20 }}>
        {['upload','preview','result'].map((s, i) => (
          <div key={s} style={{ flex:1, display:'flex', alignItems:'center' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, flex:1 }}>
              <div style={{ width:24, height:24, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700,
                background: step===s?'var(--c1)': ['upload','preview','result'].indexOf(step)>i?'var(--emerald)':'var(--bg-3)',
                color: step===s||['upload','preview','result'].indexOf(step)>i?'#fff':'var(--text-muted)', flexShrink:0 }}>
                {['upload','preview','result'].indexOf(step)>i?'✓':i+1}
              </div>
              <span style={{ fontSize:12, fontWeight:step===s?600:400, color:step===s?'var(--c1)':'var(--text-muted)', textTransform:'capitalize' }}>{s}</span>
            </div>
            {i<2&&<div style={{ height:1, flex:1, background:'var(--border)', margin:'0 8px' }}/>}
          </div>
        ))}
      </div>

      {/* ── STEP 1: UPLOAD ── */}
      {step==='upload' && (
        <div>
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e=>e.preventDefault()}
            onDrop={e=>{e.preventDefault();handleFile(e.dataTransfer.files[0])}}
            style={{ border:'2px dashed var(--border-2)', borderRadius:12, padding:'40px 20px', textAlign:'center', cursor:'pointer', transition:'all .15s', background:'var(--surface-2)' }}
            onMouseEnter={e=>e.currentTarget.style.borderColor='var(--c1)'}
            onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border-2)'}>
            <FileSpreadsheet size={36} style={{ color:'var(--c1)', margin:'0 auto 12px' }}/>
            <div style={{ fontWeight:600, fontSize:14, marginBottom:6 }}>Drop your file here or click to browse</div>
            <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:16 }}>Supports CSV (.csv) and Excel (.xlsx, .xls)</div>
            <div style={{ display:'inline-flex', gap:6, flexWrap:'wrap', justifyContent:'center' }}>
              {['.csv','.xlsx','.xls'].map(ext=>(
                <span key={ext} style={{ padding:'3px 10px', borderRadius:4, background:'var(--c1-soft)', color:'var(--c1)', fontSize:11, fontWeight:600 }}>{ext}</span>
              ))}
            </div>
          </div>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display:'none' }} onChange={e=>handleFile(e.target.files[0])}/>

          {/* Required columns */}
          <div style={{ marginTop:20, padding:'14px 16px', borderRadius:8, background:'var(--surface-2)', border:'1px solid var(--border)' }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:10 }}>Expected columns</div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:8 }}>
              {tmpl.columns.map(col=>(
                <span key={col} style={{ padding:'3px 8px', borderRadius:4, fontSize:11, fontWeight:600,
                  background: tmpl.required.includes(col)?'rgba(59,130,246,.1)':'var(--bg-3)',
                  color: tmpl.required.includes(col)?'var(--c1)':'var(--text-muted)',
                  border:`1px solid ${tmpl.required.includes(col)?'rgba(59,130,246,.3)':'var(--border)'}` }}>
                  {col}{tmpl.required.includes(col)?'*':''}
                </span>
              ))}
            </div>
            <div style={{ fontSize:11, color:'var(--text-muted)' }}>* Required fields &nbsp;·&nbsp; {tmpl.notes}</div>
          </div>
        </div>
      )}

      {/* ── STEP 2: PREVIEW ── */}
      {step==='preview' && (
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, flexWrap:'wrap' }}>
            <div style={{ display:'flex', alignItems:'center', gap:7, padding:'6px 12px', borderRadius:7, background:'var(--surface-2)', border:'1px solid var(--border)', fontSize:12 }}>
              <FileSpreadsheet size={14} style={{ color:'var(--c1)' }}/> {fileName}
            </div>
            <div style={{ fontSize:12, color:'var(--text-muted)' }}>{rows.length} valid row{rows.length!==1?'s':''} ready to import</div>
            <button onClick={reset} style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:5, padding:'5px 10px', borderRadius:6, border:'1px solid var(--border)', background:'transparent', cursor:'pointer', fontSize:11, color:'var(--text-muted)', fontFamily:'inherit' }}>
              <X size={11}/> Change file
            </button>
          </div>

          {/* Errors */}
          {errors.length>0 && (
            <div style={{ marginBottom:12, padding:'12px 14px', borderRadius:8, background:'rgba(244,63,94,.06)', border:'1px solid rgba(244,63,94,.2)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:8, fontSize:12, fontWeight:700, color:'var(--rose)' }}>
                <AlertTriangle size={14}/> {errors.length} error{errors.length!==1?'s':''} found — these rows will be skipped
              </div>
              {errors.map((e,i)=><div key={i} style={{ fontSize:11, color:'var(--rose)', marginBottom:3 }}>• {e}</div>)}
            </div>
          )}

          {/* Warnings */}
          {warnings.length>0 && (
            <div style={{ marginBottom:12, padding:'12px 14px', borderRadius:8, background:'rgba(245,158,11,.06)', border:'1px solid rgba(245,158,11,.2)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:6, fontSize:12, fontWeight:700, color:'var(--amber)' }}>
                <AlertTriangle size={14}/> {warnings.length} warning{warnings.length!==1?'s':''}
              </div>
              {warnings.map((w,i)=><div key={i} style={{ fontSize:11, color:'var(--amber)', marginBottom:3 }}>• {w}</div>)}
            </div>
          )}

          {/* Preview table */}
          {rows.length>0 && (
            <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden', marginBottom:16 }}>
              <div style={{ padding:'10px 14px', background:'var(--surface-2)', borderBottom:'1px solid var(--border)', fontSize:12, fontWeight:600 }}>
                Preview — first {Math.min(rows.length,5)} of {rows.length} rows
              </div>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', minWidth:400 }}>
                  <thead>
                    <tr style={{ background:'rgba(0,0,0,.1)' }}>
                      {tmpl.columns.filter(c=>rows[0]?.[c]!==undefined||rows[0]?.[c]==='').map(col=>(
                        <th key={col} style={{ padding:'7px 12px', textAlign:'left', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', color:'var(--text-muted)', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0,5).map((row,i)=>(
                      <tr key={i} style={{ borderBottom:'1px solid var(--border)' }}>
                        {tmpl.columns.map(col=>(
                          <td key={col} style={{ padding:'7px 12px', fontSize:12, color:'var(--text)', maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {tmpl.formatCurrency && typeof row[col]==='number' ? rupee(row[col]) : (row[col] ?? '') !== '' ? row[col] : <span style={{ color:'var(--text-muted)' }}>—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length>5 && <div style={{ padding:'8px 14px', fontSize:11, color:'var(--text-muted)', background:'var(--surface-2)', borderTop:'1px solid var(--border)' }}>...and {rows.length-5} more rows</div>}
            </div>
          )}

          <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
            <button onClick={reset} className="btn btn-ghost">Cancel</button>
            <button onClick={doImport} disabled={importing||rows.length===0}
              style={{ display:'flex', alignItems:'center', gap:7, padding:'9px 20px', borderRadius:8, border:'none', background:rows.length===0?'var(--surface-2)':'var(--c1)', color:rows.length===0?'var(--text-muted)':'#fff', fontWeight:600, fontSize:13, cursor:rows.length===0?'not-allowed':'pointer', fontFamily:'inherit', transition:'all .15s' }}>
              {importing ? <>Importing…</> : <><Upload size={14}/> Import {rows.length} row{rows.length!==1?'s':''}</>}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: RESULT ── */}
      {step==='result' && result && (
        <div style={{ textAlign:'center', padding:'20px 0' }}>
          <div style={{ width:64, height:64, borderRadius:'50%', background:'rgba(16,185,129,.12)', border:'2px solid rgba(16,185,129,.3)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px' }}>
            <CheckCircle size={32} style={{ color:'var(--emerald)' }}/>
          </div>
          <div style={{ fontFamily:'var(--font-head)', fontWeight:800, fontSize:22, marginBottom:8 }}>Import complete!</div>
          <div style={{ fontSize:14, color:'var(--text-muted)', marginBottom:20 }}>
            Successfully imported <strong style={{ color:'var(--emerald)' }}>{result.success}</strong> of {result.total} rows into {tmpl.label}
          </div>
          <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
            <button onClick={reset} style={{ padding:'9px 20px', borderRadius:8, border:'1px solid var(--border)', background:'var(--surface-2)', cursor:'pointer', fontSize:13, fontFamily:'inherit', color:'var(--text-soft)' }}>
              Import more
            </button>
            <button onClick={onClose} style={{ padding:'9px 20px', borderRadius:8, border:'none', background:'var(--c1)', color:'#fff', fontWeight:600, fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
