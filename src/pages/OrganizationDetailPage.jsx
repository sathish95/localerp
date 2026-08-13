import { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  listOrganizations, setOrganizationActive, setOrgBilling, listBillingRequests, dismissBillingRequest,
  listMembers, setMemberRole, setMemberActive, orgActivity, deleteOrganization, restoreOrganization,
  orgUsage, setOrgPaymentProviders, listOrgPaymentOrders,
} from '../lib/superAdmin'
import { listPlans } from '../lib/billing'
import { listPaymentProviders } from '../lib/paymentGateway'
import {
  listBundles, superAdminListOrgBundles, superAdminSetOrgBundle,
  superAdminListBundleRequests, superAdminDismissBundleRequest,
  listModuleAllocations, setModuleAllocation, orgBundleUtilizationEstimate,
} from '../lib/billingBundles'
import { listInvitesForOrg, createInvite, revokeInvite } from '../lib/orgInvites'
import { listRoles } from '../lib/roles'
import { dateFmt, timeFmt, rupee } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Loader, Empty, Alert, Modal, StatCard } from '../components/ui'
import {
  ArrowLeft, Landmark, Users, Ban, CheckCircle2, CreditCard, Clock, XCircle,
  UserCog, Trash2, RotateCcw, Activity, Gauge, Receipt, Puzzle, KeyRound, Plus, ChevronDown, ChevronRight,
} from 'lucide-react'

const STATUS_LABEL = { trialing: 'Trial', active: 'Active', past_due: 'Past Due', canceled: 'Canceled' }
const STATUS_COLOR = { trialing: '#f59e0b', active: '#16a34a', past_due: '#ef4444', canceled: 'var(--ink-muted)' }
const ORDER_STATUS_COLOR = { created: '#f59e0b', paid: '#16a34a', failed: '#ef4444', expired: 'var(--ink-muted)' }
const PROVIDER_LABEL = { razorpay: 'Razorpay', stripe: 'Stripe', cashfree: 'Cashfree' }
const TABS = [
  { id: 'overview', label: 'Overview', icon: <Landmark size={14} /> },
  { id: 'employees', label: 'Employees', icon: <Users size={14} /> },
  { id: 'invites', label: 'Invites', icon: <KeyRound size={14} /> },
  { id: 'billing', label: 'Billing', icon: <CreditCard size={14} /> },
  { id: 'transactions', label: 'Transactions', icon: <Receipt size={14} /> },
]

// One organization, everything in one place — the drill-down target from
// SuperAdminPage's "Show all Organizations" list. Employees, billing
// (plan/status/trial/seat/gateway allow-list/module add-ons), and
// transaction history all live here as tabs instead of stacked modals,
// so there's a single URL per org a super admin can land on directly.
export default function OrganizationDetailPage() {
  const { orgId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'overview')
  const [org, setOrg] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [plans, setPlans] = useState([])
  const [paymentProviders, setPaymentProviders] = useState([])
  const [roles, setRoles] = useState([])

  const [members, setMembers] = useState([])
  const [activity, setActivity] = useState(null)
  const [usage, setUsage] = useState(null)
  const [membersLoading, setMembersLoading] = useState(false)

  const [allBundles, setAllBundles] = useState([])
  const [orgBundles, setOrgBundles] = useState([])
  const [billingRequests, setBillingRequests] = useState([])
  const [bundleRequests, setBundleRequests] = useState([])
  const [billingForm, setBillingForm] = useState(null)
  const [billingSaving, setBillingSaving] = useState(false)
  const [bundleActionKey, setBundleActionKey] = useState(null)

  const [transactions, setTransactions] = useState([])
  const [txLoading, setTxLoading] = useState(false)

  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [invites, setInvites] = useState([])
  const [invitesLoading, setInvitesLoading] = useState(false)
  const [showNewInvite, setShowNewInvite] = useState(false)
  const [inviteForm, setInviteForm] = useState({ role: 'employee', maxUses: 1, expiresDays: 14 })
  const [inviteSaving, setInviteSaving] = useState(false)

  const [utilization, setUtilization] = useState([])
  const [expandedBundle, setExpandedBundle] = useState(null)
  const [allocations, setAllocations] = useState({}) // bundleKey -> Set(userId)
  const [allocationSaving, setAllocationSaving] = useState(null)

  const { profile } = useAuth()

  useEffect(() => { loadOrg() }, [orgId])
  useEffect(() => {
    if (!org) return
    if (activeTab === 'employees') loadEmployees()
    if (activeTab === 'invites') loadInvites()
    if (activeTab === 'billing') loadBilling()
    if (activeTab === 'transactions') loadTransactions()
  }, [activeTab, org?.id])

  async function loadOrg() {
    setLoading(true); setErr('')
    try {
      const orgs = await listOrganizations()
      const found = orgs.find(o => o.id === orgId)
      setOrg(found || null)
      if (!found) setErr('Organization not found (it may have been deleted).')
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function loadEmployees() {
    setMembersLoading(true); setErr('')
    try {
      const [m, a, u, rl] = await Promise.all([listMembers(orgId), orgActivity(orgId), orgUsage(orgId).catch(() => null), listRoles()])
      setMembers(m); setActivity(a); setUsage(u); setRoles(rl)
    } catch (e) { setErr(e.message) }
    finally { setMembersLoading(false) }
  }

  async function loadBilling() {
    setErr('')
    try {
      const [p, pp, ab, ob, br, bnr, ut] = await Promise.all([
        listPlans(), listPaymentProviders(), listBundles(), superAdminListOrgBundles(orgId),
        listBillingRequests(), superAdminListBundleRequests(), orgBundleUtilizationEstimate(orgId).catch(() => []),
      ])
      setPlans(p); setPaymentProviders(pp); setAllBundles(ab); setOrgBundles(ob)
      setBillingRequests(br.filter(r => r.organization_id === orgId))
      setBundleRequests(bnr.filter(r => r.organization_id === orgId))
      setUtilization(ut)
      setBillingForm({
        planKey: org.plan_key,
        billingStatus: org.billing_status,
        trialEndsAt: org.trial_ends_at ? org.trial_ends_at.slice(0, 10) : '',
        seatLimitOverride: '',
        allowedPaymentProviders: org.allowed_payment_providers || null,
        requestId: null,
      })
      if (members.length === 0) setMembers(await listMembers(orgId))
    } catch (e) { setErr(e.message) }
  }

  async function loadTransactions() {
    setTxLoading(true); setErr('')
    try { setTransactions(await listOrgPaymentOrders(orgId)) }
    catch (e) { setErr(e.message) }
    finally { setTxLoading(false) }
  }

  async function loadInvites() {
    setInvitesLoading(true); setErr('')
    try {
      setInvites(await listInvitesForOrg(orgId))
      if (roles.length === 0) setRoles(await listRoles())
    } catch (e) { setErr(e.message) }
    finally { setInvitesLoading(false) }
  }

  async function handleCreateInvite(e) {
    e.preventDefault(); setInviteSaving(true); setErr('')
    try {
      await createInvite({
        role: inviteForm.role, maxUses: inviteForm.maxUses ? Number(inviteForm.maxUses) : null,
        expiresDays: inviteForm.expiresDays ? Number(inviteForm.expiresDays) : null,
        organizationId: orgId, createdBy: profile?.id,
      })
      setShowNewInvite(false); loadInvites()
    } catch (e) { setErr(e.message) }
    finally { setInviteSaving(false) }
  }

  async function handleRevokeInvite(id) { await revokeInvite(id); loadInvites() }

  async function toggleExpandBundle(bundleKey) {
    if (expandedBundle === bundleKey) { setExpandedBundle(null); return }
    setExpandedBundle(bundleKey)
    if (!allocations[bundleKey]) {
      try {
        const rows = await listModuleAllocations(orgId, bundleKey)
        setAllocations(a => ({ ...a, [bundleKey]: new Set(rows.map(r => r.user_id)) }))
      } catch (e) { setErr(e.message) }
    }
    if (members.length === 0) setMembers(await listMembers(orgId).catch(() => []))
  }

  async function toggleAllocation(bundleKey, userId) {
    const current = allocations[bundleKey] || new Set()
    const isAllocated = current.has(userId)
    setAllocationSaving(bundleKey + ':' + userId)
    try {
      await setModuleAllocation(orgId, bundleKey, userId, !isAllocated, profile?.id)
      setAllocations(a => {
        const next = new Set(a[bundleKey] || [])
        isAllocated ? next.delete(userId) : next.add(userId)
        return { ...a, [bundleKey]: next }
      })
      setUtilization(await orgBundleUtilizationEstimate(orgId).catch(() => utilization))
    } catch (e) { setErr(e.message) }
    finally { setAllocationSaving(null) }
  }

  async function handleMemberRole(memberId, role) {
    await setMemberRole(memberId, role)
    setMembers(ms => ms.map(m => m.id === memberId ? { ...m, role } : m))
  }

  async function handleMemberActive(member) {
    await setMemberActive(member.id, !member.is_active)
    setMembers(ms => ms.map(m => m.id === member.id ? { ...m, is_active: !member.is_active } : m))
  }

  function toggleAllowedProvider(key) {
    setBillingForm(f => {
      const current = f.allowedPaymentProviders ?? paymentProviders.map(p => p.key)
      const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key]
      return { ...f, allowedPaymentProviders: next.length === paymentProviders.length ? null : next }
    })
  }

  async function handleSaveBilling(e) {
    e.preventDefault(); setBillingSaving(true); setErr('')
    try {
      await Promise.all([
        setOrgBilling(orgId, {
          planKey: billingForm.planKey,
          billingStatus: billingForm.billingStatus,
          trialEndsAt: billingForm.trialEndsAt ? new Date(billingForm.trialEndsAt).toISOString() : null,
          seatLimitOverride: billingForm.seatLimitOverride === '' ? null : Number(billingForm.seatLimitOverride),
          requestId: billingForm.requestId,
        }),
        setOrgPaymentProviders(orgId, billingForm.allowedPaymentProviders),
      ])
      await loadOrg(); await loadBilling()
    } catch (e) { setErr(e.message) }
    finally { setBillingSaving(false) }
  }

  async function handleToggleBundle(bundleKey, isActive) {
    setBundleActionKey(bundleKey); setErr('')
    try { await superAdminSetOrgBundle(orgId, bundleKey, !isActive); await loadBilling() }
    catch (e) { setErr(e.message) }
    finally { setBundleActionKey(null) }
  }

  function handleReviewPlanRequest(r) {
    // Prefill only — the request stays pending until "Save Plan & Billing"
    // actually applies it, which also marks it fulfilled server-side in
    // the same call (super_admin_set_org_billing's p_request_id param).
    setBillingForm(f => ({ ...f, planKey: r.requested_plan_key, requestId: r.id }))
  }

  async function handleDismissPlanRequest(id) { await dismissBillingRequest(id); loadBilling() }

  async function handleApproveBundleRequest(r) {
    setBundleActionKey(r.bundle_key)
    try { await superAdminSetOrgBundle(orgId, r.bundle_key, r.action === 'activate', r.id); await loadBilling() }
    catch (e) { setErr(e.message) }
    finally { setBundleActionKey(null) }
  }
  async function handleDismissBundleRequest(id) { await superAdminDismissBundleRequest(id); loadBilling() }

  async function handleToggleActive() { await setOrganizationActive(orgId, !org.is_active); loadOrg() }
  async function handleRestore() { await restoreOrganization(orgId); loadOrg() }
  async function handleConfirmDelete() {
    setDeleting(true); setErr('')
    try { await deleteOrganization(orgId); setShowDelete(false); navigate('/super-admin') }
    catch (e) { setErr(e.message) }
    finally { setDeleting(false) }
  }

  if (loading) return <Loader />
  if (!org) return <div><Alert type="error" message={err || 'Organization not found'} /><button className="btn btn-ghost" onClick={() => navigate('/super-admin')}><ArrowLeft size={14} /> Back to Organizations</button></div>

  const currentPlan = plans.find(p => p.key === org.plan_key)

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/super-admin')} style={{ marginBottom: 12 }}><ArrowLeft size={13} /> All Organizations</button>

      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Landmark size={22} /> {org.name}</div>
          <div className="page-subtitle">/{org.slug} · Created {dateFmt(org.created_at)}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {org.deleted_at ? (
            <button className="btn btn-outline btn-sm" onClick={handleRestore}><RotateCcw size={13} /> Restore</button>
          ) : (
            <>
              <button className="btn btn-outline btn-sm" onClick={handleToggleActive}>
                {org.is_active ? <><Ban size={13} /> Suspend</> : <><CheckCircle2 size={13} /> Reactivate</>}
              </button>
              <button className="btn btn-outline btn-sm" style={{ color: org.is_active ? 'var(--ink-muted)' : '#ef4444' }}
                disabled={org.is_active} title={org.is_active ? 'Suspend before deleting' : 'Delete this organization'}
                onClick={() => { setShowDelete(true); setDeleteConfirmText('') }}>
                <Trash2 size={13} /> Delete
              </button>
            </>
          )}
        </div>
      </div>

      {err && <Alert type="error" message={err} />}

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', fontSize: 13, fontWeight: 700,
              border: 'none', background: 'none', cursor: 'pointer',
              color: activeTab === t.id ? 'var(--c1)' : 'var(--ink-muted)',
              borderBottom: activeTab === t.id ? '2px solid var(--c1)' : '2px solid transparent',
            }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div>
          <div className="stats-grid" style={{ marginBottom: 20 }}>
            <StatCard label="Plan" value={currentPlan?.name || org.plan_key} icon={<CreditCard size={17} />} accent="#6366f1" />
            <StatCard label="Billing Status" value={STATUS_LABEL[org.billing_status] || org.billing_status} icon={<Clock size={17} />} accent={STATUS_COLOR[org.billing_status] || '#64748b'} />
            <StatCard label="Members" value={`${org.member_count}${org.seat_limit != null ? ` / ${org.seat_limit}` : ''}`} icon={<Users size={17} />} accent="#0ea5e9" />
            <StatCard label="Status" value={org.is_active ? 'Active' : 'Suspended'} icon={org.is_active ? <CheckCircle2 size={17} /> : <Ban size={17} />} accent={org.is_active ? '#16a34a' : '#ef4444'} />
          </div>
          {usage && (
            <div className="card" style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 10 }}><Gauge size={12} style={{ verticalAlign: -1, marginRight: 3 }} />Usage</div>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13 }}>
                <div><strong>{usage.seat_count}</strong><span style={{ color: 'var(--ink-muted)' }}> / {usage.seat_limit ?? '∞'} seats</span></div>
                <div><strong>{usage.department_count}</strong><span style={{ color: 'var(--ink-muted)' }}> departments</span></div>
                <div><strong>{usage.awards_granted}</strong><span style={{ color: 'var(--ink-muted)' }}> awards granted</span></div>
                <div><strong>{usage.certificates_issued}</strong><span style={{ color: 'var(--ink-muted)' }}> certificates issued</span></div>
                <div><strong>{usage.active_bundle_count}</strong><span style={{ color: 'var(--ink-muted)' }}> active module add-ons</span></div>
              </div>
            </div>
          )}
          {activity && (
            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 160, padding: '10px 14px', borderRadius: 10, background: 'var(--surface-2, rgba(99,102,241,.06))', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--ink-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Events (30d)</div>
                <div style={{ fontWeight: 800, fontSize: '1.1rem' }}><Activity size={14} style={{ verticalAlign: -2, marginRight: 4 }} />{activity.events_30d ?? 0}</div>
              </div>
              <div style={{ flex: 1, minWidth: 160, padding: '10px 14px', borderRadius: 10, background: 'var(--surface-2, rgba(99,102,241,.06))', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--ink-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Active Users (30d)</div>
                <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>{activity.active_users_30d ?? 0}</div>
              </div>
              <div style={{ flex: 1, minWidth: 160, padding: '10px 14px', borderRadius: 10, background: 'var(--surface-2, rgba(99,102,241,.06))', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--ink-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Last Activity</div>
                <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>{activity.last_event_at ? timeFmt(activity.last_event_at) : '—'}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'employees' && (
        membersLoading ? <Loader /> : members.length === 0 ? <Empty message="No members" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last Seen</th><th>Active</th></tr></thead>
              <tbody>
                {members.map(m => (
                  <tr key={m.id}>
                    <td className="td-bold">{m.full_name}</td>
                    <td style={{ color: 'var(--ink-muted)' }}>{m.email}</td>
                    <td>
                      <select className="form-input" style={{ fontSize: 12, padding: '4px 8px' }} value={m.role} onChange={e => handleMemberRole(m.id, e.target.value)}>
                        {roles.map(r => <option key={r.role_key} value={r.role_key}>{r.label}</option>)}
                      </select>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{m.last_seen_at ? timeFmt(m.last_seen_at) : 'Never'}</td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleMemberActive(m)}>
                        {m.is_active ? <CheckCircle2 size={14} style={{ color: '#16a34a' }} /> : <Ban size={14} style={{ color: '#ef4444' }} />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {activeTab === 'invites' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
            <button className="btn btn-primary btn-sm" onClick={() => { setInviteForm({ role: 'employee', maxUses: 1, expiresDays: 14 }); setShowNewInvite(true) }}>
              <Plus size={13} /> New Invite
            </button>
          </div>
          {invitesLoading ? <Loader /> : invites.length === 0 ? <Empty message="No invite codes issued for this organization yet" /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Code</th><th>Role</th><th>Uses</th><th>Expires</th><th>Status</th><th>Created</th><th></th></tr></thead>
                <tbody>
                  {invites.map(inv => {
                    const expired = inv.expires_at && new Date(inv.expires_at) < new Date()
                    const exhausted = inv.max_uses != null && inv.use_count >= inv.max_uses
                    const isLive = !inv.revoked && !expired && !exhausted
                    return (
                      <tr key={inv.id}>
                        <td className="td-bold" style={{ fontFamily: 'monospace', letterSpacing: '.05em' }}>{inv.code}</td>
                        <td style={{ textTransform: 'capitalize' }}>{inv.role}</td>
                        <td>{inv.use_count}{inv.max_uses != null ? ` / ${inv.max_uses}` : ' / ∞'}</td>
                        <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{inv.expires_at ? dateFmt(inv.expires_at) : 'Never'}</td>
                        <td>
                          {inv.revoked ? <span style={{ color: 'var(--ink-muted)', fontWeight: 700, fontSize: 12 }}>Revoked</span>
                            : expired ? <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 12 }}>Expired</span>
                            : exhausted ? <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 12 }}>Used up</span>
                            : <span style={{ color: '#16a34a', fontWeight: 700, fontSize: 12 }}>Active</span>}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{dateFmt(inv.created_at)}</td>
                        <td>{isLive && <button className="btn btn-ghost btn-sm" onClick={() => handleRevokeInvite(inv.id)}>Revoke</button>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'billing' && billingForm && (
        <div>
          {billingRequests.filter(r => r.status === 'pending').length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 800, fontSize: '0.9rem', marginBottom: 8 }}>Pending Plan Change Requests</div>
              {billingRequests.filter(r => r.status === 'pending').map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--surface-2, rgba(99,102,241,.06))', marginBottom: 6, fontSize: 13 }}>
                  <Clock size={13} /> Requested <strong>{plans.find(p => p.key === r.requested_plan_key)?.name || r.requested_plan_key}</strong>
                  {r.note && <span style={{ color: 'var(--ink-muted)' }}>— {r.note}</span>}
                  <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => handleReviewPlanRequest(r)}>Prefill Below</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleDismissPlanRequest(r.id)}><XCircle size={13} /> Dismiss</button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleSaveBilling} className="card" style={{ padding: '18px 20px', marginBottom: 20 }}>
            <div style={{ fontWeight: 800, fontSize: '0.95rem', marginBottom: 14 }}>Plan & Status</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 14 }}>
              <div>
                <label className="form-label">Plan</label>
                <select className="form-input" value={billingForm.planKey} onChange={e => setBillingForm(f => ({ ...f, planKey: e.target.value }))}>
                  {plans.map(p => <option key={p.key} value={p.key}>{p.name}{p.seat_limit ? ` (${p.seat_limit} seats)` : ' (unlimited)'}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Status</label>
                <select className="form-input" value={billingForm.billingStatus} onChange={e => setBillingForm(f => ({ ...f, billingStatus: e.target.value }))}>
                  {Object.keys(STATUS_LABEL).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Trial Ends (blank = not on trial)</label>
                <input className="form-input" type="date" value={billingForm.trialEndsAt} onChange={e => setBillingForm(f => ({ ...f, trialEndsAt: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Seat Limit Override (blank = plan default)</label>
                <input className="form-input" type="number" min={1} value={billingForm.seatLimitOverride} onChange={e => setBillingForm(f => ({ ...f, seatLimitOverride: e.target.value }))} placeholder={org.seat_limit != null ? String(org.seat_limit) : '∞'} />
              </div>
            </div>

            {paymentProviders.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <label className="form-label">Allowed Payment Methods</label>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  {paymentProviders.map(p => {
                    const checked = billingForm.allowedPaymentProviders ? billingForm.allowedPaymentProviders.includes(p.key) : true
                    return (
                      <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleAllowedProvider(p.key)} disabled={!p.is_active} /> {PROVIDER_LABEL[p.key] || p.name}
                        {!p.is_active && <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>(disabled platform-wide)</span>}
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
            <button className="btn btn-primary btn-sm" disabled={billingSaving}>{billingSaving ? 'Saving…' : 'Save Plan & Billing'}</button>
          </form>

          <div className="card" style={{ padding: '18px 20px', marginBottom: 20 }}>
            <div style={{ fontWeight: 800, fontSize: '0.95rem', marginBottom: 4 }}><Puzzle size={14} style={{ verticalAlign: -2, marginRight: 4 }} />Module Add-ons</div>
            <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 12 }}>
              Toggle directly, or resolve a pending request below. Expand an active module to allocate which members
              actually use it — an informational utilization estimate; the real bill still prices by total seats.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {allBundles.map(b => {
                const isActive = orgBundles.some(ob => ob.bundle_key === b.key)
                const util = utilization.find(u => u.bundle_key === b.key)
                const isExpanded = expandedBundle === b.key
                const allocatedSet = allocations[b.key]
                return (
                  <div key={b.key} style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', fontSize: 13 }}>
                      <input type="checkbox" checked={isActive} disabled={bundleActionKey === b.key} onChange={() => handleToggleBundle(b.key, isActive)} style={{ cursor: bundleActionKey === b.key ? 'wait' : 'pointer' }} />
                      <span style={{ flex: 1 }}>{b.name}</span>
                      {isActive && util && (
                        <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{util.allocated_count} allocated · {rupee(util.estimated_monthly)}/mo</span>
                      )}
                      {isActive && (
                        <button className="btn btn-ghost btn-sm" onClick={() => toggleExpandBundle(b.key)}>
                          {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Allocate
                        </button>
                      )}
                    </div>
                    {isExpanded && (
                      <div style={{ padding: '4px 10px 10px 34px', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                        {members.length === 0 ? <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Loading members…</span> :
                          members.map(m => {
                            const checked = allocatedSet ? allocatedSet.has(m.id) : false
                            const key = b.key + ':' + m.id
                            return (
                              <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: allocationSaving === key ? 'wait' : 'pointer' }}>
                                <input type="checkbox" checked={checked} disabled={allocationSaving === key} onChange={() => toggleAllocation(b.key, m.id)} />
                                {m.full_name}
                              </label>
                            )
                          })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {bundleRequests.filter(r => r.status === 'pending').length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Pending Add-on Requests</div>
                {bundleRequests.filter(r => r.status === 'pending').map(r => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--surface-2, rgba(99,102,241,.06))', marginBottom: 6, fontSize: 13 }}>
                    <span style={{ textTransform: 'capitalize' }}>{r.action}</span> <strong>{r.bundle_name}</strong>
                    {r.note && <span style={{ color: 'var(--ink-muted)' }}>— {r.note}</span>}
                    <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} disabled={bundleActionKey === r.bundle_key} onClick={() => handleApproveBundleRequest(r)}>Approve</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleDismissBundleRequest(r.id)}><XCircle size={13} /> Dismiss</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'transactions' && (
        txLoading ? <Loader /> : transactions.length === 0 ? <Empty message="No payment orders for this organization" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Provider</th><th>Plan / Add-ons</th><th>Amount</th><th>Status</th><th>Created</th><th>Paid</th></tr></thead>
              <tbody>
                {transactions.map(t => (
                  <tr key={t.id}>
                    <td>{PROVIDER_LABEL[t.provider] || t.provider}</td>
                    <td>{t.plan_key || '—'}{t.bundle_keys?.length > 0 ? ` + ${t.bundle_keys.length} add-on${t.bundle_keys.length > 1 ? 's' : ''}` : ''}</td>
                    <td>{rupee(t.amount)}</td>
                    <td><span style={{ color: ORDER_STATUS_COLOR[t.status] || 'var(--ink-muted)', fontWeight: 700, fontSize: 12, textTransform: 'capitalize' }}>{t.status}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{dateFmt(t.created_at)}</td>
                    <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{t.paid_at ? dateFmt(t.paid_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {showDelete && (
        <Modal open title={`Delete ${org.name}`} onClose={() => setShowDelete(false)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setShowDelete(false)}>Cancel</button>
            <button className="btn btn-primary" style={{ background: '#ef4444', borderColor: '#ef4444' }}
              disabled={deleting || deleteConfirmText !== org.slug} onClick={handleConfirmDelete}>
              {deleting ? 'Deleting…' : 'Delete Organization'}
            </button>
          </>}>
          <p style={{ marginBottom: 12, fontSize: '0.88rem' }}>
            This removes <strong>{org.name}</strong> from every organization listing and blocks its members from
            signing in. Its data is kept (soft delete) and this can be undone from "Archived Organizations" later.
          </p>
          <label className="form-label">Type <strong>{org.slug}</strong> to confirm</label>
          <input className="form-input" value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)} placeholder={org.slug} autoFocus />
        </Modal>
      )}

      {showNewInvite && (
        <Modal open title="New Invite Code" onClose={() => setShowNewInvite(false)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setShowNewInvite(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCreateInvite} disabled={inviteSaving}>{inviteSaving ? 'Creating…' : 'Create'}</button>
          </>}>
          <form onSubmit={handleCreateInvite}>
            {err && <Alert type="error" message={err} />}
            <div style={{ marginBottom: 12 }}>
              <label className="form-label">Role granted on join</label>
              <select className="form-input" value={inviteForm.role} onChange={e => setInviteForm(f => ({ ...f, role: e.target.value }))}>
                {roles.length > 0 ? roles.map(r => <option key={r.role_key} value={r.role_key}>{r.label}</option>)
                  : ['employee', 'manager', 'department_head', 'finance', 'hr', 'admin', 'ceo'].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label className="form-label">Max Uses (blank = unlimited)</label>
                <input className="form-input" type="number" min={1} value={inviteForm.maxUses ?? ''} onChange={e => setInviteForm(f => ({ ...f, maxUses: e.target.value === '' ? null : e.target.value }))} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="form-label">Expires in (days, blank = never)</label>
                <input className="form-input" type="number" min={1} value={inviteForm.expiresDays ?? ''} onChange={e => setInviteForm(f => ({ ...f, expiresDays: e.target.value === '' ? null : e.target.value }))} />
              </div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
