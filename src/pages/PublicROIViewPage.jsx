import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { getPublicCustomerView } from '../lib/roiEconomics'
import { fvAmount, fvSourceLabel, fvSourceColor } from '../lib/financialValue'
import { rupee, dateFmt } from '../lib/supabase'
import { useAppName } from '../context/BrandingContext'

const SCENARIO_LABEL = { conservative: 'Conservative', expected: 'Expected', aggressive: 'Aggressive' }
const SCENARIO_COLOR = { conservative: '#e11d48', expected: '#3b82f6', aggressive: '#10b981' }

function Badge({ value }) {
  if (!value) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', color: fvSourceColor(value) }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: fvSourceColor(value) }} />
      {fvSourceLabel(value)}
      {value.updated_at && <span style={{ color: '#94a3b8', fontWeight: 500, textTransform: 'none' }}>· {dateFmt(value.updated_at)}</span>}
    </span>
  )
}

/**
 * Public, unauthenticated ROI Customer View — reached via a durable secret
 * link (roi_customer_portal_link), same standalone-page pattern as
 * PublicLeadFormPage.jsx. Every figure on this page comes from
 * get_roi_customer_view_public(), a SECURITY DEFINER RPC that whitelists
 * fields explicitly — there is no code path here that could render
 * delivery_cost/gross_profit/internal_roi_pct even by mistake, because
 * this component never receives them in the first place.
 */
export default function PublicROIViewPage() {
  const { token } = useParams()
  const appName = useAppName()
  const [data, setData] = useState(undefined) // undefined = loading, null = not found

  useEffect(() => { getPublicCustomerView(token).then(setData).catch(() => setData(null)) }, [token])

  if (data === undefined) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}><div className="spinner" /></div>
  }
  if (data === null) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
        <div style={{ textAlign: 'center', color: '#64748b' }}>This link isn't available. It may have been deactivated or regenerated.</div>
      </div>
    )
  }

  const { proposal, investment_lines, benefit_drivers, results_by_scenario, npv_irr } = data
  const active = results_by_scenario[proposal.active_scenario]
  const totalInvestment = investment_lines.reduce((s, l) => s + fvAmount(l.amount), 0)
  const totalRealized = benefit_drivers.reduce((s, b) => s + fvAmount(b.realized_value), 0)

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: "'Plus Jakarta Sans',sans-serif", padding: '32px 16px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 22, fontWeight: 800 }}>{appName}</div>
          <div style={{ color: '#64748b', fontSize: 12.5 }}>ROI Summary</div>
        </div>

        <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #e2e8f0', boxShadow: '0 4px 24px rgba(0,0,0,.06)', padding: 28, marginBottom: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 4 }}>{proposal.name}</div>
          <div style={{ color: '#64748b', fontSize: 13, marginBottom: 20 }}>
            Planned implementation: {proposal.duration_months} months · Scenario: <span style={{ fontWeight: 700, color: SCENARIO_COLOR[proposal.active_scenario] }}>{SCENARIO_LABEL[proposal.active_scenario]}</span>
          </div>

          {active && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 16, marginBottom: 24 }}>
              {[
                ['Your Investment', rupee(active.customer_investment), '#0ea5e9'],
                ['Net Benefit', rupee(active.customer_net_benefit), '#10b981'],
                ['ROI %', `${active.customer_roi_pct}%`, '#6366f1'],
                ['Payback', `${active.customer_payback_months} months`, '#f59e0b'],
              ].map(([l, v, c]) => (
                <div key={l} style={{ background: '#f8fafc', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>{l}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: c }}>{v}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Your Investment</div>
          <div style={{ overflowX: 'auto', marginBottom: 20 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['Category', 'Item', 'Timing', 'Amount', 'Source'].map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, textTransform: 'uppercase', color: '#94a3b8', borderBottom: '1px solid #e2e8f0' }}>{h}</th>)}</tr></thead>
              <tbody>{investment_lines.map((l, i) => (
                <tr key={i}>
                  <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9', textTransform: 'capitalize' }}>{l.category}</td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>{l.name}</td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9', textTransform: 'capitalize' }}>{l.timing.replace('_', ' ')}</td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9', fontWeight: 700 }}>{rupee(fvAmount(l.amount))}</td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}><Badge value={l.amount} /></td>
                </tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={3} style={{ padding: '8px', fontWeight: 700 }}>Total</td><td style={{ padding: '8px', fontWeight: 800 }}>{rupee(totalInvestment)}</td><td /></tr></tfoot>
            </table>
          </div>

          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Your Realized Benefits</div>
          <div style={{ overflowX: 'auto', marginBottom: 20 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>{['Category', 'Benefit', 'Potential', 'Capture %', 'Realized', 'Source'].map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, textTransform: 'uppercase', color: '#94a3b8', borderBottom: '1px solid #e2e8f0' }}>{h}</th>)}</tr></thead>
              <tbody>{benefit_drivers.map((b, i) => (
                <tr key={i}>
                  <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9', textTransform: 'capitalize' }}>{b.category.replace('_', ' ')}</td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>{b.name}</td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>{rupee(fvAmount(b.potential_value))}</td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>{b.capture_rate_pct}%</td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9', fontWeight: 700, color: '#10b981' }}>{rupee(fvAmount(b.realized_value))}</td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}><Badge value={b.realized_value} /></td>
                </tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={4} style={{ padding: '8px', fontWeight: 700 }}>Total</td><td style={{ padding: '8px', fontWeight: 800, color: '#10b981' }}>{rupee(totalRealized)}</td><td /></tr></tfoot>
            </table>
          </div>

          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Scenario Comparison</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 20 }}>
            {Object.entries(results_by_scenario).map(([sc, r]) => (
              <div key={sc} style={{ border: `1.5px solid ${sc === proposal.active_scenario ? SCENARIO_COLOR[sc] : '#e2e8f0'}`, borderRadius: 10, padding: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: SCENARIO_COLOR[sc], marginBottom: 6 }}>{SCENARIO_LABEL[sc]}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>ROI</div>
                <div style={{ fontWeight: 800, fontSize: 15 }}>{r.customer_roi_pct}%</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Payback</div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{r.customer_payback_months} mo</div>
              </div>
            ))}
          </div>

          {npv_irr.length > 0 && (
            <>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Multi-Year Value Projection</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
                {npv_irr.map((n, i) => (
                  <div key={i} style={{ background: '#f8fafc', borderRadius: 10, padding: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 12, textTransform: 'capitalize', marginBottom: 6 }}>{n.scenario} · {n.horizon_years}yr</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>NPV</div>
                    <div style={{ fontWeight: 800 }}>{rupee(n.npv)}</div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>IRR</div>
                    <div style={{ fontWeight: 700 }}>{n.irr_pct != null ? `${n.irr_pct}%` : '—'}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8' }}>
          Figures are modeled estimates based on inputs captured for this proposal — not a guarantee of results.
        </div>
      </div>
    </div>
  )
}
