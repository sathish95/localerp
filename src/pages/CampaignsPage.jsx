import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase, rupee, dateFmt } from '../lib/supabase'
import {
  listCampaigns, getCampaign, createCampaign, updateCampaign,
  listCampaignBudgets, addCampaignBudget, deleteCampaignBudget,
  listCostEntries, addCostEntry, deleteCostEntry,
  listChannelLinks, linkLandingPage, linkBootstrapProgram, linkOther, deleteChannelLink,
  getCampaignResult,
} from '../lib/marketingCampaigns'
import { listRegions, listLookup, DOMAINS } from '../lib/salesAdmin'
import { listLandingLinks } from '../lib/salesLandingLinks'
import { listBootstrapPrograms, listMarketingBudgetLines } from '../lib/salesBootstrapPrograms'
import { Modal, SearchBox, StatusBadge, Loader, Empty, StatCard, Tabs } from '../components/ui'
import { Plus, ArrowLeft, Megaphone, TrendingUp, Wallet, Link2, Trash2 } from 'lucide-react'

const STATUSES = ['Planning', 'Active', 'Paused', 'Completed']
const initForm = () => ({ campaign_name: '', campaign_type: '', domain: '', region_id: '', start_date: '', end_date: '', linked_product_id: '' })

const MARKETING_WRITE_ROLES = ['admin', 'ceo', 'cmo', 'campaign_manager']

export default function CampaignsPage() {
  const { profile } = useAuth()
  const canEdit = MARKETING_WRITE_ROLES.includes(profile?.role)
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('id') || ''
  const [campaigns, setCampaigns] = useState([])
  const [types, setTypes] = useState([])
  const [regions, setRegions] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(initForm())
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const [c, t, r, p] = await Promise.all([listCampaigns(), listLookup('campaignTypes'), listRegions(), supabase.from('products').select('part_number,name').then(x => x.data || [])])
    setCampaigns(c); setTypes(t); setRegions(r); setProducts(p)
    if (!form.campaign_type && t.length) setForm(f => ({ ...f, campaign_type: t[0].name }))
    setLoading(false)
  }

  function select(id) { setSearchParams(id ? { id } : {}) }

  async function handleCreate(e) {
    e.preventDefault()
    if (!form.campaign_name.trim() || !form.campaign_type) { setErr('Campaign name and type are required'); return }
    setSaving(true); setErr('')
    try {
      const c = await createCampaign(form, profile.id)
      setShowCreate(false); setForm(initForm())
      await load(); select(c.id)
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  const filtered = campaigns.filter(c =>
    (!search || c.campaign_name?.toLowerCase().includes(search.toLowerCase())) &&
    (!statusFilter || c.status === statusFilter)
  )

  if (loading) return <Loader />
  if (selectedId) return <CampaignDetail campaignId={selectedId} profile={profile} canEdit={canEdit} types={types} regions={regions} products={products} onBack={() => select('')} onChanged={load} />

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Campaigns</div>
          <div className="page-subtitle">Every marketing activity traces to a cost and a result — planned spend, actual spend, leads, opportunities, deals won, ROI</div>
        </div>
        {canEdit && <div className="page-actions"><button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} /> New Campaign</button></div>}
      </div>

      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Total Campaigns" value={campaigns.length} icon={<Megaphone size={17} />} accent="#db2777" />
        <StatCard label="Active" value={campaigns.filter(c => c.status === 'Active').length} icon={<TrendingUp size={17} />} accent="#15803d" />
        <StatCard label="Planning" value={campaigns.filter(c => c.status === 'Planning').length} icon={<TrendingUp size={17} />} accent="#f59e0b" />
      </div>

      <div className="card" style={{ padding: 12, marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: '1 1 260px', minWidth: 220 }}><SearchBox value={search} onChange={setSearch} placeholder="Search campaigns…" /></div>
        <select className="form-select" style={{ fontSize: 12, width: 180 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ padding: '20px 24px' }}><Empty icon="📣" title="No campaigns found" desc="Create your first campaign" /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 14 }}>
          {filtered.map(c => (
            <button key={c.id} onClick={() => select(c.id)} className="card" style={{ textAlign: 'left', padding: 16, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{c.campaign_name}</div>
                <StatusBadge status={c.status === 'Active' ? 'active' : c.status === 'Completed' ? 'closed' : 'draft'} />
              </div>
              <div style={{ fontSize: 11.5, color: '#64748b' }}>{c.campaign_type} · {c.domain || 'Cross-domain'} · {c.region?.region_name || 'All Regions'}</div>
              {c.start_date && <div style={{ fontSize: 11, color: '#94a3b8' }}>{dateFmt(c.start_date)}{c.end_date ? ` – ${dateFmt(c.end_date)}` : ''}</div>}
            </button>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Campaign" size="lg"
        footer={<><button className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button><button className="btn btn-primary" onClick={handleCreate} disabled={saving}>{saving ? 'Creating…' : 'Create Campaign'}</button></>}>
        <form onSubmit={handleCreate}>
          {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
          <div className="form-group"><label className="form-label">Campaign Name *</label><input className="form-input" value={form.campaign_name} onChange={e => setForm(f => ({ ...f, campaign_name: e.target.value }))} required /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Type *</label>
              <select className="form-select" value={form.campaign_type} onChange={e => setForm(f => ({ ...f, campaign_type: e.target.value }))}>
                {types.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Domain</label>
              <select className="form-select" value={form.domain} onChange={e => setForm(f => ({ ...f, domain: e.target.value }))}>
                <option value="">Cross-domain</option>{DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
              </select></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Region</label>
              <select className="form-select" value={form.region_id} onChange={e => setForm(f => ({ ...f, region_id: e.target.value }))}>
                <option value="">All Regions</option>{regions.map(r => <option key={r.id} value={r.id}>{r.region_name}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Linked Product</label>
              <select className="form-select" value={form.linked_product_id} onChange={e => setForm(f => ({ ...f, linked_product_id: e.target.value }))}>
                <option value="">—</option>{products.map(p => <option key={p.part_number} value={p.part_number}>{p.name}</option>)}
              </select></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Start Date</label><input className="form-input" type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">End Date</label><input className="form-input" type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} /></div>
          </div>
        </form>
      </Modal>
    </div>
  )
}

const DETAIL_TABS = [
  { id: 'overview', label: 'Overview' }, { id: 'budget', label: 'Budget' }, { id: 'costs', label: 'Costs' },
  { id: 'channels', label: 'Channels' }, { id: 'results', label: 'Results' },
]

function CampaignDetail({ campaignId, profile, canEdit, types, regions, products, onBack, onChanged }) {
  const [tab, setTab] = useState('overview')
  const [campaign, setCampaign] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => { setLoading(true); setCampaign(await getCampaign(campaignId)); setLoading(false) }, [campaignId])
  useEffect(() => { load() }, [load])

  async function saveStatus(status) { await updateCampaign(campaignId, { status }); await load(); onChanged?.() }

  if (loading || !campaign) return <Loader />

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 10 }}><ArrowLeft size={14} /> Back to Campaigns</button>
      <div className="page-header" style={{ marginBottom: 14 }}>
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{campaign.campaign_name}
            {canEdit ? (
              <select className="form-select" style={{ fontSize: 11, width: 130 }} value={campaign.status} onChange={e => saveStatus(e.target.value)}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : <StatusBadge status={campaign.status === 'Active' ? 'active' : 'draft'} />}
          </div>
          <div className="page-subtitle">{campaign.campaign_type} · {campaign.domain || 'Cross-domain'} · {campaign.region?.region_name || 'All Regions'} · Owner: {campaign.owner?.full_name || '—'}</div>
        </div>
      </div>

      <Tabs tabs={DETAIL_TABS} active={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12 }}>
            <Info label="Start Date" value={campaign.start_date ? dateFmt(campaign.start_date) : '—'} />
            <Info label="End Date" value={campaign.end_date ? dateFmt(campaign.end_date) : '—'} />
            <Info label="Linked Product" value={products.find(p => p.part_number === campaign.linked_product_id)?.name || '—'} />
          </div>
        </div>
      )}
      {tab === 'budget' && <BudgetTab campaignId={campaignId} canEdit={canEdit} />}
      {tab === 'costs' && <CostsTab campaignId={campaignId} canEdit={canEdit} profile={profile} />}
      {tab === 'channels' && <ChannelsTab campaignId={campaignId} canEdit={canEdit} />}
      {tab === 'results' && <ResultsTab campaignId={campaignId} />}
    </div>
  )
}

function Info({ label, value }) {
  return <div><div style={{ fontSize: 10.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div><div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{value}</div></div>
}

function BudgetTab({ campaignId, canEdit }) {
  const [rows, setRows] = useState([])
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ budget_line_id: '', planned_spend: '', currency: 'INR' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const [r, l] = await Promise.all([listCampaignBudgets(campaignId), listMarketingBudgetLines()])
    setRows(r); setLines(l); setLoading(false)
  }
  async function save() {
    if (!form.budget_line_id) { setErr('Select a budget line'); return }
    setSaving(true); setErr('')
    try { await addCampaignBudget({ campaignId, budgetLineId: form.budget_line_id, plannedSpend: form.planned_spend, currency: form.currency }); setShowModal(false); setForm({ budget_line_id: '', planned_spend: '', currency: 'INR' }); await load() }
    catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  if (loading) return <Loader />
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Budget Lines</div>
        {canEdit && <button className="btn btn-outline btn-sm" onClick={() => setShowModal(true)}><Plus size={12} /> Link Budget Line</button>}
      </div>
      {rows.length === 0 ? <Empty icon="💰" title="No budget linked" desc="Link an approved marketing budget line to this campaign" /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Period</th><th>Planned Spend</th><th>Budget Line Amount</th><th>Approved</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id}><td className="td-bold">{r.budget_line?.period_label}</td><td>{rupee(r.planned_spend)}</td><td>{rupee(r.budget_line?.planned_amount)}</td><td><StatusBadge status={r.budget_line?.approved_by ? 'approved' : 'draft'} /></td></tr>
          ))}</tbody>
        </table></div>
      )}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Link Budget Line"
        footer={<><button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Link'}</button></>}>
        {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="form-group"><label className="form-label">Budget Line</label>
          <select className="form-select" value={form.budget_line_id} onChange={e => setForm(f => ({ ...f, budget_line_id: e.target.value }))}>
            <option value="">Select…</option>{lines.map(l => <option key={l.id} value={l.id}>{l.period_label} ({rupee(l.planned_amount)}{l.approved_by ? ', approved' : ', not yet approved'})</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">Planned Spend for this Campaign</label><input className="form-input" type="number" value={form.planned_spend} onChange={e => setForm(f => ({ ...f, planned_spend: e.target.value }))} /></div>
      </Modal>
    </div>
  )
}

function CostsTab({ campaignId, canEdit, profile }) {
  const [rows, setRows] = useState([])
  const [costTypes, setCostTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ cost_type: '', amount: '', incurred_date: new Date().toISOString().slice(0, 10), notes: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const [r, ct] = await Promise.all([listCostEntries(campaignId), listLookup('costTypes')])
    setRows(r); setCostTypes(ct)
    if (!form.cost_type && ct.length) setForm(f => ({ ...f, cost_type: ct[0].name }))
    setLoading(false)
  }
  async function save() {
    if (!form.cost_type || !(Number(form.amount) > 0)) { setErr('Cost type and a positive amount are required'); return }
    setSaving(true); setErr('')
    try { await addCostEntry({ campaign_id: campaignId, ...form }, profile.id); setShowModal(false); await load() }
    catch (e) { setErr(e.message) } finally { setSaving(false) }
  }
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0)

  if (loading) return <Loader />
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Cost Entries — {rupee(total)} total</div>
        {canEdit && <button className="btn btn-outline btn-sm" onClick={() => setShowModal(true)}><Plus size={12} /> Log Cost</button>}
      </div>
      {rows.length === 0 ? <Empty icon="🧾" title="No cost entries yet" desc="Log ad spend, event costs, content production etc." /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Type</th><th>Amount</th><th>Date</th><th>Notes</th>{canEdit && <th></th>}</tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id}><td className="td-bold">{r.cost_type}</td><td>{rupee(r.amount)}</td><td style={{ fontSize: 12 }}>{dateFmt(r.incurred_date)}</td><td style={{ fontSize: 12, color: '#94a3b8' }}>{r.notes || '—'}</td>
              {canEdit && <td><button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={async () => { await deleteCostEntry(r.id, campaignId); load() }}><Trash2 size={12} /></button></td>}
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Log Cost Entry"
        footer={<><button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></>}>
        {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="form-row">
          <div className="form-group"><label className="form-label">Cost Type</label>
            <select className="form-select" value={form.cost_type} onChange={e => setForm(f => ({ ...f, cost_type: e.target.value }))}>
              {costTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select></div>
          <div className="form-group"><label className="form-label">Amount</label><input className="form-input" type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
        </div>
        <div className="form-group"><label className="form-label">Date Incurred</label><input className="form-input" type="date" value={form.incurred_date} onChange={e => setForm(f => ({ ...f, incurred_date: e.target.value }))} /></div>
        <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
      </Modal>
    </div>
  )
}

function ChannelsTab({ campaignId, canEdit }) {
  const [rows, setRows] = useState([])
  const [landingLinks, setLandingLinks] = useState([])
  const [bootstrapPrograms, setBootstrapPrograms] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [channelType, setChannelType] = useState('Landing Page')
  const [pick, setPick] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const [r, ll, bp] = await Promise.all([listChannelLinks(campaignId), listLandingLinks(), listBootstrapPrograms()])
    setRows(r); setLandingLinks(ll); setBootstrapPrograms(bp)
    setLoading(false)
  }
  async function save() {
    setSaving(true); setErr('')
    try {
      if (channelType === 'Landing Page') { if (!pick) { setErr('Select a landing link'); setSaving(false); return } await linkLandingPage(campaignId, pick) }
      else if (channelType === 'Bootstrap Program') { if (!pick) { setErr('Select a bootstrap program'); setSaving(false); return } await linkBootstrapProgram(campaignId, pick) }
      else await linkOther(campaignId, channelType, notes)
      setShowModal(false); setPick(''); setNotes(''); await load()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  if (loading) return <Loader />
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}><Link2 size={14} /> Channels</div>
        {canEdit && <button className="btn btn-outline btn-sm" onClick={() => setShowModal(true)}><Plus size={12} /> Attach Channel</button>}
      </div>
      {rows.length === 0 ? <Empty icon="🔗" title="No channels attached" desc="Link a Landing Page, Bootstrap Program, or describe a Direct Outreach effort" /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Channel Type</th><th>Detail</th>{canEdit && <th></th>}</tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id}>
              <td className="td-bold">{r.channel_type}</td>
              <td style={{ fontSize: 12 }}>{r.landing_page ? `/l/${r.landing_page.slug}` : r.bootstrap_program?.program_name || r.notes || '—'}</td>
              {canEdit && <td><button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={async () => { await deleteChannelLink(r.id, campaignId); load() }}><Trash2 size={12} /></button></td>}
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Attach Channel"
        footer={<><button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Attach'}</button></>}>
        {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="form-group"><label className="form-label">Channel Type</label>
          <select className="form-select" value={channelType} onChange={e => { setChannelType(e.target.value); setPick('') }}>
            <option value="Landing Page">Landing Page</option><option value="Bootstrap Program">Bootstrap Program</option>
            <option value="Direct Outreach">Direct Outreach</option><option value="Other">Other</option>
          </select></div>
        {channelType === 'Landing Page' && (
          <div className="form-group"><label className="form-label">Landing Link</label>
            <select className="form-select" value={pick} onChange={e => setPick(e.target.value)}>
              <option value="">Select…</option>{landingLinks.map(l => <option key={l.id} value={l.id}>{l.campaign_name} (/l/{l.slug})</option>)}
            </select></div>
        )}
        {channelType === 'Bootstrap Program' && (
          <div className="form-group"><label className="form-label">Bootstrap Program</label>
            <select className="form-select" value={pick} onChange={e => setPick(e.target.value)}>
              <option value="">Select…</option>{bootstrapPrograms.map(b => <option key={b.id} value={b.id}>{b.program_name}</option>)}
            </select></div>
        )}
        {(channelType === 'Direct Outreach' || channelType === 'Other') && (
          <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Describe this outreach effort" /></div>
        )}
      </Modal>
    </div>
  )
}

function ResultsTab({ campaignId }) {
  const [result, setResult] = useState(undefined)
  useEffect(() => { getCampaignResult(campaignId).then(setResult) }, [campaignId])
  if (result === undefined) return <Loader />
  if (!result) return <div className="card" style={{ padding: '20px 24px' }}><Empty icon="📊" title="No results yet" desc="Results populate as leads come in, costs are logged, and opportunities progress" /></div>
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 16 }}>
        <StatCard label="Leads Generated" value={result.leads_generated} icon={<Megaphone size={16} />} accent="#0ea5e9" />
        <StatCard label="Opportunities" value={result.opportunities_created} icon={<TrendingUp size={16} />} accent="#4338ca" />
        <StatCard label="Deals Won" value={result.deals_won} icon={<TrendingUp size={16} />} accent="#15803d" />
        <StatCard label="Actual Spend" value={rupee(result.actual_spend)} icon={<Wallet size={16} />} accent="#dc2626" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 10 }}>Projected (Booked)</div>
          <Info label="Revenue Attributed" value={rupee(result.revenue_attributed_projected)} />
          <div style={{ marginTop: 10 }}><Info label="Cost per Lead" value={rupee(result.cost_per_lead)} /></div>
          <div style={{ marginTop: 10 }}><Info label="Cost per Won Deal" value={rupee(result.cost_per_won_deal)} /></div>
          <div style={{ marginTop: 10 }}><Info label="ROI %" value={`${result.roi_percent_projected}%`} /></div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 10 }}>Realized (Delivered Profit)</div>
          <Info label="Revenue Attributed" value={rupee(result.revenue_attributed_realized)} />
          <div style={{ marginTop: 10, fontSize: 11, color: '#94a3b8' }}>Populates once a won deal's linked project has a computed profit margin.</div>
          <div style={{ marginTop: 10 }}><Info label="ROI %" value={`${result.roi_percent_realized}%`} /></div>
        </div>
      </div>
    </div>
  )
}
