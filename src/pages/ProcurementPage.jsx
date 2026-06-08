import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, rupee, dateFmt, nextNum } from '../lib/supabase'
import { useProjects, ProjectSelect } from '../lib/useProjects.jsx'
import { getChain, canActOn, buildApprovalUpdate, statusLabel } from '../lib/approvalFlow.js'
import ApprovalChainViz from '../components/ui/ApprovalChainViz'
import { Modal, StatusBadge, SearchBox, Loader, Empty } from '../components/ui'
import { Plus, Eye, CheckCircle, XCircle, ShoppingCart } from 'lucide-react'

const PRIORITIES = ['low','medium','high','urgent']
const PRIORITY_COLORS = { low:'#10b981', medium:'#f59e0b', high:'#ef4444', urgent:'#7c3aed' }
const CATEGORIES = ['IT Equipment','Office Supplies','Software','Furniture','Services','Marketing','Other']

const initForm = () => ({
  title: '', category: '', justification: '', estimated_amount: '',
  priority: 'medium', required_by: '', project_id: '', vendor_id: ''
})

export default function ProcurementPage() {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const isApprover = ['admin','ceo','manager','finance','department_head'].includes(role)

  const { projects, getRemaining } = useProjects()
  const [items, setItems]       = useState([])
  const [vendors, setVendors]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [showModal, setShowModal] = useState(false)
  const [showDetail, setShowDetail] = useState(null)
  const [showReview, setShowReview] = useState(null)
  const [form, setForm]         = useState(initForm())
  const [note, setNote]         = useState('')
  const [submitting, setSub]    = useState(false)
  const [err, setErr]           = useState('')
  const [formErr, setFormErr]   = useState({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [pr, v] = await Promise.all([
      supabase.from('purchase_requisitions')
        .select('*, requester:profiles!requested_by(full_name,role), project:projects(id,name,code,budget,spent)')
        .order('created_at', { ascending: false }),
      supabase.from('vendors').select('id,name').eq('status','active').order('name')
    ])
    setItems(pr.data || [])
    setVendors(v.data || [])
    setLoading(false)
  }

  function validate() {
    const e = {}
    if (!form.title.trim())      e.title = 'Title is required'
    if (!form.project_id)        e.project_id = 'Project is required'
    if (!form.category)          e.category = 'Category is required'
    if (!form.estimated_amount)  e.estimated_amount = 'Amount is required'
    if (form.project_id && form.estimated_amount) {
      const rem = getRemaining(form.project_id)
      if (rem !== null && parseFloat(form.estimated_amount) > rem)
        e.project_id = 'Amount exceeds the available project budget'
    }
    setFormErr(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!validate()) return
    setSub(true); setErr('')
    try {
      const num = await nextNum('pr')
      const amt = parseFloat(form.estimated_amount) || 0
      const { error } = await supabase.from('purchase_requisitions').insert({
        pr_number: num,
        title: form.title,
        category: form.category,
        justification: form.justification || null,
        estimated_amount: amt,
        priority: form.priority,
        required_by: form.required_by || null,
        project_id: form.project_id,
        requested_by: profile.id,
        status: 'submitted',
      })
      if (error) throw error
      // Deduct from project budget
      const proj = projects.find(p => p.id === form.project_id)
      if (proj) await supabase.from('projects').update({ spent: (proj.spent||0)+amt }).eq('id', form.project_id)
      setShowModal(false); setForm(initForm()); setFormErr({}); load()
    } catch (e) { setErr(e.message) }
    finally { setSub(false) }
  }

  async function handleApprove(item, action) {
    setSub(true)
    try {
      const submitterRole = item.requester?.role || 'employee'
      const update = buildApprovalUpdate(action, item.status, role, submitterRole, profile.id, note)
      const { error } = await supabase.from('purchase_requisitions').update(update).eq('id', item.id)
      if (error) throw error
      await supabase.from('approval_logs').insert({
        entity_type: 'procurement', entity_id: item.id, performed_by: profile.id,
        action, from_status: item.status, to_status: update.status, comments: note
      })
      setShowReview(null); setShowDetail(null); setNote(''); load()
    } catch (e) { alert(e.message) }
    finally { setSub(false) }
  }

  const filtered = items.filter(i => !search ||
    i.title?.toLowerCase().includes(search.toLowerCase()) ||
    i.pr_number?.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Purchase Requisitions</div>
          <div className="page-subtitle">Raise and approve purchase requests — ThingsaliveWork</div>
        </div>
        <button className="btn btn-primary" onClick={() => { setErr(''); setFormErr({}); setForm(initForm()); setShowModal(true) }}>
          <Plus size={15} /> New PR
        </button>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {[
          { l:'Total', v:items.length, c:'#6366f1' },
          { l:'Pending', v:items.filter(i=>['submitted','manager_review','ceo_review','finance_review'].includes(i.status)).length, c:'#f59e0b' },
          { l:'Approved', v:items.filter(i=>i.status==='approved').length, c:'#10b981' },
          { l:'Total Value', v:rupee(items.reduce((s,i)=>s+(i.estimated_amount||0),0)), c:'#3b82f6' },
        ].map(s => (
          <div key={s.l} className="stat-card" style={{ borderTopColor: s.c }}>
            <div className="stat-value" style={{ fontSize:20, color:s.c }}>{s.v}</div>
            <div className="stat-label">{s.l}</div>
          </div>
        ))}
      </div>

      <div className="table-wrap">
        <div className="table-toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Search PRs…" />
          <span style={{ marginLeft:'auto', fontSize:12, color:'#64748b' }}>{filtered.length} records</span>
        </div>
        <table>
          <thead><tr>
            <th>PR #</th><th>Title</th><th>Project</th><th>Category</th>
            <th>Amount</th><th>Priority</th>{isApprover && <th>Requester</th>}
            <th>Status</th><th>Chain</th><th>Actions</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0
              ? <tr><td colSpan={10}><Empty icon="🛒" title="No purchase requisitions" desc="Create a new PR to get started" /></td></tr>
              : filtered.map(item => {
                const submitterRole = item.requester?.role || 'employee'
                const canReview = canActOn(role, item.status, submitterRole)
                const pc = PRIORITY_COLORS[item.priority] || '#6366f1'
                return (
                  <tr key={item.id}>
                    <td style={{ fontFamily:'monospace', fontSize:11, fontWeight:700, color:'#6366f1' }}>{item.pr_number}</td>
                    <td className="td-bold">{item.title}</td>
                    <td>{item.project ? <span style={{ padding:'2px 8px', borderRadius:999, fontSize:11, fontWeight:700, background:'#ede9fe', color:'#6d28d9' }}>{item.project.name}</span> : <span style={{ color:'#ef4444', fontSize:11 }}>No project</span>}</td>
                    <td style={{ fontSize:12 }}>{item.category}</td>
                    <td style={{ fontWeight:700 }}>{rupee(item.estimated_amount)}</td>
                    <td><span style={{ padding:'3px 10px', borderRadius:999, fontSize:11, fontWeight:700, background:`${pc}15`, color:pc }}>{item.priority?.toUpperCase()}</span></td>
                    {isApprover && <td style={{ fontSize:12, color:'#64748b' }}>{item.requester?.full_name}</td>}
                    <td><span style={{ padding:'3px 10px', borderRadius:999, fontSize:11, fontWeight:700, background:item.status==='approved'?'#dcfce7':item.status==='rejected'?'#fee2e2':'#fef3c7', color:item.status==='approved'?'#15803d':item.status==='rejected'?'#dc2626':'#b45309' }}>{statusLabel(item.status)}</span></td>
                    <td><ApprovalChainViz submitterRole={submitterRole} currentStatus={item.status} compact /></td>
                    <td>
                      <div style={{ display:'flex', gap:5 }}>
                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setShowDetail(item)}><Eye size={13} /></button>
                        {canReview && <button className="btn btn-primary btn-sm" onClick={() => { setShowReview(item); setNote('') }}>Review</button>}
                      </div>
                    </td>
                  </tr>
                )
              })
            }
          </tbody>
        </table>
      </div>

      {/* Create Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="New Purchase Requisition" size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>{submitting ? 'Submitting…' : 'Submit PR'}</button>
        </>}>
        {err && <div className="alert alert-danger" style={{ marginBottom:14 }}>{err}</div>}
        <div className="form-group">
          <label className="form-label">Title *</label>
          <input className="form-input" value={form.title} onChange={e => setForm(f=>({...f,title:e.target.value}))} placeholder="What do you need to purchase?" required style={{ borderColor: formErr.title ? '#ef4444' : undefined }} />
          {formErr.title && <div style={{ fontSize:11, color:'#ef4444', marginTop:3 }}>{formErr.title}</div>}
        </div>
        <div className="form-group">
          <label className="form-label">Project * <span style={{ color:'#ef4444' }}>— required for budget tracking</span></label>
          <ProjectSelect value={form.project_id} onChange={v => setForm(f=>({...f,project_id:v}))} projects={projects} required />
          {formErr.project_id && <div style={{ fontSize:11, color:'#ef4444', marginTop:3 }}>{formErr.project_id}</div>}
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Category *</label>
            <select className="form-select" value={form.category} onChange={e => setForm(f=>({...f,category:e.target.value}))} style={{ borderColor: formErr.category ? '#ef4444' : undefined }}>
              <option value="">Select category</option>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
            {formErr.category && <div style={{ fontSize:11, color:'#ef4444', marginTop:3 }}>{formErr.category}</div>}
          </div>
          <div className="form-group">
            <label className="form-label">Priority</label>
            <select className="form-select" value={form.priority} onChange={e => setForm(f=>({...f,priority:e.target.value}))}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Estimated Amount (₹) *</label>
            <div style={{ position:'relative' }}>
              <span style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'#64748b', fontWeight:700 }}>₹</span>
              <input className="form-input" type="number" value={form.estimated_amount} onChange={e => setForm(f=>({...f,estimated_amount:e.target.value}))} placeholder="0" style={{ paddingLeft:24, borderColor: formErr.estimated_amount ? '#ef4444' : undefined }} />
            </div>
            {formErr.estimated_amount && <div style={{ fontSize:11, color:'#ef4444', marginTop:3 }}>{formErr.estimated_amount}</div>}
          </div>
          <div className="form-group">
            <label className="form-label">Required By</label>
            <input className="form-input" type="date" value={form.required_by} onChange={e => setForm(f=>({...f,required_by:e.target.value}))} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Preferred Vendor</label>
          <select className="form-select" value={form.vendor_id} onChange={e => setForm(f=>({...f,vendor_id:e.target.value}))}>
            <option value="">No preference</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Justification / Description</label>
          <textarea className="form-textarea" value={form.justification} onChange={e => setForm(f=>({...f,justification:e.target.value}))} placeholder="Why is this purchase needed?" />
        </div>
        <div style={{ padding:'10px 14px', borderRadius:10, background:'#f0f9ff', border:'1px solid #bae6fd' }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#0369a1', marginBottom:8 }}>APPROVAL CHAIN</div>
          <ApprovalChainViz submitterRole={role} currentStatus="submitted" />
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal open={!!showDetail} onClose={() => setShowDetail(null)} title="PR Details" size="lg"
        footer={<>
          {showDetail && canActOn(role, showDetail.status, showDetail.requester?.role||'employee') && (
            <button className="btn btn-primary btn-sm" onClick={() => { setShowReview(showDetail); setShowDetail(null) }}>Review</button>
          )}
          <button className="btn btn-ghost" onClick={() => setShowDetail(null)}>Close</button>
        </>}>
        {showDetail && (
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:16 }}>
              <div>
                <div style={{ fontFamily:'monospace', color:'#6366f1', fontWeight:700, fontSize:12 }}>{showDetail.pr_number}</div>
                <div style={{ fontWeight:700, fontSize:18 }}>{showDetail.title}</div>
                {showDetail.requester && <div style={{ fontSize:13, color:'#64748b' }}>by {showDetail.requester.full_name} ({showDetail.requester.role})</div>}
              </div>
              <StatusBadge status={showDetail.status} />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:16 }}>
              {[
                ['Amount', rupee(showDetail.estimated_amount)],
                ['Project', showDetail.project?.name || '—'],
                ['Category', showDetail.category],
                ['Priority', showDetail.priority?.toUpperCase()],
                ['Required By', dateFmt(showDetail.required_by)],
                ['Submitted', dateFmt(showDetail.created_at)],
              ].map(([k,v]) => (
                <div key={k} style={{ padding:'10px 14px', background:'#f8fafc', borderRadius:10 }}>
                  <div style={{ fontSize:11, color:'#94a3b8', fontWeight:600 }}>{k}</div>
                  <div style={{ fontWeight:600, marginTop:2, fontSize:14 }}>{v}</div>
                </div>
              ))}
            </div>
            {showDetail.justification && <div style={{ padding:'10px 14px', background:'#f8fafc', borderRadius:10, marginBottom:12, fontSize:13 }}>{showDetail.justification}</div>}
            <div style={{ marginTop:12 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', marginBottom:8 }}>Approval Chain</div>
              <ApprovalChainViz submitterRole={showDetail.requester?.role||'employee'} currentStatus={showDetail.status} />
            </div>
          </div>
        )}
      </Modal>

      {/* Review Modal */}
      <Modal open={!!showReview} onClose={() => setShowReview(null)} title="Review PR"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowReview(null)}>Cancel</button>
          <button className="btn btn-danger" onClick={() => handleApprove(showReview,'reject')} disabled={submitting}><XCircle size={13} /> Reject</button>
          <button className="btn btn-success" onClick={() => handleApprove(showReview,'approve')} disabled={submitting}><CheckCircle size={13} /> Approve</button>
        </>}>
        {showReview && (
          <div>
            <div style={{ padding:'12px 14px', background:'#f8fafc', borderRadius:10, marginBottom:12 }}>
              <div style={{ fontWeight:700 }}>{showReview.title}</div>
              <div style={{ fontSize:13, color:'#64748b', marginTop:4, display:'flex', gap:12, flexWrap:'wrap' }}>
                <span>{rupee(showReview.estimated_amount)}</span>
                {showReview.project?.name && <span>📁 {showReview.project.name}</span>}
                {showReview.requester?.full_name && <span>👤 {showReview.requester.full_name}</span>}
              </div>
            </div>
            <div style={{ marginBottom:12 }}><ApprovalChainViz submitterRole={showReview.requester?.role||'employee'} currentStatus={showReview.status} /></div>
            <div className="form-group">
              <label className="form-label">Comments</label>
              <textarea className="form-textarea" value={note} onChange={e => setNote(e.target.value)} placeholder="Reason for approval or rejection…" />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
