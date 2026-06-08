import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, rupee, dateFmt, nextNum } from '../lib/supabase'
import { getChain, canActOn, buildApprovalUpdate, statusLabel } from '../lib/approvalFlow.js'
import ApprovalChainViz from '../components/ui/ApprovalChainViz'
import { Modal, StatusBadge, SearchBox, Loader, Empty, Confirm } from '../components/ui'
import { Plus, Eye, Trash2, CheckCircle, XCircle, Upload, IndianRupee } from 'lucide-react'

const CATEGORIES = ['Travel','Food & Beverage','Accommodation','Office Supplies','Software',
  'Marketing','Training','Medical','Utilities','Miscellaneous']
const DEFAULT_PROJECT = 'ThingsaliveWork'

export default function ExpensesPage() {
  const { profile } = useAuth()
  const role       = profile?.role || 'employee'
  const isEmployee = role === 'employee'

  const [items,      setItems]      = useState([])
  const [projects,   setProjects]   = useState([])
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState('')
  const [statusFilter, setStatusF]  = useState('all')
  const [showCreate, setShowCreate] = useState(false)
  const [showDetail, setShowDetail] = useState(null)
  const [showReview, setShowReview] = useState(null)
  const [deleteId,   setDeleteId]   = useState(null)
  const [submitting, setSub]        = useState(false)
  const [logs,       setLogs]       = useState([])
  const [note,       setNote]       = useState('')
  const [err,        setErr]        = useState('')
  const [file,       setFile]       = useState(null)

  const initForm = () => ({
    title: '', amount: '', category: '', description: '',
    date: new Date().toISOString().split('T')[0], project_id: ''
  })
  const [form, setForm] = useState(initForm)

  useEffect(() => { load(); loadProjects() }, [role])

  async function loadProjects() {
    const { data } = await supabase.from('projects')
      .select('id, name, code, budget, spent').order('name')
    setProjects(data || [])
  }

  async function load() {
    setLoading(true)
    let q = supabase.from('expense_requests')
      .select('*, requester:profiles!requested_by(full_name, role), project:projects(id,name,code,budget,spent)')
    if (isEmployee) q = q.eq('requested_by', profile.id)
    const { data } = await q.order('created_at', { ascending: false })
    setItems(data || [])
    setLoading(false)
  }

  async function openDetail(item) {
    setShowDetail(item)
    const { data } = await supabase.from('approval_logs')
      .select('*, actor:profiles!performed_by(full_name, role)')
      .eq('entity_id', item.id).eq('entity_type', 'expense')
      .order('created_at', { ascending: true })
    setLogs(data || [])
  }

  async function handleCreate(e) {
    e.preventDefault(); setSub(true); setErr('')
    try {
      const num = await nextNum('expense')
      const amt = parseFloat(form.amount) || 0

      // If project selected, check budget
      if (form.project_id) {
        const proj = projects.find(p => p.id === form.project_id)
        if (proj) {
          const remaining = (proj.budget || 0) - (proj.spent || 0)
          if (amt > remaining) {
            throw new Error(`Amount ₹${amt.toLocaleString('en-IN')} exceeds project budget remaining (₹${remaining.toLocaleString('en-IN')})`)
          }
        }
      }

      let docUrl = null
      if (file) {
        const path = `receipts/${profile.id}/${num}_${file.name.replace(/[^a-zA-Z0-9.-]/g,'_')}`
        const { error: upErr } = await supabase.storage.from('invoices').upload(path, file, { upsert: true })
        if (!upErr) {
          const { data: ud } = supabase.storage.from('invoices').getPublicUrl(path)
          docUrl = ud?.publicUrl
        }
      }

      const { error } = await supabase.from('expense_requests').insert({
        expense_number:  num,
        title:           form.title,
        category:        form.category,
        description:     form.description || null,
        expense_date:    form.date,
        amount:          amt,
        gst_amount:      0,
        total_amount:    amt,
        project_id:      form.project_id || null,
        requested_by:    profile.id,
        status:          'submitted',
        attachments:     docUrl ? [{ url: docUrl, name: file.name }] : [],
      })
      if (error) throw error

      // Deduct from project budget
      if (form.project_id) {
        await supabase.from('projects').update({
          spent: (projects.find(p => p.id === form.project_id)?.spent || 0) + amt
        }).eq('id', form.project_id)
      }

      setShowCreate(false); setForm(initForm()); setFile(null); load(); loadProjects()
    } catch (e) { setErr(e.message) }
    finally { setSub(false) }
  }

  async function handleApprove(item, action) {
    setSub(true)
    try {
      const submitterRole = item.requester?.role || 'employee'
      const update = buildApprovalUpdate(action, item.status, role, submitterRole, profile.id, note)
      const { error } = await supabase.from('expense_requests').update(update).eq('id', item.id)
      if (error) throw error
      await supabase.from('approval_logs').insert({
        entity_type: 'expense', entity_id: item.id,
        performed_by: profile.id, action,
        from_status: item.status, to_status: update.status, comments: note,
      })
      setShowReview(null); setShowDetail(null); setNote(''); load()
    } catch (e) { alert(e.message) }
    finally { setSub(false) }
  }

  async function handleDelete(id) {
    await supabase.from('expense_requests').delete().eq('id', id)
    setDeleteId(null); load()
  }

  const filtered = items.filter(i => {
    const ms = !search || i.title?.toLowerCase().includes(search.toLowerCase()) || i.expense_number?.toLowerCase().includes(search.toLowerCase())
    const mf = statusFilter === 'all' || i.status === statusFilter
    return ms && mf
  })

  const STATUS_PILLS = [
    { v: 'all',            l: 'All' },
    { v: 'submitted',      l: 'Pending',  c: '#f59e0b' },
    { v: 'manager_review', l: 'Mgr Review', c: '#3b82f6' },
    { v: 'ceo_review',     l: 'CEO Review', c: '#ec4899' },
    { v: 'finance_review', l: 'Fin Review', c: '#8b5cf6' },
    { v: 'approved',       l: 'Approved', c: '#10b981' },
    { v: 'rejected',       l: 'Rejected', c: '#ef4444' },
  ]

  if (loading) return <Loader />

  // ── Approval flow banner ──────────────────────────────────────
  const myChain = getChain(role)
  const FlowBanner = () => (
    <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: 14, padding: '12px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', letterSpacing: '.06em' }}>YOUR APPROVAL FLOW</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {myChain.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ padding: '4px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700,
              background: i === 0 ? '#ede9fe' : '#f1f5f9', color: i === 0 ? '#6d28d9' : '#475569' }}>
              {s.label}
            </span>
            {i < myChain.length - 1 && <span style={{ color: '#cbd5e1', fontWeight: 700 }}>→</span>}
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Expense Management</div>
          <div className="page-subtitle">Submit and track expense requests — ThingsaliveWork</div>
        </div>
        <button className="btn btn-primary" onClick={() => { setErr(''); setForm(initForm()); setShowCreate(true) }}>
          <Plus size={15} /> New Expense
        </button>
      </div>

      <FlowBanner />

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {[
          { l: 'Total',        v: items.length,                                                                   c: '#6366f1' },
          { l: 'Pending',      v: items.filter(i => ['submitted','manager_review','ceo_review','finance_review'].includes(i.status)).length, c: '#f59e0b' },
          { l: 'Approved',     v: items.filter(i => i.status === 'approved').length,                              c: '#10b981' },
          { l: 'Rejected',     v: items.filter(i => i.status === 'rejected').length,                              c: '#ef4444' },
          { l: 'Approved ₹',   v: rupee(items.filter(i => i.status === 'approved').reduce((s,i) => s+(i.amount||0), 0)), c: '#3b82f6' },
        ].map(s => (
          <div key={s.l} className="stat-card" style={{ borderTopColor: s.c }}>
            <div className="stat-value" style={{ fontSize: 20, color: s.c }}>{s.v}</div>
            <div className="stat-label">{s.l}</div>
          </div>
        ))}
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {STATUS_PILLS.map(p => (
          <button key={p.v} onClick={() => setStatusF(p.v)}
            style={{ padding: '5px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 11,
              background: statusFilter === p.v ? (p.c || '#1e293b') : '#f1f5f9',
              color: statusFilter === p.v ? '#fff' : '#475569' }}>
            {p.l} ({p.v === 'all' ? items.length : items.filter(i => i.status === p.v).length})
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="table-wrap">
        <div className="table-toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Search by title or expense #…" />
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{filtered.length} records</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Expense #</th><th>Title</th><th>Project</th><th>Category</th>
              <th>Amount (₹)</th>{!isEmployee && <th>Requester</th>}
              <th>Date</th><th>Status</th><th>Chain</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0
              ? <tr><td colSpan={10}><Empty icon="🧾" title="No expenses" desc="Submit your first expense" /></td></tr>
              : filtered.map(item => {
                  const submitterRole = item.requester?.role || 'employee'
                  const canReview = canActOn(role, item.status, submitterRole)
                  return (
                    <tr key={item.id}>
                      <td style={{ fontFamily:'monospace', fontSize:11, fontWeight:700, color:'#6366f1' }}>{item.expense_number}</td>
                      <td className="td-bold">{item.title}</td>
                      <td>
                        {item.project
                          ? <span style={{ padding:'2px 8px', borderRadius:999, fontSize:11, fontWeight:700, background:'#ede9fe', color:'#6d28d9' }}>{item.project.name}</span>
                          : <span style={{ color:'#94a3b8', fontSize:12 }}>—</span>}
                      </td>
                      <td><span className="badge badge-info" style={{ fontSize:11 }}>{item.category}</span></td>
                      <td style={{ fontWeight:800 }}>₹{(item.amount||0).toLocaleString('en-IN')}</td>
                      {!isEmployee && <td style={{ fontSize:12, color:'#64748b' }}>{item.requester?.full_name || '—'}</td>}
                      <td style={{ fontSize:12 }}>{dateFmt(item.expense_date)}</td>
                      <td>
                        <span style={{ padding:'3px 10px', borderRadius:999, fontSize:11, fontWeight:700,
                          background: item.status==='approved'?'#dcfce7':item.status==='rejected'?'#fee2e2':item.status==='submitted'?'#fef3c7':'#ede9fe',
                          color: item.status==='approved'?'#15803d':item.status==='rejected'?'#dc2626':item.status==='submitted'?'#b45309':'#6d28d9' }}>
                          {statusLabel(item.status)}
                        </span>
                      </td>
                      <td><ApprovalChainViz submitterRole={submitterRole} currentStatus={item.status} compact /></td>
                      <td>
                        <div style={{ display:'flex', gap:5 }}>
                          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openDetail(item)}><Eye size={13} /></button>
                          {canReview && <button className="btn btn-primary btn-sm" onClick={() => { setShowReview(item); setNote('') }}>Review</button>}
                          {isEmployee && item.status === 'submitted' && (
                            <button className="btn btn-ghost btn-sm btn-icon" style={{ color:'#ef4444' }} onClick={() => setDeleteId(item.id)}><Trash2 size={13} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
            }
          </tbody>
        </table>
      </div>

      {/* ── Create Modal ── */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Expense Request" size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={submitting}>{submitting ? 'Submitting…' : 'Submit Expense'}</button>
        </>}>
        {err && <div className="alert alert-danger" style={{ marginBottom:14 }}>{err}</div>}
        <div className="form-group">
          <label className="form-label">Title *</label>
          <input className="form-input" value={form.title} onChange={e => setForm(f=>({...f,title:e.target.value}))} placeholder="Brief expense description" required />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Amount (₹) *</label>
            <div style={{ position:'relative' }}>
              <span style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'#64748b', fontWeight:700 }}>₹</span>
              <input className="form-input" type="number" step="0.01" value={form.amount}
                onChange={e => setForm(f=>({...f,amount:e.target.value}))} placeholder="0.00" required style={{ paddingLeft:24 }} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Date *</label>
            <input className="form-input" type="date" value={form.date} onChange={e => setForm(f=>({...f,date:e.target.value}))} required />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Category *</label>
            <select className="form-select" value={form.category} onChange={e => setForm(f=>({...f,category:e.target.value}))} required>
              <option value="">Select category</option>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Project</label>
            <select className="form-select" value={form.project_id} onChange={e => setForm(f=>({...f,project_id:e.target.value}))}>
              <option value="">No project</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
            </select>
            
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea className="form-textarea" value={form.description} onChange={e => setForm(f=>({...f,description:e.target.value}))} placeholder="Details about this expense…" />
        </div>
        <div className="form-group">
          <label className="form-label">Receipt / Attachment</label>
          <label style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', border:'2px dashed #e2e8f0', borderRadius:10, cursor:'pointer', background:'#f8fafc' }}>
            <Upload size={15} style={{ color:'#6366f1', flexShrink:0 }} />
            <span style={{ fontSize:13, color:file?'#1e293b':'#94a3b8', fontWeight:file?600:400 }}>
              {file ? `📎 ${file.name}` : 'Attach receipt (PDF, image, doc)'}
            </span>
            <input type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" style={{ display:'none' }} onChange={e=>setFile(e.target.files[0])} />
          </label>
        </div>
        {/* Approval chain preview */}
        <div style={{ padding:'10px 14px', borderRadius:10, background:'#f0f9ff', border:'1px solid #bae6fd' }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#0369a1', marginBottom:8 }}>YOUR SUBMISSION WILL FOLLOW THIS CHAIN</div>
          <ApprovalChainViz submitterRole={role} currentStatus="submitted" />
        </div>
      </Modal>

      {/* ── Detail Modal ── */}
      <Modal open={!!showDetail} onClose={() => setShowDetail(null)} title="Expense Details" size="lg"
        footer={<>
          {canActOn(role, showDetail?.status, showDetail?.requester?.role||'employee') && (
            <button className="btn btn-primary btn-sm" onClick={() => { setShowReview(showDetail); setShowDetail(null) }}>Review</button>
          )}
          <button className="btn btn-ghost" onClick={() => setShowDetail(null)}>Close</button>
        </>}>
        {showDetail && (
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
              <div>
                <div style={{ fontFamily:'monospace', fontSize:12, color:'#6366f1', fontWeight:700 }}>{showDetail.expense_number}</div>
                <div style={{ fontSize:20, fontWeight:800 }}>{showDetail.title}</div>
                {!isEmployee && <div style={{ fontSize:13, color:'#64748b', marginTop:2 }}>by {showDetail.requester?.full_name} ({showDetail.requester?.role})</div>}
              </div>
              <div style={{ padding:'5px 14px', borderRadius:999, fontSize:12, fontWeight:700,
                background: showDetail.status==='approved'?'#dcfce7':showDetail.status==='rejected'?'#fee2e2':'#fef3c7',
                color: showDetail.status==='approved'?'#15803d':showDetail.status==='rejected'?'#dc2626':'#b45309' }}>
                {statusLabel(showDetail.status)}
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:20 }}>
              {[
                ['Amount', `₹${(showDetail.amount||0).toLocaleString('en-IN')}`, '#6366f1'],
                ['Category', showDetail.category, '#ec4899'],
                ['Project', showDetail.project?.name || '—', '#6d28d9'],
                ['Date', dateFmt(showDetail.expense_date), '#f59e0b'],
              ].map(([k,v,c]) => (
                <div key={k} style={{ padding:'12px 14px', borderRadius:10, background:`${c}08`, border:`1px solid ${c}20` }}>
                  <div style={{ fontSize:11, color:'#94a3b8', fontWeight:600, marginBottom:3 }}>{k}</div>
                  <div style={{ fontSize:15, fontWeight:800, color:c }}>{v}</div>
                </div>
              ))}
            </div>
            {showDetail.description && (
              <div style={{ padding:'10px 14px', background:'#f8fafc', borderRadius:10, marginBottom:16, fontSize:13 }}>{showDetail.description}</div>
            )}
            {showDetail.attachments?.length > 0 && (
              <div style={{ marginBottom:16 }}>
                {showDetail.attachments.map((a,i) => (
                  <a key={i} href={a.url} target="_blank" rel="noreferrer"
                    style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:8, background:'#ede9fe', color:'#6d28d9', fontSize:12, fontWeight:600, textDecoration:'none' }}>
                    📎 {a.name}
                  </a>
                ))}
              </div>
            )}
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', marginBottom:10 }}>Approval Chain</div>
              <ApprovalChainViz submitterRole={showDetail.requester?.role||'employee'} currentStatus={showDetail.status} />
            </div>
            {logs.length > 0 && (
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', marginBottom:10 }}>History</div>
                {logs.map((log,i) => (
                  <div key={i} style={{ display:'flex', gap:12, padding:'10px 0', borderBottom:i<logs.length-1?'1px solid #f1f5f9':'none' }}>
                    <div style={{ width:26, height:26, borderRadius:'50%', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700,
                      background:log.action==='approve'?'#dcfce7':log.action==='reject'?'#fee2e2':'#f1f5f9',
                      color:log.action==='approve'?'#15803d':log.action==='reject'?'#dc2626':'#475569' }}>
                      {log.action==='approve'?'✓':log.action==='reject'?'✗':'○'}
                    </div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:600 }}>{log.actor?.full_name} <span style={{ color:'#94a3b8', fontWeight:400, fontSize:11 }}>({log.actor?.role})</span></div>
                      <div style={{ fontSize:11, color:'#94a3b8' }}>{log.action} · {log.from_status} → {log.to_status} · {dateFmt(log.created_at)}</div>
                      {log.comments && <div style={{ fontSize:12, marginTop:3, fontStyle:'italic', color:'#64748b' }}>"{log.comments}"</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── Review Modal ── */}
      <Modal open={!!showReview} onClose={() => setShowReview(null)} title="Review Expense"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowReview(null)}>Cancel</button>
          <button className="btn btn-danger" onClick={() => handleApprove(showReview,'reject')} disabled={submitting}><XCircle size={13} /> Reject</button>
          <button className="btn btn-success" onClick={() => handleApprove(showReview,'approve')} disabled={submitting}><CheckCircle size={13} /> Approve</button>
        </>}>
        {showReview && (
          <div>
            <div style={{ padding:'14px 16px', background:'#f8fafc', borderRadius:10, marginBottom:14 }}>
              <div style={{ fontWeight:700, marginBottom:6 }}>{showReview.title}</div>
              <div style={{ display:'flex', gap:14, fontSize:13, color:'#64748b', flexWrap:'wrap' }}>
                <span>₹{(showReview.amount||0).toLocaleString('en-IN')}</span>
                <span>📂 {showReview.category}</span>
                {showReview.project?.name && <span>📁 {showReview.project.name}</span>}
                {!isEmployee && showReview.requester?.full_name && <span>👤 {showReview.requester.full_name} ({showReview.requester.role})</span>}
              </div>
            </div>
            {/* Next step info */}
            {(() => {
              const submitterRole = showReview.requester?.role || 'employee'
              const chain = getChain(submitterRole)
              const curIdx = chain.findIndex(s => s.status === showReview.status)
              const next = chain[curIdx + 1]
              return (
                <div style={{ padding:'10px 14px', borderRadius:10, background:'#ede9fe', border:'1px solid #ddd6fe', fontSize:12, marginBottom:14, color:'#6d28d9', fontWeight:600 }}>
                  Approve → {next ? `moves to ${next.label} review` : 'Final Approval ✓'}
                </div>
              )
            })()}
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', marginBottom:8 }}>Full Chain</div>
              <ApprovalChainViz submitterRole={showReview.requester?.role||'employee'} currentStatus={showReview.status} />
            </div>
            <div className="form-group">
              <label className="form-label">Comments (optional)</label>
              <textarea className="form-textarea" value={note} onChange={e => setNote(e.target.value)} placeholder="Reason for approval or rejection…" />
            </div>
          </div>
        )}
      </Modal>

      <Confirm open={!!deleteId} message="Delete this expense request?" danger onConfirm={() => handleDelete(deleteId)} onCancel={() => setDeleteId(null)} />
    </div>
  )
}
