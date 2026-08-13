import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { listMyOrgTickets, createTicket, listOrgProjects, getProjectTagConfig, isProjectTagVisibleForRole, CATEGORIES, PRIORITIES } from '../lib/supportDesk'
import { Loader, Alert, StatusBadge, Empty, Modal } from '../components/ui'
import { dateFmt } from '../lib/supabase'
import { Plus, LifeBuoy } from 'lucide-react'

const CATEGORY_LABELS = { billing: 'Billing', technical: 'Technical', feature_request: 'Feature Request', account: 'Account', onboarding: 'Onboarding', general: 'General' }
const PRIORITY_COLORS = { low: '#64748b', medium: '#0ea5e9', high: '#f59e0b', urgent: '#dc2626' }

export default function SupportTicketsPage() {
  const { profile } = useAuth()
  const [tickets, setTickets] = useState([])
  const [projects, setProjects] = useState([])
  const [projectTagConfig, setProjectTagConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ subject: '', description: '', category: 'general', priority: 'medium', projectId: '' })
  const [saving, setSaving] = useState(false)

  const showProjectTag = isProjectTagVisibleForRole(projectTagConfig, profile?.role)

  async function load() {
    try {
      const [t, config] = await Promise.all([listMyOrgTickets(), getProjectTagConfig()])
      setTickets(t); setProjectTagConfig(config)
      if (isProjectTagVisibleForRole(config, profile?.role)) setProjects(await listOrgProjects())
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate() {
    if (!form.subject.trim() || !form.description.trim()) { setErr('Subject and description are required.'); return }
    setSaving(true); setErr('')
    try {
      await createTicket(form)
      setCreateOpen(false)
      setForm({ subject: '', description: '', category: 'general', priority: 'medium', projectId: '' })
      await load()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Support</div>
          <div className="page-subtitle">Raise a ticket with the ThingsAlive NeoX platform team</div>
        </div>
        <button className="btn btn-primary" onClick={() => setCreateOpen(true)}><Plus size={15} /> New Ticket</button>
      </div>

      {err && <Alert type="error" message={err} />}

      {tickets.length === 0 ? (
        <Empty icon={<LifeBuoy size={40} />} title="No tickets yet" desc="Raise a ticket if you run into a bug, have a billing question, or need help with the platform." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tickets.map(t => (
            <Link key={t.id} to={`/support/${t.id}`} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', textDecoration: 'none', color: 'inherit' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{t.ticket_number} · {CATEGORY_LABELS[t.category] || t.category}{t.project_name && <> · {t.project_name}</>}{t.agent_name && <> · Agent: {t.agent_name}</>}</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: PRIORITY_COLORS[t.priority], textTransform: 'uppercase' }}>{t.priority}</span>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{dateFmt(t.created_at)}</div>
              <StatusBadge status={t.status} />
            </Link>
          ))}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Support Ticket" footer={
        <><button className="btn btn-ghost" onClick={() => setCreateOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={saving} onClick={handleCreate}>{saving ? 'Submitting…' : 'Submit Ticket'}</button></>
      }>
        <label className="form-label">Subject *</label>
        <input className="form-input" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="Short summary of the issue" autoFocus />
        <label className="form-label" style={{ marginTop: 12 }}>Description *</label>
        <textarea className="form-input" rows={5} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What's happening, what did you expect, steps to reproduce…" />
        <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <label className="form-label">Category</label>
            <select className="form-input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label className="form-label">Priority</label>
            <select className="form-input" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>
        </div>
        {showProjectTag && (
          <div style={{ marginTop: 12 }}>
            <label className="form-label">Project (optional)</label>
            <select className="form-input" value={form.projectId} onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))}>
              <option value="">Not related to a specific project</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
      </Modal>
    </div>
  )
}
