import { useState, useEffect } from 'react'
import {
  listVendors, createVendorWithLogin, setVendorActive, updateVendorCommission,
  listVendorCommissions, setPromoterSettings, listVendorPayouts, processPayout,
  listPromoterApplications, approvePromoterApplication, rejectPromoterApplication,
} from '../lib/vendors'
import { rupee, dateFmt } from '../lib/supabase'
import { Loader, Empty, Alert, Modal, StatCard } from '../components/ui'
import { Briefcase, Plus, Ban, CheckCircle2, Wallet, Clock, Users, Receipt, Percent, XCircle, Inbox, Landmark } from 'lucide-react'
const PAYOUT_METHODS = { bank_transfer: 'Bank Transfer', upi: 'UPI', cheque: 'Cheque', other: 'Other' }

// Platform-level referral partner management (STEP134) — reachable only
// by profiles.is_super_admin, same posture as SuperAdminPage/Organizations.
// Named "Partners" (not "Vendors") on purpose: this app already has an
// unrelated procurement "Vendors" (suppliers) page — the underlying
// SQL/lib naming stays `vendors`/vendor_id (matches the DB), but the
// UI-facing term is kept distinct to avoid the two features reading as
// the same thing in the sidebar.
export default function PartnersPage() {
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', code: '', commissionType: 'percent', commissionRate: 10, email: '', tempPassword: '', fullName: '' })
  const [saving, setSaving] = useState(false)
  const [ledgerVendor, setLedgerVendor] = useState(null)
  const [ledger, setLedger] = useState([])
  const [payouts, setPayouts] = useState([])
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [payoutForm, setPayoutForm] = useState({ method: 'bank_transfer', reference: '', notes: '' })
  const [payoutSaving, setPayoutSaving] = useState(false)
  const [editingRate, setEditingRate] = useState(null) // vendor id being rate-edited
  const [promoterVendor, setPromoterVendor] = useState(null) // vendor whose promoter settings are being edited
  const [promoterForm, setPromoterForm] = useState(null)
  const [promoterSaving, setPromoterSaving] = useState(false)
  const [applications, setApplications] = useState([])
  const [reviewApp, setReviewApp] = useState(null) // application being reviewed, or null
  const [reviewForm, setReviewForm] = useState(null)
  const [reviewSaving, setReviewSaving] = useState(false)
  const [rejectingId, setRejectingId] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setErr('')
    try {
      const [v, a] = await Promise.all([listVendors(), listPromoterApplications()])
      setVendors(v); setApplications(a)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  function slugifyCode(name) { return name.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12) }

  async function handleCreate(e) {
    e.preventDefault(); setSaving(true); setErr('')
    try {
      await createVendorWithLogin(form)
      setShowCreate(false)
      setForm({ name: '', code: '', commissionType: 'percent', commissionRate: 10, email: '', tempPassword: '', fullName: '' })
      load()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  async function toggleActive(v) { await setVendorActive(v.id, !v.is_active); load() }

  async function saveRate(v, type, rate) {
    setEditingRate(null)
    try { await updateVendorCommission(v.id, { commissionType: type, commissionRate: rate }); load() }
    catch (e) { setErr(e.message) }
  }

  async function openLedger(v) {
    setLedgerVendor(v); setLedgerLoading(true); setErr(''); setSelectedIds(new Set()); setPayoutForm({ method: 'bank_transfer', reference: '', notes: '' })
    try {
      const [c, p] = await Promise.all([listVendorCommissions(v.id), listVendorPayouts(v.id)])
      setLedger(c); setPayouts(p)
    } catch (e) { setErr(e.message) }
    finally { setLedgerLoading(false) }
  }

  function toggleSelect(id) {
    setSelectedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function selectAllPending() {
    const pendingIds = ledger.filter(c => c.status === 'pending').map(c => c.id)
    setSelectedIds(new Set(pendingIds))
  }

  async function handleProcessPayout(e) {
    e.preventDefault(); setPayoutSaving(true); setErr('')
    try {
      await processPayout(ledgerVendor.id, [...selectedIds], payoutForm)
      const [c, p] = await Promise.all([listVendorCommissions(ledgerVendor.id), listVendorPayouts(ledgerVendor.id)])
      setLedger(c); setPayouts(p); setSelectedIds(new Set()); setPayoutForm({ method: 'bank_transfer', reference: '', notes: '' })
      load()
    } catch (e) { setErr(e.message) }
    finally { setPayoutSaving(false) }
  }

  function openPromoterSettings(v) {
    setPromoterVendor(v)
    setPromoterForm({ isPromoter: v.is_promoter, seatAllocation: v.promoter_seat_allocation ?? '', discountPercent: v.promoter_discount_percent })
  }

  async function handleSavePromoter(e) {
    e.preventDefault(); setPromoterSaving(true); setErr('')
    try {
      await setPromoterSettings(promoterVendor.id, promoterForm)
      setPromoterVendor(null); setPromoterForm(null); load()
    } catch (e) { setErr(e.message) }
    finally { setPromoterSaving(false) }
  }

  function openReview(app) {
    setReviewApp(app)
    setReviewForm({
      code: slugifyCode(app.company_name || app.full_name),
      tempPassword: '', seatAllocation: '', discountPercent: 20,
      commissionType: 'percent', commissionRate: 0,
    })
  }

  async function handleApprove(e) {
    e.preventDefault(); setReviewSaving(true); setErr('')
    try {
      await approvePromoterApplication(reviewApp.id, reviewForm)
      setReviewApp(null); setReviewForm(null); load()
    } catch (e) { setErr(e.message) }
    finally { setReviewSaving(false) }
  }

  async function handleReject(id) {
    setRejectingId(id); setErr('')
    try { await rejectPromoterApplication(id); load() }
    catch (e) { setErr(e.message) }
    finally { setRejectingId(null) }
  }

  if (loading) return <Loader />

  const totalPending = vendors.reduce((s, v) => s + Number(v.pending_commission || 0), 0)
  const totalPaid = vendors.reduce((s, v) => s + Number(v.paid_commission || 0), 0)
  const totalOrgs = vendors.reduce((s, v) => s + Number(v.referred_org_count || 0), 0)

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Briefcase size={22} /> Partners</div>
          <div className="page-subtitle">Referral partners promoting the platform under their own link and commission.</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} /> New Partner</button>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <StatCard label="Partners" value={vendors.length} icon={<Briefcase size={17} />} accent="#6366f1" />
        <StatCard label="Referred Organizations" value={totalOrgs} icon={<Users size={17} />} accent="#0ea5e9" />
        <StatCard label="Pending Commission" value={rupee(totalPending)} icon={<Clock size={17} />} accent="#f59e0b" />
        <StatCard label="Paid Out" value={rupee(totalPaid)} icon={<CheckCircle2 size={17} />} accent="#16a34a" />
      </div>

      {err && <Alert type="error" message={err} />}

      <div style={{ marginBottom: 28 }}>
        <div className="page-subtitle" style={{ marginBottom: 10, fontWeight: 800, fontSize: '0.95rem', color: 'var(--ink)' }}>
          <Inbox size={14} style={{ verticalAlign: -2, marginRight: 4 }} />Pending Promoter Applications
        </div>
        {applications.filter(a => a.status === 'pending').length === 0 ? <Empty message="No pending applications" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Email</th><th>Company</th><th>Message</th><th>Applied</th><th></th></tr></thead>
              <tbody>
                {applications.filter(a => a.status === 'pending').map(a => (
                  <tr key={a.id}>
                    <td className="td-bold">{a.full_name}</td>
                    <td style={{ color: 'var(--ink-muted)' }}>{a.email}{a.phone && ` · ${a.phone}`}</td>
                    <td>{a.company_name || '—'}</td>
                    <td style={{ color: 'var(--ink-muted)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.message}>{a.message || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{dateFmt(a.created_at)}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-primary btn-sm" onClick={() => openReview(a)}>Review</button>
                      <button className="btn btn-ghost btn-sm" disabled={rejectingId === a.id} onClick={() => handleReject(a.id)}><XCircle size={13} /> Reject</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {vendors.length === 0 ? <Empty message="No partners yet" /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Partner</th><th>Code</th><th>Commission</th><th>Promoter Pool</th><th>Referred Orgs</th><th>Pending</th><th>Paid</th><th>Active</th><th></th></tr></thead>
            <tbody>
              {vendors.map(v => (
                <tr key={v.id}>
                  <td className="td-bold">{v.name}</td>
                  <td style={{ fontFamily: 'monospace' }}>{v.code}</td>
                  <td>
                    {editingRate === v.id ? (
                      <RateEditor vendor={v} onSave={(type, rate) => saveRate(v, type, rate)} onCancel={() => setEditingRate(null)} />
                    ) : (
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditingRate(v.id)}>
                        {v.commission_type === 'percent' ? `${v.commission_rate}%` : rupee(v.commission_rate)}
                      </button>
                    )}
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => openPromoterSettings(v)}>
                      <Percent size={13} />
                      {v.is_promoter
                        ? ` ${v.promoter_seats_used}${v.promoter_seat_allocation != null ? ` / ${v.promoter_seat_allocation}` : ''} seats · ${v.promoter_discount_percent}% off`
                        : ' Not a promoter'}
                    </button>
                  </td>
                  <td>{v.referred_org_count}</td>
                  <td>{rupee(v.pending_commission)}</td>
                  <td>{rupee(v.paid_commission)}</td>
                  <td>{v.is_active ? <span style={{ color: '#16a34a', fontWeight: 700, fontSize: 12 }}>Active</span> : <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 12 }}>Disabled</span>}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => openLedger(v)}><Receipt size={13} /> Ledger</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(v)}>
                      {v.is_active ? <><Ban size={13} /> Disable</> : <><CheckCircle2 size={13} /> Enable</>}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <Modal open title="New Partner" onClose={() => setShowCreate(false)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCreate} disabled={saving || !form.name.trim() || !form.email.trim() || !form.tempPassword.trim()}>
              {saving ? 'Creating…' : 'Create Partner + Login'}
            </button>
          </>}>
          <form onSubmit={handleCreate}>
            {err && <Alert type="error" message={err} />}
            <div style={{ marginBottom: 12 }}>
              <label className="form-label">Partner / Vendor Name</label>
              <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value, code: f.code || slugifyCode(e.target.value) }))} placeholder="Acme Resellers" required autoFocus />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="form-label">Referral Code</label>
              <input className="form-input" style={{ fontFamily: 'monospace' }} value={form.code} onChange={e => setForm(f => ({ ...f, code: slugifyCode(e.target.value) }))} placeholder="ACMERESELLERS" required />
              <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 4 }}>Referral link will be: {window.location.origin}/?ref={form.code || 'CODE'}</div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label className="form-label">Commission Type</label>
                <select className="form-input" value={form.commissionType} onChange={e => setForm(f => ({ ...f, commissionType: e.target.value }))}>
                  <option value="percent">Percent of payment</option>
                  <option value="flat">Flat per payment</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label className="form-label">Rate {form.commissionType === 'percent' ? '(%)' : '(₹)'}</label>
                <input className="form-input" type="number" min={0} value={form.commissionRate} onChange={e => setForm(f => ({ ...f, commissionRate: e.target.value }))} />
              </div>
            </div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginBottom: 12 }}>
              <label className="form-label">Login — Full Name</label>
              <input className="form-input" value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} placeholder="Contact person's name" required style={{ marginBottom: 10 }} />
              <label className="form-label">Login Email</label>
              <input className="form-input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="partner@vendor.com" required style={{ marginBottom: 10 }} />
              <label className="form-label">Temporary Password</label>
              <input className="form-input" value={form.tempPassword} onChange={e => setForm(f => ({ ...f, tempPassword: e.target.value }))} placeholder="Share this with the partner" required />
            </div>
          </form>
        </Modal>
      )}

      {ledgerVendor && (
        <Modal open size="lg" title={`Commission Ledger — ${ledgerVendor.name}`} onClose={() => { setLedgerVendor(null); setLedger([]); setPayouts([]) }}
          footer={<button className="btn btn-primary" onClick={() => { setLedgerVendor(null); setLedger([]); setPayouts([]) }}>Done</button>}>
          {err && <Alert type="error" message={err} />}
          {ledgerLoading ? <Loader /> : (
            <>
              {ledger.length === 0 ? <Empty message="No commission entries yet" /> : (
                <div className="table-wrap" style={{ marginBottom: 18 }}>
                  <table>
                    <thead><tr><th></th><th>Organization</th><th>Amount</th><th>Status</th><th>Earned</th><th>Payout</th></tr></thead>
                    <tbody>
                      {ledger.map(c => (
                        <tr key={c.id}>
                          <td>{c.status === 'pending' && <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSelect(c.id)} />}</td>
                          <td className="td-bold">{c.org?.name || '—'}</td>
                          <td>{rupee(c.amount)}</td>
                          <td>{c.status === 'paid' ? <span style={{ color: '#16a34a', fontWeight: 700, fontSize: 12 }}>Paid</span> : <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 12 }}>Pending</span>}</td>
                          <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{dateFmt(c.created_at)}</td>
                          <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                            {c.payout_id ? payouts.find(p => p.id === c.payout_id)?.reference_number || PAYOUT_METHODS[payouts.find(p => p.id === c.payout_id)?.method] || 'Paid out' : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {ledger.some(c => c.status === 'pending') && (
                <form onSubmit={handleProcessPayout} className="card" style={{ padding: '14px 16px', marginBottom: 18, background: 'var(--surface-2, rgba(99,102,241,.06))' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>
                      {selectedIds.size} selected — {rupee(ledger.filter(c => selectedIds.has(c.id)).reduce((s, c) => s + Number(c.amount), 0))}
                    </div>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={selectAllPending}>Select All Pending</button>
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                    <select className="form-input" style={{ flex: '1 1 140px' }} value={payoutForm.method} onChange={e => setPayoutForm(f => ({ ...f, method: e.target.value }))}>
                      {Object.entries(PAYOUT_METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                    <input className="form-input" style={{ flex: '1 1 160px' }} placeholder="Reference / transaction ID" value={payoutForm.reference} onChange={e => setPayoutForm(f => ({ ...f, reference: e.target.value }))} />
                    <input className="form-input" style={{ flex: '2 1 200px' }} placeholder="Notes (optional)" value={payoutForm.notes} onChange={e => setPayoutForm(f => ({ ...f, notes: e.target.value }))} />
                  </div>
                  <button className="btn btn-primary btn-sm" disabled={selectedIds.size === 0 || payoutSaving}>
                    {payoutSaving ? 'Processing…' : `Process Payout${selectedIds.size > 0 ? ` (${rupee(ledger.filter(c => selectedIds.has(c.id)).reduce((s, c) => s + Number(c.amount), 0))})` : ''}`}
                  </button>
                </form>
              )}

              <div style={{ fontWeight: 800, fontSize: '0.9rem', marginBottom: 8 }}><Landmark size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Payout History</div>
              {payouts.length === 0 ? <Empty message="No payouts processed yet" /> : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Amount</th><th>Method</th><th>Reference</th><th>Notes</th><th>Paid</th></tr></thead>
                    <tbody>
                      {payouts.map(p => (
                        <tr key={p.id}>
                          <td className="td-bold">{rupee(p.amount)}</td>
                          <td>{PAYOUT_METHODS[p.method] || p.method}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.reference_number || '—'}</td>
                          <td style={{ color: 'var(--ink-muted)', fontSize: 12 }}>{p.notes || '—'}</td>
                          <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{dateFmt(p.paid_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Modal>
      )}

      {promoterVendor && promoterForm && (
        <Modal open title={`Promoter Settings — ${promoterVendor.name}`} onClose={() => { setPromoterVendor(null); setPromoterForm(null) }}
          footer={<>
            <button className="btn btn-ghost" onClick={() => { setPromoterVendor(null); setPromoterForm(null) }}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSavePromoter} disabled={promoterSaving}>{promoterSaving ? 'Saving…' : 'Save'}</button>
          </>}>
          <form onSubmit={handleSavePromoter}>
            {err && <Alert type="error" message={err} />}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, cursor: 'pointer' }}>
              <input type="checkbox" checked={promoterForm.isPromoter} onChange={e => setPromoterForm(f => ({ ...f, isPromoter: e.target.checked }))} />
              <span className="form-label" style={{ margin: 0 }}>Mark as Promoter</span>
            </label>
            <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8, marginBottom: 14 }}>
              A promoter's referred orgs get a discount on every payment, drawn from a shared seat pool. This is separate from — and stacks with — commission above.
            </p>
            <div style={{ display: 'flex', gap: 12, marginBottom: 4 }}>
              <div style={{ flex: 1 }}>
                <label className="form-label">Seat Allocation (blank = uncapped)</label>
                <input className="form-input" type="number" min={0} value={promoterForm.seatAllocation} disabled={!promoterForm.isPromoter}
                  onChange={e => setPromoterForm(f => ({ ...f, seatAllocation: e.target.value }))} placeholder="e.g. 100" />
              </div>
              <div style={{ flex: 1 }}>
                <label className="form-label">Discount %</label>
                <input className="form-input" type="number" min={0} max={100} value={promoterForm.discountPercent} disabled={!promoterForm.isPromoter}
                  onChange={e => setPromoterForm(f => ({ ...f, discountPercent: e.target.value }))} placeholder="e.g. 20" />
              </div>
            </div>
            {promoterVendor.is_promoter && (
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 10 }}>
                Currently used: {promoterVendor.promoter_seats_used} seat{promoterVendor.promoter_seats_used === 1 ? '' : 's'} across {promoterVendor.referred_org_count} referred org{promoterVendor.referred_org_count === 1 ? '' : 's'}.
              </p>
            )}
          </form>
        </Modal>
      )}

      {reviewApp && reviewForm && (
        <Modal open title={`Approve — ${reviewApp.full_name}`} onClose={() => { setReviewApp(null); setReviewForm(null) }}
          footer={<>
            <button className="btn btn-ghost" onClick={() => { setReviewApp(null); setReviewForm(null) }}>Cancel</button>
            <button className="btn btn-primary" onClick={handleApprove} disabled={reviewSaving || !reviewForm.code.trim() || !reviewForm.tempPassword.trim()}>
              {reviewSaving ? 'Approving…' : 'Approve & Create Login'}
            </button>
          </>}>
          <form onSubmit={handleApprove}>
            {err && <Alert type="error" message={err} />}
            <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 14 }}>
              {reviewApp.full_name} ({reviewApp.email}){reviewApp.company_name && <> from <strong>{reviewApp.company_name}</strong></>}
              {reviewApp.message && <><br /><em>"{reviewApp.message}"</em></>}
            </p>
            <div style={{ marginBottom: 12 }}>
              <label className="form-label">Referral Code</label>
              <input className="form-input" style={{ fontFamily: 'monospace' }} value={reviewForm.code} onChange={e => setReviewForm(f => ({ ...f, code: slugifyCode(e.target.value) }))} required />
              <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 4 }}>Referral link: {window.location.origin}/?ref={reviewForm.code || 'CODE'}</div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label className="form-label">Seat Allocation (blank = uncapped)</label>
                <input className="form-input" type="number" min={0} value={reviewForm.seatAllocation} onChange={e => setReviewForm(f => ({ ...f, seatAllocation: e.target.value }))} placeholder="e.g. 100" />
              </div>
              <div style={{ flex: 1 }}>
                <label className="form-label">Discount %</label>
                <input className="form-input" type="number" min={0} max={100} value={reviewForm.discountPercent} onChange={e => setReviewForm(f => ({ ...f, discountPercent: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label className="form-label">Commission Type</label>
                <select className="form-input" value={reviewForm.commissionType} onChange={e => setReviewForm(f => ({ ...f, commissionType: e.target.value }))}>
                  <option value="percent">Percent of payment</option>
                  <option value="flat">Flat per payment</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label className="form-label">Commission Rate (0 = none)</label>
                <input className="form-input" type="number" min={0} value={reviewForm.commissionRate} onChange={e => setReviewForm(f => ({ ...f, commissionRate: e.target.value }))} />
              </div>
            </div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <label className="form-label">Temporary Password for their login</label>
              <input className="form-input" value={reviewForm.tempPassword} onChange={e => setReviewForm(f => ({ ...f, tempPassword: e.target.value }))} placeholder="Share this with the applicant" required />
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

function RateEditor({ vendor, onSave, onCancel }) {
  const [type, setType] = useState(vendor.commission_type)
  const [rate, setRate] = useState(vendor.commission_rate)
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <select className="form-input" style={{ fontSize: 11, padding: '2px 4px', width: 70 }} value={type} onChange={e => setType(e.target.value)}>
        <option value="percent">%</option>
        <option value="flat">₹ flat</option>
      </select>
      <input className="form-input" style={{ fontSize: 11, padding: '2px 4px', width: 60 }} type="number" min={0} value={rate} onChange={e => setRate(e.target.value)} />
      <button className="btn btn-primary btn-sm" style={{ padding: '2px 6px' }} onClick={() => onSave(type, rate)}>✓</button>
      <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px' }} onClick={onCancel}>✕</button>
    </div>
  )
}
