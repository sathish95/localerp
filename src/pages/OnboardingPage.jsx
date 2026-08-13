import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  computeOnboardingStatus, updateOrgProfile, listDepartments, createDepartment, deleteDepartment, listOrgAdmins,
} from '../lib/onboarding'
import { createInvite } from '../lib/orgInvites'
import { Loader, Stepper } from '../components/ui'
import { Building2, Tag, UserPlus, Users, Network, Trophy, Trash2, Plus, ExternalLink, PartyPopper, Check } from 'lucide-react'

const STEP_LABELS = ['Organization', 'Structure', 'Admins', 'Employees', 'Hierarchy', 'Configuration']

export default function OnboardingPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState(null)
  const [activeStep, setActiveStep] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const s = await computeOnboardingStatus(profile.organization_id)
    setStatus(s)
    const firstIncomplete = s.steps.findIndex(step => !step.done)
    setActiveStep(firstIncomplete === -1 ? s.steps.length - 1 : firstIncomplete)
    setLoading(false)
  }

  if (loading || !status) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#4338ca)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <Building2 size={19} />
            </span>
            Organization Setup
          </div>
          <div className="page-subtitle">{status.doneCount} of {status.total} steps complete — you can skip any step and come back later</div>
        </div>
      </div>

      <Stepper steps={STEP_LABELS} activeIndex={activeStep} onStepClick={setActiveStep} allowJumpAhead doneSteps={status.steps.map(s => s.done)} />

      <div className="card" style={{ padding: 24 }}>
        {activeStep === 0 && <ProfileStep org={status.org} orgId={profile.organization_id} onSaved={load} />}
        {activeStep === 1 && <StructureStep orgId={profile.organization_id} count={status.counts.departments} onChanged={load} />}
        {activeStep === 2 && <AdminsStep orgId={profile.organization_id} profileId={profile.id} count={status.counts.admins} />}
        {activeStep === 3 && <LinkOutStep icon={<Users size={28} />} title="Employees Added"
          desc={`${status.counts.employees} employee${status.counts.employees === 1 ? '' : 's'} in your organization so far.`}
          done={status.steps[3].done} cta="Manage Employees" onClick={() => navigate('/users')} />}
        {activeStep === 4 && <LinkOutStep icon={<Network size={28} />} title="Manager Hierarchy"
          desc={`${status.counts.managed} of ${status.counts.employees} employees have a manager assigned.`}
          done={status.steps[4].done} cta="Assign Managers" onClick={() => navigate('/users')} />}
        {activeStep === 5 && <LinkOutStep icon={<Trophy size={28} />} title="Performance / Award Configuration"
          desc={status.counts.cycles > 0 || status.counts.awards > 0
            ? `${status.counts.cycles} performance cycle(s) and ${status.counts.awards} award(s) configured.`
            : 'Set up a performance review cycle or a recognition award to get started.'}
          done={status.steps[5].done}
          cta="Configure Performance" onClick={() => navigate('/performance-cycles')}
          secondaryCta="Configure Awards" onSecondaryClick={() => navigate('/awards')} />}
      </div>

      {status.allDone && (
        <div className="card" style={{ padding: 24, marginTop: 16, textAlign: 'center' }}>
          <PartyPopper size={32} style={{ color: 'var(--c1)', marginBottom: 8 }} />
          <div style={{ fontWeight: 800, fontSize: '1.1rem', marginBottom: 4 }}>Setup complete</div>
          <div style={{ color: 'var(--ink-muted)', fontSize: '0.88rem' }}>Every onboarding step is done. You can still come back here any time from Settings → Organization.</div>
        </div>
      )}
    </div>
  )
}

function ProfileStep({ org, orgId, onSaved }) {
  const [form, setForm] = useState({
    name: org?.name || '', industry: org?.industry || '', country: org?.country || '',
    timezone: org?.timezone || '', currency: org?.currency || 'INR', address: org?.address || '', logo: org?.logo || '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function handleLogo(file) {
    const reader = new FileReader()
    reader.onload = () => setForm(f => ({ ...f, logo: reader.result }))
    reader.readAsDataURL(file)
  }

  async function handleSave() {
    setSaving(true); setErr('')
    try { await updateOrgProfile(form); await onSaved() }
    catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div>
      <StepHeader title="Organization Profile" desc="Your organization's basic profile — shown across the app and on generated documents." />
      {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="form-row">
        <div className="form-group"><label className="form-label">Organization Name</label>
          <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
        <div className="form-group"><label className="form-label">Industry</label>
          <input className="form-input" value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))} placeholder="e.g. Manufacturing, IT Services" /></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Country</label>
          <input className="form-input" value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} placeholder="e.g. India" /></div>
        <div className="form-group"><label className="form-label">Timezone</label>
          <input className="form-input" value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))} placeholder="e.g. Asia/Kolkata" /></div>
        <div className="form-group"><label className="form-label">Currency</label>
          <input className="form-input" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} placeholder="e.g. INR" /></div>
      </div>
      <div className="form-group"><label className="form-label">Address</label>
        <textarea className="form-input" rows={2} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>
      <div className="form-group">
        <label className="form-label">Logo</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {form.logo && <img src={form.logo} alt="Logo" style={{ height: 40, borderRadius: 8, border: '1px solid var(--border)' }} />}
          <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
            Upload Logo
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => e.target.files[0] && handleLogo(e.target.files[0])} />
          </label>
        </div>
      </div>
      <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save & Continue'}</button>
    </div>
  )
}

function StructureStep({ orgId, count, onChanged }) {
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', code: '' })
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() { setLoading(true); setDepartments(await listDepartments(orgId)); setLoading(false) }

  async function handleAdd() {
    if (!form.name.trim()) return
    setErr('')
    try { await createDepartment(orgId, form.name.trim(), form.code.trim() || null); setForm({ name: '', code: '' }); await load(); await onChanged() }
    catch (e) { setErr(e.message) }
  }
  async function handleDelete(id) {
    try { await deleteDepartment(id); await load(); await onChanged() }
    catch (e) { setErr(e.message) }
  }

  return (
    <div>
      <StepHeader title="Departments" desc="Set up at least one department — locations and teams can be layered on later as your structure grows." />
      {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
      {loading ? <Loader /> : (
        <>
          {departments.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 16 }}>No departments yet.</div>
          ) : (
            <div className="table-wrap" style={{ marginBottom: 16 }}>
              <table>
                <thead><tr><th>Name</th><th>Code</th><th></th></tr></thead>
                <tbody>
                  {departments.map(d => (
                    <tr key={d.id}>
                      <td className="td-bold">{d.name}</td>
                      <td>{d.code || '—'}</td>
                      <td><button className="btn btn-ghost btn-sm" onClick={() => handleDelete(d.id)}><Trash2 size={13} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="form-input" placeholder="Department name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <input className="form-input" style={{ maxWidth: 140 }} placeholder="Code (optional)" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} />
            <button className="btn btn-primary" onClick={handleAdd}><Plus size={14} /> Add</button>
          </div>
        </>
      )}
    </div>
  )
}

function AdminsStep({ orgId, profileId, count }) {
  const [admins, setAdmins] = useState([])
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState('hr')
  const [inviteCode, setInviteCode] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() { setLoading(true); setAdmins(await listOrgAdmins(orgId)); setLoading(false) }

  async function handleInvite() {
    setErr(''); setInviteCode(null)
    try {
      const invite = await createInvite({ role, maxUses: 1, expiresDays: 7, organizationId: orgId, createdBy: profileId })
      setInviteCode(invite.code)
    } catch (e) { setErr(e.message) }
  }

  return (
    <div>
      <StepHeader title="Invite Admins" desc="Bring in an HR Admin, Billing Admin (Finance), or IT Admin — anyone who'll help run day-to-day setup." />
      {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
      {loading ? <Loader /> : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {admins.map(a => <span key={a.id} className="badge">{a.full_name} · {a.role}</span>)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Role</label>
          <select className="form-select" value={role} onChange={e => setRole(e.target.value)}>
            <option value="hr">HR Admin</option>
            <option value="finance">Billing Admin (Finance)</option>
            <option value="admin">IT Admin</option>
          </select>
        </div>
        <button className="btn btn-primary" onClick={handleInvite}><UserPlus size={14} /> Generate Invite Code</button>
      </div>
      {inviteCode && (
        <div className="alert alert-success" style={{ marginTop: 12 }}>
          Invite code: <strong style={{ fontFamily: 'monospace' }}>{inviteCode}</strong> — share it along with the sign-up link. Expires in 7 days.
        </div>
      )}
    </div>
  )
}

function LinkOutStep({ icon, title, desc, done, cta, onClick, secondaryCta, onSecondaryClick }) {
  return (
    <div style={{ textAlign: 'center', padding: '20px 0' }}>
      <div style={{ width: 56, height: 56, borderRadius: 14, background: done ? '#dcfce7' : 'var(--surface)', color: done ? '#15803d' : 'var(--ink-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
        {done ? <Check size={28} /> : icon}
      </div>
      <div style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>{title}</div>
      <div style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 18 }}>{desc}</div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button className="btn btn-primary" onClick={onClick}>{cta} <ExternalLink size={14} /></button>
        {secondaryCta && <button className="btn btn-outline" onClick={onSecondaryClick}>{secondaryCta} <ExternalLink size={14} /></button>}
      </div>
    </div>
  )
}

function StepHeader({ title, desc }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 4 }}>{title}</div>
      <div style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>{desc}</div>
    </div>
  )
}
