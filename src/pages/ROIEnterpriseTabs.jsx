import { useState, useEffect } from 'react'
import { supabase, rupee, dateFmt } from '../lib/supabase'
import { Alert, Empty, Loader, StatusBadge, FieldLabel } from '../components/ui'
import * as econ from '../lib/roiEconomics'
import * as roi from '../lib/roiProposals'
import { fvAmount, fvSourceLabel, fvSourceColor } from '../lib/financialValue'
import { RefreshCw, Plus, Play, Link2, Copy } from 'lucide-react'

const th = { padding: '8px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }
const td = { padding: '10px 14px', fontSize: 12.5, borderBottom: '1px solid var(--border)' }
const label = { display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 5 }
const SCENARIOS = ['conservative', 'expected', 'aggressive']
const SCENARIO_COLOR = { conservative: '#e11d48', expected: '#3b82f6', aggressive: '#10b981' }

function Stat({ label: l, value, accent }) {
  return <div><div style={label}>{l}</div><div style={{ fontSize: 16, fontWeight: 800, color: accent }}>{value}</div></div>
}

/** Small source-tag badge — the trust mechanism the brief calls for on every FinancialValue. */
export function FVBadge({ value }) {
  if (!value) return <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Not set</span>
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', color: fvSourceColor(value) }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: fvSourceColor(value) }} />
      {fvSourceLabel(value)}
      {value.updated_at && <span style={{ color: 'var(--text-muted)', fontWeight: 500, textTransform: 'none' }}>· {dateFmt(value.updated_at)}</span>}
    </span>
  )
}

// ── Customer Baseline ───────────────────────────────────────────────────
// Per org preference: every Customer Baseline figure is a MONTHLY amount —
// labeled explicitly ("/ Month") so it's never ambiguous with an annual
// figure, since nothing else in this table states a period otherwise.
const BASELINE_FIELDS = [
  ['labor_cost', 'Labor Cost / Month', 'e.g. 150000 (₹/month, before this project)'],
  ['energy_cost', 'Energy Cost / Month', 'e.g. 40000 (₹/month)'],
  ['maintenance_cost', 'Maintenance Cost / Month', 'e.g. 60000 (₹/month)'],
  ['operating_cost', 'Operating Cost / Month', 'e.g. 200000 (₹/month, total)'],
  ['current_revenue', 'Current Revenue / Month', 'e.g. 500000 (₹/month, if this project affects revenue)'],
  ['waste_cost', 'Waste Cost / Month', 'e.g. 25000 (₹/month lost to waste/inefficiency)'],
  ['productivity_metric', 'Productivity Metric / Month', 'e.g. 1200 (units/month, or whatever KPI you track)'],
  ['technology_spend', 'Technology Spend / Month', 'e.g. 30000 (₹/month, existing tech/tooling cost)'],
]
export function CustomerBaselineTab({ proposalId, canEdit }) {
  const [baseline, setBaseline] = useState(null)
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { load() }, [proposalId])
  async function load() {
    const { data } = await supabase.from('roi_customer_baseline').select('*').eq('proposal_id', proposalId).maybeSingle()
    setBaseline(data)
    setForm(Object.fromEntries(BASELINE_FIELDS.map(([k]) => [k, fvAmount(data?.[k]) || ''])))
  }
  async function save() {
    setBusy(true); setErr('')
    try { await econ.updateCustomerBaseline(proposalId, form); await load() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="card"><div className="card-body">
      {err && <Alert type="danger" message={err} />}
      <Alert type="info" message="The 'before state' — what Benefit Drivers and Customer ROI measure improvement against." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16, marginTop: 14 }}>
        {BASELINE_FIELDS.map(([k, l, ex]) => (
          <div key={k}>
            <FieldLabel style={label} example={ex}>{l}</FieldLabel>
            <input className="input" type="number" disabled={!canEdit} value={form[k] ?? ''} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
            <div style={{ marginTop: 4 }}><FVBadge value={baseline?.[k]} /></div>
          </div>
        ))}
      </div>
      {canEdit && <button className="btn btn-primary btn-sm" disabled={busy} onClick={save} style={{ marginTop: 16 }}>{busy ? 'Saving…' : 'Save Baseline'}</button>}
    </div></div>
  )
}

// ── Benefit Drivers ─────────────────────────────────────────────────────
export function BenefitDriversTab({ proposalId, canEdit, profile }) {
  const [rows, setRows] = useState([])
  const [scenario, setScenario] = useState('expected')
  const [form, setForm] = useState({ category: 'cost_saving', name: '', potentialValue: '', capturePct: 50 })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { load() }, [proposalId])
  async function load() {
    const { data } = await supabase.from('roi_benefit_driver').select('*').eq('proposal_id', proposalId).order('created_at')
    setRows(data || [])
  }
  async function sync() {
    setBusy(true); setErr('')
    try { await econ.syncBenefitDriversFromSnapshot(proposalId); await load() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  async function add() {
    if (!form.name || !form.potentialValue) { setErr('Name and potential value are required'); return }
    setBusy(true); setErr('')
    try { await econ.addBenefitDriver(proposalId, { scenario, ...form }); setForm({ category: 'cost_saving', name: '', potentialValue: '', capturePct: 50 }); await load() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const filtered = rows.filter(r => r.scenario === scenario)
  const totalPotential = filtered.reduce((s, r) => s + fvAmount(r.potential_value), 0)
  const totalRealized = filtered.reduce((s, r) => s + fvAmount(r.realized_value), 0)

  return (
    <div>
      {err && <Alert type="danger" message={err} />}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
        <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {SCENARIOS.map(s => <button key={s} onClick={() => setScenario(s)} className="btn btn-sm" style={{ borderRadius: 0, textTransform: 'capitalize', background: scenario === s ? SCENARIO_COLOR[s] : 'transparent', color: scenario === s ? '#fff' : 'inherit' }}>{s}</button>)}
        </div>
        {canEdit && <button className="btn btn-outline btn-sm" disabled={busy} onClick={sync}><RefreshCw size={13} style={{ marginRight: 6 }} />Sync from Scenarios (v1)</button>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, marginBottom: 16 }}>
        <Stat label="Total Potential" value={rupee(totalPotential)} />
        <Stat label="Total Realized" value={rupee(totalRealized)} accent="#10b981" />
        <Stat label="Lines" value={filtered.length} />
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th style={th}>Category</th><th style={th}>Name</th><th style={th} title="Annual potential, before capture rate">Potential / Year</th><th style={th}>Capture %</th><th style={th} title="Annual realized = Potential x Capture %">Realized / Year</th><th style={th}>Source</th></tr></thead>
        <tbody>
          {filtered.length === 0 ? <tr><td colSpan={6} style={td}><Empty icon="💡" title="No benefit drivers for this scenario" desc="Sync from v1's Scenarios, or add one manually below" /></td></tr> :
            filtered.map(r => (
              <tr key={r.id}>
                <td style={td}><span style={{ textTransform: 'capitalize' }}>{r.category.replace('_', ' ')}</span></td>
                <td style={td}>{r.name}</td>
                <td style={td}>{rupee(fvAmount(r.potential_value))}</td>
                <td style={td}>{r.capture_rate_pct}%</td>
                <td style={td}><span style={{ fontWeight: 700, color: '#10b981' }}>{rupee(fvAmount(r.realized_value))}</span></td>
                <td style={td}><FVBadge value={r.realized_value} /></td>
              </tr>
            ))}
        </tbody>
      </table></div>

      {canEdit && (
        <div className="card" style={{ marginTop: 16 }}><div className="card-body">
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Add a Manual Benefit Driver</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div><FieldLabel style={label} example="e.g. Cost Saving for a reduced expense, Revenue Uplift for new income">Category</FieldLabel><select className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              <option value="cost_saving">Cost Saving</option><option value="revenue_uplift">Revenue Uplift</option><option value="productivity">Productivity</option>
            </select></div>
            <div><FieldLabel style={label} example="e.g. Reduced Overtime Hours">Name</FieldLabel><input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><FieldLabel style={label} example="e.g. 240000 (₹ PER YEAR, before applying the capture rate)">Potential Value / Year</FieldLabel><input className="input" type="number" value={form.potentialValue} onChange={e => setForm(f => ({ ...f, potentialValue: e.target.value }))} style={{ maxWidth: 140 }} /></div>
            <div><FieldLabel style={label} example="e.g. 50 (realistic % of the potential you'll actually capture)">Capture %</FieldLabel><input className="input" type="number" value={form.capturePct} onChange={e => setForm(f => ({ ...f, capturePct: e.target.value }))} style={{ maxWidth: 100 }} /></div>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={add}><Plus size={13} style={{ marginRight: 6 }} />Add</button>
          </div>
        </div></div>
      )}
    </div>
  )
}

// ── Investment Lines (customer-side, itemized) ──────────────────────────
const INVESTMENT_CATEGORIES = ['hardware', 'software', 'implementation', 'integration', 'training', 'deployment', 'support', 'subscription', 'other']
export function InvestmentLinesTab({ proposalId, projectId, canEdit }) {
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { load() }, [proposalId])
  async function load() {
    const { data } = await supabase.from('roi_investment_line').select('*').eq('proposal_id', proposalId)
    setRows(data || [])
  }
  function addRow(party) { setRows(r => [...r, { party, timing: 'one_time', category: party === 'client' ? 'hardware' : 'implementation', name: '', qty: 1, unit_cost: null, amount: { amount: 0 } }]) }
  function removeRow(i) { setRows(r => r.filter((_, idx) => idx !== i)) }
  function setField(i, key, val) {
    setRows(r => r.map((row, idx) => {
      if (idx !== i) return row
      if (key === 'amount') return { ...row, unit_cost: null, amount: { ...row.amount, amount: Number(val) } }
      if (key === 'qty' || key === 'unit_cost') return { ...row, [key]: val === '' ? (key === 'qty' ? 1 : null) : Number(val) }
      return { ...row, [key]: val }
    }))
  }
  async function save() {
    setBusy(true); setErr('')
    try {
      await econ.updateInvestmentLines(proposalId, rows.map(r => ({
        party: r.party, timing: r.timing, category: r.category, name: r.name,
        qty: r.qty, unitCost: r.unit_cost, amount: fvAmount(r.amount), source: r.amount?.source,
      })))
      await load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  async function syncProvider() {
    setSyncing(true); setErr('')
    try { await econ.syncProviderInvestmentFromProject(proposalId, projectId); await load() } catch (e) { setErr(e.message) } finally { setSyncing(false) }
  }

  function rowAmount(r) { return r.unit_cost != null ? (Number(r.qty) || 1) * Number(r.unit_cost) : fvAmount(r.amount) }
  function section(party, title, blurb) {
    const partyRows = rows.map((r, i) => ({ ...r, _i: i })).filter(r => r.party === party)
    const oneTime = partyRows.filter(r => r.timing === 'one_time').reduce((s, r) => s + rowAmount(r), 0)
    const recurring = partyRows.filter(r => r.timing === 'recurring').reduce((s, r) => s + rowAmount(r), 0)
    return (
      <div className="card" style={{ marginBottom: 20 }}><div className="card-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</div>
          {party === 'provider' && projectId && canEdit && <button className="btn btn-outline btn-sm" disabled={syncing} onClick={syncProvider}><RefreshCw size={13} style={{ marginRight: 6 }} />{syncing ? 'Syncing…' : 'Sync from Project'}</button>}
        </div>
        <Alert type="info" message={blurb} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14, margin: '14px 0' }}>
          <Stat label="One-Time Total" value={rupee(oneTime)} />
          <Stat label="Recurring (Annual)" value={rupee(recurring)} accent="#0ea5e9" />
        </div>
        <div className="table-wrap"><table>
          <thead><tr>
            <th style={th}>Timing</th><th style={th}>Category</th><th style={th}>Name</th>
            <th style={th} title="Qty x Unit Cost auto-fills Amount — leave Unit Cost blank to enter a flat Amount instead">Qty</th>
            <th style={th} title="Optional — Qty x Unit Cost auto-computes Amount">Unit Cost</th>
            <th style={th} title="One-Time = a single amount. Recurring = the ANNUAL amount (not monthly)">Amount</th>
            <th style={th}>Source</th>
            {canEdit && <th style={th}></th>}
          </tr></thead>
          <tbody>{partyRows.length === 0 ? <tr><td colSpan={8} style={td}><Empty icon="💰" title="No lines yet" desc="" /></td></tr> : partyRows.map(r => (
            <tr key={r._i}>
              <td style={td}><select className="input" disabled={!canEdit} value={r.timing} onChange={e => setField(r._i, 'timing', e.target.value)}><option value="one_time">One-Time</option><option value="recurring">Recurring (Annual)</option></select></td>
              <td style={td}><select className="input" disabled={!canEdit} value={r.category} onChange={e => setField(r._i, 'category', e.target.value)}>{INVESTMENT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></td>
              <td style={td}><input className="input" disabled={!canEdit} value={r.name} onChange={e => setField(r._i, 'name', e.target.value)} placeholder="e.g. Annual Software License" style={{ minWidth: 140 }} /></td>
              <td style={td}><input className="input" type="number" disabled={!canEdit} value={r.qty ?? 1} onChange={e => setField(r._i, 'qty', e.target.value)} style={{ maxWidth: 70 }} placeholder="e.g. 10" /></td>
              <td style={td}><input className="input" type="number" disabled={!canEdit} value={r.unit_cost ?? ''} onChange={e => setField(r._i, 'unit_cost', e.target.value)} style={{ maxWidth: 110 }} placeholder="e.g. 8000" /></td>
              <td style={td}><input className="input" type="number" disabled={!canEdit || r.unit_cost != null} value={Math.round(rowAmount(r) * 100) / 100} onChange={e => setField(r._i, 'amount', e.target.value)} style={{ maxWidth: 130 }} /></td>
              <td style={td}><FVBadge value={r.amount} /></td>
              {canEdit && <td style={td}><button className="btn btn-outline btn-sm" onClick={() => removeRow(r._i)}>Remove</button></td>}
            </tr>
          ))}</tbody>
        </table></div>
        {canEdit && <button className="btn btn-outline btn-sm" onClick={() => addRow(party)} style={{ marginTop: 12 }}>+ Add {title} Line</button>}
      </div></div>
    )
  }

  return (
    <div>
      {err && <Alert type="danger" message={err} />}
      {section('client', 'Client-Side Investment', 'What the customer pays — hardware, software, implementation, etc. This is what feeds Customer ROI and is what the Customer View page shows. Manual entry only — this app has no record of what a customer paid outside their own books.')}
      {section('provider', 'Service-Provided Investment', 'What the service provider contributes as part of the deal — e.g. subsidized hardware, co-invested integration work. Tracked for commercial transparency; excluded from Customer ROI and never shown on the Customer View page. Can be mapped in from this project’s actual cost records, or entered manually.')}
      {canEdit && <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save All Investment Lines'}</button>}
    </div>
  )
}

// ── Delivery Cost (internal-only) ────────────────────────────────────────
const DELIVERY_CATEGORIES = ['development', 'engineering', 'product', 'implementation', 'project_management', 'solution_architecture', 'qa', 'infrastructure', 'cloud', 'licenses', 'hardware', 'support', 'contractors', 'travel', 'miscellaneous', 'contingency']
export function DeliveryCostTab({ proposalId, projectId, canEdit, profile }) {
  const [rows, setRows] = useState([])
  const [manualForm, setManualForm] = useState({ category: 'development', name: '', amount: '', reason: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { load() }, [proposalId])
  async function load() {
    const { data } = await supabase.from('roi_delivery_cost_line').select('*').eq('proposal_id', proposalId)
    setRows(data || [])
  }
  async function sync() {
    setBusy(true); setErr('')
    try { await econ.syncDeliveryCostFromProject(proposalId, projectId); await load() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  async function addManual() {
    if (!manualForm.name || !manualForm.amount || !manualForm.reason) { setErr('Name, amount and reason are all required for a manual delivery-cost line.'); return }
    setBusy(true); setErr('')
    try {
      await econ.addManualDeliveryCostLine(proposalId, { category: manualForm.category, name: manualForm.name, amount: Number(manualForm.amount), reason: manualForm.reason, ownerId: profile?.id })
      setManualForm({ category: 'development', name: '', amount: '', reason: '' }); await load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const total = rows.reduce((s, r) => s + fvAmount(r.existing_amount) + fvAmount(r.manual_amount), 0)

  return (
    <div>
      {err && <Alert type="danger" message={err} />}
      <Alert type="warning" message="Internal-only — this tab and everything on it is never sent to the Customer View, by construction (see src/lib/roiEconomics.js)." />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '14px 0' }}>
        <Stat label="Total Delivery Cost" value={rupee(total)} accent="#e11d48" />
        {canEdit && <button className="btn btn-outline btn-sm" disabled={busy} onClick={sync}><RefreshCw size={13} style={{ marginRight: 6 }} />Sync Existing Costs from Project</button>}
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th style={th}>Category</th><th style={th}>Name</th><th style={th}>Existing</th><th style={th}>Manual</th><th style={th}>Total</th></tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={5} style={td}><Empty icon="🏗" title="No delivery cost lines yet" desc="" /></td></tr> : rows.map(r => (
          <tr key={r.id}>
            <td style={td}><span style={{ textTransform: 'capitalize' }}>{r.category.replace('_', ' ')}</span></td>
            <td style={td}>{r.name}</td>
            <td style={td}>{rupee(fvAmount(r.existing_amount))} <FVBadge value={r.existing_amount} /></td>
            <td style={td}>{rupee(fvAmount(r.manual_amount))} <FVBadge value={r.manual_amount} /></td>
            <td style={td}><span style={{ fontWeight: 700 }}>{rupee(fvAmount(r.existing_amount) + fvAmount(r.manual_amount))}</span></td>
          </tr>
        ))}</tbody>
      </table></div>

      {canEdit && (
        <div className="card" style={{ marginTop: 16 }}><div className="card-body">
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Add a Manual Delivery Cost Line</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div><FieldLabel style={label} example="e.g. contractors (a one-time or total project cost, not monthly)">Category</FieldLabel><select className="input" value={manualForm.category} onChange={e => setManualForm(f => ({ ...f, category: e.target.value }))}>{DELIVERY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            <div><FieldLabel style={label} example="e.g. Freelance QA Engineer — 2 months">Name</FieldLabel><input className="input" value={manualForm.name} onChange={e => setManualForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><FieldLabel style={label} example="e.g. 80000 (₹, total for this line — not per month)">Amount</FieldLabel><input className="input" type="number" value={manualForm.amount} onChange={e => setManualForm(f => ({ ...f, amount: e.target.value }))} style={{ maxWidth: 140 }} /></div>
            <div style={{ flex: '1 1 240px' }}><FieldLabel style={label} example="e.g. Extra QA contractor added after scope change">Reason (required)</FieldLabel><input className="input" value={manualForm.reason} onChange={e => setManualForm(f => ({ ...f, reason: e.target.value }))} /></div>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={addManual}><Plus size={13} style={{ marginRight: 6 }} />Add</button>
          </div>
        </div></div>
      )}
    </div>
  )
}

// ── PO vs Actual Cost ─────────────────────────────────────────────────────
export function PoVsActualTab({ proposalId, canEdit, profile }) {
  const [full, setFull] = useState(null)
  const [poForm, setPoForm] = useState({ originalPo: '', expansionPo: '', credits: '' })
  const [coForm, setCoForm] = useState({ description: '', amount: '', reason: '' })
  const [gp, setGp] = useState(null)
  const [variance, setVariance] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { load() }, [proposalId])
  async function load() {
    const e = await econ.getEconomicsFull(proposalId)
    setFull(e)
    setPoForm({ originalPo: fvAmount(e.poRecord?.original_po) || '', expansionPo: fvAmount(e.poRecord?.expansion_po) || '', credits: fvAmount(e.poRecord?.credits) || '' })
    setGp(await econ.getLatestGrossProfit(proposalId))
    setVariance(await econ.getCostVariance(proposalId))
  }
  async function savePo() {
    setBusy(true); setErr('')
    try { await econ.updatePoRecord(proposalId, { originalPo: Number(poForm.originalPo), expansionPo: Number(poForm.expansionPo) || 0, credits: Number(poForm.credits) || 0 }); await load() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  async function addCo() {
    if (!coForm.amount || !coForm.reason) { setErr('Amount and reason are required for a change order.'); return }
    setBusy(true); setErr('')
    try { await econ.addChangeOrder(proposalId, { description: coForm.description, amount: Number(coForm.amount), reason: coForm.reason, ownerId: profile?.id }); setCoForm({ description: '', amount: '', reason: '' }); await load() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  async function recompute() {
    setBusy(true); setErr('')
    try { await econ.computeGrossProfit(proposalId); await load() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  if (!full) return <Loader />
  const VARIANCE_COLOR = { on_track: '#10b981', at_risk: '#f59e0b', over_budget: '#e11d48' }

  return (
    <div>
      {err && <Alert type="danger" message={err} />}
      <div className="card" style={{ marginBottom: 16 }}><div className="card-body">
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Purchase Order</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><FieldLabel style={label} example="e.g. 1000000 (₹, the base signed PO — a one-time total, not monthly)">Original PO</FieldLabel><input className="input" type="number" disabled={!canEdit} value={poForm.originalPo} onChange={e => setPoForm(f => ({ ...f, originalPo: e.target.value }))} /></div>
          <div><FieldLabel style={label} example="e.g. 200000 (₹, additional scope added to the PO)">Expansion PO</FieldLabel><input className="input" type="number" disabled={!canEdit} value={poForm.expansionPo} onChange={e => setPoForm(f => ({ ...f, expansionPo: e.target.value }))} /></div>
          <div><FieldLabel style={label} example="e.g. 25000 (₹, any credits issued back to the customer)">Credits</FieldLabel><input className="input" type="number" disabled={!canEdit} value={poForm.credits} onChange={e => setPoForm(f => ({ ...f, credits: e.target.value }))} /></div>
          {canEdit && <button className="btn btn-primary btn-sm" disabled={busy} onClick={savePo}>Save PO</button>}
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>Change Orders</div>
          {full.changeOrders.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>None yet</div> : (
            <div className="table-wrap"><table><thead><tr><th style={th}>Date</th><th style={th}>Description</th><th style={th}>Amount</th></tr></thead>
              <tbody>{full.changeOrders.map(c => <tr key={c.id}><td style={td}>{dateFmt(c.date)}</td><td style={td}>{c.description || '—'}</td><td style={td}>{rupee(fvAmount(c.amount))}</td></tr>)}</tbody>
            </table></div>
          )}
          {canEdit && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
              <div><FieldLabel style={label} example="e.g. Added 2 more sites mid-project">Description</FieldLabel><input className="input" value={coForm.description} onChange={e => setCoForm(f => ({ ...f, description: e.target.value }))} /></div>
              <div><FieldLabel style={label} example="e.g. 150000 (₹, one-time change-order amount)">Amount</FieldLabel><input className="input" type="number" value={coForm.amount} onChange={e => setCoForm(f => ({ ...f, amount: e.target.value }))} style={{ maxWidth: 140 }} /></div>
              <div style={{ flex: '1 1 220px' }}><FieldLabel style={label} example="e.g. Customer requested additional site coverage">Reason (required)</FieldLabel><input className="input" value={coForm.reason} onChange={e => setCoForm(f => ({ ...f, reason: e.target.value }))} /></div>
              <button className="btn btn-outline btn-sm" disabled={busy} onClick={addCo}><Plus size={13} style={{ marginRight: 6 }} />Add Change Order</button>
            </div>
          )}
        </div>
      </div></div>

      <div className="card" style={{ marginBottom: 16 }}><div className="card-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Total PO → Actual Delivery Cost → Gross Profit → Gross Margin</div>
          {canEdit && <button className="btn btn-primary btn-sm" disabled={busy} onClick={recompute}><RefreshCw size={13} style={{ marginRight: 6 }} />{busy ? 'Computing…' : 'Recompute Gross Profit'}</button>}
        </div>
        {!gp ? <Empty icon="💰" title="Not computed yet" desc="Set up the PO and delivery cost lines, then Recompute" /> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14 }}>
            <Stat label="Total PO" value={rupee(gp.total_po)} />
            <Stat label="Actual Delivery Cost" value={rupee(gp.actual_delivery_cost)} accent="#e11d48" />
            <Stat label="Gross Profit" value={rupee(gp.gross_profit)} accent="#10b981" />
            <Stat label="Gross Margin" value={gp.gross_margin_pct != null ? `${gp.gross_margin_pct}%` : '—'} accent="#6366f1" />
          </div>
        )}
      </div></div>

      <div className="card"><div className="card-body">
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Cost Variance by Category</div>
        {variance.length === 0 ? <Empty icon="📊" title="No delivery cost lines to compare yet" desc="" /> : (
          <div className="table-wrap"><table><thead><tr><th style={th}>Category</th><th style={th}>Budget (Existing)</th><th style={th}>Actual</th><th style={th}>Variance</th><th style={th}>Status</th></tr></thead>
            <tbody>{variance.map(v => (
              <tr key={v.category}>
                <td style={td}><span style={{ textTransform: 'capitalize' }}>{v.category.replace('_', ' ')}</span></td>
                <td style={td}>{rupee(v.budget)}</td>
                <td style={td}>{rupee(v.actual)}</td>
                <td style={td}>{rupee(v.variance_amount)} {v.variance_pct != null && `(${v.variance_pct}%)`}</td>
                <td style={td}><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: `${VARIANCE_COLOR[v.status]}18`, color: VARIANCE_COLOR[v.status], textTransform: 'uppercase' }}>{v.status.replace('_', ' ')}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div></div>
    </div>
  )
}

// ── ROI Result (Customer + Internal split) ──────────────────────────────
export function RoiResultTab({ proposalId, canEdit }) {
  const [horizon, setHorizon] = useState('annual')
  const [results, setResults] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { load() }, [proposalId, horizon])
  async function load() { setResults(await econ.getLatestRoiResults(proposalId, horizon)) }
  async function recompute() {
    setBusy(true); setErr('')
    try { await econ.computeRoiResult(proposalId, horizon); await load() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div>
      {err && <Alert type="danger" message={err} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {['annual', '3yr', '5yr'].map(h => <button key={h} onClick={() => setHorizon(h)} className="btn btn-sm" style={{ borderRadius: 0, background: horizon === h ? 'var(--c1)' : 'transparent', color: horizon === h ? '#fff' : 'inherit' }}>{h === 'annual' ? 'Annual' : h.toUpperCase()}</button>)}
        </div>
        {canEdit && <button className="btn btn-primary btn-sm" disabled={busy} onClick={recompute}><RefreshCw size={13} style={{ marginRight: 6 }} />{busy ? 'Computing…' : 'Recompute ROI Result'}</button>}
      </div>
      {Object.keys(results).length === 0 ? <Empty icon="📈" title="Not computed for this horizon yet" desc="Requires Gross Profit to be computed first (PO vs Actual Cost tab)" /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
          {SCENARIOS.map(sc => { const r = results[sc]; if (!r) return null
            return (
              <div key={sc} className="card"><div className="card-header"><span className="card-title" style={{ color: SCENARIO_COLOR[sc] }}>{sc[0].toUpperCase() + sc.slice(1)}</span></div>
                <div className="card-body">
                  <div style={{ fontWeight: 700, fontSize: 11.5, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Customer Economics</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                    <Stat label="Investment" value={rupee(r.customer_investment)} />
                    <Stat label="Net Benefit" value={rupee(r.customer_net_benefit)} accent="#10b981" />
                    <Stat label="Customer ROI %" value={r.customer_roi_pct != null ? `${r.customer_roi_pct}%` : '—'} accent="#6366f1" />
                    <Stat label="Payback (months)" value={r.customer_payback_months ?? '—'} />
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 11.5, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Internal Economics</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Stat label="Gross Profit" value={rupee(r.gross_profit)} />
                    <Stat label="Delivery Cost" value={rupee(r.actual_delivery_cost)} />
                    <Stat label="Internal ROI %" value={r.internal_roi_pct != null ? `${r.internal_roi_pct}%` : '—'} accent="#f59e0b" />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Sensitivity Analysis ─────────────────────────────────────────────────
export function SensitivityTab({ proposalId, profile }) {
  const [scenario, setScenario] = useState('expected')
  const [history, setHistory] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { load() }, [proposalId])
  async function load() { setHistory(await econ.getSensitivityHistory(proposalId)) }
  async function run() {
    setBusy(true); setErr('')
    try {
      await econ.runSensitivityAnalysis(proposalId, { scenario, variableX: 'capture_rate_multiplier', variableY: 'investment_multiplier', xValues: [0.6, 0.8, 1.0, 1.2, 1.4], yValues: [0.6, 0.8, 1.0, 1.2, 1.4], profileId: profile?.id })
      await load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const latest = history[0]

  return (
    <div>
      {err && <Alert type="danger" message={err} />}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <div><label style={label}>Scenario</label><select className="input" value={scenario} onChange={e => setScenario(e.target.value)}>{SCENARIOS.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={run}><Play size={13} style={{ marginRight: 6 }} />{busy ? 'Running…' : 'Run Sensitivity Grid (±40%, Capture Rate × Investment)'}</button>
      </div>
      {!latest ? <Empty icon="🎛" title="No sensitivity run yet" desc="" /> : (
        <div className="card"><div className="card-body">
          <div style={{ marginBottom: 12 }}>ROI% spread across the grid: <strong>{latest.roi_spread_pct}%</strong> — risk rating derived from this on the Approval tab.</div>
          <div className="table-wrap"><table>
            <thead><tr><th style={th}>Capture Rate ×↓ \ Investment ×→</th>{latest.grid.x_values.map(x => <th key={x} style={th}>{x}×</th>)}</tr></thead>
            <tbody>{latest.grid.y_values.map((y, yi) => (
              <tr key={y}><td style={{ ...td, fontWeight: 700 }}>{y}×</td>
                {latest.grid.cells[yi].map((cell, xi) => <td key={xi} style={td}>{cell.roi_pct != null ? `${cell.roi_pct}%` : '—'}</td>)}
              </tr>
            ))}</tbody>
          </table></div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>Cells show ROI% for that combination of capture-rate and investment multipliers. Run at {dateFmt(latest.run_at)}.</div>
        </div></div>
      )}
    </div>
  )
}

// ── NPV / IRR ─────────────────────────────────────────────────────────────
export function NpvIrrTab({ proposalId, profile }) {
  const [scenario, setScenario] = useState('expected')
  const [horizonYears, setHorizonYears] = useState(3)
  const [discountRate, setDiscountRate] = useState('')
  const [results, setResults] = useState({})
  const [settings, setSettings] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { load() }, [proposalId])
  async function load() { setResults(await econ.getLatestNpvIrr(proposalId)); setSettings(await econ.getRoiSettings()) }
  async function run() {
    setBusy(true); setErr('')
    try { await econ.computeNpvIrr(proposalId, { scenario, horizonYears: Number(horizonYears), discountRatePct: discountRate ? Number(discountRate) : undefined }); await load() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div>
      {err && <Alert type="danger" message={err} />}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <div><label style={label}>Scenario</label><select className="input" value={scenario} onChange={e => setScenario(e.target.value)}>{SCENARIOS.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
        <div><FieldLabel style={label} example="e.g. 3 (years — matches the 3yr/5yr horizons elsewhere)">Horizon (years)</FieldLabel><input className="input" type="number" value={horizonYears} onChange={e => setHorizonYears(e.target.value)} style={{ maxWidth: 100 }} /></div>
        <div><FieldLabel style={label} example={`e.g. 12 (annual %, blank = org default ${settings?.default_discount_rate_pct}%)`}>Discount Rate % / Year</FieldLabel><input className="input" type="number" value={discountRate} onChange={e => setDiscountRate(e.target.value)} style={{ maxWidth: 160 }} /></div>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={run}>{busy ? 'Computing…' : 'Run NPV / IRR'}</button>
      </div>
      {Object.keys(results).length === 0 ? <Empty icon="📉" title="No NPV/IRR computed yet" desc="" /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16 }}>
          {SCENARIOS.map(sc => { const r = results[sc]; if (!r) return null
            return (
              <div key={sc} className="card"><div className="card-header"><span className="card-title" style={{ color: SCENARIO_COLOR[sc] }}>{sc[0].toUpperCase() + sc.slice(1)}</span></div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Stat label="NPV" value={rupee(r.npv)} accent="#10b981" />
                  <Stat label="IRR" value={r.irr_pct != null ? `${r.irr_pct}%` : 'No solvable root'} accent="#6366f1" />
                  <Stat label="Discount Rate" value={`${r.discount_rate_pct}%`} />
                  <Stat label="Horizon" value={`${r.horizon_years} yr`} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Assumptions & Adjustments (audit ledger) ─────────────────────────────
export function AssumptionsLedgerTab({ proposalId }) {
  const [rows, setRows] = useState(null)
  useEffect(() => { supabase.from('roi_manual_adjustment').select('*,owner_profile:profiles!owner(full_name)').eq('proposal_id', proposalId).order('created_at', { ascending: false }).then(({ data }) => setRows(data || [])) }, [proposalId])
  if (rows === null) return <Loader />
  return (
    <div className="card"><div className="card-body">
      <Alert type="info" message="Every manual override anywhere in this proposal — a cost-driver edit after approval, a capture-rate override, a PO change order, a delivery-cost manual line — is logged here. This IS the audit trail." />
      {rows.length === 0 ? <Empty icon="📋" title="No manual adjustments logged yet" desc="" /> : (
        <div className="table-wrap" style={{ marginTop: 14 }}><table>
          <thead><tr><th style={th}>Date</th><th style={th}>Category</th><th style={th}>Type</th><th style={th}>Amount</th><th style={th}>Reason</th><th style={th}>Owner</th><th style={th}>Status</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id}>
              <td style={td}>{dateFmt(r.date)}</td>
              <td style={td}>{r.category}</td>
              <td style={td}><span style={{ textTransform: 'capitalize' }}>{r.type}</span></td>
              <td style={td}>{rupee(fvAmount(r.amount))}</td>
              <td style={td}>{r.reason}</td>
              <td style={td}>{r.owner_profile?.full_name || '—'}</td>
              <td style={td}><StatusBadge status={r.approval_status} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div></div>
  )
}

// ── Customer Portal link management ──────────────────────────────────────
export function CustomerPortalTab({ proposalId, profile }) {
  const [link, setLink] = useState(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => { load() }, [proposalId])
  async function load() { setLink(await econ.getOrCreatePortalLink(proposalId, profile?.id)) }
  const url = link ? `${window.location.origin}/roi-view/${link.token}` : ''

  async function toggleActive() { setBusy(true); try { await econ.setPortalLinkActive(link.id, !link.is_active); await load() } finally { setBusy(false) } }
  async function regenerate() { setBusy(true); try { await econ.regeneratePortalLink(link.id); await load() } finally { setBusy(false) } }
  function copy() { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) }

  if (!link) return <Loader />
  return (
    <div className="card"><div className="card-body">
      <Alert type="info" message="A durable, unauthenticated secret link — not a client login/account system. Anyone with this link can view the read-only Customer View for this proposal until it's deactivated or regenerated." />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
        <Link2 size={14} />
        <code style={{ fontSize: 12, background: 'var(--surface)', padding: '6px 10px', borderRadius: 6, wordBreak: 'break-all' }}>{url}</code>
        <button className="btn btn-outline btn-sm" onClick={copy}><Copy size={13} style={{ marginRight: 6 }} />{copied ? 'Copied!' : 'Copy'}</button>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button className="btn btn-outline btn-sm" disabled={busy} onClick={toggleActive}>{link.is_active ? 'Deactivate Link' : 'Reactivate Link'}</button>
        <button className="btn btn-outline btn-sm" disabled={busy} onClick={regenerate}>Regenerate Token (invalidates old link)</button>
      </div>
      <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--text-muted)' }}>Status: {link.is_active ? <span style={{ color: '#10b981', fontWeight: 700 }}>Active</span> : <span style={{ color: '#e11d48', fontWeight: 700 }}>Inactive</span>}</div>
    </div></div>
  )
}

// ── Executive Overview ───────────────────────────────────────────────────
export function ExecutiveOverviewTab({ proposalId, proposal }) {
  const [gp, setGp] = useState(null)
  const [results, setResults] = useState({})
  const [npvIrr, setNpvIrr] = useState({})
  const [riskRating, setRiskRating] = useState(null)
  useEffect(() => {
    econ.getLatestGrossProfit(proposalId).then(setGp)
    econ.getLatestRoiResults(proposalId, 'annual').then(setResults)
    econ.getLatestNpvIrr(proposalId).then(setNpvIrr)
    econ.getLatestRiskRating(proposalId).then(setRiskRating)
  }, [proposalId])
  const active = results[proposal.active_scenario]
  const activeNpv = npvIrr[proposal.active_scenario]
  const RISK_COLOR = { low: '#10b981', medium: '#f59e0b', high: '#e11d48' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card"><div className="card-header"><span className="card-title">Commercial</span></div><div className="card-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14 }}>
          <Stat label="Total PO" value={gp ? rupee(gp.total_po) : '—'} />
          <Stat label="Delivery Cost" value={gp ? rupee(gp.actual_delivery_cost) : '—'} />
          <Stat label="Gross Profit" value={gp ? rupee(gp.gross_profit) : '—'} accent="#10b981" />
          <Stat label="Gross Margin" value={gp?.gross_margin_pct != null ? `${gp.gross_margin_pct}%` : '—'} accent="#6366f1" />
        </div>
      </div></div>
      <div className="card"><div className="card-header"><span className="card-title">Customer Economics</span></div><div className="card-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14 }}>
          <Stat label="Investment" value={active ? rupee(active.customer_investment) : '—'} />
          <Stat label="Net Benefit" value={active ? rupee(active.customer_net_benefit) : '—'} accent="#10b981" />
          <Stat label="Customer ROI %" value={active?.customer_roi_pct != null ? `${active.customer_roi_pct}%` : '—'} accent="#6366f1" />
          <Stat label="Payback" value={active?.customer_payback_months != null ? `${active.customer_payback_months} mo` : '—'} />
        </div>
      </div></div>
      <div className="card"><div className="card-header"><span className="card-title">Internal Economics</span></div><div className="card-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14 }}>
          <Stat label="Internal ROI %" value={active?.internal_roi_pct != null ? `${active.internal_roi_pct}%` : '—'} accent="#f59e0b" />
          <Stat label="Delivery Cost" value={active ? rupee(active.actual_delivery_cost) : '—'} />
          <Stat label="Gross Profit" value={active ? rupee(active.gross_profit) : '—'} />
        </div>
      </div></div>
      <div className="card"><div className="card-header"><span className="card-title">Forecast</span></div><div className="card-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14 }}>
          <Stat label="NPV" value={activeNpv ? rupee(activeNpv.npv) : '—'} accent="#10b981" />
          <Stat label="IRR" value={activeNpv?.irr_pct != null ? `${activeNpv.irr_pct}%` : '—'} />
          <Stat label="Horizon" value={activeNpv ? `${activeNpv.horizon_years} yr` : '—'} />
        </div>
      </div></div>
      <div className="card"><div className="card-header"><span className="card-title">Status</span></div><div className="card-body">
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <div><div style={label}>Approval Status</div><StatusBadge status={proposal.status} /></div>
          <div><div style={label}>Risk Rating</div>{riskRating ? <span style={{ fontWeight: 800, color: RISK_COLOR[riskRating], textTransform: 'uppercase' }}>{riskRating}</span> : <span style={{ color: 'var(--text-muted)' }}>Run Sensitivity Analysis</span>}</div>
        </div>
      </div></div>
    </div>
  )
}
