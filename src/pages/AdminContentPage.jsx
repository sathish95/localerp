import { useState, useEffect } from 'react'
import { supabase, dateFmt } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Modal, Loader, Empty } from '../components/ui'
import { Plus, Edit2, Trash2, Eye, EyeOff, Megaphone, Trophy, Newspaper, Lightbulb } from 'lucide-react'

const TABS = [
  { id:'announcements', label:'Announcements', icon:<Megaphone size={15}/> },
  { id:'awards',        label:'Awards',        icon:<Trophy size={15}/> },
  { id:'news',          label:'News Posts',    icon:<Newspaper size={15}/> },
  { id:'hackathon',     label:'Hackathon',     icon:<Lightbulb size={15}/> },
]

export default function AdminContentPage() {
  const { profile } = useAuth()
  const [tab,  setTab]  = useState('announcements')
  const [data, setData] = useState([])
  const [users,setUsers]= useState([])
  const [loading, setL] = useState(true)
  const [showModal, setSM]= useState(false)
  const [editing, setEd]= useState(null)
  const [form, setForm] = useState({})
  const [sub, setSub]   = useState(false)

  useEffect(() => { load() }, [tab])
  useEffect(() => {
    supabase.from('profiles').select('id,full_name,role').order('full_name').then(({data})=>setUsers(data||[]))
  }, [])

  async function load() {
    setL(true)
    const table = tab==='hackathon'?'hackathon_topics':tab==='news'?'news_posts':tab==='awards'?'awards':tab
    const { data: d } = await supabase.from(table).select('*, awarded_to_user:profiles!awarded_to(full_name)').order('created_at',{ascending:false})
    setData(d||[])
    setL(false)
  }

  async function save() {
    setSub(true)
    try {
      const table = tab==='hackathon'?'hackathon_topics':tab==='news'?'news_posts':tab==='awards'?'awards':tab
      const payload = { ...form, created_by: profile.id }
      if (editing) await supabase.from(table).update(payload).eq('id', editing.id)
      else await supabase.from(table).insert(payload)
      setSM(false); setForm({}); setEd(null); load()
    } catch(e) { alert(e.message) }
    finally { setSub(false) }
  }

  async function toggle(item, field='is_active') {
    const table = tab==='hackathon'?'hackathon_topics':tab==='news'?'news_posts':tab==='awards'?'awards':tab
    const updateField = tab==='news' ? 'is_published' : 'is_active'
    await supabase.from(table).update({ [updateField]: !item[updateField] }).eq('id',item.id)
    load()
  }

  async function del(id) {
    const table = tab==='hackathon'?'hackathon_topics':tab==='news'?'news_posts':tab==='awards'?'awards':tab
    await supabase.from(table).delete().eq('id',id); load()
  }

  function openCreate() {
    setEd(null)
    const defaults = {
      announcements: { title:'', content:'', type:'info', is_active:true, pinned:false },
      awards:        { title:'', description:'', icon:'🏆', color:'#f59e0b', awarded_to:'', award_date:new Date().toISOString().split('T')[0], is_active:true },
      news:          { title:'', content:'', image_url:'', category:'update', is_published:false },
      hackathon:     { title:'', description:'', difficulty:'medium', tags:'', is_active:true },
    }
    setForm(defaults[tab]||{})
    setSM(true)
  }

  function openEdit(item) {
    setEd(item)
    const f = { ...item }
    if (tab==='hackathon' && Array.isArray(f.tags)) f.tags = f.tags.join(', ')
    setForm(f); setSM(true)
  }

  function buildSavePayload() {
    const f = { ...form }
    if (tab==='hackathon' && typeof f.tags==='string') {
      f.tags = f.tags.split(',').map(t=>t.trim()).filter(Boolean)
    }
    return f
  }

  const isActive = item => tab==='news' ? item.is_published : item.is_active

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Landing Page Content</div>
          <div className="page-subtitle">Manage announcements, awards, news and hackathon topics shown on the public landing page</div>
        </div>
        <button className="btn btn-primary" onClick={openCreate}><Plus size={14}/> Add {tab==='hackathon'?'Topic':tab==='news'?'News Post':tab==='awards'?'Award':'Announcement'}</button>
      </div>

      {/* Tab bar */}
      <div style={{ display:'flex', gap:4, marginBottom:20, borderBottom:'1px solid #e2e8f0', paddingBottom:0 }}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'10px 16px', border:'none', background:'transparent', cursor:'pointer', fontWeight:700, fontSize:13, color:tab===t.id?'#6366f1':'#64748b', borderBottom:tab===t.id?'2.5px solid #6366f1':'2.5px solid transparent', marginBottom:-1, fontFamily:'inherit' }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {loading ? <Loader/> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                {tab==='announcements' && <><th>Type</th><th>Pinned</th></>}
                {tab==='awards' && <><th>Recipient</th><th>Date</th></>}
                {tab==='news' && <><th>Category</th><th>Image</th></>}
                {tab==='hackathon' && <><th>Difficulty</th><th>Tags</th></>}
                <th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.length===0 ? (
                <tr><td colSpan={6} style={{ padding:0 }}><Empty icon="📝" title="Nothing here" desc="Click Add to create the first item"/></td></tr>
              ) : data.map(item=>(
                <tr key={item.id}>
                  <td className="td-bold" style={{ maxWidth:200 }}>{item.title}</td>
                  {tab==='announcements' && <><td><span className="badge badge-info" style={{ fontSize:11 }}>{item.type}</span></td><td>{item.pinned?'📌':''}</td></>}
                  {tab==='awards' && <><td>{item.awarded_to_user?.full_name||<span style={{color:'#94a3b8'}}>Unassigned</span>}</td><td style={{fontSize:12}}>{dateFmt(item.award_date)}</td></>}
                  {tab==='news' && <><td><span className="badge badge-info" style={{ fontSize:11 }}>{item.category}</span></td><td>{item.image_url?'🖼️':''}</td></>}
                  {tab==='hackathon' && <><td><span style={{ padding:'2px 8px', borderRadius:999, fontSize:11, fontWeight:700, background:item.difficulty==='hard'?'#fee2e2':item.difficulty==='expert'?'#ede9fe':'#fef3c7', color:item.difficulty==='hard'?'#dc2626':item.difficulty==='expert'?'#6d28d9':'#b45309' }}>{item.difficulty}</span></td><td style={{fontSize:12,color:'#64748b'}}>{(item.tags||[]).join(', ')}</td></>}
                  <td>
                    <span style={{ padding:'3px 10px', borderRadius:999, fontSize:11, fontWeight:700, background:isActive(item)?'#dcfce7':'#f1f5f9', color:isActive(item)?'#15803d':'#475569' }}>
                      {isActive(item)?'Active':'Hidden'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display:'flex', gap:5 }}>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={()=>toggle(item)} title={isActive(item)?'Hide':'Show'}>
                        {isActive(item)?<EyeOff size={13}/>:<Eye size={13}/>}
                      </button>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={()=>openEdit(item)}><Edit2 size={13}/></button>
                      <button className="btn btn-ghost btn-sm btn-icon" style={{color:'#ef4444'}} onClick={()=>del(item.id)}><Trash2 size={13}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      <Modal open={showModal} onClose={()=>{setSM(false);setForm({})}} title={editing?'Edit':'Add New'} size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={()=>{setSM(false);setForm({})}}>Cancel</button>
          <button className="btn btn-primary" onClick={async()=>{const f=buildSavePayload();const orig=form;setForm(f);await save();setForm(orig)}} disabled={sub}>{sub?'Saving…':'Save'}</button>
        </>}>

        {/* Announcements form */}
        {tab==='announcements' && <>
          <div className="form-group"><label className="form-label">Title *</label><input className="form-input" value={form.title||''} onChange={e=>setForm(f=>({...f,title:e.target.value}))} required/></div>
          <div className="form-group"><label className="form-label">Content *</label><textarea className="form-textarea" value={form.content||''} onChange={e=>setForm(f=>({...f,content:e.target.value}))} required style={{minHeight:100}}/></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Type</label>
              <select className="form-select" value={form.type||'info'} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>
                {['info','success','warning','event'].map(t=><option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Expires At</label><input className="form-input" type="datetime-local" value={form.expires_at||''} onChange={e=>setForm(f=>({...f,expires_at:e.target.value}))}/></div>
          </div>
          <div style={{ display:'flex', gap:20 }}>
            <label style={{ display:'flex', gap:8, cursor:'pointer', fontSize:13, fontWeight:600, alignItems:'center' }}>
              <input type="checkbox" checked={!!form.is_active} onChange={e=>setForm(f=>({...f,is_active:e.target.checked}))}/> Active (show on landing)
            </label>
            <label style={{ display:'flex', gap:8, cursor:'pointer', fontSize:13, fontWeight:600, alignItems:'center' }}>
              <input type="checkbox" checked={!!form.pinned} onChange={e=>setForm(f=>({...f,pinned:e.target.checked}))}/> 📌 Pinned
            </label>
          </div>
        </>}

        {/* Awards form */}
        {tab==='awards' && <>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Award Title *</label><input className="form-input" value={form.title||''} onChange={e=>setForm(f=>({...f,title:e.target.value}))} required/></div>
            <div className="form-group"><label className="form-label">Icon (emoji)</label><input className="form-input" value={form.icon||'🏆'} onChange={e=>setForm(f=>({...f,icon:e.target.value}))} maxLength={4}/></div>
          </div>
          <div className="form-group"><label className="form-label">Description</label><textarea className="form-textarea" value={form.description||''} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Award To (Employee)</label>
              <select className="form-select" value={form.awarded_to||''} onChange={e=>setForm(f=>({...f,awarded_to:e.target.value||null}))}>
                <option value="">Not assigned</option>
                {users.map(u=><option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Award Date</label><input className="form-input" type="date" value={form.award_date||''} onChange={e=>setForm(f=>({...f,award_date:e.target.value}))}/></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Color</label><input className="form-input" type="color" value={form.color||'#f59e0b'} onChange={e=>setForm(f=>({...f,color:e.target.value}))} style={{height:42}}/></div>
            <div className="form-group" style={{ display:'flex', alignItems:'flex-end', paddingBottom:4 }}>
              <label style={{ display:'flex', gap:8, cursor:'pointer', fontSize:13, fontWeight:600, alignItems:'center' }}>
                <input type="checkbox" checked={!!form.is_active} onChange={e=>setForm(f=>({...f,is_active:e.target.checked}))}/> Show on landing page
              </label>
            </div>
          </div>
        </>}

        {/* News form */}
        {tab==='news' && <>
          <div className="form-group"><label className="form-label">Title *</label><input className="form-input" value={form.title||''} onChange={e=>setForm(f=>({...f,title:e.target.value}))} required/></div>
          <div className="form-group"><label className="form-label">Content *</label><textarea className="form-textarea" value={form.content||''} onChange={e=>setForm(f=>({...f,content:e.target.value}))} required style={{minHeight:120}}/></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Image URL</label><input className="form-input" value={form.image_url||''} onChange={e=>setForm(f=>({...f,image_url:e.target.value}))} placeholder="https://..."/></div>
            <div className="form-group"><label className="form-label">Category</label>
              <select className="form-select" value={form.category||'update'} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>
                {['update','event','milestone','product','general'].map(c=><option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>)}
              </select></div>
          </div>
          <label style={{ display:'flex', gap:8, cursor:'pointer', fontSize:13, fontWeight:600, alignItems:'center' }}>
            <input type="checkbox" checked={!!form.is_published} onChange={e=>setForm(f=>({...f,is_published:e.target.checked,published_at:e.target.checked?new Date().toISOString():null}))}/> Publish (visible on landing page)
          </label>
        </>}

        {/* Hackathon form */}
        {tab==='hackathon' && <>
          <div className="form-group"><label className="form-label">Topic Title *</label><input className="form-input" value={form.title||''} onChange={e=>setForm(f=>({...f,title:e.target.value}))} required/></div>
          <div className="form-group"><label className="form-label">Description</label><textarea className="form-textarea" value={form.description||''} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Difficulty</label>
              <select className="form-select" value={form.difficulty||'medium'} onChange={e=>setForm(f=>({...f,difficulty:e.target.value}))}>
                {['easy','medium','hard','expert'].map(d=><option key={d} value={d}>{d.charAt(0).toUpperCase()+d.slice(1)}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Tags (comma separated)</label><input className="form-input" value={typeof form.tags==='string'?form.tags:(form.tags||[]).join(', ')} onChange={e=>setForm(f=>({...f,tags:e.target.value}))} placeholder="AI, Finance, React"/></div>
          </div>
          <label style={{ display:'flex', gap:8, cursor:'pointer', fontSize:13, fontWeight:600, alignItems:'center' }}>
            <input type="checkbox" checked={!!form.is_active} onChange={e=>setForm(f=>({...f,is_active:e.target.checked}))}/> Active (show on landing page)
          </label>
        </>}
      </Modal>
    </div>
  )
}
