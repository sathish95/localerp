import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { listOrganizations, createOrganization, setOrganizationActive } from '../lib/superAdmin'
import { createInvite } from '../lib/orgInvites'
import { Loader, Empty, Alert, Modal } from '../components/ui'
import { Landmark, Plus, Users, Boxes, Ban, CheckCircle2, KeyRound } from 'lucide-react'

// Platform-level org management — reachable only by profiles.is_super_admin
// (see App.jsx route + Layout.jsx nav gate). Not module-gated: this is a
// platform capability, not a per-org feature toggle.
export default function SuperAdminPage() {
  const { profile } = useAuth()
  const [orgs, setOrgs] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', slug: '' })
  const [saving, setSaving] = useState(false)
  const [adminInvite, setAdminInvite] = useState(null) // { orgName, code }

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setErr('')
    try { setOrgs(await listOrganizations()) }
    catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  function slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  }

  async function handleCreate(e) {
    e.preventDefault(); setSaving(true); setErr('')
    try {
      const org = await createOrganization(form.name.trim(), form.slug.trim() || slugify(form.name))
      // Bootstrap the new org with an admin invite so the customer has a
      // way in — otherwise a manually-created org has zero users.
      const invite = await createInvite({ role: 'admin', maxUses: 1, expiresDays: 14, organizationId: org.id, createdBy: profile.id })
      setShowCreate(false); setForm({ name: '', slug: '' }); load()
      setAdminInvite({ orgName: org.name, code: invite.code })
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  async function toggleActive(org) {
    await setOrganizationActive(org.id, !org.is_active)
    load()
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Landmark size={22} /> Super Admin — Organizations</div>
          <div className="page-subtitle">Platform-wide view across every organization on this instance</div>
        </div>
        <button className="btn btn-primary" onClick={() => { setForm({ name: '', slug: '' }); setErr(''); setShowCreate(true) }}>
          <Plus size={15} /> New Organization
        </button>
      </div>

      {err && <Alert type="error" message={err} />}

      {orgs.length === 0 ? <Empty message="No organizations yet" /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Organization</th><th>Slug</th><th>Members</th><th>Enabled Modules</th><th>Created</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {orgs.map(o => (
                <tr key={o.id}>
                  <td className="td-bold">{o.name}</td>
                  <td style={{ color: 'var(--ink-muted)' }}>/{o.slug}</td>
                  <td><Users size={13} style={{ verticalAlign: -2, marginRight: 4 }} />{o.member_count}</td>
                  <td><Boxes size={13} style={{ verticalAlign: -2, marginRight: 4 }} />{o.enabled_module_count}</td>
                  <td>{new Date(o.created_at).toLocaleDateString()}</td>
                  <td>{o.is_active
                    ? <span style={{ color: '#16a34a', fontWeight: 700, fontSize: 12 }}>Active</span>
                    : <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 12 }}>Suspended</span>}</td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(o)}>
                      {o.is_active ? <><Ban size={13} /> Suspend</> : <><CheckCircle2 size={13} /> Reactivate</>}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <Modal open title="New Organization" onClose={() => setShowCreate(false)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCreate} disabled={saving || !form.name.trim()}>{saving ? 'Creating…' : 'Create'}</button>
          </>}>
          <form onSubmit={handleCreate}>
            {err && <Alert type="error" message={err} />}
            <div style={{ marginBottom: 12 }}>
              <label className="form-label">Organization Name</label>
              <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: f.slug || slugify(e.target.value) }))} placeholder="Acme Corp" required autoFocus />
            </div>
            <div>
              <label className="form-label">Slug</label>
              <input className="form-input" value={form.slug} onChange={e => setForm(f => ({ ...f, slug: slugify(e.target.value) }))} placeholder="acme-corp" required />
            </div>
          </form>
        </Modal>
      )}

      {adminInvite && (
        <Modal open title="Organization created" onClose={() => setAdminInvite(null)}
          footer={<button className="btn btn-primary" onClick={() => setAdminInvite(null)}>Done</button>}>
          <p style={{ marginBottom: 14 }}><strong>{adminInvite.orgName}</strong> is ready. Share this one-time admin invite code with the customer so they can create their own admin account:</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderRadius: 10, background: 'var(--surface-2, rgba(99,102,241,.08))', border: '1px solid var(--border)' }}>
            <KeyRound size={18} />
            <span style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 800, letterSpacing: '.1em' }}>{adminInvite.code}</span>
          </div>
          <p style={{ marginTop: 12, fontSize: 13, color: 'var(--ink-muted)' }}>They sign up at <code>/auth?mode=signup</code>, choose "Join with invite", and paste this code. It expires in 14 days or after first use.</p>
        </Modal>
      )}
    </div>
  )
}
