import { useEffect, useState } from 'react'
import { supabase, dateFmt } from '../../lib/supabase'
import { listPageVersions, restorePageVersion } from '../../lib/wikiPageVersions'
import { Confirm, Loader, Empty } from '../ui'
import { History, RotateCcw } from 'lucide-react'

export default function PageHistory({ pageId, profile, onRestored }) {
  const [versions, setVersions] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [restoreTarget, setRestoreTarget] = useState(null)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => { load() }, [pageId])
  async function load() {
    setLoading(true)
    try {
      const [v, u] = await Promise.all([
        listPageVersions(pageId),
        supabase.from('profiles').select('id,full_name').order('full_name'),
      ])
      setVersions(v); setUsers(u.data || [])
      setSelected(v[0] || null)
    } finally { setLoading(false) }
  }

  async function handleRestore() {
    if (!restoreTarget) return
    setRestoring(true)
    try {
      await restorePageVersion(pageId, restoreTarget.id, profile.id)
      setRestoreTarget(null)
      onRestored?.()
    } catch (err) { alert(err.message); setRestoring(false) }
  }

  if (loading) return <Loader />
  if (versions.length === 0) return <Empty icon={<History size={24} />} title="No saved versions yet" desc="Versions appear here once the page has been saved at least once." />

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16, minHeight: 320 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 420, overflowY: 'auto', borderRight: '1px solid var(--border)', paddingRight: 10 }}>
        {versions.map(v => {
          const editor = users.find(u => u.id === v.edited_by)
          return (
            <button key={v.id} onClick={() => setSelected(v)}
              className="btn btn-ghost btn-sm"
              style={{
                justifyContent: 'flex-start', textAlign: 'left', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '8px 10px',
                background: selected?.id === v.id ? 'var(--c1-soft)' : 'transparent',
              }}>
              <span style={{ fontWeight: 700, fontSize: 12.5 }}>Version {v.version_no}{v.status === 'active' && ' (current)'}</span>
              <span style={{ fontSize: 10.5, color: 'var(--ink-muted)' }}>{editor?.full_name || 'Unknown'} · {dateFmt(v.created_at)}</span>
            </button>
          )
        })}
      </div>

      <div>
        {selected && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>Version {selected.version_no}</div>
              {selected.status !== 'active' && (
                <button className="btn btn-outline btn-sm" onClick={() => setRestoreTarget(selected)}>
                  <RotateCcw size={12} /> Restore this version
                </button>
              )}
            </div>
            <div style={{
              whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6, maxHeight: 340, overflowY: 'auto',
              background: 'var(--bg-3)', borderRadius: 10, padding: 14, color: selected.content_text ? 'inherit' : 'var(--ink-muted)',
            }}>
              {selected.content_text || 'This version is empty.'}
            </div>
          </>
        )}
      </div>

      <Confirm open={!!restoreTarget} message={`Restore Version ${restoreTarget?.version_no}${restoring ? ' — restoring…' : ''}? This becomes the page's new current content (nothing is deleted from history).`}
        onConfirm={handleRestore} onCancel={() => setRestoreTarget(null)} />
    </div>
  )
}
