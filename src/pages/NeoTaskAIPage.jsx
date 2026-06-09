import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { analyzeRequirements, LLM_MODELS, getModel } from '../lib/llm'
import { useAuth } from '../context/AuthContext'
import { Loader } from '../components/ui'
import {
  Upload, FileText, Zap, CheckSquare, RotateCcw, ChevronDown, ChevronRight,
  Download, Plus, Check, X, Edit2, Trash2, AlertTriangle, Clock,
  Layers, BookOpen, ListChecks, Code2, TestTube2, Activity, Sparkles,
  ArrowRight, RefreshCw, Eye
} from 'lucide-react'

/* ─── Constants ─────────────────────────────────────────────── */
const TASK_TYPE_COLOR = {
  FE:'#6366f1', BE:'#0284c7', DB:'#16a34a', API:'#d97706',
  INT:'#7c3aed', FW:'#b45309', QA:'#e11d48', DEVOPS:'#0f766e',
}
const TASK_TYPE_LABEL = {
  FE:'Frontend', BE:'Backend', DB:'Database', API:'API',
  INT:'Integration', FW:'Firmware', QA:'QA', DEVOPS:'DevOps',
}
const PRIORITY_COLOR = { critical:'#e11d48', high:'#f59e0b', medium:'#3b82f6', low:'#94a3b8' }
const TEST_TYPE_COLOR = { positive:'#10b981', negative:'#e11d48', edge:'#f59e0b', security:'#7c3aed', performance:'#0284c7' }

const SPRINT_COLOR = ['', '#6366f1', '#0284c7', '#10b981', '#f59e0b']

/* ─── Small UI helpers ──────────────────────────────────────── */
const Pill = ({ label, color = '#6366f1', size = 10 }) => (
  <span style={{ padding:'2px 8px', borderRadius:4, background:`${color}18`, color, fontWeight:700, fontSize:size, textTransform:'uppercase', letterSpacing:.4 }}>{label}</span>
)

const SprintBadge = ({ n }) => n
  ? <span style={{ padding:'2px 7px', borderRadius:10, background:`${SPRINT_COLOR[n]||'#6366f1'}18`, color:SPRINT_COLOR[n]||'#6366f1', fontWeight:700, fontSize:9 }}>Sprint {n}</span>
  : null

const PointsBadge = ({ n }) => (
  <span style={{ padding:'2px 7px', borderRadius:10, background:'var(--surface-2)', color:'var(--text-muted)', fontWeight:700, fontSize:9 }}>{n} pts</span>
)

const StatusDot = ({ status }) => {
  const c = { pending:'#94a3b8', approved:'#10b981', rejected:'#e11d48', imported:'#6366f1' }[status] || '#94a3b8'
  return <span style={{ width:7, height:7, borderRadius:'50%', background:c, display:'inline-block', flexShrink:0 }}/>
}

/* ─── Section accordion ─────────────────────────────────────── */
function Section({ icon: Icon, title, count, color, badge, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ marginBottom:16, borderRadius:12, border:'1px solid var(--border)', overflow:'hidden' }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px', cursor:'pointer', background:'var(--surface-2)', userSelect:'none' }}>
        <div style={{ width:30, height:30, borderRadius:8, background:`${color}20`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <Icon size={15} style={{ color }}/>
        </div>
        <div style={{ fontWeight:700, fontSize:14, flex:1 }}>{title}</div>
        {count !== undefined && <span style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)' }}>{count} items</span>}
        {badge}
        {open ? <ChevronDown size={14} style={{ color:'var(--text-muted)' }}/> : <ChevronRight size={14} style={{ color:'var(--text-muted)' }}/>}
      </div>
      {open && <div style={{ padding:16 }}>{children}</div>}
    </div>
  )
}

/* ─── Inline editable cell ──────────────────────────────────── */
function EditableText({ value, onChange, multiline = false, style = {} }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value)
  const inputRef = useRef(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  function commit() { setEditing(false); if (val !== value) onChange(val) }

  if (editing) {
    const commonStyle = { width:'100%', padding:'4px 6px', borderRadius:4, border:'1px solid var(--c1)', background:'var(--surface)', color:'var(--text)', fontSize:12, fontFamily:'inherit', outline:'none', ...style }
    return multiline
      ? <textarea ref={inputRef} value={val} onChange={e => setVal(e.target.value)}
          onBlur={commit} rows={3} style={commonStyle}/>
      : <input ref={inputRef} value={val} onChange={e => setVal(e.target.value)}
          onBlur={commit} onKeyDown={e => e.key === 'Enter' && commit()} style={commonStyle}/>
  }
  return (
    <span onClick={() => setEditing(true)} style={{ cursor:'text', padding:'2px 4px', borderRadius:3, display:'block',
      ':hover':{ background:'var(--surface-2)' }, fontSize:12, lineHeight:1.5, ...style }}>
      {value || <span style={{ color:'var(--text-muted)', fontStyle:'italic' }}>Click to edit…</span>}
    </span>
  )
}

/* ══ MAIN PAGE ══════════════════════════════════════════════════ */
export default function NeoTaskAIPage() {
  const { profile } = useAuth()

  // Step machine: 'home' | 'upload' | 'analyzing' | 'results' | 'importing'
  const [step, setStep] = useState('home')
  const [projects, setProjects] = useState([])

  // Upload form
  const [docText,    setDocText]    = useState('')
  const [docName,    setDocName]    = useState('')
  const [selProject, setSelProject] = useState('')
  const [selModel,   setSelModel]   = useState('deepseek-v3')
  const [uploading,  setUploading]  = useState(false)

  // Results
  const [session, setSession] = useState(null)
  const [stories, setStories] = useState([])
  const [backlog, setBacklog] = useState([])
  const [tasks, setTasks] = useState([])
  const [testCases, setTestCases] = useState([])
  const [apis, setApis] = useState([])

  // Past sessions
  const [sessions, setSessions] = useState([])

  // View tab
  const [viewTab, setViewTab] = useState('stories')

  // Import state
  const [importing, setImporting] = useState(false)
  const [importDone, setImportDone] = useState(false)

  const pollRef  = useRef(null)
  const dropRef   = useRef(null)

  useEffect(() => {
    loadProjects()
    loadSessions()
    return () => clearInterval(pollRef.current)
  }, [profile?.id])

  async function loadProjects() {
    const { data } = await supabase.from('projects').select('id,name').eq('status', 'active').order('name')
    setProjects(data || [])
  }

  async function loadSessions() {
    if (!profile?.id) return
    const { data } = await supabase.from('ai_analysis_sessions')
      .select('*').order('created_at', { ascending: false }).limit(20)
    setSessions(data || [])
  }

  /* ── Upload & trigger analysis ─────────────────────────────── */
  async function startAnalysis() {
    if (!docText.trim()) return
    setUploading(true)
    try {
      // Create session record in Supabase
      const { data: sess, error } = await supabase.from('ai_analysis_sessions').insert({
        project_id: selProject || null,
        created_by: profile.id,
        document_name: docName || 'Requirement Document',
        document_text: docText,
        status: 'pending',
      }).select().single()
      if (error) throw error

      setSession(sess)
      setStep('analyzing')

      // Call selected LLM
      await analyzeRequirements(sess.id, selModel)

      await loadResults(sess.id)
      setStep('results')
      loadSessions()
    } catch (e) {
      alert('Analysis failed: ' + e.message)
      // Mark session failed
      if (session?.id) {
        await supabase.from('ai_analysis_sessions')
          .update({ status: 'failed', error_message: e.message })
          .eq('id', session.id)
      }
      setStep('upload')
    } finally {
      setUploading(false)
    }
  }

  async function loadResults(sessionId) {
    const [sessRes, storiesRes, backlogRes, tasksRes, tcRes, apisRes] = await Promise.all([
      supabase.from('ai_analysis_sessions').select('*').eq('id', sessionId).single(),
      supabase.from('ai_generated_stories').select('*').eq('session_id', sessionId).order('sort_order'),
      supabase.from('ai_generated_backlog').select('*').eq('session_id', sessionId).order('sort_order'),
      supabase.from('ai_generated_tasks').select('*').eq('session_id', sessionId).order('sort_order'),
      supabase.from('ai_generated_test_cases').select('*').eq('session_id', sessionId).order('sort_order'),
      supabase.from('ai_generated_apis').select('*').eq('session_id', sessionId),
    ])
    setSession(sessRes.data)
    setStories(storiesRes.data || [])
    setBacklog(backlogRes.data || [])
    setTasks(tasksRes.data || [])
    setTestCases(tcRes.data || [])
    setApis(apisRes.data || [])
  }

  async function openSession(s) {
    setSession(s)
    await loadResults(s.id)
    setStep('results')
  }

  /* ── Inline update helpers ─────────────────────────────────── */
  async function updateStory(id, patch) {
    setStories(p => p.map(s => s.id === id ? { ...s, ...patch } : s))
    await supabase.from('ai_generated_stories').update(patch).eq('id', id)
  }
  async function updateTask(id, patch) {
    setTasks(p => p.map(t => t.id === id ? { ...t, ...patch } : t))
    await supabase.from('ai_generated_tasks').update(patch).eq('id', id)
  }
  async function updateBacklog(id, patch) {
    setBacklog(p => p.map(b => b.id === id ? { ...b, ...patch } : b))
    await supabase.from('ai_generated_backlog').update(patch).eq('id', id)
  }
  async function updateTC(id, patch) {
    setTestCases(p => p.map(t => t.id === id ? { ...t, ...patch } : t))
    await supabase.from('ai_generated_test_cases').update(patch).eq('id', id)
  }

  /* ── Import to project ─────────────────────────────────────── */
  async function importToProject() {
    if (!session?.project_id) { alert('Select a project first to import.'); return }
    setImporting(true)
    try {
      const projId = session.project_id
      const approvedStories = stories.filter(s => s.status !== 'rejected')
      const approvedTasks = tasks.filter(t => t.status !== 'rejected')

      // Import stories as user_stories
      const storyIdMap = {}
      for (const s of approvedStories) {
        const { data: inserted } = await supabase.from('user_stories').insert({
          project_id: projId,
          title: `As a ${s.role}, I want ${s.capability}`,
          description: s.business_benefit || null,
          story_type: 'story',
          priority: s.priority || 'medium',
          status: 'open',
          story_points: s.story_points || 3,
          created_by: profile.id,
        }).select('id').single()
        if (inserted) {
          storyIdMap[s.id] = inserted.id
          await supabase.from('ai_generated_stories').update({
            status: 'imported', imported_story_id: inserted.id
          }).eq('id', s.id)
        }
      }

      // Import tasks as project_tasks
      let taskOrder = 1
      for (const t of approvedTasks) {
        const taskId = `TASK-AI-${String(taskOrder).padStart(3,'0')}`
        const desc = [
          t.description,
          t.validation_notes    ? `\n**Validation:** ${t.validation_notes}` : '',
          t.error_handling_notes? `\n**Error Handling:** ${t.error_handling_notes}` : '',
          t.security_notes      ? `\n**Security:** ${t.security_notes}` : '',
          t.performance_notes   ? `\n**Performance:** ${t.performance_notes}` : '',
        ].filter(Boolean).join('')

        const { data: inserted } = await supabase.from('project_tasks').insert({
          project_id: projId,
          task_id: taskId,
          task_name: `[${t.task_type}] ${t.title}`,
          task_type: 'task',
          description: desc || null,
          priority: 'medium',
          status: 'backlog',
          estimated_hours: t.estimated_hours || null,
          user_story_id: storyIdMap[t.story_id] || null,
          created_by: profile.id,
        }).select('id').single()

        if (inserted) {
          await supabase.from('ai_generated_tasks').update({
            status: 'imported', imported_task_id: inserted.id
          }).eq('id', t.id)
        }
        taskOrder++
      }

      await supabase.from('ai_analysis_sessions').update({ imported_at: new Date().toISOString() }).eq('id', session.id)
      await loadResults(session.id)
      setImportDone(true)
    } catch (e) {
      alert('Import failed: ' + e.message)
    }
    setImporting(false)
  }

  /* ── File drag/drop handler ─────────────────────────────────── */
  async function handleFileDrop(file) {
    if (!file) return
    setDocName(file.name)
    if (file.type === 'text/plain' || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
      const text = await file.text()
      setDocText(text)
    } else {
      // For PDF/DOCX, just note the filename and ask user to paste text
      setDocText('')
      alert(`For ${file.name.split('.').pop().toUpperCase()} files, please paste the document text in the text area below.`)
    }
  }

  /* ── Sprint summary for results header ─────────────────────── */
  const sprintMap = {}
  tasks.forEach(t => {
    const s = t.sprint_recommendation || 1
    sprintMap[s] = (sprintMap[s] || 0) + (t.story_points || 1)
  })
  const totalPoints = tasks.reduce((a, t) => a + (t.story_points || 1), 0)
  const importedCount = tasks.filter(t => t.status === 'imported').length

  /* ════════════════════════════════════════════════════════════ */
  /* HOME ──────────────────────────────────────────────────────── */
  if (step === 'home') return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display:'flex', alignItems:'center', gap:8 }}>
            <Sparkles size={22} style={{ color:'#6366f1' }}/> Neo Task AI
          </div>
          <div className="page-subtitle">Upload a requirement document → AI generates Stories, Tasks, Test Cases, Sprint Plan</div>
        </div>
        <button className="btn btn-primary" onClick={() => setStep('upload')} style={{ display:'flex', alignItems:'center', gap:6 }}>
          <Plus size={14}/> New Analysis
        </button>
      </div>

      {/* KPI strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:12, marginBottom:24 }}>
        {[
          { label:'Total Analyses', value: sessions.length, icon: FileText, color:'#6366f1' },
          { label:'Completed',      value: sessions.filter(s=>s.status==='completed').length, icon: Check,      color:'#10b981' },
          { label:'Imported',       value: sessions.filter(s=>s.imported_at).length,          icon: Download,   color:'#0284c7' },
          { label:'Pending Review', value: sessions.filter(s=>s.status==='completed'&&!s.imported_at).length, icon: Eye, color:'#f59e0b' },
        ].map(k => (
          <div key={k.label} className="stat-card" style={{ display:'flex', gap:12, alignItems:'center' }}>
            <div style={{ width:38, height:38, borderRadius:10, background:`${k.color}18`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <k.icon size={18} style={{ color:k.color }}/>
            </div>
            <div>
              <div style={{ fontSize:22, fontWeight:800, lineHeight:1 }}>{k.value}</div>
              <div style={{ fontSize:11, color:'var(--text-muted)', fontWeight:600 }}>{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Past sessions */}
      <div className="table-wrap">
        <div className="table-toolbar">
          <span style={{ fontWeight:700, fontSize:14 }}>Analysis History</span>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={loadSessions} title="Refresh"><RefreshCw size={13}/></button>
        </div>
        <table>
          <thead><tr><th>Document</th><th>Model</th><th>Project</th><th>Status</th><th>Stories</th><th>Tasks</th><th>Test Cases</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {sessions.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign:'center', padding:'40px', color:'var(--text-muted)' }}>
                <Sparkles size={32} style={{ opacity:.2, display:'block', margin:'0 auto 10px' }}/>
                No analyses yet. Upload your first requirement document.
              </td></tr>
            )}
            {sessions.map(s => (
              <tr key={s.id}>
                <td><div style={{ fontWeight:600, fontSize:13 }}>{s.document_name}</div></td>
                <td>{(() => { const m = getModel(s.llm_model || 'deepseek-v3'); return <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:4, background:m.bg, color:m.color }}>{m.label}</span> })()}</td>
                <td style={{ fontSize:12, color:'var(--text-muted)' }}>{s.project_id ? '✓ Linked' : '—'}</td>
                <td>
                  <Pill label={s.status} color={
                    s.status==='completed'?'#10b981':s.status==='analyzing'?'#f59e0b':s.status==='failed'?'#e11d48':'#94a3b8'
                  }/>
                </td>
                <td style={{ fontFamily:'monospace', fontSize:12 }}>{s.total_stories || 0}</td>
                <td style={{ fontFamily:'monospace', fontSize:12 }}>{s.total_tasks || 0}</td>
                <td style={{ fontFamily:'monospace', fontSize:12 }}>{s.total_test_cases || 0}</td>
                <td style={{ fontSize:11, color:'var(--text-muted)' }}>
                  {new Date(s.created_at).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}
                </td>
                <td>
                  {s.status === 'completed' && (
                    <button className="btn btn-primary btn-sm" onClick={() => openSession(s)}>
                      <Eye size={11}/> View
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  /* UPLOAD ────────────────────────────────────────────────────── */
  if (step === 'upload') return (
      <div style={{ maxWidth:760, margin:'0 auto' }}>
        <div className="page-header">
          <div>
            <button className="btn btn-ghost btn-sm" onClick={() => setStep('home')} style={{ marginBottom:8 }}>← Back</button>
            <div className="page-title" style={{ display:'flex', alignItems:'center', gap:8 }}>
              <Sparkles size={20} style={{ color:'#6366f1' }}/> New Analysis
            </div>
            <div className="page-subtitle">Upload or paste your BRD / SRS / Requirement document</div>
          </div>
        </div>

        <div className="card" style={{ marginBottom:16 }}>
          {/* Drag & drop zone */}
          <div
            ref={dropRef}
            onDragOver={e => { e.preventDefault(); dropRef.current.style.borderColor='var(--c1)' }}
            onDragLeave={() => { dropRef.current.style.borderColor='var(--border)' }}
            onDrop={e => { e.preventDefault(); dropRef.current.style.borderColor='var(--border)'; handleFileDrop(e.dataTransfer.files[0]) }}
            style={{ border:'2px dashed var(--border)', borderRadius:10, padding:'28px', textAlign:'center', cursor:'pointer', transition:'border-color .2s', marginBottom:16 }}
            onClick={() => document.getElementById('doc-file-input').click()}>
            <Upload size={32} style={{ color:'var(--text-muted)', marginBottom:8, opacity:.5 }}/>
            <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>Drag & drop or click to upload</div>
            <div style={{ fontSize:12, color:'var(--text-muted)' }}>Supports TXT, MD files. For PDF/DOCX paste the text below.</div>
            <input id="doc-file-input" type="file" accept=".txt,.md,.pdf,.docx" style={{ display:'none' }}
              onChange={e => handleFileDrop(e.target.files[0])}/>
          </div>

          <div style={{ marginBottom:14 }}>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-muted)', marginBottom:6 }}>DOCUMENT NAME</label>
            <input value={docName} onChange={e => setDocName(e.target.value)} placeholder="e.g. Product Requirements v1.0"
              style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:'1px solid var(--border)', background:'var(--surface-2)', color:'var(--text)', fontSize:13, fontFamily:'inherit', outline:'none', boxSizing:'border-box' }}/>
          </div>

          <div style={{ marginBottom:14 }}>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-muted)', marginBottom:6 }}>PROJECT (optional)</label>
            <select value={selProject} onChange={e => setSelProject(e.target.value)}
              style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:'1px solid var(--border)', background:'var(--surface-2)', color:'var(--text)', fontSize:13, fontFamily:'inherit', outline:'none' }}>
              <option value="">No project — analysis only</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {/* ── LLM Model Selector ── */}
          <div style={{ marginBottom:20 }}>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-muted)', marginBottom:8 }}>AI MODEL</label>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              {LLM_MODELS.map(m => {
                const active = selModel === m.id
                const apiKey = m.id === 'deepseek-v3'
                  ? import.meta.env.VITE_DEEPSEEK_API_KEY
                  : import.meta.env.VITE_GEMINI_API_KEY
                const keyMissing = !apiKey || apiKey.startsWith('your-')
                return (
                  <div key={m.id} onClick={() => !keyMissing && setSelModel(m.id)}
                    style={{
                      borderRadius:10,
                      border:`2px solid ${active ? m.color : 'var(--border)'}`,
                      padding:'12px 14px',
                      cursor: keyMissing ? 'not-allowed' : 'pointer',
                      background: active ? m.bg : 'var(--surface)',
                      opacity: keyMissing ? 0.5 : 1,
                      transition:'all .15s',
                      position:'relative',
                    }}>
                    {/* Selected tick */}
                    {active && (
                      <div style={{ position:'absolute', top:8, right:8, width:18, height:18, borderRadius:'50%', background:m.color, display:'flex', alignItems:'center', justifyContent:'center' }}>
                        <Check size={10} style={{ color:'#fff' }}/>
                      </div>
                    )}
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                      <div style={{ width:28, height:28, borderRadius:8, background:m.bg, border:`1.5px solid ${m.color}40`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                        <Sparkles size={13} style={{ color:m.color }}/>
                      </div>
                      <div>
                        <div style={{ fontWeight:700, fontSize:13, lineHeight:1 }}>{m.label}</div>
                        <div style={{ fontSize:10, color:'var(--text-muted)' }}>{m.provider}</div>
                      </div>
                    </div>
                    <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:8, lineHeight:1.5 }}>{m.description}</div>
                    <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                      <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:4, background:`${m.color}18`, color:m.color }}>{m.badge}</span>
                      <span style={{ fontSize:9, fontWeight:600, padding:'2px 7px', borderRadius:4, background:'var(--surface-2)', color:'var(--text-muted)' }}>⚡ {m.speed}</span>
                      <span style={{ fontSize:9, fontWeight:600, padding:'2px 7px', borderRadius:4, background:'var(--surface-2)', color:'var(--text-muted)' }}>📄 {m.context}</span>
                    </div>
                    {keyMissing && (
                      <div style={{ marginTop:7, fontSize:10, color:'#f59e0b', fontWeight:600 }}>
                        ⚠ API key not set in .env
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div style={{ marginBottom:20 }}>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-muted)', marginBottom:6 }}>REQUIREMENT DOCUMENT TEXT *</label>
            <textarea value={docText} onChange={e => setDocText(e.target.value)}
              placeholder="Paste your BRD, SRS, Functional Specification, Process Flow, or any requirement text here…"
              rows={14}
              style={{ width:'100%', padding:'10px 12px', borderRadius:8, border:'1px solid var(--border)', background:'var(--surface-2)', color:'var(--text)', fontSize:12, fontFamily:'inherit', outline:'none', resize:'vertical', lineHeight:1.6, boxSizing:'border-box' }}/>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>{docText.length.toLocaleString()} characters · {Math.round(docText.length/4)} est. tokens</div>
          </div>

          <button onClick={startAnalysis} disabled={!docText.trim() || uploading}
            className="btn btn-primary"
            style={{ width:'100%', padding:'12px', fontSize:14, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
            <Sparkles size={16}/>
            {uploading ? 'Uploading…' : 'Analyze with Neo Task AI'}
          </button>
        </div>
      </div>
  )

  /* ANALYZING ─────────────────────────────────────────────────── */
  if (step === 'analyzing') return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'60vh', gap:20 }}>
      <div style={{ width:80, height:80, borderRadius:'50%', background:'linear-gradient(135deg,#6366f1,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center', animation:'pulse 2s infinite' }}>
        <Sparkles size={36} style={{ color:'#fff' }}/>
      </div>
      <div style={{ fontWeight:800, fontSize:20 }}>Neo Task AI is analyzing…</div>
      <div style={{ color:'var(--text-muted)', fontSize:13, textAlign:'center', maxWidth:400 }}>
        Extracting requirements, generating user stories, acceptance criteria, tasks, test cases, and sprint plan.
        <br/>This takes 15–30 seconds.
      </div>
      <div style={{ display:'flex', gap:16, marginTop:8 }}>
        {['Parsing document','Identifying modules','Generating stories','Creating tasks','Writing test cases','Recommending sprints'].map((s, i) => (
          <div key={s} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}>
            <div style={{ width:10, height:10, borderRadius:'50%', background:'#6366f1', animation:`pulse ${1 + i * 0.3}s infinite` }}/>
            <div style={{ fontSize:9, color:'var(--text-muted)', textAlign:'center', maxWidth:60 }}>{s}</div>
          </div>
        ))}
      </div>
    </div>
  )

  /* RESULTS ───────────────────────────────────────────────────── */
  if (step === 'results') {
    const tabs = [
      { id:'stories',    label:'User Stories',  icon:BookOpen,   count:stories.length },
      { id:'backlog',    label:'Backlog',        icon:Layers,     count:backlog.length },
      { id:'tasks',      label:'Tasks',          icon:ListChecks, count:tasks.length },
      { id:'testcases',  label:'Test Cases',     icon:TestTube2,  count:testCases.length },
      { id:'apis',       label:'APIs',           icon:Code2,      count:apis.length },
      { id:'sprints',    label:'Sprint Plan',    icon:Activity,   count:null },
    ]

    return (
      <div>
        {/* Header */}
        <div className="page-header">
          <div>
            <button className="btn btn-ghost btn-sm" onClick={() => setStep('home')} style={{ marginBottom:8 }}>← Back</button>
            <div className="page-title" style={{ display:'flex', alignItems:'center', gap:8 }}>
              <Sparkles size={20} style={{ color:'#6366f1' }}/> {session?.document_name}
              {(() => { const m = getModel(session?.llm_model || 'deepseek-v3'); return <span style={{ fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:6, background:m.bg, color:m.color, marginLeft:4 }}>{m.label}</span> })()}
            </div>
            <div className="page-subtitle" style={{ display:'flex', gap:10, flexWrap:'wrap', marginTop:4 }}>
              <span style={{ color:'#10b981', fontWeight:700 }}>{stories.length} Stories</span>
              <span>·</span>
              <span style={{ color:'#0284c7', fontWeight:700 }}>{tasks.length} Tasks</span>
              <span>·</span>
              <span style={{ color:'#e11d48', fontWeight:700 }}>{testCases.length} Test Cases</span>
              <span>·</span>
              <span style={{ color:'#f59e0b', fontWeight:700 }}>{totalPoints} Story Points</span>
              {importedCount > 0 && <><span>·</span><span style={{ color:'#6366f1', fontWeight:700 }}>{importedCount} Imported</span></>}
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            {!importDone && session?.project_id && (
              <button className="btn btn-primary" onClick={importToProject} disabled={importing}
                style={{ display:'flex', alignItems:'center', gap:6 }}>
                <Download size={14}/>
                {importing ? 'Importing…' : 'Import to Project'}
              </button>
            )}
            {importDone && (
              <div style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 14px', borderRadius:8, background:'rgba(16,185,129,.12)', color:'#10b981', fontWeight:700, fontSize:12 }}>
                <Check size={14}/> Imported to project!
              </div>
            )}
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display:'flex', gap:0, borderBottom:'1px solid var(--border)', marginBottom:20, overflowX:'auto' }}>
          {tabs.map(t => {
            const active = viewTab === t.id
            return (
              <button key={t.id} onClick={() => setViewTab(t.id)}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'9px 16px', border:'none', borderBottom:`2px solid ${active?'var(--c1)':'transparent'}`, cursor:'pointer', fontFamily:'inherit', fontSize:12, fontWeight:active?700:500, background:'transparent', color:active?'var(--c1)':'var(--text-muted)', whiteSpace:'nowrap', marginBottom:-1 }}>
                <t.icon size={13}/>
                {t.label}
                {t.count !== null && <span style={{ padding:'1px 6px', borderRadius:8, background:active?'var(--c1)':'var(--surface-2)', color:active?'#fff':'var(--text-muted)', fontSize:9, fontWeight:700 }}>{t.count}</span>}
              </button>
            )
          })}
        </div>

        {/* ── STORIES TAB ──────────────────────────────────────── */}
        {viewTab === 'stories' && (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {stories.length === 0 && <div style={{ textAlign:'center', padding:'40px', color:'var(--text-muted)' }}>No stories generated</div>}
            {stories.map((s, idx) => (
              <div key={s.id} style={{ borderRadius:12, border:'1px solid var(--border)', overflow:'hidden', background:'var(--surface)' }}>
                {/* Story header */}
                <div style={{ padding:'12px 16px', background:'var(--surface-2)', display:'flex', gap:10, alignItems:'flex-start' }}>
                  <StatusDot status={s.status}/>
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:6 }}>
                      {s.module_name && <Pill label={s.module_name} color="#6366f1"/>}
                      {s.feature_name && <Pill label={s.feature_name} color="#0284c7"/>}
                      <Pill label={s.priority} color={PRIORITY_COLOR[s.priority]||'#94a3b8'}/>
                      <SprintBadge n={s.sprint_recommendation}/>
                      <PointsBadge n={s.story_points}/>
                    </div>
                    <div style={{ fontSize:13, fontWeight:700, color:'var(--text-muted)', marginBottom:2 }}>As a <span style={{ color:'#6366f1' }}>{s.role}</span>,</div>
                    <EditableText value={s.capability} onChange={v => updateStory(s.id, { capability: v })} style={{ fontSize:14, fontWeight:700 }}/>
                    {s.business_benefit && <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>so that <em>{s.business_benefit}</em></div>}
                  </div>
                  <div style={{ display:'flex', gap:6 }}>
                    {s.status !== 'rejected' && (
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => updateStory(s.id, { status:'rejected' })} title="Reject">
                        <X size={12} style={{ color:'#e11d48' }}/>
                      </button>
                    )}
                    {s.status === 'rejected' && (
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => updateStory(s.id, { status:'pending' })} title="Restore">
                        <RotateCcw size={12} style={{ color:'#10b981' }}/>
                      </button>
                    )}
                  </div>
                </div>

                {/* Acceptance criteria */}
                {(s.ac_given || s.ac_when || s.ac_then) && (
                  <div style={{ padding:'12px 16px', borderTop:'1px solid var(--border)' }}>
                    <div style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', letterSpacing:.5, marginBottom:8 }}>ACCEPTANCE CRITERIA</div>
                    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                      {[['Given', s.ac_given, '#10b981'], ['When', s.ac_when, '#0284c7'], ['Then', s.ac_then, '#6366f1']].map(([label, val, color]) => val && (
                        <div key={label} style={{ display:'flex', gap:8 }}>
                          <span style={{ width:40, fontWeight:700, fontSize:11, color, flexShrink:0 }}>{label}</span>
                          <EditableText value={val} onChange={v => updateStory(s.id, { [`ac_${label.toLowerCase()}`]: v })} style={{ fontSize:12 }}/>
                        </div>
                      ))}
                    </div>
                    {/* Extra ACs */}
                    {(s.extra_acs || []).length > 0 && (
                      <div style={{ marginTop:10 }}>
                        {(s.extra_acs || []).map((ac, i) => (
                          <div key={i} style={{ marginBottom:8, padding:'8px 10px', borderRadius:6, background:'var(--surface-2)', borderLeft:`3px solid ${TEST_TYPE_COLOR[ac.type]||'#94a3b8'}` }}>
                            <div style={{ marginBottom:4 }}><Pill label={ac.type} color={TEST_TYPE_COLOR[ac.type]||'#94a3b8'} size={9}/></div>
                            <div style={{ fontSize:11, color:'var(--text-muted)', lineHeight:1.5 }}>
                              <strong>Given</strong> {ac.given} · <strong>When</strong> {ac.when} · <strong>Then</strong> {ac.then}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── BACKLOG TAB ───────────────────────────────────────── */}
        {viewTab === 'backlog' && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Title</th><th>Description</th><th>Priority</th><th>Business Value</th><th>Points</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {backlog.length === 0 && <tr><td colSpan={8} style={{ textAlign:'center', padding:30, color:'var(--text-muted)' }}>No backlog items generated</td></tr>}
                {backlog.map((b, i) => (
                  <tr key={b.id} style={{ opacity: b.status === 'rejected' ? .45 : 1 }}>
                    <td style={{ fontFamily:'monospace', fontSize:11, color:'var(--text-muted)' }}>{i+1}</td>
                    <td><EditableText value={b.title} onChange={v => updateBacklog(b.id, { title:v })} style={{ fontWeight:600 }}/></td>
                    <td style={{ maxWidth:200 }}><EditableText value={b.description||''} onChange={v => updateBacklog(b.id, { description:v })} multiline/></td>
                    <td><Pill label={b.priority} color={PRIORITY_COLOR[b.priority]||'#94a3b8'}/></td>
                    <td style={{ fontSize:12, color:'var(--text-muted)', maxWidth:150 }}>{b.business_value || '—'}</td>
                    <td><PointsBadge n={b.story_points}/></td>
                    <td><StatusDot status={b.status}/></td>
                    <td>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => updateBacklog(b.id, { status: b.status==='rejected'?'pending':'rejected' })}>
                        {b.status === 'rejected' ? <RotateCcw size={11} style={{color:'#10b981'}}/> : <X size={11} style={{color:'#e11d48'}}/>}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── TASKS TAB ────────────────────────────────────────── */}
        {viewTab === 'tasks' && (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {tasks.length === 0 && <div style={{ textAlign:'center', padding:'40px', color:'var(--text-muted)' }}>No tasks generated</div>}
            {tasks.map((t, i) => (
              <div key={t.id} style={{ borderRadius:10, border:'1px solid var(--border)', overflow:'hidden', opacity:t.status==='rejected'?.45:1 }}>
                <div style={{ padding:'10px 14px', display:'flex', gap:10, alignItems:'flex-start', background:'var(--surface-2)' }}>
                  <div style={{ width:42, flexShrink:0, textAlign:'center' }}>
                    <span style={{ fontSize:9, fontWeight:800, color:TASK_TYPE_COLOR[t.task_type]||'#6366f1', textTransform:'uppercase', padding:'2px 5px', borderRadius:3, background:`${TASK_TYPE_COLOR[t.task_type]||'#6366f1'}18` }}>{t.task_type}</span>
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <EditableText value={t.title} onChange={v => updateTask(t.id, { title:v })} style={{ fontWeight:700, fontSize:13 }}/>
                    <div style={{ display:'flex', gap:6, marginTop:4, flexWrap:'wrap' }}>
                      <SprintBadge n={t.sprint_recommendation}/>
                      <PointsBadge n={t.story_points}/>
                      {t.estimated_hours && <span style={{ fontSize:9, color:'var(--text-muted)', fontWeight:600 }}>{t.estimated_hours}h</span>}
                    </div>
                  </div>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => updateTask(t.id, { status: t.status==='rejected'?'pending':'rejected' })}>
                    {t.status === 'rejected' ? <RotateCcw size={11} style={{color:'#10b981'}}/> : <X size={11} style={{color:'#e11d48'}}/>}
                  </button>
                </div>
                <div style={{ padding:'10px 14px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  {[
                    ['Description', t.description, 'description'],
                    ['Validation', t.validation_notes, 'validation_notes'],
                    ['Error Handling', t.error_handling_notes, 'error_handling_notes'],
                    ['Security', t.security_notes, 'security_notes'],
                    ['Performance', t.performance_notes, 'performance_notes'],
                  ].filter(([,v]) => v).map(([label, val, key]) => (
                    <div key={key}>
                      <div style={{ fontSize:9, fontWeight:700, color:'var(--text-muted)', letterSpacing:.4, marginBottom:2, textTransform:'uppercase' }}>{label}</div>
                      <EditableText value={val} onChange={v => updateTask(t.id, { [key]:v })} multiline style={{ fontSize:11 }}/>
                    </div>
                  ))}
                  {(t.dependencies||[]).length > 0 && (
                    <div style={{ gridColumn:'span 2' }}>
                      <div style={{ fontSize:9, fontWeight:700, color:'var(--text-muted)', letterSpacing:.4, marginBottom:4, textTransform:'uppercase' }}>Dependencies</div>
                      <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                        {(t.dependencies||[]).map((d,j) => (
                          <span key={j} style={{ fontSize:10, padding:'2px 8px', borderRadius:4, background:'var(--surface-2)', color:'var(--text-muted)', border:'1px solid var(--border)' }}>
                            <ArrowRight size={9} style={{ marginRight:3, verticalAlign:'middle' }}/>{d}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── TEST CASES TAB ───────────────────────────────────── */}
        {viewTab === 'testcases' && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Title</th><th>Given</th><th>When</th><th>Then</th><th>Type</th><th>Priority</th><th></th></tr></thead>
              <tbody>
                {testCases.length === 0 && <tr><td colSpan={8} style={{ textAlign:'center', padding:30, color:'var(--text-muted)' }}>No test cases generated</td></tr>}
                {testCases.map((tc, i) => (
                  <tr key={tc.id} style={{ opacity:tc.status==='rejected'?.4:1 }}>
                    <td style={{ fontFamily:'monospace', fontSize:11, color:'var(--text-muted)' }}>{i+1}</td>
                    <td style={{ fontWeight:600, fontSize:12 }}><EditableText value={tc.title} onChange={v => updateTC(tc.id, { title:v })}/></td>
                    <td style={{ fontSize:11, color:'var(--text-muted)', maxWidth:160 }}>{tc.given_cond || '—'}</td>
                    <td style={{ fontSize:11, color:'var(--text-muted)', maxWidth:160 }}>{tc.when_action || '—'}</td>
                    <td style={{ fontSize:11, maxWidth:160 }}>{tc.then_result || '—'}</td>
                    <td><Pill label={tc.test_type} color={TEST_TYPE_COLOR[tc.test_type]||'#94a3b8'}/></td>
                    <td><Pill label={tc.priority} color={PRIORITY_COLOR[tc.priority]||'#94a3b8'}/></td>
                    <td>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => updateTC(tc.id, { status:tc.status==='rejected'?'pending':'rejected' })}>
                        {tc.status === 'rejected' ? <RotateCcw size={11} style={{color:'#10b981'}}/> : <X size={11} style={{color:'#e11d48'}}/>}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── APIs TAB ─────────────────────────────────────────── */}
        {viewTab === 'apis' && (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {apis.length === 0 && <div style={{ textAlign:'center', padding:'40px', color:'var(--text-muted)' }}>No APIs generated</div>}
            {apis.map(a => (
              <div key={a.id} style={{ borderRadius:10, border:'1px solid var(--border)', padding:'12px 16px' }}>
                <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:10 }}>
                  <span style={{ padding:'3px 8px', borderRadius:5, fontWeight:800, fontSize:11,
                    background: ({GET:'#10b981',POST:'#6366f1',PUT:'#f59e0b',PATCH:'#0284c7',DELETE:'#e11d48'}[a.method]||'#94a3b8')+'18',
                    color: ({GET:'#10b981',POST:'#6366f1',PUT:'#f59e0b',PATCH:'#0284c7',DELETE:'#e11d48'}[a.method]||'#94a3b8'),
                  }}>{a.method}</span>
                  <code style={{ fontSize:13, fontWeight:700, color:'var(--c1)' }}>{a.endpoint}</code>
                  <span style={{ fontSize:12, color:'var(--text-muted)' }}>{a.api_name}</span>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  <div>
                    <div style={{ fontSize:9, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', marginBottom:4 }}>Request</div>
                    <pre style={{ margin:0, padding:'8px', borderRadius:6, background:'var(--surface-2)', fontSize:10, overflow:'auto', maxHeight:120, color:'var(--text)' }}>
                      {JSON.stringify(a.request_structure, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <div style={{ fontSize:9, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', marginBottom:4 }}>Response</div>
                    <pre style={{ margin:0, padding:'8px', borderRadius:6, background:'var(--surface-2)', fontSize:10, overflow:'auto', maxHeight:120, color:'var(--text)' }}>
                      {JSON.stringify(a.response_structure, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── SPRINT PLAN TAB ───────────────────────────────────── */}
        {viewTab === 'sprints' && (
          <div>
            {[1, 2, 3].map(sprintNum => {
              const sprintTasks = tasks.filter(t => (t.sprint_recommendation || 1) === sprintNum)
              const sprintStories = stories.filter(s => (s.sprint_recommendation || 1) === sprintNum)
              const sprintPoints = sprintTasks.reduce((a, t) => a + (t.story_points || 1), 0)
              if (sprintTasks.length === 0 && sprintStories.length === 0) return null
              const byType = {}
              sprintTasks.forEach(t => { byType[t.task_type] = (byType[t.task_type]||0) + 1 })
              return (
                <Section key={sprintNum} icon={Activity} title={`Sprint ${sprintNum}`}
                  color={SPRINT_COLOR[sprintNum]||'#6366f1'}
                  badge={<><PointsBadge n={sprintPoints}/></>}>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))', gap:10 }}>
                    {sprintStories.map(s => (
                      <div key={s.id} style={{ padding:'10px 12px', borderRadius:8, border:'1px solid var(--border)', background:'var(--surface-2)' }}>
                        <div style={{ fontSize:10, fontWeight:700, color:'#6366f1', marginBottom:4 }}>USER STORY</div>
                        <div style={{ fontSize:12, fontWeight:700 }}>As a {s.role}, {s.capability}</div>
                        <div style={{ display:'flex', gap:5, marginTop:6 }}>
                          <Pill label={s.priority} color={PRIORITY_COLOR[s.priority]||'#94a3b8'}/>
                          <PointsBadge n={s.story_points}/>
                        </div>
                      </div>
                    ))}
                    {sprintTasks.map(t => (
                      <div key={t.id} style={{ padding:'10px 12px', borderRadius:8, border:'1px solid var(--border)', background:'var(--surface)' }}>
                        <div style={{ fontSize:10, fontWeight:700, marginBottom:4, color:TASK_TYPE_COLOR[t.task_type] }}>{TASK_TYPE_LABEL[t.task_type]} TASK</div>
                        <div style={{ fontSize:12, fontWeight:600 }}>{t.title}</div>
                        <div style={{ display:'flex', gap:5, marginTop:6 }}>
                          <PointsBadge n={t.story_points}/>
                          {t.estimated_hours && <span style={{ fontSize:9, color:'var(--text-muted)', fontWeight:600 }}>{t.estimated_hours}h</span>}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Type breakdown */}
                  <div style={{ display:'flex', gap:8, marginTop:12, flexWrap:'wrap' }}>
                    {Object.entries(byType).map(([type, count]) => (
                      <span key={type} style={{ padding:'3px 10px', borderRadius:6, background:`${TASK_TYPE_COLOR[type]||'#6366f1'}15`, color:TASK_TYPE_COLOR[type]||'#6366f1', fontSize:10, fontWeight:700 }}>
                        {type}: {count}
                      </span>
                    ))}
                  </div>
                </Section>
              )
            })}

            {/* Total summary */}
            <div className="card" style={{ marginTop:16 }}>
              <div style={{ fontWeight:700, fontSize:14, marginBottom:14 }}>Project Summary</div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:10 }}>
                {[
                  { label:'User Stories', value:stories.length, color:'#6366f1' },
                  { label:'Backlog Items', value:backlog.length, color:'#8b5cf6' },
                  { label:'Total Tasks', value:tasks.length, color:'#0284c7' },
                  { label:'Test Cases', value:testCases.length, color:'#e11d48' },
                  { label:'Total Points', value:totalPoints, color:'#f59e0b' },
                  { label:'APIs Designed', value:apis.length, color:'#10b981' },
                ].map(k => (
                  <div key={k.label} style={{ textAlign:'center', padding:'12px', borderRadius:10, background:'var(--surface-2)' }}>
                    <div style={{ fontSize:28, fontWeight:800, color:k.color }}>{k.value}</div>
                    <div style={{ fontSize:11, color:'var(--text-muted)', fontWeight:600 }}>{k.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return <Loader/>
}
