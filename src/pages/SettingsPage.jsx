import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useTabVisibility } from '../context/TabVisibilityContext'
import { listRoles, createRole, updateRole, deleteRole, colorForRole } from '../lib/roles'
import { getModules, setModuleEnabled, getModuleRoleVisibility, setModuleRoleVisibility } from '../lib/modules'
import { getLLMSettings, saveLLMSettings } from '../lib/llmSettings'
import { MODULES, MODULE_SECTIONS } from '../config/modules'
import { Alert, Modal, Confirm, Loader, Empty } from '../components/ui'
import {
  Settings, GitBranch, DollarSign, Bell, Tag, FileText, Sparkles, TrendingUp, Megaphone,
  Save, Plus, Trash2, Edit2, Check, X, Users, Eye, EyeOff, Shield, ChevronDown, ChevronRight, ChevronUp, Building2
} from 'lucide-react'
import { listInvites, createInvite, revokeInvite } from '../lib/orgInvites'
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

// ── GST Settings ──
function GSTSettingsTab() {
  const [s, setS] = useState({ gstin: '', business_name: '', address: '', state: '', state_code: '', cgst_rate: 9, sgst_rate: 9, igst_rate: 18, default_hsn: '', include_gst_in_invoices: true, auto_calculate: true })
  const [saved, setSaved] = useState(false)
  function save() { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  const set = (k, v) => setS(p => ({ ...p, [k]: v }))

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>GST Configuration</h3>
      <p style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', marginBottom: 20 }}>Configure GST details for invoices and procurement.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
        {[['gstin','GSTIN','29ABCDE1234F1Z5',false],['business_name','Business Name','Acme Pvt. Ltd.',false],['address','Registered Address','123, MG Road...',true],['state','State','Karnataka',false],['state_code','State Code','29',false],['default_hsn','Default HSN Code','998313',false]].map(([k,label,ph,full]) => (
          <div key={k} style={{ gridColumn: full ? '1/-1' : 'auto' }}>
            <label className="form-label">{label}</label>
            <input className="form-input" value={s[k]} placeholder={ph} onChange={e => set(k, e.target.value)} />
          </div>
        ))}
      </div>
      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 12 }}>GST Rates</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 20 }}>
        {[['cgst_rate','CGST Rate (%)'],['sgst_rate','SGST Rate (%)'],['igst_rate','IGST Rate (%)']].map(([k,l]) => (
          <div key={k}><label className="form-label">{l}</label><input type="number" className="form-input" value={s[k]} onChange={e => set(k, parseFloat(e.target.value)||0)} min={0} max={28} step={0.5} /></div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        {[['include_gst_in_invoices','Include GST breakdown in invoices'],['auto_calculate','Auto-calculate GST on amounts']].map(([k,l]) => (
          <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: '0.9rem' }}>
            <input type="checkbox" checked={s[k]} onChange={() => set(k, !s[k])} style={{ width: 16, height: 16, accentColor: 'var(--c1)' }} />
            {l}
          </label>
        ))}
      </div>
      {saved && <Alert type="success" message="GST settings saved!" />}
      <button className="btn btn-primary" onClick={save}><Save size={15} /> Save GST Settings</button>
    </div>
  )
}

// ── AI / LLM Keys (Admin Feature) ──
// Org-wide, Supabase-backed (src/lib/llmSettings.js, STEP44) so a key set
// here works for every user without a redeploy — takes precedence over the
// build-time VITE_ env vars in src/lib/llm.js. Readable by any authenticated
// user (the browser calls DeepSeek/Gemini directly, same exposure level as
// the existing VITE_ vars, which are already bundled into the client JS),
// writable only by admin/ceo (enforced by STEP44's RLS policy too).
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

const TABS = [
  { id: 'roles-modules', label: 'Roles & Modules', icon: <Shield size={15} /> },
  { id: 'organization', label: 'Organization', icon: <Building2 size={15} /> },
  { id: 'approval', label: 'Approval Chain', icon: <GitBranch size={15} /> },
  { id: 'budget', label: 'Budget Config', icon: <DollarSign size={15} /> },
  { id: 'categories', label: 'Expense Categories', icon: <Tag size={15} /> },
  { id: 'gst', label: 'GST Settings', icon: <FileText size={15} /> },
  { id: 'ai-keys', label: 'AI / LLM Keys', icon: <Sparkles size={15} /> },
  { id: 'sales', label: 'Sales Config', icon: <TrendingUp size={15} /> },
  { id: 'marketing', label: 'Marketing Config', icon: <Megaphone size={15} /> },
]

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('roles-modules')
  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Settings</div><div className="page-subtitle">Configure system-wide settings and permissions</div></div>
      </div>

      <div className="table-wrap">
        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', overflowX: 'auto', padding: '0 4px' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 18px', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 600, fontSize: '0.86rem', color: activeTab === t.id ? 'var(--c1)' : 'var(--ink-muted)', borderBottom: activeTab === t.id ? '2.5px solid var(--c1)' : '2.5px solid transparent', transition: 'all .15s', marginBottom: -1, whiteSpace: 'nowrap' }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        <div style={{ padding: '24px' }}>
          {activeTab === 'roles-modules' && <RolesModulesTab />}
          {activeTab === 'organization' && <OrganizationTab />}
          {activeTab === 'approval' && <ApprovalChainTab />}
          {activeTab === 'budget' && <BudgetConfigTab />}
          {activeTab === 'categories' && <ExpenseCategoriesTab />}
          {activeTab === 'gst' && <GSTSettingsTab />}
          {activeTab === 'ai-keys' && <AILLMKeysTab />}
          {activeTab === 'sales' && <SalesConfigTab />}
          {activeTab === 'marketing' && <MarketingConfigTab />}
        </div>
      </div>
    </div>
  )
}
