import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, rupee } from '../lib/supabase'
import { listBootstrapPrograms, createBootstrapProgram, updateBootstrapStatus, convertBootstrapProgram, listMarketingBudgetLines, createMarketingBudgetLine } from '../lib/salesBootstrapPrograms'
import { listRegions, DOMAINS } from '../lib/salesAdmin'
import { Modal, StatusBadge, Loader, Empty, StatCard, Tabs } from '../components/ui'
import { Plus, Rocket, Wallet } from 'lucide-react'

const SEGMENTS = ['Startups', 'Incubators', 'Accelerator Partners']
const initForm = () => ({ program_name: '', target_segment: 'Startups', participant_company_name: '', product_provided: '', cost_absorbed: '', marketing_budget_line_id: '', program_duration: '' })
const initBudgetForm = () => ({ period_label: '', planned_amount: '', notes: '', approved: false })

export default function BootstrapProgramsPage() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('programs')
  const [programs, setPrograms] = useState([])
  const [budgetLines, setBudgetLines] = useState([])
  const [products, setProducts] = useState([])
  const [regions, setRegions] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showBudgetModal, setShowBudgetModal] = useState(false)
  const [convertTarget, setConvertTarget] = useState(null)
  const [form, setForm] = useState(initForm())
  const [budgetForm, setBudgetForm] = useState(initBudgetForm())
  const [convertForm, setConvertForm] = useState({ domain: 'B2B', region_id: '', expected_value: '', expected_close_date: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const [p, b, prods, r] = await Promise.all([listBootstrapPrograms(), listMarketingBudgetLines(), supabase.from('products').select('part_number,name').then(x => x.data || []), listRegions()])
    setPrograms(p); setBudgetLines(b); setProducts(prods); setRegions(r)
    setLoading(false)
  }

  async function save(e) {
    e.preventDefault()
    if (!form.program_name || !form.participant_company_name) { setErr('Program name and participant company are required'); return }
    setSaving(true); setErr('')
    try { await createBootstrapProgram(form, profile.id); setShowModal(false); setForm(initForm()); await load() }
    catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  async function saveBudgetLine(e) {
    e.preventDefault()
    if (!budgetForm.period_label) { setErr('Period is required'); return }
    setSaving(true); setErr('')
    try { await createMarketingBudgetLine(budgetForm, profile.id); setShowBudgetModal(false); setBudgetForm(initBudgetForm()); await load() }
    catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  async function confirmConvert() {
    setSaving(true); setErr('')
    try { await convertBootstrapProgram(convertTarget.id, convertForm, profile.id); setConvertTarget(null); await load() }
    catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  const totalAbsorbed = programs.reduce((s, p) => s + Number(p.cost_absorbed || 0), 0)
  const totalPlanned = budgetLines.reduce((s, b) => s + Number(b.planned_amount || 0), 0)

  if (loading) return <Loader />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Bootstrap / Startup Program</div>
          <div className="page-subtitle">Market-development spend — tracked separately from normal sales CAC, against its own approved budget line</div>
        </div>
        <div className="page-actions">
          {tab === 'programs' && <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={15} /> New Program</button>}
          {tab === 'budget' && <button className="btn btn-primary" onClick={() => setShowBudgetModal(true)}><Plus size={15} /> New Budget Line</button>}
        </div>
      </div>

      <Tabs tabs={[{ id: 'programs', label: 'Programs' }, { id: 'budget', label: 'Marketing Budget Lines' }]} active={tab} onChange={setTab} />

      {tab === 'programs' ? (
        <>
          <div className="stats-grid" style={{ marginBottom: 16 }}>
            <StatCard label="Active Programs" value={programs.filter(p => p.status === 'Active').length} icon={<Rocket size={17} />} accent="#db2777" />
            <StatCard label="Cost Absorbed" value={rupee(totalAbsorbed)} icon={<Wallet size={17} />} accent="#dc2626" />
            <StatCard label="Planned Budget" value={rupee(totalPlanned)} icon={<Wallet size={17} />} accent="#15803d" />
          </div>

          {programs.length === 0 ? (
            <div className="card" style={{ padding: '20px 24px' }}><Empty icon="🚀" title="No programs tracked" desc="Add the first Bootstrap/Startup program" /></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Program</th><th>Segment</th><th>Participant</th><th>Cost Absorbed</th><th>Status</th><th>Outcome</th><th></th></tr></thead>
                <tbody>
                  {programs.map(p => (
                    <tr key={p.id}>
                      <td className="td-bold">{p.program_name}</td>
                      <td>{p.target_segment}</td>
                      <td>{p.participant_company_name}</td>
                      <td>{rupee(p.cost_absorbed)}</td>
                      <td>
                        <select className="form-select" style={{ fontSize: 12, width: 110 }} value={p.status} onChange={e => updateBootstrapStatus(p.id, e.target.value, profile.id).then(load)}>
                          <option value="Active">Active</option><option value="Completed">Completed</option>
                        </select>
                      </td>
                      <td>{p.conversion_outcome || '—'}</td>
                      <td>{!p.conversion_outcome && <button className="btn btn-ghost btn-sm" onClick={() => setConvertTarget(p)}>Convert</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        budgetLines.length === 0 ? (
          <div className="card" style={{ padding: '20px 24px' }}><Empty icon="💰" title="No budget lines" desc="Add a planned Bootstrap/Startup budget line" /></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Period</th><th>Category</th><th>Planned Amount</th><th>Approved</th><th>Notes</th></tr></thead>
              <tbody>
                {budgetLines.map(b => (
                  <tr key={b.id}>
                    <td className="td-bold">{b.period_label}</td>
                    <td style={{ fontSize: 12 }}>{b.category}</td>
                    <td>{rupee(b.planned_amount)}</td>
                    <td><StatusBadge status={b.approved_by ? 'approved' : 'draft'} /></td>
                    <td style={{ fontSize: 12, color: '#94a3b8' }}>{b.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="New Bootstrap Program"
        footer={<><button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Create'}</button></>}>
        <form onSubmit={save}>
          {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
          <div className="form-row">
            <div className="form-group"><label className="form-label">Program Name *</label><input className="form-input" value={form.program_name} onChange={e => setForm(f => ({ ...f, program_name: e.target.value }))} required /></div>
            <div className="form-group"><label className="form-label">Segment</label>
              <select className="form-select" value={form.target_segment} onChange={e => setForm(f => ({ ...f, target_segment: e.target.value }))}>
                {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select></div>
          </div>
          <div className="form-group"><label className="form-label">Participant Company *</label><input className="form-input" value={form.participant_company_name} onChange={e => setForm(f => ({ ...f, participant_company_name: e.target.value }))} required /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Product Provided</label>
              <select className="form-select" value={form.product_provided} onChange={e => setForm(f => ({ ...f, product_provided: e.target.value }))}>
                <option value="">—</option>{products.map(p => <option key={p.part_number} value={p.part_number}>{p.name}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Cost Absorbed</label><input className="form-input" type="number" value={form.cost_absorbed} onChange={e => setForm(f => ({ ...f, cost_absorbed: e.target.value }))} /></div>
          </div>
          <div className="form-group"><label className="form-label">Budget Line</label>
            <select className="form-select" value={form.marketing_budget_line_id} onChange={e => setForm(f => ({ ...f, marketing_budget_line_id: e.target.value }))}>
              <option value="">—</option>{budgetLines.map(b => <option key={b.id} value={b.id}>{b.period_label} ({rupee(b.planned_amount)})</option>)}
            </select></div>
        </form>
      </Modal>

      <Modal open={showBudgetModal} onClose={() => setShowBudgetModal(false)} title="New Marketing Budget Line"
        footer={<><button className="btn btn-ghost" onClick={() => setShowBudgetModal(false)}>Cancel</button><button className="btn btn-primary" onClick={saveBudgetLine} disabled={saving}>{saving ? 'Saving…' : 'Create'}</button></>}>
        <form onSubmit={saveBudgetLine}>
          {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
          <div className="form-row">
            <div className="form-group"><label className="form-label">Period *</label><input className="form-input" placeholder="e.g. FY2026" value={budgetForm.period_label} onChange={e => setBudgetForm(f => ({ ...f, period_label: e.target.value }))} required /></div>
            <div className="form-group"><label className="form-label">Planned Amount</label><input className="form-input" type="number" value={budgetForm.planned_amount} onChange={e => setBudgetForm(f => ({ ...f, planned_amount: e.target.value }))} /></div>
          </div>
          <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={budgetForm.notes} onChange={e => setBudgetForm(f => ({ ...f, notes: e.target.value }))} /></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <input type="checkbox" checked={budgetForm.approved} onChange={e => setBudgetForm(f => ({ ...f, approved: e.target.checked }))} /> Mark as approved now
          </label>
        </form>
      </Modal>

      <Modal open={!!convertTarget} onClose={() => setConvertTarget(null)} title="Convert to Opportunity"
        footer={<><button className="btn btn-ghost" onClick={() => setConvertTarget(null)}>Cancel</button><button className="btn btn-primary" onClick={confirmConvert} disabled={saving}>{saving ? 'Converting…' : 'Convert'}</button></>}>
        {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="form-row">
          <div className="form-group"><label className="form-label">Domain</label>
            <select className="form-select" value={convertForm.domain} onChange={e => setConvertForm(f => ({ ...f, domain: e.target.value }))}>
              {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
            </select></div>
          <div className="form-group"><label className="form-label">Region</label>
            <select className="form-select" value={convertForm.region_id} onChange={e => setConvertForm(f => ({ ...f, region_id: e.target.value }))}>
              <option value="">—</option>{regions.map(r => <option key={r.id} value={r.id}>{r.region_name}</option>)}
            </select></div>
        </div>
        <div className="form-group"><label className="form-label">Expected Value</label><input className="form-input" type="number" value={convertForm.expected_value} onChange={e => setConvertForm(f => ({ ...f, expected_value: e.target.value }))} /></div>
        <div className="form-group"><label className="form-label">Expected Close Date</label><input className="form-input" type="date" value={convertForm.expected_close_date} onChange={e => setConvertForm(f => ({ ...f, expected_close_date: e.target.value }))} /></div>
      </Modal>
    </div>
  )
}
