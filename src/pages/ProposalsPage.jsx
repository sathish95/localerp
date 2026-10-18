import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts'
import { supabase, rupee, dateFmt } from '../lib/supabase'
import {
  PROPOSAL_CATEGORIES, RESOURCE_PLAN_CATEGORIES, MISC_CAPABLE_CATEGORIES, ERP_SYSTEM_OPTIONS, MISC_LINE_TYPES, HOURS_PER_WEEK,
  listProposals, getProposal, getProposalVersions, createProposal, updateProposal, createRevision,
  getCostSections, updateCostSection, addCostSection, deleteCostSection, BUDGET_CATEGORIES,
  listBudgetCategories, getBudgetCategoryMap,
  addResourcePlan, updateResourcePlan, deleteResourcePlan,
  addHardwareLine, updateHardwareLine, deleteHardwareLine,
  addSoftwareLine, updateSoftwareLine, deleteSoftwareLine,
  addMiscLine, updateMiscLine, deleteMiscLine,
  listVendorCosts, addVendorCost, deleteVendorCost,
  listTimeline, addTimelinePhase, updateTimelinePhase, deleteTimelinePhase,
  computeValueSummary, getValueSummary, markWon, markLost, markExpired,
  listDesignationOptions, listProductOptions, listSoftwareItemSuggestions, listEmployeeOptions,
  duplicateProposal,
} from '../lib/proposals'
import * as proposalApproval from '../lib/proposalApproval'
import { exportProposalPDF, exportProposalExcel } from '../lib/proposalExport'
import {
  shareLinkUrl, getOrCreateShareLink, listShareLinks, setShareLinkExpiry, revokeShareLink,
  listChangeRequests, reviewChangeRequest,
} from '../lib/proposalShare'
import { createProjectFromProposal } from '../lib/proposalConvert'
import { getActiveTemplate } from '../lib/documentTemplates'
import { Modal, SearchBox, Loader, Empty, Confirm, StatCard, ApprovalChain } from '../components/ui'
import {
  FileText, Plus, Edit2, Trash2, Download, ShieldCheck, CheckCircle, XCircle, X, Save,
  ChevronRight, Users, Package, Wallet, TrendingUp, Clock, LayoutGrid,
  CalendarRange, Truck, GitBranch, Settings2, ArrowLeft, Monitor, Plane,
  Code2, Cpu, Wrench, Database, Cloud, FileSpreadsheet, Lock, Layers,
  Link2, Copy, Ban, Inbox,
} from 'lucide-react'

const STATUS_COLOR = {
  Draft: { bg: '#f1f5f9', color: '#475569' }, 'In Negotiation': { bg: '#fef3c7', color: '#b45309' },
  'Ready for Approval': { bg: '#e0e7ff', color: '#4338ca' }, Approved: { bg: '#dcfce7', color: '#15803d' },
  'Revision Requested': { bg: '#fee2e2', color: '#dc2626' }, Won: { bg: '#dcfce7', color: '#15803d' },
  Lost: { bg: '#f1f5f9', color: '#64748b' }, Expired: { bg: '#f1f5f9', color: '#94a3b8' },
}
const StatusPill = ({ status }) => {
  const c = STATUS_COLOR[status] || STATUS_COLOR.Draft
  return <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: c.bg, color: c.color, whiteSpace: 'nowrap' }}>{status}</span>
}

const DETAIL_TABS = [
  { id: 'overview', label: 'Overview', icon: FileText },
  { id: 'sections', label: 'Cost Sections', icon: LayoutGrid },
  { id: 'timeline', label: 'Timeline', icon: CalendarRange },
  { id: 'summary', label: 'Value Summary', icon: TrendingUp },
  { id: 'vendors', label: 'Vendor Costs', icon: Truck },
  { id: 'approval', label: 'Approval', icon: ShieldCheck },
  { id: 'export', label: 'Export', icon: Download },
  { id: 'share', label: 'Client Link', icon: Link2 },
  { id: 'versions', label: 'Versions', icon: GitBranch },
]

export default function ProposalsPage() {
  const { profile } = useAuth()
  const role = profile?.role || 'employee'
  const isSalesLead = ['admin', 'ceo', 'sales_lead'].includes(role)
  const canEdit = ['admin', 'ceo', 'sales_lead'].includes(role)
  const canViewInternal = ['admin', 'ceo', 'finance', 'cto'].includes(role)
  const isFinanceOrAbove = ['admin', 'ceo', 'finance'].includes(role)
  const canManageTemplates = ['admin', 'ceo', 'finance'].includes(role)
  const navigate = useNavigate()

  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('id') || ''

  const [proposals, setProposals] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ proposal_name: '', customer_name: '', customer_contact: '', validity_until_date: '', overall_margin_percent: 20, currency: 'INR' })
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState('')
  const [duplicatingId, setDuplicatingId] = useState('')
  const [dupErr, setDupErr] = useState('')

  useEffect(() => { loadList() }, [])
  useEffect(() => { proposalApproval.warmChains() }, [])

  async function loadList() {
    setLoading(true)
    setProposals(await listProposals())
    setLoading(false)
  }

  function selectProposal(id) { setSearchParams(id ? { id } : {}) }

  // Full standalone copy — new proposal_group_id/id, version 1, Draft, no
  // approval history/linked project. Jumps straight into the new copy so
  // the user can rename it and start editing right away.
  async function duplicate(id) {
    setDuplicatingId(id); setDupErr('')
    try {
      const newId = await duplicateProposal(id, profile.id)
      await loadList()
      selectProposal(newId)
    } catch (e) { setDupErr(e.message) }
    finally { setDuplicatingId('') }
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!createForm.proposal_name || !createForm.customer_name) { setCreateErr('Proposal name and customer are required'); return }
    setCreating(true); setCreateErr('')
    try {
      const p = await createProposal(createForm, profile.id)
      setShowCreate(false); setCreateForm({ proposal_name: '', customer_name: '', customer_contact: '', validity_until_date: '', overall_margin_percent: 20, currency: 'INR' })
      await loadList()
      selectProposal(p.id)
    } catch (e) { setCreateErr(e.message) }
    finally { setCreating(false) }
  }

  const filtered = proposals.filter(p =>
    (!search || p.proposal_name?.toLowerCase().includes(search.toLowerCase()) || p.customer_name?.toLowerCase().includes(search.toLowerCase()) || p.proposal_number?.toLowerCase().includes(search.toLowerCase())) &&
    (!statusFilter || p.status === statusFilter)
  )

  if (loading) return <Loader />

  if (selectedId) {
    return (
      <ProposalDetail
        key={selectedId} proposalId={selectedId} profile={profile} role={role}
        canEdit={canEdit} canViewInternal={canViewInternal} isFinanceOrAbove={isFinanceOrAbove}
        onChanged={loadList} onSelectProposal={selectProposal} onBack={() => selectProposal('')}
      />
    )
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--c1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <FileText size={19} />
            </span>
            Proposals
          </div>
          <div className="page-subtitle">Pre-sales cost proposals — internal cost, margin and customer price, never confused with each other</div>
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 8 }}>
          {canManageTemplates && (
            <button className="btn btn-outline" onClick={() => navigate('/settings?tab=document-templates')} title="Manage export templates for Proposals, Invoices, Delivery Notes, Warranty and GRN">
              <Settings2 size={15} /> Manage Templates
            </button>
          )}
          {isSalesLead && (
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} /> New Proposal</button>
          )}
        </div>
      </div>

      <>
          <div className="stats-grid" style={{ marginBottom: 16 }}>
            <StatCard label="Total Proposals" value={proposals.length} icon={<FileText size={17} />} accent="#6366f1" />
            <StatCard label="Ready for Approval" value={proposals.filter(p => p.status === 'Ready for Approval').length} icon={<ShieldCheck size={17} />} accent="#4338ca" />
            <StatCard label="Won" value={proposals.filter(p => p.status === 'Won').length} icon={<CheckCircle size={17} />} accent="#15803d" />
            <StatCard label="In Negotiation" value={proposals.filter(p => p.status === 'In Negotiation').length} icon={<Clock size={17} />} accent="#b45309" />
          </div>

          <div className="card" style={{ padding: 12, marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: '1 1 260px', minWidth: 220 }}><SearchBox value={search} onChange={setSearch} placeholder="Search by name, customer or number…" /></div>
            <select className="form-select" style={{ fontSize: 12, width: 200 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              {Object.keys(STATUS_COLOR).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {dupErr && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{dupErr}</div>}

          {filtered.length === 0 ? (
            <div className="card" style={{ padding: '20px 24px' }}>
              <Empty icon={<FileText size={40} />} title="No proposals match" desc="Adjust your search or filter, or create a new proposal" />
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 14 }}>
              {filtered.map(p => (
                <div key={p.id} onClick={() => selectProposal(p.id)} role="button" tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') selectProposal(p.id) }} className="card" style={{
                  textAlign: 'left', padding: 16, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.proposal_name}>{p.proposal_name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <StatusPill status={p.status} />
                      {isSalesLead && (
                        <button type="button" title="Duplicate this proposal" disabled={duplicatingId === p.id}
                          onClick={e => { e.stopPropagation(); duplicate(p.id) }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 2, display: 'flex' }}>
                          <Copy size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{p.proposal_number} · v{p.version}</div>
                  <div style={{ fontSize: 12.5, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}><Users size={12} /> {p.customer_name}</div>
                  {p.validity_until_date && <div style={{ fontSize: 11, color: '#94a3b8' }}>Valid until {dateFmt(p.validity_until_date)}</div>}
                </div>
              ))}
            </div>
          )}
        </>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Proposal" size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>{creating ? 'Creating…' : 'Create Proposal'}</button>
        </>}>
        <form onSubmit={handleCreate}>
          {createErr && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{createErr}</div>}
          <div className="form-row">
            <div className="form-group"><label className="form-label">Proposal Name *</label><input className="form-input" value={createForm.proposal_name} onChange={e => setCreateForm(f => ({ ...f, proposal_name: e.target.value }))} required /></div>
            <div className="form-group"><label className="form-label">Customer *</label><input className="form-input" value={createForm.customer_name} onChange={e => setCreateForm(f => ({ ...f, customer_name: e.target.value }))} required /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Customer Contact</label><input className="form-input" value={createForm.customer_contact} onChange={e => setCreateForm(f => ({ ...f, customer_contact: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Valid Until</label><input className="form-input" type="date" value={createForm.validity_until_date} onChange={e => setCreateForm(f => ({ ...f, validity_until_date: e.target.value }))} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Default Margin (%)</label><input className="form-input" type="number" step="0.1" value={createForm.overall_margin_percent} onChange={e => setCreateForm(f => ({ ...f, overall_margin_percent: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Currency</label><input className="form-input" value={createForm.currency} onChange={e => setCreateForm(f => ({ ...f, currency: e.target.value }))} /></div>
          </div>
        </form>
      </Modal>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   DETAIL — one proposal, vertical-rail tabbed
   ══════════════════════════════════════════════════════════════ */
function ProposalDetail({ proposalId, profile, role, canEdit, canViewInternal, isFinanceOrAbove, onChanged, onSelectProposal, onBack }) {
  const [tab, setTab] = useState('overview')
  const [proposal, setProposal] = useState(null)
  const [sections, setSections] = useState([])
  const [summary, setSummary] = useState(null)
  const [timeline, setTimeline] = useState([])
  const [vendorCosts, setVendorCosts] = useState([])
  const [versions, setVersions] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const p = await getProposal(proposalId)
    const [sec, sum, tl, vc, vers] = await Promise.all([
      getCostSections(proposalId), getValueSummary(proposalId), listTimeline(proposalId),
      listVendorCosts(proposalId), getProposalVersions(p.proposal_group_id),
    ])
    setProposal(p); setSections(sec); setSummary(sum); setTimeline(tl); setVendorCosts(vc); setVersions(vers)
    setLoading(false)
  }, [proposalId])

  useEffect(() => { load() }, [load])

  // force=true is required once the proposal has left Draft/In Negotiation —
  // computeValueSummary() otherwise returns the frozen snapshot as-is (by
  // design, so a sent quotation can't silently drift). A margin edited from
  // the Approval tab's Cost Breakdown panel is a deliberate reviewer action
  // during "Ready for Approval", so that one path always forces a recompute.
  async function recompute(force = false) {
    setBusy(true)
    try { setSummary(await computeValueSummary(proposalId, { force })) }
    catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function refreshAll() { await load(); onChanged?.() }

  if (loading || !proposal) return <Loader />

  const canActOnCurrentStage = proposal.approval_status && proposalApproval.canActOnSync(role, proposal.approval_status)
  const isDraftLike = ['Draft', 'In Negotiation'].includes(proposal.status)
  const totalDevicesRequired = sections.reduce((s, sec) => s + (sec.hardwareLines || []).reduce((s2, h) => s2 + (Number(h.estimated_quantity) || 0), 0), 0)
  const saasLinesCount = sections.reduce((s, sec) => s + (sec.softwareLines || []).length, 0)

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 10 }}><ArrowLeft size={14} /> Back to Proposals</button>

      <div className="page-header" style={{ marginBottom: 14 }}>
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span title={proposal.proposal_name}>{proposal.proposal_name}</span>
            <StatusPill status={proposal.status} />
          </div>
          <div className="page-subtitle" style={{ fontFamily: 'monospace' }}>{proposal.proposal_number} · v{proposal.version}</div>
        </div>
      </div>

      {/* Segmented tab control — single row, no wrap, active segment reads as an
          inset white/accent chip inside a light track (enterprise console pattern,
          replaces the old filled-pill rail which wrapped onto multiple lines). */}
      <div style={{
        display: 'flex', gap: 2, flexWrap: 'nowrap', overflowX: 'auto', marginBottom: 18,
        background: 'var(--surface-2, #f1f5f9)', border: '1px solid var(--border)', borderRadius: 12, padding: 4,
      }}>
        {DETAIL_TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: 'none',
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: active ? 700 : 500, flexShrink: 0,
                background: active ? '#fff' : 'transparent', color: active ? 'var(--c1)' : 'var(--text-soft, #334155)',
                boxShadow: active ? '0 1px 3px rgba(0,0,0,.1), 0 1px 2px rgba(0,0,0,.06)' : 'none',
              }}>
              <Icon size={14} style={{ flexShrink: 0 }} />
              <span>{t.label}</span>
              {t.id === 'versions' && versions.length > 1 && (
                <span style={{ fontSize: 10, background: active ? 'var(--c1)' : 'var(--border)', color: active ? '#fff' : 'inherit', padding: '1px 6px', borderRadius: 999 }}>{versions.length}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div style={{ minWidth: 0 }}>
        {/* Sticky-feeling KPI strip, always visible regardless of tab */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
          <MiniKpi label="Customer Price" value={summary ? rupee(summary.total_customer_price) : '—'} accent="#6366f1" icon={<Wallet size={15} />} />
          {canViewInternal && summary && <MiniKpi label="Internal Cost" value={rupee(summary.total_internal_cost)} accent="#64748b" icon={<Lock size={15} />} />}
          {canViewInternal && summary && <MiniKpi label="Margin" value={`${summary.projected_margin_percent}%`} accent="#8b5cf6" icon={<TrendingUp size={15} />} />}
          <MiniKpi label="Devices Required" value={totalDevicesRequired} accent="#0ea5e9" icon={<Monitor size={15} />} />
          <MiniKpi label="SaaS Lines" value={saasLinesCount} accent="#14b8a6" icon={<Cloud size={15} />} />
        </div>

        {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}

        {tab === 'overview' && (
          <OverviewTab proposal={proposal} sections={sections} canEdit={canEdit && isDraftLike} onSaved={refreshAll}
            onSectionsChanged={async () => { await load(); await recompute() }} />
        )}

        {tab === 'sections' && (
          <CostSectionsTab proposalId={proposalId} sections={sections} canEdit={canEdit && isDraftLike}
            defaultMargin={proposal.overall_margin_percent}
            onChanged={async () => { await load(); await recompute() }} />
        )}

        {tab === 'timeline' && (
          <TimelineTab proposalId={proposalId} timeline={timeline} sections={sections} canEdit={canEdit && isDraftLike}
            onChanged={async () => { await load(); await recompute() }} />
        )}

        {tab === 'summary' && (
          <ValueSummaryTab summary={summary} proposal={proposal} sections={sections} canViewInternal={canViewInternal} busy={busy} onRecompute={recompute} />
        )}

        {tab === 'vendors' && <VendorCostsTab proposalId={proposalId} vendorCosts={vendorCosts} canEdit={canEdit && isDraftLike} onChanged={load} />}

        {tab === 'approval' && (
          <ApprovalTab proposal={proposal} summary={summary} sections={sections} canViewInternal={canViewInternal}
            profile={profile} role={role} canEdit={canEdit} canActOnCurrentStage={canActOnCurrentStage}
            isFinanceOrAbove={isFinanceOrAbove} onChanged={refreshAll} onSelectProposal={onSelectProposal}
            onSectionsChanged={async () => { await load(); await recompute(true) }} />
        )}

        {tab === 'export' && <ExportTab proposal={proposal} summary={summary} canViewInternal={canViewInternal} />}

        {tab === 'share' && (
          <ShareTab proposalId={proposalId} profile={profile} canEdit={canEdit}
            sections={sections} canViewInternal={canViewInternal} defaultMargin={proposal.overall_margin_percent}
            marginEditable={['Draft', 'In Negotiation', 'Ready for Approval'].includes(proposal.status)}
            onChangesApplied={async () => { await load(); await recompute(true) }} />
        )}

        {tab === 'versions' && <VersionsTab versions={versions} />}
      </div>
    </div>
  )
}

function MiniKpi({ label, value, accent, icon }) {
  return (
    <div className="stat-card" style={{ borderTop: '1.5px solid var(--border)', borderLeft: `4px solid ${accent}`, padding: '12px 14px' }}>
      <div style={{ width: 28, height: 28, borderRadius: 8, background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: accent }}>{value}</div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 2 }}>{label}</div>
    </div>
  )
}

/* ── Overview ── */
const HAPPY_PATH_STATUSES = ['Draft', 'In Negotiation', 'Ready for Approval', 'Approved', 'Won']
const OFF_PATH_STATUSES = ['Revision Requested', 'Lost', 'Expired']

function StatusStepper({ status }) {
  const offPath = OFF_PATH_STATUSES.includes(status)
  const idx = HAPPY_PATH_STATUSES.indexOf(status)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: offPath ? 10 : 0 }}>
      {HAPPY_PATH_STATUSES.map((s, i) => {
        const done = !offPath && i < idx
        const active = !offPath && i === idx
        const c = STATUS_COLOR[s]
        return (
          <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < HAPPY_PATH_STATUSES.length - 1 ? 1 : 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 800, flexShrink: 0,
                background: done || active ? c.color : '#f1f5f9', color: done || active ? '#fff' : '#94a3b8',
                border: active ? `2px solid ${c.color}` : 'none', boxShadow: active ? `0 0 0 3px ${c.color}25` : 'none',
              }}>{done ? '✓' : i + 1}</div>
              <div style={{ fontSize: 9.5, fontWeight: active ? 700 : 500, color: active ? c.color : '#94a3b8', whiteSpace: 'nowrap' }}>{s}</div>
            </div>
            {i < HAPPY_PATH_STATUSES.length - 1 && <div style={{ height: 2, flex: 1, background: done ? c.color : '#e2e8f0', marginBottom: 14 }} />}
          </div>
        )
      })}
      {offPath && <div style={{ marginLeft: 12 }}><StatusPill status={status} /></div>}
    </div>
  )
}

function OverviewTab({ proposal, sections, canEdit, onSaved, onSectionsChanged }) {
  const [form, setForm] = useState({ ...proposal })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { setForm({ ...proposal }) }, [proposal])

  async function save() {
    if (!form.proposal_name?.trim() || !form.customer_name?.trim()) { setErr('Proposal name and customer are required.'); return }
    setSaving(true); setErr('')
    try {
      await updateProposal(proposal.id, {
        proposal_name: form.proposal_name, customer_name: form.customer_name, customer_contact: form.customer_contact,
        validity_until_date: form.validity_until_date || null, overall_margin_percent: form.overall_margin_percent, currency: form.currency,
      })
      onSaved()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div>
      <div style={{ padding: '16px 18px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 12 }}>Deal Progress</div>
        <StatusStepper status={proposal.status} />
      </div>

      {proposal.linked_project_id && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, background: '#dcfce7', fontSize: 12, color: '#15803d', fontWeight: 600, marginBottom: 20 }}>
          <CheckCircle size={14} /> Converted to project
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ padding: 16, borderRadius: 12, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}><Truck size={13} /> Customer Details</div>
          <div className="form-group"><label className="form-label">Proposal Name</label><input className="form-input" disabled={!canEdit} value={form.proposal_name || ''} onChange={e => setForm(f => ({ ...f, proposal_name: e.target.value }))} /></div>
          <div className="form-group"><label className="form-label">Customer</label><input className="form-input" disabled={!canEdit} value={form.customer_name || ''} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))} /></div>
          <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Customer Contact</label><input className="form-input" disabled={!canEdit} value={form.customer_contact || ''} onChange={e => setForm(f => ({ ...f, customer_contact: e.target.value }))} /></div>
        </div>

        <div style={{ padding: 16, borderRadius: 12, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}><Wallet size={13} /> Commercial Terms</div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Default Margin (%)</label><input className="form-input" type="number" step="0.1" disabled={!canEdit} value={form.overall_margin_percent ?? ''} onChange={e => setForm(f => ({ ...f, overall_margin_percent: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Currency</label><input className="form-input" disabled={!canEdit} value={form.currency || ''} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} /></div>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Valid Until</label><input className="form-input" type="date" disabled={!canEdit} value={form.validity_until_date || ''} onChange={e => setForm(f => ({ ...f, validity_until_date: e.target.value }))} /></div>
        </div>
      </div>

      {err && <div className="alert alert-danger" style={{ marginTop: 16, marginBottom: 0 }}>{err}</div>}
      {canEdit && <button className="btn btn-primary btn-sm" onClick={save} disabled={saving} style={{ marginTop: 16 }}>{saving ? 'Saving…' : 'Save'}</button>}
      {!canEdit && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 16 }}>Read-only — editing is only available while the proposal is Draft or In Negotiation.</div>}

      {sections && <DomainMarginPanel sections={sections} defaultMargin={proposal.overall_margin_percent} canEdit={canEdit} onChanged={onSectionsChanged} />}
    </div>
  )
}

/* Domain-wise commercial terms — margin can be overridden per category
   instead of one blanket rate; falls back to the proposal's Default Margin
   above when left blank. Same field (proposal_cost_sections.margin_percent)
   the Cost Sections tab's "Margin Override %" edits — this is just a
   faster, all-categories-at-once view of it. */
function DomainMarginPanel({ sections, defaultMargin, canEdit, onChanged }) {
  const [savingId, setSavingId] = useState('')
  const [err, setErr] = useState('')
  async function saveMargin(section, value) {
    if (value !== '' && (isNaN(Number(value)) || Number(value) < -100 || Number(value) > 500)) {
      setErr(`${section.category}: margin must be a number between -100 and 500.`)
      return
    }
    setSavingId(section.id); setErr('')
    try {
      await updateCostSection(section.id, { margin_percent: value === '' ? null : Number(value), notes: section.notes })
      await onChanged?.()
    } catch (e) { setErr(e.message) }
    finally { setSavingId('') }
  }
  return (
    <div style={{ marginTop: 20, padding: 16, borderRadius: 12, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}><Settings2 size={13} /> Domain-wise Margin</div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 14 }}>Override the margin per cost category — leave blank to use the {defaultMargin ?? 0}% default above.</div>
      {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {orderedCategories(sections).map((cat, i) => {
          const section = sections.find(s => s.category === cat)
          const isStandard = PROPOSAL_CATEGORIES.includes(cat)
          const t = themeFor(cat, isStandard ? 0 : sections.filter(s => !PROPOSAL_CATEGORIES.includes(s.category)).findIndex(s => s.category === cat))
          const Icon = t.icon
          if (!section) return null
          return (
            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10, border: `1px solid ${t.color}25`, background: `${t.color}0a` }}>
              <span style={{ width: 26, height: 26, borderRadius: 8, background: `${t.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.color, flexShrink: 0 }}><Icon size={13} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cat}>
                  {cat}{!isStandard && <span style={{ marginLeft: 5, fontSize: 8.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--c1)', border: '1px solid var(--c1)', borderRadius: 3, padding: '0 4px' }}>Custom</span>}
                </div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>
                  {sectionTotal(section) > 0 ? (
                    <>Cost {rupee(sectionTotal(section))} → Price {rupee(categorySectionPrice(section, defaultMargin))}</>
                  ) : 'no cost yet'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <input className="form-input" style={{ width: 56, fontSize: 12, padding: '4px 6px' }} type="number" step="0.1" disabled={!canEdit || savingId === section.id}
                  placeholder={String(defaultMargin ?? 0)} defaultValue={section.margin_percent ?? ''}
                  onBlur={e => { if (e.target.value !== String(section.margin_percent ?? '')) saveMargin(section, e.target.value) }}
                  onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }} />
                <span style={{ fontSize: 11, color: '#94a3b8' }}>%</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Cost Sections (resource plans / hardware / software / misc) —
   full-width per-domain view: top pill rail, domain-specific KPI strip,
   inline-editable tables (click a row to edit in place, no popup modal). ── */
const CATEGORY_THEME = {
  'Application Development': { icon: Code2, color: '#6366f1' },
  'Firmware Development': { icon: Cpu, color: '#8b5cf6' },
  'Hardware Design & Production': { icon: Wrench, color: '#f59e0b' },
  'ERP Integration': { icon: Database, color: '#0ea5e9' },
  'Hardware': { icon: Package, color: '#14b8a6' },
  'Software/SaaS/Third-Party': { icon: Cloud, color: '#ec4899' },
  'Miscellaneous': { icon: Plane, color: '#64748b' },
}
// Custom sections (STEP215) cycle through a small fixed palette by index
// rather than all sharing one look, so several custom categories on the
// same proposal stay visually distinguishable in the pill rail/overview.
const CUSTOM_THEME_PALETTE = [
  { icon: Layers, color: '#0891b2' }, { icon: Layers, color: '#d946ef' }, { icon: Layers, color: '#65a30d' },
  { icon: Layers, color: '#ea580c' }, { icon: Layers, color: '#4f46e5' },
]
function themeFor(cat, customIndex = 0) {
  return CATEGORY_THEME[cat] || CUSTOM_THEME_PALETTE[customIndex % CUSTOM_THEME_PALETTE.length]
}
/** Standard 7 first (canonical order), then any custom sections this proposal has added. */
function orderedCategories(sections) {
  const customCats = sections.map(s => s.category).filter(c => !PROPOSAL_CATEGORIES.includes(c))
  return [...PROPOSAL_CATEGORIES, ...customCats]
}
// Quick-pick suggestions for "+ Add Cost Section" — still fully free-text,
// this just saves retyping the org's own common IoT-project categories.
const CUSTOM_CATEGORY_SUGGESTIONS = ['IoT Logger', 'Sensors', 'SaaS Platform', 'Dev & Maintenance', 'QR Device', 'Installation']

function sectionTotal(section) {
  const r = (section.resourcePlans || []).reduce((s, x) => s + (Number(x.computed_cost) || 0), 0)
  const h = (section.hardwareLines || []).reduce((s, x) => s + (Number(x.subtotal_internal_cost) || 0), 0)
  const sw = (section.softwareLines || []).reduce((s, x) => s + (Number(x.computed_cost) || 0), 0)
  const m = (section.miscLines || []).reduce((s, x) => s + (Number(x.cost) || 0), 0)
  return r + h + sw + m
}

// Cost (internal) marked up by this section's own margin override, falling
// back to the proposal's overall margin — same rule computeValueSummary()
// applies for the proposal-wide total, just surfaced per-category here so
// the Cost tab shows Cost AND the resulting customer Price side by side,
// not just internal cost.
function categorySectionPrice(section, defaultMargin) {
  const cost = sectionTotal(section)
  const margin = Number(section.margin_percent ?? defaultMargin ?? 0)
  return cost * (1 + margin / 100)
}

// Appends a "Total Price" KPI (cost marked up by this section's own
// margin, or the proposal default) to whatever branch-specific KPIs
// domainKpisBase returns below — kept as a thin wrapper so the branch
// logic itself (unchanged) doesn't need touching in five places.
function domainKpis(section, defaultMargin) {
  const kpis = domainKpisBase(section)
  const cost = sectionTotal(section)
  const price = categorySectionPrice(section, defaultMargin)
  if (Math.round(price * 100) !== Math.round(cost * 100)) kpis.push({ label: 'Total Price', value: rupee(price) })
  return kpis
}

function domainKpisBase(section) {
  const cat = section.category
  const total = sectionTotal(section)
  if (!PROPOSAL_CATEGORIES.includes(cat)) {
    const lineCount = (section.hardwareLines || []).length + (section.softwareLines || []).length + (section.miscLines || []).length
    const units = (section.hardwareLines || []).reduce((s, h) => s + (Number(h.estimated_quantity) || 0), 0)
    const headcount = (section.resourcePlans || []).reduce((s, p) => s + (Number(p.estimated_count) || 0), 0)
    return [
      { label: 'Headcount', value: headcount },
      { label: 'Line Items', value: lineCount },
      { label: 'Units', value: units },
      { label: 'Total Cost', value: rupee(total) },
    ]
  }
  if (RESOURCE_PLAN_CATEGORIES.includes(cat)) {
    const plans = section.resourcePlans || []
    const resourceCost = plans.reduce((s, p) => s + (Number(p.computed_cost) || 0), 0)
    const headcount = plans.reduce((s, p) => s + (Number(p.estimated_count) || 0), 0)
    const peakWeeks = plans.reduce((s, p) => Math.max(s, Number(p.estimated_duration_weeks) || 0), 0)
    const totalHours = plans.reduce((s, p) => s + (Number(p.estimated_count) || 0) * (Number(p.estimated_duration_weeks) || 0) * HOURS_PER_WEEK, 0)
    const blendedRate = totalHours > 0 ? resourceCost / totalHours : 0
    const kpis = [
      { label: 'Headcount', value: headcount },
      { label: 'Peak Duration', value: `${peakWeeks} wk` },
      { label: 'Blended Rate', value: `${rupee(blendedRate)}/hr` },
    ]
    if (MISC_CAPABLE_CATEGORIES.includes(cat)) kpis.push({ label: cat === 'ERP Integration' ? 'ERP / Other Lines' : 'Install/Assembly Lines', value: (section.miscLines || []).length })
    kpis.push({ label: 'Total Cost', value: rupee(total) })
    return kpis
  }
  if (cat === 'Hardware') {
    const lines = section.hardwareLines || []
    return [
      { label: 'Total Units', value: lines.reduce((s, h) => s + (Number(h.estimated_quantity) || 0), 0) },
      { label: 'Line Items', value: lines.length },
      { label: 'Total Value', value: rupee(total) },
    ]
  }
  if (cat === 'Software/SaaS/Third-Party') {
    const lines = section.softwareLines || []
    const mrr = lines.filter(s => s.cost_type === 'Monthly').reduce((s, x) => s + (Number(x.unit_cost) || 0) * (Number(x.qty) || 1), 0)
    return [
      { label: 'Subscriptions', value: lines.length },
      { label: 'Monthly Recurring', value: rupee(mrr) },
      { label: 'Total Cost', value: rupee(total) },
    ]
  }
  // Miscellaneous
  const lines = section.miscLines || []
  const travel = lines.filter(m => ['Travel', 'Field Visit'].includes(m.line_type)).reduce((s, x) => s + (Number(x.cost) || 0), 0)
  return [
    { label: 'Line Items', value: lines.length },
    { label: 'Travel / Field Visit', value: rupee(travel) },
    { label: 'Total Cost', value: rupee(total) },
  ]
}

function CategoryCostOverview({ sections }) {
  const [open, setOpen] = useState(false)
  const cats = orderedCategories(sections)
  let customIdx = 0
  const rows = cats.map(cat => {
    const theme = themeFor(cat, PROPOSAL_CATEGORIES.includes(cat) ? 0 : customIdx++)
    return { category: cat, total: sectionTotal(sections.find(x => x.category === cat) || {}), theme }
  })
  const max = Math.max(1, ...rows.map(r => r.total))
  const grandTotal = rows.reduce((s, r) => s + r.total, 0)
  return (
    <div style={{ marginBottom: 16, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2, #f8fafc)' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', cursor: 'pointer',
          background: 'none', border: 'none', fontFamily: 'inherit',
        }}>
        <ChevronRight size={14} style={{ flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', color: 'var(--ink-muted)' }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Cost Distribution</span>
        <span style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 800 }}>{rupee(grandTotal)}</span>
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 14px 14px' }}>
          {rows.map(r => {
            const Icon = r.theme.icon
            const pct = max > 0 ? (r.total / max) * 100 : 0
            return (
              <div key={r.category} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 190, fontSize: 11.5, fontWeight: 600, color: 'var(--text-soft, #334155)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <Icon size={12} style={{ flexShrink: 0, color: 'var(--ink-muted)' }} /> {r.category}
                </div>
                <div style={{ flex: 1, height: 6, borderRadius: 999, background: 'var(--border)', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: 'var(--c1)', borderRadius: 999, transition: 'width .3s' }} />
                </div>
                <div style={{ width: 100, fontSize: 11.5, fontWeight: 700, textAlign: 'right', flexShrink: 0 }}>{rupee(r.total)}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Grouped left-hand nav (Standard categories, then Custom) instead of one
// long horizontal scrolling tab row — the same fix applied to ROI
// Planning's tab strip: a flat row of N standard + M custom categories
// (each carrying an icon + name + amount) overflows fast and forces
// horizontal scrolling. A vertical, grouped list doesn't.
function CostSectionNav({ cats, sections, active, onChange, canEdit, onAddClick, defaultMargin }) {
  const standard = cats.filter(c => PROPOSAL_CATEGORIES.includes(c))
  const custom = cats.filter(c => !PROPOSAL_CATEGORIES.includes(c))

  function Row({ cat }) {
    const s = sections.find(x => x.category === cat)
    const cost = s ? sectionTotal(s) : 0
    const price = s ? categorySectionPrice(s, defaultMargin) : 0
    const isActive = active === cat
    const CatIcon = themeFor(cat).icon
    return (
      <button key={cat} onClick={() => onChange(cat)} style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
        padding: '8px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        background: isActive ? 'var(--c1)' : 'transparent', color: isActive ? '#fff' : 'inherit',
      }}>
        <CatIcon size={13} style={{ flexShrink: 0, color: isActive ? '#fff' : 'var(--ink-muted)' }} />
        <span style={{ fontSize: 12.5, fontWeight: isActive ? 700 : 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat}</span>
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, opacity: isActive ? 0.9 : 0.7 }}>{rupee(cost)}</span>
          {price !== cost && <span style={{ fontSize: 9, fontWeight: 600, opacity: isActive ? 0.85 : 0.6 }}>→ {rupee(price)}</span>}
        </span>
      </button>
    )
  }

  return (
    <nav style={{ width: 230, flexShrink: 0, position: 'sticky', top: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted, #94a3b8)', marginBottom: 6, padding: '0 10px' }}>Standard Categories</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {standard.map(cat => <Row key={cat} cat={cat} />)}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted, #94a3b8)', marginBottom: 6, padding: '0 10px' }}>Custom Categories</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {custom.length === 0 && <div style={{ fontSize: 11, color: 'var(--ink-muted)', padding: '4px 10px' }}>None yet</div>}
          {custom.map(cat => <Row key={cat} cat={cat} />)}
        </div>
        {canEdit && (
          <button onClick={onAddClick} style={{
            display: 'flex', alignItems: 'center', gap: 6, width: '100%', marginTop: 6,
            padding: '8px 10px', borderRadius: 7, border: '1px dashed var(--border)', cursor: 'pointer',
            background: 'transparent', color: 'var(--c1)', fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
          }}>
            <Plus size={14} /> Add Cost Section
          </button>
        )}
      </div>
    </nav>
  )
}

function CostSectionsTab({ proposalId, sections, canEdit, defaultMargin, onChanged }) {
  const [openCategory, setOpenCategory] = useState(sections[0]?.category)
  const [designations, setDesignations] = useState([])
  const [employees, setEmployees] = useState([])
  const [products, setProducts] = useState([])
  const [softwareSuggestions, setSoftwareSuggestions] = useState([])
  const [showAddSection, setShowAddSection] = useState(false)

  useEffect(() => {
    listDesignationOptions().then(setDesignations)
    listEmployeeOptions().then(setEmployees)
    listProductOptions().then(setProducts)
    listSoftwareItemSuggestions().then(setSoftwareSuggestions)
  }, [])

  const cats = orderedCategories(sections)
  const section = sections.find(s => s.category === openCategory) || sections[0]
  const isCustomSection = section && !PROPOSAL_CATEGORIES.includes(section.category)
  const allResourcePlans = useMemo(() => sections.flatMap(s => (s.resourcePlans || []).map(r => ({ ...r, category: s.category }))), [sections])
  const theme = themeFor(section?.category)
  const Icon = theme.icon

  async function handleDeleteSection() {
    if (!window.confirm(`Remove the "${section.category}" cost section and all its lines? This cannot be undone.`)) return
    await deleteCostSection(section.id)
    setOpenCategory(sections.find(s => s.id !== section.id)?.category)
    onChanged()
  }

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <CostSectionNav cats={cats} sections={sections} active={section?.category} onChange={setOpenCategory}
        canEdit={canEdit} onAddClick={() => setShowAddSection(true)} defaultMargin={defaultMargin} />

      {showAddSection && (
        <AddCostSectionModal proposalId={proposalId} existingCategories={sections.map(s => s.category)}
          onClose={() => setShowAddSection(false)}
          onAdded={(cat) => { setShowAddSection(false); setOpenCategory(cat); onChanged() }} />
      )}

      <div style={{ flex: '1 1 420px', minWidth: 320 }}>
      <CategoryCostOverview sections={sections} />

      {section && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--surface-2, #f1f5f9)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c1)', flexShrink: 0 }}>
                <Icon size={15} />
              </span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {section.category}
                  {isCustomSection && <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--c1)', border: '1px solid var(--c1)', borderRadius: 4, padding: '1px 6px' }}>Custom</span>}
                </div>
                {section.category === 'Hardware Design & Production' && <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Design/engineering labor plus installation, assembly and other production cost — separate from the raw device cost under Hardware.</div>}
                {section.category === 'ERP Integration' && <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Pick which ERP system below, then the resource plan for the integration effort.</div>}
                {isCustomSection && <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Custom section — has its own margin, and can carry a resource plan (headcount/named employees), device/hardware lines, subscription/software lines and one-off misc lines below.</div>}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)' }}>Margin Override %</label>
                <input className="form-input" style={{ width: 80, fontSize: 12 }} type="number" step="0.1" disabled={!canEdit}
                  placeholder="default" value={section.margin_percent ?? ''}
                  onChange={async e => { await updateCostSection(section.id, { margin_percent: e.target.value === '' ? null : Number(e.target.value), notes: section.notes }); onChanged() }} />
              </div>
              {isCustomSection && canEdit && (
                <button onClick={handleDeleteSection} title="Remove this cost section" className="btn btn-outline btn-sm" style={{ color: 'var(--rose, #e11d48)', borderColor: 'var(--rose, #e11d48)' }}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Domain KPIs — one compact inline row, not a padded card grid. */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 0', marginBottom: 14,
            fontSize: 12, color: 'var(--text-soft, #334155)',
          }}>
            {domainKpis(section, defaultMargin).map((k, i) => (
              <span key={k.label} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5 }}>
                {i > 0 && <span style={{ margin: '0 10px', color: 'var(--border)' }}>|</span>}
                <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '.03em' }}>{k.label}</span>
                <span style={{ fontWeight: 700 }}>{k.value}</span>
              </span>
            ))}
          </div>

          {RESOURCE_PLAN_CATEGORIES.includes(section.category) && (
            <ResourceTable section={section} canEdit={canEdit} designations={designations} employees={employees} onChanged={onChanged} />
          )}
          {section.category === 'Hardware' && (
            <HardwareTable section={section} canEdit={canEdit} products={products} onChanged={onChanged} />
          )}
          {section.category === 'Software/SaaS/Third-Party' && (
            <SoftwareTable section={section} canEdit={canEdit} softwareSuggestions={softwareSuggestions} onChanged={onChanged} />
          )}
          {MISC_CAPABLE_CATEGORIES.includes(section.category) && (
            <MiscTable section={section} canEdit={canEdit} allResourcePlans={allResourcePlans} sections={sections} onChanged={onChanged} />
          )}
          {isCustomSection && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: 8 }}>Resource Plan (headcount / named employees)</div>
                <ResourceTable section={section} canEdit={canEdit} designations={designations} employees={employees} onChanged={onChanged} />
              </div>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: 8 }}>Device / Hardware Lines</div>
                <HardwareTable section={section} canEdit={canEdit} products={products} onChanged={onChanged} />
              </div>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: 8 }}>Subscription / Software Lines</div>
                <SoftwareTable section={section} canEdit={canEdit} softwareSuggestions={softwareSuggestions} onChanged={onChanged} />
              </div>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: 8 }}>Other / Misc Lines</div>
                <MiscTable section={section} canEdit={canEdit} allResourcePlans={allResourcePlans} sections={sections} onChanged={onChanged} />
              </div>
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  )
}

function AddCostSectionModal({ proposalId, existingCategories, onClose, onAdded }) {
  const [name, setName] = useState('')
  const [budgetCategory, setBudgetCategory] = useState('')
  const [budgetCats, setBudgetCats] = useState(BUDGET_CATEGORIES)
  const [preRegisteredMap, setPreRegisteredMap] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    listBudgetCategories().then(setBudgetCats)
    // Any category an admin already mapped in Settings -> Proposal Budget
    // Mapping (even one not used on any proposal yet) shows here as a
    // quick-pick too, not just the static suggestion list — picking one
    // also pre-fills its budget category.
    getBudgetCategoryMap().then(setPreRegisteredMap)
  }, [])

  const preRegistered = Object.keys(preRegisteredMap).filter(c => !PROPOSAL_CATEGORIES.includes(c))
  const suggestions = [...new Set([...CUSTOM_CATEGORY_SUGGESTIONS, ...preRegistered])].filter(s => !existingCategories.includes(s))

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) { setErr('Name is required'); return }
    if (existingCategories.some(c => c.toLowerCase() === trimmed.toLowerCase())) { setErr('A cost section with this name already exists on this proposal'); return }
    setBusy(true); setErr('')
    try {
      await addCostSection(proposalId, trimmed, budgetCategory || null)
      onAdded(trimmed)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title="Add Cost Section" footer={
      <><button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Adding…' : 'Add Section'}</button></>
    }>
      {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 5 }}>Section Name</label>
          <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. IoT Logger, Sensors, SaaS Platform, QR Device, Installation" autoFocus />
          {suggestions.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {suggestions.map(s => (
                <button key={s} type="button" onClick={() => { setName(s); if (preRegisteredMap[s]) setBudgetCategory(preRegisteredMap[s]) }}
                  style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface-2, #f8fafc)', cursor: 'pointer' }}>
                  + {s}
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', marginBottom: 5 }}>Roll up to Budget Category (optional)</label>
          <select className="form-input" value={budgetCategory} onChange={e => setBudgetCategory(e.target.value)}>
            <option value="">— Not mapped (won't flow into "Convert to Project" budgets) —</option>
            {budgetCats.map(o => <option key={o.value} value={o.value}>{o.label}{o.is_custom ? ' (custom)' : ''}</option>)}
          </select>
          <div style={{ fontSize: 10.5, color: 'var(--ink-muted)', marginTop: 4 }}>This section will get its own margin, just like the standard categories. Mapping it here also lets its cost seed a planned-budget line when this proposal is later converted to a project.</div>
        </div>
      </div>
    </Modal>
  )
}

/* Shared bits for inline-editable rows */
function RowIcons({ onEdit, onDelete }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onEdit}><Edit2 size={12} /></button>
      <button type="button" className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={onDelete}><Trash2 size={12} /></button>
    </div>
  )
}
function RowActions({ onSave, onCancel }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <button type="button" className="btn btn-primary btn-sm btn-icon" onClick={onSave}><Save size={12} /></button>
      <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onCancel}><X size={12} /></button>
    </div>
  )
}
function SectionLabel({ icon, children }) {
  return <div style={{ fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, color: '#334155', marginBottom: 8 }}>{icon} {children}</div>
}
const cellInput = { fontSize: 12, padding: '5px 8px' }

// Inline "rate card" suggestion panel — sits in normal document flow (not
// absolutely positioned) so it can't get clipped by .table-wrap's
// overflow:hidden, and shows a live rate/quantity preview per match instead
// of the single exact-match-only hint the plain datalist inputs gave.
function MatchSuggestions({ query, options, getLabel, getMeta, onPick, limit = 6 }) {
  if (!query || !query.trim()) return null
  const q = query.trim().toLowerCase()
  const matches = options.filter(o => getLabel(o).toLowerCase().includes(q)).slice(0, limit)
  if (!matches.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4, padding: 4, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
      {matches.map((o, i) => (
        <div key={i} onMouseDown={() => onPick(o)}
          style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, padding: '5px 7px', borderRadius: 6, cursor: 'pointer' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#eef2ff' }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
          <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{getLabel(o)}</span>
          <span style={{ color: '#64748b', flexShrink: 0, whiteSpace: 'nowrap' }}>{getMeta(o)}</span>
        </div>
      ))}
    </div>
  )
}

// A real search-as-you-browse combobox for picking an employee — shows the
// full team on focus (not just once you start typing, unlike the generic
// MatchSuggestions used for designations/products elsewhere), matches on
// name OR designation, and closes on outside click/Escape.
function EmployeeCombobox({ employees, onPick, placeholder = 'Search employee by name or designation…', autoFocus }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    function onDocMouseDown(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  const q = query.trim().toLowerCase()
  const matches = (q
    ? (employees || []).filter(e => e.full_name?.toLowerCase().includes(q) || e.designation?.toLowerCase().includes(q))
    : (employees || [])
  ).slice(0, 30)

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input className="form-input" style={cellInput} placeholder={placeholder} value={query} autoFocus={autoFocus}
        onFocus={() => setOpen(true)}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }} />
      {open && (
        <div style={{
          position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, marginTop: 3,
          maxHeight: 240, overflowY: 'auto', background: '#fff', border: '1px solid #e2e8f0',
          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)',
        }}>
          {matches.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 11.5, color: '#94a3b8' }}>No matching employees</div>
          ) : matches.map(e => (
            <div key={e.id} onMouseDown={() => { onPick(e); setQuery(''); setOpen(false) }}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '7px 10px', cursor: 'pointer' }}
              onMouseEnter={ev => { ev.currentTarget.style.background = '#eef2ff' }} onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent' }}>
              <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.full_name}</span>
              <span style={{ color: '#64748b', flexShrink: 0, whiteSpace: 'nowrap' }}>{e.designation || '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Resource Plan (inline) ── */
function ResourceTable({ section, canEdit, designations, employees, onChanged }) {
  const [editingId, setEditingId] = useState(null) // row id or 'new'
  const [form, setForm] = useState({})
  const [err, setErr] = useState('')
  const rows = section.resourcePlans || []
  const knownRate = designations.find(d => d.designation.toLowerCase() === (form.designation || '').toLowerCase())
  const employeeById = useMemo(() => Object.fromEntries((employees || []).map(e => [e.id, e])), [employees])
  const pickedEmployee = form.employee_id ? employeeById[form.employee_id] : null

  function startEdit(r) { setEditingId(r.id); setForm({ designation: r.designation, employee_id: r.employee_id || null, estimated_count: r.estimated_count, estimated_duration_weeks: r.estimated_duration_weeks }) }
  function startNew() { setEditingId('new'); setForm({ designation: '', employee_id: null, estimated_count: 1, estimated_duration_weeks: 1 }) }
  function cancel() { setEditingId(null); setForm({}); setErr('') }
  // Falls back to the employee's own name as the designation label if their
  // profile has none on file — proposal_resource_plans.designation is
  // NOT NULL, and picking a person should never be blocked by a profile
  // field they happen not to have filled in.
  function pickEmployee(e) { setForm(f => ({ ...f, employee_id: e.id, designation: e.designation || f.designation || e.full_name, estimated_count: 1 })) }
  function clearEmployee() { setForm(f => ({ ...f, employee_id: null })) }
  async function save() {
    if (!form.designation?.trim() && !form.employee_id) { setErr('Pick an employee, or enter a generic designation.'); return }
    if (!(Number(form.estimated_count) > 0) || !(Number(form.estimated_duration_weeks) > 0)) { setErr('Count and Weeks must be greater than 0.'); return }
    setErr('')
    try {
      if (editingId === 'new') await addResourcePlan({ proposalCostSectionId: section.id, designation: form.designation, employeeId: form.employee_id, estimatedCount: form.estimated_count, estimatedDurationWeeks: form.estimated_duration_weeks })
      else await updateResourcePlan(editingId, { designation: form.designation, employeeId: form.employee_id, estimatedCount: form.estimated_count, estimatedDurationWeeks: form.estimated_duration_weeks, refreshRate: true })
      cancel(); onChanged()
    } catch (e) { setErr(e.message) }
  }

  function FormRow() {
    return (
      <>
        <td>
          {pickedEmployee ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#eef2ff', borderRadius: 6, padding: '5px 8px' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pickedEmployee.full_name}</div>
                <div style={{ fontSize: 10.5, color: '#64748b' }}>{pickedEmployee.designation || form.designation || '—'}</div>
              </div>
              <button type="button" onClick={clearEmployee} title="Switch back to a generic designation" style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', flexShrink: 0 }}><X size={13} /></button>
            </div>
          ) : (
            <>
              <EmployeeCombobox employees={employees} onPick={pickEmployee} autoFocus />
              <div style={{ fontSize: 10, color: '#94a3b8', textAlign: 'center', margin: '4px 0' }}>— or —</div>
              <input className="form-input" style={cellInput} placeholder="Generic designation (no specific person)" value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} />
              <MatchSuggestions query={form.designation} options={designations} getLabel={d => d.designation}
                getMeta={d => `${rupee(d.hourly_rate)}/hr`} onPick={d => setForm(f => ({ ...f, designation: d.designation }))} />
            </>
          )}
        </td>
        <td><input className="form-input" style={{ ...cellInput, width: 60 }} type="number" disabled={!!pickedEmployee} title={pickedEmployee ? 'A named employee is always exactly one person' : ''} value={form.estimated_count} onChange={e => setForm(f => ({ ...f, estimated_count: e.target.value }))} /></td>
        <td><input className="form-input" style={{ ...cellInput, width: 60 }} type="number" value={form.estimated_duration_weeks} onChange={e => setForm(f => ({ ...f, estimated_duration_weeks: e.target.value }))} /></td>
        <td colSpan={2} style={{ fontSize: 11, color: form.designation && !knownRate && !pickedEmployee ? '#dc2626' : '#94a3b8' }}>
          {pickedEmployee ? "rate: employee's own rate, else role rate" : form.designation && !knownRate ? '⚠ no rate on file — cost will be ₹0' : 'rate refreshed on save'}
        </td>
        <td><RowActions onSave={save} onCancel={cancel} /></td>
      </>
    )
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <SectionLabel icon={<Users size={13} />}>Resource Plan</SectionLabel>
      {err && <div className="alert alert-danger" style={{ marginBottom: 10 }}>{err}</div>}
      <div className="table-wrap cost-table-wrap">
        <table className="cost-table">
          <thead><tr><th>Designation / Employee</th><th>Count</th><th>Weeks</th><th>Rate/hr</th><th>Cost</th><th style={{ width: 70 }}></th></tr></thead>
          <tbody>
            {rows.map(r => editingId === r.id ? (
              <tr key={r.id} style={{ background: '#fffbeb' }}><FormRow /></tr>
            ) : (
              <tr key={r.id}>
                <td className="td-bold" style={{ fontSize: 12 }}>
                  {r.employee_id && employeeById[r.employee_id] ? (
                    <>{employeeById[r.employee_id].full_name}<div style={{ fontSize: 10.5, fontWeight: 500, color: '#94a3b8' }}>{r.designation}</div></>
                  ) : r.designation}
                </td>
                <td style={{ fontSize: 12 }}>{r.estimated_count}</td>
                <td style={{ fontSize: 12 }}>{r.estimated_duration_weeks}</td>
                <td style={{ fontSize: 12 }}>{rupee(r.rate_used)}</td>
                <td style={{ fontSize: 12, fontWeight: 700 }}>{rupee(r.computed_cost)}</td>
                <td>{canEdit && <RowIcons onEdit={() => startEdit(r)} onDelete={async () => { await deleteResourcePlan(r.id); onChanged() }} />}</td>
              </tr>
            ))}
            {canEdit && (editingId === 'new' ? (
              <tr style={{ background: '#f0fdf4' }}><FormRow /></tr>
            ) : (
              <tr><td colSpan={6}><button type="button" className="btn btn-ghost btn-sm" onClick={startNew}><Plus size={12} /> Add resource</button></td></tr>
            ))}
            {rows.length === 0 && editingId !== 'new' && <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8', padding: 16, fontSize: 12 }}><Users size={16} style={{ opacity: .4, display: 'block', margin: '0 auto 6px' }} />No resources added yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── Hardware (inline) ── */
function HardwareTable({ section, canEdit, products, onChanged }) {
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({})
  const [err, setErr] = useState('')
  const rows = section.hardwareLines || []
  const q = (form.part_number || '').toLowerCase()
  const formProduct = products.find(p => p.part_number === form.part_number || p.name.toLowerCase() === q)

  function startEdit(r) { setEditingId(r.id); setForm({ part_number: r.part_number, description: r.description, estimated_quantity: r.estimated_quantity, manual_unit_cost: r.part_number ? '' : r.unit_cost }) }
  function startNew() { setEditingId('new'); setForm({ part_number: '', description: '', estimated_quantity: 1, manual_unit_cost: '' }) }
  function cancel() { setEditingId(null); setForm({}); setErr('') }
  function pickProduct(p) { setForm(f => ({ ...f, part_number: p.part_number, description: f.description || p.name })) }
  // unit_cost is a snapshot taken when the line was last saved — it never
  // auto-follows products.standard_cost, so a catalog price change after
  // that point silently goes stale with no visible sign. Re-runs the same
  // refreshCost path Save already uses, just without opening the row for edit.
  async function syncPrice(r, p) {
    setErr('')
    try { await updateHardwareLine(r.id, { partNumber: r.part_number, description: r.description, estimatedQuantity: r.estimated_quantity, manualUnitCost: p.unitCost, refreshCost: true }); onChanged() }
    catch (e) { setErr(e.message) }
  }
  async function save() {
    if (!form.description?.trim()) { setErr('Description is required.'); return }
    if (!(Number(form.estimated_quantity) > 0)) { setErr('Quantity must be greater than 0.'); return }
    if (!formProduct && form.part_number?.trim() && !(Number(form.manual_unit_cost) > 0)) { setErr('This isn\'t a catalog product — enter a unit cost manually.'); return }
    setErr('')
    const partNumber = formProduct ? formProduct.part_number : (form.part_number || null)
    try {
      if (editingId === 'new') await addHardwareLine({ proposalCostSectionId: section.id, partNumber, description: form.description, estimatedQuantity: form.estimated_quantity, manualUnitCost: form.manual_unit_cost })
      else await updateHardwareLine(editingId, { partNumber, description: form.description, estimatedQuantity: form.estimated_quantity, manualUnitCost: form.manual_unit_cost, refreshCost: true })
      cancel(); onChanged()
    } catch (e) { setErr(e.message) }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <SectionLabel icon={<Package size={13} />}>Hardware Lines</SectionLabel>
      {err && <div className="alert alert-danger" style={{ marginBottom: 10 }}>{err}</div>}
      <div className="table-wrap cost-table-wrap">
        <table className="cost-table">
          <thead><tr><th>Product</th><th>Description</th><th>Qty</th><th>On Hand</th><th>Unit Cost</th><th>Subtotal</th><th style={{ width: 70 }}></th></tr></thead>
          <tbody>
            {rows.map(r => {
              const p = products.find(x => x.part_number === r.part_number)
              return editingId === r.id ? (
                <tr key={r.id} style={{ background: '#fffbeb' }}>
                  <td>
                    <input className="form-input" style={cellInput} placeholder="Product name or part number" value={form.part_number} onChange={e => setForm(f => ({ ...f, part_number: e.target.value }))} autoFocus />
                    {formProduct ? (
                      <div style={{ fontSize: 10, color: formProduct.lowStock ? '#dc2626' : '#94a3b8' }}>{formProduct.part_number} · {formProduct.onHand} on hand{formProduct.lowStock ? ' ⚠ low' : ''} · {rupee(formProduct.unitCost)}</div>
                    ) : (
                      <MatchSuggestions query={form.part_number} options={products} getLabel={pr => pr.name}
                        getMeta={pr => `${pr.onHand}${pr.lowStock ? ' ⚠' : ''} on hand · ${rupee(pr.unitCost)}`} onPick={pickProduct} />
                    )}
                  </td>
                  <td><input className="form-input" style={cellInput} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></td>
                  <td><input className="form-input" style={{ ...cellInput, width: 60 }} type="number" value={form.estimated_quantity} onChange={e => setForm(f => ({ ...f, estimated_quantity: e.target.value }))} /></td>
                  <td colSpan={2}>
                    {formProduct ? <span style={{ fontSize: 11, color: '#94a3b8' }}>cost refreshed on save</span> : (
                      <div>
                        <input className="form-input" style={{ ...cellInput, width: 90 }} type="number" step="0.01" placeholder="Unit cost" value={form.manual_unit_cost} onChange={e => setForm(f => ({ ...f, manual_unit_cost: e.target.value }))} />
                        <div style={{ fontSize: 10, color: '#dc2626' }}>not in catalog — enter price</div>
                      </div>
                    )}
                  </td>
                  <td><RowActions onSave={save} onCancel={cancel} /></td>
                </tr>
              ) : (
                <tr key={r.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.part_number || '—'}</td>
                  <td className="td-bold" style={{ fontSize: 12 }}>{r.description}</td>
                  <td style={{ fontSize: 12 }}>{r.estimated_quantity}</td>
                  <td style={{ fontSize: 12, color: p?.lowStock ? '#dc2626' : 'inherit' }}>{p ? `${p.onHand}${p.lowStock ? ' ⚠' : ''}` : '—'}</td>
                  <td style={{ fontSize: 12 }}>
                    {rupee(r.unit_cost)}
                    {p && Math.abs(Number(p.unitCost) - Number(r.unit_cost)) > 0.005 && (
                      <div style={{ fontSize: 10, color: '#b45309', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                        Catalog now {rupee(p.unitCost)}
                        {canEdit && <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '1px 6px', fontSize: 10, height: 'auto' }} onClick={() => syncPrice(r, p)}>Sync</button>}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 12, fontWeight: 700 }}>{rupee(r.subtotal_internal_cost)}</td>
                  <td>{canEdit && <RowIcons onEdit={() => startEdit(r)} onDelete={async () => { await deleteHardwareLine(r.id); onChanged() }} />}</td>
                </tr>
              )
            })}
            {canEdit && (editingId === 'new' ? (
              <tr style={{ background: '#f0fdf4' }}>
                <td>
                  <input className="form-input" style={cellInput} placeholder="Product name or part number" value={form.part_number} onChange={e => setForm(f => ({ ...f, part_number: e.target.value }))} autoFocus />
                  {formProduct ? (
                    <div style={{ fontSize: 10, color: formProduct.lowStock ? '#dc2626' : '#94a3b8' }}>{formProduct.name} — {formProduct.part_number} · {formProduct.onHand} on hand, {rupee(formProduct.unitCost)}</div>
                  ) : (
                    <MatchSuggestions query={form.part_number} options={products} getLabel={pr => pr.name}
                      getMeta={pr => `${pr.onHand}${pr.lowStock ? ' ⚠' : ''} on hand · ${rupee(pr.unitCost)}`} onPick={pickProduct} />
                  )}
                </td>
                <td><input className="form-input" style={cellInput} placeholder="Description" value={form.description || formProduct?.name || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></td>
                <td><input className="form-input" style={{ ...cellInput, width: 60 }} type="number" value={form.estimated_quantity} onChange={e => setForm(f => ({ ...f, estimated_quantity: e.target.value }))} /></td>
                <td colSpan={2}>
                  {!formProduct && form.part_number?.trim() && (
                    <div>
                      <input className="form-input" style={{ ...cellInput, width: 90 }} type="number" step="0.01" placeholder="Unit cost" value={form.manual_unit_cost} onChange={e => setForm(f => ({ ...f, manual_unit_cost: e.target.value }))} />
                      <div style={{ fontSize: 10, color: '#dc2626' }}>not in catalog — enter price</div>
                    </div>
                  )}
                </td>
                <td><RowActions onSave={save} onCancel={cancel} /></td>
              </tr>
            ) : (
              <tr><td colSpan={7}><button type="button" className="btn btn-ghost btn-sm" onClick={startNew}><Plus size={12} /> Add hardware line</button></td></tr>
            ))}
            {rows.length === 0 && editingId !== 'new' && <tr><td colSpan={7} style={{ textAlign: 'center', color: '#94a3b8', padding: 16, fontSize: 12 }}><Package size={16} style={{ opacity: .4, display: 'block', margin: '0 auto 6px' }} />No hardware lines added yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── Software / SaaS / Third-Party (inline) ── */
function SoftwareTable({ section, canEdit, softwareSuggestions, onChanged }) {
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({})
  const [err, setErr] = useState('')
  const rows = section.softwareLines || []

  function startEdit(r) { setEditingId(r.id); setForm({ item_name: r.item_name, cost_type: r.cost_type, unit_cost: r.unit_cost, qty: r.qty ?? 1, duration_months: r.duration_months }) }
  function startNew() { setEditingId('new'); setForm({ item_name: '', cost_type: 'One-time', unit_cost: '', qty: 1, duration_months: 1 }) }
  function cancel() { setEditingId(null); setForm({}); setErr('') }
  function pickSuggestion(s) { setForm(f => ({ ...f, item_name: s.item_name, cost_type: s.cost_type || f.cost_type, unit_cost: s.unit_cost })) }
  async function save() {
    if (!form.item_name?.trim()) { setErr('Item name is required.'); return }
    if (!(Number(form.unit_cost) >= 0)) { setErr('Unit cost must be a number 0 or greater.'); return }
    if (!(Number(form.qty) > 0)) { setErr('Qty (license count) must be greater than 0.'); return }
    if (form.cost_type !== 'One-time' && !(Number(form.duration_months) > 0)) { setErr('Duration (months) must be greater than 0 for recurring items.'); return }
    setErr('')
    const payload = { itemName: form.item_name, costType: form.cost_type || 'One-time', unitCost: form.unit_cost, qty: form.qty, durationMonths: form.duration_months }
    try {
      if (editingId === 'new') await addSoftwareLine({ proposalCostSectionId: section.id, ...payload })
      else await updateSoftwareLine(editingId, payload)
      cancel(); onChanged()
    } catch (e) { setErr(e.message) }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <SectionLabel icon={<Wallet size={13} />}>Software / SaaS / Third-Party Lines</SectionLabel>
      {err && <div className="alert alert-danger" style={{ marginBottom: 10 }}>{err}</div>}
      <div className="table-wrap cost-table-wrap">
        <table className="cost-table">
          <thead><tr><th>Item</th><th>Type</th><th>Unit Cost</th><th>Qty (licenses)</th><th>Duration (mo)</th><th>Cost</th><th style={{ width: 70 }}></th></tr></thead>
          <tbody>
            {rows.map(r => editingId === r.id ? (
              <tr key={r.id} style={{ background: '#fffbeb' }}>
                <td>
                  <input className="form-input" style={cellInput} value={form.item_name} onChange={e => setForm(f => ({ ...f, item_name: e.target.value }))} autoFocus />
                  <MatchSuggestions query={form.item_name} options={softwareSuggestions} getLabel={s => s.item_name}
                    getMeta={s => `${rupee(s.unit_cost)} / ${s.cost_type}`} onPick={pickSuggestion} />
                </td>
                <td>
                  <select className="form-select" style={cellInput} value={form.cost_type} onChange={e => setForm(f => ({ ...f, cost_type: e.target.value }))}>
                    <option value="One-time">One-time</option><option value="Monthly">Monthly</option><option value="Annual">Annual</option>
                  </select>
                </td>
                <td><input className="form-input" style={{ ...cellInput, width: 80 }} type="number" step="0.01" value={form.unit_cost} onChange={e => setForm(f => ({ ...f, unit_cost: e.target.value }))} /></td>
                <td><input className="form-input" style={{ ...cellInput, width: 70 }} type="number" step="1" min="1" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} /></td>
                <td>{form.cost_type !== 'One-time' ? <input className="form-input" style={{ ...cellInput, width: 60 }} type="number" value={form.duration_months} onChange={e => setForm(f => ({ ...f, duration_months: e.target.value }))} /> : '—'}</td>
                <td style={{ fontSize: 11, color: '#94a3b8' }}>cost refreshed on save</td>
                <td><RowActions onSave={save} onCancel={cancel} /></td>
              </tr>
            ) : (
              <tr key={r.id}>
                <td className="td-bold" style={{ fontSize: 12 }}>{r.item_name}</td>
                <td style={{ fontSize: 12 }}><span className="badge">{r.cost_type}</span></td>
                <td style={{ fontSize: 12 }}>{rupee(r.unit_cost)}</td>
                <td style={{ fontSize: 12 }}>{r.qty ?? 1}</td>
                <td style={{ fontSize: 12 }}>{r.cost_type !== 'One-time' ? r.duration_months : '—'}</td>
                <td style={{ fontSize: 12, fontWeight: 700 }}>{rupee(r.computed_cost)}</td>
                <td>{canEdit && <RowIcons onEdit={() => startEdit(r)} onDelete={async () => { await deleteSoftwareLine(r.id); onChanged() }} />}</td>
              </tr>
            ))}
            {canEdit && (editingId === 'new' ? (
              <tr style={{ background: '#f0fdf4' }}>
                <td>
                  <input className="form-input" style={cellInput} placeholder="Item name" value={form.item_name} onChange={e => setForm(f => ({ ...f, item_name: e.target.value }))} autoFocus />
                  <MatchSuggestions query={form.item_name} options={softwareSuggestions} getLabel={s => s.item_name}
                    getMeta={s => `${rupee(s.unit_cost)} / ${s.cost_type}`} onPick={pickSuggestion} />
                </td>
                <td>
                  <select className="form-select" style={cellInput} value={form.cost_type} onChange={e => setForm(f => ({ ...f, cost_type: e.target.value }))}>
                    <option value="One-time">One-time</option><option value="Monthly">Monthly</option><option value="Annual">Annual</option>
                  </select>
                </td>
                <td><input className="form-input" style={{ ...cellInput, width: 80 }} type="number" step="0.01" value={form.unit_cost} onChange={e => setForm(f => ({ ...f, unit_cost: e.target.value }))} /></td>
                <td><input className="form-input" style={{ ...cellInput, width: 70 }} type="number" step="1" min="1" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} /></td>
                <td>{form.cost_type !== 'One-time' ? <input className="form-input" style={{ ...cellInput, width: 60 }} type="number" value={form.duration_months} onChange={e => setForm(f => ({ ...f, duration_months: e.target.value }))} /> : '—'}</td>
                <td></td>
                <td><RowActions onSave={save} onCancel={cancel} /></td>
              </tr>
            ) : (
              <tr><td colSpan={7}><button type="button" className="btn btn-ghost btn-sm" onClick={startNew}><Plus size={12} /> Add software / SaaS line</button></td></tr>
            ))}
            {rows.length === 0 && editingId !== 'new' && <tr><td colSpan={7} style={{ textAlign: 'center', color: '#94a3b8', padding: 16, fontSize: 12 }}><Wallet size={16} style={{ opacity: .4, display: 'block', margin: '0 auto 6px' }} />No software lines added yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── Miscellaneous / ERP system / Installation-Assembly (inline) ── */
function MiscTable({ section, canEdit, allResourcePlans, sections, onChanged }) {
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({})
  const [err, setErr] = useState('')
  const rows = section.miscLines || []
  const isErp = section.category === 'ERP Integration'
  const isMisc = section.category === 'Miscellaneous'
  const title = isErp ? 'ERP System / Other Lines' : section.category === 'Hardware Design & Production' ? 'Installation / Assembly / Other Costs' : 'Line Items'
  // Live preview only — the authoritative figure is always recomputed
  // server-side at save time (proposals.js's resolveMiscCost), so a stale
  // client-side base can never get persisted.
  const basePreview = useMemo(() => (sections || [])
    .filter(s => RESOURCE_PLAN_CATEGORIES.includes(s.category))
    .reduce((sum, s) => sum + sectionTotal(s), 0), [sections])

  function startEdit(r) { setEditingId(r.id); setForm({ item_name: r.item_name, line_type: r.line_type, cost: r.cost, linked_resource_plan_id: r.linked_resource_plan_id, mode: r.percent_of_base != null ? 'percent' : 'flat', percent_of_base: r.percent_of_base ?? '' }) }
  function startNew() { setEditingId('new'); setForm({ item_name: '', line_type: 'Other', cost: '', linked_resource_plan_id: '', mode: 'flat', percent_of_base: '' }) }
  function cancel() { setEditingId(null); setForm({}); setErr('') }
  async function save() {
    if (!form.item_name?.trim()) { setErr('Item name is required.'); return }
    const isPercentMode = isMisc && form.mode === 'percent'
    if (isPercentMode) { if (!(Number(form.percent_of_base) >= 0)) { setErr('% must be a number 0 or greater.'); return } }
    else if (!(Number(form.cost) >= 0)) { setErr('Cost must be a number 0 or greater.'); return }
    setErr('')
    const payload = {
      proposalCostSectionId: section.id, itemName: form.item_name,
      cost: isPercentMode ? 0 : form.cost, percentOfBase: isPercentMode ? form.percent_of_base : null,
      lineType: form.line_type, linkedResourcePlanId: form.linked_resource_plan_id || null,
    }
    try {
      if (editingId === 'new') await addMiscLine(payload)
      else await updateMiscLine(editingId, payload)
      cancel(); onChanged()
    } catch (e) { setErr(e.message) }
  }

  function CostCell() {
    if (!isMisc) {
      return <td><input className="form-input" style={{ ...cellInput, width: 90 }} type="number" step="0.01" value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} /></td>
    }
    return (
      <td style={{ minWidth: 140 }}>
        <div style={{ display: 'flex', gap: 2, marginBottom: 4 }}>
          <button type="button" onClick={() => setForm(f => ({ ...f, mode: 'flat' }))}
            style={{ flex: 1, fontSize: 10, fontWeight: 700, padding: '2px 0', borderRadius: 4, border: '1px solid var(--border)', cursor: 'pointer', background: form.mode === 'flat' ? 'var(--c1)' : 'transparent', color: form.mode === 'flat' ? '#fff' : 'inherit' }}>₹ Flat</button>
          <button type="button" onClick={() => setForm(f => ({ ...f, mode: 'percent' }))}
            style={{ flex: 1, fontSize: 10, fontWeight: 700, padding: '2px 0', borderRadius: 4, border: '1px solid var(--border)', cursor: 'pointer', background: form.mode === 'percent' ? 'var(--c1)' : 'transparent', color: form.mode === 'percent' ? '#fff' : 'inherit' }}>% of Eng. Cost</button>
        </div>
        {form.mode === 'percent' ? (
          <>
            <input className="form-input" style={{ ...cellInput, width: 90 }} type="number" step="0.1" placeholder="e.g. 10" value={form.percent_of_base} onChange={e => setForm(f => ({ ...f, percent_of_base: e.target.value }))} />
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
              ≈ {rupee(basePreview * (Number(form.percent_of_base) || 0) / 100)} of {rupee(basePreview)}
              <div style={{ color: '#94a3b8' }}>(App Dev + Firmware + HW Design + ERP)</div>
            </div>
          </>
        ) : (
          <input className="form-input" style={{ ...cellInput, width: 90 }} type="number" step="0.01" value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} />
        )}
      </td>
    )
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <SectionLabel icon={isMisc ? <Plane size={13} /> : <FileText size={13} />}>{title}</SectionLabel>
      {err && <div className="alert alert-danger" style={{ marginBottom: 10 }}>{err}</div>}
      <div className="table-wrap cost-table-wrap">
        <table className="cost-table">
          <thead><tr><th>Item</th><th>Type</th>{isMisc && <th>Tagged Resource</th>}<th>Cost</th><th style={{ width: 70 }}></th></tr></thead>
          <tbody>
            {rows.map(r => editingId === r.id ? (
              <tr key={r.id} style={{ background: '#fffbeb' }}>
                <td>
                  <input className="form-input" style={cellInput} list={isErp ? 'erp-systems' : undefined} value={form.item_name} onChange={e => setForm(f => ({ ...f, item_name: e.target.value }))} autoFocus />
                </td>
                <td>
                  <select className="form-select" style={cellInput} value={form.line_type} onChange={e => setForm(f => ({ ...f, line_type: e.target.value }))}>
                    {MISC_LINE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                {isMisc && (
                  <td>
                    <select className="form-select" style={cellInput} value={form.linked_resource_plan_id || ''} onChange={e => setForm(f => ({ ...f, linked_resource_plan_id: e.target.value }))}>
                      <option value="">— None —</option>
                      {allResourcePlans.map(p => <option key={p.id} value={p.id}>{p.category} — {p.designation}</option>)}
                    </select>
                  </td>
                )}
                <CostCell />
                <td><RowActions onSave={save} onCancel={cancel} /></td>
              </tr>
            ) : (
              <tr key={r.id}>
                <td className="td-bold" style={{ fontSize: 12 }}>{r.item_name}</td>
                <td style={{ fontSize: 12 }}><span className="badge">{r.line_type}</span></td>
                {isMisc && (() => {
                  const linked = allResourcePlans.find(p => p.id === r.linked_resource_plan_id)
                  return <td style={{ fontSize: 12, color: '#64748b' }}>{linked ? `${linked.category} — ${linked.designation}` : '—'}</td>
                })()}
                <td style={{ fontSize: 12, fontWeight: 700 }}>
                  {rupee(r.cost)}
                  {r.percent_of_base != null && <div style={{ fontSize: 10, fontWeight: 500, color: '#64748b' }}>{r.percent_of_base}% of {rupee(r.base_cost_snapshot)}</div>}
                </td>
                <td>{canEdit && <RowIcons onEdit={() => startEdit(r)} onDelete={async () => { await deleteMiscLine(r.id); onChanged() }} />}</td>
              </tr>
            ))}
            {canEdit && (editingId === 'new' ? (
              <tr style={{ background: '#f0fdf4' }}>
                <td>
                  <input className="form-input" style={cellInput} list={isErp ? 'erp-systems' : undefined}
                    placeholder={isErp ? 'ERP system' : section.category === 'Hardware Design & Production' ? 'e.g. On-site Installation' : 'e.g. Client site visit'}
                    value={form.item_name} onChange={e => setForm(f => ({ ...f, item_name: e.target.value }))} autoFocus />
                </td>
                <td>
                  <select className="form-select" style={cellInput} value={form.line_type} onChange={e => setForm(f => ({ ...f, line_type: e.target.value }))}>
                    {MISC_LINE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                {isMisc && (
                  <td>
                    <select className="form-select" style={cellInput} value={form.linked_resource_plan_id} onChange={e => setForm(f => ({ ...f, linked_resource_plan_id: e.target.value }))}>
                      <option value="">— None —</option>
                      {allResourcePlans.map(p => <option key={p.id} value={p.id}>{p.category} — {p.designation}</option>)}
                    </select>
                  </td>
                )}
                <CostCell />
                <td><RowActions onSave={save} onCancel={cancel} /></td>
              </tr>
            ) : (
              <tr><td colSpan={isMisc ? 5 : 4}><button type="button" className="btn btn-ghost btn-sm" onClick={startNew}><Plus size={12} /> Add line</button></td></tr>
            ))}
            {rows.length === 0 && editingId !== 'new' && (
              <tr><td colSpan={isMisc ? 5 : 4} style={{ textAlign: 'center', color: '#94a3b8', padding: 16, fontSize: 12 }}>
                {isMisc ? <Plane size={16} style={{ opacity: .4, display: 'block', margin: '0 auto 6px' }} /> : <FileText size={16} style={{ opacity: .4, display: 'block', margin: '0 auto 6px' }} />}
                None added yet.
              </td></tr>
            )}
          </tbody>
        </table>
        {isErp && <datalist id="erp-systems">{ERP_SYSTEM_OPTIONS.map(s => <option key={s} value={s} />)}</datalist>}
      </div>
    </div>
  )
}

const GANTT_PALETTE = ['#6366f1', '#f59e0b', '#14b8a6', '#ec4899', '#0ea5e9', '#8b5cf6', '#64748b']

function GanttChart({ timeline }) {
  if (!timeline.length) return null
  const maxWeek = Math.max(...timeline.map(t => Number(t.start_offset_weeks || 0) + Number(t.duration_weeks || 0)), 1)
  return (
    <div style={{ marginBottom: 20, padding: 16, borderRadius: 12, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 14 }}>Visual Timeline</div>
      {timeline.map((t, i) => {
        const left = (Number(t.start_offset_weeks || 0) / maxWeek) * 100
        const width = Math.max((Number(t.duration_weeks || 1) / maxWeek) * 100, 3)
        const color = GANTT_PALETTE[i % GANTT_PALETTE.length]
        return (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ width: 130, fontSize: 12, fontWeight: 600, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.phase_name}>{t.phase_name}</div>
            <div style={{ flex: 1, position: 'relative', height: 22, background: '#f1f5f9', borderRadius: 6 }}>
              <div style={{ position: 'absolute', left: `${left}%`, width: `${width}%`, height: '100%', background: color, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .2s' }}>
                <span style={{ fontSize: 10, color: '#fff', fontWeight: 700, whiteSpace: 'nowrap', padding: '0 4px' }}>{t.duration_weeks}wk</span>
              </div>
            </div>
            <div style={{ width: 80, fontSize: 11, color: '#94a3b8', textAlign: 'right', flexShrink: 0 }}>
              wk {t.start_offset_weeks}–{Number(t.start_offset_weeks || 0) + Number(t.duration_weeks || 0)}
            </div>
          </div>
        )
      })}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#cbd5e1', marginTop: 6, paddingLeft: 140 }}>
        <span>Week 0</span><span>Week {maxWeek}</span>
      </div>
    </div>
  )
}

/* ── Timeline ── */

// Resource-plan multi-select shared by Add Phase and Edit Phase — options
// already linked to a DIFFERENT phase are disabled (not hidden, so the
// picker still explains why) to stop the same resource plan's cost being
// counted in two phases' cash-flow at once; the phase currently being
// edited never blocks its own existing selections.
function ResourcePlanPicker({ allResourcePlans, linkedElsewhere, value, onChange }) {
  return (
    <select multiple className="form-select" style={{ minHeight: 90 }} value={value}
      onChange={e => onChange(Array.from(e.target.selectedOptions, o => o.value))}>
      {allResourcePlans.map(r => {
        const blockedPhase = linkedElsewhere.get(r.id)
        return (
          <option key={r.id} value={r.id} disabled={!!blockedPhase}>
            {r.category} — {r.designation} ({rupee(r.computed_cost)}){blockedPhase ? ` — already in "${blockedPhase}"` : ''}
          </option>
        )
      })}
    </select>
  )
}

function TimelineTab({ proposalId, timeline, sections, canEdit, onChanged }) {
  const [form, setForm] = useState({ phase_name: '', start_offset_weeks: 0, duration_weeks: 1, linked_resource_plan_ids: [] })
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const allResourcePlans = sections.flatMap(s => (s.resourcePlans || []).map(r => ({ ...r, category: s.category })))

  // Link-health check: every resource plan should end up linked to exactly
  // one phase — unlinked means its cost never reaches phase-based billing
  // (see computeValueSummary's cost_by_phase, which seeds project milestone
  // amounts on Convert to Project); linked to more than one phase means
  // that cost gets counted twice.
  const linkCounts = {}
  timeline.forEach(t => (t.linked_resource_plan_ids || []).forEach(id => { linkCounts[id] = (linkCounts[id] || 0) + 1 }))
  const unlinkedPlans = allResourcePlans.filter(r => !linkCounts[r.id])
  const unlinkedCost = unlinkedPlans.reduce((s, r) => s + (Number(r.computed_cost) || 0), 0)
  const duplicatePlans = allResourcePlans.filter(r => linkCounts[r.id] > 1)
  const duplicateCost = duplicatePlans.reduce((s, r) => s + (Number(r.computed_cost) || 0) * (linkCounts[r.id] - 1), 0)

  // Map of resourcePlanId -> phase_name for every phase OTHER than the one
  // currently being edited (editingId — 'new' while adding, or a phase id).
  function linkedElsewhereMap(excludePhaseId) {
    const m = new Map()
    timeline.forEach(t => { if (t.id !== excludePhaseId) (t.linked_resource_plan_ids || []).forEach(id => m.set(id, t.phase_name)) })
    return m
  }

  async function add(e) {
    e.preventDefault()
    if (!form.phase_name?.trim()) { setErr('Phase name is required.'); return }
    if (!(Number(form.duration_weeks) > 0) || Number(form.start_offset_weeks) < 0) { setErr('Starts at Week must be 0 or greater, and Duration must be greater than 0.'); return }
    setErr(''); setAdding(true)
    try {
      await addTimelinePhase({ proposalId, phaseName: form.phase_name, startOffsetWeeks: form.start_offset_weeks, durationWeeks: form.duration_weeks, linkedResourcePlanIds: form.linked_resource_plan_ids, sortOrder: timeline.length })
      setForm({ phase_name: '', start_offset_weeks: 0, duration_weeks: 1, linked_resource_plan_ids: [] })
      onChanged()
    } catch (e) { setErr(e.message) }
    finally { setAdding(false) }
  }

  function startEdit(t) {
    setEditingId(t.id)
    setEditForm({ phase_name: t.phase_name, start_offset_weeks: t.start_offset_weeks, duration_weeks: t.duration_weeks, linked_resource_plan_ids: t.linked_resource_plan_ids || [] })
    setErr('')
  }
  function cancelEdit() { setEditingId(null); setEditForm({}); setErr('') }
  async function saveEdit(t) {
    if (!editForm.phase_name?.trim()) { setErr('Phase name is required.'); return }
    if (!(Number(editForm.duration_weeks) > 0) || Number(editForm.start_offset_weeks) < 0) { setErr('Starts at Week must be 0 or greater, and Duration must be greater than 0.'); return }
    setErr(''); setSaving(true)
    try {
      await updateTimelinePhase(t.id, {
        phaseName: editForm.phase_name, startOffsetWeeks: editForm.start_offset_weeks,
        durationWeeks: editForm.duration_weeks, linkedResourcePlanIds: editForm.linked_resource_plan_ids, sortOrder: t.sort_order,
      })
      cancelEdit(); onChanged()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 16 }}>
        Linked resource plans always reflect the current Cost Sections data — deleting a resource plan automatically clears it from any phase that referenced it, so a phase can never silently keep costing a resource that no longer exists.
      </div>

      {err && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{err}</div>}

      {(unlinkedPlans.length > 0 || duplicatePlans.length > 0) ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16, padding: '12px 14px', borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a' }}>
          {unlinkedPlans.length > 0 && (
            <div style={{ fontSize: 12, color: '#92400e' }}>
              ⚠ {unlinkedPlans.length} resource line{unlinkedPlans.length > 1 ? 's' : ''} ({rupee(unlinkedCost)}) not linked to any phase — won't appear in the phase-based cash-flow view or in milestones seeded on Convert to Project.
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 }}>
                {unlinkedPlans.map(r => <span key={r.id} style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: '#fef3c7' }}>{r.category} — {r.designation}</span>)}
              </div>
            </div>
          )}
          {duplicatePlans.length > 0 && (
            <div style={{ fontSize: 12, color: '#b91c1c' }}>
              ⚠ {duplicatePlans.length} resource line{duplicatePlans.length > 1 ? 's' : ''} linked to more than one phase — {rupee(duplicateCost)} would be double-counted in phase billing. Edit the phases below to remove the extra link.
            </div>
          )}
        </div>
      ) : allResourcePlans.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, padding: '10px 14px', borderRadius: 10, background: '#dcfce7', fontSize: 12, color: '#15803d', fontWeight: 600 }}>
          <CheckCircle size={14} /> Every resource plan is linked to exactly one phase.
        </div>
      )}

      <GanttChart timeline={timeline} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {timeline.map((t, i) => {
          const color = GANTT_PALETTE[i % GANTT_PALETTE.length]
          const linkedResources = (t.linked_resource_plan_ids || []).map(id => allResourcePlans.find(r => r.id === id)).filter(Boolean)
          const phaseCost = linkedResources.reduce((s, r) => s + (Number(r.computed_cost) || 0), 0)
          const costByDomain = {}
          linkedResources.forEach(r => { costByDomain[r.category] = (costByDomain[r.category] || 0) + (Number(r.computed_cost) || 0) })
          const domains = Object.keys(costByDomain)

          if (editingId === t.id) {
            return (
              <div key={t.id} style={{ padding: 14, borderRadius: 10, background: '#fffbeb', border: '1px solid var(--border)', borderLeft: `4px solid ${color}` }}>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Phase Name *</label><input className="form-input" value={editForm.phase_name} onChange={e => setEditForm(f => ({ ...f, phase_name: e.target.value }))} autoFocus /></div>
                  <div className="form-group"><label className="form-label">Starts at Week</label><input className="form-input" type="number" value={editForm.start_offset_weeks} onChange={e => setEditForm(f => ({ ...f, start_offset_weeks: e.target.value }))} /></div>
                  <div className="form-group"><label className="form-label">Duration (weeks)</label><input className="form-input" type="number" value={editForm.duration_weeks} onChange={e => setEditForm(f => ({ ...f, duration_weeks: e.target.value }))} /></div>
                </div>
                <div className="form-group" style={{ marginBottom: 10 }}>
                  <label className="form-label">Linked Resource Plans</label>
                  <ResourcePlanPicker allResourcePlans={allResourcePlans} linkedElsewhere={linkedElsewhereMap(t.id)}
                    value={editForm.linked_resource_plan_ids} onChange={ids => setEditForm(f => ({ ...f, linked_resource_plan_ids: ids }))} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => saveEdit(t)}><Save size={13} /> {saving ? 'Saving…' : 'Save'}</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={cancelEdit}><X size={13} /> Cancel</button>
                </div>
              </div>
            )
          }

          return (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', borderLeft: `4px solid ${color}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="td-bold" style={{ fontSize: 13 }}>{t.phase_name}</span>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>wk {t.start_offset_weeks}–{Number(t.start_offset_weeks || 0) + Number(t.duration_weeks || 0)}</span>
                  {phaseCost > 0 && <span style={{ fontSize: 11, fontWeight: 700, color }}>{rupee(phaseCost)}</span>}
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                  {linkedResources.length === 0 ? <span style={{ fontSize: 11, color: '#cbd5e1' }}>No resources linked</span> : linkedResources.map(r => {
                    const t2 = CATEGORY_THEME[r.category] || { color }
                    const dup = linkCounts[r.id] > 1
                    return <span key={r.id} style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: dup ? '#fee2e2' : `${t2.color}18`, color: dup ? '#dc2626' : t2.color }}>{r.designation}{dup ? ' ⚠' : ''}</span>
                  })}
                </div>
                {domains.length > 1 && (
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--border)' }}>
                    {domains.map(cat => {
                      const t3 = CATEGORY_THEME[cat] || { icon: FileText, color: '#94a3b8' }
                      const CatIcon = t3.icon
                      return (
                        <span key={cat} style={{ fontSize: 10.5, fontWeight: 700, color: t3.color, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <CatIcon size={11} /> {cat}: {rupee(costByDomain[cat])}
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => startEdit(t)}><Edit2 size={12} /></button>
                  <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={async () => { await deleteTimelinePhase(t.id); onChanged() }}><Trash2 size={12} /></button>
                </div>
              )}
            </div>
          )
        })}
        {timeline.length === 0 && <div style={{ textAlign: 'center', color: '#94a3b8', padding: 16, fontSize: 12 }}>No phases yet.</div>}
      </div>

      {canEdit && (
        <form onSubmit={add} style={{ padding: 14, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Add Phase</div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Phase Name *</label><input className="form-input" value={form.phase_name} onChange={e => setForm(f => ({ ...f, phase_name: e.target.value }))} required placeholder="e.g. Design, Development, UAT" /></div>
            <div className="form-group"><label className="form-label">Starts at Week</label><input className="form-input" type="number" value={form.start_offset_weeks} onChange={e => setForm(f => ({ ...f, start_offset_weeks: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Duration (weeks)</label><input className="form-input" type="number" value={form.duration_weeks} onChange={e => setForm(f => ({ ...f, duration_weeks: e.target.value }))} /></div>
          </div>
          <div className="form-group">
            <label className="form-label">Linked Resource Plans</label>
            <ResourcePlanPicker allResourcePlans={allResourcePlans} linkedElsewhere={linkedElsewhereMap(null)}
              value={form.linked_resource_plan_ids} onChange={ids => setForm(f => ({ ...f, linked_resource_plan_ids: ids }))} />
          </div>
          <button className="btn btn-primary btn-sm" disabled={adding}><Plus size={13} /> {adding ? 'Adding…' : 'Add Phase'}</button>
        </form>
      )}
    </div>
  )
}

/* ── Value Summary ── */
function ValueSummaryTab({ summary, proposal, sections, canViewInternal, busy, onRecompute }) {
  // One KPI card per category that actually has device/hardware lines —
  // e.g. "IoT Logger: 218" and "Sensors: 872" as separate titles, instead
  // of a single combined "Total Devices Required" number that hides which
  // device type is which once a proposal splits them into their own
  // categories (STEP215's custom cost sections).
  const deviceKpisByCategory = sections
    .map(sec => ({ category: sec.category, qty: (sec.hardwareLines || []).reduce((s, h) => s + (Number(h.estimated_quantity) || 0), 0) }))
    .filter(d => d.qty > 0)
  const saasLinesCount = sections.reduce((s, sec) => s + (sec.softwareLines || []).length, 0)

  if (!summary) {
    return (
      <div>
        <Empty icon={<TrendingUp size={40} />} title="Not computed yet" desc="Add some cost sections, then compute the value summary." />
        <button className="btn btn-primary btn-sm" onClick={onRecompute} disabled={busy}>{busy ? 'Computing…' : 'Compute Summary'}</button>
      </div>
    )
  }
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>
          {['Draft', 'In Negotiation'].includes(proposal.status) ? 'Estimate — recomputes on every change' : 'Frozen at send — a new revision recalculates independently'}
        </div>
        {['Draft', 'In Negotiation'].includes(proposal.status) && (
          <button className="btn btn-outline btn-sm" onClick={onRecompute} disabled={busy}>{busy ? 'Recomputing…' : 'Recompute'}</button>
        )}
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {canViewInternal && <StatCard label="Total Internal Cost (Estimate)" value={rupee(summary.total_internal_cost)} icon={<Wallet size={17} />} accent="#64748b" />}
        <StatCard label="Total Customer Price" value={rupee(summary.total_customer_price)} icon={<TrendingUp size={17} />} accent="#6366f1" />
        {canViewInternal && <StatCard label="Projected Profit" value={rupee(summary.projected_profit)} icon={<CheckCircle size={17} />} accent="#15803d" />}
        {canViewInternal && <StatCard label="Margin % / Markup %" value={`${summary.projected_margin_percent}% / ${summary.blended_markup_percent}%`} icon={<ShieldCheck size={17} />} accent="#4338ca" />}
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {deviceKpisByCategory.map(d => (
          <StatCard key={d.category} label={d.category} value={d.qty} icon={<Monitor size={17} />} accent="#0ea5e9" />
        ))}
        <StatCard label="SaaS / Third-Party Lines" value={saasLinesCount} icon={<Wallet size={17} />} accent="#8b5cf6" />
      </div>

      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>By Category</div>
      <div style={{ height: 260, marginBottom: 12 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={summary.cost_by_category || []} margin={{ top: 5, right: 10, left: 0, bottom: 45 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="category" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => rupee(v)} width={70} />
            <Tooltip formatter={v => rupee(v)} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {canViewInternal && <Bar dataKey="internalCost" name="Internal Cost" fill="#94a3b8" radius={[4, 4, 0, 0]} />}
            <Bar dataKey="customerPrice" name="Customer Price" fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="table-wrap" style={{ marginBottom: 20 }}>
        <table>
          <thead><tr><th>Category</th>{canViewInternal && <th>Internal Cost</th>}{canViewInternal && <th>Margin %</th>}<th>Customer Price</th></tr></thead>
          <tbody>
            {(summary.cost_by_category || []).map(c => {
              const t = CATEGORY_THEME[c.category]
              const Icon = t?.icon
              return (
                <tr key={c.category}>
                  <td className="td-bold" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{Icon && <Icon size={13} color={t.color} />} {c.category}</td>
                  {canViewInternal && <td>{rupee(c.internalCost)}</td>}
                  {canViewInternal && <td>{c.marginPercent}%</td>}
                  <td style={{ fontWeight: 700 }}>{rupee(c.customerPrice)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {summary.cost_by_phase?.length > 0 && (
        <>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>By Phase (cash-flow view)</div>
          {(() => {
            const phaseTotal = summary.cost_by_phase.reduce((s, p) => s + (Number(p.customerPrice) || 0), 0)
            const unallocated = Math.max(0, Math.round((summary.total_customer_price - phaseTotal) * 100) / 100)
            if (unallocated <= 0.5) return null
            return (
              <div style={{ fontSize: 11, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>
                ⚠ {rupee(unallocated)} of the total customer price isn't reflected in any phase — only resource-plan-driven categories can link to a phase (Hardware, Software/SaaS and Miscellaneous line costs never do), and any resource plan not yet linked to a phase adds to this gap too (check the Timeline tab). This amount won't be picked up by the milestone amounts seeded on Convert to Project.
              </div>
            )
          })()}
          <div style={{ height: 220, marginBottom: 12 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.cost_by_phase} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="phase" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => rupee(v)} width={70} />
                <Tooltip formatter={v => rupee(v)} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                <Bar dataKey="customerPrice" name="Customer Price" radius={[4, 4, 0, 0]}>
                  {summary.cost_by_phase.map((_, i) => <Cell key={i} fill={GANTT_PALETTE[i % GANTT_PALETTE.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Phase</th>{canViewInternal && <th>Internal Cost</th>}<th>Customer Price</th></tr></thead>
              <tbody>
                {summary.cost_by_phase.map(p => (
                  <tr key={p.phase}>
                    <td className="td-bold">{p.phase}</td>
                    {canViewInternal && <td>{rupee(p.internalCost)}</td>}
                    <td style={{ fontWeight: 700 }}>{rupee(p.customerPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

/* ── Vendor Costs ── */
function VendorSpendByDomain({ vendorCosts }) {
  const groups = [...PROPOSAL_CATEGORIES, 'Unassigned']
  const rows = groups.map(cat => ({
    category: cat,
    total: vendorCosts.filter(v => (v.linked_category || 'Unassigned') === cat).reduce((s, v) => s + (Number(v.vendor_quote_amount) || 0), 0),
    theme: CATEGORY_THEME[cat] || { icon: FileText, color: '#94a3b8' },
  })).filter(r => r.total > 0)
  if (!rows.length) return null
  const max = Math.max(1, ...rows.map(r => r.total))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 20, padding: 16, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface-2, #f8fafc)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.04em' }}>Vendor Spend by Domain</div>
      {rows.map(r => {
        const Icon = r.theme.icon
        const pct = (r.total / max) * 100
        return (
          <div key={r.category} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 200, fontSize: 11.5, fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <Icon size={12} color={r.theme.color} style={{ flexShrink: 0 }} /> {r.category}
            </div>
            <div style={{ flex: 1, height: 8, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: r.theme.color, borderRadius: 999 }} />
            </div>
            <div style={{ width: 100, fontSize: 11.5, fontWeight: 700, textAlign: 'right', flexShrink: 0 }}>{rupee(r.total)}</div>
          </div>
        )
      })}
    </div>
  )
}

function VendorCostsTab({ proposalId, vendorCosts, canEdit, onChanged }) {
  const [vendors, setVendors] = useState([])
  const [form, setForm] = useState({ vendor_id: '', linked_category: '', vendor_quote_amount: '', quote_reference: '' })
  const [adding, setAdding] = useState(false)
  const [filterCategory, setFilterCategory] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => { supabase.from('vendors').select('id,name').eq('status', 'active').order('name').then(({ data }) => setVendors(data || [])) }, [])

  async function add(e) {
    e.preventDefault()
    if (!form.vendor_id) { setErr('Select a vendor.'); return }
    if (!(Number(form.vendor_quote_amount) > 0)) { setErr('Quote amount must be greater than 0.'); return }
    setErr(''); setAdding(true)
    try {
      await addVendorCost({ proposalId, vendorId: form.vendor_id, linkedCategory: form.linked_category, vendorQuoteAmount: form.vendor_quote_amount, quoteReference: form.quote_reference })
      setForm({ vendor_id: '', linked_category: '', vendor_quote_amount: '', quote_reference: '' })
      onChanged()
    } catch (e) { setErr(e.message) }
    finally { setAdding(false) }
  }

  const visibleCosts = filterCategory ? vendorCosts.filter(v => v.linked_category === filterCategory) : vendorCosts
  const categoriesInUse = PROPOSAL_CATEGORIES.filter(c => vendorCosts.some(v => v.linked_category === c))

  return (
    <div>
      <VendorSpendByDomain vendorCosts={vendorCosts} />

      {categoriesInUse.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          <button onClick={() => setFilterCategory('')} style={{
            padding: '6px 12px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
            border: `1.5px solid ${!filterCategory ? '#334155' : 'var(--border)'}`, background: !filterCategory ? '#334155' : 'transparent', color: !filterCategory ? '#fff' : '#334155',
          }}>All Domains</button>
          {categoriesInUse.map(cat => {
            const t = CATEGORY_THEME[cat]
            const CatIcon = t.icon
            const active = filterCategory === cat
            return (
              <button key={cat} onClick={() => setFilterCategory(cat)} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
                border: `1.5px solid ${active ? t.color : 'var(--border)'}`, background: active ? t.color : 'transparent',
                color: active ? '#fff' : t.color, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
              }}><CatIcon size={12} /> {cat}</button>
            )
          })}
        </div>
      )}

      {visibleCosts.length === 0 ? (
        <Empty icon={<Truck size={40} />} title="No vendor quotes attached" desc="Attach a vendor quote below to keep a traceable link between an outside quote and a cost line." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginBottom: 20 }}>
          {visibleCosts.map(v => {
            const initials = (v.vendor?.name || '??').split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
            const theme = CATEGORY_THEME[v.linked_category]
            return (
              <div key={v.id} style={{ padding: 14, borderRadius: 12, border: '1px solid var(--border)', position: 'relative' }}>
                {canEdit && (
                  <button className="btn btn-ghost btn-sm btn-icon" style={{ position: 'absolute', top: 8, right: 8, color: '#ef4444' }} onClick={async () => { await deleteVendorCost(v.id); onChanged() }}><Trash2 size={12} /></button>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f1f5f9', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, flexShrink: 0 }}>{initials}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="td-bold" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.vendor?.name || '—'}</div>
                    {v.linked_category && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: theme ? `${theme.color}18` : '#f1f5f9', color: theme?.color || '#64748b' }}>{v.linked_category}</span>}
                  </div>
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#334155' }}>{rupee(v.vendor_quote_amount)}</div>
                {v.quote_reference && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.quote_reference}</div>}
              </div>
            )
          })}
        </div>
      )}
      {canEdit && (
        <form onSubmit={add} style={{ padding: 14, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Attach Vendor Quote</div>
          {err && <div className="alert alert-danger" style={{ marginBottom: 10 }}>{err}</div>}
          <div className="form-row">
            <div className="form-group"><label className="form-label">Vendor</label>
              <select className="form-select" value={form.vendor_id} onChange={e => setForm(f => ({ ...f, vendor_id: e.target.value }))}>
                <option value="">Select…</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Linked Category</label>
              <select className="form-select" value={form.linked_category} onChange={e => setForm(f => ({ ...f, linked_category: e.target.value }))}>
                <option value="">—</option>{PROPOSAL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Quote Amount (₹)</label><input className="form-input" type="number" step="0.01" value={form.vendor_quote_amount} onChange={e => setForm(f => ({ ...f, vendor_quote_amount: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Reference (URL / note)</label><input className="form-input" value={form.quote_reference} onChange={e => setForm(f => ({ ...f, quote_reference: e.target.value }))} /></div>
          </div>
          <button className="btn btn-primary btn-sm" disabled={adding}><Plus size={13} /> {adding ? 'Adding…' : 'Attach Quote'}</button>
        </form>
      )}
    </div>
  )
}

// Per-segment Cost-to-Company / Margin % / Cost-to-Client breakdown for
// reviewers (Finance/CTO/Admin/CEO only — same canViewInternal gate the
// rest of this page uses) — margin is editable right here so a reviewer
// can adjust it as part of the approval decision instead of bouncing the
// proposal back to the Sales Lead for a Cost Sections edit. Reuses
// updateCostSection/sectionTotal/categorySectionPrice exactly as
// DomainMarginPanel does, so there's one margin-edit code path, not two.
// One row per line item within a segment — Actual Rate is the internal
// per-unit figure already stored on the line (rate_used for a resource
// designation's ₹/hr, unit_cost for hardware/software), Client Rate is
// that same figure marked up by the segment's own margin (or the proposal
// default). Both stay on the SAME unit basis, so a reviewer can see the
// exact markup being applied at line-item granularity, not just totals.
function lineItemsFor(section, defaultMargin) {
  const marginPct = Number(section.margin_percent ?? defaultMargin ?? 0)
  const markup = x => x * (1 + marginPct / 100)
  const items = []
  ;(section.resourcePlans || []).forEach(r => items.push({
    id: r.id, name: r.designation, qty: `${r.estimated_count} × ${r.estimated_duration_weeks}wk`,
    actualRate: Number(r.rate_used) || 0, actualAmount: Number(r.computed_cost) || 0, rateUnit: '/hr',
  }))
  ;(section.hardwareLines || []).forEach(h => items.push({
    id: h.id, name: h.description, qty: h.estimated_quantity,
    actualRate: Number(h.unit_cost) || 0, actualAmount: Number(h.subtotal_internal_cost) || 0, rateUnit: '/unit',
  }))
  ;(section.softwareLines || []).forEach(sw => items.push({
    id: sw.id, name: sw.item_name, qty: sw.qty ?? 1,
    actualRate: Number(sw.unit_cost) || 0, actualAmount: Number(sw.computed_cost) || 0, rateUnit: '/license',
  }))
  ;(section.miscLines || []).forEach(m => items.push({
    id: m.id, name: m.item_name, qty: '—',
    actualRate: Number(m.cost) || 0, actualAmount: Number(m.cost) || 0, rateUnit: '',
  }))
  return items.map(it => ({ ...it, clientRate: markup(it.actualRate), clientAmount: markup(it.actualAmount) }))
}

function ReviewCostDetailTable({ sections, defaultMargin, canEdit, onChanged }) {
  const [savingId, setSavingId] = useState('')
  const [err, setErr] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())
  function toggle(id) { setExpanded(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next }) }

  async function saveMargin(section, value) {
    if (value !== '' && (isNaN(Number(value)) || Number(value) < -100 || Number(value) > 500)) {
      setErr(`${section.category}: margin must be a number between -100 and 500.`)
      return
    }
    setSavingId(section.id); setErr('')
    try {
      await updateCostSection(section.id, { margin_percent: value === '' ? null : Number(value), notes: section.notes })
      await onChanged?.()
    } catch (e) { setErr(e.message) }
    finally { setSavingId('') }
  }

  const rows = orderedCategories(sections)
    .map(cat => sections.find(s => s.category === cat))
    .filter(Boolean)
    .map(section => ({ section, cost: sectionTotal(section), price: categorySectionPrice(section, defaultMargin) }))
  const totalCost = rows.reduce((s, r) => s + r.cost, 0)
  const totalPrice = rows.reduce((s, r) => s + r.price, 0)

  return (
    <div style={{ marginBottom: 20, border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}>Cost Breakdown by Segment</div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>
        Cost to Company (internal), margin override and the resulting Cost to Client, per category.{canEdit ? ' Margin % is editable here.' : ''}
        {' '}Expand a segment to see Actual Rate vs Client Rate per line item.
      </div>
      {err && <div className="alert alert-danger" style={{ marginBottom: 10 }}>{err}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              {['Segment', 'Cost to Company', 'Margin %', 'Cost to Client', 'Profit'].map(h => (
                <th key={h} style={{ textAlign: h === 'Segment' ? 'left' : 'right', padding: '6px 8px', fontSize: 10, textTransform: 'uppercase', color: '#94a3b8', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ section, cost, price }) => {
              const isStandard = PROPOSAL_CATEGORIES.includes(section.category)
              const isOpen = expanded.has(section.id)
              const items = isOpen ? lineItemsFor(section, defaultMargin) : []
              return (
                <Fragment key={section.id}>
                  <tr>
                    <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9', fontWeight: 600 }}>
                      <button type="button" onClick={() => toggle(section.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginRight: 6, color: '#94a3b8', display: 'inline-flex', verticalAlign: 'middle' }}>
                        <ChevronRight size={13} style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .1s' }} />
                      </button>
                      {section.category}
                      {!isStandard && <span style={{ marginLeft: 5, fontSize: 8.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--c1)', border: '1px solid var(--c1)', borderRadius: 3, padding: '0 4px' }}>Custom</span>}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right' }}>{rupee(cost)}</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <input className="form-input" style={{ width: 56, fontSize: 12, padding: '4px 6px', textAlign: 'right' }} type="number" step="0.1"
                          disabled={!canEdit || savingId === section.id}
                          placeholder={String(defaultMargin ?? 0)} defaultValue={section.margin_percent ?? ''}
                          onBlur={e => { if (e.target.value !== String(section.margin_percent ?? '')) saveMargin(section, e.target.value) }}
                          onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }} />
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>%</span>
                      </div>
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700 }}>{rupee(price)}</td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', color: '#15803d' }}>{rupee(price - cost)}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={5} style={{ padding: '0 8px 10px 26px', borderBottom: '1px solid #f1f5f9' }}>
                        {items.length === 0 ? (
                          <div style={{ fontSize: 11.5, color: '#94a3b8', padding: '4px 0' }}>No line items in this segment.</div>
                        ) : (
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, background: '#f8fafc', borderRadius: 8 }}>
                            <thead>
                              <tr>
                                {['Item', 'Qty', 'Actual Rate', 'Client Rate', 'Actual Amount', 'Client Amount'].map(h => (
                                  <th key={h} style={{ textAlign: h === 'Item' ? 'left' : 'right', padding: '5px 8px', fontSize: 9.5, textTransform: 'uppercase', color: '#94a3b8' }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {items.map(it => (
                                <tr key={it.id}>
                                  <td style={{ padding: '4px 8px' }}>{it.name}</td>
                                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{it.qty}</td>
                                  <td style={{ padding: '4px 8px', textAlign: 'right', color: '#64748b' }}>{rupee(it.actualRate)}{it.rateUnit}</td>
                                  <td style={{ padding: '4px 8px', textAlign: 'right', color: '#4338ca', fontWeight: 600 }}>{rupee(it.clientRate)}{it.rateUnit}</td>
                                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{rupee(it.actualAmount)}</td>
                                  <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700 }}>{rupee(it.clientAmount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ padding: '8px', fontWeight: 800 }}>Total</td>
              <td style={{ padding: '8px', fontWeight: 800, textAlign: 'right' }}>{rupee(totalCost)}</td>
              <td />
              <td style={{ padding: '8px', fontWeight: 800, textAlign: 'right' }}>{rupee(totalPrice)}</td>
              <td style={{ padding: '8px', fontWeight: 800, textAlign: 'right', color: '#15803d' }}>{rupee(totalPrice - totalCost)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

/* ── Approval ── */
function ApprovalTab({ proposal, summary, sections, canViewInternal, profile, role, canEdit, canActOnCurrentStage, isFinanceOrAbove, onChanged, onSelectProposal, onSectionsChanged }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const chain = proposalApproval.getChainSync()
  const currentIdx = proposal.approval_status ? chain.findIndex(s => s.status === proposal.approval_status) : -1

  async function createRevisionAndOpen() {
    setBusy(true); setErr('')
    try {
      const newId = await createRevision(proposal.id, profile.id, note || null)
      setNote('')
      onSelectProposal(newId)
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function submitForApproval() {
    if (!summary) { setErr('Compute the Value Summary before submitting for approval — reviewers need a real cost/price number to approve, not a blank one.'); return }
    setBusy(true); setErr('')
    try {
      const firstStatus = await proposalApproval.firstReviewStatus()
      await updateProposal(proposal.id, { status: 'Ready for Approval', approval_status: firstStatus })
      onChanged()
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function act(action) {
    if (action === 'reject' && !note.trim()) { setErr('A comment is required when rejecting — the Sales Lead needs to know what to fix.'); return }
    setBusy(true); setErr('')
    try {
      const update = await proposalApproval.buildApprovalUpdate(action, proposal.approval_status, profile.id, note)
      await updateProposal(proposal.id, update)
      setNote('')
      onChanged()
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function doMarkWon() { setBusy(true); setErr(''); try { await markWon(proposal.id); onChanged() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  async function doMarkLost() {
    if (!note.trim()) { setErr('Enter a reason before marking this proposal Lost.'); return }
    setBusy(true); setErr('')
    try { await markLost(proposal.id, note); setNote(''); onChanged() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  async function doMarkExpired() { setBusy(true); setErr(''); try { await markExpired(proposal.id); onChanged() } catch (e) { setErr(e.message) } finally { setBusy(false) } }

  return (
    <div>
      {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}

      {canViewInternal && sections?.length > 0 && (
        <ReviewCostDetailTable sections={sections} defaultMargin={proposal.overall_margin_percent}
          canEdit={['Draft', 'In Negotiation', 'Ready for Approval'].includes(proposal.status)}
          onChanged={onSectionsChanged} />
      )}

      {proposal.approval_status && (
        <div style={{ marginBottom: 20 }}>
          <ApprovalChain steps={chain.map(s => ({ label: s.short, name: s.label }))} currentStep={currentIdx === -1 ? chain.length : currentIdx} />
        </div>
      )}

      {(proposal.approval_status || proposal.sales_lead_approved_at || proposal.finance_approved_at || proposal.cto_approved_at) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {chain.map((step, i) => {
            const approvedAtField = `${step.key}_approved_at`, approverField = `${step.key}_approver`
            const approvedAt = proposal[approvedAtField]
            const approver = proposal[approverField]?.full_name
            const isCurrent = i === currentIdx
            return (
              <div key={step.status} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderRadius: 10,
                background: approvedAt ? '#f0fdf4' : isCurrent ? '#fffbeb' : 'var(--surface-2)',
                border: `1px solid ${approvedAt ? '#bbf7d0' : isCurrent ? '#fde68a' : 'var(--border)'}`,
              }}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  background: approvedAt ? '#10b981' : isCurrent ? '#f59e0b' : '#cbd5e1', color: '#fff', fontSize: 11, fontWeight: 800,
                }}>{approvedAt ? '✓' : i + 1}</div>
                <div style={{ flex: 1, fontSize: 12.5, fontWeight: 700 }}>{step.label}</div>
                <div style={{ fontSize: 11, color: '#64748b', textAlign: 'right' }}>
                  {approvedAt ? <>Approved by {approver || '—'} · {dateFmt(approvedAt)}</> : isCurrent ? 'Awaiting review' : 'Not reached yet'}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {['Draft', 'In Negotiation'].includes(proposal.status) && canEdit && (
        <div>
          <button className="btn btn-primary" onClick={submitForApproval} disabled={busy || !summary}><ShieldCheck size={14} /> Submit for Approval</button>
          {!summary && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>Compute the Value Summary first, under the Value Summary tab.</div>}
        </div>
      )}

      {proposal.status === 'Revision Requested' && (
        <div>
          {proposal.rejection_reason && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fee2e2', fontSize: 12, color: '#dc2626', fontWeight: 600, marginBottom: 10 }}>
              Reviewer comments: {proposal.rejection_reason}
            </div>
          )}
          {canEdit ? (
            <>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>
                This creates a new version (v{proposal.version + 1}) to edit — this sent version stays as history.
              </div>
              <div className="form-group"><label className="form-label">Revision Notes (optional)</label><textarea className="form-textarea" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="What changed?" /></div>
              <button className="btn btn-primary" onClick={createRevisionAndOpen} disabled={busy}>{busy ? 'Creating…' : 'Create Revision'}</button>
            </>
          ) : (
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Waiting on the Sales Lead to revise and resubmit.</div>
          )}
        </div>
      )}

      {proposal.status === 'Ready for Approval' && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{proposalApproval.statusLabel(proposal.approval_status)}</div>
          {canActOnCurrentStage ? (
            <div>
              <div className="form-group"><label className="form-label">Comment</label><textarea className="form-textarea" rows={2} value={note} onChange={e => setNote(e.target.value)} /></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-danger" onClick={() => act('reject')} disabled={busy}><XCircle size={13} /> Reject</button>
                <button className="btn btn-success" onClick={() => act('approve')} disabled={busy}><CheckCircle size={13} /> Approve</button>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Waiting on {proposalApproval.statusLabel(proposal.approval_status)} — you're not the current reviewer.</div>
          )}
        </div>
      )}

      {proposal.status === 'Approved' && isFinanceOrAbove && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-success" onClick={doMarkWon} disabled={busy}><CheckCircle size={13} /> Mark Won</button>
          <button className="btn btn-ghost" onClick={doMarkExpired} disabled={busy}>Mark Expired</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input className="form-input" style={{ width: 200 }} placeholder="Reason (for Lost)" value={note} onChange={e => setNote(e.target.value)} />
            <button className="btn btn-danger" onClick={doMarkLost} disabled={busy}>Mark Lost</button>
          </div>
        </div>
      )}

      {proposal.status === 'Won' && !proposal.linked_project_id && isFinanceOrAbove && (
        <ConvertToProjectAction proposalId={proposal.id} profileId={profile.id} onChanged={onChanged} />
      )}
    </div>
  )
}

function ConvertToProjectAction({ proposalId, profileId, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState('')
  async function convert() {
    setBusy(true); setErr('')
    try { setResult(await createProjectFromProposal(proposalId, profileId)); onChanged() }
    catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }
  return (
    <div style={{ marginTop: 16, padding: 14, borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a' }}>
      {err && <div className="alert alert-danger" style={{ marginBottom: 10 }}>{err}</div>}
      {result ? (
        <div style={{ fontSize: 13, color: '#15803d', fontWeight: 600 }}>
          ✓ Project created — {result.plannedBudgetRows} planned-budget line(s) and {result.milestoneRows} milestone(s) seeded (internal cost only). Review and adjust in the Project's Budget tab, then submit through the standard budget approval chain.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Convert to Project</div>
          <div style={{ fontSize: 12, color: '#92400e', marginBottom: 10 }}>
            Creates a new project and seeds its planned budget (internal cost only) and initial milestones from this proposal's timeline. You'll still review and submit through the normal project budget approval chain.
          </div>
          <button className="btn btn-primary btn-sm" onClick={convert} disabled={busy}><ChevronRight size={13} /> {busy ? 'Converting…' : 'Convert to Project'}</button>
        </>
      )}
    </div>
  )
}

/* ── Export ── */
function TemplateBadgeRow({ template }) {
  if (!template) return <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>No active template configured for this export type — using the built-in layout. Set one under Settings → Manage Templates.</div>
  const badge = (label, bg, color) => <span key={label} style={{ padding: '2px 9px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: bg, color }}>{label}</span>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 14 }}>
      {badge(template.template_name, '#eef2ff', '#4338ca')}
      {badge(template.config?.show_line_item_detail ? 'Itemized line detail' : 'Category summary only', '#f1f5f9', '#475569')}
      {template.config?.section_order?.length ? badge(`${template.config.section_order.length} section(s) ordered`, '#f1f5f9', '#475569') : null}
      {template.header_logo ? badge('Logo set', '#f0fdf4', '#15803d') : null}
      {template.terms_and_conditions_text ? badge('T&C included', '#f0fdf4', '#15803d') : null}
      {template.footer_text ? badge('Footer note', '#f0fdf4', '#15803d') : null}
    </div>
  )
}

function ExportFormatCard({ icon: Icon, iconBg, iconColor, title, desc, isBusy, disabled, onClick }) {
  return (
    <div style={{ flex: '1 1 240px', minWidth: 220, border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: iconBg, color: iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={18} /></div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
      </div>
      <div style={{ fontSize: 12, color: '#64748b', flex: 1 }}>{desc}</div>
      <button className="btn btn-primary btn-sm" onClick={onClick} disabled={disabled} style={{ alignSelf: 'flex-start' }}>
        <Download size={13} /> {isBusy ? 'Generating…' : 'Download'}
      </button>
    </div>
  )
}

function ExportModeSection({ title, desc, accent, template, mode, busy, run }) {
  return (
    <div style={{ marginBottom: 24, border: '1px solid #e2e8f0', borderRadius: 14, padding: 18, borderTop: `3px solid ${accent}` }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>{desc}</div>
      <TemplateBadgeRow template={template} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <ExportFormatCard icon={FileText} iconBg="#fee2e2" iconColor="#dc2626" title="PDF Document"
          desc={mode === 'internal'
            ? 'Quotation-format PDF (landscape) with Internal Cost, Margin % and Profit columns — not for customer distribution.'
            : 'Quotation-format PDF — letterhead, Bill/Ship To, itemized lines, GST and amount in words. Ready to send as-is.'}
          isBusy={busy === `${mode}-pdf`} disabled={!!busy} onClick={() => run(exportProposalPDF, mode, `${mode}-pdf`)} />
        <ExportFormatCard icon={FileSpreadsheet} iconBg="#dcfce7" iconColor="#15803d" title="Excel Workbook"
          desc="Cost summary and timeline as editable sheets — for further analysis or re-formatting."
          isBusy={busy === `${mode}-xlsx`} disabled={!!busy} onClick={() => run(exportProposalExcel, mode, `${mode}-xlsx`)} />
      </div>
    </div>
  )
}

function ExportTab({ proposal, summary, canViewInternal }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [templates, setTemplates] = useState({ customer: null, internal: null })

  useEffect(() => {
    let alive = true
    Promise.all([getActiveTemplate('proposal', 'customer'), getActiveTemplate('proposal', 'internal')])
      .then(([customer, internal]) => { if (alive) setTemplates({ customer, internal }) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  async function run(fn, mode, label) {
    setBusy(label); setErr('')
    try { await fn(proposal.id, mode) }
    catch (e) { setErr(e.message) }
    finally { setBusy('') }
  }

  if (!summary) return <Empty icon={<Download size={40} />} title="Nothing to export yet" desc="Compute the Value Summary first, under the Value Summary tab." />

  return (
    <div>
      {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
      <ExportModeSection
        title="Customer-Facing Export" desc="Price only — internal cost and margin are never included in this output."
        accent="#6366f1" template={templates.customer} mode="customer" busy={busy} run={run}
      />
      {canViewInternal ? (
        <ExportModeSection
          title="Internal Review Export" desc="Cost, margin and price side-by-side — for Finance, CTO and Leadership review only."
          accent="#f59e0b" template={templates.internal} mode="internal" busy={busy} run={run}
        />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#94a3b8', border: '1px dashed #e2e8f0', borderRadius: 10, padding: 14 }}>
          <Lock size={14} /> Internal Review export (shows internal cost and margin) is restricted to Finance, CTO and Leadership.
        </div>
      )}
    </div>
  )
}

/* ── Client Link ── */
const CR_STATUS_COLOR = {
  pending: { bg: '#fef3c7', color: '#b45309' }, approved: { bg: '#dcfce7', color: '#15803d' }, rejected: { bg: '#fee2e2', color: '#dc2626' },
}

function ChangeLineSummary({ c }) {
  const parts = []
  if (c.qty != null) parts.push(`qty → ${c.qty}`)
  if (c.duration_weeks != null) parts.push(`weeks → ${c.duration_weeks}`)
  if (c.start_offset_weeks != null) parts.push(`start → wk ${c.start_offset_weeks}`)
  return <span>{c.type}: {parts.join(', ') || '—'}</span>
}

function ShareTab({ proposalId, profile, canEdit, sections, canViewInternal, defaultMargin, marginEditable, onChangesApplied }) {
  const [link, setLink] = useState(null)
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const [reviewNotes, setReviewNotes] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    const [links, reqs] = await Promise.all([listShareLinks(proposalId), listChangeRequests(proposalId)])
    setLink(links.find(l => !l.revoked_at) || links[0] || null)
    setRequests(reqs)
    setLoading(false)
  }, [proposalId])

  useEffect(() => { load() }, [load])

  async function generate() {
    setBusy('generate'); setErr('')
    try { setLink(await getOrCreateShareLink(proposalId, profile.id)) }
    catch (e) { setErr(e.message) }
    finally { setBusy('') }
  }

  async function revoke() {
    setBusy('revoke'); setErr('')
    try { await revokeShareLink(link.id); await load() }
    catch (e) { setErr(e.message) }
    finally { setBusy('') }
  }

  async function updateExpiry(dateStr) {
    setErr('')
    try { await setShareLinkExpiry(link.id, dateStr ? new Date(dateStr).toISOString() : null); await load() }
    catch (e) { setErr(e.message) }
  }

  async function review(req, approve) {
    setBusy(req.id); setErr('')
    try {
      await reviewChangeRequest(req.id, { approve, note: reviewNotes[req.id], profileId: profile.id })
      await load()
      if (approve) await onChangesApplied?.()
    } catch (e) { setErr(e.message) }
    finally { setBusy('') }
  }

  function copy() {
    navigator.clipboard?.writeText(shareLinkUrl(link.token))
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  if (loading) return <Loader />
  const pending = requests.filter(r => r.status === 'pending')

  return (
    <div>
      {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}

      {canViewInternal && sections?.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#94a3b8', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Lock size={11} /> Internal only — never sent to the client link below
          </div>
          <ReviewCostDetailTable sections={sections} defaultMargin={defaultMargin} canEdit={!!marginEditable} onChanged={onChangesApplied} />
        </div>
      )}

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 18, marginBottom: 20, borderTop: '3px solid #6366f1' }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>Share With Client</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
          A secure link where the client can review pricing and propose changes to quantities/timeline only —
          rates and margins are never shown. Any change they submit lands here for your review before it touches this proposal.
        </div>

        {!link || link.revoked_at ? (
          <button className="btn btn-primary btn-sm" onClick={generate} disabled={!canEdit || busy === 'generate'}>
            <Link2 size={14} /> {busy === 'generate' ? 'Generating…' : 'Generate Client Link'}
          </button>
        ) : (
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <input readOnly value={shareLinkUrl(link.token)} onFocus={e => e.target.select()}
                style={{ flex: '1 1 320px', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontFamily: 'monospace', fontSize: 12 }} />
              <button className="btn btn-outline btn-sm" onClick={copy}><Copy size={13} /> {copied ? 'Copied!' : 'Copy'}</button>
              {canEdit && <button className="btn btn-ghost btn-sm" onClick={revoke} disabled={busy === 'revoke'} style={{ color: '#dc2626' }}><Ban size={13} /> Revoke</button>}
            </div>
            <label style={{ fontSize: 11.5, color: '#64748b', display: 'flex', alignItems: 'center', gap: 8 }}>
              Expires
              <input type="date" disabled={!canEdit} defaultValue={link.expires_at ? link.expires_at.slice(0, 10) : ''}
                onChange={e => updateExpiry(e.target.value)}
                style={{ padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: 6, fontFamily: 'inherit', fontSize: 12 }} />
              <span style={{ color: '#94a3b8' }}>(leave blank for no expiry)</span>
            </label>
          </div>
        )}
      </div>

      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
        Change Requests {pending.length > 0 && <span style={{ fontSize: 11, background: '#fef3c7', color: '#b45309', padding: '2px 8px', borderRadius: 999, marginLeft: 6 }}>{pending.length} pending</span>}
      </div>

      {requests.length === 0 ? (
        <Empty icon={<Inbox size={36} />} title="No change requests yet" desc="Requests the client submits from the shared link will show up here for review." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {requests.map(r => {
            const sc = CR_STATUS_COLOR[r.status]
            return (
              <div key={r.id} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                  <div>
                    <span style={{ fontWeight: 700 }}>{r.client_name || 'Client'}</span>
                    <span style={{ color: '#94a3b8', fontSize: 11.5, marginLeft: 8 }}>{dateFmt(r.created_at)}</span>
                  </div>
                  <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: sc.bg, color: sc.color }}>{r.status}</span>
                </div>
                {r.client_note && <div style={{ fontSize: 12.5, color: '#475569', marginBottom: 8, fontStyle: 'italic' }}>"{r.client_note}"</div>}
                <div style={{ fontSize: 12, color: '#64748b', display: 'flex', flexDirection: 'column', gap: 3, marginBottom: r.status === 'pending' ? 10 : 0 }}>
                  {(r.changes || []).map((c, i) => <ChangeLineSummary key={i} c={c} />)}
                </div>
                {r.status === 'pending' && canEdit && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input placeholder="Review note (optional)" value={reviewNotes[r.id] || ''}
                      onChange={e => setReviewNotes(prev => ({ ...prev, [r.id]: e.target.value }))}
                      style={{ flex: '1 1 200px', padding: '6px 9px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, fontFamily: 'inherit' }} />
                    <button className="btn btn-primary btn-sm" disabled={busy === r.id} onClick={() => review(r, true)}><CheckCircle size={13} /> Approve &amp; Apply</button>
                    <button className="btn btn-ghost btn-sm" disabled={busy === r.id} onClick={() => review(r, false)} style={{ color: '#dc2626' }}><XCircle size={13} /> Reject</button>
                  </div>
                )}
                {r.status !== 'pending' && (
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
                    Reviewed by {r.reviewer?.full_name || '—'} on {dateFmt(r.reviewed_at)}{r.review_note ? ` — "${r.review_note}"` : ''}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Versions ── */
function VersionsTab({ versions }) {
  if (!versions?.length) return <Empty icon={<GitBranch size={40} />} title="No versions yet" desc="This proposal has not been revised." />
  return (
    <div style={{ position: 'relative', paddingLeft: 30 }}>
      <div style={{ position: 'absolute', left: 9, top: 8, bottom: 8, width: 2, background: '#e2e8f0' }} />
      {versions.map((v, i) => (
        <div key={v.id} style={{ position: 'relative', paddingBottom: i === versions.length - 1 ? 0 : 20 }}>
          <div style={{
            position: 'absolute', left: -30, top: 2, width: 20, height: 20, borderRadius: '50%',
            background: v.is_current ? '#6366f1' : '#fff', border: `2px solid ${v.is_current ? '#6366f1' : '#cbd5e1'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <GitBranch size={11} color={v.is_current ? '#fff' : '#94a3b8'} />
          </div>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 16px', background: v.is_current ? '#f8fafc' : '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>v{v.version}</span>
              {v.is_current && <span className="badge badge-success">Current</span>}
              <StatusPill status={v.status} />
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8' }}>{dateFmt(v.created_at)}</span>
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: v.revision_notes ? 6 : 0 }}>By {v.creator?.full_name || 'Unknown'}</div>
            {v.revision_notes && <div style={{ fontSize: 12, color: '#475569', background: '#f1f5f9', borderRadius: 8, padding: '6px 10px' }}>{v.revision_notes}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

// Template management for every document type (Invoice, Delivery Note,
// Proposal, Warranty, GRN) now lives in one place — Settings -> Manage
// Templates — instead of this page having its own Proposal-only copy.
