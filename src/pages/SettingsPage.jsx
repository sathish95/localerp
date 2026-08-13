import { useState, useEffect, useMemo, Fragment } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase, rupee, dateFmt } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useTabVisibility } from '../context/TabVisibilityContext'
import { listRoles, createRole, updateRole, deleteRole, colorForRole } from '../lib/roles'
import { getModules, setModuleEnabled, getModuleRoleVisibility, setModuleRoleVisibility } from '../lib/modules'
import { getLLMSettings, saveLLMSettings } from '../lib/llmSettings'
import { getDocumentSettings, saveDocumentSettings } from '../lib/documentSettings'
import { listTemplates, createTemplate, updateTemplate, setActive, archiveTemplate, deleteTemplate } from '../lib/documentTemplates'
import { PROPOSAL_CATEGORIES } from '../lib/proposals'
import { MODULES, MODULE_SECTIONS } from '../config/modules'
import { Alert, Modal, Confirm, Loader, Empty, SearchBox } from '../components/ui'
import {
  Settings, GitBranch, DollarSign, Bell, Tag, FileText, Sparkles, TrendingUp, Megaphone,
  Save, Plus, Trash2, Edit2, Check, X, Users, Eye, EyeOff, Shield, ChevronDown, ChevronRight, ChevronUp, Building2,
  CreditCard, Clock, CheckCircle2, LayoutTemplate, ArrowUp, ArrowDown, Puzzle, Lock, Unlock, Key,
} from 'lucide-react'
import { listInvites, createInvite, revokeInvite } from '../lib/orgInvites'
import { listPlans, myUpgradeRequests, requestUpgrade } from '../lib/billing'
import { listBundles, myBundleSubscriptions, myBundleRequests, requestBundleChange, orgBundleMonthlyTotal } from '../lib/billingBundles'
import { listPermissions, listRolePermissions, setRolePermission } from '../lib/permissions'
import { createPaymentOrder, launchCheckout, cancelSubscription, listPaymentProviders } from '../lib/paymentGateway'
import {
  WORKFLOWS, workflowConfig, listChainsWithSteps, createChain, saveChainSteps, setChainActive, deleteChain,
} from '../lib/approvalChains'
import {
  DOMAINS, listRegions, createRegion, deleteRegion,
  listRoleDefinitions, createRoleDefinition, deleteRoleDefinition,
  listRepAssignments, createRepAssignment, deleteRepAssignment,
  listPipelineStages, createPipelineStage, updatePipelineStage, deletePipelineStage,
  listLookup, createLookup, setLookupActive, deleteLookup,
  listAssignmentRules, createAssignmentRule, deleteAssignmentRule,
  listStaleThresholds, updateStaleThreshold,
  getConfigFlag, setConfigFlag,
} from '../lib/salesAdmin'
import { AI_CAPABILITY_REGISTRY, getEnabledCapabilities, setCapabilityEnabled } from '../lib/aiCapabilities'

// ── Roles & Modules (Admin Feature) ──
// Company-wide module enablement (a real kill switch, applies to every
// role including admin/ceo) plus per-role visibility within enabled
// modules — both Supabase-backed via src/lib/modules.js, and role
// management via src/lib/roles.js (STEP42's dynamic roles table).
function RolesModulesTab() {
  const { profile } = useAuth()
  const { refresh } = useTabVisibility()
  const [roles, setRoles] = useState([])
  const [modules, setModulesState] = useState([])
  const [visibility, setVisibility] = useState([])
  const [loading, setLoading] = useState(true)
  const [openSection, setOpenSection] = useState(MODULE_SECTIONS[0])

  const [showRoleModal, setShowRoleModal] = useState(false)
  const [editingRole, setEditingRole] = useState(null)
  const [roleForm, setRoleForm] = useState({ role_key: '', label: '', color: '' })
  const [roleErr, setRoleErr] = useState('')
  const [savingRole, setSavingRole] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deleteErr, setDeleteErr] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [r, m, v] = await Promise.all([listRoles(), getModules(profile.organization_id), getModuleRoleVisibility(profile.organization_id)])
    setRoles(r); setModulesState(m); setVisibility(v)
    setLoading(false)
  }

  // Admin/CEO always bypass per-role visibility (same rule as
  // isTabVisible()), so showing them as matrix columns would be
  // meaningless — every cell would be a permanently-on checkbox.
  const gridRoles = roles.filter(r => !['admin', 'ceo'].includes(r.role_key))
  const moduleByKey = useMemo(() => Object.fromEntries(modules.map(m => [m.key, m])), [modules])
  const visMap = useMemo(() => {
    const m = {}
    visibility.forEach(v => { (m[v.module_key] ||= {})[v.role] = v.visible })
    return m
  }, [visibility])

  async function toggleEnabled(mod) {
    try {
      await setModuleEnabled(mod.key, !mod.enabled, profile.id, profile.organization_id)
      setModulesState(prev => prev.map(m => m.key === mod.key ? { ...m, enabled: !mod.enabled } : m))
      refresh()
    } catch (e) { alert(e.message) }
  }

  async function toggleVisible(moduleKey, roleKey) {
    const current = visMap[moduleKey]?.[roleKey] !== false
    const next = !current
    await setModuleRoleVisibility(moduleKey, roleKey, next, profile.organization_id)
    setVisibility(prev => {
      const idx = prev.findIndex(v => v.module_key === moduleKey && v.role === roleKey)
      if (idx >= 0) { const c = [...prev]; c[idx] = { ...c[idx], visible: next }; return c }
      return [...prev, { module_key: moduleKey, role: roleKey, visible: next }]
    })
    refresh()
  }

  function openNewRole() { setEditingRole(null); setRoleForm({ role_key: '', label: '', color: '' }); setRoleErr(''); setShowRoleModal(true) }
  function openEditRole(r) { setEditingRole(r); setRoleForm({ role_key: r.role_key, label: r.label, color: r.color || '' }); setRoleErr(''); setShowRoleModal(true) }

  async function saveRole(e) {
    e.preventDefault(); setSavingRole(true); setRoleErr('')
    try {
      if (editingRole) await updateRole(editingRole.role_key, { label: roleForm.label, color: roleForm.color })
      else await createRole({ role_key: roleForm.role_key, label: roleForm.label, color: roleForm.color }, profile.id)
      setShowRoleModal(false); load()
    } catch (e) { setRoleErr(e.message) }
    finally { setSavingRole(false) }
  }

  async function confirmDeleteRole() {
    setDeleteErr('')
    try { await deleteRole(deleteConfirm.role_key); setDeleteConfirm(null); load() }
    catch (e) { setDeleteErr(e.message) }
  }

  if (loading) return <Loader />

  return (
    <div>
      {/* ── Roles ── */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Roles</h3>
            <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem' }}>Built-in roles can't be deleted. Custom roles get navigation/page visibility only — deep permissions (approvals, finance-restricted data) stay code-defined.</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={openNewRole}><Plus size={14} /> New Role</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {roles.map(r => {
            const color = colorForRole(r.color || r.role_key)
            return (
              <div key={r.role_key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px 6px 12px', borderRadius: 999, background: `${color}12`, border: `1.5px solid ${color}30` }}>
                <span style={{ fontSize: 12, fontWeight: 700, color }}>{r.label}</span>
                {r.is_system && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase' }}>built-in</span>}
                <button className="btn btn-ghost btn-sm btn-icon" style={{ width: 22, height: 22, minHeight: 0 }} onClick={() => openEditRole(r)}><Edit2 size={11} /></button>
                {!r.is_system && <button className="btn btn-ghost btn-sm btn-icon" style={{ width: 22, height: 22, minHeight: 0, color: '#ef4444' }} onClick={() => { setDeleteErr(''); setDeleteConfirm(r) }}><Trash2 size={11} /></button>}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Module Enablement ── */}
      <div>
        <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Module Enablement</h3>
        <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 16 }}>
          "Enabled" is a company-wide kill switch — off means off for everyone, including Admin/CEO. Per-role checkboxes control nav/page visibility within an enabled module; Admin/CEO always see enabled modules regardless of these checkboxes.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {MODULE_SECTIONS.map(section => {
            const sectionModules = MODULES.filter(m => m.section === section)
            const isOpen = openSection === section
            return (
              <div key={section} style={{ border: '1.5px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
                <button onClick={() => setOpenSection(isOpen ? null : section)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: 'var(--surface)', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, textAlign: 'left' }}>
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {section} <span style={{ color: 'var(--ink-muted)', fontWeight: 500 }}>({sectionModules.length})</span>
                </button>
                {isOpen && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 + gridRoles.length * 90 }}>
                      <thead><tr style={{ background: 'var(--surface)' }}>
                        <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase' }}>Module</th>
                        <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase' }}>Enabled</th>
                        {gridRoles.map(r => <th key={r.role_key} style={{ padding: '8px 12px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)' }}>{r.label}</th>)}
                      </tr></thead>
                      <tbody>
                        {sectionModules.map(sm => {
                          const mod = moduleByKey[sm.key] || { key: sm.key, label: sm.label, enabled: true }
                          return (
                            <tr key={sm.key} style={{ borderTop: '1px solid var(--border)', opacity: mod.enabled ? 1 : 0.5 }}>
                              <td style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600 }}>{sm.label}</td>
                              <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                <input type="checkbox" checked={mod.enabled} onChange={() => toggleEnabled(mod)} style={{ width: 16, height: 16, accentColor: '#10b981', cursor: 'pointer' }} />
                              </td>
                              {gridRoles.map(r => (
                                <td key={r.role_key} style={{ padding: '8px 12px', textAlign: 'center' }}>
                                  <input type="checkbox" disabled={!mod.enabled} checked={visMap[sm.key]?.[r.role_key] !== false}
                                    onChange={() => toggleVisible(sm.key, r.role_key)}
                                    style={{ width: 16, height: 16, accentColor: 'var(--c1)', cursor: mod.enabled ? 'pointer' : 'not-allowed' }} />
                                </td>
                              ))}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Role create/edit modal ── */}
      <Modal open={showRoleModal} onClose={() => setShowRoleModal(false)} title={editingRole ? 'Edit Role' : 'New Role'} size="sm"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowRoleModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveRole} disabled={savingRole}>{savingRole ? 'Saving...' : 'Save'}</button>
        </>}>
        <form onSubmit={saveRole}>
          {roleErr && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{roleErr}</div>}
          {!editingRole && (
            <div className="form-group">
              <label className="form-label">Role Key *</label>
              <input className="form-input" value={roleForm.role_key} onChange={e => setRoleForm(f => ({ ...f, role_key: e.target.value }))} placeholder="e.g. quality_lead" required />
              <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 3 }}>Lowercase, permanent once created — this is stored on every user assigned this role.</div>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Label *</label>
            <input className="form-input" value={roleForm.label} onChange={e => setRoleForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Quality Lead" required />
          </div>
          <div className="form-group">
            <label className="form-label">Color</label>
            <input className="form-input" type="color" value={roleForm.color || '#6366f1'} onChange={e => setRoleForm(f => ({ ...f, color: e.target.value }))} style={{ width: 60, padding: 4 }} />
          </div>
        </form>
      </Modal>

      <Confirm open={!!deleteConfirm} message={deleteErr || `Delete the "${deleteConfirm?.label}" role? This cannot be undone.`} danger
        onConfirm={confirmDeleteRole} onCancel={() => setDeleteConfirm(null)} />
    </div>
  )
}

// ── Approval Chain Config ──
// Backed by approval_chains/approval_chain_steps (STEP48). Each workflow's
// engine hardcodes what a status_value means (which column it stamps, what
// business logic triggers on it) — so status_value here is picked from a
// fixed per-workflow vocabulary (see src/lib/approvalChains.js), not free
// text. The genuinely editable part is which role sits at each step, and
// whether that step is included at all.
function initNewForm(cfg, roles) {
  const firstRole = roles[0]?.role_key || 'admin'
  return {
    workflow: cfg.key,
    key: '', label: '',
    selectorValue: cfg.selectorOptions[0] || '',
    steps: cfg.statusValues.map(v => ({ status_value: v, approver_role: firstRole, label: roles[0]?.label || firstRole })),
  }
}

function ApprovalChainTab() {
  const { profile } = useAuth()
  const [roles, setRoles] = useState([])
  const [chains, setChains] = useState([])
  const [editingSteps, setEditingSteps] = useState({})
  const [loading, setLoading] = useState(true)
  const [openWorkflow, setOpenWorkflow] = useState(WORKFLOWS[0].key)
  const [savingChain, setSavingChain] = useState(null)
  const [err, setErr] = useState('')
  const [showNewModal, setShowNewModal] = useState(false)
  const [newForm, setNewForm] = useState(null)
  const [creating, setCreating] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [r, c] = await Promise.all([listRoles(), listChainsWithSteps()])
    setRoles(r); setChains(c)
    const drafts = {}
    c.forEach(ch => { drafts[ch.id] = ch.steps.map(s => ({ ...s })) })
    setEditingSteps(drafts)
    setLoading(false)
  }

  function roleLabel(key) { return roles.find(r => r.role_key === key)?.label || key }

  function updateStep(chainId, idx, patch) {
    setEditingSteps(prev => ({ ...prev, [chainId]: prev[chainId].map((s, i) => i === idx ? { ...s, ...patch } : s) }))
  }
  function removeStep(chainId, idx) {
    setEditingSteps(prev => ({ ...prev, [chainId]: prev[chainId].filter((_, i) => i !== idx) }))
  }
  function addStep(chainId, workflow) {
    const cfg = workflowConfig(workflow)
    const used = new Set(editingSteps[chainId].map(s => s.status_value))
    const next = cfg.statusValues.find(v => !used.has(v))
    if (!next) return
    const firstRole = roles[0]?.role_key || 'admin'
    setEditingSteps(prev => ({ ...prev, [chainId]: [...prev[chainId], { status_value: next, approver_role: firstRole, label: roleLabel(firstRole) }] }))
  }
  function moveStep(chainId, idx, dir) {
    setEditingSteps(prev => {
      const arr = [...prev[chainId]]
      const j = idx + dir
      if (j < 0 || j >= arr.length) return prev
      ;[arr[idx], arr[j]] = [arr[j], arr[idx]]
      return { ...prev, [chainId]: arr }
    })
  }

  async function saveSteps(chainId) {
    setSavingChain(chainId); setErr('')
    try { await saveChainSteps(chainId, editingSteps[chainId]); await load() }
    catch (e) { setErr(e.message) }
    finally { setSavingChain(null) }
  }

  async function toggleActive(chain) {
    setErr('')
    try { await setChainActive(chain, !chain.is_active); load() }
    catch (e) { setErr(e.message) }
  }

  async function confirmDelete() {
    setErr('')
    try { await deleteChain(deleteConfirm); setDeleteConfirm(null); load() }
    catch (e) { setErr(e.message) }
  }

  function openNewChain(workflowKey) {
    const cfg = workflowConfig(workflowKey)
    setErr(''); setNewForm(initNewForm(cfg, roles)); setShowNewModal(true)
  }
  function switchNewWorkflow(workflowKey) {
    const cfg = workflowConfig(workflowKey)
    setNewForm(initNewForm(cfg, roles))
  }
  function updateNewStep(idx, patch) {
    setNewForm(f => ({ ...f, steps: f.steps.map((s, i) => i === idx ? { ...s, ...patch } : s) }))
  }
  function removeNewStep(idx) {
    setNewForm(f => ({ ...f, steps: f.steps.filter((_, i) => i !== idx) }))
  }
  function addNewStep() {
    const cfg = workflowConfig(newForm.workflow)
    const used = new Set(newForm.steps.map(s => s.status_value))
    const next = cfg.statusValues.find(v => !used.has(v))
    if (!next) return
    const firstRole = roles[0]?.role_key || 'admin'
    setNewForm(f => ({ ...f, steps: [...f.steps, { status_value: next, approver_role: firstRole, label: roleLabel(firstRole) }] }))
  }

  async function handleCreate() {
    setCreating(true); setErr('')
    try {
      const cfg = workflowConfig(newForm.workflow)
      await createChain({
        workflow: newForm.workflow, key: newForm.key, label: newForm.label,
        selectorType: cfg.selectorType, selectorValue: cfg.selectorType === 'always' ? null : newForm.selectorValue,
        steps: newForm.steps,
      }, profile.id)
      setShowNewModal(false); load()
    } catch (e) { setErr(e.message) }
    finally { setCreating(false) }
  }

  if (loading) return <Loader />

  const newCfg = newForm ? workflowConfig(newForm.workflow) : null

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Approval Chains</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 16 }}>
        Reassign which role handles each review step, or create an alternate chain. Step order and what each status
        means are fixed by each workflow's code — the approver role at each step (and which steps are included) is
        what's editable here.
      </p>
      {err && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{err}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {WORKFLOWS.map(cfg => {
          const wfChains = chains.filter(c => c.workflow === cfg.key)
          const isOpen = openWorkflow === cfg.key
          return (
            <div key={cfg.key} style={{ border: '1.5px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', background: 'var(--surface)' }}>
                <button onClick={() => setOpenWorkflow(isOpen ? null : cfg.key)} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, textAlign: 'left' }}>
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {cfg.label} <span style={{ color: 'var(--ink-muted)', fontWeight: 500 }}>({wfChains.length} chain{wfChains.length === 1 ? '' : 's'})</span>
                </button>
                <button className="btn btn-ghost btn-sm" style={{ marginRight: 10 }} onClick={() => openNewChain(cfg.key)}><Plus size={12} /> New Chain</button>
              </div>
              {isOpen && (
                <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {cfg.note && (
                    <div style={{ fontSize: 12, color: '#92400e', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px' }}>{cfg.note}</div>
                  )}
                  {wfChains.length === 0 && <Empty icon="🔗" title="No chains yet" desc="Falls back to the built-in hardcoded chain until one is created." />}
                  {wfChains.map(chain => {
                    const steps = editingSteps[chain.id] || []
                    return (
                      <div key={chain.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', opacity: chain.is_active ? 1 : 0.55 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>
                              {chain.label}
                              {chain.is_custom && <span style={{ fontSize: 9, fontWeight: 700, color: '#6d28d9', background: '#ede9fe', padding: '2px 6px', borderRadius: 6, marginLeft: 6 }}>CUSTOM</span>}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                              {cfg.selectorLabel ? `${cfg.selectorLabel}: ${chain.selector_value}` : 'Applies to all'} · key: {chain.key}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                              <input type="checkbox" checked={chain.is_active} onChange={() => toggleActive(chain)} /> Active
                            </label>
                            {chain.is_custom && (
                              <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => setDeleteConfirm(chain)}><Trash2 size={13} /></button>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {steps.map((s, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, background: 'var(--surface)', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-muted)', minWidth: 14 }}>{i + 1}</span>
                              <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--ink-muted)', minWidth: 150 }}>{s.status_value}</span>
                              <select className="form-select" style={{ fontSize: 12, flex: 1, minWidth: 120 }} value={s.approver_role}
                                onChange={e => updateStep(chain.id, i, { approver_role: e.target.value, label: roleLabel(e.target.value) })}>
                                {roles.map(r => <option key={r.role_key} value={r.role_key}>{r.label}</option>)}
                              </select>
                              <input className="form-input" style={{ fontSize: 12, width: 130 }} value={s.label}
                                onChange={e => updateStep(chain.id, i, { label: e.target.value })} placeholder="Display label" />
                              <button className="btn btn-ghost btn-sm btn-icon" disabled={i === 0} onClick={() => moveStep(chain.id, i, -1)}><ChevronUp size={12} /></button>
                              <button className="btn btn-ghost btn-sm btn-icon" disabled={i === steps.length - 1} onClick={() => moveStep(chain.id, i, 1)}><ChevronDown size={12} /></button>
                              <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => removeStep(chain.id, i)}><X size={12} /></button>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => addStep(chain.id, cfg.key)} disabled={steps.length >= cfg.statusValues.length}><Plus size={12} /> Add Step</button>
                          <button className="btn btn-primary btn-sm" onClick={() => saveSteps(chain.id)} disabled={savingChain === chain.id}>{savingChain === chain.id ? 'Saving…' : 'Save Steps'}</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* New chain modal */}
      <Modal open={showNewModal} onClose={() => setShowNewModal(false)} title="New Approval Chain" size="lg"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setShowNewModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>{creating ? 'Creating…' : 'Create Chain'}</button>
        </>}>
        {newForm && (
          <div>
            {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
            <div className="form-group">
              <label className="form-label">Workflow</label>
              <select className="form-select" value={newForm.workflow} onChange={e => switchNewWorkflow(e.target.value)}>
                {WORKFLOWS.map(w => <option key={w.key} value={w.key}>{w.label}</option>)}
              </select>
            </div>
            {newCfg?.selectorLabel && (
              <div className="form-group">
                <label className="form-label">{newCfg.selectorLabel}</label>
                <select className="form-select" value={newForm.selectorValue} onChange={e => setNewForm(f => ({ ...f, selectorValue: e.target.value }))}>
                  {newCfg.selectorOptions.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 3 }}>
                  Creating this active chain will deactivate any other active chain for the same {newCfg.selectorLabel.toLowerCase()}.
                </div>
              </div>
            )}
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Key *</label>
                <input className="form-input" value={newForm.key} onChange={e => setNewForm(f => ({ ...f, key: e.target.value }))} placeholder="e.g. expense_employee_v2" required />
              </div>
              <div className="form-group">
                <label className="form-label">Label *</label>
                <input className="form-input" value={newForm.label} onChange={e => setNewForm(f => ({ ...f, label: e.target.value }))} placeholder="Display name" required />
              </div>
            </div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Steps</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
              {newForm.steps.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--ink-muted)', minWidth: 150 }}>{s.status_value}</span>
                  <select className="form-select" style={{ fontSize: 12, flex: 1, minWidth: 120 }} value={s.approver_role}
                    onChange={e => updateNewStep(i, { approver_role: e.target.value, label: roleLabel(e.target.value) })}>
                    {roles.map(r => <option key={r.role_key} value={r.role_key}>{r.label}</option>)}
                  </select>
                  <input className="form-input" style={{ fontSize: 12, width: 130 }} value={s.label} onChange={e => updateNewStep(i, { label: e.target.value })} />
                  <button type="button" className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => removeNewStep(i)}><X size={12} /></button>
                </div>
              ))}
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addNewStep} disabled={newForm.steps.length >= newCfg.statusValues.length}><Plus size={12} /> Add Step</button>
          </div>
        )}
      </Modal>

      <Confirm open={!!deleteConfirm} message={`Delete the "${deleteConfirm?.label}" chain? This cannot be undone.`} danger
        onConfirm={confirmDelete} onCancel={() => setDeleteConfirm(null)} />
    </div>
  )
}

// ── Budget Config ──
function BudgetConfigTab() {
  const [depts, setDepts] = useState([])
  const [budgets, setBudgets] = useState({})
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    async function load() {
      const [d, b] = await Promise.all([
        supabase.from('departments').select('*').order('name'),
        supabase.from('budgets').select('*')
      ])
      setDepts(d.data || [])
      const map = {}
      ;(b.data || []).forEach(b => { map[b.department_id] = b })
      setBudgets(map)
      setLoading(false)
    }
    load()
  }, [])

  async function save() {
    for (const dept of depts) {
      const b = budgets[dept.id]
      if (!b) continue
      await supabase.from('budgets').upsert({ department_id: dept.id, annual_budget: b.annual_budget || 0, monthly_budget: b.monthly_budget || 0 }, { onConflict: 'department_id' })
    }
    setSaved(true); setTimeout(() => setSaved(false), 2500)
  }

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-muted)' }}>Loading...</div>

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Department Budget Configuration</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 20 }}>Set annual and monthly budgets for each department.</p>
      <table className="data-table" style={{ marginBottom: 20 }}>
        <thead><tr><th>Department</th><th>Annual Budget (₹)</th><th>Monthly Budget (₹)</th></tr></thead>
        <tbody>
          {depts.map(dept => (
            <tr key={dept.id}>
              <td style={{ fontWeight: 600 }}>{dept.name}</td>
              <td><input type="number" className="form-input" value={budgets[dept.id]?.annual_budget || ''} style={{ width: 160 }} onChange={e => setBudgets(p => ({ ...p, [dept.id]: { ...p[dept.id], department_id: dept.id, annual_budget: parseFloat(e.target.value) || 0 } }))} placeholder="0" /></td>
              <td><input type="number" className="form-input" value={budgets[dept.id]?.monthly_budget || ''} style={{ width: 160 }} onChange={e => setBudgets(p => ({ ...p, [dept.id]: { ...p[dept.id], department_id: dept.id, monthly_budget: parseFloat(e.target.value) || 0 } }))} placeholder="0" /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {saved && <Alert type="success" message="Budget configuration saved!" />}
      <button className="btn btn-primary" onClick={save}><Save size={15} /> Save Budgets</button>
    </div>
  )
}

// ── Expense Categories ──
function ExpenseCategoriesTab() {
  const [cats, setCats] = useState(['Travel & Transport','Food & Meals','Accommodation','Office Supplies','Software & Subscriptions','Training & Education','Marketing','Utilities','Equipment','Medical','Entertainment','Miscellaneous'])
  const [newCat, setNewCat] = useState('')
  const [editing, setEditing] = useState(null)
  const [editVal, setEditVal] = useState('')
  const [saved, setSaved] = useState(false)

  function add() { if (newCat.trim()) { setCats([...cats, newCat.trim()]); setNewCat('') } }
  function remove(i) { setCats(cats.filter((_, idx) => idx !== i)) }
  function save() { setSaved(true); setTimeout(() => setSaved(false), 2500) }

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Expense Categories</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 20 }}>Manage the list of expense categories available when submitting.</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input className="form-input" value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="New category name..." onKeyDown={e => e.key === 'Enter' && add()} style={{ flex: 1, maxWidth: 300 }} />
        <button className="btn btn-primary" onClick={add}><Plus size={15} /> Add</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8, marginBottom: 20 }}>
        {cats.map((cat, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, border: '1.5px solid var(--border)', background: 'var(--surface)' }}>
            <Tag size={13} style={{ color: 'var(--c1)', flexShrink: 0 }} />
            {editing === i ? (
              <>
                <input className="form-input" value={editVal} onChange={e => setEditVal(e.target.value)} style={{ flex: 1, padding: '4px 8px', fontSize: '0.85rem' }} autoFocus />
                <button className="btn btn-ghost btn-sm btn-icon" onClick={() => { const c=[...cats]; c[i]=editVal; setCats(c); setEditing(null) }}><Check size={13} /></button>
                <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditing(null)}><X size={13} /></button>
              </>
            ) : (
              <>
                <span style={{ flex: 1, fontSize: '0.88rem', fontWeight: 500 }}>{cat}</span>
                <button className="btn btn-ghost btn-sm btn-icon" onClick={() => { setEditing(i); setEditVal(cat) }}><Edit2 size={12} /></button>
                <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => remove(i)}><Trash2 size={12} /></button>
              </>
            )}
          </div>
        ))}
      </div>
      {saved && <Alert type="success" message="Categories saved!" />}
      <button className="btn btn-primary" onClick={save}><Save size={15} /> Save Categories</button>
    </div>
  )
}

// ── GST Settings — org-wide tax identity + bank details. The per-document
// letterhead (logo/footer/terms) used to live here too (STEP113) but now
// lives per-template under Settings -> Manage Templates (STEP114), since
// different templates for the same document type can reasonably want
// different footer text/terms — org GSTIN/address/bank details can't
// vary that way, so they stay here. ──
const initDocSettings = () => ({
  gstin: '', business_name: '', address: '', state: '', state_code: '',
  cgst_rate: 9, sgst_rate: 9, igst_rate: 18, default_hsn: '',
  include_gst_in_invoices: true, auto_calculate: true, bank_details: '',
})

function GSTSettingsTab() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [s, setS] = useState(initDocSettings())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const canEdit = ['admin', 'ceo', 'finance'].includes(profile?.role)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const existing = await getDocumentSettings()
    setS({ ...initDocSettings(), ...existing })
    setLoading(false)
  }

  async function save() {
    setSaving(true); setErr('')
    try {
      await saveDocumentSettings(s, profile?.id)
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }
  const set = (k, v) => setS(p => ({ ...p, [k]: v }))

  if (loading) return <Loader />

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>GST &amp; Business Settings</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 12 }}>
        Your organization's tax identity and bank details — used on every generated document regardless of which template is active.
        {' '}Looking for the logo, footer text or terms &amp; conditions?{' '}
        <button type="button" onClick={() => navigate('/settings?tab=document-templates')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--c1)', fontWeight: 700, cursor: 'pointer', font: 'inherit' }}>
          Manage those under Document Templates →
        </button>
      </p>
      {!canEdit && <Alert type="info" message="You can view these settings, but only admin/ceo/finance can edit them." />}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
        {[['gstin','GSTIN','29ABCDE1234F1Z5',false],['business_name','Business Name','Acme Pvt. Ltd.',false],['address','Registered Address','123, MG Road...',true],['state','State','Karnataka',false],['state_code','State Code','29',false],['default_hsn','Default HSN Code','998313',false]].map(([k,label,ph,full]) => (
          <div key={k} style={{ gridColumn: full ? '1/-1' : 'auto' }}>
            <label className="form-label">{label}</label>
            <input className="form-input" value={s[k] || ''} placeholder={ph} disabled={!canEdit} onChange={e => set(k, e.target.value)} />
          </div>
        ))}
      </div>
      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 12 }}>GST Rates</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 20 }}>
        {[['cgst_rate','CGST Rate (%)'],['sgst_rate','SGST Rate (%)'],['igst_rate','IGST Rate (%)']].map(([k,l]) => (
          <div key={k}><label className="form-label">{l}</label><input type="number" className="form-input" value={s[k]} disabled={!canEdit} onChange={e => set(k, parseFloat(e.target.value)||0)} min={0} max={28} step={0.5} /></div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
        {[['include_gst_in_invoices','Include GST breakdown in invoices'],['auto_calculate','Auto-calculate GST on amounts']].map(([k,l]) => (
          <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: canEdit ? 'pointer' : 'default', fontSize: '0.9rem' }}>
            <input type="checkbox" checked={s[k]} disabled={!canEdit} onChange={() => set(k, !s[k])} style={{ width: 16, height: 16, accentColor: 'var(--c1)' }} />
            {l}
          </label>
        ))}
      </div>

      <div className="form-group" style={{ marginBottom: 20 }}><label className="form-label">Bank Details</label><textarea className="form-textarea" rows={2} disabled={!canEdit} value={s.bank_details || ''} onChange={e => set('bank_details', e.target.value)} placeholder="Account name, number, IFSC, bank name…" /></div>

      {err && <Alert type="danger" message={err} />}
      {saved && <Alert type="success" message="Settings saved!" />}
      {canEdit && <button className="btn btn-primary" onClick={save} disabled={saving}><Save size={15} /> {saving ? 'Saving…' : 'Save Settings'}</button>}
    </div>
  )
}

// ── Shared logo-upload control — one PNG file picker with live preview,
// a 300KB cap (every generated PDF embeds it directly), and a Remove
// button. Used by the Document Templates modal below. ──
function LogoUploadField({ value, onChange, disabled }) {
  const [logoErr, setLogoErr] = useState('')
  function handleFile(file) {
    setLogoErr('')
    if (!file) return
    if (file.type !== 'image/png') { setLogoErr('Please choose a PNG file.'); return }
    if (file.size > 300 * 1024) { setLogoErr('That logo is too large (max 300 KB) — every generated PDF embeds it directly. Try a smaller or more compressed PNG.'); return }
    const reader = new FileReader()
    reader.onload = () => onChange(reader.result)
    reader.onerror = () => setLogoErr('Could not read that file — please try again.')
    reader.readAsDataURL(file)
  }
  return (
    <div className="form-group">
      <label className="form-label">Header Logo</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {value && (
          <img src={value} alt="Logo preview" style={{ height: 44, maxWidth: 140, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 8, padding: 4, background: '#fff' }} />
        )}
        <div>
          <input type="file" accept="image/png" disabled={disabled} onChange={e => handleFile(e.target.files?.[0])} style={{ fontSize: 13 }} />
          <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 4 }}>PNG only, up to 300 KB.</div>
        </div>
        {value && !disabled && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange('')}>Remove</button>}
      </div>
      {logoErr && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>{logoErr}</div>}
    </div>
  )
}

// ── Document Templates (STEP114) — one unified, admin-configurable
// template system for Invoice, Delivery Note, Proposal, Warranty, and
// GRN, replacing Proposals' old bespoke proposal_templates. Every
// template has a Draft -> Active -> Archived lifecycle; only the one
// Active template per (type, audience) is read by the real PDF
// exporters (customerInvoiceExport.js, deliveryNoteExport.js,
// proposalExport.js, warrantyExport.js, grnExport.js). ──
const DOC_TYPES = [
  { key: 'invoice', label: 'Invoice' },
  { key: 'delivery_note', label: 'Delivery Note' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'warranty', label: 'Warranty' },
  { key: 'grn', label: 'GRN' },
]
const TEMPLATE_STATUS_STYLE = {
  draft: { bg: '#f1f5f9', color: '#475569' },
  active: { bg: '#dcfce7', color: '#15803d' },
  archived: { bg: '#f1f5f9', color: '#94a3b8' },
}

function DocumentTemplatesTab() {
  const { profile } = useAuth()
  const canEdit = ['admin', 'ceo', 'finance', 'sales_lead', 'cto'].includes(profile?.role)
  const [docType, setDocType] = useState('invoice')
  const [audience, setAudience] = useState('customer')
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [err, setErr] = useState('')

  const effectiveAudience = docType === 'proposal' ? audience : undefined

  useEffect(() => { load() }, [docType, audience])

  async function load() {
    setLoading(true); setErr('')
    try { setTemplates(await listTemplates(docType, effectiveAudience)) }
    catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function handleSetActive(id) {
    setErr('')
    try { await setActive(id); load() } catch (e) { setErr(e.message) }
  }
  async function handleArchive(id) {
    setErr('')
    try { await archiveTemplate(id); load() } catch (e) { setErr(e.message) }
  }
  async function handleDelete() {
    setErr('')
    try { await deleteTemplate(deleteConfirm); setDeleteConfirm(null); load() } catch (e) { setErr(e.message) }
  }

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Document Templates</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 18 }}>
        The letterhead and layout used when generating each document's PDF. Only one <b>Active</b> template per type is used for real exports — keep drafts around to preview a new look before switching.
      </p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {DOC_TYPES.map(t => (
          <button key={t.key} onClick={() => setDocType(t.key)} style={{ padding: '6px 16px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12, background: docType === t.key ? 'var(--c1)' : 'var(--surface)', color: docType === t.key ? '#fff' : 'var(--ink-soft)' }}>
            {t.label}
          </button>
        ))}
      </div>

      {docType === 'proposal' && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
          {[['customer', 'Customer-Facing'], ['internal', 'Internal Review']].map(([k, label]) => (
            <button key={k} onClick={() => setAudience(k)} style={{ padding: '5px 14px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', fontWeight: 600, fontSize: 11.5, background: audience === k ? 'var(--accent-wash, #eef2ff)' : '#fff', color: audience === k ? 'var(--c1)' : 'var(--ink-muted)' }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {err && <Alert type="danger" message={err} />}

      {canEdit && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button className="btn btn-primary btn-sm" onClick={() => { setEditing(null); setShowModal(true) }}><Plus size={14} /> New Template</button>
        </div>
      )}

      {loading ? <Loader /> : templates.length === 0 ? (
        <Empty icon={<LayoutTemplate size={36} />} title="No templates yet" desc="Create one to control what this document's PDF looks like — until then, exports use a built-in default layout." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Status</th><th>Logo</th><th>Updated</th>{canEdit && <th></th>}</tr></thead>
            <tbody>
              {templates.map(t => {
                const st = TEMPLATE_STATUS_STYLE[t.status] || TEMPLATE_STATUS_STYLE.draft
                return (
                  <tr key={t.id}>
                    <td className="td-bold">{t.template_name}</td>
                    <td><span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, textTransform: 'capitalize', background: st.bg, color: st.color }}>{t.status}</span></td>
                    <td>{t.header_logo ? <span className="badge badge-success">Set</span> : '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{dateFmt(t.updated_at)}</td>
                    {canEdit && (
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <button className="btn btn-ghost btn-sm btn-icon" title="Edit" onClick={() => { setEditing(t); setShowModal(true) }}><Edit2 size={12} /></button>
                          {t.status !== 'active' && <button className="btn btn-ghost btn-sm" onClick={() => handleSetActive(t.id)}>Set Active</button>}
                          {t.status !== 'archived' && <button className="btn btn-ghost btn-sm" onClick={() => handleArchive(t.id)}>Archive</button>}
                          <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} title="Delete" onClick={() => setDeleteConfirm(t.id)}><Trash2 size={12} /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <DocumentTemplateModal documentType={docType} audience={effectiveAudience} template={editing} userId={profile.id}
          onClose={() => setShowModal(false)} onSaved={async () => { setShowModal(false); await load() }} />
      )}
      <Confirm open={!!deleteConfirm} message="Delete this template? This cannot be undone." danger
        onConfirm={handleDelete} onCancel={() => setDeleteConfirm(null)} />
    </div>
  )
}

function DocumentTemplateModal({ documentType, audience, template, userId, onClose, onSaved }) {
  const isProposal = documentType === 'proposal'
  const [form, setForm] = useState(() => ({
    template_name: template?.template_name || '',
    status: (template?.status === 'draft' || template?.status === 'archived') ? template.status : 'draft',
    header_logo: template?.header_logo || '',
    footer_text: template?.footer_text || '',
    terms_and_conditions_text: template?.terms_and_conditions_text || '',
    show_line_item_detail: template?.config?.show_line_item_detail || false,
    section_order: template?.config?.section_order?.length ? template.config.section_order : [...PROPOSAL_CATEGORIES],
    company_details_override: template?.config?.company_details_override || '',
  }))
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  function move(idx, dir) {
    setForm(f => {
      const arr = [...f.section_order]
      const j = idx + dir
      if (j < 0 || j >= arr.length) return f
      ;[arr[idx], arr[j]] = [arr[j], arr[idx]]
      return { ...f, section_order: arr }
    })
  }

  async function submit(e) {
    e.preventDefault()
    setSubmitting(true); setErr('')
    try {
      const patch = {
        document_type: documentType, audience: audience || null,
        template_name: form.template_name, status: form.status,
        header_logo: form.header_logo || null, footer_text: form.footer_text || null,
        terms_and_conditions_text: form.terms_and_conditions_text || null,
        ...(isProposal ? { config: { show_line_item_detail: form.show_line_item_detail, section_order: form.section_order, company_details_override: form.company_details_override || null } } : {}),
      }
      template ? await updateTemplate(template.id, patch) : await createTemplate(patch, userId)
      onSaved()
    } catch (e) { setErr(e.message) } finally { setSubmitting(false) }
  }

  return (
    <Modal open onClose={onClose} title={template ? 'Edit Template' : 'New Template'} size="lg"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</button>
      </>}>
      <form onSubmit={submit}>
        {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="form-group">
          <label className="form-label">Template Name *</label>
          <input className="form-input" value={form.template_name} onChange={e => setForm(f => ({ ...f, template_name: e.target.value }))} required />
        </div>

        {template?.status !== 'active' && (
          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="form-select" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
            <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 4 }}>Use "Set Active" from the template list to make this the one real exports use.</div>
          </div>
        )}
        {template?.status === 'active' && (
          <div className="alert alert-info" style={{ marginBottom: 14, fontSize: 12 }}>This is the Active template — real exports use it right now. Archive it from the template list if you want to retire it.</div>
        )}

        <LogoUploadField value={form.header_logo} onChange={v => setForm(f => ({ ...f, header_logo: v }))} />

        {isProposal && (
          <div className="form-group"><label className="form-label">Company Details Override</label>
            <textarea className="form-textarea" rows={2} value={form.company_details_override} onChange={e => setForm(f => ({ ...f, company_details_override: e.target.value }))} placeholder="Leave blank to use the org's GST Settings address" />
          </div>
        )}
        <div className="form-group"><label className="form-label">Terms &amp; Conditions</label>
          <textarea className="form-textarea" rows={3} value={form.terms_and_conditions_text} onChange={e => setForm(f => ({ ...f, terms_and_conditions_text: e.target.value }))} placeholder="Payment terms, late fees, dispute process…" />
        </div>
        <div className="form-group"><label className="form-label">Footer Text</label>
          <input className="form-input" value={form.footer_text} onChange={e => setForm(f => ({ ...f, footer_text: e.target.value }))} placeholder="e.g. Thank you for your business." />
        </div>

        {isProposal && (
          <>
            <div className="form-group">
              <label className="form-label">Category Order</label>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                {form.section_order.map((cat, i) => (
                  <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: i < form.section_order.length - 1 ? '1px solid var(--border)' : 'none', fontSize: 12 }}>
                    <span style={{ flex: 1 }}>{cat}</span>
                    <button type="button" className="btn btn-ghost btn-sm btn-icon" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={12} /></button>
                    <button type="button" className="btn btn-ghost btn-sm btn-icon" disabled={i === form.section_order.length - 1} onClick={() => move(i, 1)}><ArrowDown size={12} /></button>
                  </div>
                ))}
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={form.show_line_item_detail} onChange={e => setForm(f => ({ ...f, show_line_item_detail: e.target.checked }))} />
              Show itemized line-by-line detail (instead of category totals only) — Customer-Facing only, ignored for Internal Review
            </label>
          </>
        )}
      </form>
    </Modal>
  )
}

// ── AI / LLM Keys (Admin Feature) ──
// Org-wide, Supabase-backed (src/lib/llmSettings.js, STEP44) so a key set
// here works for every user without a redeploy — takes precedence over the
// build-time VITE_ env vars in src/lib/llm.js. Readable by any authenticated
// user (the browser calls DeepSeek/Gemini directly, same exposure level as
// the existing VITE_ vars, which are already bundled into the client JS),
// writable only by admin/ceo (enforced by STEP44's RLS policy too).
// ── AI Capabilities (Admin Feature) ──
// A capability's absence from ai_capability_settings means "enabled"
// (STEP110) — toggling it off writes an explicit false row; toggling it
// back on deletes that row rather than writing true, keeping the table
// storing only the exceptions. Read by AskBubble.jsx (src/lib/aiCapabilities.js)
// to decide which capability tabs to show in the floating chat bubble.
function AICapabilitiesTab() {
  const { profile } = useAuth()
  const [enabled, setEnabled] = useState({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setErr('')
    try { setEnabled(await getEnabledCapabilities()) }
    catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function toggle(key) {
    const next = !enabled[key]
    setEnabled(e => ({ ...e, [key]: next })) // optimistic
    try {
      if (next) {
        await supabase.from('ai_capability_settings').delete().eq('capability_key', key)
      } else {
        await setCapabilityEnabled(key, false, profile.id)
      }
    } catch (e) { setErr(e.message); load() }
  }

  if (loading) return <Loader />

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>AI Capabilities</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 18 }}>
        Turn individual AI features on or off for this organization — independent of the module they live in.
        Useful if you haven't configured an LLM key yet, or want to control AI usage. Everything is on by default.
      </p>
      {err && <Alert type="error" message={err} />}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Capability</th><th>Part of</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {AI_CAPABILITY_REGISTRY.map(c => (
              <tr key={c.key}>
                <td className="td-bold">{c.label}</td>
                <td style={{ color: 'var(--ink-muted)' }}>{c.module}</td>
                <td>{enabled[c.key]
                  ? <span style={{ color: '#16a34a', fontWeight: 700, fontSize: 12 }}>Enabled</span>
                  : <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 12 }}>Disabled</span>}</td>
                <td>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!enabled[c.key]} onChange={() => toggle(c.key)} style={{ width: 16, height: 16, accentColor: '#10b981', cursor: 'pointer' }} />
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AILLMKeysTab() {
  const { profile } = useAuth()
  const [form, setForm] = useState({ deepseek_api_key: '', gemini_api_key: '', claude_api_key: '', ollama_url: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const [reveal, setReveal] = useState({ deepseek_api_key: false, gemini_api_key: false, claude_api_key: false })

  useEffect(() => {
    getLLMSettings().then(s => {
      setForm({ deepseek_api_key: s.deepseek_api_key || '', gemini_api_key: s.gemini_api_key || '', claude_api_key: s.claude_api_key || '', ollama_url: s.ollama_url || '' })
      setLoading(false)
    })
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    setSaving(true); setErr('')
    try {
      await saveLLMSettings(form, profile?.id)
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setErr(e.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Loader />

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>AI / LLM Keys</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 20 }}>
        API keys for Neo Task AI and the Data Assistant. Saved here, they apply to every user immediately and take
        priority over the .env file — no redeploy needed. Leave a field blank to fall back to .env.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 520, marginBottom: 20 }}>
        {[['deepseek_api_key', 'DeepSeek API Key', 'sk-...'], ['gemini_api_key', 'Gemini API Key', 'AIza...'], ['claude_api_key', 'Claude API Key', 'sk-ant-...']].map(([k, label, ph]) => (
          <div key={k}>
            <label className="form-label">{label}</label>
            <div style={{ position: 'relative' }}>
              <input
                className="form-input" style={{ paddingRight: 38 }}
                type={reveal[k] ? 'text' : 'password'}
                value={form[k]} placeholder={ph}
                onChange={e => set(k, e.target.value)}
              />
              <button type="button" onClick={() => setReveal(r => ({ ...r, [k]: !r[k] }))}
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)', display: 'flex' }}>
                {reveal[k] ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
        ))}
        <div>
          <label className="form-label">Ollama URL</label>
          <input className="form-input" value={form.ollama_url} placeholder="http://localhost:11434" onChange={e => set('ollama_url', e.target.value)} />
        </div>
      </div>

      {err && <Alert type="error" message={err} />}
      {saved && <Alert type="success" message="AI settings saved — applies to all users right away." />}
      <button className="btn btn-primary" onClick={save} disabled={saving}><Save size={15} /> {saving ? 'Saving…' : 'Save AI Settings'}</button>

      <div style={{ marginTop: 20, padding: '12px 16px', borderRadius: 10, background: 'var(--surface-2)', fontSize: 12, color: 'var(--ink-muted)', maxWidth: 520 }}>
        Note: like any client-side app, these keys are sent to the browser and callable by any logged-in user — the
        same exposure the .env keys already had. Don't use a key here that needs to stay fully private to admins.
      </div>
    </div>
  )
}

// ── Sales Config (Part 7 admin panel) ──
// Everything structural about the Sales & Pre-Sales CRM that shouldn't
// need a code deployment when the sales org grows — regions, role
// definitions, rep assignments, per-domain pipeline stages, lookup
// lists, assignment rules, stale/overdue thresholds, and the
// profit-attribution individual-visibility flag (Part 8 §2).
const SALES_SECTIONS = ['regions', 'roles', 'assignments', 'stages', 'lookups', 'rules', 'thresholds', 'flags']
const SALES_SECTION_LABEL = { regions: 'Regions', roles: 'Role Definitions', assignments: 'Rep Assignments', stages: 'Pipeline Stages', lookups: 'Lookup Lists', rules: 'Assignment Rules', thresholds: 'Stale Thresholds', flags: 'Visibility Flags' }

function SalesConfigTab() {
  const { profile } = useAuth()
  const [section, setSection] = useState('regions')
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
        {SALES_SECTIONS.map(s => (
          <button key={s} onClick={() => setSection(s)} className={`btn btn-ghost btn-sm ${section === s ? 'btn-primary' : ''}`}>{SALES_SECTION_LABEL[s]}</button>
        ))}
      </div>
      {section === 'regions' && <SalesRegionsSection />}
      {section === 'roles' && <SalesRoleDefinitionsSection />}
      {section === 'assignments' && <SalesRepAssignmentsSection />}
      {section === 'stages' && <SalesPipelineStagesSection />}
      {section === 'lookups' && <SalesLookupsSection />}
      {section === 'rules' && <SalesAssignmentRulesSection />}
      {section === 'thresholds' && <SalesStaleThresholdsSection />}
      {section === 'flags' && <SalesFlagsSection profile={profile} />}
    </div>
  )
}

function SalesRegionsSection() {
  const [regions, setRegions] = useState([])
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => { load() }, [])
  async function load() { setLoading(true); setRegions(await listRegions()); setLoading(false) }
  async function add() { if (!name.trim()) return; await createRegion({ region_name: name.trim() }); setName(''); await load() }
  if (loading) return <Loader />
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input className="form-input" style={{ maxWidth: 260 }} placeholder="New region name" value={name} onChange={e => setName(e.target.value)} />
        <button className="btn btn-primary btn-sm" onClick={add}><Plus size={13} /> Add</button>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Region</th><th></th></tr></thead><tbody>
        {regions.map(r => (
          <tr key={r.id}><td className="td-bold">{r.region_name}</td>
            <td><button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={async () => { await deleteRegion(r.id); load() }}><Trash2 size={12} /></button></td></tr>
        ))}
      </tbody></table></div>
    </div>
  )
}

function SalesRoleDefinitionsSection() {
  const [defs, setDefs] = useState([])
  const [regions, setRegions] = useState([])
  const [form, setForm] = useState({ direction: 'Outbound', domain: 'B2B', region_id: '', role_title: '' })
  const [loading, setLoading] = useState(true)
  useEffect(() => { load() }, [])
  async function load() { setLoading(true); const [d, r] = await Promise.all([listRoleDefinitions(), listRegions()]); setDefs(d); setRegions(r); setLoading(false) }
  async function add() { await createRoleDefinition(form); setForm(f => ({ ...f, role_title: '' })); await load() }
  if (loading) return <Loader />
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <select className="form-select" style={{ width: 130 }} value={form.direction} onChange={e => setForm(f => ({ ...f, direction: e.target.value }))}>
          <option value="Inbound">Inbound</option><option value="Outbound">Outbound</option>
        </select>
        <select className="form-select" style={{ width: 150 }} value={form.domain} onChange={e => setForm(f => ({ ...f, domain: e.target.value }))}>
          {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="form-select" style={{ width: 160 }} value={form.region_id} onChange={e => setForm(f => ({ ...f, region_id: e.target.value }))}>
          <option value="">All Regions</option>{regions.map(r => <option key={r.id} value={r.id}>{r.region_name}</option>)}
        </select>
        <input className="form-input" style={{ width: 200 }} placeholder="Role title (optional)" value={form.role_title} onChange={e => setForm(f => ({ ...f, role_title: e.target.value }))} />
        <button className="btn btn-primary btn-sm" onClick={add}><Plus size={13} /> Add</button>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Title</th><th>Direction</th><th>Domain</th><th>Region</th><th></th></tr></thead><tbody>
        {defs.map(d => (
          <tr key={d.id}><td className="td-bold">{d.role_title}</td><td>{d.direction}</td><td>{d.domain}</td><td>{d.region?.region_name || 'All'}</td>
            <td><button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={async () => { await deleteRoleDefinition(d.id); load() }}><Trash2 size={12} /></button></td></tr>
        ))}
      </tbody></table></div>
    </div>
  )
}

function SalesRepAssignmentsSection() {
  const [assignments, setAssignments] = useState([])
  const [defs, setDefs] = useState([])
  const [users, setUsers] = useState([])
  const [form, setForm] = useState({ profile_id: '', sales_role_definition_id: '' })
  const [loading, setLoading] = useState(true)
  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const [a, d, u] = await Promise.all([listRepAssignments(), listRoleDefinitions(), supabase.from('profiles').select('id,full_name').order('full_name')])
    setAssignments(a); setDefs(d); setUsers(u.data || [])
    setLoading(false)
  }
  async function add() {
    if (!form.profile_id || !form.sales_role_definition_id) return
    await createRepAssignment(form); setForm({ profile_id: '', sales_role_definition_id: '' }); await load()
  }
  if (loading) return <Loader />
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <select className="form-select" style={{ width: 200 }} value={form.profile_id} onChange={e => setForm(f => ({ ...f, profile_id: e.target.value }))}>
          <option value="">Select employee…</option>{users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
        <select className="form-select" style={{ width: 260 }} value={form.sales_role_definition_id} onChange={e => setForm(f => ({ ...f, sales_role_definition_id: e.target.value }))}>
          <option value="">Select role definition…</option>{defs.map(d => <option key={d.id} value={d.id}>{d.role_title}</option>)}
        </select>
        <button className="btn btn-primary btn-sm" onClick={add}><Plus size={13} /> Assign</button>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Role</th><th></th></tr></thead><tbody>
        {assignments.map(a => (
          <tr key={a.id}><td className="td-bold">{a.profile?.full_name}</td><td>{a.role_def?.role_title}</td>
            <td><button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={async () => { await deleteRepAssignment(a.id); load() }}><Trash2 size={12} /></button></td></tr>
        ))}
      </tbody></table></div>
    </div>
  )
}

function SalesPipelineStagesSection() {
  const [domain, setDomain] = useState('B2B')
  const [stages, setStages] = useState([])
  const [form, setForm] = useState({ stage_name: '', sort_order: 0, default_probability_percent: 0 })
  const [loading, setLoading] = useState(true)
  useEffect(() => { load() }, [domain])
  async function load() { setLoading(true); setStages(await listPipelineStages(domain)); setLoading(false) }
  async function add() {
    if (!form.stage_name.trim()) return
    await createPipelineStage({ domain, ...form }); setForm({ stage_name: '', sort_order: stages.length + 1, default_probability_percent: 0 }); await load()
  }
  return (
    <div>
      <select className="form-select" style={{ width: 180, marginBottom: 14 }} value={domain} onChange={e => setDomain(e.target.value)}>
        {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
      </select>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input className="form-input" style={{ width: 200 }} placeholder="Stage name" value={form.stage_name} onChange={e => setForm(f => ({ ...f, stage_name: e.target.value }))} />
        <input className="form-input" style={{ width: 100 }} type="number" placeholder="Sort order" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} />
        <input className="form-input" style={{ width: 130 }} type="number" placeholder="Default prob. %" value={form.default_probability_percent} onChange={e => setForm(f => ({ ...f, default_probability_percent: e.target.value }))} />
        <button className="btn btn-primary btn-sm" onClick={add}><Plus size={13} /> Add Stage</button>
      </div>
      {loading ? <Loader /> : (
        <div className="table-wrap"><table><thead><tr><th>Order</th><th>Stage</th><th>Default Prob. %</th><th></th></tr></thead><tbody>
          {stages.map(s => (
            <tr key={s.id}><td>{s.sort_order}</td><td className="td-bold">{s.stage_name}</td><td>{s.default_probability_percent}%</td>
              <td><button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={async () => { await deletePipelineStage(s.id); load() }}><Trash2 size={12} /></button></td></tr>
          ))}
        </tbody></table></div>
      )}
    </div>
  )
}

const LOOKUP_KINDS = { leadSources: 'Lead Sources', activityTypes: 'Activity Types', taskTypes: 'Task Types', outcomes: 'Activity Outcomes' }
function SalesLookupsSection() {
  const [kind, setKind] = useState('leadSources')
  const [items, setItems] = useState([])
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => { load() }, [kind])
  async function load() { setLoading(true); setItems(await listLookup(kind)); setLoading(false) }
  async function add() { if (!name.trim()) return; await createLookup(kind, name); setName(''); await load() }
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {Object.entries(LOOKUP_KINDS).map(([k, label]) => (
          <button key={k} className={`btn btn-ghost btn-sm ${kind === k ? 'btn-primary' : ''}`} onClick={() => setKind(k)}>{label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input className="form-input" style={{ width: 220 }} placeholder="New value" value={name} onChange={e => setName(e.target.value)} />
        <button className="btn btn-primary btn-sm" onClick={add}><Plus size={13} /> Add</button>
      </div>
      {loading ? <Loader /> : (
        <div className="table-wrap"><table><thead><tr><th>Value</th><th>Active</th><th></th></tr></thead><tbody>
          {items.map(i => (
            <tr key={i.id}><td className="td-bold">{i.name}</td>
              <td><button className="btn btn-ghost btn-sm" onClick={async () => { await setLookupActive(kind, i.id, !i.is_active); load() }}>{i.is_active ? <Eye size={13} /> : <EyeOff size={13} />}</button></td>
              <td><button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={async () => { await deleteLookup(kind, i.id); load() }}><Trash2 size={12} /></button></td></tr>
          ))}
        </tbody></table></div>
      )}
    </div>
  )
}

function SalesAssignmentRulesSection() {
  const [rules, setRules] = useState([])
  const [regions, setRegions] = useState([])
  const [form, setForm] = useState({ domain: 'B2B', region_id: '', rule_type: 'domain_region_match' })
  const [loading, setLoading] = useState(true)
  useEffect(() => { load() }, [])
  async function load() { setLoading(true); const [r, rg] = await Promise.all([listAssignmentRules(), listRegions()]); setRules(r); setRegions(rg); setLoading(false) }
  async function add() { await createAssignmentRule(form); await load() }
  if (loading) return <Loader />
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <select className="form-select" style={{ width: 150 }} value={form.domain} onChange={e => setForm(f => ({ ...f, domain: e.target.value }))}>
          {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="form-select" style={{ width: 160 }} value={form.region_id} onChange={e => setForm(f => ({ ...f, region_id: e.target.value }))}>
          <option value="">All Regions</option>{regions.map(r => <option key={r.id} value={r.id}>{r.region_name}</option>)}
        </select>
        <select className="form-select" style={{ width: 200 }} value={form.rule_type} onChange={e => setForm(f => ({ ...f, rule_type: e.target.value }))}>
          <option value="domain_region_match">Domain + Region Match</option>
          <option value="round_robin">Round Robin</option>
          <option value="manual">Manual Only</option>
        </select>
        <button className="btn btn-primary btn-sm" onClick={add}><Plus size={13} /> Add Rule</button>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Domain</th><th>Region</th><th>Rule</th><th></th></tr></thead><tbody>
        {rules.map(r => (
          <tr key={r.id}><td>{r.domain}</td><td>{r.region?.region_name || 'All'}</td><td>{r.rule_type}</td>
            <td><button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={async () => { await deleteAssignmentRule(r.id); load() }}><Trash2 size={12} /></button></td></tr>
        ))}
      </tbody></table></div>
    </div>
  )
}

function SalesStaleThresholdsSection() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => { load() }, [])
  async function load() { setLoading(true); setRows(await listStaleThresholds()); setLoading(false) }
  async function save(id, patch) { await updateStaleThreshold(id, patch); await load() }
  if (loading) return <Loader />
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>Domain</th><th>Stale Lead (days)</th><th>Task Overdue Escalation (days)</th><th>Notes</th></tr></thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id}>
            <td className="td-bold">{r.domain}</td>
            <td><input className="form-input" style={{ width: 80 }} type="number" defaultValue={r.stale_lead_days} onBlur={e => e.target.value != r.stale_lead_days && save(r.id, { stale_lead_days: Number(e.target.value) })} /></td>
            <td><input className="form-input" style={{ width: 80 }} type="number" defaultValue={r.task_overdue_escalation_days} onBlur={e => e.target.value != r.task_overdue_escalation_days && save(r.id, { task_overdue_escalation_days: Number(e.target.value) })} /></td>
            <td style={{ fontSize: 11, color: '#94a3b8' }}>{r.notes}</td>
          </tr>
        ))}
      </tbody>
    </table></div>
  )
}

function SalesFlagsSection({ profile }) {
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(true)
  useEffect(() => { getConfigFlag('view_sales_profit_attribution_individual').then(v => { setVisible(!!v); setLoading(false) }) }, [])
  async function toggle() {
    const next = !visible
    await setConfigFlag('view_sales_profit_attribution_individual', next, profile.id)
    setVisible(next)
  }
  if (loading) return <Loader />
  return (
    <div className="card" style={{ padding: 16, maxWidth: 560 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Individual Profit Attribution Visibility</div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
        When ON, a Sales Rep can see their own SalesProfitAttribution row (booked revenue vs. actual delivered profit). Default OFF — Sales Head and Finance only, since delivered profit includes warranty/change costs outside a rep's control.
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input type="checkbox" checked={visible} onChange={toggle} /> Allow Sales Reps to view their own profit attribution
      </label>
    </div>
  )
}


// ── Marketing Config — campaign/cost type lookup lists, reusing the same
// listLookup()/createLookup() CRUD src/lib/salesAdmin.js already has for
// Sales Config's lookup lists (STEP76 just added two more LIST_TABLES
// entries: campaignTypes, costTypes). ──
const MARKETING_LOOKUP_KINDS = { campaignTypes: 'Campaign Types', costTypes: 'Cost Types' }
function MarketingConfigTab() {
  const [kind, setKind] = useState('campaignTypes')
  const [items, setItems] = useState([])
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => { load() }, [kind])
  async function load() { setLoading(true); setItems(await listLookup(kind)); setLoading(false) }
  async function add() { if (!name.trim()) return; await createLookup(kind, name); setName(''); await load() }
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {Object.entries(MARKETING_LOOKUP_KINDS).map(([k, label]) => (
          <button key={k} className={`btn btn-ghost btn-sm ${kind === k ? 'btn-primary' : ''}`} onClick={() => setKind(k)}>{label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input className="form-input" style={{ width: 220 }} placeholder="New value" value={name} onChange={e => setName(e.target.value)} />
        <button className="btn btn-primary btn-sm" onClick={add}><Plus size={13} /> Add</button>
      </div>
      {loading ? <Loader /> : (
        <div className="table-wrap"><table><thead><tr><th>Value</th><th>Active</th><th></th></tr></thead><tbody>
          {items.map(i => (
            <tr key={i.id}><td className="td-bold">{i.name}</td>
              <td><button className="btn btn-ghost btn-sm" onClick={async () => { await setLookupActive(kind, i.id, !i.is_active); load() }}>{i.is_active ? <Eye size={13} /> : <EyeOff size={13} />}</button></td>
              <td><button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={async () => { await deleteLookup(kind, i.id); load() }}><Trash2 size={12} /></button></td></tr>
          ))}
        </tbody></table></div>
      )}
    </div>
  )
}

// ── Organization (Phase 4 — STEP105) ──
// Shows this org's identity and lets admin/ceo generate invite codes so
// teammates land in THIS org (not 'default-org') at signup. Org
// rename/suspend is platform-level (organizations_write requires
// is_super_admin) — deliberately not exposed here, only in Super Admin.
function OrganizationTab() {
  const { profile } = useAuth()
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ role: 'employee', maxUses: 1, expiresDays: 7 })
  const [err, setErr] = useState('')
  const [roles, setRoles] = useState([])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [inv, r] = await Promise.all([listInvites(), listRoles()])
    setInvites(inv); setRoles(r)
    setLoading(false)
  }

  async function handleCreate(e) {
    e.preventDefault(); setCreating(true); setErr('')
    try {
      await createInvite({
        role: form.role, maxUses: form.maxUses ? Number(form.maxUses) : null,
        expiresDays: form.expiresDays ? Number(form.expiresDays) : null,
        organizationId: profile.organization_id, createdBy: profile.id,
      })
      load()
    } catch (e) { setErr(e.message) }
    finally { setCreating(false) }
  }

  async function handleRevoke(id) {
    await revokeInvite(id); load()
  }

  function copyCode(code) {
    const url = `${window.location.origin}/auth?mode=signup`
    navigator.clipboard?.writeText(code)
    alert(`Invite code "${code}" copied.\n\nShare it with your teammate along with this sign-up link:\n${url}\n\nThey should choose "Join with invite" and paste the code.`)
  }

  if (loading) return <Loader />

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Your Organization</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderRadius: 12, background: 'var(--surface-2, rgba(99,102,241,.06))', border: '1px solid var(--border)' }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: '#fff', fontWeight: 800 }}>
            {(profile?.org?.name || '?')[0]?.toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{profile?.org?.name || 'Unknown organization'}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>/{profile?.org?.slug}</div>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Invite Teammates</h3>
        <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 14 }}>Generate a code and share it — anyone who signs up with it joins this organization at the role you set, without touching Default Organization.</p>
        {err && <Alert type="error" message={err} />}
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 18 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 4, textTransform: 'uppercase' }}>Role</label>
            <select className="form-input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              {roles.map(r => <option key={r.role_key} value={r.role_key}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 4, textTransform: 'uppercase' }}>Max uses</label>
            <input className="form-input" style={{ width: 90 }} type="number" min={1} value={form.maxUses} onChange={e => setForm(f => ({ ...f, maxUses: e.target.value }))} placeholder="∞" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', marginBottom: 4, textTransform: 'uppercase' }}>Expires (days)</label>
            <input className="form-input" style={{ width: 90 }} type="number" min={1} value={form.expiresDays} onChange={e => setForm(f => ({ ...f, expiresDays: e.target.value }))} placeholder="never" />
          </div>
          <button className="btn btn-primary btn-sm" disabled={creating} type="submit"><Plus size={13} /> Generate Invite</button>
        </form>

        {invites.length === 0 ? <Empty message="No invites yet" /> : (
          <div className="table-wrap"><table><thead><tr><th>Code</th><th>Role</th><th>Uses</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>
            {invites.map(i => {
              const expired = i.expires_at && new Date(i.expires_at) < new Date()
              const exhausted = i.max_uses && i.use_count >= i.max_uses
              const inactive = i.revoked || expired || exhausted
              return (
                <tr key={i.id}>
                  <td className="td-bold" style={{ letterSpacing: '.05em', cursor: 'pointer' }} onClick={() => copyCode(i.code)} title="Click to copy">{i.code}</td>
                  <td>{i.role}</td>
                  <td>{i.use_count}{i.max_uses ? ` / ${i.max_uses}` : ''}</td>
                  <td>{i.expires_at ? new Date(i.expires_at).toLocaleDateString() : 'Never'}</td>
                  <td>
                    {i.revoked ? <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 12 }}>Revoked</span>
                      : expired ? <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 12 }}>Expired</span>
                      : exhausted ? <span style={{ color: 'var(--ink-muted)', fontWeight: 700, fontSize: 12 }}>Used up</span>
                      : <span style={{ color: '#16a34a', fontWeight: 700, fontSize: 12 }}>Active</span>}
                  </td>
                  <td>{!inactive && <button className="btn btn-ghost btn-sm btn-icon" style={{ color: '#ef4444' }} onClick={() => handleRevoke(i.id)}><Trash2 size={12} /></button>}</td>
                </tr>
              )
            })}
          </tbody></table></div>
        )}
      </div>
    </div>
  )
}

// ── Billing (STEP107) ──
// Read-only view of the org's own plan/status/trial/seat usage (comes
// off profile.org — AuthContext's join already carries the billing
// columns, same as name/slug) plus a self-serve "request a plan change"
// flow. No payment gateway is wired up — actioning the request (and
// therefore the actual charge, handled outside this app) is a platform
// super admin's job from /super-admin.
// ── Renewal / Cancellation (STEP128) — EXPERIMENTAL. The Edge Functions
// behind createPaymentOrder/launchCheckout have not been exercised
// against any live Razorpay/Stripe/Cashfree sandbox; the actual gateway
// calls, signature verification, and checkout SDK loading are all
// written to each provider's public docs but unverified. Says so
// directly in the UI rather than presenting this as production-ready. ──
const PROVIDER_LABEL = { razorpay: 'Razorpay', stripe: 'Stripe', cashfree: 'Cashfree' }

function RenewalSection({ org, profile, activeBundleKeys, paymentProviders }) {
  const [payingWith, setPayingWith] = useState(null)
  const [err, setErr] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [cancelForm, setCancelForm] = useState(null)
  const [cancelling, setCancelling] = useState(false)

  // A gateway shows up here only if it's platform-enabled AND (when the
  // org has a per-org allow-list) on that allow-list. This mirrors, but
  // doesn't replace, the same two checks create-payment-order enforces
  // server-side (STEP129) — this is a UI convenience, not the actual gate.
  const availableProviders = (paymentProviders || [])
    .filter(p => p.is_active)
    .filter(p => !org?.allowed_payment_providers || org.allowed_payment_providers.includes(p.key))
    .map(p => p.key)

  async function handlePay(provider) {
    setPayingWith(provider); setErr(''); setSubmitted(false)
    try {
      const order = await createPaymentOrder({ provider, planKey: org?.plan_key, bundleKeys: activeBundleKeys, billingCycle: 'monthly' })
      await launchCheckout(order, { orgName: org?.name, email: profile?.email, onSubmitted: () => setSubmitted(true) })
    } catch (e) { setErr(e.message) }
    finally { setPayingWith(null) }
  }

  async function handleCancel() {
    setCancelling(true); setErr('')
    try {
      await cancelSubscription(cancelForm.immediately, cancelForm.reason)
      setCancelForm(null)
      window.location.reload() // simplest way to refresh profile.org everywhere it's read from
    } catch (e) { setErr(e.message) }
    finally { setCancelling(false) }
  }

  return (
    <div style={{ marginBottom: 32, padding: '16px 20px', borderRadius: 12, border: '1px solid var(--border)' }}>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 4 }}>Renew / Manage Subscription</h3>
      <p style={{ fontSize: '0.82rem', color: 'var(--ink-muted)', marginBottom: 14 }}>
        {org?.current_period_end ? <>Current period ends {dateFmt(org.current_period_end)}. </> : 'No active billing period yet. '}
        Experimental — not yet verified against a live Razorpay/Stripe/Cashfree sandbox.
      </p>
      {err && <Alert type="error" message={err} />}
      {submitted && <Alert type="success" message="Payment submitted — this updates automatically once confirmed, usually within a minute." />}
      {availableProviders.length === 0 ? (
        <p style={{ fontSize: '0.82rem', color: 'var(--ink-muted)', marginBottom: 14 }}>No payment method is currently enabled for your organization — contact the platform team.</p>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {availableProviders.map(key => (
            <button key={key} className="btn btn-outline btn-sm" disabled={!!payingWith} onClick={() => handlePay(key)}>
              {payingWith === key ? 'Opening…' : `Pay with ${PROVIDER_LABEL[key] || key}`}
            </button>
          ))}
        </div>
      )}

      {cancelForm ? (
        <div style={{ padding: 12, borderRadius: 8, background: 'var(--surface-2, rgba(99,102,241,.06))' }}>
          <div style={{ display: 'flex', gap: 16, marginBottom: 8, fontSize: 13 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="radio" checked={!cancelForm.immediately} onChange={() => setCancelForm(f => ({ ...f, immediately: false }))} /> Cancel at period end
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="radio" checked={cancelForm.immediately} onChange={() => setCancelForm(f => ({ ...f, immediately: true }))} /> Cancel immediately
            </label>
          </div>
          <textarea className="form-input" rows={2} placeholder="Reason (optional)" value={cancelForm.reason} onChange={e => setCancelForm(f => ({ ...f, reason: e.target.value }))} style={{ marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-danger btn-sm" onClick={handleCancel} disabled={cancelling}>{cancelling ? 'Cancelling…' : 'Confirm Cancellation'}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setCancelForm(null)}>Back</button>
          </div>
        </div>
      ) : (
        org?.billing_status !== 'canceled' && (
          <button className="btn btn-ghost btn-sm" style={{ color: '#dc2626' }} onClick={() => setCancelForm({ immediately: false, reason: '' })}>Cancel Subscription</button>
        )
      )}
    </div>
  )
}

function BillingTab() {
  const { profile } = useAuth()
  const org = profile?.org
  const isEnterprise = org?.plan_key === 'enterprise'
  const [plans, setPlans] = useState([])
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [requesting, setRequesting] = useState(null) // plan key being requested
  const [note, setNote] = useState('')
  const [seatCount, setSeatCount] = useState(null)

  const [bundles, setBundles] = useState([])
  const [activeBundleKeys, setActiveBundleKeys] = useState(new Set())
  const [bundleRequests, setBundleRequests] = useState([])
  const [monthlyTotal, setMonthlyTotal] = useState(0)
  const [bundleAction, setBundleAction] = useState(null) // { key, action }
  const [bundleNote, setBundleNote] = useState('')
  const [bundleErr, setBundleErr] = useState('')
  const [paymentProviders, setPaymentProviders] = useState([])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setErr('')
    try {
      const [p, r, seats, b, myBundles, bReqs, total, providers] = await Promise.all([
        listPlans(),
        myUpgradeRequests(),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('organization_id', profile.organization_id),
        listBundles(),
        myBundleSubscriptions(profile.organization_id),
        myBundleRequests(),
        orgBundleMonthlyTotal(profile.organization_id),
        listPaymentProviders(),
      ])
      setPlans(p); setRequests(r); setSeatCount(seats.count ?? null)
      setBundles(b); setActiveBundleKeys(new Set(myBundles.map(x => x.bundle_key))); setBundleRequests(bReqs); setMonthlyTotal(total)
      setPaymentProviders(providers)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function handleRequest(planKey) {
    setErr('')
    try {
      await requestUpgrade(planKey, note.trim() || null)
      setRequesting(null); setNote('')
      load()
    } catch (e) { setErr(e.message) }
  }

  async function handleBundleRequest(bundleKey, action) {
    setBundleErr('')
    try {
      await requestBundleChange(bundleKey, action, bundleNote.trim() || null)
      setBundleAction(null); setBundleNote('')
      load()
    } catch (e) { setBundleErr(e.message) }
  }

  if (loading) return <Loader />

  const currentPlan = plans.find(p => p.key === org?.plan_key)
  const seatLimit = org?.seat_limit_override ?? currentPlan?.seat_limit ?? null
  const pendingRequest = requests.find(r => r.status === 'pending')
  const statusColor = { trialing: '#f59e0b', active: '#16a34a', past_due: '#ef4444', canceled: 'var(--ink-muted)' }[org?.billing_status] || 'var(--ink-muted)'
  const statusLabel = { trialing: 'Trial', active: 'Active', past_due: 'Past Due', canceled: 'Canceled' }[org?.billing_status] || org?.billing_status

  return (
    <div>
      {err && <Alert type="error" message={err} />}

      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Current Plan</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '16px 20px', borderRadius: 12, background: 'var(--surface-2, rgba(99,102,241,.06))', border: '1px solid var(--border)' }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
            <CreditCard size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontWeight: 800, fontSize: '1rem' }}>{currentPlan?.name || org?.plan_key || 'Unknown'}</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--ink-muted)' }}>
              {seatCount ?? '?'} / {seatLimit ?? '∞'} seats used
              {org?.billing_status === 'trialing' && org?.trial_ends_at && <> · Trial ends {dateFmt(org.trial_ends_at)}</>}
            </div>
          </div>
          <span style={{ color: statusColor, fontWeight: 700, fontSize: 12, padding: '4px 10px', borderRadius: 999, border: `1px solid ${statusColor}` }}>{statusLabel}</span>
        </div>
        {pendingRequest && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: 'var(--ink-muted)' }}>
            <Clock size={13} /> A request to move to <strong>{plans.find(p => p.key === pendingRequest.requested_plan_key)?.name || pendingRequest.requested_plan_key}</strong> is pending review.
          </div>
        )}
      </div>

      <RenewalSection org={org} profile={profile} activeBundleKeys={[...activeBundleKeys]} paymentProviders={paymentProviders} />

      <div>
        <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Compare Plans</h3>
        <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 16 }}>Requesting a plan change notifies the platform team — there's no self-serve checkout yet, a super admin actions it from their console.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {plans.map(p => {
            const isCurrent = p.key === org?.plan_key
            return (
              <div key={p.key} style={{ border: isCurrent ? '2px solid var(--c1)' : '1px solid var(--border)', borderRadius: 12, padding: 16, position: 'relative' }}>
                {isCurrent && <span style={{ position: 'absolute', top: 10, right: 10, color: 'var(--c1)' }}><CheckCircle2 size={16} /></span>}
                <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: 4 }}>{p.name}</div>
                <div style={{ fontWeight: 700, fontSize: '1.3rem', marginBottom: 2 }}>
                  {p.price_monthly == null ? 'Contact sales' : p.price_monthly === 0 ? 'Free' : `${rupee(p.price_monthly)}/mo`}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', marginBottom: 10 }}>{p.seat_limit ? `Up to ${p.seat_limit} seats` : 'Unlimited seats'}</div>
                <ul style={{ margin: '0 0 14px', paddingLeft: 18, fontSize: '0.82rem', color: 'var(--ink-muted)' }}>
                  {(p.features || []).map((f, i) => <li key={i}>{f}</li>)}
                </ul>
                {isCurrent ? (
                  <button className="btn btn-ghost btn-sm" disabled style={{ width: '100%', justifyContent: 'center' }}>Current Plan</button>
                ) : requesting === p.key ? (
                  <div>
                    <input className="form-input" style={{ marginBottom: 6, fontSize: '0.82rem' }} placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleRequest(p.key)}>Confirm</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setRequesting(null); setNote('') }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button className="btn btn-primary btn-sm" disabled={!!pendingRequest} style={{ width: '100%', justifyContent: 'center' }} onClick={() => setRequesting(p.key)}>
                    {pendingRequest ? 'Request Pending' : 'Request This Plan'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ marginTop: 36 }}>
        <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Puzzle size={17} /> Modules &amp; Add-ons
        </h3>
        <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 6 }}>
          {isEnterprise
            ? 'Your Enterprise plan already includes every module — add-ons below are informational only.'
            : "Pick which modules your team pays for, priced per active seat. Some modules require another one to already be active — see \"Requires\" below."}
        </p>
        {!isEnterprise && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 16, padding: '10px 16px', borderRadius: 10, background: 'var(--surface-2, rgba(99,102,241,.06))', border: '1px solid var(--border)' }}>
            <DollarSign size={15} style={{ color: 'var(--c1)' }} />
            <span style={{ fontSize: '0.85rem', color: 'var(--ink-muted)' }}>Estimated add-on cost, {seatCount ?? 0} active seat(s):</span>
            <span style={{ fontWeight: 800, fontSize: '1.05rem' }}>{rupee(monthlyTotal)}/mo</span>
          </div>
        )}
        {bundleErr && <Alert type="error" message={bundleErr} />}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {bundles.map(b => {
            const isActive = isEnterprise || activeBundleKeys.has(b.key)
            const pending = bundleRequests.find(r => r.bundle_key === b.key && r.status === 'pending')
            const missing = (b.requires || []).filter(reqKey => !activeBundleKeys.has(reqKey) && !isEnterprise)
            const dependents = bundles.filter(other => (other.requires || []).includes(b.key) && activeBundleKeys.has(other.key))
            return (
              <div key={b.key} style={{ border: isActive ? '2px solid var(--c1)' : '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{b.name}</div>
                  {isActive ? <Unlock size={15} style={{ color: 'var(--c1)', flexShrink: 0 }} /> : <Lock size={15} style={{ color: 'var(--ink-muted)', flexShrink: 0 }} />}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--ink-muted)', marginBottom: 8 }}>{(b.module_keys || []).length} modules · {rupee(b.price_per_seat_monthly)}/seat/mo</div>
                {missing.length > 0 && (
                  <div style={{ fontSize: '0.76rem', color: '#b45309', marginBottom: 8 }}>Requires: {missing.map(k => bundles.find(x => x.key === k)?.name || k).join(', ')}</div>
                )}
                {pending ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--ink-muted)' }}>
                    <Clock size={12} /> {pending.action === 'activate' ? 'Activation' : 'Deactivation'} pending review
                  </div>
                ) : bundleAction?.key === b.key ? (
                  <div>
                    <input className="form-input" style={{ marginBottom: 6, fontSize: '0.8rem' }} placeholder="Note (optional)" value={bundleNote} onChange={e => setBundleNote(e.target.value)} />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleBundleRequest(b.key, bundleAction.action)}>Confirm</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setBundleAction(null); setBundleNote('') }}>Cancel</button>
                    </div>
                  </div>
                ) : isEnterprise ? (
                  <button className="btn btn-ghost btn-sm" disabled style={{ width: '100%', justifyContent: 'center' }}>Included</button>
                ) : isActive ? (
                  <button className="btn btn-outline btn-sm" style={{ width: '100%', justifyContent: 'center' }}
                    disabled={dependents.length > 0}
                    title={dependents.length > 0 ? `Deactivate ${dependents.map(d => d.name).join(', ')} first` : undefined}
                    onClick={() => setBundleAction({ key: b.key, action: 'deactivate' })}>
                    {dependents.length > 0 ? 'In Use by Other Modules' : 'Deactivate'}
                  </button>
                ) : (
                  <button className="btn btn-primary btn-sm" style={{ width: '100%', justifyContent: 'center' }}
                    disabled={missing.length > 0}
                    onClick={() => setBundleAction({ key: b.key, action: 'activate' })}>
                    Activate
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Permissions (STEP125) ──
// 'admin' is locked read-only in this grid — it's seeded with every
// permission and is the role that bootstraps this very screen; letting
// someone uncheck their own admin's AWARD_GRANT etc. here would be a
// self-lockout with no recovery path short of the SQL editor, same
// reasoning as `settings` being a PROTECTED_MODULE in lib/modules.js.
const PERMISSION_LOCKED_ROLE = 'admin'

function PermissionsTab() {
  const [permissions, setPermissions] = useState([])
  const [roles, setRoles] = useState([])
  const [granted, setGranted] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setErr('')
    try {
      const [perms, rolePerms, roleList] = await Promise.all([listPermissions(), listRolePermissions(), listRoles()])
      setPermissions(perms)
      setRoles(roleList)
      setGranted(new Set(rolePerms.map(rp => `${rp.role_key}:${rp.permission_key}`)))
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function toggle(roleKey, permKey) {
    if (roleKey === PERMISSION_LOCKED_ROLE) return
    const key = `${roleKey}:${permKey}`
    const isGranted = granted.has(key)
    setGranted(g => { const next = new Set(g); isGranted ? next.delete(key) : next.add(key); return next })
    try { await setRolePermission(roleKey, permKey, !isGranted) }
    catch (e) {
      setErr(e.message)
      setGranted(g => { const next = new Set(g); isGranted ? next.add(key) : next.delete(key); return next }) // revert on failure
    }
  }

  if (loading) return <Loader />

  const categories = [...new Set(permissions.map(p => p.category))]

  return (
    <div>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 16 }}>
        Which roles can perform which actions, independent of the Roles &amp; Modules tab's nav visibility. Changes apply immediately, platform-wide (roles aren't per-organization).
      </p>
      {err && <Alert type="error" message={err} />}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Permission</th>
              {roles.map(r => (
                <th key={r.role_key} style={{ textAlign: 'center' }} title={r.role_key === PERMISSION_LOCKED_ROLE ? 'Always fully granted' : undefined}>
                  {r.label} {r.role_key === PERMISSION_LOCKED_ROLE && <Lock size={11} style={{ verticalAlign: -1 }} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map(cat => (
              <Fragment key={cat}>
                <tr style={{ background: 'var(--surface)' }}>
                  <td colSpan={roles.length + 1} style={{ fontWeight: 700, fontSize: '0.78rem', color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{cat}</td>
                </tr>
                {permissions.filter(p => p.category === cat).map(p => (
                  <tr key={p.key}>
                    <td>{p.label}</td>
                    {roles.map(r => {
                      const isLocked = r.role_key === PERMISSION_LOCKED_ROLE
                      const isChecked = isLocked || granted.has(`${r.role_key}:${p.key}`)
                      return (
                        <td key={r.role_key} style={{ textAlign: 'center' }}>
                          <input type="checkbox" checked={isChecked} disabled={isLocked} onChange={() => toggle(r.role_key, p.key)} style={{ cursor: isLocked ? 'not-allowed' : 'pointer' }} />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const TABS = [
  { id: 'organization', label: 'Organization', icon: <Building2 size={15} />, group: 'general', description: "Your organization's name, branding and workspace details" },
  { id: 'roles-modules', label: 'Roles & Modules', icon: <Shield size={15} />, group: 'general', description: 'Control which modules are visible to each role, org-wide' },
  { id: 'permissions', label: 'Permissions', icon: <Key size={15} />, group: 'general', description: 'Fine-grained action permissions per role, e.g. who can approve or grant an award' },
  { id: 'billing', label: 'Billing', icon: <CreditCard size={15} />, group: 'general', description: 'Plan, seats, and à-la-carte module add-ons' },
  { id: 'approval', label: 'Approval Chain', icon: <GitBranch size={15} />, group: 'finance', description: 'Configure multi-step approval chains per workflow and role' },
  { id: 'budget', label: 'Budget Config', icon: <DollarSign size={15} />, group: 'finance', description: 'Department and project budget thresholds' },
  { id: 'categories', label: 'Expense Categories', icon: <Tag size={15} />, group: 'finance', description: 'Manage the expense category list' },
  { id: 'gst', label: 'GST Settings', icon: <FileText size={15} />, group: 'finance', description: 'Company GST details and tax configuration' },
  { id: 'document-templates', label: 'Document Templates', icon: <LayoutTemplate size={15} />, group: 'finance', description: 'Design PDF letterheads for invoices, GRNs, warranties and proposals' },
  { id: 'ai-keys', label: 'AI / LLM Keys', icon: <Sparkles size={15} />, group: 'ai', description: 'API keys for DeepSeek and Gemini used by Neo Task AI' },
  { id: 'ai-capabilities', label: 'AI Capabilities', icon: <Sparkles size={15} />, group: 'ai', description: 'Turn AI-powered features on or off per module' },
  { id: 'sales', label: 'Sales Config', icon: <TrendingUp size={15} />, group: 'sales', description: 'Regions, pipeline stages, assignment rules and sales roles' },
  { id: 'marketing', label: 'Marketing Config', icon: <Megaphone size={15} />, group: 'sales', description: 'Campaign budgets, lookups and marketing configuration' },
]

const TAB_GROUPS = [
  { id: 'general', label: 'General' },
  { id: 'finance', label: 'Finance & Approvals' },
  { id: 'ai', label: 'AI' },
  { id: 'sales', label: 'Sales & Marketing' },
]

export default function SettingsPage() {
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState('roles-modules')
  const [search, setSearch] = useState('')
  useEffect(() => { const t = searchParams.get('tab'); if (t) setActiveTab(t) }, [searchParams])

  const q = search.trim().toLowerCase()
  const matches = t => !q || t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
  const activeTabInfo = TABS.find(t => t.id === activeTab)

  return (
    <div>
      <style>{`
        @media (max-width: 900px) {
          .settings-shell { flex-direction: column !important; }
          .settings-rail { width: 100% !important; position: static !important; }
          .settings-rail-groups { display: flex !important; overflow-x: auto; gap: 6px !important; padding-bottom: 4px; }
          .settings-rail-group { flex-shrink: 0; }
        }
      `}</style>

      <div className="page-header">
        <div><div className="page-title">Settings</div><div className="page-subtitle">Configure system-wide settings and permissions</div></div>
      </div>

      <div className="settings-shell" style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div className="settings-rail card" style={{ width: 268, flexShrink: 0, padding: 14, position: 'sticky', top: 20 }}>
          <div style={{ marginBottom: 12 }}>
            <SearchBox value={search} onChange={setSearch} placeholder="Search settings…" />
          </div>
          <div className="settings-rail-groups">
            {TAB_GROUPS.map(g => {
              const groupTabs = TABS.filter(t => t.group === g.id && matches(t))
              if (groupTabs.length === 0) return null
              return (
                <div key={g.id} className="settings-rail-group" style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-muted)', padding: '4px 10px', marginBottom: 2 }}>{g.label}</div>
                  {groupTabs.map(t => {
                    const isActive = t.id === activeTab
                    return (
                      <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                        padding: '9px 10px', borderRadius: 10, border: 'none', cursor: 'pointer', marginBottom: 2,
                        background: isActive ? 'var(--surface-2)' : 'transparent',
                        color: isActive ? 'var(--c1)' : 'var(--ink-soft)',
                        fontWeight: isActive ? 700 : 500, fontSize: '0.85rem', transition: 'background .12s',
                      }}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg)' }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}>
                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 8, flexShrink: 0, background: isActive ? '#fff' : 'var(--surface)', color: isActive ? 'var(--c1)' : 'var(--ink-muted)' }}>{t.icon}</span>
                        {t.label}
                      </button>
                    )
                  })}
                </div>
              )
            })}
            {TABS.every(t => !matches(t)) && (
              <div style={{ fontSize: '0.82rem', color: 'var(--ink-muted)', padding: '8px 10px' }}>No settings match "{search}"</div>
            )}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="card" style={{ marginBottom: 16, padding: '18px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#4338ca)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
                {activeTabInfo?.icon}
              </span>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>{activeTabInfo?.label}</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--ink-muted)' }}>{activeTabInfo?.description}</div>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 24 }}>
            {activeTab === 'roles-modules' && <RolesModulesTab />}
            {activeTab === 'permissions' && <PermissionsTab />}
            {activeTab === 'organization' && <OrganizationTab />}
            {activeTab === 'billing' && <BillingTab />}
            {activeTab === 'approval' && <ApprovalChainTab />}
            {activeTab === 'budget' && <BudgetConfigTab />}
            {activeTab === 'categories' && <ExpenseCategoriesTab />}
            {activeTab === 'gst' && <GSTSettingsTab />}
            {activeTab === 'document-templates' && <DocumentTemplatesTab />}
            {activeTab === 'ai-keys' && <AILLMKeysTab />}
            {activeTab === 'ai-capabilities' && <AICapabilitiesTab />}
            {activeTab === 'sales' && <SalesConfigTab />}
            {activeTab === 'marketing' && <MarketingConfigTab />}
          </div>
        </div>
      </div>
    </div>
  )
}
