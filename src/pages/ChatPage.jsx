import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { sendNotif } from '../lib/notifications'
import { Loader } from '../components/ui'
import { Send, Search, MessageSquare, Eye } from 'lucide-react'

/* ─── Helpers ─────────────────────────────────────── */
const Ava = ({ name = '?', size = 32, online }) => {
  const ini = (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div style={{ position:'relative', flexShrink:0 }}>
      <div style={{ width:size, height:size, borderRadius:Math.round(size*.3), background:'linear-gradient(135deg,var(--c1),#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:Math.round(size*.38), fontWeight:700 }}>{ini}</div>
      {online !== undefined && (
        <div style={{ position:'absolute', bottom:0, right:0, width:10, height:10, borderRadius:'50%', background:online?'#10b981':'#94a3b8', border:'2px solid var(--surface)' }}/>
      )}
    </div>
  )
}

function timeFmt(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true })
  return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short' })
}

function dateSep(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })
}

/* ─── Canonical room ID for a DM ─────────────────── */
function dmCanonical(a, b) {
  return [a, b].sort().join('::')
}

/* ══ MAIN PAGE ═══════════════════════════════════════ */
export default function ChatPage() {
  const { profile } = useAuth()
  const role    = profile?.role || 'employee'
  const isCEO   = ['admin','ceo'].includes(role)

  const [tab,       setTab]       = useState('chat')   // 'chat' | 'monitor'
  const [users,     setUsers]     = useState([])
  const [rooms,     setRooms]     = useState([])       // rooms current user is in
  const [allRooms,  setAllRooms]  = useState([])       // CEO monitor: all rooms
  const [messages,  setMessages]  = useState([])
  const [activeRoom,setActiveRoom]= useState(null)     // { id, otherUser }
  const [text,      setText]      = useState('')
  const [search,    setSearch]    = useState('')
  const [loading,   setLoading]   = useState(true)
  const [sending,   setSending]   = useState(false)
  const [presence,  setPresence]  = useState({})       // { userId: true/false }

  const msgEndRef  = useRef(null)
  const channelRef = useRef(null)
  const presRef    = useRef(null)

  useEffect(() => { init() }, [profile?.id])

  async function init() {
    if (!profile?.id) return
    setLoading(true)
    const [usersRes, roomsRes] = await Promise.all([
      supabase.from('profiles').select('id,full_name,role').order('full_name'),
      // Rooms this user is a member of
      supabase.from('chat_rooms')
        .select('*, members:chat_room_members(user_id), last_msg:chat_messages(message,sender_id,created_at)')
        .order('created_at', { ascending: false }),
    ])
    setUsers(usersRes.data || [])

    // CEO: also load all rooms
    if (isCEO) {
      const { data: allR } = await supabase.from('chat_rooms')
        .select('*, members:chat_room_members(user_id, user:profiles(id,full_name,role)), last_msg:chat_messages(message,sender_id,created_at)')
        .order('created_at', { ascending: false })
      setAllRooms(allR || [])
    }

    // Filter rooms this user is in
    const myRooms = (roomsRes.data || []).filter(r => r.members?.some(m => m.user_id === profile.id))
    setRooms(myRooms)

    setLoading(false)
    setupPresence()
  }

  function setupPresence() {
    if (presRef.current) supabase.removeChannel(presRef.current)
    const ch = supabase.channel('presence-chat', { config: { presence: { key: profile.id } } })
      .on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState()
        const online = {}
        Object.values(state).flat().forEach(p => { online[p.user_id] = true })
        setPresence(online)
      })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await ch.track({ user_id: profile.id, online_at: new Date().toISOString() })
        }
      })
    presRef.current = ch
  }

  async function openRoom(otherUser) {
    const canonical = dmCanonical(profile.id, otherUser.id)

    // Find or create room
    let room = rooms.find(r => r.canonical_id === canonical)
    if (!room) {
      const { data: existingRoom } = await supabase.from('chat_rooms').select('*').eq('canonical_id', canonical).maybeSingle()
      if (existingRoom) {
        room = existingRoom
      } else {
        const { data: newRoom } = await supabase.from('chat_rooms').insert({ type:'direct', canonical_id: canonical, created_by: profile.id }).select().single()
        if (newRoom) {
          await supabase.from('chat_room_members').insert([
            { room_id: newRoom.id, user_id: profile.id },
            { room_id: newRoom.id, user_id: otherUser.id },
          ])
          room = newRoom
        }
      }
    }

    if (!room) return
    setActiveRoom({ ...room, otherUser })
    await loadMessages(room.id)
    subscribeToRoom(room.id)
  }

  async function loadMessages(roomId) {
    const { data } = await supabase.from('chat_messages')
      .select('*, sender:profiles!sender_id(id,full_name,role)')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
      .limit(200)
    setMessages(data || [])
    setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior:'smooth' }), 50)
  }

  function subscribeToRoom(roomId) {
    if (channelRef.current) supabase.removeChannel(channelRef.current)
    const ch = supabase.channel(`room-${roomId}`)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'chat_messages', filter:`room_id=eq.${roomId}` }, payload => {
        setMessages(prev => {
          if (prev.some(m => m.id === payload.new.id)) return prev
          return [...prev, payload.new]
        })
        setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior:'smooth' }), 50)
      })
      .subscribe()
    channelRef.current = ch
  }

  async function sendMessage(e) {
    e?.preventDefault()
    if (!text.trim() || !activeRoom || sending) return
    setSending(true)
    const msg = text.trim(); setText('')
    const { data: sent } = await supabase.from('chat_messages').insert({
      room_id: activeRoom.id, sender_id: profile.id, message: msg
    }).select('*, sender:profiles!sender_id(id,full_name,role)').single()

    if (sent) {
      setMessages(prev => prev.some(m => m.id === sent.id) ? prev : [...prev, sent])
      setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior:'smooth' }), 50)

      // Send notification to the other user
      if (activeRoom.otherUser?.id) {
        sendNotif(activeRoom.otherUser.id, {
          type: 'chat_message',
          title: `💬 ${profile.full_name}`,
          body: msg.length > 60 ? msg.slice(0, 60) + '…' : msg,
          link: '/chat',
          senderId: profile.id,
        })
      }
    }
    setSending(false)
  }

  // Group messages by date separator
  const groupedMsgs = useMemo(() => {
    const groups = []
    let lastDate = null
    messages.forEach(m => {
      const d = dateSep(m.created_at)
      if (d !== lastDate) { groups.push({ type:'sep', label:d, id:`sep-${m.id}` }); lastDate = d }
      groups.push({ type:'msg', ...m })
    })
    return groups
  }, [messages])

  const filteredUsers = users.filter(u => u.id !== profile.id && (!search || u.full_name.toLowerCase().includes(search.toLowerCase())))

  // Get last message for a user's DM
  function getLastMsg(userId) {
    const canonical = dmCanonical(profile.id, userId)
    const room = rooms.find(r => r.canonical_id === canonical)
    if (!room?.last_msg?.length) return null
    const msgs = room.last_msg
    return msgs[msgs.length - 1]
  }

  if (loading) return <Loader/>

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 100px)' }}>
      {/* Header */}
      <div className="page-header" style={{ marginBottom:0 }}>
        <div>
          <div className="page-title">Chat</div>
          <div className="page-subtitle">{users.length - 1} colleagues · {Object.keys(presence).length} online now</div>
        </div>
      </div>

      {/* Tabs (CEO only gets monitor tab) */}
      {isCEO && (
        <div style={{ display:'flex', gap:0, borderBottom:'1px solid var(--border)', marginBottom:0 }}>
          {[{id:'chat',label:'Messages'},{id:'monitor',label:'🔍 Monitor All Chats'}].map(t => {
            const active = tab === t.id
            return <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding:'8px 16px', border:'none', borderBottom:`2px solid ${active?'var(--c1)':'transparent'}`, cursor:'pointer', fontFamily:'inherit', fontSize:12, fontWeight:active?700:500, background:'transparent', color:active?'var(--c1)':'var(--text-muted)', marginBottom:-1 }}>
              {t.label}
            </button>
          })}
        </div>
      )}

      {/* ── CEO MONITOR TAB ──────────────────────────────── */}
      {tab === 'monitor' && isCEO && (
        <div style={{ flex:1, overflowY:'auto', padding:'16px 0' }}>
          <div className="table-wrap">
            <div className="table-toolbar">
              <span style={{ fontWeight:700, fontSize:14 }}>All Conversations</span>
              <span style={{ marginLeft:'auto', fontSize:12, color:'var(--text-muted)' }}>{allRooms.length} rooms</span>
            </div>
            <table>
              <thead><tr><th>Participants</th><th>Type</th><th>Messages</th><th>Last Activity</th><th></th></tr></thead>
              <tbody>
                {allRooms.length === 0 && (
                  <tr><td colSpan={5} style={{ padding:'30px', textAlign:'center', color:'var(--text-muted)' }}>No conversations yet</td></tr>
                )}
                {allRooms.map(r => {
                  const members = r.members || []
                  const lastMsg = (r.last_msg || []).slice(-1)[0]
                  return (
                    <tr key={r.id}>
                      <td>
                        <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                          {members.map(m => (
                            <span key={m.user_id} style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'2px 8px', borderRadius:4, background:'var(--surface-2)', fontSize:11, fontWeight:600 }}>
                              {m.user?.full_name || m.user_id.slice(0,8)}
                              <span style={{ fontSize:9, color:'var(--text-muted)', textTransform:'capitalize' }}>({m.user?.role})</span>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td><span style={{ fontSize:11, textTransform:'capitalize', color:'var(--text-muted)' }}>{r.type}</span></td>
                      <td style={{ fontFamily:'monospace', fontSize:12 }}>{(r.last_msg || []).length}</td>
                      <td style={{ fontSize:11, color:'var(--text-muted)' }}>{lastMsg ? timeFmt(lastMsg.created_at) : '—'}</td>
                      <td>
                        <button className="btn btn-ghost btn-sm btn-icon" title="View conversation"
                          onClick={async () => {
                            setTab('chat')
                            const other = members.find(m => m.user_id !== profile.id)
                            if (other?.user) openRoom(other.user)
                          }}>
                          <Eye size={12}/>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── CHAT TAB ─────────────────────────────────────── */}
      {tab === 'chat' && (
        <div style={{ display:'flex', flex:1, overflow:'hidden', borderTop:'1px solid var(--border)' }}>
          {/* Left: users list */}
          <div style={{ width:260, borderRight:'1px solid var(--border)', display:'flex', flexDirection:'column', flexShrink:0 }}>
            <div style={{ padding:'10px 12px', borderBottom:'1px solid var(--border)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px', borderRadius:8, background:'var(--surface-2)', border:'1px solid var(--border)' }}>
                <Search size={13} style={{ color:'var(--text-muted)', flexShrink:0 }}/>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search people…"
                  style={{ border:'none', background:'transparent', outline:'none', fontSize:12, fontFamily:'inherit', color:'var(--text)', flex:1, minWidth:0 }}/>
              </div>
            </div>
            <div style={{ flex:1, overflowY:'auto' }}>
              {filteredUsers.map(u => {
                const last = getLastMsg(u.id)
                const active = activeRoom?.otherUser?.id === u.id
                const online = !!presence[u.id]
                return (
                  <div key={u.id} onClick={() => openRoom(u)}
                    style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', cursor:'pointer', background:active?'var(--c1-soft,rgba(99,102,241,.07))':'transparent', borderLeft:`2px solid ${active?'var(--c1)':'transparent'}`, transition:'all .12s' }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background='var(--surface-2)' }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background='transparent' }}>
                    <Ava name={u.full_name} size={36} online={online}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:600, fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{u.full_name}</div>
                      <div style={{ fontSize:10, color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {last ? last.message : <span style={{ textTransform:'capitalize', color:'var(--text-muted)' }}>{u.role}</span>}
                      </div>
                    </div>
                    {last && <div style={{ fontSize:10, color:'var(--text-muted)', flexShrink:0 }}>{timeFmt(last.created_at)}</div>}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right: message thread */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            {!activeRoom ? (
              <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'var(--text-muted)', gap:10 }}>
                <MessageSquare size={48} style={{ opacity:.2 }}/>
                <div style={{ fontWeight:600, fontSize:14 }}>Select a person to start chatting</div>
                <div style={{ fontSize:12 }}>Your messages are private. Only CEO can view all chats.</div>
              </div>
            ) : (
              <>
                {/* Thread header */}
                <div style={{ padding:'12px 18px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:12, background:'var(--surface)' }}>
                  <Ava name={activeRoom.otherUser?.full_name} size={36} online={!!presence[activeRoom.otherUser?.id]}/>
                  <div>
                    <div style={{ fontWeight:700, fontSize:14 }}>{activeRoom.otherUser?.full_name}</div>
                    <div style={{ fontSize:11, color:'var(--text-muted)', textTransform:'capitalize' }}>
                      {activeRoom.otherUser?.role} · {presence[activeRoom.otherUser?.id] ? <span style={{ color:'#10b981' }}>Online</span> : 'Offline'}
                    </div>
                  </div>
                </div>

                {/* Messages */}
                <div style={{ flex:1, overflowY:'auto', padding:'16px 18px', display:'flex', flexDirection:'column', gap:2 }}>
                  {groupedMsgs.map(item => {
                    if (item.type === 'sep') return (
                      <div key={item.id} style={{ textAlign:'center', margin:'12px 0 8px', fontSize:11, color:'var(--text-muted)', fontWeight:600 }}>
                        ─────── {item.label} ───────
                      </div>
                    )
                    const isMe = item.sender_id === profile.id
                    return (
                      <div key={item.id} style={{ display:'flex', justifyContent:isMe?'flex-end':'flex-start', marginBottom:3 }}>
                        {!isMe && <Ava name={item.sender?.full_name || activeRoom.otherUser?.full_name} size={26} style={{ marginRight:8, flexShrink:0 }}/>}
                        <div style={{ maxWidth:'68%' }}>
                          <div style={{ padding:'9px 13px', borderRadius:isMe?'14px 14px 4px 14px':'14px 14px 14px 4px', background:isMe?'var(--c1)':'var(--surface-2)', color:isMe?'#fff':'var(--text)', fontSize:13, lineHeight:1.5, wordBreak:'break-word', border:isMe?'none':'1px solid var(--border)' }}>
                            {item.message}
                          </div>
                          <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:3, textAlign:isMe?'right':'left' }}>
                            {timeFmt(item.created_at)}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  <div ref={msgEndRef}/>
                </div>

                {/* Input */}
                <form onSubmit={sendMessage} style={{ padding:'12px 16px', borderTop:'1px solid var(--border)', display:'flex', gap:10, background:'var(--surface)' }}>
                  <input value={text} onChange={e => setText(e.target.value)}
                    placeholder={`Message ${activeRoom.otherUser?.full_name?.split(' ')[0]}…`}
                    style={{ flex:1, padding:'9px 14px', borderRadius:10, border:'1px solid var(--border)', background:'var(--surface-2)', color:'var(--text)', fontSize:13, fontFamily:'inherit', outline:'none' }}
                    onKeyDown={e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}/>
                  <button type="submit" disabled={!text.trim() || sending}
                    className="btn btn-primary"
                    style={{ display:'flex', alignItems:'center', gap:5, padding:'9px 14px' }}>
                    <Send size={14}/> Send
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
