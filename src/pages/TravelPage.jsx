import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, dateFmt, rupee, nextNum } from '../lib/supabase'
import { getChain, canActOn, buildApprovalUpdate, statusLabel } from '../lib/approvalFlow.js'
import ApprovalChainViz from '../components/ui/ApprovalChainViz'
import { Modal, StatusBadge, SearchBox, Loader, Empty, Confirm } from '../components/ui'
import { Plus, Trash2, Plane, Calendar, DollarSign, Eye, CheckCircle, XCircle } from 'lucide-react'

const MODES = ['Flight','Train','Bus','Car','Cab','Other']

const initForm = () => ({
  from_location:'', to_location:'', travel_date:'',
  return_date:'', purpose:'', travel_mode:'Flight',
  estimated_cost:'', project_id:''
})

export default function TravelPage() {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const isEmployee = role === 'employee'

  const [items,      setItems]   = useState([])
  const [projects,   setProjects]= useState([])
  const [loading,    setLoading] = useState(true)
  const [search,     setSearch]  = useState('')
  const [showModal,  setShowModal]=useState(false)
  const [showDetail, setShowDetail]=useState(null)
  const [showReview, setShowReview]=useState(null)
  const [deleteId,   setDeleteId] = useState(null)
  const [form,       setForm]    = useState(initForm())
  const [note,       setNote]    = useState('')
  const [submitting, setSub]     = useState(false)
  const [err,        setErr]     = useState('')

  useEffect(() => { load(); loadProjects() }, [role])

  async function loadProjects() {
    const { data } = await supabase.from('projects').select('id,name,code,budget,spent').order('name')
    setProjects(data || [])
  }

  async function load() {
    setLoading(true)
    let q = supabase.from('travel_requests')
      .select('*, requester:profiles!requested_by(full_name,role), project:projects(id,name,code,budget,spent)')
    if (isEmployee) q = q.eq('requested_by', profile.id)
    const { data } = await q.order('created_at', { ascending:false })
    setItems(data || [])
    setLoading(false)
  }

  async function handleSubmit(e) {
    e.preventDefault(); setSub(true); setErr('')
    try {
      const num = await nextNum('travel')
      const cost = parseFloat(form.estimated_cost) || null

      if (form.project_id && cost) {
        const proj = projects.find(p => p.id === form.project_id)
        const rem = (proj?.budget||0) - (proj?.spent||0)
        if (cost > rem) throw new Error(`Estimated cost ₹${cost.toLocaleString('en-IN')} exceeds project budget remaining (₹${rem.toLocaleString('en-IN')})`)
      }

      const { error } = await supabase.from('travel_requests').insert({
        request_number: num,
        from_location:  form.from_location,
        to_location:    form.to_location,
        travel_date:    form.travel_date,
        return_date:    form.return_date || null,
        purpose:        form.purpose,
        travel_mode:    form.travel_mode,
        estimated_cost: cost,
        project_id:     form.project_id || null,
        requested_by:   profile.id,
        status:         'submitted',
      })
      if (error) throw error

      if (form.project_id && cost) {
        const proj = projects.find(p => p.id === form.project_id)
        await supabase.from('projects').update({ spent: (proj?.spent||0) + cost }).eq('id', form.project_id)
      }

      setShowModal(false); setForm(initForm()); load(); loadProjects()
    } catch (e) { setErr(e.message) }
    finally { setSub(false) }
  }

  async function handleApprove(item, action) {
    setSub(true)
    try {
      const submitterRole = item.requester?.role || 'employee'
      const update = buildApprovalUpdate(action, item.status, role, submitterRole, profile.id, note)
      const { error } = await supabase.from('travel_requests').update(update).eq('id', item.id)
      if (error) throw error
      await supabase.from('approval_logs').insert({
        entity_type:'travel', entity_id:item.id, performed_by:profile.id,
        action, from_status:item.status, to_status:update.status, comments:note,
      })
      setShowReview(null); setNote(''); load()
    } catch (e) { alert(e.message) }
    finally { setSub(false) }
  }

  async function handleDelete(id) {
    await supabase.from('travel_requests').delete().eq('id', id)
    setDeleteId(null); load()
  }

  const COLORS = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6']
  const filtered = items.filter(i => !search ||
    i.from_location?.toLowerCase().includes(search.toLowerCase()) ||
    i.to_location?.toLowerCase().includes(search.toLowerCase()) ||
    i.purpose?.toLowerCase().includes(search.toLowerCase())
  )

  const myChain = getChain(role)

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Travel Requests</div>
          <div className="page-subtitle">Submit and track business travel — ThingsaliveWork</div>
        </div>
        <button className="btn btn-primary" onClick={() => { setErr(''); setForm(initForm()); setShowModal(true) }}>
          <Plus size={15} /> New Request
        </button>
      </div>

      {/* Flow banner */}
      <div style={{ background:'#f8fafc', border:'1.5px solid #e2e8f0', borderRadius:14, padding:'12px 18px', marginBottom:20, display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
        <span style={{ fontSize:11, fontWeight:800, color:'#94a3b8', letterSpacing:'.06em' }}>YOUR APPROVAL FLOW</span>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          {myChain.map((s,i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ padding:'4px 12px', borderRadius:999, fontSize:11, fontWeight:700, background:i===0?'#ede9fe':'#f1f5f9', color:i===0?'#6d28d9':'#475569' }}>{s.label}</span>
              {i < myChain.length-1 && <span style={{ color:'#cbd5e1', fontWeight:700 }}>→</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom:20 }}>
        {[
          { l:'Total', v:items.length, c:'#6366f1' },
          { l:'Pending', v:items.filter(i=>['submitted','manager_review','ceo_review','finance_review'].includes(i.status)).length, c:'#f59e0b' },
          { l:'Approved', v:items.filter(i=>i.status==='approved').length, c:'#10b981' },
          { l:'Rejected', v:items.filter(i=>i.status==='rejected').length, c:'#ef4444' },
        ].map(s => (
          <div key={s.l} className="stat-card" style={{ borderTopColor:s.c }}>
            <div className="stat-value" style={{ fontSize:22, color:s.c }}>{s.v}</div>
            <div className="stat-label">{s.l}</div>
          </div>
        ))}
      </div>

      {/* Cards */}
      <div className="table-wrap">
        <div className="table-toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Search travel requests…" />
          <span style={{ marginLeft:'auto', fontSize:12, color:'#64748b' }}>{filtered.length} records</span>
        </div>
        {filtered.length === 0 ? (
          <Empty icon="✈️" title="No travel requests" desc="Submit a new travel request" />
        ) : (
          <table>
            <thead><tr>
              <th>Request #</th><th>Route</th><th>Project</th><th>Mode</th>
              <th>Travel Date</th><th>Est. Cost</th>{!isEmployee && <th>Requester</th>}
              <th>Status</th><th>Chain</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {filtered.map(item => {
                const submitterRole = item.requester?.role || 'employee'
                const canReview = canActOn(role, item.status, submitterRole)
                return (
                  <tr key={item.id}>
                    <td style={{ fontFamily:'monospace', fontSize:11, fontWeight:700, color:'#6366f1' }}>{item.request_number}</td>
                    <td>
                      <div style={{ fontWeight:700, fontSize:13 }}>{item.from_location} → {item.to_location}</div>
                      <div style={{ fontSize:11, color:'#94a3b8' }}>{item.purpose?.slice(0,40)}{item.purpose?.length>40?'…':''}</div>
                    </td>
                    <td>
                      {item.project
                        ? <span style={{ padding:'2px 8px', borderRadius:999, fontSize:11, fontWeight:700, background:'#ede9fe', color:'#6d28d9' }}>{item.project.name}</span>
                        : <span style={{ color:'#94a3b8', fontSize:12 }}>—</span>}
                    </td>
                    <td style={{ fontSize:12 }}>{item.travel_mode}</td>
                    <td style={{ fontSize:12 }}>{dateFmt(item.travel_date)}{item.return_date ? <div style={{ fontSize:10, color:'#94a3b8' }}>→ {dateFmt(item.return_date)}</div> : null}</td>
                    <td style={{ fontWeight:700 }}>{item.estimated_cost ? `₹${item.estimated_cost.toLocaleString('en-IN')}` : '—'}</td>
                    {!isEmployee && <td style={{ fontSize:12, color:'#64748b' }}>{item.requester?.full_name} <span style={{ color:'#94a3b8' }}>({item.requester?.role})</span></td>}
                    <td>
                      <span style={{ padding:'3px 10px', borderRadius:999, fontSize:11, fontWeight:700,
                        background:item.status==='approved'?'#dcfce7':item.status==='rejected'?'#fee2e2':item.status==='submitted'?'#fef3c7':'#ede9fe',
                        color:item.status==='approved'?'#15803d':item.status==='rejected'?'#dc2626':item.status==='submitted'?'#b45309':'#6d28d9' }}>
                        {statusLabel(item.status)}
                      </span>
                    </td>
                    <td><ApprovalChainViz submitterRole={submitterRole} currentStatus={item.status} compact /></td>
                    <td>
                      <div style={{ display:'flex', gap:5 }}>
                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setShowDetail(item)}><Eye size={13} /></button>
                        {canReview && <button className="btn btn-primary btn-sm" onClick={() => { setShowReview(item); setNote('') }}>Review</button>}
                        {isEmployee && item.status === 'submitted' && (
                          <button className="btn btn-ghost btn-sm btn-icon" style={{ color:'#ef4444' }} onClick={() => setDeleteId(item.id)}><Trash2 size={13} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="New Travel Request" size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>{submitting ? 'Submitting…' : 'Submit Request'}</button>
        </>}>
        {err && <div className="alert alert-danger" style={{ marginBottom:14 }}>{err}</div>}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">From *</label>
            <input className="form-input" value={form.from_location} onChange={e=>setForm(f=>({...f,from_location:e.target.value}))} placeholder="Departure city" required />
          </div>
          <div className="form-group">
            <label className="form-label">To *</label>
            <input className="form-input" value={form.to_location} onChange={e=>setForm(f=>({...f,to_location:e.target.value}))} placeholder="Destination city" required />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Travel Date *</label>
            <input className="form-input" type="date" value={form.travel_date} onChange={e=>setForm(f=>({...f,travel_date:e.target.value}))} required />
          </div>
          <div className="form-group">
            <label className="form-label">Return Date</label>
            <input className="form-input" type="date" value={form.return_date} onChange={e=>setForm(f=>({...f,return_date:e.target.value}))} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Mode</label>
            <select className="form-select" value={form.travel_mode} onChange={e=>setForm(f=>({...f,travel_mode:e.target.value}))}>
              {MODES.map(m=><option key={m}>{m}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Estimated Cost (₹)</label>
            <div style={{ position:'relative' }}>
              <span style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'#64748b', fontWeight:700 }}>₹</span>
              <input className="form-input" type="number" value={form.estimated_cost} onChange={e=>setForm(f=>({...f,estimated_cost:e.target.value}))} placeholder="0" style={{ paddingLeft:24 }} />
            </div>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Project</label>
          <select className="form-select" value={form.project_id} onChange={e=>setForm(f=>({...f,project_id:e.target.value}))}>
            <option value="">No project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Purpose *</label>
          <textarea className="form-textarea" value={form.purpose} onChange={e=>setForm(f=>({...f,purpose:e.target.value}))} placeholder="Business purpose of travel…" required />
        </div>
        <div style={{ padding:'10px 14px', borderRadius:10, background:'#f0f9ff', border:'1px solid #bae6fd' }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#0369a1', marginBottom:8 }}>APPROVAL CHAIN</div>
          <ApprovalChainViz submitterRole={role} currentStatus="submitted" />
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal open={!!showDetail} onClose={() => setShowDetail(null)} title="Travel Request Details" size="lg"
        footer={<>
          {showDetail && canActOn(role, showDetail.status, showDetail.requester?.role||'employee') && (
            <button className="btn btn-primary btn-sm" onClick={() => { setShowReview(showDetail); setShowDetail(null) }}>Review</button>
          )}
          <button className="btn btn-ghost" onClick={() => setShowDetail(null)}>Close</button>
        </>}>
        {showDetail && (
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:20 }}>
              <div style={{ fontSize:20, fontWeight:800 }}>{showDetail.from_location} → {showDetail.to_location}</div>
              <span style={{ padding:'5px 14px', borderRadius:999, fontSize:12, fontWeight:700,
                background:showDetail.status==='approved'?'#dcfce7':showDetail.status==='rejected'?'#fee2e2':'#fef3c7',
                color:showDetail.status==='approved'?'#15803d':showDetail.status==='rejected'?'#dc2626':'#b45309' }}>
                {statusLabel(showDetail.status)}
              </span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:16 }}>
              {[
                ['Purpose', showDetail.purpose],
                ['Mode', showDetail.travel_mode],
                ['Project', showDetail.project?.name],
                ['Est. Cost', showDetail.estimated_cost ? `₹${showDetail.estimated_cost.toLocaleString('en-IN')}` : '—'],
                ['Travel Date', dateFmt(showDetail.travel_date)],
                ['Return Date', dateFmt(showDetail.return_date)],
              ].map(([k,v]) => (
                <div key={k} style={{ padding:'10px 14px', borderRadius:10, background:'#f8fafc' }}>
                  <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', color:'#94a3b8', marginBottom:3 }}>{k}</div>
                  <div style={{ fontWeight:600, fontSize:14 }}>{v||'—'}</div>
                </div>
              ))}
            </div>
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', marginBottom:8 }}>Approval Chain</div>
              <ApprovalChainViz submitterRole={showDetail.requester?.role||'employee'} currentStatus={showDetail.status} />
            </div>
          </div>
        )}
      </Modal>

      {/* Review Modal */}
      <Modal open={!!showReview} onClose={() => setShowReview(null)} title="Review Travel Request"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowReview(null)}>Cancel</button>
          <button className="btn btn-danger" onClick={() => handleApprove(showReview,'reject')} disabled={submitting}><XCircle size={13} /> Reject</button>
          <button className="btn btn-success" onClick={() => handleApprove(showReview,'approve')} disabled={submitting}><CheckCircle size={13} /> Approve</button>
        </>}>
        {showReview && (
          <div>
            <div style={{ padding:'12px 14px', background:'#f8fafc', borderRadius:10, marginBottom:14 }}>
              <div style={{ fontWeight:700 }}>{showReview.from_location} → {showReview.to_location}</div>
              <div style={{ fontSize:13, color:'#64748b', marginTop:4, display:'flex', gap:12, flexWrap:'wrap' }}>
                <span>✈️ {showReview.travel_mode}</span>
                {showReview.estimated_cost && <span>₹{showReview.estimated_cost.toLocaleString('en-IN')}</span>}
                {showReview.project?.name && <span>📁 {showReview.project.name}</span>}
                {showReview.requester?.full_name && <span>👤 {showReview.requester.full_name} ({showReview.requester.role})</span>}
              </div>
            </div>
            {(() => {
              const submitterRole = showReview.requester?.role || 'employee'
              const chain = getChain(submitterRole)
              const curIdx = chain.findIndex(s => s.status === showReview.status)
              const next = chain[curIdx + 1]
              return (
                <div style={{ padding:'10px 14px', borderRadius:10, background:'#ede9fe', fontSize:12, marginBottom:14, color:'#6d28d9', fontWeight:600 }}>
                  Approve → {next ? `moves to ${next.label} review` : 'Final Approval ✓'}
                </div>
              )
            })()}
            <div style={{ marginBottom:12 }}>
              <ApprovalChainViz submitterRole={showReview.requester?.role||'employee'} currentStatus={showReview.status} />
            </div>
            <div className="form-group">
              <label className="form-label">Comments (optional)</label>
              <textarea className="form-textarea" value={note} onChange={e=>setNote(e.target.value)} placeholder="Reason for approval or rejection…" />
            </div>
          </div>
        )}
      </Modal>

      <Confirm open={!!deleteId} message="Delete this travel request?" danger onConfirm={() => handleDelete(deleteId)} onCancel={() => setDeleteId(null)} />
    </div>
  )
}
