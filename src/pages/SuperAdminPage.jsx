import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  listOrganizations, createOrganization, setOrganizationActive,
  setOrgBilling, listBillingRequests, dismissBillingRequest,
} from '../lib/superAdmin'
import { listPlans } from '../lib/billing'
import { createInvite } from '../lib/orgInvites'
import { rupee, dateFmt } from '../lib/supabase'
import { Loader, Empty, Alert, Modal } from '../components/ui'
import { Landmark, Plus, Users, Ban, CheckCircle2, KeyRound, CreditCard, Clock, XCircle } from 'lucide-react'

const STATUS_LABEL = { trialing: 'Trial', active: 'Active', past_due: 'Past Due', canceled: 'Canceled' }
const STATUS_COLOR = { trialing: '#f59e0b', active: '#16a34a', past_due: '#ef4444', canceled: 'var(--ink-muted)' }

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
  const [plans, setPlans] = useState([])
  const [requests, setRequests] = useState([])
  const [billingOrg, setBillingOrg] = useState(null) // org being edited, or null
  const [billingForm, setBillingForm] = useState(null)
  const [billingSaving, setBillingSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setErr('')
    try {
      const [o, p, r] = await Promise.all([listOrganizations(), listPlans(), listBillingRequests()])
      setOrgs(o); setPlans(p); setRequests(r)
    }
    catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  function openBilling(org, prefillRequest) {
    setBillingOrg(org)
    setBillingForm({
      planKey: prefillRequest?.requested_plan_key || org.plan_key,
      billingStatus: org.billing_status,
      trialEndsAt: org.trial_ends_at ? org.trial_ends_at.slice(0, 10) : '',
      seatLimitOverride: '',
      requestId: prefillRequest?.id || null,
    })
  }

  async function handleSaveBilling(e) {
    e.preventDefault(); setBillingSaving(true); setErr('')
    try {
      await setOrgBilling(billingOrg.id, {
        planKey: billingForm.planKey,
        billingStatus: billingForm.billingStatus,
        trialEndsAt: billingForm.trialEndsAt ? new Date(billingForm.trialEndsAt).toISOString() : null,
        seatLimitOverride: billingForm.seatLimitOverride === '' ? null : Number(billingForm.seatLimitOverride),
        requestId: billingForm.requestId,
      })
      setBillingOrg(null); setBillingForm(null); load()
    } catch (e) { setErr(e.message) }
    finally { setBillingSaving(false) }
  }

  async function handleDismissRequest(id) {
    await dismissBillingRequest(id); load()
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
            <thead><tr><th>Organization</th><th>Slug</th><th>Members</th><th>Plan</th><th>Billing</th><th>Created</th><th>Active</th><th></th></tr></thead>
            <tbody>
              {orgs.map(o => (
                <tr key={o.id}>
                  <td className="td-bold">{o.name}</td>
                  <td style={{ color: 'var(--ink-muted)' }}>/{o.slug}</td>
                  <td><Users size={13} style={{ verticalAlign: -2, marginRight: 4 }} />{o.member_count}{o.seat_limit != null ? ` / ${o.seat_limit}` : ''}</td>
                  <td>{plans.find(p => p.key === o.plan_key)?.name || o.plan_key}</td>
                  <td>
                    <span style={{ color: STATUS_COLOR[o.billing_status] || 'var(--ink-muted)', fontWeight: 700, fontSize: 12 }}>{STATUS_LABEL[o.billing_status] || o.billing_status}</span>
                    {o.billing_status === 'trialing' && o.trial_ends_at && <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>ends {dateFmt(o.trial_ends_at)}</div>}
                  </td>
                  <td>{new Date(o.created_at).toLocaleDateString()}</td>
                  <td>{o.is_active
                    ? <span style={{ color: '#16a34a', fontWeight: 700, fontSize: 12 }}>Active</span>
                    : <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 12 }}>Suspended</span>}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => openBilling(o)}><CreditCard size={13} /> Billing</button>
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

      <div style={{ marginTop: 32 }}>
        <div className="page-subtitle" style={{ marginBottom: 10, fontWeight: 800, fontSize: '0.95rem', color: 'var(--ink)' }}>Pending Plan Change Requests</div>
        {requests.filter(r => r.status === 'pending').length === 0 ? <Empty message="No pending requests" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Organization</th><th>Requested Plan</th><th>Note</th><th>Requested</th><th></th></tr></thead>
              <tbody>
                {requests.filter(r => r.status === 'pending').map(r => (
                  <tr key={r.id}>
                    <td className="td-bold">{r.org_name}</td>
                    <td>{plans.find(p => p.key === r.requested_plan_key)?.name || r.requested_plan_key}</td>
                    <td style={{ color: 'var(--ink-muted)' }}>{r.note || '—'}</td>
                    <td><Clock size={13} style={{ verticalAlign: -2, marginRight: 4 }} />{dateFmt(r.created_at)}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-primary btn-sm" onClick={() => openBilling(orgs.find(o => o.id === r.organization_id), r)}>Review</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleDismissRequest(r.id)}><XCircle size={13} /> Dismiss</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {billingOrg && billingForm && (
        <Modal open title={`Billing — ${billingOrg.name}`} onClose={() => { setBillingOrg(null); setBillingForm(null) }}
          footer={<>
            <button className="btn btn-ghost" onClick={() => { setBillingOrg(null); setBillingForm(null) }}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSaveBilling} disabled={billingSaving}>{billingSaving ? 'Saving…' : 'Save'}</button>
          </>}>
          <form onSubmit={handleSaveBilling}>
            {err && <Alert type="error" message={err} />}
            <div style={{ marginBottom: 12 }}>
              <label className="form-label">Plan</label>
              <select className="form-input" value={billingForm.planKey} onChange={e => setBillingForm(f => ({ ...f, planKey: e.target.value }))}>
                {plans.map(p => <option key={p.key} value={p.key}>{p.name}{p.seat_limit ? ` (${p.seat_limit} seats)` : ' (unlimited)'}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="form-label">Status</label>
              <select className="form-input" value={billingForm.billingStatus} onChange={e => setBillingForm(f => ({ ...f, billingStatus: e.target.value }))}>
                {Object.keys(STATUS_LABEL).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="form-label">Trial Ends (leave blank if not on trial)</label>
              <input className="form-input" type="date" value={billingForm.trialEndsAt} onChange={e => setBillingForm(f => ({ ...f, trialEndsAt: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Seat Limit Override (blank = use plan default)</label>
              <input className="form-input" type="number" min={1} value={billingForm.seatLimitOverride} onChange={e => setBillingForm(f => ({ ...f, seatLimitOverride: e.target.value }))} placeholder={billingOrg.seat_limit != null ? String(billingOrg.seat_limit) : '∞'} />
            </div>
          </form>
        </Modal>
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
