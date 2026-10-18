import { useState, useRef } from 'react'
import { supabase, rupee, dateFmt, adminCreateUser, adminFinalizeNewProfile } from '../../lib/supabase'
import { createDeviceWarranty } from '../../lib/warranty'
import { useAuth } from '../../context/AuthContext'
import { Upload, Download, X, CheckCircle, AlertTriangle, FileSpreadsheet, KeyRound } from 'lucide-react'

// Same 14-char generator UsersPage.jsx uses for the single "Add User"
// flow — duplicated rather than imported since it's a five-line pure
// function and importing it would mean exporting a page-local helper
// out of a page component for a one-off reuse.
function genTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$'
  let out = ''
  for (let i = 0; i < 14; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

const TASK_TYPE_OPTIONS = ['task','bug','change_request','feature','improvement']
const PRIORITY_OPTIONS  = ['critical','high','medium','low']
const EMPLOYMENT_TYPE_OPTIONS = ['FTE','Contractor','Intern']
const PROFICIENCY_OPTIONS = ['Beginner','Intermediate','Expert','Master']
const DEVICE_STATUS_OPTIONS = ['deployed','in_storage','faulty','replaced','decommissioned']

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
  new_employees: {
    label: 'New Employees (creates logins)',
    table: null, // special-cased in doImport — creates a real auth account per row, not a table insert
    formatCurrency: false,
    columns: ['full_name','email','role','designation','department_name','reporting_manager_email','employment_type','phone','date_joined'],
    required: ['full_name','email'],
    types: {},
    sample: [
      ['Priya Sharma','priya.sharma@thingsalive.in','employee','Software Engineer','Engineering','rahul.verma@thingsalive.in','FTE','+91 9876543210','2026-01-15'],
      ['Arjun Rao','arjun.rao@thingsalive.in','manager','Engineering Manager','Engineering','','FTE','+91 9876500000','2025-06-01'],
    ],
    notes: 'Creates a brand-new login for every row — this app has no admin bulk-create API (no service-role key), so each account is created one at a time via the same sign-up path as "Add User", with a random temp password. A results file with every temp password is offered for download at the end — that is the only place those passwords are shown. email must NOT already have an account. department_name/reporting_manager_email must match an existing department/employee (case-insensitive) — leave blank to skip. role defaults to "employee" if left blank.',
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
  devices: {
    label: 'Device Instances',
    table: 'device_instances',
    formatCurrency: false,
    columns: ['device_code', 'part_number', 'serial_number', 'customer_name', 'project_name', 'status', 'installed_date', 'current_location', 'equipment_id', 'equipment_name', 'equipment_category', 'firmware_version', 'sensors', 'notes'],
    required: ['part_number', 'serial_number'],
    types: {},
    sample: [
      ['', 'CMP-1001', 'SN-2026-00123', 'CemIndia Cement Ltd', 'CemIndia Fleet IoT Rollout', 'deployed', '2026-01-15', 'Chandrapur Quarry', 'DT-12', 'Dumper Truck #12', 'Dumper', '2.4.1', 'Fuel level sensor; Engine coolant temperature sensor', ''],
      ['', 'CMP-1001', 'SN-2026-00124', '', '', 'in_storage', '', 'Main Warehouse', '', '', '', '', '', ''],
    ],
    notes: 'Rows whose device_code (or, failing that, serial_number) matches an existing device UPDATE that device — so Export → edit → Import round-trips; blank cells clear the field, except status (blank keeps the current one). Other rows are created as new devices. firmware_version: from the product’s firmware release list (other versions are saved but flagged). sensors: sensor names from the Sensor catalog separated by ";" — the device’s sensor list is set to exactly these (missing ones added, unlisted ones marked removed); leave blank to keep its sensors as they are (a new device still gets its equipment category’s defaults). equipment_id / equipment_name / equipment_category: the machine the device is fitted to (e.g. DT-12 / "Dumper Truck #12" / Dumper) — copied onto go-live enrollments. device_code is auto-generated if left blank. part_number must match an existing serialized Product (case-insensitive) — unmatched rows are skipped. customer_name/project_name match by exact name (case-insensitive) — leave blank to skip. status: deployed/in_storage/faulty/replaced/decommissioned (defaults to in_storage). If installed_date is set, the warranty clock starts automatically — warranty_start/warranty_end are computed from the matched Product’s Warranty Policy (or its default warranty_months, or 12 months if neither exists), same as registering a device one at a time.',
  },
}

// Excel cells formatted as dates come back from SheetJS's sheet_to_csv()
// rendered in whatever display format the sheet used (commonly DD-MM-YYYY
// or DD/MM/YYYY outside the US) — Postgres' date parser expects ISO or
// MM-DD-YYYY and throws "date/time field value out of range" (22008) the
// moment the day part exceeds 12, e.g. "17-09-2026". This normalizes any
// recognisable input to YYYY-MM-DD before it ever reaches Supabase; ISO
// datestyle is assumed as the app-wide convention (matches dateFmt()'s
// en-IN "DD MMM YYYY" *display* format, but every date column elsewhere
// is already stored/sent as ISO).
function normalizeDate(val) {
  if (!val) return ''
  const s = String(val).trim()
  if (!s) return ''

  // Already ISO (optionally with a time part SheetJS sometimes appends)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  // DD-MM-YYYY / DD/MM/YYYY (and the MM-first variant, disambiguated
  // whenever one part is unambiguously > 12)
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (dmy) {
    let [, a, b, y] = dmy
    let day = +a, month = +b
    if (day > 12 && month <= 12) { /* a is day, b is month — as parsed */ }
    else if (month > 12 && day <= 12) { day = +b; month = +a }
    // else ambiguous (both <= 12) — default to DD-MM (this app's locale)
    if (day < 1 || day > 31 || month < 1 || month > 12) return ''
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  // Excel serial date number (epoch 1899-12-30, i.e. day 0)
  if (/^\d{4,6}$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + (+s) * 86400000)
    if (!isNaN(d)) return d.toISOString().slice(0, 10)
  }

  const d = new Date(s)
  return isNaN(d) ? '' : d.toISOString().slice(0, 10)
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

/* ── Download the temp-password results after a new_employees import —
 * the only place these passwords are ever shown, so this is the admin's
 * one chance to capture them before distributing to each new hire. ── */
function downloadCredentials(credentials) {
  const header = 'full_name,email,temp_password,status'
  const rows = credentials.map(c => [c.full_name, c.email, c.password, c.status].map(v => `"${v}"`).join(','))
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'new-employee-credentials.csv'
  a.click()
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

  // Devices: use real serialized part numbers from the Products catalog
  // instead of made-up placeholders — a device_instances row must match an
  // actual serialized Product, so a template built from fictional part
  // numbers (e.g. "CMP-1001") would fail validation on every row.
  if (type === 'devices' && lookups?.products?.length) {
    sampleRows = lookups.products.slice(0, 10).map(p => ['', p.part_number || '', '', '', '', 'in_storage', '', '', '', '', '', '', '', ''])
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
    const seenDevices = new Set()

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
        if (obj.expense_date) {
          const norm = normalizeDate(obj.expense_date)
          if (!norm) { warns.push(`Row ${rowNum}: expense_date "${obj.expense_date}" — unrecognised date, left blank`); }
          else if (norm !== obj.expense_date) warns.push(`Row ${rowNum}: expense_date "${obj.expense_date}" read as ${norm}`)
          obj.expense_date = norm
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
          if (obj[d]) {
            const norm = normalizeDate(obj[d])
            if (!norm) warns.push(`Row ${rowNum}: ${d} "${obj[d]}" — unrecognised date, left blank`)
            else if (norm !== obj[d]) warns.push(`Row ${rowNum}: ${d} "${obj[d]}" read as ${norm}`)
            obj[d] = norm
          }
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

        if (obj.date_joined) {
          const norm = normalizeDate(obj.date_joined)
          if (!norm) warns.push(`Row ${rowNum}: date_joined "${obj.date_joined}" — unrecognised date, left unchanged`)
          else if (norm !== obj.date_joined) warns.push(`Row ${rowNum}: date_joined "${obj.date_joined}" read as ${norm}`)
          obj.date_joined = norm
        }
      }

      if (type === 'new_employees') {
        const existing = (lookups?.users || []).find(u => u.email?.toLowerCase().trim() === obj.email.toLowerCase().trim())
        if (existing) { warns.push(`Row ${rowNum}: "${obj.email}" already has an account — row skipped`); hasError = true }

        if (!obj.role) obj.role = 'employee'

        obj.department_id = null
        if (obj.department_name) {
          const d = (lookups?.departments || []).find(d => d.name?.toLowerCase().trim() === obj.department_name.toLowerCase().trim())
          if (d) obj.department_id = d.id
          else warns.push(`Row ${rowNum}: department "${obj.department_name}" not found — left blank`)
        }

        obj.reporting_manager_id = null
        if (obj.reporting_manager_email) {
          const m = (lookups?.users || []).find(u => u.email?.toLowerCase().trim() === obj.reporting_manager_email.toLowerCase().trim())
          if (m) obj.reporting_manager_id = m.id
          else warns.push(`Row ${rowNum}: manager "${obj.reporting_manager_email}" not found — left blank`)
        }

        if (obj.employment_type && !EMPLOYMENT_TYPE_OPTIONS.includes(obj.employment_type)) {
          warns.push(`Row ${rowNum}: employment_type "${obj.employment_type}" not recognised — left blank`)
          obj.employment_type = ''
        }

        if (obj.date_joined) {
          const norm = normalizeDate(obj.date_joined)
          if (!norm) warns.push(`Row ${rowNum}: date_joined "${obj.date_joined}" — unrecognised date, left blank`)
          else if (norm !== obj.date_joined) warns.push(`Row ${rowNum}: date_joined "${obj.date_joined}" read as ${norm}`)
          obj.date_joined = norm
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

      if (type === 'devices') {
        // existing device → update (by device_code, then serial_number)
        const lc = v => String(v ?? '').toLowerCase().trim()
        const all = lookups?.devices || []
        const byCode = lc(obj.device_code) ? all.find(d => lc(d.device_code) === lc(obj.device_code)) : null
        const bySerial = all.find(d => lc(d.serial_number) === lc(obj.serial_number))
        if (lc(obj.device_code) && !byCode) { warns.push(`Row ${rowNum}: device_code "${obj.device_code}" not found — ${bySerial ? `matched ${bySerial.device_code} by serial number` : 'created as a new device with that code'}`) }
        const existing = byCode || bySerial || null
        if (existing && bySerial && bySerial.id !== existing.id) {
          errs.push(`Row ${rowNum}: serial number "${obj.serial_number}" already belongs to ${bySerial.device_code}, not ${existing.device_code} — row skipped`); hasError = true
        }
        const key = existing?.id || `new:${lc(obj.serial_number)}`
        if (seenDevices.has(key)) { errs.push(`Row ${rowNum}: ${existing?.device_code || obj.serial_number} appears more than once in the file — only the first row is used`); hasError = true }
        seenDevices.add(key)
        obj._existing = existing

        const partKey = (obj.part_number || '').toLowerCase().trim()
        const match = (lookups?.products || []).find(p => p.part_number?.toLowerCase().trim() === partKey)
        if (match) obj.part_number = match.part_number
        // an existing device keeps its part number even if that product is no longer active
        else if (existing && lc(existing.part_number) === partKey) obj.part_number = existing.part_number
        else { warns.push(`Row ${rowNum}: part number "${obj.part_number}" not found among serialized Products — row skipped`); hasError = true }

        obj.customer_id = null
        if (obj.customer_name) {
          const c = (lookups?.customers || []).find(c => c.name?.toLowerCase().trim() === obj.customer_name.toLowerCase().trim())
          if (c) obj.customer_id = c.id
          else if (existing) { obj.customer_id = existing.customer_id || null; warns.push(`Row ${rowNum}: customer "${obj.customer_name}" not found — kept the current customer`) }
          else warns.push(`Row ${rowNum}: customer "${obj.customer_name}" not found — left unassigned`)
        }

        obj.project_id = null
        if (obj.project_name) {
          const pr = (lookups?.projects || []).find(p => p.name?.toLowerCase().trim() === obj.project_name.toLowerCase().trim())
          if (pr) obj.project_id = pr.id
          else if (existing) { obj.project_id = existing.project_id || null; warns.push(`Row ${rowNum}: project "${obj.project_name}" not found — kept the current project`) }
          else warns.push(`Row ${rowNum}: project "${obj.project_name}" not found — left unassigned`)
        }

        let st = (obj.status || existing?.status || 'in_storage').toLowerCase().trim()
        if (!DEVICE_STATUS_OPTIONS.includes(st)) { warns.push(`Row ${rowNum}: status "${obj.status}" not recognised, defaulted to "in_storage"`); st = 'in_storage' }
        obj.status = st

        if (obj.firmware_version) {
          obj.firmware_version = String(obj.firmware_version).trim()
          const list = (lookups?.releases || []).filter(r => r.part_number === obj.part_number)
          if (list.length && !list.some(r => r.version === obj.firmware_version)) warns.push(`Row ${rowNum}: firmware "${obj.firmware_version}" is not in ${obj.part_number}'s release list — saved and flagged`)
          else if (list.find(r => r.version === obj.firmware_version)?.status === 'DEPRECATED') warns.push(`Row ${rowNum}: firmware ${obj.firmware_version} is deprecated`)
        }
        obj._sensorTypeIds = null
        if (String(obj.sensors || '').trim()) {
          const names = String(obj.sensors).split(/[;\n]+/).map(x => x.trim()).filter(Boolean)
          const ids = []
          for (const n of names) {
            const t = (lookups?.sensorTypes || []).find(t => t.name.toLowerCase() === n.toLowerCase())
            if (t) ids.push(t.id); else warns.push(`Row ${rowNum}: sensor "${n}" is not in the Sensor catalog — skipped`)
          }
          obj._sensorTypeIds = [...new Set(ids)]
        }

        if (obj.installed_date) {
          const norm = normalizeDate(obj.installed_date)
          if (!norm) warns.push(`Row ${rowNum}: installed_date "${obj.installed_date}" — unrecognised date, left blank`)
          else if (norm !== obj.installed_date) warns.push(`Row ${rowNum}: installed_date "${obj.installed_date}" read as ${norm}`)
          obj.installed_date = norm
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

      // New employees: one supabase.auth.signUp() per row, sequential —
      // not Promise.all, so one row's auth error can't be misattributed
      // to another and so a duplicate-email or rate-limit error on row 3
      // still lets rows 4+ complete instead of aborting the whole batch.
      if (type === 'new_employees') {
        const credentials = []
        for (const r of rows) {
          const tempPassword = genTempPassword()
          try {
            const { user } = await adminCreateUser(r.email, tempPassword, { full_name: r.full_name, role: r.role })
            if (!user?.id) throw new Error('Account creation did not return a user')
            // adminCreateUser()'s signUp() carries no org_mode metadata, so
            // the handle_new_user() trigger lands this profile in
            // 'default-org', not the importing admin's real org — and a
            // plain .update() from here can't fix that (RLS blocks it).
            // admin_finalize_new_profile (STEP196) reassigns the org AND
            // applies the extra fields in one call — always run it, even
            // with zero extra fields, since the org fix alone is required.
            await adminFinalizeNewProfile(user.id, {
              designation: r.designation || null,
              department_id: r.department_id || null,
              reporting_manager_id: r.reporting_manager_id || null,
              employment_type: r.employment_type || null,
              phone: r.phone || null,
              date_joined: r.date_joined || null,
            })
            credentials.push({ full_name: r.full_name, email: r.email, password: tempPassword, status: 'created' })
          } catch (e) {
            credentials.push({ full_name: r.full_name, email: r.email, password: '', status: `failed: ${e.message}` })
          }
        }
        const successCount = credentials.filter(c => c.status === 'created').length
        setResult({ success: successCount, total: rows.length, credentials })
        setStep('result')
        if (onSuccess) onSuccess(successCount)
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

      if (type === 'devices') {
        // Whitelist real device_instances columns — customer_name/project_name
        // are display-only lookups already resolved into customer_id/project_id.
        const fields = r => {
          const p = {
            part_number: r.part_number, serial_number: r.serial_number,
            customer_id: r.customer_id || null, project_id: r.project_id || null,
            status: r.status, installed_date: r.installed_date || null,
            current_location: r.current_location || null, equipment_id: r.equipment_id || null, equipment_name: r.equipment_name || null,
            equipment_category: r.equipment_category || null, notes: r.notes || null,
          }
          // firmware (STEP242) only when the file uses it, so imports keep working before that step is run
          if (r.firmware_version || r._existing?.firmware_version) p.firmware_version = r.firmware_version || null
          Object.keys(p).forEach(k => { if (p[k] === '') p[k] = null })
          return p
        }
        const sensorPlan = [] // [deviceId, sensorTypeIds]
        const warrantyFor = []
        let inserted = 0, updated = 0
        const fresh = rows.filter(r => !r._existing).map((r, i) => ({ ...fields(r), device_code: r.device_code || `DEV-${Date.now().toString().slice(-6)}-${i}`, created_by: profile.id }))
        const CHUNK = 100
        for (let i = 0; i < fresh.length; i += CHUNK) {
          const chunk = fresh.slice(i, i + CHUNK)
          const { data, error } = await supabase.from(tmpl.table).insert(chunk).select('id, installed_date, project_id, serial_number')
          if (error) throw new Error(`Batch ${Math.floor(i / CHUNK) + 1}: ${error.message}`)
          inserted += chunk.length
          const newRows = rows.filter(r => !r._existing)
          ;(data || []).forEach(d => { const r = newRows.find(x => x.serial_number === d.serial_number); if (r?._sensorTypeIds) sensorPlan.push([d.id, r._sensorTypeIds]) })
          warrantyFor.push(...(data || []).filter(d => d.installed_date))
        }
        const failed = []
        for (const r of rows.filter(r => r._existing)) {
          const ex = r._existing
          const patch = fields(r)
          const { error } = await supabase.from(tmpl.table).update(patch).eq('id', ex.id)
          if (error) { failed.push(`${ex.device_code}: ${error.message}`); continue }
          updated++
          if (r._sensorTypeIds) sensorPlan.push([ex.id, r._sensorTypeIds])
          // install date set for the first time → start the warranty clock, as on insert
          if (patch.installed_date && !ex.installed_date) warrantyFor.push({ id: ex.id, installed_date: patch.installed_date, project_id: patch.project_id })
        }

        // Installation date present at import -> the warranty clock starts
        // immediately, same as the single "Register Device" form's behavior
        // (see DevicesPage.jsx). Sequential and best-effort per row: one
        // device's warranty failure can never roll back the import itself.
        for (const d of warrantyFor) {
          try {
            await createDeviceWarranty({ deviceId: d.id, deploymentDate: d.installed_date, projectId: d.project_id || null, profileId: profile.id })
          } catch (e) { console.error('Warranty activation failed for device', d.id, e) }
        }
        // sensor lists: add what's listed and missing, reactivate removed ones, mark unlisted ones removed
        let sensorChanges = 0
        if (sensorPlan.length) {
          try {
            const { data: current, error: sErr } = await supabase.from('device_sensors').select('id,device_id,sensor_type_id,status').in('device_id', sensorPlan.map(([id]) => id))
            if (sErr) throw sErr
            for (const [deviceId, want] of sensorPlan) {
              const mine = (current || []).filter(x => x.device_id === deviceId)
              for (const typeId of want) {
                const live = mine.find(x => x.sensor_type_id === typeId && x.status !== 'REMOVED')
                if (live) continue
                const gone = mine.find(x => x.sensor_type_id === typeId)
                const { error: e2 } = gone
                  ? await supabase.from('device_sensors').update({ status: 'ACTIVE' }).eq('id', gone.id)
                  : await supabase.from('device_sensors').insert({ device_id: deviceId, sensor_type_id: typeId, source: 'MANUAL' })
                if (e2) throw e2
                sensorChanges++
              }
              const drop = mine.filter(x => x.status !== 'REMOVED' && !want.includes(x.sensor_type_id)).map(x => x.id)
              if (drop.length) {
                const { error: e3 } = await supabase.from('device_sensors').update({ status: 'REMOVED' }).in('id', drop)
                if (e3) throw e3
                sensorChanges += drop.length
              }
            }
          } catch (e) { failed.push(`Sensors: ${/does not exist|schema cache/i.test(e.message) ? 'run sql/STEP243_device_sensors.sql first' : e.message}`) }
        }
        if (failed.length) setErrors(prev => [...prev, ...failed.map(f => `Update failed — ${f}`)])
        setResult({ success: inserted + updated, total: rows.length, inserted, updated, failed, sensorChanges })
        setStep('result')
        if (onSuccess) onSuccess(inserted + updated)
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
            <div style={{ fontSize:12, color:'var(--text-muted)' }}>{rows.length} valid row{rows.length!==1?'s':''} ready to import{type==='devices' && ` — ${rows.filter(r=>!r._existing).length} new, ${rows.filter(r=>r._existing).length} update existing devices`}</div>
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
        <div style={{ textAlign: result.credentials ? 'left' : 'center', padding: result.credentials ? '4px 0' : '20px 0' }}>
          {!result.credentials && (
            <div style={{ width:64, height:64, borderRadius:'50%', background:'rgba(16,185,129,.12)', border:'2px solid rgba(16,185,129,.3)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px' }}>
              <CheckCircle size={32} style={{ color:'var(--emerald)' }}/>
            </div>
          )}
          <div style={{ fontFamily:'var(--font-head)', fontWeight:800, fontSize: result.credentials ? 18 : 22, marginBottom:8, textAlign: result.credentials ? 'left' : 'center' }}>
            {result.credentials ? 'Accounts created' : 'Import complete!'}
          </div>
          <div style={{ fontSize:14, color:'var(--text-muted)', marginBottom:20 }}>
            Successfully {result.credentials ? 'created' : 'imported'} <strong style={{ color:'var(--emerald)' }}>{result.success}</strong> of {result.total} {result.credentials ? 'accounts' : 'rows'}{!result.credentials && ` into ${tmpl.label}`}
            {result.updated != null && <div style={{ fontSize:12, marginTop:6 }}>{result.inserted} new · {result.updated} updated{result.sensorChanges ? ` · ${result.sensorChanges} sensor change${result.sensorChanges === 1 ? '' : 's'}` : ''}</div>}
            {result.failed?.length > 0 && <div style={{ fontSize:12, marginTop:6, color:'var(--rose)' }}>{result.failed.map((f,i)=><div key={i}>{f}</div>)}</div>}
          </div>

          {result.credentials && (
            <>
              <div style={{ padding:'10px 14px', borderRadius:8, background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.25)', fontSize:12, color:'var(--amber)', display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
                <KeyRound size={14} style={{ flexShrink:0 }} /> These temporary passwords are shown once and not stored anywhere retrievable — download them now and share each one securely with that employee.
              </div>
              <div className="table-wrap" style={{ marginBottom:16, maxHeight:280, overflowY:'auto' }}>
                <table>
                  <thead><tr><th>Name</th><th>Email</th><th>Temp Password</th><th>Status</th></tr></thead>
                  <tbody>
                    {result.credentials.map((c,i) => (
                      <tr key={i}>
                        <td>{c.full_name}</td>
                        <td style={{ color:'var(--ink-muted)' }}>{c.email}</td>
                        <td style={{ fontFamily:'monospace', fontSize:12 }}>{c.password || '—'}</td>
                        <td style={{ color: c.status === 'created' ? '#15803d' : '#dc2626', fontSize:12 }}>{c.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:16 }}>
                <button className="btn btn-outline btn-sm" onClick={() => downloadCredentials(result.credentials)}><Download size={13}/> Download Credentials CSV</button>
              </div>
            </>
          )}

          <div style={{ display:'flex', gap:10, justifyContent: result.credentials ? 'flex-start' : 'center' }}>
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
