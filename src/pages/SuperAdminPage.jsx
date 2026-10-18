import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  listOrganizations, createOrganization, setOrganizationActive,
  listBillingRequests, dismissBillingRequest, deleteOrganization, restoreOrganization,
  platformDashboardStats, platformPlanDistribution,
  setPaymentProviderActive, listRecentPaymentOrders,
} from '../lib/superAdmin'
import { listPlans } from '../lib/billing'
import { listPaymentProviders } from '../lib/paymentGateway'
import { superAdminListBundleRequests, superAdminSetOrgBundle, superAdminDismissBundleRequest } from '../lib/billingBundles'
import { createInvite } from '../lib/orgInvites'
import { updateAppName, getMaintenanceMode, setMaintenanceMode } from '../lib/platformSettings'
import { useAppName, useRefreshAppName } from '../context/BrandingContext'
import { useMaintenance } from '../context/MaintenanceContext'
import { dateFmt, rupee, supabase } from '../lib/supabase'
import { Loader, Empty, Alert, Modal, StatCard } from '../components/ui'
import AnnouncementsSection from '../components/settings/AnnouncementsSection'
import {
  Landmark, Plus, Users, Ban, CheckCircle2, KeyRound, CreditCard, Clock, XCircle,
  UserCog, Trash2, RotateCcw, Archive, DollarSign, TrendingUp, Power, ChevronRight, Save, Tag, Wrench,
} from 'lucide-react'

const STATUS_LABEL = { trialing: 'Trial', active: 'Active', past_due: 'Past Due', canceled: 'Canceled' }
const STATUS_COLOR = { trialing: '#f59e0b', active: '#16a34a', past_due: '#ef4444', canceled: 'var(--ink-muted)' }
const ORDER_STATUS_COLOR = { created: '#f59e0b', paid: '#16a34a', failed: '#ef4444', expired: 'var(--ink-muted)' }
const PROVIDER_LABEL = { razorpay: 'Razorpay', stripe: 'Stripe', cashfree: 'Cashfree' }

// Platform-level org management — reachable only by profiles.is_super_admin
// (see App.jsx route + Layout.jsx nav gate). This is the "show all
// organizations" list; clicking into one goes to OrganizationDetailPage,
// which is where employees/billing/transactions for that one org live
// (one URL per org, tabbed, instead of modals stacked on this list).
export default function SuperAdminPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [orgs, setOrgs] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', slug: '' })
  const [saving, setSaving] = useState(false)
  const [adminInvite, setAdminInvite] = useState(null) // { orgName, code }
  const [plans, setPlans] = useState([])
  const [requests, setRequests] = useState([])
  const [deleteOrg, setDeleteOrg] = useState(null) // org pending soft-delete confirmation
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [bundleRequests, setBundleRequests] = useState([])
  const [bundleActionId, setBundleActionId] = useState(null)
  const [stats, setStats] = useState(null)
  const [planDist, setPlanDist] = useState([])
  const [paymentProviders, setPaymentProviders] = useState([])
  const [providerToggling, setProviderToggling] = useState(null)
  const [recentOrders, setRecentOrders] = useState([])
  const currentAppName = useAppName()
  const refreshAppName = useRefreshAppName()
  const [appNameInput, setAppNameInput] = useState('')
  const [appNameSaving, setAppNameSaving] = useState(false)
  const [appNameSaved, setAppNameSaved] = useState(false)

  const { refresh: refreshMaintenance } = useMaintenance()
  const [maintEnabled, setMaintEnabled] = useState(false)
  const [maintMessage, setMaintMessage] = useState('')
  const [maintGifUrl, setMaintGifUrl] = useState('')
  const [maintSaving, setMaintSaving] = useState(false)
  const [maintSaved, setMaintSaved] = useState(false)
  // Diagnostic: what the DATABASE thinks of the current session, straight
  // from the same function the write RLS policy calls — vs profile?.is_super_admin,
  // which is only the CLIENT's cached copy from login. If these two ever
  // disagree, the write policy silently blocking (PGRST116) is coming from
  // a stale session, not from the DB flag itself being wrong.
  const [serverIsSuperAdmin, setServerIsSuperAdmin] = useState(null)
  const [annNotice, setAnnNotice] = useState(null)

  useEffect(() => { load() }, [])
  useEffect(() => { setAppNameInput(currentAppName) }, [currentAppName])
  useEffect(() => { getMaintenanceMode().then(({ enabled, message, gifUrl }) => { setMaintEnabled(enabled); setMaintMessage(message); setMaintGifUrl(gifUrl) }) }, [])
  useEffect(() => {
    supabase.rpc('is_platform_super_admin').then(({ data, error }) => {
      setServerIsSuperAdmin(error ? `error: ${error.message}` : data)
    })
  }, [])

  async function load() {
    setLoading(true); setErr('')
    try {
      const [o, p, r, br] = await Promise.all([listOrganizations(), listPlans(), listBillingRequests(), superAdminListBundleRequests()])
      setOrgs(o); setPlans(p); setRequests(r); setBundleRequests(br)
    }
    catch (e) { setErr(e.message) }
    finally { setLoading(false) }
    // Isolated from the main load above — a stats-query failure (e.g.
    // STEP127 not yet applied) shouldn't take down the org list.
    try {
      const [s, pd] = await Promise.all([platformDashboardStats(), platformPlanDistribution()])
      setStats(s); setPlanDist(pd)
    } catch { setStats(null); setPlanDist([]) }
    // Same isolation for payment data (STEP128/STEP129 may not be applied yet).
    try {
      const [pp, ro] = await Promise.all([listPaymentProviders(), listRecentPaymentOrders(25)])
      setPaymentProviders(pp); setRecentOrders(ro)
    } catch { setPaymentProviders([]); setRecentOrders([]) }
  }

  async function handleSaveAppName(e) {
    e.preventDefault(); setAppNameSaving(true); setErr(''); setAppNameSaved(false)
    try {
      await updateAppName(appNameInput)
      await refreshAppName() // updates BrandingContext, so every page reading useAppName() re-renders immediately
      setAppNameSaved(true); setTimeout(() => setAppNameSaved(false), 2500)
    } catch (e) { setErr(e.message) }
    finally { setAppNameSaving(false) }
  }

  async function handleToggleMaintenance() {
    setMaintSaving(true); setErr('')
    try {
      const next = !maintEnabled
      await setMaintenanceMode(next, maintMessage, maintGifUrl)
      setMaintEnabled(next)
      await refreshMaintenance()
      setMaintSaved(true); setTimeout(() => setMaintSaved(false), 2500)
    } catch (e) { setErr(e.message) }
    finally { setMaintSaving(false) }
  }

  async function handleSaveMaintMessage() {
    setMaintSaving(true); setErr('')
    try {
      await setMaintenanceMode(maintEnabled, maintMessage, maintGifUrl)
      await refreshMaintenance()
      setMaintSaved(true); setTimeout(() => setMaintSaved(false), 2500)
    } catch (e) { setErr(e.message) }
    finally { setMaintSaving(false) }
  }

  async function handleToggleProvider(p) {
    setProviderToggling(p.key)
    try { await setPaymentProviderActive(p.key, !p.is_active); await load() }
    catch (e) { setErr(e.message) }
    finally { setProviderToggling(null) }
  }

  async function handleApproveBundleRequest(r) {
    setBundleActionId(r.id); setErr('')
    try {
      await superAdminSetOrgBundle(r.organization_id, r.bundle_key, r.action === 'activate', r.id)
      load()
    } catch (e) { setErr(e.message) }
    finally { setBundleActionId(null) }
  }

  async function handleDismissBundleRequest(id) {
    await superAdminDismissBundleRequest(id); load()
  }

  function openDelete(org) {
    setDeleteOrg(org); setDeleteConfirmText(''); setErr('')
  }

  async function handleConfirmDelete() {
    setDeleting(true); setErr('')
    try {
      await deleteOrganization(deleteOrg.id)
      setDeleteOrg(null); setDeleteConfirmText('')
      load()
    } catch (e) { setErr(e.message) }
    finally { setDeleting(false) }
  }

  async function handleRestore(org) {
    await restoreOrganization(org.id)
    load()
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

  const liveOrgs = orgs.filter(o => !o.deleted_at)
  const archivedOrgs = orgs.filter(o => o.deleted_at)

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Landmark size={22} /> Organizations</div>
          <div className="page-subtitle">Platform-wide view across every organization on this instance</div>
        </div>
        <button className="btn btn-primary" onClick={() => { setForm({ name: '', slug: '' }); setErr(''); setShowCreate(true) }}>
          <Plus size={15} /> New Organization
        </button>
      </div>

      <div className="card" style={{ padding: '14px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <Tag size={16} style={{ color: 'var(--ink-muted)' }} />
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase' }}>App Name</div>
        <form onSubmit={handleSaveAppName} style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, minWidth: 260 }}>
          <input className="form-input" style={{ flex: 1, maxWidth: 320 }} value={appNameInput} onChange={e => setAppNameInput(e.target.value)} placeholder={currentAppName} />
          <button className="btn btn-primary btn-sm" disabled={appNameSaving || !appNameInput.trim() || appNameInput.trim() === currentAppName}>
            <Save size={13} /> {appNameSaving ? 'Saving…' : 'Save'}
          </button>
          {appNameSaved && <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 700 }}>Saved — live everywhere now</span>}
        </form>
        <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Shown platform-wide: sidebar, landing page, auth page, public forms.</span>
      </div>

      <div className="card" style={{ padding: '14px 18px', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 12, border: maintEnabled ? '1px solid #f59e0b60' : undefined, background: maintEnabled ? '#f59e0b0a' : undefined }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <Wrench size={16} style={{ color: maintEnabled ? '#b45309' : 'var(--ink-muted)' }} />
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase' }}>Maintenance Mode</div>
          <button className="btn btn-sm" style={{ background: maintEnabled ? '#f59e0b' : 'var(--bg-3)', color: maintEnabled ? '#fff' : 'var(--ink-soft)', border: 'none' }}
            disabled={maintSaving} onClick={handleToggleMaintenance}>
            <Power size={13} /> {maintEnabled ? 'ON — turn off' : 'OFF — turn on'}
          </button>
          {maintSaved && <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 700 }}>Saved — live everywhere now</span>}
          <span style={{ fontSize: 11, color: 'var(--ink-muted)', flex: 1, minWidth: 200 }}>
            Blocks every organization for every role except admin/ceo/hr (and platform super admins) with a full-page notice, applied instantly to any open session.
          </span>
        </div>
        <div style={{ fontSize: 10.5, color: serverIsSuperAdmin === true ? '#16a34a' : serverIsSuperAdmin === false ? '#dc2626' : 'var(--ink-muted)' }}>
          Server sees this session as platform super admin: <strong>{serverIsSuperAdmin === null ? 'checking…' : String(serverIsSuperAdmin)}</strong>
          {' · '}client profile.is_super_admin: <strong>{String(!!profile?.is_super_admin)}</strong>
          {serverIsSuperAdmin === false && <span> — this is why saving fails; sign out and back in, or check profiles.is_super_admin for this account.</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input className="form-input" style={{ flex: 1 }} value={maintMessage} onChange={e => setMaintMessage(e.target.value)}
            placeholder="Optional custom message shown to blocked users (default: generic maintenance notice)" />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input className="form-input" style={{ flex: 1 }} value={maintGifUrl} onChange={e => setMaintGifUrl(e.target.value)}
            placeholder="Optional GIF/image URL shown above the message (leave blank for the default icon)" />
          <button className="btn btn-outline btn-sm" disabled={maintSaving} onClick={handleSaveMaintMessage}><Save size={13} /> Save Message &amp; GIF</button>
        </div>
        {maintGifUrl && <img src={maintGifUrl} alt="" style={{ maxWidth: 120, maxHeight: 120, borderRadius: 8 }} onError={e => { e.currentTarget.style.display = 'none' }} />}
      </div>

      {/* Email notices to organisations (STEP233) — maintenance windows, product updates. Email only. */}
      {annNotice && <div className={`alert alert-${annNotice.type}`} style={{ marginBottom: 12 }}>{annNotice.text}</div>}
      <AnnouncementsSection orgId={null} profile={profile} orgs={liveOrgs}
        flash={(type, text) => { setAnnNotice({ type, text }); setTimeout(() => setAnnNotice(null), 6000) }} />

      {stats && (
        <>
          <div className="stats-grid" style={{ marginBottom: 12 }}>
            <StatCard label="Organizations" value={stats.total_orgs} icon={<Landmark size={17} />} accent="#6366f1" />
            <StatCard label="Active" value={stats.active_orgs} icon={<CheckCircle2 size={17} />} accent="#15803d" />
            <StatCard label="Trial" value={stats.trial_orgs} icon={<Clock size={17} />} accent="#b45309" />
            <StatCard label="Past Due" value={stats.past_due_orgs} icon={<XCircle size={17} />} accent="#dc2626" />
            <StatCard label="Suspended" value={stats.suspended_orgs} icon={<Ban size={17} />} accent="#64748b" />
          </div>
          <div className="stats-grid" style={{ marginBottom: 20 }}>
            <StatCard label="Total Users" value={stats.total_users} icon={<Users size={17} />} accent="#0ea5e9" />
            <StatCard label="Active Users" value={stats.active_users} icon={<UserCog size={17} />} accent="#0ea5e9" />
            <StatCard label="MRR" value={rupee(stats.mrr)} icon={<DollarSign size={17} />} accent="#6366f1" />
            <StatCard label="ARR" value={rupee(stats.arr)} icon={<TrendingUp size={17} />} accent="#4338ca" />
          </div>
          {planDist.length > 0 && (
            <div className="card" style={{ padding: '14px 18px', marginBottom: 20, display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase' }}>Plan Distribution</div>
              {planDist.map(p => (
                <div key={p.plan_key} style={{ fontSize: 13 }}><strong>{p.org_count}</strong> <span style={{ color: 'var(--ink-muted)' }}>{p.plan_name}</span></div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 20, marginTop: -8 }}>
            MRR/ARR reflect configured plan + module pricing, not confirmed-collected revenue from the gateways below.
          </div>
        </>
      )}

      {paymentProviders.length > 0 && (
        <div className="card" style={{ padding: '14px 18px', marginBottom: 20, display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase' }}><Power size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Payment Gateways</div>
          {paymentProviders.map(p => (
            <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: providerToggling === p.key ? 'wait' : 'pointer' }}>
              <input type="checkbox" checked={p.is_active} disabled={providerToggling === p.key} onChange={() => handleToggleProvider(p)} />
              {PROVIDER_LABEL[p.key] || p.name}
              <span style={{ fontSize: 11, color: p.is_active ? '#16a34a' : 'var(--ink-muted)' }}>{p.is_active ? 'enabled' : 'disabled'}</span>
            </label>
          ))}
          <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Disabling a gateway here blocks new charges platform-wide, immediately.</span>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => navigate('/super-admin/payment-setup')}>
            <KeyRound size={13} /> Configure API Keys
          </button>
        </div>
      )}

      {err && <Alert type="error" message={err} />}

      {liveOrgs.length === 0 ? <Empty message="No organizations yet" /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Organization</th><th>Slug</th><th>Members</th><th>Plan</th><th>Billing</th><th>Created</th><th>Active</th><th></th></tr></thead>
            <tbody>
              {liveOrgs.map(o => (
                <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/super-admin/organizations/${o.id}`)}>
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
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                    <button className="btn btn-primary btn-sm" onClick={() => navigate(`/super-admin/organizations/${o.id}`)}>View <ChevronRight size={13} /></button>
                    <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(o)}>
                      {o.is_active ? <><Ban size={13} /> Suspend</> : <><CheckCircle2 size={13} /> Reactivate</>}
                    </button>
                    <button className="btn btn-ghost btn-sm" style={{ color: o.is_active ? 'var(--ink-muted)' : '#ef4444' }}
                      disabled={o.is_active} title={o.is_active ? 'Suspend the organization before deleting it' : 'Delete this organization'}
                      onClick={() => openDelete(o)}>
                      <Trash2 size={13} /> Delete
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
                      <button className="btn btn-primary btn-sm" onClick={() => navigate(`/super-admin/organizations/${r.organization_id}?tab=billing`)}><CreditCard size={13} /> Review</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleDismissRequest(r.id)}><XCircle size={13} /> Dismiss</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ marginTop: 32 }}>
        <div className="page-subtitle" style={{ marginBottom: 10, fontWeight: 800, fontSize: '0.95rem', color: 'var(--ink)' }}>Pending Module Add-on Requests</div>
        {bundleRequests.filter(r => r.status === 'pending').length === 0 ? <Empty message="No pending requests" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Organization</th><th>Module</th><th>Action</th><th>Note</th><th>Requested</th><th></th></tr></thead>
              <tbody>
                {bundleRequests.filter(r => r.status === 'pending').map(r => (
                  <tr key={r.id}>
                    <td className="td-bold">{r.org_name}</td>
                    <td>{r.bundle_name}</td>
                    <td style={{ textTransform: 'capitalize' }}>{r.action}</td>
                    <td style={{ color: 'var(--ink-muted)' }}>{r.note || '—'}</td>
                    <td><Clock size={13} style={{ verticalAlign: -2, marginRight: 4 }} />{dateFmt(r.created_at)}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-primary btn-sm" disabled={bundleActionId === r.id} onClick={() => handleApproveBundleRequest(r)}>
                        {bundleActionId === r.id ? 'Applying…' : `Approve ${r.action === 'activate' ? 'Activation' : 'Deactivation'}`}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleDismissBundleRequest(r.id)}><XCircle size={13} /> Dismiss</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ marginTop: 32 }}>
        <div className="page-subtitle" style={{ marginBottom: 10, fontWeight: 800, fontSize: '0.95rem', color: 'var(--ink)' }}>Recent Transactions (all organizations)</div>
        {recentOrders.length === 0 ? <Empty message="No payment orders yet" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Organization</th><th>Provider</th><th>Amount</th><th>Status</th><th>Created</th><th>Paid</th></tr></thead>
              <tbody>
                {recentOrders.map(t => (
                  <tr key={t.id}>
                    <td className="td-bold">{t.org?.name || '—'}</td>
                    <td>{PROVIDER_LABEL[t.provider] || t.provider}</td>
                    <td>{rupee(t.amount)}</td>
                    <td><span style={{ color: ORDER_STATUS_COLOR[t.status] || 'var(--ink-muted)', fontWeight: 700, fontSize: 12, textTransform: 'capitalize' }}>{t.status}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{dateFmt(t.created_at)}</td>
                    <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{t.paid_at ? dateFmt(t.paid_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ marginTop: 32 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowArchived(s => !s)} style={{ marginBottom: 10 }}>
          <Archive size={13} /> {showArchived ? 'Hide' : 'Show'} Archived Organizations {archivedOrgs.length > 0 && `(${archivedOrgs.length})`}
        </button>
        {showArchived && (
          archivedOrgs.length === 0 ? <Empty message="No archived organizations" /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Organization</th><th>Slug</th><th>Deleted</th><th></th></tr></thead>
                <tbody>
                  {archivedOrgs.map(o => (
                    <tr key={o.id}>
                      <td className="td-bold">{o.name}</td>
                      <td style={{ color: 'var(--ink-muted)' }}>/{o.slug}</td>
                      <td>{dateFmt(o.deleted_at)}</td>
                      <td><button className="btn btn-ghost btn-sm" onClick={() => handleRestore(o)}><RotateCcw size={13} /> Restore</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {deleteOrg && (
        <Modal open title={`Delete ${deleteOrg.name}`} onClose={() => setDeleteOrg(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setDeleteOrg(null)}>Cancel</button>
            <button className="btn btn-primary" style={{ background: '#ef4444', borderColor: '#ef4444' }}
              disabled={deleting || deleteConfirmText !== deleteOrg.slug} onClick={handleConfirmDelete}>
              {deleting ? 'Deleting…' : 'Delete Organization'}
            </button>
          </>}>
          {err && <Alert type="error" message={err} />}
          <p style={{ marginBottom: 12, fontSize: '0.88rem' }}>
            This removes <strong>{deleteOrg.name}</strong> from every organization listing and blocks its members from
            signing in. Its data is kept (soft delete) and this can be undone from "Archived Organizations" later.
          </p>
          <label className="form-label">Type <strong>{deleteOrg.slug}</strong> to confirm</label>
          <input className="form-input" value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)} placeholder={deleteOrg.slug} autoFocus />
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
