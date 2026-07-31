import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase, dateFmt } from '../lib/supabase'
import { listLeads, getLead, createLead, updateLead, assignLead } from '../lib/salesLeads'
import { createOpportunity } from '../lib/salesOpportunities'
import { listRegions, DOMAINS } from '../lib/salesAdmin'
import { listActivities, createActivity } from '../lib/salesActivities'
import { listTasks, createTask as createSalesTask } from '../lib/salesTasks'
import { listCampaigns } from '../lib/marketingCampaigns'
import { Modal, SearchBox, StatusBadge, Loader, Empty, StatCard } from '../components/ui'
import { Plus, ArrowLeft, Users, Phone, AlertTriangle, CheckCircle } from 'lucide-react'

const initForm = () => ({ domain: 'B2B', region_id: '', contact_name: '', company_name: '', source: '', campaign_id: '' })

export default function LeadsPage() {
  const { profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('id') || ''
  const [leads, setLeads] = useState([])
  const [regions, setRegions] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(initForm())
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [l, r, c] = await Promise.all([listLeads(), listRegions(), listCampaigns()])
    setLeads(l); setRegions(r); setCampaigns(c)
    setLoading(false)
  }

  function select(id) { setSearchParams(id ? { id } : {}) }

  async function handleCreate(e) {
    e.preventDefault()
    if (!form.contact_name) { setErr('Contact name is required'); return }
    setSubmitting(true); setErr('')
    try {
      await createLead(form, profile.id)
      setShowCreate(false); setForm(initForm())
      await load()
    } catch (e) { setErr(e.message) }
    finally { setSubmitting(false) }
  }

  const filtered = leads.filter(l =>
    (!search || l.contact_name?.toLowerCase().includes(search.toLowerCase()) || l.company_name?.toLowerCase().includes(search.toLowerCase()) || l.lead_number?.toLowerCase().includes(search.toLowerCase())) &&
    (!statusFilter || l.status === statusFilter)
  )

  if (loading) return <Loader />

  if (selectedId) {
    return <LeadDetail leadId={selectedId} profile={profile} regions={regions} onBack={() => select('')} onChanged={load} />
  }

  const needsCoverage = leads.filter(l => l.status === 'Unassigned — Needs Coverage').length

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Leads</div>
          <div className="page-subtitle">Every inbound/outbound lead, auto-assigned by domain + region coverage rules</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} /> New Lead</button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Total Leads" value={leads.length} icon={<Users size={17} />} accent="#0ea5e9" />
        <StatCard label="Needs Coverage" value={needsCoverage} icon={<AlertTriangle size={17} />} accent="#dc2626" />
        <StatCard label="Qualified" value={leads.filter(l => l.status === 'Qualified').length} icon={<CheckCircle size={17} />} accent="#15803d" />
        <StatCard label="Converted" value={leads.filter(l => l.status === 'Converted to Opportunity').length} icon={<CheckCircle size={17} />} accent="#4338ca" />
      </div>

      <div className="card" style={{ padding: 12, marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: '1 1 260px', minWidth: 220 }}><SearchBox value={search} onChange={setSearch} placeholder="Search by name, company or number…" /></div>
        <select className="form-select" style={{ fontSize: 12, width: 220 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          {['New', 'Contacted', 'Qualified', 'Disqualified', 'Converted to Opportunity', 'Unassigned — Needs Coverage'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ padding: '20px 24px' }}><Empty icon="👤" title="No leads found" desc="Create your first lead or adjust filters" /></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Lead #</th><th>Contact</th><th>Domain</th><th>Region</th><th>Rep</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              {filtered.map(l => (
                <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => select(l.id)}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{l.lead_number}</td>
                  <td className="td-bold">{l.contact_name}{l.company_name ? ` · ${l.company_name}` : ''}</td>
                  <td>{l.domain}</td>
                  <td>{l.region?.region_name || '—'}</td>
                  <td>{l.rep?.full_name || <span style={{ color: '#dc2626', fontWeight: 700 }}>Unassigned</span>}</td>
                  <td><StatusBadge status={l.status === 'Unassigned — Needs Coverage' ? 'requested' : l.status === 'Qualified' || l.status === 'Converted to Opportunity' ? 'approved' : 'draft'} /> <span style={{ fontSize: 11 }}>{l.status}</span></td>
                  <td style={{ fontSize: 12, color: '#94a3b8' }}>{dateFmt(l.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Lead" size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={submitting}>{submitting ? 'Creating…' : 'Create Lead'}</button>
        </>}>
        <form onSubmit={handleCreate}>
          {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
          <div className="form-row">
            <div className="form-group"><label className="form-label">Contact Name *</label><input className="form-input" value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} required /></div>
            <div className="form-group"><label className="form-label">Company Name</label><input className="form-input" value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Domain</label>
              <select className="form-select" value={form.domain} onChange={e => setForm(f => ({ ...f, domain: e.target.value }))}>
                {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Region</label>
              <select className="form-select" value={form.region_id} onChange={e => setForm(f => ({ ...f, region_id: e.target.value }))}>
                <option value="">— Not region-specific —</option>
                {regions.map(r => <option key={r.id} value={r.id}>{r.region_name}</option>)}
              </select></div>
          </div>
          <div className="form-group"><label className="form-label">Source</label><input className="form-input" value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} placeholder="e.g. Campaign, Referral, Website" /></div>
          <div className="form-group"><label className="form-label">Campaign (optional)</label>
            <select className="form-select" value={form.campaign_id} onChange={e => setForm(f => ({ ...f, campaign_id: e.target.value }))}>
              <option value="">— Not tied to a campaign —</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.campaign_name}</option>)}
            </select></div>
        </form>
      </Modal>
    </div>
  )
}

function LeadDetail({ leadId, profile, regions, onBack, onChanged }) {
  const [lead, setLead] = useState(null)
  const [activities, setActivities] = useState([])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showActivity, setShowActivity] = useState(false)
  const [showTask, setShowTask] = useState(false)
  const [showConvert, setShowConvert] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const l = await getLead(leadId)
    const [act, tsk] = await Promise.all([listActivities('Lead', leadId), listTasks('Lead', leadId)])
    setLead(l); setActivities(act); setTasks(tsk)
    setLoading(false)
  }, [leadId])
  useEffect(() => { load() }, [load])

  async function assignToMe() {
    await assignLead(leadId, profile.id, profile.id)
    await load(); onChanged?.()
  }

  if (loading || !lead) return <Loader />

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 10 }}><ArrowLeft size={14} /> Back to Leads</button>
      <div className="page-header" style={{ marginBottom: 14 }}>
        <div>
          <div className="page-title">{lead.contact_name}{lead.company_name ? ` — ${lead.company_name}` : ''}</div>
          <div className="page-subtitle" style={{ fontFamily: 'monospace' }}>{lead.lead_number} · {lead.domain} · {lead.region?.region_name || 'No region'}</div>
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 8 }}>
          {lead.status === 'Unassigned — Needs Coverage' && <button className="btn btn-primary" onClick={assignToMe}>Assign to Me</button>}
          {lead.status !== 'Converted to Opportunity' && lead.status !== 'Disqualified' && (
            <button className="btn btn-primary" onClick={() => setShowConvert(true)}>Convert to Opportunity</button>
          )}
        </div>
      </div>

      {lead.status === 'Unassigned — Needs Coverage' && (
        <div className="alert alert-danger" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={15} /> No matching sales rep assignment for {lead.domain} in this region — needs manual triage.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Details</div>
          <div style={{ fontSize: 12.5, color: '#475569', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div>Status: <StatusBadge status={lead.status} /></div>
            <div>Source: {lead.source || '—'}</div>
            <div>Assigned Rep: {lead.rep?.full_name || 'Unassigned'}</div>
            <div>Created: {dateFmt(lead.created_at)}</div>
          </div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Contact & Form Answers</div>
          <div style={{ fontSize: 12.5, color: '#475569', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {lead.phone && <div>Phone: {lead.phone}</div>}
            {lead.email && <div>Email: {lead.email}</div>}
            {lead.message && <div>Message: {lead.message}</div>}
            {!lead.phone && !lead.email && !lead.message && Object.keys(lead.custom_fields || {}).length === 0 && <div style={{ color: '#94a3b8' }}>No additional details captured.</div>}
            {Object.entries(lead.custom_fields || {}).map(([k, v]) => (
              <div key={k}><span style={{ textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</span>: {String(v)}</div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}><Phone size={13} /> Activity Log</div>
          <button className="btn btn-outline btn-sm" onClick={() => setShowActivity(true)}><Plus size={12} /> Log Activity</button>
        </div>
        {activities.length === 0 ? <Empty icon="📞" title="No activity logged yet" desc="Log the first call, email or meeting" /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activities.map(a => (
              <div key={a.id} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12.5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="td-bold">{a.activity_type} ({a.direction})</span>
                  <span style={{ color: '#94a3b8' }}>{dateFmt(a.activity_date)}</span>
                </div>
                <div style={{ color: '#64748b', marginTop: 2 }}>{a.outcome && <>Outcome: {a.outcome} · </>}{a.performer?.full_name}</div>
                {a.notes && <div style={{ marginTop: 4 }}>{a.notes}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Tasks</div>
          <button className="btn btn-outline btn-sm" onClick={() => setShowTask(true)}><Plus size={12} /> Add Task</button>
        </div>
        {tasks.length === 0 ? <Empty icon="✅" title="No tasks yet" desc="Add a follow-up task" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Type</th><th>Assignee</th><th>Due</th><th>Priority</th><th>Status</th></tr></thead>
              <tbody>{tasks.map(t => (
                <tr key={t.id}><td>{t.task_type}</td><td>{t.assignee?.full_name}</td><td>{dateFmt(t.due_date)}</td><td>{t.priority}</td><td><StatusBadge status={t.status} /></td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

      <ActivityModal open={showActivity} onClose={() => setShowActivity(false)} relatedToType="Lead" relatedToId={leadId} profile={profile} onSaved={load} />
      <TaskModal open={showTask} onClose={() => setShowTask(false)} relatedToType="Lead" relatedToId={leadId} profile={profile} onSaved={load} />
      <ConvertModal open={showConvert} onClose={() => setShowConvert(false)} lead={lead} regions={regions} profile={profile}
        onConverted={async () => { setShowConvert(false); await load(); onChanged?.() }} />
    </div>
  )
}

export function ActivityModal({ open, onClose, relatedToType, relatedToId, profile, onSaved }) {
  const [form, setForm] = useState({ activity_type: 'Call', direction: 'Outbound', outcome: '', notes: '', next_follow_up_date: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  async function save() {
    setSaving(true); setErr('')
    try {
      await createActivity({ related_to_type: relatedToType, related_to_id: relatedToId, ...form }, profile.id)
      setForm({ activity_type: 'Call', direction: 'Outbound', outcome: '', notes: '', next_follow_up_date: '' })
      onClose(); await onSaved?.()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Log Activity" footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
    </>}>
      {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="form-row">
        <div className="form-group"><label className="form-label">Type</label>
          <select className="form-select" value={form.activity_type} onChange={e => setForm(f => ({ ...f, activity_type: e.target.value }))}>
            {['Call', 'Email', 'Meeting', 'Demo', 'Site Visit'].map(t => <option key={t} value={t}>{t}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">Direction</label>
          <select className="form-select" value={form.direction} onChange={e => setForm(f => ({ ...f, direction: e.target.value }))}>
            <option value="Inbound">Inbound</option><option value="Outbound">Outbound</option>
          </select></div>
      </div>
      <div className="form-group"><label className="form-label">Outcome</label>
        <select className="form-select" value={form.outcome} onChange={e => setForm(f => ({ ...f, outcome: e.target.value }))}>
          <option value="">—</option>
          {['Connected', 'No Answer', 'Interested', 'Not Interested', 'Follow-up Scheduled'].map(o => <option key={o} value={o}>{o}</option>)}
        </select></div>
      <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
      <div className="form-group"><label className="form-label">Next Follow-up Date</label><input className="form-input" type="date" value={form.next_follow_up_date} onChange={e => setForm(f => ({ ...f, next_follow_up_date: e.target.value }))} /></div>
    </Modal>
  )
}

export function TaskModal({ open, onClose, relatedToType, relatedToId, profile, onSaved }) {
  const [users, setUsers] = useState([])
  const [form, setForm] = useState({ task_type: 'Follow-up Call', assigned_to: '', due_date: '', priority: 'Medium' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (open) supabase.from('profiles').select('id,full_name').order('full_name').then(({ data }) => setUsers(data || [])) }, [open])
  async function save() {
    if (!form.assigned_to || !form.due_date) { setErr('Assignee and due date are required'); return }
    setSaving(true); setErr('')
    try {
      await createSalesTask({ related_to_type: relatedToType, related_to_id: relatedToId, ...form }, profile.id)
      onClose(); await onSaved?.()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Add Task" footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
    </>}>
      {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="form-group"><label className="form-label">Task Type</label>
        <select className="form-select" value={form.task_type} onChange={e => setForm(f => ({ ...f, task_type: e.target.value }))}>
          {['Follow-up Call', 'Send Proposal', 'Site Visit', 'Internal Review', 'Document Collection'].map(t => <option key={t} value={t}>{t}</option>)}
        </select></div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Assignee *</label>
          <select className="form-select" value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}>
            <option value="">Select…</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">Due Date *</label><input className="form-input" type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} /></div>
      </div>
      <div className="form-group"><label className="form-label">Priority</label>
        <select className="form-select" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
          <option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option>
        </select></div>
    </Modal>
  )
}

function ConvertModal({ open, onClose, lead, regions, profile, onConverted }) {
  const [form, setForm] = useState({ expected_value: '', expected_close_date: '', pipeline_stage: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  async function convert() {
    setSaving(true); setErr('')
    try {
      await createOpportunity({
        lead_id: lead.id, domain: lead.domain, region_id: lead.region_id, assigned_rep_id: lead.assigned_rep_id,
        expected_value: form.expected_value || 0, expected_close_date: form.expected_close_date || null,
      }, profile.id)
      onConverted()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Convert to Opportunity" footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={convert} disabled={saving}>{saving ? 'Converting…' : 'Convert'}</button>
    </>}>
      {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="form-group"><label className="form-label">Expected Value</label><input className="form-input" type="number" value={form.expected_value} onChange={e => setForm(f => ({ ...f, expected_value: e.target.value }))} /></div>
      <div className="form-group"><label className="form-label">Expected Close Date</label><input className="form-input" type="date" value={form.expected_close_date} onChange={e => setForm(f => ({ ...f, expected_close_date: e.target.value }))} /></div>
    </Modal>
  )
}
