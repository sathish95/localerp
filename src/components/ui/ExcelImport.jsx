import { useState, useRef } from 'react'
import { supabase, rupee, dateFmt } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { Upload, Download, X, CheckCircle, AlertTriangle, FileSpreadsheet } from 'lucide-react'

/* ── Template definitions ── */
export const TEMPLATES = {
  hardware: {
    label: 'Hardware Costs',
    table: 'project_hardware_costs',
    columns: ['name','category','qty','unit_price','cost_company','cost_client','proposal_cost','vendor','notes'],
    required: ['name','qty','unit_price'],
    types:    { qty:'number', unit_price:'number', cost_company:'number', cost_client:'number', proposal_cost:'number' },
    sample: [
      ['Raspberry Pi 4 (4GB)','component','10','4500','45000','58500','67500','Element14','Main controller boards'],
      ['PCB Assembly','assembly','50','800','40000','52000','60000','TechMfg Ltd','Custom PCBs'],
      ['Shipping & Logistics','logistics','1','12000','12000','15600','18000','DHL Express',''],
    ],
    notes: 'cost_company auto-fills as qty × unit_price if blank. cost_client = ×1.3, proposal = ×1.5',
  },
  software: {
    label: 'Software Costs',
    table: 'project_software_costs',
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
function downloadTemplate(type) {
  const tmpl = TEMPLATES[type]
  const header = tmpl.columns.join(',')
  const rows   = tmpl.sample.map(r => r.map(v => `"${v}"`).join(','))
  const csv    = [header, ...rows].join('\n')
  const blob   = new Blob([csv], { type:'text/csv' })
  const a      = document.createElement('a')
  a.href       = URL.createObjectURL(blob)
  a.download   = `thingsalive-${type}-import-template.csv`
  a.click()
}

/* ══ Main Component ══════════════════════════════════════════ */
export default function ExcelImport({ type, projectId, onSuccess, onClose }) {
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
      const payloads = rows.map(r => {
        const p = { ...r, created_by: profile.id }
        if (projectId) p.project_id = projectId
        // Expenses need extra fields
        if (type === 'expenses') {
          p.requested_by    = profile.id
          p.status          = 'draft'
          p.total_amount    = parseFloat(r.amount) || 0
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
        <button onClick={() => downloadTemplate(type)}
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
                            {typeof row[col]==='number' ? rupee(row[col]) : row[col] || <span style={{ color:'var(--text-muted)' }}>—</span>}
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
