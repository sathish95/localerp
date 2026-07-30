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
  Settings, GitBranch, DollarSign, Bell, Tag, FileText, Sparkles,
  Save, Plus, Trash2, Edit2, Check, X, Users, Eye, EyeOff, Shield, ChevronDown, ChevronRight, ChevronUp
} from 'lucide-react'
import {
  WORKFLOWS, workflowConfig, listChainsWithSteps, createChain, saveChainSteps, setChainActive, deleteChain,
} from '../lib/approvalChains'

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
    const [r, m, v] = await Promise.all([listRoles(), getModules(), getModuleRoleVisibility()])
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
      await setModuleEnabled(mod.key, !mod.enabled, profile.id)
      setModulesState(prev => prev.map(m => m.key === mod.key ? { ...m, enabled: !mod.enabled } : m))
      refresh()
    } catch (e) { alert(e.message) }
  }

  async function toggleVisible(moduleKey, roleKey) {
    const current = visMap[moduleKey]?.[roleKey] !== false
    const next = !current
    await setModuleRoleVisibility(moduleKey, roleKey, next)
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

const TABS = [
  { id: 'roles-modules', label: 'Roles & Modules', icon: <Shield size={15} /> },
  { id: 'approval', label: 'Approval Chain', icon: <GitBranch size={15} /> },
  { id: 'budget', label: 'Budget Config', icon: <DollarSign size={15} /> },
  { id: 'categories', label: 'Expense Categories', icon: <Tag size={15} /> },
  { id: 'gst', label: 'GST Settings', icon: <FileText size={15} /> },
  { id: 'ai-keys', label: 'AI / LLM Keys', icon: <Sparkles size={15} /> },
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
          {activeTab === 'approval' && <ApprovalChainTab />}
          {activeTab === 'budget' && <BudgetConfigTab />}
          {activeTab === 'categories' && <ExpenseCategoriesTab />}
          {activeTab === 'gst' && <GSTSettingsTab />}
          {activeTab === 'ai-keys' && <AILLMKeysTab />}
        </div>
      </div>
    </div>
  )
}
