import { useState, useEffect } from 'react'
import { getMyVendorInfo, listMyReferredOrganizations, listMyCommissions, getMySeatPoolStatus, listMyPayouts } from '../lib/vendors'
import { useAuth } from '../context/AuthContext'
import { rupee, dateFmt } from '../lib/supabase'
import { Loader, Empty, Alert, StatCard } from '../components/ui'
import { Briefcase, Link2, Users, Wallet, Clock, CheckCircle2, LogOut, Copy, Percent, Landmark } from 'lucide-react'

const STATUS_LABEL = { trialing: 'Trial', active: 'Active', past_due: 'Past Due', canceled: 'Canceled' }
const STATUS_COLOR = { trialing: '#f59e0b', active: '#16a34a', past_due: '#ef4444', canceled: '#94a3b8' }
const PAYOUT_METHODS = { bank_transfer: 'Bank Transfer', upi: 'UPI', cheque: 'Cheque', other: 'Other' }

// Full-page dashboard for a vendor/reseller account (STEP134) — this is
// the ONLY thing a vendor account ever sees (App.jsx routes every path
// here for a profile with vendor_id set). No sidebar, no access to the
// normal org-scoped app — a vendor is an external partner, not an
// employee of any organization on this platform.
export default function VendorDashboardPage() {
  const { signOut } = useAuth()
  const [vendor, setVendor] = useState(null)
  const [orgs, setOrgs] = useState([])
  const [commissions, setCommissions] = useState([])
  const [pool, setPool] = useState(null)
  const [payouts, setPayouts] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setErr('')
    try {
      const [v, o, c, p, pay] = await Promise.all([
        getMyVendorInfo(), listMyReferredOrganizations(), listMyCommissions(), getMySeatPoolStatus().catch(() => null), listMyPayouts(),
      ])
      setVendor(v); setOrgs(o); setCommissions(c); setPool(p); setPayouts(pay)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  function copyLink() {
    const link = `${window.location.origin}/?ref=${vendor.code}`
    navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  if (loading) return <Loader />
  if (!vendor) return <div style={{ padding: 40 }}><Alert type="error" message="This account isn't linked to an active vendor record. Contact the platform team." /></div>

  const pending = commissions.filter(c => c.status === 'pending').reduce((s, c) => s + Number(c.amount), 0)
  const paid = commissions.filter(c => c.status === 'paid').reduce((s, c) => s + Number(c.amount), 0)
  const referralLink = `${window.location.origin}/?ref=${vendor.code}`

  const byOrg = {}
  commissions.forEach(c => {
    const name = c.org?.name || 'Unknown organization'
    if (!byOrg[name]) byOrg[name] = { earned: 0, count: 0 }
    byOrg[name].earned += Number(c.amount)
    byOrg[name].count += 1
  })
  const orgBreakdown = Object.entries(byOrg).sort((a, b) => b[1].earned - a[1].earned)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #f8fafc)', padding: '32px 24px' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}><Briefcase size={22} /> {vendor.name}</div>
            <div style={{ color: 'var(--ink-muted)', fontSize: 13 }}>Partner dashboard — referrals and commission for your account only.</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={signOut}><LogOut size={13} /> Sign Out</button>
        </div>

        {err && <Alert type="error" message={err} />}

        <div className="card" style={{ padding: '16px 20px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <Link2 size={18} style={{ color: 'var(--ink-muted)' }} />
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 11, color: 'var(--ink-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 3 }}>Your Referral Link</div>
            <div style={{ fontFamily: 'monospace', fontSize: 13.5 }}>{referralLink}</div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={copyLink}><Copy size={13} /> {copied ? 'Copied!' : 'Copy'}</button>
          <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
            {vendor.commission_type === 'percent' ? `${vendor.commission_rate}% commission per paid renewal` : `${rupee(vendor.commission_rate)} per paid renewal`}
          </span>
        </div>

        <div className="stats-grid" style={{ marginBottom: pool?.is_promoter ? 16 : 28 }}>
          <StatCard label="Referred Organizations" value={orgs.length} icon={<Users size={17} />} accent="#6366f1" />
          <StatCard label="Pending Commission" value={rupee(pending)} icon={<Clock size={17} />} accent="#f59e0b" />
          <StatCard label="Paid Out" value={rupee(paid)} icon={<CheckCircle2 size={17} />} accent="#16a34a" />
          <StatCard label="Lifetime Earned" value={rupee(pending + paid)} icon={<Wallet size={17} />} accent="#4338ca" />
        </div>

        {pool?.is_promoter && (
          <div className="card" style={{ padding: '16px 20px', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <Percent size={18} style={{ color: 'var(--ink-muted)' }} />
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 11, color: 'var(--ink-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 3 }}>Promoter Discount Pool</div>
              <div style={{ fontSize: 14 }}>
                <strong>{pool.discount_percent}% off</strong> every payment for orgs you refer —
                {pool.seat_allocation != null ? (
                  <> <strong>{pool.seats_used} / {pool.seat_allocation}</strong> seats used</>
                ) : (
                  <> uncapped seat pool</>
                )}
              </div>
            </div>
            {pool.seat_allocation != null && (
              <div style={{ width: 160, height: 8, borderRadius: 999, background: 'var(--surface-2, rgba(99,102,241,.1))', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, (pool.seats_used / Math.max(1, pool.seat_allocation)) * 100)}%`, background: pool.seats_used >= pool.seat_allocation ? '#ef4444' : '#8b5cf6' }} />
              </div>
            )}
          </div>
        )}

        <div style={{ marginBottom: 28 }}>
          <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: 10 }}>Your Referred Organizations</div>
          {orgs.length === 0 ? <Empty message="No signups yet — share your referral link above" /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Organization</th><th>Plan</th><th>Status</th><th>Members</th><th>Signed Up</th></tr></thead>
                <tbody>
                  {orgs.map(o => (
                    <tr key={o.id}>
                      <td className="td-bold">{o.name}</td>
                      <td>{o.plan_key}</td>
                      <td><span style={{ color: STATUS_COLOR[o.billing_status] || 'var(--ink-muted)', fontWeight: 700, fontSize: 12 }}>{STATUS_LABEL[o.billing_status] || o.billing_status}</span></td>
                      <td>{o.member_count}</td>
                      <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{dateFmt(o.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {orgBreakdown.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: 10 }}>Earnings by Organization</div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Organization</th><th>Commissions</th><th>Total Earned</th></tr></thead>
                <tbody>
                  {orgBreakdown.map(([name, d]) => (
                    <tr key={name}>
                      <td className="td-bold">{name}</td>
                      <td>{d.count}</td>
                      <td>{rupee(d.earned)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div style={{ marginBottom: 28 }}>
          <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: 10 }}>Commission History</div>
          {commissions.length === 0 ? <Empty message="No commission earned yet — it accrues automatically when a referred org pays" /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Organization</th><th>Amount</th><th>Status</th><th>Earned</th><th>Paid</th></tr></thead>
                <tbody>
                  {commissions.map(c => (
                    <tr key={c.id}>
                      <td className="td-bold">{c.org?.name || '—'}</td>
                      <td>{rupee(c.amount)}</td>
                      <td>{c.status === 'paid' ? <span style={{ color: '#16a34a', fontWeight: 700, fontSize: 12 }}>Paid</span> : <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 12 }}>Pending</span>}</td>
                      <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{dateFmt(c.created_at)}</td>
                      <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{c.paid_at ? dateFmt(c.paid_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: 10 }}><Landmark size={15} style={{ verticalAlign: -2, marginRight: 4 }} />Payout History</div>
          {payouts.length === 0 ? <Empty message="No payouts yet — you'll see the method and reference for each one here once processed" /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Amount</th><th>Method</th><th>Reference</th><th>Paid</th></tr></thead>
                <tbody>
                  {payouts.map(p => (
                    <tr key={p.id}>
                      <td className="td-bold">{rupee(p.amount)}</td>
                      <td>{PAYOUT_METHODS[p.method] || p.method}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.reference_number || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{dateFmt(p.paid_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
