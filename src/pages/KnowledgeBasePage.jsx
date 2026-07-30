import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import { getKbModules, updateKbModule } from '../lib/knowledgeBase'
import { MODULE_SECTIONS } from '../config/modules'
import { Modal, Loader, Empty, Alert } from '../components/ui'
import { Search, Edit2, ArrowRight, BookOpen, Database, Info, CheckCircle2 } from 'lucide-react'

export default function KnowledgeBasePage() {
  const { profile } = useAuth()
  const isAdmin = ['admin', 'ceo'].includes(profile?.role)

  const [modules, setModules] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState(null)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const rows = await getKbModules()
    setModules(rows)
    if (!selectedKey && rows.length) setSelectedKey(rows[0].key)
    setLoading(false)
  }

  const byKey = useMemo(() => Object.fromEntries(modules.map(m => [m.key, m])), [modules])
  const selected = selectedKey ? byKey[selectedKey] : null

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return modules
    return modules.filter(m => m.label.toLowerCase().includes(q) || m.description?.toLowerCase().includes(q))
  }, [modules, search])

  const grouped = useMemo(() => {
    const g = {}
    MODULE_SECTIONS.forEach(s => { g[s] = [] })
    filtered.forEach(m => { (g[m.section] ||= []).push(m) })
    return g
  }, [filtered])

  function openEdit(m) {
    setEditing(m)
    setForm({
      description: m.description || '',
      flow: m.flow || '',
      features: m.features || '',
      primary_tables: m.primary_tables || '',
      notes: m.notes || '',
      linked_modules: m.linked_modules || [],
    })
    setErr('')
  }

  function toggleLink(key) {
    setForm(f => ({
      ...f,
      linked_modules: f.linked_modules.includes(key) ? f.linked_modules.filter(k => k !== key) : [...f.linked_modules, key],
    }))
  }

  async function save() {
    setSaving(true); setErr('')
    try {
      await updateKbModule(editing.id, form, profile?.id)
      setModules(ms => ms.map(m => m.id === editing.id ? { ...m, ...form } : m))
      setEditing(null)
    } catch (e) {
      setErr(e.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Knowledge Base</div>
          <div className="page-subtitle">What every module does, how it flows, and how it links to the rest of the app</div>
        </div>
      </div>

      {modules.length === 0 ? (
        <Empty icon={<BookOpen size={40} />} title="No content yet" desc="Run the Knowledge Base seed migration to populate this page" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20, alignItems: 'start' }}>
          <div className="card" style={{ position: 'sticky', top: 76 }}>
            <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input className="form-input" style={{ paddingLeft: 30 }} placeholder="Search modules…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
            <div style={{ maxHeight: 560, overflowY: 'auto' }}>
              {MODULE_SECTIONS.map(section => grouped[section]?.length ? (
                <div key={section} style={{ padding: '10px 12px 4px' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>{section}</div>
                  {grouped[section].map(m => (
                    <button key={m.key} onClick={() => setSelectedKey(m.key)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', borderRadius: 8, border: 'none',
                        marginBottom: 2, cursor: 'pointer', fontSize: 12.5, fontWeight: selectedKey === m.key ? 700 : 500,
                        background: selectedKey === m.key ? 'var(--c1)' : 'transparent', color: selectedKey === m.key ? '#fff' : 'inherit',
                      }}>
                      {m.label}
                    </button>
                  ))}
                </div>
              ) : null)}
            </div>
          </div>

          <div className="card">
            {!selected ? (
              <div style={{ padding: 24 }}><Empty icon={<Search size={32} />} title="No matches" desc="Try a different search term" /></div>
            ) : (
              <div style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c1)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{selected.section}</div>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{selected.label}</div>
                  </div>
                  {isAdmin && (
                    <button className="btn btn-outline btn-sm" onClick={() => openEdit(selected)}>
                      <Edit2 size={13} style={{ marginRight: 5 }} /> Edit
                    </button>
                  )}
                </div>

                <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink-soft)', marginTop: 14 }}>{selected.description || 'No description yet.'}</p>

                {selected.features && (
                  <div style={{ marginTop: 18 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Features</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {selected.features.split('\n').map(f => f.trim()).filter(Boolean).map((f, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, lineHeight: 1.5 }}>
                          <CheckCircle2 size={14} style={{ color: 'var(--c1)', flexShrink: 0, marginTop: 2 }} />
                          <span>{f.replace(/^[-•]\s*/, '')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selected.flow && (
                  <div style={{ marginTop: 18 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Flow</div>
                    <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px', fontSize: 13, lineHeight: 1.7 }}>{selected.flow}</div>
                  </div>
                )}

                {selected.primary_tables && (
                  <div style={{ marginTop: 18 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                      <Database size={11} style={{ verticalAlign: -1, marginRight: 4 }} />Primary Tables
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {selected.primary_tables.split(',').map(t => t.trim()).filter(Boolean).map(t => (
                        <span key={t} style={{ fontSize: 11, fontFamily: 'monospace', padding: '3px 9px', borderRadius: 6, background: 'var(--surface-2)', color: 'var(--ink-soft)' }}>{t}</span>
                      ))}
                    </div>
                  </div>
                )}

                {selected.linked_modules?.length > 0 && (
                  <div style={{ marginTop: 18 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Linked Modules</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {selected.linked_modules.map(key => byKey[key] && (
                        <button key={key} onClick={() => setSelectedKey(key)} className="hover-lift"
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, padding: '6px 12px',
                            borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--c1)', cursor: 'pointer',
                          }}>
                          {byKey[key].label} <ArrowRight size={11} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {selected.notes && (
                  <div style={{ marginTop: 18, display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 10, background: '#f59e0b12', border: '1px solid #f59e0b30' }}>
                    <Info size={16} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 1 }} />
                    <div style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--ink-soft)' }}>{selected.notes}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? `Edit — ${editing.label}` : ''} size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </>}>
        {form && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {err && <Alert type="error" message={err} />}
            <div>
              <label className="form-label">Description</label>
              <textarea className="form-textarea" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Features (one per line)</label>
              <textarea className="form-textarea" rows={5} value={form.features} onChange={e => setForm(f => ({ ...f, features: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Flow</label>
              <textarea className="form-textarea" rows={3} value={form.flow} onChange={e => setForm(f => ({ ...f, flow: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Primary Tables (comma-separated)</label>
              <input className="form-input" value={form.primary_tables} onChange={e => setForm(f => ({ ...f, primary_tables: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Notes</label>
              <textarea className="form-textarea" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Linked Modules</label>
              <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                {modules.filter(m => m.id !== editing?.id).map(m => (
                  <label key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.linked_modules.includes(m.key)} onChange={() => toggleLink(m.key)} />
                    {m.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
