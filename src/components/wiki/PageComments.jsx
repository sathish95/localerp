import { useEffect, useRef, useState } from 'react'
import { supabase, dateFmt } from '../../lib/supabase'
import { listComments, addComment, deleteComment } from '../../lib/wikiComments'
import { MessageSquare, Send, Trash2 } from 'lucide-react'

const Avatar = ({ name, size = 20 }) => (
  <div style={{
    width: size, height: size, borderRadius: '50%', background: 'var(--c1)', color: '#fff',
    fontSize: size * 0.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  }}>{(name || '?')[0]?.toUpperCase()}</div>
)

// Comments on a wiki page — same fetch-on-mount + insert-then-refetch
// shape as TasksPage.jsx's TaskComments, plus a lightweight @mention
// autocomplete in the plain textarea (text-based, not a second Tiptap
// instance — see Phase 4 in the wiki build plan for why).
export default function PageComments({ pageId, pageTitle, spaceId, pageOwnerId, profile }) {
  const [comments, setComments] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)
  const [pendingMentions, setPendingMentions] = useState([]) // [{id, full_name}]

  const [mentionQuery, setMentionQuery] = useState(null) // string while "@..." is being typed, else null
  const [mentionStart, setMentionStart] = useState(0)
  const [mentionResults, setMentionResults] = useState([])
  const textareaRef = useRef(null)
  const debounceRef = useRef(null)

  useEffect(() => { load() }, [pageId])
  async function load() {
    setLoading(true)
    try {
      const [c, u] = await Promise.all([
        listComments(pageId),
        supabase.from('profiles').select('id,full_name,role').order('full_name'),
      ])
      setComments(c); setUsers(u.data || [])
    } finally { setLoading(false) }
  }

  function handleChange(e) {
    const value = e.target.value
    const pos = e.target.selectionStart
    setText(value)
    const uptoCursor = value.slice(0, pos)
    const match = uptoCursor.match(/@([\w.]*)$/)
    if (match) {
      setMentionStart(pos - match[0].length)
      const query = match[1]
      setMentionQuery(query)
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(async () => {
        const q = supabase.from('profiles').select('id,full_name,role').order('full_name').limit(6)
        const { data } = query ? await q.ilike('full_name', `%${query}%`) : await q
        setMentionResults(data || [])
      }, 200)
    } else {
      setMentionQuery(null)
    }
  }

  function pickMention(user) {
    const before = text.slice(0, mentionStart)
    const after = text.slice(mentionStart + 1 + (mentionQuery?.length || 0))
    const inserted = `@${user.full_name} `
    setText(before + inserted + after)
    setPendingMentions(prev => prev.some(m => m.id === user.id) ? prev : [...prev, { id: user.id, full_name: user.full_name }])
    setMentionQuery(null)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  async function post() {
    if (!text.trim()) return
    setPosting(true)
    try {
      const mentionIds = pendingMentions.filter(m => text.includes(`@${m.full_name}`)).map(m => m.id)
      await addComment(pageId, profile.id, text.trim(), mentionIds, { pageTitle, spaceId, pageOwnerId })
      setText(''); setPendingMentions([])
      await load()
    } catch (err) { alert(err.message) } finally { setPosting(false) }
  }

  async function handleDelete(id) {
    await deleteComment(id)
    await load()
  }

  return (
    <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-muted)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        <MessageSquare size={13} /> Comments {comments.length > 0 && `(${comments.length})`}
      </div>

      <div style={{ position: 'relative', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <textarea ref={textareaRef} className="form-textarea" placeholder="Write a comment… use @ to mention someone"
            value={text} onChange={handleChange} style={{ flex: 1, minHeight: 56, fontSize: 13 }} />
          <button className="btn btn-primary btn-sm" onClick={post} disabled={posting || !text.trim()}>
            <Send size={12} /> Post
          </button>
        </div>
        {mentionQuery !== null && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 20, marginTop: 4,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,.12)', minWidth: 200, maxHeight: 220, overflowY: 'auto',
          }}>
            {mentionResults.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 12.5, color: 'var(--ink-muted)' }}>No matches</div>
            ) : mentionResults.map(u => (
              <div key={u.id} onClick={() => pickMention(u)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer' }}>
                <Avatar name={u.full_name} size={22} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{u.full_name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {loading ? null : comments.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--ink-muted)', textAlign: 'center', padding: '14px 0' }}>No comments yet — start the discussion above.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {comments.map(c => {
            const commenter = users.find(u => u.id === c.user_id)
            return (
              <div key={c.id} style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5, gap: 8 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 12 }}>
                    <Avatar name={commenter?.full_name} /> {commenter?.full_name || 'Unknown'}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, color: 'var(--ink-muted)' }}>{dateFmt(c.created_at)}</span>
                    {c.user_id === profile.id && (
                      <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => handleDelete(c.id)}><Trash2 size={11} /></button>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{c.comment}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
