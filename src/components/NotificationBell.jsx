import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Check, Trash2, X } from 'lucide-react'
import { useNotifications } from '../context/NotificationContext'

const TYPE_ICON = {
  task_assigned:        '📋',
  task_status:          '🔄',
  timesheet_submitted:  '📤',
  timesheet_approved:   '✅',
  timesheet_rejected:   '❌',
  checkin:              '🟢',
  checkout:             '🔴',
  chat_message:         '💬',
  system:               '🔔',
}

function timeAgo(ts) {
  if (!ts) return ''
  const diff = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (diff < 60)   return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`
  if (diff < 86400)return `${Math.floor(diff/3600)}h ago`
  return `${Math.floor(diff/86400)}d ago`
}

export default function NotificationBell() {
  const { notifications, unreadCount, markRead, markAllRead, clearAll } = useNotifications()
  const [open, setOpen] = useState(false)
  const ref  = useRef(null)
  const nav  = useNavigate()

  // Close on outside click
  useEffect(() => {
    function onClickOut(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClickOut)
    return () => document.removeEventListener('mousedown', onClickOut)
  }, [])

  function handleClick(n) {
    if (!n.read_at) markRead(n.id)
    if (n.link) { nav(n.link); setOpen(false) }
  }

  return (
    <div ref={ref} style={{ position:'relative' }}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position:'relative',
          background: unreadCount > 0 ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.08)',
          border: `1.5px solid ${unreadCount > 0 ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.15)'}`,
          borderRadius:8, padding:'5px 9px', cursor:'pointer', display:'flex', alignItems:'center',
          color: unreadCount > 0 ? '#fbbf24' : 'rgba(255,255,255,0.65)',
          transition:'all .2s',
        }}
        title="Notifications">
        <Bell size={16} style={{ filter: unreadCount > 0 ? 'drop-shadow(0 0 4px #fbbf24)' : 'none', transition:'filter .2s' }}/>
        {unreadCount > 0 && (
          <span style={{ position:'absolute', top:-5, right:-5, minWidth:18, height:18, borderRadius:9, background:'#e11d48', color:'#fff', fontSize:10, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 4px', lineHeight:1 }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <>
          <div style={{ position:'fixed', inset:0, zIndex:9998 }} onClick={() => setOpen(false)}/>
          <div style={{ position:'absolute', top:'calc(100% + 8px)', right:0, zIndex:9999, width:340, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, boxShadow:'0 8px 32px rgba(0,0,0,.18)', overflow:'hidden' }}>
            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', padding:'12px 16px', borderBottom:'1px solid var(--border)', background:'var(--surface-2)' }}>
              <span style={{ fontWeight:700, fontSize:14, flex:1 }}>Notifications</span>
              {unreadCount > 0 && (
                <button onClick={markAllRead} style={{ fontSize:11, color:'var(--c1)', background:'none', border:'none', cursor:'pointer', fontFamily:'inherit', fontWeight:600, marginRight:8 }}>
                  <Check size={11} style={{ marginRight:3, verticalAlign:'middle' }}/>Mark all read
                </button>
              )}
              <button onClick={clearAll} title="Clear all" style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', padding:2 }}>
                <Trash2 size={13}/>
              </button>
            </div>

            {/* List */}
            <div style={{ maxHeight:400, overflowY:'auto' }}>
              {notifications.length === 0 ? (
                <div style={{ padding:'32px 20px', textAlign:'center', color:'var(--text-muted)' }}>
                  <Bell size={28} style={{ opacity:.3, marginBottom:8 }}/>
                  <div style={{ fontSize:12, fontWeight:600 }}>All caught up!</div>
                </div>
              ) : (
                notifications.map(n => (
                  <div key={n.id}
                    onClick={() => handleClick(n)}
                    style={{ display:'flex', gap:10, padding:'11px 14px', borderBottom:'1px solid var(--border)', cursor:n.link?'pointer':'default', background:n.read_at ? 'transparent' : 'var(--c1-soft,rgba(99,102,241,.05))', transition:'background .12s' }}
                    onMouseEnter={e => { if (n.link) e.currentTarget.style.background='var(--surface-2)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = n.read_at ? 'transparent' : 'rgba(99,102,241,.05)' }}>
                    <div style={{ width:32, height:32, borderRadius:8, background:'var(--surface-2)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>
                      {TYPE_ICON[n.type] || '🔔'}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight: n.read_at ? 500 : 700, lineHeight:1.4, marginBottom:2 }}>{n.title}</div>
                      {n.body && <div style={{ fontSize:11, color:'var(--text-muted)', lineHeight:1.4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{n.body}</div>}
                      <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:3 }}>{timeAgo(n.created_at)}</div>
                    </div>
                    {!n.read_at && (
                      <div style={{ width:7, height:7, borderRadius:'50%', background:'var(--c1)', flexShrink:0, marginTop:3 }}/>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
