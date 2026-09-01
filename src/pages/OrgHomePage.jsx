import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { dateFmt } from '../lib/supabase'
import {
  ORG_HOME_WIDGETS, listAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,
  listNewJoinees, listRecentAwardWinners, getWidgetConfig, setWidgetEnabled,
} from '../lib/orgHome'
import { Loader, Empty, Modal, Confirm } from '../components/ui'
import { Megaphone, Pin, Plus, Pencil, Trash2, UserPlus2, Trophy, Settings2, Sparkles } from 'lucide-react'

const ACCENT = '#6366f1'

function initials(name) {
  return (name || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function Avatar({ name, size = 36 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: ACCENT, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.38,
      fontWeight: 700, flexShrink: 0,
    }}>{initials(name)}</div>
  )
}

export default function OrgHomePage() {
  const { profile } = useAuth()
  const canManage = ['admin', 'ceo', 'hr'].includes(profile?.role)

  const [loading, setLoading] = useState(true)
  const [announcements, setAnnouncements] = useState([])
  const [joinees, setJoinees] = useState([])
  const [winners, setWinners] = useState([])
  const [widgets, setWidgets] = useState({})
  const [editAnn, setEditAnn] = useState(null)
  const [deleteAnn, setDeleteAnn] = useState(null)
  const [showConfig, setShowConfig] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [a, j, w, cfg] = await Promise.all([
      listAnnouncements(), listNewJoinees({ days: 60 }), listRecentAwardWinners({ limit: 8 }), getWidgetConfig(),
    ])
    setAnnouncements(a); setJoinees(j); setWinners(w); setWidgets(cfg)
    setLoading(false)
  }

  async function handleSaveAnnouncement(patch) {
    if (editAnn?.id) await updateAnnouncement(editAnn.id, patch)
    else await createAnnouncement(patch, profile.id)
    setEditAnn(null)
    await load()
  }

  async function handleDeleteAnnouncement() {
    await deleteAnnouncement(deleteAnn.id)
    setDeleteAnn(null)
    await load()
  }

  async function toggleWidget(key) {
    const next = !widgets[key]?.enabled
    setWidgets(w => ({ ...w, [key]: { ...w[key], enabled: next } }))
    await setWidgetEnabled(key, next)
  }

  if (loading) return <Loader />

  const showAnnouncements = widgets.announcements?.enabled !== false
  const showJoinees = widgets.new_joinees?.enabled !== false
  const showAwards = widgets.awards?.enabled !== false

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sparkles size={22} color={ACCENT} /> Welcome{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}
          </div>
          <div className="page-subtitle">What's happening at {profile?.dept?.name ? profile.dept.name + ' — ' : ''}your organization</div>
        </div>
        {canManage && (
          <button className="btn btn-ghost" onClick={() => setShowConfig(true)}>
            <Settings2 size={15} /> Manage Home
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {showAnnouncements && (
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15 }}>
                  <Megaphone size={16} color={ACCENT} /> Announcements
                </div>
                {canManage && (
                  <button className="btn btn-sm btn-primary" onClick={() => setEditAnn({})}>
                    <Plus size={13} /> New
                  </button>
                )}
              </div>

              {announcements.length === 0 ? (
                <Empty icon={<Megaphone size={28} />} title="No announcements yet" desc="Company updates will show up here." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {announcements.map(a => (
                    <div key={a.id} style={{ padding: 14, borderRadius: 10, background: a.pinned ? '#eef2ff' : 'var(--bg-soft, #f8fafc)', border: '1px solid var(--border, #e5e7eb)' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 14 }}>
                          {a.pinned && <Pin size={13} color={ACCENT} />} {a.title}
                        </div>
                        {canManage && (
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditAnn(a)}><Pencil size={13} /></button>
                            <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => setDeleteAnn(a)}><Trash2 size={13} /></button>
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 6, whiteSpace: 'pre-wrap' }}>{a.body}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-faint, #94a3b8)', marginTop: 8 }}>
                        {a.author?.full_name || 'Team'} · {dateFmt(a.publish_at)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {showAwards && (
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15, marginBottom: 14 }}>
                <Trophy size={16} color={ACCENT} /> Recent Awards &amp; Recognition
              </div>
              {winners.length === 0 ? (
                <Empty icon={<Trophy size={28} />} title="No awards yet" desc="Granted awards will be celebrated here." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {winners.map(w => (
                    <div key={`${w.award_id}-${w.employee_id}`} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Avatar name={w.employee_name} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{w.employee_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{w.award_name}{w.category_name ? ` · ${w.category_name}` : ''}</div>
                      </div>
                      {w.award_date && <div style={{ fontSize: 11, color: 'var(--ink-faint, #94a3b8)' }}>{dateFmt(w.award_date)}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {showJoinees && (
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15, marginBottom: 14 }}>
              <UserPlus2 size={16} color={ACCENT} /> New Joinees
            </div>
            {joinees.length === 0 ? (
              <Empty icon={<UserPlus2 size={28} />} title="No new joinees" desc="Welcome new teammates here once they join." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {joinees.map(j => (
                  <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar name={j.full_name} size={32} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.full_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{j.dept?.name || j.role}</div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-faint, #94a3b8)', flexShrink: 0 }}>{dateFmt(j.date_joined)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <Modal open={!!editAnn} onClose={() => setEditAnn(null)} title={editAnn?.id ? 'Edit Announcement' : 'New Announcement'}>
        {editAnn && <AnnouncementForm initial={editAnn} onCancel={() => setEditAnn(null)} onSave={handleSaveAnnouncement} />}
      </Modal>

      <Confirm
        open={!!deleteAnn}
        message={`Delete "${deleteAnn?.title}"? This can't be undone.`}
        danger
        onConfirm={handleDeleteAnnouncement}
        onCancel={() => setDeleteAnn(null)}
      />

      <Modal open={showConfig} onClose={() => setShowConfig(false)} title="Manage Company Home">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 4 }}>Choose which widgets show on the Company Home page for everyone in your organization.</div>
          {ORG_HOME_WIDGETS.map(w => (
            <label key={w.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}>
              <input type="checkbox" checked={widgets[w.key]?.enabled !== false} onChange={() => toggleWidget(w.key)} />
              {w.label}
            </label>
          ))}
        </div>
      </Modal>
    </div>
  )
}

function AnnouncementForm({ initial, onCancel, onSave }) {
  const [title, setTitle] = useState(initial.title || '')
  const [body, setBody] = useState(initial.body || '')
  const [pinned, setPinned] = useState(initial.pinned || false)
  const [expiresAt, setExpiresAt] = useState(initial.expires_at ? initial.expires_at.slice(0, 10) : '')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!title.trim() || !body.trim()) return
    setSaving(true)
    try {
      await onSave({ title: title.trim(), body: body.trim(), pinned, expires_at: expiresAt || null })
    } finally { setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label className="form-label">Title</label>
        <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Office closed on Friday" />
      </div>
      <div>
        <label className="form-label">Message</label>
        <textarea className="form-input" rows={4} value={body} onChange={e => setBody(e.target.value)} placeholder="Details for everyone in the organization" />
      </div>
      <div>
        <label className="form-label">Expires on (optional)</label>
        <input type="date" className="form-input" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} /> Pin to top
      </label>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={saving || !title.trim() || !body.trim()} onClick={submit}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
