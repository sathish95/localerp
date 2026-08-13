import { useState, useEffect, useMemo } from 'react'
import { listAllPlans, updatePlanPricing } from '../lib/billing'
import { listBundles, superAdminListAllBundles, updateBundlePricing } from '../lib/billingBundles'
import { rupee } from '../lib/supabase'
import { Loader, Alert } from '../components/ui'
import { Calculator, Tag, Layers, Save } from 'lucide-react'

// Platform pricing console + quote calculator (STEP131). Two jobs in one
// place because the calculator is meaningless until an admin has set
// real prices here first: "Module & Plan Pricing" (editable — writes
// billing_plans/billing_bundles directly) feeds "Estimate a Quote"
// (read-only math, no org required — useful for quoting a prospect
// before they even have an organization row).
export default function EstimationPage() {
  const [plans, setPlans] = useState([])
  const [bundles, setBundles] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [savingKey, setSavingKey] = useState(null)

  const [calcPlanKey, setCalcPlanKey] = useState('')
  const [calcCycle, setCalcCycle] = useState('monthly')
  const [calcSeats, setCalcSeats] = useState(10)
  const [calcBundleKeys, setCalcBundleKeys] = useState(new Set())

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setErr('')
    try {
      const [p, b] = await Promise.all([listAllPlans(), superAdminListAllBundles()])
      setPlans(p); setBundles(b)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  function updatePlanField(key, field, value) {
    setPlans(ps => ps.map(p => p.key === key ? { ...p, [field]: value } : p))
  }
  function updateBundleField(key, field, value) {
    setBundles(bs => bs.map(b => b.key === key ? { ...b, [field]: value } : b))
  }

  async function savePlan(p) {
    setSavingKey('plan:' + p.key); setErr('')
    try {
      await updatePlanPricing(p.key, {
        priceMonthly: p.price_monthly === '' ? null : Number(p.price_monthly),
        priceYearly: p.price_yearly === '' ? null : Number(p.price_yearly),
        seatLimit: p.seat_limit === '' || p.seat_limit == null ? null : Number(p.seat_limit),
        isActive: p.is_active,
        trialDays: p.trial_days === '' || p.trial_days == null ? 0 : Number(p.trial_days),
      })
    } catch (e) { setErr(e.message) }
    finally { setSavingKey(null) }
  }

  async function saveBundle(b) {
    setSavingKey('bundle:' + b.key); setErr('')
    try {
      await updateBundlePricing(b.key, {
        pricePerSeatMonthly: Number(b.price_per_seat_monthly) || 0,
        pricePerSeatYearly: Number(b.price_per_seat_yearly) || 0,
        isActive: b.is_active,
      })
    } catch (e) { setErr(e.message) }
    finally { setSavingKey(null) }
  }

  function toggleCalcBundle(key) {
    setCalcBundleKeys(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  const activeBundles = bundles.filter(b => b.is_active)
  const calcPlan = plans.find(p => p.key === calcPlanKey)
  const seats = Math.max(1, Number(calcSeats) || 0)

  const breakdown = useMemo(() => {
    const rows = []
    if (calcPlan) {
      const price = calcCycle === 'yearly' ? calcPlan.price_yearly : calcPlan.price_monthly
      rows.push({ label: `${calcPlan.name} plan`, price: price ?? null, isFlat: true })
    }
    activeBundles.filter(b => calcBundleKeys.has(b.key)).forEach(b => {
      const perSeat = calcCycle === 'yearly' ? b.price_per_seat_yearly : b.price_per_seat_monthly
      rows.push({ label: b.name, perSeat, price: perSeat * seats, isFlat: false })
    })
    return rows
  }, [calcPlan, calcCycle, calcBundleKeys, activeBundles, seats])

  const total = breakdown.reduce((sum, r) => sum + (r.price || 0), 0)
  const hasContactSales = breakdown.some(r => r.price == null)

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Calculator size={22} /> Estimation</div>
          <div className="page-subtitle">Set what each plan and module costs, then quote it — used for prospects and reviewing an org's own estimate.</div>
        </div>
      </div>

      {err && <Alert type="error" message={err} />}

      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}><Tag size={16} /> Plan Pricing</h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--ink-muted)', marginBottom: 12 }}>Seat-tier plans (Settings → Billing and the super-admin console read these). Trial Days is applied automatically when someone signs up from the landing page's estimator with this plan selected.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Plan</th><th>Seat Limit</th><th>Price / mo</th><th>Price / yr</th><th>Trial Days</th><th>Active</th><th></th></tr></thead>
            <tbody>
              {plans.map(p => (
                <tr key={p.key}>
                  <td className="td-bold">{p.name}</td>
                  <td><input className="form-input" style={{ width: 90 }} type="number" min={0} value={p.seat_limit ?? ''} placeholder="∞" onChange={e => updatePlanField(p.key, 'seat_limit', e.target.value === '' ? null : e.target.value)} /></td>
                  <td><input className="form-input" style={{ width: 110 }} type="number" min={0} value={p.price_monthly ?? ''} placeholder="Contact sales" onChange={e => updatePlanField(p.key, 'price_monthly', e.target.value)} /></td>
                  <td><input className="form-input" style={{ width: 110 }} type="number" min={0} value={p.price_yearly ?? ''} placeholder="Contact sales" onChange={e => updatePlanField(p.key, 'price_yearly', e.target.value)} /></td>
                  <td><input className="form-input" style={{ width: 80 }} type="number" min={0} value={p.trial_days ?? 0} placeholder="0 = none" onChange={e => updatePlanField(p.key, 'trial_days', e.target.value)} /></td>
                  <td><input type="checkbox" checked={p.is_active} onChange={e => updatePlanField(p.key, 'is_active', e.target.checked)} /></td>
                  <td><button className="btn btn-primary btn-sm" disabled={savingKey === 'plan:' + p.key} onClick={() => savePlan(p)}><Save size={13} /> {savingKey === 'plan:' + p.key ? 'Saving…' : 'Save'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}><Layers size={16} /> Module Pricing</h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--ink-muted)', marginBottom: 12 }}>À-la-carte add-on bundles, priced per seat. Deactivating one here also removes it from every org's "Modules & Add-ons" picker.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Module</th><th>Price / seat / mo</th><th>Price / seat / yr</th><th>Active</th><th></th></tr></thead>
            <tbody>
              {bundles.map(b => (
                <tr key={b.key}>
                  <td className="td-bold">{b.name}</td>
                  <td><input className="form-input" style={{ width: 110 }} type="number" min={0} value={b.price_per_seat_monthly} onChange={e => updateBundleField(b.key, 'price_per_seat_monthly', e.target.value)} /></td>
                  <td><input className="form-input" style={{ width: 110 }} type="number" min={0} value={b.price_per_seat_yearly} onChange={e => updateBundleField(b.key, 'price_per_seat_yearly', e.target.value)} /></td>
                  <td><input type="checkbox" checked={b.is_active} onChange={e => updateBundleField(b.key, 'is_active', e.target.checked)} /></td>
                  <td><button className="btn btn-primary btn-sm" disabled={savingKey === 'bundle:' + b.key} onClick={() => saveBundle(b)}><Save size={13} /> {savingKey === 'bundle:' + b.key ? 'Saving…' : 'Save'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 4 }}>Estimate a Quote</h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--ink-muted)', marginBottom: 14 }}>Pick a plan and modules to see the estimated bill — same pricing this org (or a prospect) would see.</p>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <label className="form-label">Plan (optional)</label>
            <select className="form-input" value={calcPlanKey} onChange={e => setCalcPlanKey(e.target.value)}>
              <option value="">No plan — modules only</option>
              {plans.filter(p => p.is_active).map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Billing Cycle</label>
            <select className="form-input" value={calcCycle} onChange={e => setCalcCycle(e.target.value)}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          <div>
            <label className="form-label">Seats</label>
            <input className="form-input" style={{ width: 100 }} type="number" min={1} value={calcSeats} onChange={e => setCalcSeats(e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, marginBottom: 20 }}>
          {activeBundles.map(b => (
            <label key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer' }}>
              <input type="checkbox" checked={calcBundleKeys.has(b.key)} onChange={() => toggleCalcBundle(b.key)} />
              {b.name}
              <span style={{ marginLeft: 'auto', color: 'var(--ink-muted)', fontSize: 12 }}>{rupee(calcCycle === 'yearly' ? b.price_per_seat_yearly : b.price_per_seat_monthly)}/seat</span>
            </label>
          ))}
        </div>

        <div className="card" style={{ padding: '18px 20px', maxWidth: 420 }}>
          {breakdown.length === 0 ? (
            <div style={{ color: 'var(--ink-muted)', fontSize: 13 }}>Select a plan or at least one module to see an estimate.</div>
          ) : (
            <>
              {breakdown.map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                  <span>{r.label}{!r.isFlat && <span style={{ color: 'var(--ink-muted)' }}> × {seats} seats</span>}</span>
                  <span>{r.price == null ? 'Contact sales' : rupee(r.price)}</span>
                </div>
              ))}
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 10, display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
                <span>Estimated {calcCycle === 'yearly' ? 'yearly' : 'monthly'} total</span>
                <span>{hasContactSales ? `${rupee(total)} + custom` : rupee(total)}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
